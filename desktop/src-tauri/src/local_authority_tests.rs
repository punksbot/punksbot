use super::*;
use axum::{
    body::{to_bytes, Body, Bytes},
    http::{Request, StatusCode},
};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine as _,
};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

#[path = "local_authority_account_tests.rs"]
mod account_tests;
#[path = "local_authority_channel_ttl_tests.rs"]
mod channel_ttl_tests;
#[path = "local_authority_content_tests.rs"]
mod content_tests;
#[path = "local_authority_identity_archive_tests.rs"]
mod identity_archive_tests;
#[path = "local_authority_media_tests.rs"]
mod media_tests;
#[path = "local_authority_reminder_tests.rs"]
mod reminder_tests;
#[path = "local_authority_transport_tests.rs"]
mod transport_tests;
#[path = "local_authority_workflow_tests.rs"]
mod workflow_tests;

async fn connect_huddle(
    url: &str,
    keys: &Keys,
) -> (
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Value,
) {
    use futures_util::{SinkExt, StreamExt};
    let (mut socket, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect Huddle socket");
    let challenge = socket
        .next()
        .await
        .expect("Huddle challenge frame")
        .expect("Huddle challenge message")
        .into_text()
        .expect("Huddle challenge text");
    let challenge: Value = serde_json::from_str(&challenge).expect("Huddle challenge JSON");
    let challenge = challenge["challenge"].as_str().expect("Huddle challenge");
    let auth = EventBuilder::new(Kind::Custom(22_242), "")
        .tags([parse_tag(["challenge", challenge]).expect("Huddle challenge tag")])
        .sign_with_keys(keys)
        .expect("sign Huddle auth");
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({"type": "auth", "protocol_version": 2, "event": auth})
                .to_string()
                .into(),
        ))
        .await
        .expect("send Huddle auth");
    let joined = socket
        .next()
        .await
        .expect("Huddle joined frame")
        .expect("Huddle joined message")
        .into_text()
        .expect("Huddle joined text");
    let joined = serde_json::from_str(&joined).expect("Huddle joined JSON");
    (socket, joined)
}

fn authority() -> (tempfile::TempDir, LocalAuthority, Keys) {
    let directory = tempfile::tempdir().expect("temp authority directory");
    let owner = Keys::generate();
    let authority =
        LocalAuthority::open(&directory.path().join("authority.sqlite3"), owner.clone())
            .expect("open authority");
    (directory, authority, owner)
}

fn nip98_header(keys: &Keys, method: &str, path: &str, body: &[u8]) -> String {
    let digest = hex::encode(Sha256::digest(body));
    let event = EventBuilder::new(Kind::Custom(27_235), "")
        .tags([
            parse_tag(["u", &format!("http://127.0.0.1{path}")]).expect("NIP-98 URL"),
            parse_tag(["method", method]).expect("NIP-98 method"),
            parse_tag(["payload", &digest]).expect("NIP-98 payload"),
        ])
        .sign_with_keys(keys)
        .expect("sign NIP-98 request");
    format!("Nostr {}", BASE64.encode(event.as_json()))
}

fn blossom_upload_header(keys: &Keys, sha256: &str) -> String {
    let expiration = (chrono::Utc::now().timestamp() + 300).to_string();
    let event = EventBuilder::new(Kind::Custom(24_242), "Upload punks-media")
        .tags([
            parse_tag(["t", "upload"]).expect("upload verb"),
            parse_tag(["x", sha256]).expect("upload digest"),
            parse_tag(["expiration", &expiration]).expect("upload expiration"),
            parse_tag(["server", "127.0.0.1:18787"]).expect("upload server"),
        ])
        .sign_with_keys(keys)
        .expect("sign Blossom upload");
    format!("Nostr {}", URL_SAFE_NO_PAD.encode(event.as_json()))
}

fn git_nip98_header(keys: &Keys, server: &str, owner: &str, repository: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(27_235), "")
        .tags([
            parse_tag(["u", &format!("http://{server}/git/{owner}/{repository}")])
                .expect("Git NIP-98 URL"),
            parse_tag(["method", "GET"]).expect("Git NIP-98 method"),
        ])
        .sign_with_keys(keys)
        .expect("sign Git NIP-98 request");
    format!("Nostr {}", BASE64.encode(event.as_json()))
}

