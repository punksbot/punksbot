use super::*;

#[test]
fn temporary_conversation_metadata_and_lifecycle_never_renew_the_deadline() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed temporary Conversation owner");
    let channel_id = Uuid::new_v4().to_string();
    let created_at = 1_700_000_000_u64;
    let create = EventBuilder::new(Kind::Custom(9_007), "")
        .tags([
            parse_tag(["h", &channel_id]).expect("temporary Conversation id"),
            parse_tag(["name", "fixed-deadline"]).expect("Conversation name"),
            parse_tag(["ttl", "60"]).expect("Conversation TTL"),
        ])
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(&owner)
        .expect("sign temporary Conversation create");
    authority.submit(create).expect("create Conversation");
    let initial_deadline = tag_value(
        &authority
            .channel_metadata(&channel_id)
            .expect("read Conversation")
            .expect("Conversation metadata"),
        "ttl_deadline",
    )
    .expect("initial deadline");

    for (offset, tags) in [
        (
            10,
            vec![
                parse_tag(["h", &channel_id]).expect("rename scope"),
                parse_tag(["name", "renamed"]).expect("renamed Conversation"),
            ],
        ),
        (
            20,
            vec![
                parse_tag(["h", &channel_id]).expect("archive scope"),
                parse_tag(["archived", "true"]).expect("archive flag"),
            ],
        ),
        (
            30,
            vec![
                parse_tag(["h", &channel_id]).expect("restore scope"),
                parse_tag(["archived", "false"]).expect("restore flag"),
            ],
        ),
    ] {
        let update = EventBuilder::new(Kind::Custom(9_002), "")
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(created_at + offset))
            .sign_with_keys(&owner)
            .expect("sign Conversation update");
        authority.submit(update).expect("update Conversation");
        let metadata = authority
            .channel_metadata(&channel_id)
            .expect("read updated Conversation")
            .expect("updated Conversation metadata");
        assert_eq!(
            tag_value(&metadata, "ttl_deadline").as_deref(),
            Some(initial_deadline.as_str())
        );
    }
}

#[test]
fn temporary_conversation_deadline_renews_and_archives_durably() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed temporary Conversation owner");
    let channel_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp();
    let create = EventBuilder::new(Kind::Custom(9_007), "")
        .tags([
            parse_tag(["h", &channel_id]).expect("temporary Conversation id"),
            parse_tag(["name", "temporary-proof"]).expect("temporary Conversation name"),
            parse_tag(["channel_type", "stream"]).expect("temporary Conversation type"),
            parse_tag(["visibility", "open"]).expect("temporary Conversation visibility"),
            parse_tag(["ttl", "60"]).expect("temporary Conversation TTL"),
        ])
        .custom_created_at(nostr::Timestamp::from(created_at as u64))
        .sign_with_keys(&owner)
        .expect("sign temporary Conversation create");
    authority
        .submit(create)
        .expect("create temporary Conversation");
    let first = authority
        .channel_metadata(&channel_id)
        .expect("read temporary Conversation")
        .expect("temporary Conversation metadata");
    assert_eq!(tag_value(&first, "ttl").as_deref(), Some("60"));
    let first_deadline = tag_value(&first, "ttl_deadline").expect("initial TTL deadline");

    let message = EventBuilder::new(Kind::Custom(9), "renew the temporary lease")
        .tags([parse_tag(["h", &channel_id]).expect("message Conversation")])
        .custom_created_at(nostr::Timestamp::from((created_at + 30) as u64))
        .sign_with_keys(&owner)
        .expect("sign temporary Conversation activity");
    authority
        .submit(message)
        .expect("publish temporary activity");
    let renewed = authority
        .channel_metadata(&channel_id)
        .expect("read renewed Conversation")
        .expect("renewed Conversation metadata");
    let renewed_deadline = tag_value(&renewed, "ttl_deadline").expect("renewed TTL deadline");
    assert!(renewed_deadline > first_deadline);
    assert_eq!(authority.run_due_channel_ttl(created_at + 89).unwrap(), 0);
    assert_eq!(authority.run_due_channel_ttl(created_at + 91).unwrap(), 1);
    let archived = authority
        .channel_metadata(&channel_id)
        .expect("read expired Conversation")
        .expect("expired Conversation metadata");
    assert_eq!(tag_value(&archived, "archived").as_deref(), Some("true"));
    assert_eq!(tag_value(&archived, "ttl").as_deref(), Some("60"));
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen temporary Conversation authority");
    let persisted = reopened
        .channel_metadata(&channel_id)
        .expect("read persisted expired Conversation")
        .expect("persisted expired Conversation metadata");
    assert_eq!(tag_value(&persisted, "archived").as_deref(), Some("true"));
    assert_eq!(reopened.run_due_channel_ttl(created_at + 200).unwrap(), 0);
}
