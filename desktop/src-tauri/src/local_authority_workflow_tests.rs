#[test]
fn manual_workflow_executes_send_message_and_persists_completed_trace() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = format!(
        "name: Local workflow\ntrigger:\n  on: message_posted\nsteps:\n  - id: post\n    action: send_message\n    channel: {GENERAL_CHANNEL_ID}\n    text: workflow says hi\n  - id: topic\n    action: set_channel_topic\n    topic: Workflow active\n"
    );
    let workflow = EventBuilder::new(Kind::Custom(30620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign workflow");
    authority.submit(workflow).expect("save workflow");

    let trigger = EventBuilder::new(Kind::Custom(46020), "")
        .tags([parse_tag(["d", &workflow_id]).expect("trigger workflow")])
        .sign_with_keys(&owner)
        .expect("sign trigger");
    let response = authority.submit(trigger).expect("trigger workflow");
    let acknowledgement: Value = serde_json::from_str(
        response
            .message
            .strip_prefix("response:")
            .expect("response prefix"),
    )
    .expect("trigger acknowledgement");
    let run_id = acknowledgement["run_id"]
        .as_str()
        .expect("run id")
        .to_string();

    assert!(authority
        .query(&[json!({
            "kinds": [9],
            "#h": [GENERAL_CHANNEL_ID],
            "search": "workflow says hi"
        })])
        .expect("workflow output")
        .iter()
        .any(|event| event.content == "workflow says hi"));
    let runs = authority
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("workflow runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["id"], run_id);
    assert_eq!(runs[0]["status"], "completed");
    assert_eq!(runs[0]["execution_trace"][0]["step_id"], "post");
    assert_eq!(runs[0]["execution_trace"][0]["status"], "completed");
    assert_eq!(runs[0]["execution_trace"][1]["step_id"], "topic");
    assert_eq!(
        tag_value(
            &authority
                .channel_metadata(GENERAL_CHANNEL_ID)
                .expect("general metadata")
                .expect("general snapshot"),
            "topic"
        )
        .as_deref(),
        Some("Workflow active")
    );
}

#[test]
fn workflow_approval_is_authorized_durable_and_resumes_the_remaining_steps() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed workflow owner");
    let approver = Keys::generate();
    let outsider = Keys::generate();
    authority
        .onboard_account(&approver, "Approver")
        .expect("onboard approver");
    authority
        .onboard_account(&outsider, "Outsider")
        .expect("onboard outsider");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = format!(
        "name: Approval workflow\nsteps:\n  - id: approve\n    action: request_approval\n    from: {}\n    message: Approve the local run\n    timeout: 1h\n  - id: publish\n    action: send_message\n    channel: {GENERAL_CHANNEL_ID}\n    text: approved locally\n",
        approver.public_key().to_hex()
    );
    let workflow = EventBuilder::new(Kind::Custom(30620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign approval workflow");
    authority.submit(workflow).expect("save approval workflow");
    let trigger = EventBuilder::new(Kind::Custom(46020), "")
        .tags([parse_tag(["d", &workflow_id]).expect("trigger workflow")])
        .sign_with_keys(&owner)
        .expect("sign workflow trigger");
    let response = authority
        .submit(trigger)
        .expect("trigger approval workflow");
    let acknowledgement: Value = serde_json::from_str(
        response
            .message
            .strip_prefix("response:")
            .expect("trigger response"),
    )
    .expect("trigger acknowledgement");
    let run_id = acknowledgement["run_id"].as_str().expect("run id");
    let runs = authority
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("waiting run");
    assert_eq!(runs[0]["status"], "waiting_approval");
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "approved locally"})])
        .expect("message before approval")
        .is_empty());
    let approvals = authority
        .workflow_approvals(&owner.public_key().to_hex(), &workflow_id, run_id)
        .expect("pending approvals");
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0]["status"], "pending");
    let token = approvals[0]["approval_ref"]
        .as_str()
        .expect("approval reference");

    let unauthorized = EventBuilder::new(Kind::Custom(46030), "")
        .tags([parse_tag(["t", token]).expect("approval token")])
        .sign_with_keys(&outsider)
        .expect("sign unauthorized approval");
    assert!(authority.submit(unauthorized).is_err());

    let grant = EventBuilder::new(Kind::Custom(46030), "approved")
        .tags([parse_tag(["t", token]).expect("approval token")])
        .sign_with_keys(&approver)
        .expect("sign approval");
    authority.submit(grant).expect("grant workflow approval");
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "approved locally"})])
        .expect("message after approval")
        .iter()
        .any(|event| event.content == "approved locally"));
    assert_eq!(
        authority
            .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
            .expect("completed run")[0]["status"],
        "completed"
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen workflow authority");
    assert_eq!(
        reopened
            .workflow_approvals(&owner.public_key().to_hex(), &workflow_id, run_id)
            .expect("durable approval")[0]["status"],
        "granted"
    );
}