fn workflow_webhook_signature(secret: &str, timestamp: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("webhook HMAC key");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

#[test]
fn local_events_persist_and_filter_by_kind_channel_and_search() {
    let (_directory, authority, owner) = authority();
    let event = EventBuilder::new(Kind::Custom(9), "Punks local persistence")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign message");
    authority
        .persist_and_publish(event.clone())
        .expect("persist");

    let loaded = authority
        .query(&[json!({
            "kinds": [9],
            "#h": [GENERAL_CHANNEL_ID],
            "search": "local persistence"
        })])
        .expect("query");
    assert_eq!(loaded, vec![event]);
}

#[test]
fn create_channel_command_materializes_real_discovery_authorities() {
    let (_directory, authority, owner) = authority();
    authority
        .ensure_community_member(&owner.public_key().to_hex(), "owner")
        .expect("seed command owner");
    let channel_id = Uuid::new_v4().to_string();
    let command = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            parse_tag(["h", &channel_id]).expect("h tag"),
            parse_tag(["name", "engineering"]).expect("name tag"),
            parse_tag(["visibility", "open"]).expect("visibility tag"),
            parse_tag(["channel_type", "stream"]).expect("type tag"),
        ])
        .sign_with_keys(&owner)
        .expect("sign command");
    let response = authority.submit(command).expect("submit command");
    assert!(response.message.contains(&channel_id));

    let metadata = authority
        .query(&[json!({"kinds": [39000], "#d": [&channel_id]})])
        .expect("metadata query");
    let members = authority
        .query(&[json!({"kinds": [39002], "#d": [&channel_id]})])
        .expect("member query");
    assert_eq!(metadata.len(), 1);
    assert_eq!(members.len(), 1);
    assert_eq!(
        tag_value(&metadata[0], "name").as_deref(),
        Some("engineering")
    );
    assert!(authority
        .channel_members(&channel_id)
        .expect("materialized members")
        .iter()
        .any(|(pubkey, role)| pubkey == &owner.public_key().to_hex() && role == "owner"));
}

#[test]
fn replaceable_profile_keeps_only_the_latest_author_head() {
    let (_directory, authority, owner) = authority();
    let first = EventBuilder::new(Kind::Metadata, json!({"name": "First"}).to_string())
        .custom_created_at(nostr::Timestamp::from(1))
        .sign_with_keys(&owner)
        .expect("first profile");
    let second = EventBuilder::new(Kind::Metadata, json!({"name": "Second"}).to_string())
        .custom_created_at(nostr::Timestamp::from(2))
        .sign_with_keys(&owner)
        .expect("second profile");
    authority.persist_and_publish(first).expect("first persist");
    authority
        .persist_and_publish(second.clone())
        .expect("second persist");
    let profiles = authority
        .query(&[json!({"kinds": [0], "authors": [owner.public_key().to_hex()]})])
        .expect("profiles");
    assert_eq!(profiles, vec![second]);
}

#[test]
fn authority_identity_is_stable_and_distinct_from_every_active_punk() {
    let directory = tempfile::tempdir().expect("temp authority directory");
    let database_path = directory.path().join("authority.sqlite3");
    let first_punk = Keys::generate();
    let first = LocalAuthority::open(&database_path, first_punk.clone()).expect("first open");
    let authority_pubkey = first.signer.public_key().to_hex();
    assert_ne!(authority_pubkey, first_punk.public_key().to_hex());
    drop(first);

    let second_punk = Keys::generate();
    let reopened = LocalAuthority::open(&database_path, second_punk.clone()).expect("reopen");
    assert_eq!(reopened.signer.public_key().to_hex(), authority_pubkey);
    assert_ne!(authority_pubkey, second_punk.public_key().to_hex());
}

