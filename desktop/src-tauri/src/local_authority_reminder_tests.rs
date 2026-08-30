use super::*;

#[test]
fn reminder_delivery_lease_survives_restart_and_retries_after_a_crash() {
    let directory = tempfile::tempdir().expect("reminder authority directory");
    let database_path = directory.path().join("authority.sqlite3");
    let owner = Keys::generate();
    let authority = LocalAuthority::open(&database_path, owner.clone()).expect("open authority");
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed reminder owner");
    let now = chrono::Utc::now().timestamp();
    authority
        .set_notification_preferences(&owner.public_key().to_hex(), false, false, now)
        .expect("disable reminder notifications");
    let reminder = EventBuilder::new(Kind::Custom(30_300), "encrypted-reminder")
        .tags([
            parse_tag(["d", "persistent-reminder"]).expect("reminder id"),
            parse_tag(["not_before", &(now - 5).to_string()]).expect("reminder due time"),
        ])
        .sign_with_keys(&owner)
        .expect("sign reminder");
    authority.submit(reminder.clone()).expect("submit reminder");
    assert!(authority
        .claim_due_reminders(now, 86_400, 60)
        .expect("respect disabled reminder notifications")
        .is_empty());
    authority
        .set_notification_preferences(&owner.public_key().to_hex(), true, true, now)
        .expect("enable reminder notifications");

    let claimed = authority
        .claim_due_reminders(now, 86_400, 60)
        .expect("claim due reminder");
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].account_pubkey, owner.public_key().to_hex());
    assert_eq!(claimed[0].reminder_id, "persistent-reminder");
    assert_eq!(claimed[0].event_id, reminder.id.to_hex());
    drop(authority);

    let reopened = LocalAuthority::open(&database_path, owner).expect("reopen authority");
    assert!(reopened
        .claim_due_reminders(now + 30, 86_400, 60)
        .expect("respect active delivery lease")
        .is_empty());
    let retried = reopened
        .claim_due_reminders(now + 61, 86_400, 60)
        .expect("retry stale delivery lease");
    assert_eq!(retried.len(), 1);
    reopened
        .ack_reminder_delivery(&retried[0], now + 61)
        .expect("acknowledge reminder delivery");
    drop(reopened);

    let final_authority =
        LocalAuthority::open(&database_path, Keys::generate()).expect("reopen delivered authority");
    assert!(final_authority
        .claim_due_reminders(now + 120, 86_400, 60)
        .expect("do not redeliver acknowledged reminder")
        .is_empty());
}

#[test]
fn replacing_a_reminder_reschedules_or_cancels_its_native_delivery() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed reminder owner");
    let now = chrono::Utc::now().timestamp();
    authority
        .set_notification_preferences(&owner.public_key().to_hex(), true, true, now)
        .expect("enable reminder notifications");
    let initial = EventBuilder::new(Kind::Custom(30_300), "encrypted-initial")
        .tags([
            parse_tag(["d", "mutable-reminder"]).expect("reminder id"),
            parse_tag(["not_before", &(now - 1).to_string()]).expect("initial due time"),
        ])
        .custom_created_at(nostr::Timestamp::from(now as u64))
        .sign_with_keys(&owner)
        .expect("sign initial reminder");
    authority.submit(initial).expect("submit initial reminder");

    let snoozed = EventBuilder::new(Kind::Custom(30_300), "encrypted-snoozed")
        .tags([
            parse_tag(["d", "mutable-reminder"]).expect("reminder id"),
            parse_tag(["not_before", &(now + 300).to_string()]).expect("snoozed due time"),
        ])
        .custom_created_at(nostr::Timestamp::from((now + 1) as u64))
        .sign_with_keys(&owner)
        .expect("sign snoozed reminder");
    authority.submit(snoozed).expect("snooze reminder");
    assert!(authority
        .claim_due_reminders(now, 86_400, 60)
        .expect("snoozed reminder is not due")
        .is_empty());
    assert_eq!(
        authority
            .claim_due_reminders(now + 300, 86_400, 60)
            .expect("claim snoozed reminder")
            .len(),
        1
    );

    let completed = EventBuilder::new(Kind::Custom(30_300), "encrypted-done")
        .tags([parse_tag(["d", "mutable-reminder"]).expect("reminder id")])
        .custom_created_at(nostr::Timestamp::from((now + 2) as u64))
        .sign_with_keys(&owner)
        .expect("sign completed reminder");
    authority.submit(completed).expect("complete reminder");
    assert!(authority
        .claim_due_reminders(now + 400, 86_400, 60)
        .expect("completed reminder stays cancelled")
        .is_empty());
}