#[test]
fn workflow_actions_send_dm_react_skip_and_resume_delay_after_restart() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed workflow owner");
    let recipient = Keys::generate();
    authority
        .onboard_account(&recipient, "Workflow recipient")
        .expect("onboard workflow recipient");
    let target = EventBuilder::new(Kind::Custom(9), "react to this")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("target channel")])
        .sign_with_keys(&owner)
        .expect("sign reaction target");
    authority
        .submit(target.clone())
        .expect("publish reaction target");

    let workflow_id = Uuid::new_v4().to_string();
    let definition = format!(
        "name: Durable actions\nsteps:\n  - id: skipped\n    if: false\n    action: send_message\n    text: must not publish\n  - id: dm\n    action: send_dm\n    to: {}\n    text: private workflow message\n  - id: react\n    action: add_reaction\n    emoji: 🚀\n  - id: wait\n    action: delay\n    duration: 1s\n  - id: after\n    action: send_message\n    text: resumed after restart\n",
        recipient.public_key().to_hex()
    );
    let workflow = EventBuilder::new(Kind::Custom(30_620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign durable workflow");
    authority.submit(workflow).expect("save durable workflow");
    let trigger = EventBuilder::new(Kind::Custom(46_020), "")
        .tags([
            parse_tag(["d", &workflow_id]).expect("trigger workflow"),
            parse_tag(["e", &target.id.to_hex()]).expect("trigger event"),
            parse_tag(["p", &owner.public_key().to_hex()]).expect("trigger author"),
        ])
        .sign_with_keys(&owner)
        .expect("sign durable trigger");
    authority.submit(trigger).expect("trigger durable workflow");

    let runs = authority
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("waiting delay run");
    assert_eq!(runs[0]["status"], "waiting_delay");
    assert_eq!(runs[0]["execution_trace"][0]["status"], "skipped");
    assert_eq!(runs[0]["execution_trace"][3]["status"], "waiting_delay");
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "must not publish"})])
        .expect("skipped output query")
        .is_empty());
    let direct = authority
        .query(&[json!({
            "kinds": [39000],
            "#p": [recipient.public_key().to_hex()]
        })])
        .expect("workflow DM metadata")
        .into_iter()
        .find(|event| tag_value(event, "t").as_deref() == Some("dm"))
        .expect("workflow DM");
    let direct_id = tag_value(&direct, "d").expect("workflow DM id");
    assert!(authority
        .query(&[json!({"kinds": [9], "#h": [direct_id]})])
        .expect("workflow DM message")
        .iter()
        .any(|event| {
            event.pubkey == authority.workflow_signer.public_key()
                && event.content == "private workflow message"
        }));
    assert!(authority
        .query(&[json!({"kinds": [7], "#e": [target.id.to_hex()]})])
        .expect("workflow reaction")
        .iter()
        .any(|event| event.content == "🚀"));
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "resumed after restart"})])
        .expect("pre-resume output")
        .is_empty());
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen delayed workflow authority");
    reopened
        .run_due_workflows(chrono::Utc::now().timestamp() + 2)
        .expect("resume due workflow");
    assert!(reopened
        .query(&[json!({"kinds": [9], "search": "resumed after restart"})])
        .expect("resumed output")
        .iter()
        .any(|event| event.content == "resumed after restart"));
    assert_eq!(
        reopened
            .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
            .expect("completed delayed run")[0]["status"],
        "completed"
    );
}