#[tokio::test]
async fn nip11_is_served_on_root_and_info_with_the_authority_self() {
    let (_directory, authority, _owner) = authority();
    let expected_self = authority.signer.public_key().to_hex();
    let authority = Arc::new(authority);
    let router = authority_router(Arc::clone(&authority));

    for path in ["/", "/info"] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("accept", "application/nostr+json")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("NIP-11 response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("NIP-11 body");
        let document: Value = serde_json::from_slice(&body).expect("NIP-11 JSON");
        assert_eq!(document["name"], "Punks Full Local");
        assert_eq!(document["self"], expected_self);
    }
}

#[test]
fn accepted_event_has_a_durable_authority_audit_record() {
    let (directory, authority, owner) = authority();
    authority
        .ensure_community_member(&owner.public_key().to_hex(), "owner")
        .expect("seed audited owner");
    let event = EventBuilder::new(Kind::Custom(9), "audited message")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign message");
    authority.submit(event.clone()).expect("submit event");

    let audit = authority.audit_entries(10).expect("audit entries");
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].action, "event.accepted");
    assert_eq!(audit[0].actor_pubkey, owner.public_key().to_hex());
    assert_eq!(audit[0].target_id, event.id.to_hex());
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen authority");
    assert_eq!(
        reopened.audit_entries(10).expect("durable audit")[0].target_id,
        event.id.to_hex()
    );
}

#[test]
fn opening_the_prototype_schema_preserves_and_indexes_existing_events() {
    let directory = tempfile::tempdir().expect("temp authority directory");
    let path = directory.path().join("authority.sqlite3");
    let owner = Keys::generate();
    let event = EventBuilder::new(Kind::Custom(9), "prototype searchable message")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign prototype event");
    {
        let database = Connection::open(&path).expect("prototype database");
        database
            .execute_batch(
                "CREATE TABLE events (
                   id TEXT PRIMARY KEY NOT NULL,
                   pubkey TEXT NOT NULL,
                   kind INTEGER NOT NULL,
                   created_at INTEGER NOT NULL,
                   raw_json TEXT NOT NULL
                 );",
            )
            .expect("prototype schema");
        database
            .execute(
                "INSERT INTO events(id, pubkey, kind, created_at, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    event.id.to_hex(),
                    event.pubkey.to_hex(),
                    9_i64,
                    event.created_at.as_secs() as i64,
                    event.as_json()
                ],
            )
            .expect("prototype event");
    }

    let authority = LocalAuthority::open(&path, owner).expect("migrate prototype");
    assert_eq!(
        authority
            .query(&[json!({
                "kinds": [9],
                "#h": [GENERAL_CHANNEL_ID],
                "search": "prototype searchable"
            })])
            .expect("migrated query"),
        vec![event]
    );
}

#[test]
fn full_text_search_is_case_and_accent_insensitive() {
    let (_directory, authority, owner) = authority();
    let event = EventBuilder::new(Kind::Custom(9), "Café résumé pour Punks")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign searchable event");
    authority
        .persist_and_publish(event.clone())
        .expect("persist searchable event");

    assert_eq!(
        authority
            .query(&[json!({"kinds": [9], "search": "cafe resume"})])
            .expect("FTS query"),
        vec![event]
    );
}

#[test]
fn onboarding_a_local_account_materializes_profile_and_general_membership() {
    let (_directory, authority, first_owner) = authority();
    authority
        .seed_minimum_authorities(&first_owner)
        .expect("seed first owner");
    let newcomer = Keys::generate();
    authority
        .onboard_account(&newcomer, "New Punk")
        .expect("onboard newcomer");

    let profile = authority
        .query(&[json!({
            "kinds": [0],
            "authors": [newcomer.public_key().to_hex()],
            "limit": 1
        })])
        .expect("newcomer profile");
    assert_eq!(profile.len(), 1);
    assert_eq!(
        serde_json::from_str::<Value>(&profile[0].content).expect("profile JSON")["display_name"],
        "New Punk"
    );
    assert!(authority
        .channel_members(GENERAL_CHANNEL_ID)
        .expect("general members")
        .iter()
        .any(|(pubkey, role)| pubkey == &newcomer.public_key().to_hex() && role == "member"));
}

