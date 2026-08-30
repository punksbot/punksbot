use super::*;

#[test]
fn canvas_revision_conflicts_preserve_history_and_restart_state() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Canvas owner");
    let first = EventBuilder::new(Kind::Custom(40_100), "first revision")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Canvas channel")])
        .sign_with_keys(&owner)
        .expect("sign first Canvas revision");
    authority.submit(first.clone()).expect("create Canvas");

    let missing_precondition = EventBuilder::new(Kind::Custom(40_100), "unsafe overwrite")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Canvas channel")])
        .custom_created_at(nostr::Timestamp::from(first.created_at.as_secs() + 1))
        .sign_with_keys(&owner)
        .expect("sign missing-precondition Canvas revision");
    assert!(authority.submit(missing_precondition).is_err());

    let wrong_precondition = EventBuilder::new(Kind::Custom(40_100), "wrong revision")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Canvas channel"),
            parse_tag(["expected-revision", &"0".repeat(64)]).expect("wrong revision"),
        ])
        .custom_created_at(nostr::Timestamp::from(first.created_at.as_secs() + 1))
        .sign_with_keys(&owner)
        .expect("sign wrong-precondition Canvas revision");
    assert!(authority.submit(wrong_precondition).is_err());

    let second = EventBuilder::new(Kind::Custom(40_100), "second revision")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Canvas channel"),
            parse_tag(["expected-revision", &first.id.to_hex()]).expect("expected revision"),
        ])
        .custom_created_at(nostr::Timestamp::from(first.created_at.as_secs() + 1))
        .sign_with_keys(&owner)
        .expect("sign second Canvas revision");
    authority.submit(second.clone()).expect("update Canvas");
    let history = authority
        .query(&[json!({"kinds": [40100], "#h": [GENERAL_CHANNEL_ID]})])
        .expect("Canvas history");
    assert_eq!(history, vec![second.clone(), first]);
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen Canvas authority");
    assert_eq!(
        reopened
            .query(&[json!({
                "kinds": [40100],
                "#h": [GENERAL_CHANNEL_ID],
                "limit": 1
            })])
            .expect("latest Canvas after restart"),
        vec![second]
    );
}

#[test]
fn workspace_pins_are_governed_while_bookmarks_remain_account_private() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed content owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Content member")
        .expect("onboard content member");
    let message = EventBuilder::new(Kind::Custom(9), "content target")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("target channel")])
        .sign_with_keys(&member)
        .expect("sign content target");
    authority
        .submit(message.clone())
        .expect("publish content target");

    let unauthorized_pin = EventBuilder::new(Kind::Custom(40_004), "pinned")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("pin channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("pin target"),
        ])
        .sign_with_keys(&member)
        .expect("sign unauthorized pin");
    assert!(authority.submit(unauthorized_pin).is_err());
    let pin = EventBuilder::new(Kind::Custom(40_004), "pinned")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("pin channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("pin target"),
        ])
        .sign_with_keys(&owner)
        .expect("sign pin");
    authority.submit(pin.clone()).expect("pin message");
    assert_eq!(
        authority
            .query_for_actor(
                &member.public_key().to_hex(),
                &[json!({"kinds": [40004], "#e": [message.id.to_hex()]})]
            )
            .expect("member-visible pin"),
        vec![pin]
    );

    let bookmark = EventBuilder::new(Kind::Custom(40_005), "bookmarked")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("bookmark channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("bookmark target"),
        ])
        .sign_with_keys(&member)
        .expect("sign bookmark");
    authority
        .submit(bookmark.clone())
        .expect("bookmark message");
    assert!(authority
        .query_for_actor(
            &owner.public_key().to_hex(),
            &[json!({"kinds": [40005], "#e": [message.id.to_hex()]})]
        )
        .expect("owner bookmark isolation")
        .is_empty());
    assert_eq!(
        authority
            .query_for_actor(
                &member.public_key().to_hex(),
                &[json!({"kinds": [40005], "#e": [message.id.to_hex()]})]
            )
            .expect("private bookmark"),
        vec![bookmark.clone()]
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen content authority");
    assert_eq!(
        reopened
            .query_for_actor(
                &member.public_key().to_hex(),
                &[json!({"kinds": [40005], "#e": [message.id.to_hex()]})]
            )
            .expect("durable private bookmark"),
        vec![bookmark]
    );
}

