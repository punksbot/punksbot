use nostr::{EventBuilder, Keys, Kind};
use serde_json::json;
use std::sync::Arc;
use tower::ServiceExt;

use super::http::authority_hub_router;
use super::workspace_hub::LocalAuthorityHub;

#[test]
fn additional_workspace_is_event_media_and_git_isolated_after_restart() {
    let directory = tempfile::tempdir().expect("temporary authority directory");
    let owner = Keys::generate();
    let hub = LocalAuthorityHub::open(directory.path(), owner.clone()).expect("open hub");
    let workspace = hub
        .create_workspace("Research Lab", &owner)
        .expect("create workspace");

    let primary = hub.primary();
    let research = hub
        .authority(&workspace.id)
        .expect("resolve research workspace");
    let primary_message = EventBuilder::new(Kind::TextNote, "primary only")
        .sign_with_keys(&owner)
        .expect("sign primary message");
    primary.submit(primary_message).expect("publish to primary");
    let research_message = EventBuilder::new(Kind::TextNote, "research only")
        .sign_with_keys(&owner)
        .expect("sign research message");
    research
        .submit(research_message)
        .expect("publish to research");

    assert_eq!(
        primary
            .query(&[json!({"kinds": [1], "search": "primary"})])
            .expect("query primary")
            .len(),
        1
    );
    assert!(primary
        .query(&[json!({"kinds": [1], "search": "research"})])
        .expect("query primary isolation")
        .is_empty());
    assert_eq!(
        research
            .query(&[json!({"kinds": [1], "search": "research"})])
            .expect("query research")
            .len(),
        1
    );
    assert!(research
        .query(&[json!({"kinds": [1], "search": "primary"})])
        .expect("query research isolation")
        .is_empty());
    assert_ne!(primary.media_dir.as_path(), research.media_dir.as_path());
    assert_ne!(primary.git_dir.as_path(), research.git_dir.as_path());

    drop(research);
    drop(primary);
    drop(hub);
    let reopened = LocalAuthorityHub::open(directory.path(), owner).expect("reopen hub");
    let records = reopened.list_workspaces().expect("list workspaces");
    assert_eq!(records.len(), 2);
    let research = reopened
        .authority(&workspace.id)
        .expect("reopen research workspace");
    assert_eq!(
        research
            .query(&[json!({"kinds": [1], "search": "research"})])
            .expect("query reopened research")
            .len(),
        1
    );
}

#[test]
fn workspace_metadata_lifecycle_is_durable_and_primary_cannot_be_archived() {
    let directory = tempfile::tempdir().expect("temporary authority directory");
    let owner = Keys::generate();
    let hub = LocalAuthorityHub::open(directory.path(), owner.clone()).expect("open hub");
    let workspace = hub
        .create_workspace("Studio", &owner)
        .expect("create workspace");
    hub.onboard_account(&owner, "Owner Punk")
        .expect("idempotent owner onboarding");
    assert_eq!(
        hub.authority(&workspace.id)
            .expect("workspace authority")
            .channel_members(super::GENERAL_CHANNEL_ID)
            .expect("general members")
            .into_iter()
            .find(|(pubkey, _)| pubkey == &owner.public_key().to_hex())
            .map(|(_, role)| role)
            .as_deref(),
        Some("owner")
    );

    let renamed = hub
        .rename_workspace(&workspace.id, "Punks Studio")
        .expect("rename workspace");
    assert_eq!(renamed.name, "Punks Studio");
    let archived = hub
        .set_workspace_archived(&workspace.id, true)
        .expect("archive workspace");
    assert!(archived.archived);
    assert!(hub
        .set_workspace_archived(LocalAuthorityHub::PRIMARY_ID, true)
        .expect_err("primary archive must fail")
        .contains("primary"));

    drop(hub);
    let reopened = LocalAuthorityHub::open(directory.path(), owner).expect("reopen hub");
    let record = reopened
        .list_workspaces()
        .expect("list workspaces")
        .into_iter()
        .find(|record| record.id == workspace.id)
        .expect("persisted workspace");
    assert_eq!(record.name, "Punks Studio");
    assert!(record.archived);
}

#[tokio::test]
async fn loopback_host_selects_the_workspace_authority_and_rejects_unknown_hosts() {
    let directory = tempfile::tempdir().expect("temporary authority directory");
    let owner = Keys::generate();
    let hub = Arc::new(LocalAuthorityHub::open(directory.path(), owner.clone()).expect("open hub"));
    let workspace = hub
        .create_workspace("Isolated Host", &owner)
        .expect("create workspace");
    let router = authority_hub_router(Arc::clone(&hub));

    let primary = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/")
                .header("host", "127.0.0.1:18787")
                .body(axum::body::Body::empty())
                .expect("primary request"),
        )
        .await
        .expect("primary response");
    let primary_body = axum::body::to_bytes(primary.into_body(), usize::MAX)
        .await
        .expect("primary body");
    let primary_info: serde_json::Value =
        serde_json::from_slice(&primary_body).expect("primary info");

    let isolated = router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/")
                .header("host", format!("{}.localhost:18787", workspace.id))
                .body(axum::body::Body::empty())
                .expect("isolated request"),
        )
        .await
        .expect("isolated response");
    let isolated_body = axum::body::to_bytes(isolated.into_body(), usize::MAX)
        .await
        .expect("isolated body");
    let isolated_info: serde_json::Value =
        serde_json::from_slice(&isolated_body).expect("isolated info");
    assert_ne!(primary_info["self"], isolated_info["self"]);

    let rejected = router
        .oneshot(
            axum::http::Request::builder()
                .uri("/")
                .header("host", "not-punks.example:18787")
                .body(axum::body::Body::empty())
                .expect("foreign host request"),
        )
        .await
        .expect("foreign host response");
    assert_eq!(
        rejected.status(),
        axum::http::StatusCode::MISDIRECTED_REQUEST
    );
}