#[test]
fn moderation_reports_are_private_and_bans_are_role_enforced() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Member Punk")
        .expect("onboard member");

    let target = EventBuilder::new(Kind::Custom(9), "message to report")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign target");
    authority.submit(target.clone()).expect("publish target");
    let report = EventBuilder::new(Kind::Custom(1984), "private note")
        .tags([
            parse_tag(["p", &owner.public_key().to_hex()]).expect("p tag"),
            parse_tag(["e", &target.id.to_hex(), "spam"]).expect("report tag"),
        ])
        .sign_with_keys(&member)
        .expect("sign report");
    authority.submit(report.clone()).expect("submit report");
    assert!(authority
        .query(&[json!({"ids": [report.id.to_hex()]})])
        .expect("public report query")
        .is_empty());
    let reports = authority
        .moderation_reports(&owner.public_key().to_hex(), Some("open"), 10)
        .expect("moderator report queue");
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0]["report_event_id"], report.id.to_hex());
    assert_eq!(reports[0]["note"], "private note");

    let member_ban = EventBuilder::new(Kind::Custom(9040), "")
        .tags([parse_tag(["p", &owner.public_key().to_hex()]).expect("ban target")])
        .sign_with_keys(&member)
        .expect("sign unauthorized ban");
    assert!(authority.submit(member_ban).is_err());

    let owner_ban = EventBuilder::new(Kind::Custom(9040), "")
        .tags([
            parse_tag(["p", &member.public_key().to_hex()]).expect("ban target"),
            parse_tag(["reason", "abuse"]).expect("ban reason"),
        ])
        .sign_with_keys(&owner)
        .expect("sign owner ban");
    authority.submit(owner_ban).expect("owner ban");
    let blocked_message = EventBuilder::new(Kind::Custom(9), "blocked")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&member)
        .expect("sign blocked message");
    assert!(authority.submit(blocked_message).is_err());
    assert!(authority
        .moderation_restrictions(&owner.public_key().to_hex())
        .expect("moderator restrictions")
        .iter()
        .any(|restriction| {
            restriction["pubkey"] == member.public_key().to_hex() && restriction["banned"] == true
        }));
}

#[test]
fn invitation_claim_adds_a_new_identity_once_and_survives_restart() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let invite = authority
        .create_invite(&owner.public_key().to_hex(), 3_600, Some(1), None)
        .expect("create invite");
    assert_eq!(invite.max_uses, Some(1));
    assert_eq!(invite.uses_remaining, Some(1));

    let newcomer = Keys::generate();
    let claim = authority
        .claim_invite(&newcomer.public_key().to_hex(), &invite.code)
        .expect("claim invite");
    assert_eq!(claim.status, "joined");
    assert_eq!(claim.role, "member");
    assert!(authority
        .claim_invite(&Keys::generate().public_key().to_hex(), &invite.code)
        .is_err());

    let newcomer_message = EventBuilder::new(Kind::Custom(9), "joined locally")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("h tag")])
        .sign_with_keys(&newcomer)
        .expect("sign newcomer message");
    authority
        .submit(newcomer_message.clone())
        .expect("new member publish");
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen authority");
    assert_eq!(
        reopened
            .query(&[json!({"ids": [newcomer_message.id.to_hex()]})])
            .expect("durable newcomer message"),
        vec![newcomer_message]
    );
}

