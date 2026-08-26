use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{json, Value};

use crate::{MessageSearchCompleteness, MessageSearchPartialReason};

use super::{
    client_with, compatibility, message_view, prepare_account, session, workspaces, ClientFailure,
    FailureKind, WORKSPACE_ID,
};

const CONVERSATION_ID: &str = "33333333-3333-4333-8333-333333333333";
const THREAD_ROOT_ID: &str = "44444444-4444-4444-8444-444444444444";
const MESSAGE_ID: &str = "66666666-6666-4666-8666-666666666666";

fn search_compatibility() -> Value {
    let mut value = compatibility();
    value["capabilities"]
        .as_array_mut()
        .unwrap()
        .push(Value::String("search".to_owned()));
    value
}

fn search_response(completeness: &str, reason: Option<&str>) -> Value {
    let mut message = message_view(
        CONVERSATION_ID,
        MESSAGE_ID,
        "active",
        Some("Incident response handbook"),
        None,
    );
    message["threadRootMessageId"] = json!(THREAD_ROOT_ID);
    json!({
        "workspaceId": WORKSPACE_ID,
        "conversationId": CONVERSATION_ID,
        "threadRootMessageId": THREAD_ROOT_ID,
        "order": "createdCursor-descending",
        "completeness": completeness,
        "partialReason": reason,
        "items": [message],
        "nextCursor": null
    })
}

#[tokio::test]
async fn search_uses_one_generation_bound_conversation_or_thread_contract() {
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |method, path, body, _idempotency_key| {
        captured
            .lock()
            .unwrap()
            .push((method.clone(), path.clone(), body.clone()));
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => search_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/messages/search") => search_response("complete", None),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let page = workspace
        .search_messages(
            CONVERSATION_ID,
            Some(THREAD_ROOT_ID),
            "incident response",
            25,
            None,
        )
        .await
        .unwrap();

    assert_eq!(page.completeness, MessageSearchCompleteness::Complete);
    assert_eq!(page.partial_reason, None);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].thread_root_message_id, THREAD_ROOT_ID);
    let calls = observed.lock().unwrap();
    let (_, path, body) = calls
        .iter()
        .find(|(_, path, _)| path.ends_with("/messages/search"))
        .unwrap();
    assert_eq!(
        path,
        &format!(
            "/api/v1/workspaces/{WORKSPACE_ID}/conversations/{CONVERSATION_ID}/messages/search"
        )
    );
    assert_eq!(
        body.as_ref().unwrap(),
        &json!({
            "contract": "message.search@1",
            "workspaceId": WORKSPACE_ID,
            "conversationId": CONVERSATION_ID,
            "threadRootMessageId": THREAD_ROOT_ID,
            "query": "incident response",
            "cursor": null,
            "limit": 25
        })
    );
}

#[tokio::test]
async fn search_preserves_the_typed_partial_state_without_a_fallback() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => search_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/messages/search") => {
                    search_response("partial", Some("index_lagging"))
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let page = workspace
        .search_messages(
            CONVERSATION_ID,
            Some(THREAD_ROOT_ID),
            "incident response",
            25,
            None,
        )
        .await
        .unwrap();

    assert_eq!(page.completeness, MessageSearchCompleteness::Partial);
    assert_eq!(
        page.partial_reason,
        Some(MessageSearchPartialReason::IndexLagging)
    );
}

#[tokio::test]
async fn search_fails_before_io_when_the_profile_keeps_t9_unavailable() {
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        captured.lock().unwrap().push(path.clone());
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .search_messages(CONVERSATION_ID, Some(THREAD_ROOT_ID), "incident", 25, None)
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert!(!observed
        .lock()
        .unwrap()
        .iter()
        .any(|path| path.ends_with("/messages/search")));
}

#[tokio::test]
async fn search_rejects_an_incoherent_partial_contract_before_ipc_delivery() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => search_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/messages/search") => {
                    search_response("complete", Some("index_lagging"))
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .search_messages(
            CONVERSATION_ID,
            Some(THREAD_ROOT_ID),
            "incident response",
            25,
            None,
        )
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn search_rejects_a_current_view_that_does_not_match_the_query() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => search_compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/messages/search") => {
                    let mut response = search_response("complete", None);
                    response["items"][0]["content"] = json!("Unrelated Message");
                    response
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .search_messages(CONVERSATION_ID, Some(THREAD_ROOT_ID), "incident", 25, None)
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}