#[tokio::test]
async fn signed_workflow_webhook_is_idempotent_and_creates_one_durable_run() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed webhook owner");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = "name: Hook\ntrigger:\n  on: webhook\nsteps:\n  - id: post\n    action: send_message\n    text: webhook fired locally\n";
    let workflow = EventBuilder::new(Kind::Custom(30_620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign webhook workflow");
    let saved = authority.submit(workflow).expect("save webhook workflow");
    let saved: Value = serde_json::from_str(
        saved
            .message
            .strip_prefix("response:")
            .expect("workflow save response"),
    )
    .expect("workflow save JSON");
    let secret = saved["webhook_secret"].as_str().expect("webhook secret");
    assert!(secret.len() >= 32);

    let authority = Arc::new(authority);
    let router = authority_router(Arc::clone(&authority));
    let body = Bytes::from_static(br#"{"source":"local-proof"}"#);
    let unsigned = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/hooks/{workflow_id}"))
                .body(Body::from(body.clone()))
                .expect("unsigned webhook"),
        )
        .await
        .expect("unsigned webhook response");
    assert_eq!(unsigned.status(), StatusCode::UNAUTHORIZED);

    let timestamp = chrono::Utc::now().timestamp().to_string();
    let signature = workflow_webhook_signature(secret, &timestamp, &body);
    let delivery_id = Uuid::new_v4().to_string();
    let request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/hooks/{workflow_id}"))
            .header("x-punks-timestamp", &timestamp)
            .header("x-punks-signature", &signature)
            .header("x-punks-delivery-id", &delivery_id)
            .body(Body::from(body.clone()))
            .expect("signed webhook")
    };
    let first = router
        .clone()
        .oneshot(request())
        .await
        .expect("first webhook response");
    assert_eq!(first.status(), StatusCode::OK);
    let first: Value = serde_json::from_slice(
        &to_bytes(first.into_body(), 64 * 1024)
            .await
            .expect("first webhook body"),
    )
    .expect("first webhook JSON");
    let repeated = router
        .clone()
        .oneshot(request())
        .await
        .expect("repeated webhook response");
    assert_eq!(repeated.status(), StatusCode::OK);
    let repeated: Value = serde_json::from_slice(
        &to_bytes(repeated.into_body(), 64 * 1024)
            .await
            .expect("repeated webhook body"),
    )
    .expect("repeated webhook JSON");
    assert_eq!(repeated["run_id"], first["run_id"]);

    let runs = authority
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("webhook runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["id"], first["run_id"]);
    assert_eq!(runs[0]["status"], "completed");
    assert_eq!(
        authority
            .query(&[json!({
                "kinds": [9],
                "search": "webhook fired locally"
            })])
            .expect("webhook output")
            .len(),
        1
    );
}

#[test]
fn interval_workflow_catches_up_once_after_restart_without_replay_storm() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed schedule owner");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = "name: Interval\ntrigger:\n  on: schedule\n  interval: 1s\nsteps:\n  - id: post\n    action: send_message\n    text: scheduled local run\n";
    let workflow = EventBuilder::new(Kind::Custom(30_620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign interval workflow");
    authority.submit(workflow).expect("save interval workflow");
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "scheduled local run"})])
        .expect("pre-schedule output")
        .is_empty());
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen scheduled workflow authority");
    let future = chrono::Utc::now().timestamp() + 2;
    reopened
        .run_due_workflows(future)
        .expect("fire due interval workflow");
    reopened
        .run_due_workflows(future)
        .expect("repeat scheduler tick");
    assert_eq!(
        reopened
            .query(&[json!({"kinds": [9], "search": "scheduled local run"})])
            .expect("scheduled output")
            .len(),
        1
    );
    let runs = reopened
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("scheduled runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["status"], "completed");
}

#[test]
fn cron_workflow_fires_from_the_persistent_utc_schedule() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed cron owner");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = "name: Cron\ntrigger:\n  on: schedule\n  cron: '*/1 * * * * * *'\nsteps:\n  - id: post\n    action: send_message\n    text: cron local run\n";
    let workflow = EventBuilder::new(Kind::Custom(30_620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign cron workflow");
    authority.submit(workflow).expect("save cron workflow");
    authority
        .run_due_workflows(chrono::Utc::now().timestamp() + 2)
        .expect("fire cron workflow");
    assert_eq!(
        authority
            .query(&[json!({"kinds": [9], "search": "cron local run"})])
            .expect("cron output")
            .len(),
        1
    );
}

#[test]
fn outgoing_workflow_webhook_rejects_loopback_instead_of_faking_success() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed outgoing webhook owner");
    let workflow_id = Uuid::new_v4().to_string();
    let definition = "name: Outgoing hook\nsteps:\n  - id: call\n    action: call_webhook\n    url: http://127.0.0.1:9/private\n    method: POST\n    body: '{}'
";
    let workflow = EventBuilder::new(Kind::Custom(30_620), definition)
        .tags([
            parse_tag(["d", &workflow_id]).expect("workflow id"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("workflow channel"),
        ])
        .sign_with_keys(&owner)
        .expect("sign outgoing webhook workflow");
    authority
        .submit(workflow)
        .expect("save outgoing webhook workflow");
    let trigger = EventBuilder::new(Kind::Custom(46_020), "")
        .tags([parse_tag(["d", &workflow_id]).expect("trigger workflow")])
        .sign_with_keys(&owner)
        .expect("sign outgoing webhook trigger");
    authority
        .submit(trigger)
        .expect("run outgoing webhook workflow");
    let run = authority
        .workflow_runs(&owner.public_key().to_hex(), &workflow_id, 20)
        .expect("outgoing webhook run")
        .into_iter()
        .next()
        .expect("outgoing webhook run record");
    assert_eq!(run["status"], "failed");
    assert!(run["execution_trace"][0]["error"]
        .as_str()
        .is_some_and(|error| error.contains("public HTTPS")));
}
use super::*;