#[test]
fn nip43_snapshot_is_authority_signed_and_tracks_admin_commands() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Member Punk")
        .expect("onboard member");

    let initial = authority
        .query(&[json!({"kinds": [13534], "limit": 1})])
        .expect("membership snapshot");
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].pubkey, authority.signer.public_key());
    assert!(initial[0].tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().map(String::as_str) == Some("member")
            && values.get(1).map(String::as_str) == Some(member.public_key().to_hex().as_str())
            && values.get(2).map(String::as_str) == Some("member")
    }));
    authority
        .publish_membership_snapshot()
        .expect("idempotent membership reconciliation");
    let unchanged = authority
        .query(&[json!({"kinds": [13534], "limit": 1})])
        .expect("unchanged membership snapshot");
    assert_eq!(unchanged[0].id, initial[0].id);

    let promote = EventBuilder::new(Kind::Custom(9032), "")
        .tags([
            parse_tag(["p", &member.public_key().to_hex()]).expect("member target"),
            parse_tag(["role", "admin"]).expect("admin role"),
        ])
        .sign_with_keys(&owner)
        .expect("sign promotion");
    authority.submit(promote).expect("promote member");

    let promoted = authority
        .query(&[json!({"kinds": [13534], "limit": 1})])
        .expect("promoted snapshot");
    assert_eq!(promoted.len(), 1);
    assert!(promoted[0].created_at > initial[0].created_at);
    assert!(promoted[0].tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().map(String::as_str) == Some("member")
            && values.get(1).map(String::as_str) == Some(member.public_key().to_hex().as_str())
            && values.get(2).map(String::as_str) == Some("admin")
    }));

    let outsider = Keys::generate();
    let unauthorized_add = EventBuilder::new(Kind::Custom(9030), "")
        .tags([parse_tag(["p", &outsider.public_key().to_hex()]).expect("outsider target")])
        .sign_with_keys(&Keys::generate())
        .expect("sign unauthorized add");
    assert!(authority.submit(unauthorized_add).is_err());
}

#[test]
fn banned_member_cannot_authenticate_but_timeout_only_blocks_writes() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Restricted Punk")
        .expect("onboard member");
    let pubkey = member.public_key().to_hex();

    let timeout = EventBuilder::new(Kind::Custom(9042), "")
        .tags([
            parse_tag(["p", &pubkey]).expect("timeout target"),
            parse_tag([
                "expiration",
                &(chrono::Utc::now().timestamp() + 3_600).to_string(),
            ])
            .expect("timeout expiration"),
        ])
        .sign_with_keys(&owner)
        .expect("sign timeout");
    authority.submit(timeout).expect("timeout member");
    authority
        .assert_member_can_authenticate(&pubkey)
        .expect("timed out member may still authenticate for reads");
    assert!(authority.assert_member_can_publish(&pubkey).is_err());

    let ban = EventBuilder::new(Kind::Custom(9040), "")
        .tags([parse_tag(["p", &pubkey]).expect("ban target")])
        .sign_with_keys(&owner)
        .expect("sign ban");
    authority.submit(ban).expect("ban member");
    assert!(authority.assert_member_can_authenticate(&pubkey).is_err());
}

#[tokio::test]
async fn http_queries_require_nip98_and_hide_private_dm_data_from_nonparticipants() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let participant = Keys::generate();
    let outsider = Keys::generate();
    authority
        .onboard_account(&participant, "DM participant")
        .expect("onboard participant");
    authority
        .onboard_account(&outsider, "DM outsider")
        .expect("onboard outsider");

    let open_dm = EventBuilder::new(Kind::Custom(41010), "")
        .tags([parse_tag(["p", &participant.public_key().to_hex()]).expect("participant")])
        .sign_with_keys(&owner)
        .expect("sign DM command");
    let response = authority.submit(open_dm).expect("open DM");
    let acknowledgement: Value = serde_json::from_str(
        response
            .message
            .strip_prefix("response:")
            .expect("response prefix"),
    )
    .expect("DM response");
    let channel_id = acknowledgement["channel_id"].as_str().expect("DM id");
    let secret_message = EventBuilder::new(Kind::Custom(9), "private hello")
        .tags([parse_tag(["h", channel_id]).expect("DM channel")])
        .sign_with_keys(&owner)
        .expect("sign DM message");
    authority
        .submit(secret_message.clone())
        .expect("publish DM message");
    let intrusion = EventBuilder::new(Kind::Custom(9), "intrusion")
        .tags([parse_tag(["h", channel_id]).expect("private DM channel")])
        .sign_with_keys(&outsider)
        .expect("sign outsider message");
    assert!(authority.submit(intrusion).is_err());
    let router = authority_router(Arc::new(authority));
    let body = serde_json::to_vec(&vec![json!({"#h": [channel_id]})]).expect("query body");

    let unauthenticated = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query")
                .header("content-type", "application/json")
                .body(Body::from(body.clone()))
                .expect("unauthenticated query"),
        )
        .await
        .expect("unauthenticated response");
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let outsider_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    nip98_header(&outsider, "POST", "/query", &body),
                )
                .body(Body::from(body.clone()))
                .expect("outsider query"),
        )
        .await
        .expect("outsider response");
    assert_eq!(outsider_response.status(), StatusCode::OK);
    let outsider_body = to_bytes(outsider_response.into_body(), 64 * 1024)
        .await
        .expect("outsider body");
    assert!(serde_json::from_slice::<Vec<Event>>(&outsider_body)
        .expect("outsider events")
        .is_empty());

    let participant_response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/query")
                .header("content-type", "application/json")
                .header(
                    "authorization",
                    nip98_header(&participant, "POST", "/query", &body),
                )
                .body(Body::from(body))
                .expect("participant query"),
        )
        .await
        .expect("participant response");
    assert_eq!(participant_response.status(), StatusCode::OK);
    let participant_body = to_bytes(participant_response.into_body(), 64 * 1024)
        .await
        .expect("participant body");
    assert_eq!(
        serde_json::from_slice::<Vec<Event>>(&participant_body).expect("participant events"),
        vec![secret_message]
    );
}

