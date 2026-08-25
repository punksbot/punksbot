use super::*;

#[tokio::test]
async fn durable_workspace_identity_is_distinct_from_uuid_shaped_slug() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => json!({
                    "contract": "workspace.list-response@1",
                    "items": [
                        {
                            "id": WORKSPACE_ID,
                            "slug": SECOND_WORKSPACE_ID,
                            "name": "UUID-shaped slug",
                            "visibility": "private",
                            "role": "owner",
                            "revision": 1
                        },
                        {
                            "id": SECOND_WORKSPACE_ID,
                            "slug": "durable-target",
                            "name": "Durable target",
                            "visibility": "private",
                            "role": "member",
                            "revision": 1
                        }
                    ],
                    "nextCursor": null
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;

    let durable = client
        .resolve_workspace_by_id(SECOND_WORKSPACE_ID)
        .await
        .unwrap()
        .unwrap();
    let by_slug = client
        .resolve_workspace_by_slug(SECOND_WORKSPACE_ID)
        .await
        .unwrap()
        .unwrap();
    let opened = client.open_workspace(SECOND_WORKSPACE_ID).await.unwrap();

    assert_eq!(durable.id, SECOND_WORKSPACE_ID);
    assert_eq!(by_slug.id, WORKSPACE_ID);
    assert_eq!(opened.lease().workspace_id, SECOND_WORKSPACE_ID);
}

#[tokio::test]
async fn pending_mutation_is_cancelled_as_ambiguous_before_context_change() {
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let channels = Arc::new(Mutex::new((Some(started_tx), Some(release_rx))));
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        let channels = Arc::clone(&channels);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => {
                    let (started, release) = {
                        let mut channels = channels.lock().await;
                        (channels.0.take(), channels.1.take())
                    };
                    if let Some(started) = started {
                        let _ = started.send(());
                    }
                    if let Some(release) = release {
                        let _ = release.await;
                    }
                    json!({})
                }
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();
    let pending = tokio::spawn(async move {
        workspace
            .post_text("33333333-3333-4333-8333-333333333333", "hello", None, None)
            .await
    });
    started_rx.await.unwrap();

    client.clear_workspace_session().await;
    let failure = pending.await.unwrap().unwrap_err();

    assert_eq!(failure.kind, FailureKind::Ambiguous);
    assert!(release_tx.send(()).is_err());
}