#[test]
fn forum_post_flat_reply_vote_search_and_permissions_survive_restart() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Forum owner");
    let forum_id = Uuid::new_v4().to_string();
    let create = EventBuilder::new(Kind::Custom(9_007), "")
        .tags([
            parse_tag(["h", &forum_id]).expect("Forum channel"),
            parse_tag(["name", "engineering-forum"]).expect("Forum name"),
            parse_tag(["channel_type", "forum"]).expect("Forum type"),
            parse_tag(["visibility", "private"]).expect("Forum visibility"),
        ])
        .sign_with_keys(&owner)
        .expect("sign Forum create");
    authority.submit(create).expect("create Forum");
    let post = EventBuilder::new(Kind::Custom(45_001), "Durable Forum proposal")
        .tags([parse_tag(["h", &forum_id]).expect("Forum post channel")])
        .custom_created_at(nostr::Timestamp::from(100))
        .sign_with_keys(&owner)
        .expect("sign Forum post");
    authority.submit(post.clone()).expect("publish Forum post");
    let reply = EventBuilder::new(Kind::Custom(45_003), "Flat Forum reply")
        .tags([
            parse_tag(["h", &forum_id]).expect("Forum reply channel"),
            parse_tag(["e", &post.id.to_hex(), "root"]).expect("Forum root"),
        ])
        .custom_created_at(nostr::Timestamp::from(101))
        .sign_with_keys(&owner)
        .expect("sign Forum reply");
    authority
        .submit(reply.clone())
        .expect("publish Forum reply");
    let vote = EventBuilder::new(Kind::Custom(45_002), "+")
        .tags([
            parse_tag(["h", &forum_id]).expect("Forum vote channel"),
            parse_tag(["e", &post.id.to_hex()]).expect("Forum vote target"),
        ])
        .custom_created_at(nostr::Timestamp::from(102))
        .sign_with_keys(&owner)
        .expect("sign Forum vote");
    authority.submit(vote.clone()).expect("publish Forum vote");

    let outsider = Keys::generate();
    authority
        .onboard_account(&outsider, "Forum outsider")
        .expect("onboard Forum outsider");
    let intrusion = EventBuilder::new(Kind::Custom(45_003), "Forbidden reply")
        .tags([
            parse_tag(["h", &forum_id]).expect("Forum channel"),
            parse_tag(["e", &post.id.to_hex(), "root"]).expect("Forum root"),
        ])
        .sign_with_keys(&outsider)
        .expect("sign Forum intrusion");
    assert!(authority.submit(intrusion).is_err());
    assert_eq!(
        authority
            .query(&[json!({
                "kinds": [45001, 45003],
                "#h": [&forum_id],
                "search": "Forum"
            })])
            .expect("Forum search"),
        vec![reply.clone(), post.clone()]
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen Forum authority");
    assert_eq!(
        reopened
            .query(&[json!({
                "kinds": [45001, 45002, 45003],
                "#h": [&forum_id]
            })])
            .expect("durable Forum"),
        vec![vote, reply, post]
    );
}