#[test]
fn group_dm_add_hide_and_reopen_are_private_per_identity() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed DM owner");
    let participant = Keys::generate();
    let added = Keys::generate();
    let outsider = Keys::generate();
    for (keys, name) in [
        (&participant, "Participant"),
        (&added, "Added"),
        (&outsider, "Outsider"),
    ] {
        authority
            .onboard_account(keys, name)
            .expect("onboard DM identity");
    }
    let open = EventBuilder::new(Kind::Custom(41_010), "")
        .tags([parse_tag(["p", &participant.public_key().to_hex()]).expect("participant")])
        .sign_with_keys(&owner)
        .expect("sign open DM");
    let response = authority.submit(open).expect("open DM");
    let ack: Value = serde_json::from_str(
        response
            .message
            .strip_prefix("response:")
            .expect("DM response prefix"),
    )
    .expect("DM acknowledgement");
    let channel_id = ack["channel_id"].as_str().expect("DM channel id");

    let unauthorized_add = EventBuilder::new(Kind::Custom(41_011), "")
        .tags([
            parse_tag(["h", channel_id]).expect("DM channel"),
            parse_tag(["p", &added.public_key().to_hex()]).expect("added Punk"),
        ])
        .sign_with_keys(&outsider)
        .expect("sign unauthorized DM add");
    assert!(authority.submit(unauthorized_add).is_err());

    let add = EventBuilder::new(Kind::Custom(41_011), "")
        .tags([
            parse_tag(["h", channel_id]).expect("DM channel"),
            parse_tag(["p", &added.public_key().to_hex()]).expect("added Punk"),
        ])
        .sign_with_keys(&owner)
        .expect("sign DM add");
    authority.submit(add).expect("add DM participant");
    assert!(authority
        .channel_members(channel_id)
        .expect("group DM members")
        .iter()
        .any(|(pubkey, _)| pubkey == &added.public_key().to_hex()));

    let hide = EventBuilder::new(Kind::Custom(41_012), "")
        .tags([parse_tag(["h", channel_id]).expect("DM channel")])
        .sign_with_keys(&owner)
        .expect("sign DM hide");
    authority.submit(hide).expect("hide DM");
    assert!(authority
        .query_for_actor(
            &owner.public_key().to_hex(),
            &[json!({"kinds": [39000], "#d": [channel_id]})]
        )
        .expect("owner hidden query")
        .is_empty());
    assert_eq!(
        authority
            .query_for_actor(
                &participant.public_key().to_hex(),
                &[json!({"kinds": [39000], "#d": [channel_id]})]
            )
            .expect("participant visible query")
            .len(),
        1
    );

    let reopen = EventBuilder::new(Kind::Custom(41_010), "")
        .tags([parse_tag(["p", &participant.public_key().to_hex()]).expect("participant")])
        .sign_with_keys(&owner)
        .expect("sign DM reopen");
    let reopened = authority.submit(reopen).expect("reopen DM");
    assert!(reopened.message.contains(channel_id));
    assert_eq!(
        authority
            .query_for_actor(
                &owner.public_key().to_hex(),
                &[json!({"kinds": [39000], "#d": [channel_id]})]
            )
            .expect("owner reopened query")
            .len(),
        1
    );
}

