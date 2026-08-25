use super::*;

#[tokio::test]
async fn stream_directory_rejects_items_outside_the_workspace_scope() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/conversations?limit=100") => json!({
                    "contract": "conversation.list-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "items": [{
                        "id": "33333333-3333-4333-8333-333333333333",
                        "workspaceId": SECOND_WORKSPACE_ID,
                        "name": "Foreign Stream",
                        "type": "stream",
                        "visibility": "private",
                        "description": null,
                        "topic": null,
                        "purpose": null,
                        "topicRequired": false,
                        "ttlSeconds": null,
                        "ttlDeadline": null,
                        "revision": 1,
                        "cursor": 1,
                        "updatedAt": "2026-08-23T10:00:00.000Z"
                    }],
                    "nextCursor": null
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace.list_streams().await.unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn message_history_rejects_non_monotone_pages() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let first_message_id = "44444444-4444-4444-8444-444444444444";
    let second_message_id = "66666666-6666-4666-8666-666666666666";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.contains("/messages") => {
                    let mut newer = message_view(
                        conversation_id,
                        second_message_id,
                        "active",
                        Some("newer"),
                        None,
                    );
                    newer["createdCursor"] = json!(2);
                    newer["cursor"] = json!(2);
                    json!({
                        "workspaceId": WORKSPACE_ID,
                        "conversationId": conversation_id,
                        "highWaterCursor": 2,
                        "order": "createdCursor-ascending",
                        "items": [
                            newer,
                            message_view(
                                conversation_id,
                                first_message_id,
                                "active",
                                Some("older"),
                                None,
                            )
                        ],
                        "nextCursor": null
                    })
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .get_timeline(conversation_id, Some(100), None)
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn thread_history_rejects_messages_from_another_thread() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let requested_root_id = "44444444-4444-4444-8444-444444444444";
    let foreign_root_id = "66666666-6666-4666-8666-666666666666";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.contains("/messages") => json!({
                    "workspaceId": WORKSPACE_ID,
                    "conversationId": conversation_id,
                    "highWaterCursor": 1,
                    "order": "createdCursor-ascending",
                    "items": [message_view(
                        conversation_id,
                        foreign_root_id,
                        "active",
                        Some("foreign thread"),
                        None,
                    )],
                    "nextCursor": null
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .get_thread(conversation_id, requested_root_id, Some(100), None)
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn author_resolver_rejects_unrequested_sidecars() {
    let unrequested_punk_id = "77777777-7777-4777-8777-777777777777";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/authors/resolve") => json!({
                    "contract": "author.resolve-response@1",
                    "workspaceId": WORKSPACE_ID,
                    "authors": [{
                        "kind": "punk",
                        "punkId": unrequested_punk_id,
                        "displayName": "Unrequested Punk",
                        "avatarUrl": null
                    }]
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .resolve_authors(&[AuthorReference::Punk {
            punk_id: PUNK_ID.to_owned(),
        }])
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[test]
fn follow_contract_rejects_foreign_messages_before_renderer_delivery() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let mut foreign = message_view(
        conversation_id,
        message_id,
        "active",
        Some("must not cross IPC"),
        None,
    );
    foreign["workspaceId"] = json!(SECOND_WORKSPACE_ID);
    let frame = serde_json::from_value::<FollowServerFrame>(json!({
        "schemaVersion": 1,
        "type": "changes",
        "fromExclusiveCursor": 0,
        "throughCursor": 1,
        "messages": [foreign],
        "threadPatches": [],
        "reactionPatches": [],
        "reactionCollectionPatches": []
    }))
    .unwrap();

    let failure =
        super::super::follow::validate_follow_frame(&frame, WORKSPACE_ID, conversation_id)
            .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}