#[test]
fn pulse_uses_a_stable_timestamp_and_event_id_cursor_with_replies_and_reactions() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Pulse owner");
    let timestamp = nostr::Timestamp::from(500);
    let mut notes = ["Pulse alpha", "Pulse beta", "Pulse gamma"]
        .into_iter()
        .map(|content| {
            EventBuilder::new(Kind::Custom(1), content)
                .custom_created_at(timestamp)
                .sign_with_keys(&owner)
                .expect("sign Pulse note")
        })
        .collect::<Vec<_>>();
    for note in &notes {
        authority.submit(note.clone()).expect("publish Pulse note");
    }
    notes.sort_by_key(|note| std::cmp::Reverse(note.id.to_hex()));
    let first_page = authority
        .query(&[json!({"kinds": [1], "limit": 2})])
        .expect("first Pulse page");
    assert_eq!(first_page, notes[..2]);
    let cursor = first_page.last().expect("Pulse cursor");
    let second_page = authority
        .query(&[json!({
            "kinds": [1],
            "until": cursor.created_at.as_secs(),
            "before_id": cursor.id.to_hex(),
            "limit": 2
        })])
        .expect("second Pulse page");
    assert_eq!(second_page, notes[2..]);

    let reply = EventBuilder::new(Kind::Custom(1), "Pulse reply")
        .tags([parse_tag(["e", &notes[0].id.to_hex(), "root"]).expect("Pulse root")])
        .custom_created_at(nostr::Timestamp::from(501))
        .sign_with_keys(&owner)
        .expect("sign Pulse reply");
    authority
        .submit(reply.clone())
        .expect("publish Pulse reply");
    let reaction = EventBuilder::new(Kind::Custom(7), "🔥")
        .tags([parse_tag(["e", &notes[0].id.to_hex()]).expect("Pulse reaction target")])
        .custom_created_at(nostr::Timestamp::from(502))
        .sign_with_keys(&owner)
        .expect("sign Pulse reaction");
    authority
        .submit(reaction.clone())
        .expect("publish Pulse reaction");
    assert_eq!(
        authority
            .query(&[json!({"kinds": [1, 7], "#e": [notes[0].id.to_hex()]})])
            .expect("Pulse thread and reaction"),
        vec![reaction, reply]
    );
}

#[test]
fn message_edit_replaces_search_content_across_retract_restore_and_restart() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed search lifecycle owner");
    let message = EventBuilder::new(Kind::Custom(9), "obsolete searchable wording")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("message channel")])
        .custom_created_at(nostr::Timestamp::from(900))
        .sign_with_keys(&owner)
        .expect("sign searchable message");
    authority
        .submit(message.clone())
        .expect("publish searchable message");

    let edit = EventBuilder::new(Kind::Custom(40_003), "current searchable wording")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("edit channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("edit target"),
        ])
        .custom_created_at(nostr::Timestamp::from(901))
        .sign_with_keys(&owner)
        .expect("sign searchable edit");
    authority.submit(edit).expect("publish searchable edit");

    assert_eq!(
        authority
            .query(&[json!({"kinds": [9], "search": "current searchable wording"})])
            .expect("search edited wording"),
        vec![message.clone()]
    );
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "obsolete searchable wording"})])
        .expect("search obsolete wording")
        .is_empty());

    let retract = EventBuilder::new(Kind::Custom(5), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("retract channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("retract target"),
        ])
        .custom_created_at(nostr::Timestamp::from(902))
        .sign_with_keys(&owner)
        .expect("sign search retraction");
    authority
        .submit(retract)
        .expect("retract searchable message");
    assert!(authority
        .query(&[json!({"kinds": [9], "search": "current searchable wording"})])
        .expect("search retracted wording")
        .is_empty());

    let restore = EventBuilder::new(Kind::Custom(40_009), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("restore channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("restore target"),
        ])
        .custom_created_at(nostr::Timestamp::from(903))
        .sign_with_keys(&owner)
        .expect("sign search restoration");
    authority
        .submit(restore)
        .expect("restore searchable message");
    assert_eq!(
        authority
            .query(&[json!({"kinds": [9], "search": "current searchable wording"})])
            .expect("search restored wording"),
        vec![message.clone()]
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen searchable lifecycle authority");
    assert_eq!(
        reopened
            .query(&[json!({"kinds": [9], "search": "current searchable wording"})])
            .expect("search restored wording after restart"),
        vec![message]
    );
}

