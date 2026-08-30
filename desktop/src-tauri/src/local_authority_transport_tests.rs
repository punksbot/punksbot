#[test]
fn local_huddle_hub_assigns_peers_and_prefixes_forwarded_opus_frames() {
    let hub = super::huddles::LocalHuddleHub::default();
    let first = hub
        .join("channel", "a".repeat(64))
        .expect("first huddle peer");
    let mut second = hub
        .join("channel", "b".repeat(64))
        .expect("second huddle peer");
    assert_ne!(first.peer_index, second.peer_index);
    assert_eq!(second.peers.len(), 2);

    hub.broadcast_audio("channel", first.peer_id, &[1, 2, 3])
        .expect("broadcast audio");
    let forwarded = second.receiver.try_recv().expect("forwarded frame");
    assert_eq!(forwarded.sender_peer_id, first.peer_id);
    assert_eq!(forwarded.payload, vec![first.peer_index, 1, 2, 3]);
    hub.leave("channel", first.peer_id).expect("leave huddle");
    assert_eq!(hub.roster("channel").expect("remaining roster").len(), 1);
}

#[test]
fn channel_window_query_replays_a_persisted_message_with_authoritative_bounds() {
    let directory = tempfile::tempdir().expect("local authority directory");
    let database_path = directory.path().join("authority.sqlite3");
    let owner = Keys::generate();
    let authority = LocalAuthority::open(&database_path, owner.clone()).expect("open authority");
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let message = EventBuilder::new(Kind::Custom(9), "persisted native message")
        .tag(parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Conversation tag"))
        .sign_with_keys(&owner)
        .expect("sign message");
    authority.submit(message).expect("publish message");
    drop(authority);

    let reopened = LocalAuthority::open(&database_path, owner.clone()).expect("reopen authority");
    let events = reopened
        .query_for_actor(
            &owner.public_key().to_hex(),
            &[json!({
                "kinds": [9, 40002, 40008, 40099, 43001, 43002, 43003, 43004, 43005, 43006, 48100],
                "#h": [GENERAL_CHANNEL_ID],
                "limit": 50,
                "top_level": true,
                "include_summaries": true,
                "include_aux": true
            })],
        )
        .expect("query persisted channel window");

    assert!(events
        .iter()
        .any(|event| event.kind == Kind::Custom(9) && event.content == "persisted native message"));
    let bounds = events
        .iter()
        .filter(|event| event.kind == Kind::Custom(39_006))
        .collect::<Vec<_>>();
    assert_eq!(bounds.len(), 1, "one bounds event closes every window");
    let expected_bounds_id = format!("{GENERAL_CHANNEL_ID}:head");
    assert_eq!(
        tag_value(bounds[0], "d").as_deref(),
        Some(expected_bounds_id.as_str())
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&bounds[0].content).expect("bounds payload"),
        json!({"has_more": false, "next_cursor": null})
    );
}

