use super::*;

#[tokio::test]
async fn post_acknowledgement_must_preserve_the_requested_thread_ancestry() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let reply_to_message_id = "66666666-6666-4666-8666-666666666666";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => json!({
                    "message": message_view(
                        conversation_id,
                        message_id,
                        "active",
                        Some("reply"),
                        None,
                    ),
                    "replayed": false,
                }),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .post_text(conversation_id, "reply", None, Some(reply_to_message_id))
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn reaction_acknowledgement_must_match_the_current_punk_coordinate() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => json!({
                    "reaction": {
                        "id": "77777777-7777-4777-8777-777777777777",
                        "workspaceId": WORKSPACE_ID,
                        "conversationId": conversation_id,
                        "messageId": "66666666-6666-4666-8666-666666666666",
                        "actor": { "kind": "punk", "punkId": PUNK_ID },
                        "reaction": "🦄",
                        "reactedAt": "2026-08-23T10:00:00.000Z",
                    },
                    "effect": "added",
                    "replayed": false,
                }),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .add_reaction(conversation_id, message_id, "🦄")
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn reaction_acknowledgement_must_match_the_requested_operation() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => json!({
                    "reaction": null,
                    "effect": "removed",
                    "replayed": false,
                }),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .add_reaction(conversation_id, message_id, "🦄")
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
}

#[tokio::test]
async fn reaction_intents_use_fresh_command_ids_and_closed_acknowledgements() {
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let calls = Arc::new(Mutex::new(Vec::<(Value, Option<String>)>::new()));
    let captured = Arc::clone(&calls);
    let client = client_with(move |_method, path, body, idempotency_key| {
        let captured = Arc::clone(&captured);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/reactions/add") => {
                    captured
                        .lock()
                        .await
                        .push((body.unwrap_or(Value::Null), idempotency_key));
                    json!({
                        "reaction": {
                            "id": "77777777-7777-4777-8777-777777777777",
                            "workspaceId": WORKSPACE_ID,
                            "conversationId": conversation_id,
                            "messageId": message_id,
                            "actor": { "kind": "punk", "punkId": PUNK_ID },
                            "reaction": ":party_parrot:",
                            "reactedAt": "2026-08-23T10:00:00.000Z",
                        },
                        "effect": "added",
                        "replayed": false,
                    })
                }
                path if path.ends_with("/reactions/remove") => {
                    captured
                        .lock()
                        .await
                        .push((body.unwrap_or(Value::Null), idempotency_key));
                    json!({
                        "reaction": null,
                        "effect": "removed",
                        "replayed": false,
                    })
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let added = workspace
        .add_reaction(conversation_id, message_id, ":Party_Parrot:")
        .await
        .unwrap();
    let removed = workspace
        .remove_reaction(conversation_id, message_id, " :PARTY_PARROT: ")
        .await
        .unwrap();

    assert_eq!(added.effect, "added");
    assert_eq!(removed.effect, "removed");
    let calls = calls.lock().await;
    assert_eq!(calls.len(), 2);
    let command_ids = calls
        .iter()
        .map(|(body, idempotency_key)| {
            assert_eq!(body["payload"]["reaction"], ":party_parrot:");
            let command_id = body["commandId"].as_str().unwrap();
            assert_eq!(Some(command_id), idempotency_key.as_deref());
            command_id
        })
        .collect::<Vec<_>>();
    assert_ne!(command_ids[0], command_ids[1]);
}