#[test]
fn nip29_invite_command_mints_a_persisted_single_use_membership() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed command owner");
    let command = EventBuilder::new(Kind::Custom(9_009), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("command channel"),
            parse_tag(["ttl_secs", "600"]).expect("invite lifetime"),
            parse_tag(["max_uses", "1"]).expect("invite use bound"),
        ])
        .sign_with_keys(&owner)
        .expect("sign invitation command");
    let event_id = command.id.to_hex();
    let response = authority.submit(command).expect("mint NIP-29 invitation");
    let payload: Value = serde_json::from_str(
        response
            .message
            .strip_prefix("response:")
            .expect("invitation response prefix"),
    )
    .expect("invitation response JSON");
    let code = payload["code"].as_str().expect("invitation code");
    let invitee = Keys::generate();
    assert_eq!(
        authority
            .claim_invite(&invitee.public_key().to_hex(), code)
            .expect("claim NIP-29 invitation")
            .status,
        "joined"
    );
    assert!(authority
        .claim_invite(&Keys::generate().public_key().to_hex(), code)
        .is_err());
    assert_eq!(
        authority
            .query(&[json!({"ids": [event_id]})])
            .expect("persisted invitation command")
            .len(),
        1
    );
}

#[tokio::test]
async fn media_upload_head_range_and_restart_use_the_real_local_blob() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed media owner");
    let payload = b"0123456789".to_vec();
    let sha256 = hex::encode(Sha256::digest(&payload));
    let router = authority_router(Arc::new(authority.clone()));
    let unauthenticated_upload = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/upload")
                .header("content-type", "application/octet-stream")
                .body(Body::from("unsigned"))
                .expect("unsigned upload request"),
        )
        .await
        .expect("unsigned upload response");
    assert_eq!(unauthenticated_upload.status(), StatusCode::UNAUTHORIZED);
    let upload = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/upload")
                .header("host", "127.0.0.1:18787")
                .header("content-type", "application/octet-stream")
                .header("x-sha-256", &sha256)
                .header("authorization", blossom_upload_header(&owner, &sha256))
                .body(Body::from(payload.clone()))
                .expect("upload request"),
        )
        .await
        .expect("upload response");
    assert_eq!(upload.status(), StatusCode::OK);

    let head = router
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri(format!("/media/{sha256}"))
                .body(Body::empty())
                .expect("HEAD request"),
        )
        .await
        .expect("HEAD response");
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()["content-length"], "10");
    assert_eq!(head.headers()["accept-ranges"], "bytes");
    assert!(to_bytes(head.into_body(), 1024)
        .await
        .expect("HEAD body")
        .is_empty());

    let range = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/media/{sha256}"))
                .header("range", "bytes=2-5")
                .body(Body::empty())
                .expect("range request"),
        )
        .await
        .expect("range response");
    assert_eq!(range.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(range.headers()["content-range"], "bytes 2-5/10");
    assert_eq!(
        to_bytes(range.into_body(), 1024).await.expect("range body"),
        Bytes::from_static(b"2345")
    );

    let invalid_range = router
        .oneshot(
            Request::builder()
                .uri(format!("/media/{sha256}"))
                .header("range", "bytes=20-")
                .body(Body::empty())
                .expect("invalid range request"),
        )
        .await
        .expect("invalid range response");
    assert_eq!(invalid_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen media authority");
    let persisted = authority_router(Arc::new(reopened))
        .oneshot(
            Request::builder()
                .uri(format!("/media/{sha256}"))
                .body(Body::empty())
                .expect("persisted media request"),
        )
        .await
        .expect("persisted media response");
    assert_eq!(persisted.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(persisted.into_body(), 1024)
            .await
            .expect("persisted media body"),
        Bytes::from(payload)
    );
}