#[test]
fn channel_window_closes_over_replies_reactions_and_thread_summary() {
    let directory = tempfile::tempdir().expect("local authority directory");
    let owner = Keys::generate();
    let authority =
        LocalAuthority::open(&directory.path().join("authority.sqlite3"), owner.clone())
            .expect("open authority");
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed owner");
    let root = EventBuilder::new(Kind::Custom(9), "thread root")
        .tag(parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Conversation tag"))
        .sign_with_keys(&owner)
        .expect("sign root");
    authority.submit(root.clone()).expect("publish root");
    let root_id = root.id.to_hex();
    let reply = EventBuilder::new(Kind::Custom(9), "thread reply")
        .tags([
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("Conversation tag"),
            parse_tag(["e", &root_id, "", "root"]).expect("root tag"),
            parse_tag(["e", &root_id, "", "reply"]).expect("reply tag"),
        ])
        .sign_with_keys(&owner)
        .expect("sign reply");
    let reply_created_at = reply.created_at.as_secs();
    authority.submit(reply).expect("publish reply");
    let reaction = EventBuilder::new(Kind::Custom(7), "✅")
        .tag(parse_tag(["e", &root_id]).expect("reaction target"))
        .sign_with_keys(&owner)
        .expect("sign reaction");
    authority
        .submit(reaction.clone())
        .expect("publish reaction");

    let events = authority
        .query_for_actor(
            &owner.public_key().to_hex(),
            &[json!({
                "kinds": [9, 40002, 40008, 40099, 43001, 43002, 43003, 43004, 43005, 43006, 48100],
                "#h": [GENERAL_CHANNEL_ID],
                "limit": 50,
                "top_level": true,
                "include_summaries": true,
                "include_aux": true
            })],
        )
        .expect("query channel window closure");

    assert!(events.iter().any(|event| event.id == root.id));
    assert!(!events.iter().any(|event| event.content == "thread reply"));
    assert!(events.iter().any(|event| event.id == reaction.id));
    let summary = events
        .iter()
        .find(|event| event.kind == Kind::Custom(39_005))
        .expect("thread summary");
    assert_eq!(tag_value(summary, "e").as_deref(), Some(root_id.as_str()));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&summary.content).expect("summary payload"),
        json!({
            "reply_count": 1,
            "descendant_count": 1,
            "last_reply_at": reply_created_at,
            "participants": [owner.public_key().to_hex()]
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn huddle_v2_relays_binary_frames_between_two_real_member_sockets() {
    use futures_util::{SinkExt, StreamExt};
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Huddle owner");
    let participant = Keys::generate();
    authority
        .onboard_account(&participant, "Huddle participant")
        .expect("onboard Huddle participant");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind Huddle proof server");
    let address = listener.local_addr().expect("Huddle proof address");
    let server =
        tokio::spawn(
            async move { axum::serve(listener, authority_router(Arc::new(authority))).await },
        );
    let url = format!("ws://{address}/huddle/{GENERAL_CHANNEL_ID}/audio");
    let (mut first, first_joined) = connect_huddle(&url, &owner).await;
    let (mut second, second_joined) = connect_huddle(&url, &participant).await;
    assert_eq!(first_joined["type"], "joined");
    assert_eq!(second_joined["type"], "joined");
    assert_ne!(first_joined["peer_index"], second_joined["peer_index"]);

    second
        .send(tokio_tungstenite::tungstenite::Message::Binary(
            vec![1, 2, 3, 4].into(),
        ))
        .await
        .expect("send Huddle Opus frame");
    let forwarded = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            match first.next().await {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(frame))) => break frame,
                Some(Ok(_)) => continue,
                other => panic!("Huddle socket ended before audio: {other:?}"),
            }
        }
    })
    .await
    .expect("Huddle audio timeout");
    assert_eq!(
        forwarded[0],
        second_joined["peer_index"].as_u64().unwrap() as u8
    );
    assert_eq!(&forwarded[1..], &[1, 2, 3, 4]);

    second
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({"type": "leave"}).to_string().into(),
        ))
        .await
        .expect("leave Huddle");
    let _ = first.close(None).await;
    server.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repository_announcement_creates_a_real_bare_repo_and_serves_smart_http() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed Git owner");
    let owner_pubkey = owner.public_key().to_hex();
    let repository = "local-proof";
    let announcement = EventBuilder::new(Kind::Custom(30_617), "")
        .tags([
            parse_tag(["d", repository]).expect("repository id"),
            parse_tag(["name", repository]).expect("repository name"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("repository Conversation"),
        ])
        .sign_with_keys(&owner)
        .expect("sign repository announcement");
    authority
        .submit(announcement)
        .expect("announce local repository");
    let repository_path = authority
        .git_dir
        .join(&owner_pubkey)
        .join(format!("{repository}.git"));
    let bare = std::process::Command::new("git")
        .args(["--git-dir"])
        .arg(&repository_path)
        .args(["rev-parse", "--is-bare-repository"])
        .output()
        .expect("inspect bare repository");
    assert!(bare.status.success());
    assert_eq!(String::from_utf8_lossy(&bare.stdout).trim(), "true");

    let path = format!("/git/{owner_pubkey}/{repository}/info/refs?service=git-upload-pack");
    let authority = Arc::new(authority);
    let response = authority_router(Arc::clone(&authority))
        .oneshot(
            Request::builder()
                .uri(path)
                .header("host", "127.0.0.1:18787")
                .header(
                    "authorization",
                    git_nip98_header(&owner, "127.0.0.1:18787", &owner_pubkey, repository),
                )
                .body(Body::empty())
                .expect("Git smart HTTP request"),
        )
        .await
        .expect("Git smart HTTP response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "application/x-git-upload-pack-advertisement"
    );
    let body = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("Git advertisement body");
    assert!(body
        .windows(b"git-upload-pack".len())
        .any(|window| window == b"git-upload-pack"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind Git proof server");
    let address = listener.local_addr().expect("Git proof address");
    let server = tokio::spawn(async move {
        axum::serve(listener, authority_router(Arc::clone(&authority))).await
    });
    let checkout = tempfile::tempdir().expect("Git proof checkout parent");
    let checkout_path = checkout.path().join("clone");
    let repository_url = format!("http://{address}/git/{owner_pubkey}/{repository}");
    let auth_config = format!(
        "http.extraHeader=Authorization: {}",
        git_nip98_header(&owner, &address.to_string(), &owner_pubkey, repository)
    );
    let clone = std::process::Command::new("git")
        .args(["-c", &auth_config, "clone", "--", &repository_url])
        .arg(&checkout_path)
        .output()
        .expect("clone local Git repository");
    assert!(
        clone.status.success(),
        "clone failed: {}",
        String::from_utf8_lossy(&clone.stderr)
    );
    std::fs::write(checkout_path.join("README.md"), "# Local proof\n")
        .expect("write Git proof file");
    for args in [
        vec!["config", "user.name", "Punks Local"],
        vec!["config", "user.email", "punks@localhost"],
        vec!["add", "README.md"],
        vec!["commit", "-m", "local proof"],
    ] {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&checkout_path)
            .output()
            .expect("run local Git proof command");
        assert!(
            output.status.success(),
            "Git proof command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let push = std::process::Command::new("git")
        .args(["-c", &auth_config, "push", "origin", "HEAD:refs/heads/main"])
        .current_dir(&checkout_path)
        .output()
        .expect("push local Git proof commit");
    assert!(
        push.status.success(),
        "push failed: {}",
        String::from_utf8_lossy(&push.stderr)
    );
    let committed = std::process::Command::new("git")
        .args(["--git-dir"])
        .arg(&repository_path)
        .args(["rev-parse", "refs/heads/main"])
        .output()
        .expect("read pushed local Git ref");
    assert!(committed.status.success());
    assert_eq!(String::from_utf8_lossy(&committed.stdout).trim().len(), 40);
    server.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn git_smart_http_allows_member_feature_push_but_protects_main() {
    let (_directory, authority, owner) = authority();
    authority
        .seed_minimum_authorities(&owner)
        .expect("seed protected Git owner");
    let member = Keys::generate();
    authority
        .onboard_account(&member, "Git member")
        .expect("onboard Git member");
    let owner_pubkey = owner.public_key().to_hex();
    let repository = "protected-proof";
    let announcement = EventBuilder::new(Kind::Custom(30_617), "")
        .tags([
            parse_tag(["d", repository]).expect("repository id"),
            parse_tag(["name", repository]).expect("repository name"),
            parse_tag(["h", GENERAL_CHANNEL_ID]).expect("repository Conversation"),
            parse_tag([
                "punks-protect",
                "refs/heads/main",
                "push:admin",
                "no-force-push",
                "no-delete",
            ])
            .expect("main protection"),
        ])
        .sign_with_keys(&owner)
        .expect("sign protected repository announcement");
    authority
        .submit(announcement)
        .expect("announce protected local repository");
    let repository_path = authority
        .git_dir
        .join(&owner_pubkey)
        .join(format!("{repository}.git"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind protected Git proof server");
    let address = listener.local_addr().expect("protected Git proof address");
    let authority = Arc::new(authority);
    let server = tokio::spawn(async move {
        axum::serve(listener, authority_router(Arc::clone(&authority))).await
    });
    let repository_url = format!("http://{address}/git/{owner_pubkey}/{repository}");
    let owner_auth = format!(
        "http.extraHeader=Authorization: {}",
        git_nip98_header(&owner, &address.to_string(), &owner_pubkey, repository)
    );
    let member_auth = format!(
        "http.extraHeader=Authorization: {}",
        git_nip98_header(&member, &address.to_string(), &owner_pubkey, repository)
    );
    let checkouts = tempfile::tempdir().expect("protected Git checkout parent");
    let owner_checkout = checkouts.path().join("owner");
    git_command(
        checkouts.path(),
        &["-c", &owner_auth, "clone", "--", &repository_url],
        Some(&owner_checkout),
    );
    configure_git_identity(&owner_checkout, "Punks Owner");
    std::fs::write(owner_checkout.join("README.md"), "# Protected proof\n")
        .expect("write protected Git proof file");
    git_command(&owner_checkout, &["add", "README.md"], None);
    git_command(&owner_checkout, &["commit", "-m", "initial main"], None);
    git_command(
        &owner_checkout,
        &["-c", &owner_auth, "push", "origin", "HEAD:refs/heads/main"],
        None,
    );
    let main_before = git_stdout(
        checkouts.path(),
        &[
            "--git-dir",
            repository_path.to_str().expect("bare repository path"),
            "rev-parse",
            "refs/heads/main",
        ],
    );

    let member_checkout = checkouts.path().join("member");
    git_command(
        checkouts.path(),
        &["-c", &member_auth, "clone", "--", &repository_url],
        Some(&member_checkout),
    );
    configure_git_identity(&member_checkout, "Punks Member");
    git_command(
        &member_checkout,
        &["switch", "-c", "feature/member-proof"],
        None,
    );
    std::fs::write(member_checkout.join("member.txt"), "member branch\n")
        .expect("write member Git proof file");
    git_command(&member_checkout, &["add", "member.txt"], None);
    git_command(&member_checkout, &["commit", "-m", "member feature"], None);
    git_command(
        &member_checkout,
        &[
            "-c",
            &member_auth,
            "push",
            "origin",
            "HEAD:refs/heads/feature/member-proof",
        ],
        None,
    );
    let forbidden_main = std::process::Command::new("git")
        .args(["-c", &member_auth, "push", "origin", "HEAD:refs/heads/main"])
        .current_dir(&member_checkout)
        .output()
        .expect("attempt protected main push");
    assert!(!forbidden_main.status.success());
    assert!(String::from_utf8_lossy(&forbidden_main.stderr).contains("requires admin role"));
    assert_eq!(
        git_stdout(
            checkouts.path(),
            &[
                "--git-dir",
                repository_path.to_str().expect("bare repository path"),
                "rev-parse",
                "refs/heads/main",
            ],
        ),
        main_before
    );
    git_command(
        &owner_checkout,
        &["switch", "--orphan", "rewritten-main"],
        None,
    );
    std::fs::write(owner_checkout.join("README.md"), "# Rewritten history\n")
        .expect("write non-fast-forward proof file");
    git_command(&owner_checkout, &["add", "--all"], None);
    git_command(
        &owner_checkout,
        &["commit", "-m", "rewrite protected main"],
        None,
    );
    let forbidden_force = std::process::Command::new("git")
        .args([
            "-c",
            &owner_auth,
            "push",
            "--force",
            "origin",
            "HEAD:refs/heads/main",
        ])
        .current_dir(&owner_checkout)
        .output()
        .expect("attempt protected force-push");
    assert!(!forbidden_force.status.success());
    assert!(String::from_utf8_lossy(&forbidden_force.stderr)
        .contains("rejects non-fast-forward updates"));
    assert_eq!(
        git_stdout(
            checkouts.path(),
            &[
                "--git-dir",
                repository_path.to_str().expect("bare repository path"),
                "rev-parse",
                "refs/heads/main",
            ],
        ),
        main_before
    );
    assert_eq!(
        git_stdout(&member_checkout, &["rev-parse", "HEAD"]),
        git_stdout(
            checkouts.path(),
            &[
                "--git-dir",
                repository_path.to_str().expect("bare repository path"),
                "rev-parse",
                "refs/heads/feature/member-proof",
            ],
        )
    );
    server.abort();
}

fn configure_git_identity(repository: &std::path::Path, name: &str) {
    git_command(repository, &["config", "user.name", name], None);
    git_command(
        repository,
        &["config", "user.email", "punks@localhost"],
        None,
    );
}

fn git_command(
    current_dir: &std::path::Path,
    arguments: &[&str],
    created_path: Option<&std::path::Path>,
) {
    let mut command = std::process::Command::new("git");
    command.args(arguments).current_dir(current_dir);
    if let Some(created_path) = created_path {
        command.arg(created_path);
    }
    let output = command.output().expect("run Git proof command");
    assert!(
        output.status.success(),
        "Git proof command failed ({arguments:?}, {created_path:?}): {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(current_dir: &std::path::Path, arguments: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(arguments)
        .current_dir(current_dir)
        .output()
        .expect("read Git proof state");
    assert!(
        output.status.success(),
        "Git proof read failed ({arguments:?}): {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
use super::*;
