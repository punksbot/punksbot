use super::*;

#[test]
fn local_accounts_switch_with_generation_and_merge_to_a_durable_alias() {
    let (directory, authority, _owner) = authority();
    let first_keys = Keys::generate();
    let second_keys = Keys::generate();
    let first_id = Uuid::new_v4().to_string();
    let second_id = Uuid::new_v4().to_string();
    authority
        .register_account(&first_id, &first_keys.public_key().to_hex(), "Alice")
        .expect("register first account");
    authority
        .register_account(&second_id, &second_keys.public_key().to_hex(), "Bob")
        .expect("register second account");

    let first_generation = authority
        .activate_account(&first_id, Some(0))
        .expect("activate first account");
    assert_eq!(first_generation, 1);
    let second_generation = authority
        .activate_account(&second_id, Some(first_generation))
        .expect("activate second account");
    assert_eq!(second_generation, 2);
    assert!(authority.activate_account(&first_id, Some(0)).is_err());

    authority
        .merge_accounts(&second_id, &first_id)
        .expect("merge second into first");
    let accounts = authority.list_accounts().expect("list accounts");
    assert_eq!(accounts.len(), 2);
    let merged = accounts
        .iter()
        .find(|account| account.id == second_id)
        .expect("merged account");
    assert_eq!(merged.merged_into.as_deref(), Some(first_id.as_str()));
    assert_eq!(
        authority
            .resolve_account_alias(&second_id)
            .expect("resolve merged alias"),
        first_id
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen authority");
    assert_eq!(
        reopened
            .resolve_account_alias(&second_id)
            .expect("durable alias"),
        first_id
    );
}

#[test]
fn local_accounts_can_be_renamed_and_only_inactive_canonical_accounts_deleted() {
    let (_directory, authority, _owner) = authority();
    let active_id = Uuid::new_v4().to_string();
    let removable_id = Uuid::new_v4().to_string();
    authority
        .register_account(
            &active_id,
            &Keys::generate().public_key().to_hex(),
            "Active Punk",
        )
        .expect("register active account");
    authority
        .register_account(
            &removable_id,
            &Keys::generate().public_key().to_hex(),
            "Old name",
        )
        .expect("register removable account");
    let generation = authority
        .activate_account(&active_id, Some(0))
        .expect("activate account");
    authority
        .rename_account(&removable_id, "Renamed Punk", generation)
        .expect("rename inactive account");
    assert_eq!(
        authority
            .list_accounts()
            .expect("list renamed accounts")
            .into_iter()
            .find(|account| account.id == removable_id)
            .expect("renamed account")
            .display_name,
        "Renamed Punk"
    );
    assert!(authority
        .rename_account(&removable_id, "Stale rename", generation - 1)
        .is_err());
    assert!(authority.delete_account(&active_id, generation).is_err());
    authority
        .delete_account(&removable_id, generation)
        .expect("delete inactive account");
    assert_eq!(
        authority
            .list_accounts()
            .expect("list after deletion")
            .len(),
        1
    );
    assert!(authority
        .audit_entries(100)
        .expect("account lifecycle audit")
        .iter()
        .any(|entry| entry.action == "account.deleted" && entry.target_id == removable_id));
}
