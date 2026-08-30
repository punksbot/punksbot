use super::*;

#[test]
fn identity_archive_and_restore_publish_durable_authority_snapshots() {
    let (directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed archive owner");
    let agent = Keys::generate();
    authority
        .onboard_account(&agent, "Archivable Agent")
        .expect("onboard archivable agent");
    let agent_pubkey = agent.public_key().to_hex();
    let archive = EventBuilder::new(Kind::Custom(9_035), "Agent retired")
        .tags([
            parse_tag(["-"]).expect("protected archive"),
            parse_tag(["p", &agent_pubkey]).expect("archive target"),
            parse_tag(["reason", "retired"]).expect("archive reason"),
        ])
        .allow_self_tagging()
        .sign_with_keys(&agent)
        .expect("sign self archive");
    authority.submit(archive.clone()).expect("archive identity");
    let archived = authority
        .query(&[json!({
            "kinds": [13535],
            "authors": [authority.signer.public_key().to_hex()],
            "limit": 1
        })])
        .expect("read archive snapshot");
    assert_eq!(archived.len(), 1);
    assert!(archived[0]
        .tags
        .iter()
        .any(|tag| tag.as_slice() == ["p", agent_pubkey.as_str()]));
    assert_eq!(
        authority
            .query(&[json!({"kinds": [8002], "#p": [&agent_pubkey], "limit": 1})])
            .expect("read archive delta")
            .len(),
        1
    );
    drop(authority);

    let reopened = LocalAuthority::open(
        &directory.path().join("authority.sqlite3"),
        Keys::generate(),
    )
    .expect("reopen archived authority");
    assert!(reopened
        .query(&[json!({"kinds": [13535], "#p": [&agent_pubkey], "limit": 1})])
        .expect("durable archive state")
        .first()
        .is_some());
    let restore = EventBuilder::new(Kind::Custom(9_036), "")
        .tags([
            parse_tag(["-"]).expect("protected restore"),
            parse_tag(["p", &agent_pubkey]).expect("restore target"),
        ])
        .sign_with_keys(&owner)
        .expect("sign admin restore");
    reopened.submit(restore).expect("restore identity");
    let snapshot = reopened
        .query(&[json!({"kinds": [13535], "limit": 1})])
        .expect("read restored snapshot");
    assert_eq!(snapshot.len(), 1);
    assert!(!snapshot[0]
        .tags
        .iter()
        .any(|tag| tag.as_slice().first().map(String::as_str) == Some("p")));
}