#[test]
fn message_retract_restore_edit_and_permanent_erase_are_audited() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed lifecycle owner");
    let author = Keys::generate();
    authority
        .onboard_account(&author, "Lifecycle author")
        .expect("onboard lifecycle author");
    let base_time = nostr::Timestamp::from(1_000);
    let message = EventBuilder::new(Kind::Custom(9), "erasable secret content")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("message channel")])
        .custom_created_at(base_time)
        .sign_with_keys(&author)
        .expect("sign lifecycle message");
    authority
        .submit(message.clone())
        .expect("publish lifecycle message");
    let retract = EventBuilder::new(Kind::Custom(5), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("retract channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("retract target"),
        ])
        .custom_created_at(nostr::Timestamp::from(1_001))
        .sign_with_keys(&author)
        .expect("sign retraction");
    authority.submit(retract).expect("retract message");
    let tombstones = authority
        .query(&[json!({
            "kinds": [40099],
            "#h": [GENERAL_CHANNEL_ID],
            "#e": [message.id.to_hex()]
        })])
        .expect("message tombstone");
    assert_eq!(tombstones.len(), 1);
    assert_eq!(
        serde_json::from_str::<Value>(&tombstones[0].content).expect("tombstone JSON")["type"],
        "message_deleted"
    );

    let blocked_edit = EventBuilder::new(Kind::Custom(40_003), "blocked edit")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("edit channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("edit target"),
        ])
        .custom_created_at(nostr::Timestamp::from(1_002))
        .sign_with_keys(&author)
        .expect("sign blocked edit");
    assert!(authority.submit(blocked_edit).is_err());

    let restore = EventBuilder::new(Kind::Custom(40_009), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("restore channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("restore target"),
        ])
        .custom_created_at(nostr::Timestamp::from(1_003))
        .sign_with_keys(&author)
        .expect("sign restoration");
    authority.submit(restore).expect("restore message");
    let edit = EventBuilder::new(Kind::Custom(40_003), "restored edit")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("edit channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("edit target"),
        ])
        .custom_created_at(nostr::Timestamp::from(1_004))
        .sign_with_keys(&author)
        .expect("sign restored edit");
    authority.submit(edit).expect("edit restored message");

    let erase = EventBuilder::new(Kind::Custom(40_010), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("erase channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("erase target"),
        ])
        .custom_created_at(nostr::Timestamp::from(1_005))
        .sign_with_keys(&author)
        .expect("sign permanent erase");
    authority.submit(erase).expect("erase message permanently");
    assert!(authority
        .query(&[json!({"ids": [message.id.to_hex()]})])
        .expect("erased message query")
        .is_empty());
    assert!(authority
        .query(&[json!({"search": "erasable secret content"})])
        .expect("erased message FTS query")
        .is_empty());
    assert!(authority
        .audit_entries(100)
        .expect("lifecycle audit")
        .iter()
        .any(|entry| entry.action == "message.erased" && entry.target_id == message.id.to_hex()));
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen lifecycle authority");
    assert!(reopened
        .query(&[json!({"ids": [message.id.to_hex()]})])
        .expect("durable erased message query")
        .is_empty());
}

#[test]
fn nip29_delete_command_retracts_content_through_the_same_audited_lifecycle() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed deletion moderator");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Deletion target")
        .expect("onboard deletion target");
    let message = EventBuilder::new(Kind::Custom(9), "moderated message")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("message channel")])
        .sign_with_keys(&member)
        .expect("sign moderated message");
    authority
        .submit(message.clone())
        .expect("publish moderated message");
    let deletion = EventBuilder::new(Kind::Custom(9_005), "")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("deletion channel"),
            parse_tag(["e", &message.id.to_hex()]).expect("deletion target"),
        ])
        .sign_with_keys(&owner)
        .expect("sign NIP-29 deletion");
    authority
        .submit(deletion.clone())
        .expect("execute NIP-29 deletion");

    let tombstones = authority
        .query(&[json!({
            "kinds": [40099],
            "#e": [message.id.to_hex()],
            "limit": 1
        })])
        .expect("read authoritative deletion tombstone");
    assert_eq!(tombstones.len(), 1);
    assert!(authority
        .audit_entries(100)
        .expect("read deletion audit")
        .iter()
        .any(|entry| {
            entry.action == "message.retracted" && entry.target_id == message.id.to_hex()
        }));
    assert_eq!(
        authority
            .query(&[json!({"ids": [deletion.id.to_hex()]})])
            .expect("read persisted deletion command"),
        vec![deletion]
    );
}

