use std::sync::{Arc, Mutex as StdMutex};

use crate::PunkSearchInput;
use serde_json::{json, Value};

use super::{
    client_with, compatibility, prepare_account, session, workspaces, ClientFailure, FailureKind,
    ORIGIN, PUNK_ID, WORKSPACE_ID,
};

fn identity_compatibility() -> Value {
    let mut value = compatibility();
    value["capabilities"]
        .as_array_mut()
        .unwrap()
        .push(Value::String("identity-governance".to_owned()));
    value
}

fn profile(display_name: &str, revision: u64) -> Value {
    json!({
        "id": PUNK_ID,
        "status": "active",
        "displayName": display_name,
        "avatarUrl": null,
        "identities": [{
            "provider": "github",
            "subjectHash": "a".repeat(64),
            "emailHash": "b".repeat(64),
            "verifiedEmail": null,
            "username": "mabza",
            "credentialId": null,
            "linkedAt": "2026-08-25T12:00:00.000Z"
        }],
        "mergedInto": null,
        "revision": revision,
        "createdAt": "2026-08-25T12:00:00.000Z",
        "updatedAt": if revision == 1 {
            "2026-08-25T12:00:00.000Z"
        } else {
            "2026-08-25T12:01:00.000Z"
        }
    })
}

#[tokio::test]
async fn account_profile_read_and_mutation_use_closed_native_operations() {
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |method, path, body, idempotency_key| {
        captured.lock().unwrap().push((
            method.clone(),
            path.clone(),
            body.clone(),
            idempotency_key,
        ));
        Box::pin(async move {
            Ok(match (method.as_str(), path.as_str()) {
                ("POST", "/api/v1/desktop/compatibility") => identity_compatibility(),
                ("GET", "/api/auth/v1/session") => session(),
                ("GET", "/api/v1/punk") => profile("Mabza", 1),
                ("PATCH", "/api/v1/punk") => profile("Mélanie", 2),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    client.check_compatibility().await.unwrap();
    client.get_session().await.unwrap();

    let current = client.get_punk_profile().await.unwrap();
    assert_eq!(current.display_name, "Mabza");
    assert_eq!(current.revision, 1);
    let updated = client
        .update_punk_profile(1, "Mélanie", None)
        .await
        .unwrap();
    assert_eq!(updated.display_name, "Mélanie");
    assert_eq!(updated.revision, 2);

    let calls = observed.lock().unwrap();
    let mutation = calls
        .iter()
        .find(|(method, path, _, _)| method == "PATCH" && path == "/api/v1/punk")
        .unwrap();
    let body = mutation.2.as_ref().unwrap();
    assert_eq!(body["contract"], "punk.update@1");
    assert_eq!(body["expectedRevision"], 1);
    assert_eq!(body["displayName"], "Mélanie");
    assert_eq!(body["avatarUrl"], Value::Null);
    assert_eq!(
        mutation.3.as_deref(),
        body["commandId"].as_str(),
        "the native command identity must also bind Idempotency-Key",
    );
}

#[tokio::test]
async fn workspace_profile_sidecars_and_search_keep_bounded_contracts() {
    let cursor = format!("psc1.{}.{}", "A".repeat(16), "A".repeat(43));
    let expected_cursor = cursor.clone();
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |_method, path, body, _idempotency_key| {
        captured.lock().unwrap().push((path.clone(), body.clone()));
        let cursor = cursor.clone();
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => identity_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/punks/summaries") => json!({
                    "contract": "punk.summary-batch-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [{
                        "punkId": PUNK_ID,
                        "displayName": "Mabza",
                        "avatarUrl": null
                    }]
                }),
                path if path.ends_with("/punks/search") => json!({
                    "contract": "punk.search-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [{
                        "punkId": PUNK_ID,
                        "displayName": "Mabza",
                        "avatarUrl": null
                    }],
                    "nextCursor": cursor
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let summaries = workspace
        .get_punk_summaries(&[PUNK_ID.to_owned()])
        .await
        .unwrap();
    assert_eq!(summaries.items.len(), 1);
    assert_eq!(summaries.items[0].display_name, "Mabza");

    let page = workspace
        .search_punks(PunkSearchInput::Prefix("mab".to_owned()), 10, None)
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.next_cursor.as_deref(), Some(expected_cursor.as_str()));

    let calls = observed.lock().unwrap();
    let search_body = calls
        .iter()
        .find(|(path, _)| path.ends_with("/punks/search"))
        .and_then(|(_, body)| body.as_ref())
        .unwrap();
    assert_eq!(search_body["workspaceId"], WORKSPACE_ID);
    assert_eq!(
        search_body["query"],
        json!({ "kind": "prefix", "value": "mab" })
    );
    assert_eq!(search_body["limit"], 10);
    assert_eq!(search_body["cursor"], Value::Null);
}

#[tokio::test]
async fn summary_batch_accepts_the_survivor_of_a_requested_merge_alias() {
    const MERGED_ALIAS_ID: &str = "77777777-7777-4777-8777-777777777777";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => identity_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/punks/summaries") => json!({
                    "contract": "punk.summary-batch-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [{
                        "punkId": PUNK_ID,
                        "displayName": "Surviving Punk",
                        "avatarUrl": null
                    }]
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let page = workspace
        .get_punk_summaries(&[MERGED_ALIAS_ID.to_owned()])
        .await
        .unwrap();

    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].punk_id, PUNK_ID);
}

#[tokio::test]
async fn search_uses_the_same_contextual_unicode_lowercase_as_workers() {
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |_method, path, body, _idempotency_key| {
        captured.lock().unwrap().push((path.clone(), body.clone()));
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => identity_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/punks/search") => json!({
                    "contract": "punk.search-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [{
                        "punkId": PUNK_ID,
                        "displayName": "αος",
                        "avatarUrl": null
                    }],
                    "nextCursor": null
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let page = workspace
        .search_punks(PunkSearchInput::Prefix("ΑΟΣ".to_owned()), 10, None)
        .await
        .unwrap();

    assert_eq!(page.items[0].display_name, "αος");
    let calls = observed.lock().unwrap();
    let body = calls
        .iter()
        .find(|(path, _)| path.ends_with("/punks/search"))
        .and_then(|(_, body)| body.as_ref())
        .unwrap();
    assert_eq!(body["query"], json!({ "kind": "prefix", "value": "αος" }));
}

#[tokio::test]
async fn malformed_search_metadata_fails_before_renderer_delivery() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => identity_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/punks/search") => json!({
                    "contract": "punk.search-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [],
                    "nextCursor": null,
                    "total": 0
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .search_punks(PunkSearchInput::Prefix("mab".to_owned()), 10, None)
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert_eq!(ORIGIN, "https://staging.punks.bot");
}

#[tokio::test]
async fn prepared_identity_operations_fail_closed_without_atomic_t4_capability() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    client.check_compatibility().await.unwrap();
    client.get_session().await.unwrap();

    let failure = client.get_punk_profile().await.unwrap_err();
    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert!(failure.message.contains("identity-governance"));
}