#[tokio::test]
async fn workspace_icon_command_is_authorized_and_persisted_in_nip11() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Workspace owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Workspace member")
        .expect("onboard Workspace member");
    let icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    let forbidden = EventBuilder::new(Kind::Custom(9_033), "")
        .tags([parse_tag(["icon", icon]).expect("member icon tag")])
        .sign_with_keys(&member)
        .expect("sign member Workspace icon command");
    assert!(authority.submit(forbidden).is_err());

    let command = EventBuilder::new(Kind::Custom(9_033), "")
        .tags([parse_tag(["icon", icon]).expect("owner icon tag")])
        .sign_with_keys(&owner)
        .expect("sign owner Workspace icon command");
    authority.submit(command).expect("set Workspace icon");
    let info = authority_router(Arc::new(authority))
        .oneshot(
            Request::builder()
                .uri("/info")
                .body(Body::empty())
                .expect("NIP-11 request"),
        )
        .await
        .expect("NIP-11 response");
    let body = to_bytes(info.into_body(), 1024 * 1024)
        .await
        .expect("NIP-11 body");
    assert_eq!(
        serde_json::from_slice::<Value>(&body).expect("NIP-11 JSON")["icon"],
        icon
    );

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen Workspace authority");
    assert_eq!(
        reopened.workspace_icon().expect("persisted Workspace icon"),
        Some(icon.to_string())
    );
}

#[test]
fn moderation_resolution_delete_creates_the_authoritative_public_tombstone() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed moderation owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Reported member")
        .expect("onboard reported member");
    let target = EventBuilder::new(Kind::Custom(9), "reported content")
        .tags([parse_tag(["h", GENERAL_CHANNEL_ID]).expect("target channel")])
        .sign_with_keys(&member)
        .expect("sign reported message");
    authority
        .submit(target.clone())
        .expect("publish reported message");
    let report = EventBuilder::new(Kind::Custom(1_984), "private evidence")
        .tags([
            parse_tag(["p", &member.public_key().to_hex()]).expect("reported author"),
            parse_tag(["e", &target.id.to_hex(), "spam"]).expect("reported event"),
        ])
        .sign_with_keys(&owner)
        .expect("sign report");
    authority.submit(report.clone()).expect("file report");
    let resolution = EventBuilder::new(Kind::Custom(9_044), "")
        .tags([
            parse_tag(["report", &report.id.to_hex()]).expect("report reference"),
            parse_tag(["status", "resolved"]).expect("resolution status"),
            parse_tag(["action", "delete"]).expect("resolution action"),
            parse_tag(["reason", "Workspace spam policy"]).expect("public reason"),
        ])
        .sign_with_keys(&owner)
        .expect("sign report resolution");
    authority
        .submit(resolution)
        .expect("resolve report with delete");
    let tombstone = authority
        .query(&[json!({
            "kinds": [40099],
            "#e": [target.id.to_hex()],
            "limit": 1
        })])
        .expect("moderation tombstone");
    assert_eq!(tombstone.len(), 1);
    let payload: Value =
        serde_json::from_str(&tombstone[0].content).expect("moderation tombstone JSON");
    assert_eq!(payload["type"], "message_deleted");
    assert_eq!(payload["public_reason"], "Workspace spam policy");
    let blocked_edit = EventBuilder::new(Kind::Custom(40_003), "cannot edit")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("edit channel"),
            parse_tag(["e", &target.id.to_hex()]).expect("edit target"),
        ])
        .sign_with_keys(&member)
        .expect("sign edit after moderation");
    assert!(authority.submit(blocked_edit).is_err());
}
