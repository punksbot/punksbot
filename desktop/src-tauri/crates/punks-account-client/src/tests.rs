use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{oneshot, Mutex};

use super::{
    confirm_follow_batch, reduce_follow_frame, AuthorReference, ClientDistribution, ClientFailure,
    ClientPlatform, FailureKind, FollowPhase, FollowServerFrame, FollowState, PunksAccountClient,
};

mod message_mutations;
mod social_reads;
mod workspace_context;

type ResponseFuture = Pin<Box<dyn Future<Output = Result<Value, ClientFailure>> + Send>>;

const ORIGIN: &str = "https://staging.punks.bot";
const PUNK_ID: &str = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID: &str = "22222222-2222-4222-8222-222222222222";
const SECOND_WORKSPACE_ID: &str = "55555555-5555-4555-8555-555555555555";

fn compatibility() -> Value {
    json!({
        "contract": "desktop.compatibility-response@1",
        "compatible": true,
        "profile": "desktop-social-loop@1",
        "registryVersion": 1,
        "minimumClientVersion": "0.6.0",
        "environment": "staging",
        "origin": ORIGIN,
        "capabilities": [
            "stream-list",
            "message-history",
            "message-post",
            "unicode-reactions",
            "message-lifecycle"
        ]
    })
}

fn compatibility_without(capability: &str) -> Value {
    let mut value = compatibility();
    if let Some(capabilities) = value.get_mut("capabilities").and_then(Value::as_array_mut) {
        capabilities.retain(|candidate| candidate.as_str() != Some(capability));
    }
    value
}

fn session() -> Value {
    json!({
        "session": {
            "sessionId": "99999999-9999-4999-8999-999999999999",
            "punkId": PUNK_ID,
            "authenticatedAt": "2026-08-22T10:00:00.000Z",
            "expiresAt": "2026-09-22T10:00:00.000Z",
            "recentReauthUntil": null,
            "punk": { "id": PUNK_ID, "displayName": "Mabza", "avatarUrl": null }
        }
    })
}

fn workspaces() -> Value {
    json!({
        "contract": "workspace.list-response@1",
        "items": [
            { "id": WORKSPACE_ID, "slug": "alpha", "name": "Alpha", "visibility": "private", "role": "owner", "revision": 1 },
            { "id": SECOND_WORKSPACE_ID, "slug": "beta", "name": "Beta", "visibility": "private", "role": "member", "revision": 1 }
        ],
        "nextCursor": null
    })
}

fn message_view(
    conversation_id: &str,
    message_id: &str,
    status: &str,
    content: Option<&str>,
    topic: Option<&str>,
) -> Value {
    json!({
        "id": message_id,
        "workspaceId": WORKSPACE_ID,
        "conversationId": conversation_id,
        "author": { "kind": "punk", "punkId": PUNK_ID },
        "messageType": "stream-message",
        "status": status,
        "content": content,
        "topic": topic,
        "mentionedPunkIds": [],
        "mediaIds": [],
        "parentMessageId": null,
        "threadRootMessageId": message_id,
        "threadDepth": 0,
        "broadcast": false,
        "replyCount": 0,
        "descendantCount": 0,
        "lastReplyAt": null,
        "currentVersion": 1,
        "retractionKind": if status == "retracted" { Some("author") } else { None::<&str> },
        "retractedAt": if status == "retracted" { Some("2026-08-23T10:00:00.000Z") } else { None::<&str> },
        "eraseAfter": if status == "retracted" { Some("2026-08-30T10:00:00.000Z") } else { None::<&str> },
        "publicReason": if status == "retracted" { Some("author request") } else { None::<&str> },
        "erasedAt": null,
        "revision": 1,
        "createdCursor": 1,
        "cursor": 1,
        "createdAt": "2026-08-23T10:00:00.000Z",
        "updatedAt": "2026-08-23T10:00:00.000Z",
        "editedAt": if status == "active" && content == Some("edited") {
            Some("2026-08-23T10:01:00.000Z")
        } else {
            None::<&str>
        }
    })
}

fn client_with(
    handler: impl Fn(String, String, Option<Value>, Option<String>) -> ResponseFuture
        + Send
        + Sync
        + 'static,
) -> PunksAccountClient {
    PunksAccountClient::with_test_transport(
        ORIGIN,
        "0.6.0",
        ClientDistribution::Staging,
        ClientPlatform::MacosArm64,
        Arc::new(handler),
    )
    .unwrap()
}

async fn prepare_account(client: &PunksAccountClient) {
    client.check_compatibility().await.unwrap();
    client.get_session().await.unwrap();
    client.list_workspaces().await.unwrap();
}

#[tokio::test]
async fn workspace_lease_is_invalidated_before_later_io() {
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let channels = Arc::new(Mutex::new((Some(started_tx), Some(release_rx))));
    let directory_calls = Arc::new(AtomicUsize::new(0));
    let stream_calls = Arc::new(AtomicUsize::new(0));
    let captured_directory_calls = Arc::clone(&directory_calls);
    let captured_stream_calls = Arc::clone(&stream_calls);
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        let channels = Arc::clone(&channels);
        let directory_calls = Arc::clone(&captured_directory_calls);
        let stream_calls = Arc::clone(&captured_stream_calls);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => {
                    if directory_calls.fetch_add(1, Ordering::SeqCst) == 0 {
                        json!({
                            "contract": "workspace.list-response@1",
                            "items": [
                                { "id": WORKSPACE_ID, "slug": "alpha", "name": "Alpha", "visibility": "private", "role": "owner", "revision": 1 }
                            ],
                            "nextCursor": null
                        })
                    } else {
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
                        json!({
                            "contract": "workspace.list-response@1",
                            "items": [
                                { "id": SECOND_WORKSPACE_ID, "slug": "beta", "name": "Beta", "visibility": "private", "role": "member", "revision": 1 }
                            ],
                            "nextCursor": null
                        })
                    }
                }
                _ => {
                    stream_calls.fetch_add(1, Ordering::SeqCst);
                    json!({
                        "contract": "conversation.list-response@1",
                        "workspaceId": WORKSPACE_ID,
                        "items": [],
                        "nextCursor": null
                    })
                }
            })
        })
    });
    prepare_account(&client).await;
    let first = client.open_workspace(WORKSPACE_ID).await.unwrap();
    let opening_client = client.clone();
    let opening =
        tokio::spawn(async move { opening_client.open_workspace(SECOND_WORKSPACE_ID).await });
    started_rx.await.unwrap();
    let old_read = first.list_streams().await;
    let _ = release_tx.send(());
    let second = opening.await.unwrap().unwrap();

    assert_eq!(first.lease().generation, 1);
    assert_eq!(second.lease().generation, 2);
    let failure = old_read.unwrap_err();
    assert_eq!(failure.kind, FailureKind::StaleWorkspace);
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn pending_response_is_rejected_after_generation_changes() {
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
                    json!({
                        "contract": "conversation.list-response@1",
                        "workspaceId": WORKSPACE_ID,
                        "items": [],
                        "nextCursor": null
                    })
                }
            })
        })
    });
    prepare_account(&client).await;
    let first = client.open_workspace(WORKSPACE_ID).await.unwrap();
    let pending = tokio::spawn(async move { first.list_streams().await });
    started_rx.await.unwrap();

    client.open_workspace(SECOND_WORKSPACE_ID).await.unwrap();
    let failure = pending.await.unwrap().unwrap_err();
    assert_eq!(failure.kind, FailureKind::Cancelled);
    assert!(release_tx.send(()).is_err());
}

#[tokio::test]
async fn ambiguous_message_post_is_never_replayed() {
    let attempts = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&attempts);
    let client = client_with(move |_method, path, body, idempotency_key| {
        let captured = Arc::clone(&captured);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => {
                    captured.lock().await.push((body, idempotency_key));
                    return Err(ClientFailure::new(
                        FailureKind::Ambiguous,
                        "result is ambiguous",
                    ));
                }
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .post_text("33333333-3333-4333-8333-333333333333", "hello", None, None)
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::Ambiguous);
    let attempts = attempts.lock().await;
    assert_eq!(attempts.len(), 1);
    let (body, idempotency_key) = &attempts[0];
    assert_eq!(
        body.as_ref()
            .and_then(|value| value.get("commandId"))
            .and_then(Value::as_str),
        idempotency_key.as_deref(),
    );
}

#[tokio::test]
async fn message_lifecycle_uses_closed_mutation_contracts_and_fresh_command_ids() {
    let calls = Arc::new(Mutex::new(Vec::<(String, Value, Option<String>)>::new()));
    let captured = Arc::clone(&calls);
    let conversation_id = "33333333-3333-4333-8333-333333333333";
    let message_id = "44444444-4444-4444-8444-444444444444";
    let client = client_with(move |_method, path, body, idempotency_key| {
        let captured = Arc::clone(&captured);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                path if path.ends_with("/messages/44444444-4444-4444-8444-444444444444") => {
                    captured.lock().await.push((
                        path.to_owned(),
                        body.clone().unwrap_or(Value::Null),
                        idempotency_key,
                    ));
                    json!({
                        "message": message_view(conversation_id, message_id, "active", Some("edited"), Some("Edited subject")),
                        "replayed": false
                    })
                }
                path if path
                    .ends_with("/messages/44444444-4444-4444-8444-444444444444/retract") =>
                {
                    captured.lock().await.push((
                        path.to_owned(),
                        body.clone().unwrap_or(Value::Null),
                        idempotency_key,
                    ));
                    json!({
                        "message": message_view(conversation_id, message_id, "retracted", None, None),
                        "replayed": false
                    })
                }
                path if path
                    .ends_with("/messages/44444444-4444-4444-8444-444444444444/restore") =>
                {
                    captured.lock().await.push((
                        path.to_owned(),
                        body.clone().unwrap_or(Value::Null),
                        idempotency_key,
                    ));
                    json!({
                        "message": message_view(conversation_id, message_id, "active", Some("restored"), Some("Restored subject")),
                        "replayed": false
                    })
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    workspace
        .edit_message(
            conversation_id,
            message_id,
            "edited",
            Some("Edited subject"),
        )
        .await
        .unwrap();
    workspace
        .retract_message(
            conversation_id,
            message_id,
            Some("author-request"),
            Some("author request"),
        )
        .await
        .unwrap();
    workspace
        .restore_message(conversation_id, message_id)
        .await
        .unwrap();

    let calls = calls.lock().await;
    assert_eq!(calls.len(), 3);
    assert!(calls[0]
        .0
        .ends_with("/messages/44444444-4444-4444-8444-444444444444"));
    assert!(calls[1].0.ends_with("/retract"));
    assert!(calls[2].0.ends_with("/restore"));
    for (_, body, idempotency_key) in calls.iter() {
        assert_eq!(
            body.get("commandId").and_then(Value::as_str),
            idempotency_key.as_deref(),
        );
    }
    assert_eq!(calls[0].1["contract"], "message.edit@1");
    assert_eq!(calls[1].1["contract"], "message.retract@1");
    assert_eq!(calls[2].1["contract"], "message.restore@1");
}

#[tokio::test]
async fn lifecycle_mutations_fail_closed_when_profile_omits_capability() {
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility_without("message-lifecycle"),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let failure = workspace
        .edit_message(
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
            "edited",
            None,
        )
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert!(failure.message.contains("message-lifecycle"));
}

#[tokio::test]
async fn repeated_directory_cursor_is_a_contract_violation() {
    let calls = Arc::new(Mutex::new(0_u32));
    let captured = Arc::clone(&calls);
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        let captured = Arc::clone(&captured);
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => {
                    *captured.lock().await += 1;
                    json!({
                        "contract": "workspace.list-response@1",
                        "items": [],
                        "nextCursor": "repeat"
                    })
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    client.check_compatibility().await.unwrap();
    client.get_session().await.unwrap();

    let failure = client.list_workspaces().await.unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert_eq!(*calls.lock().await, 2);
}

#[tokio::test]
async fn forged_history_cursor_is_rejected_before_io() {
    let requests = Arc::new(AtomicUsize::new(0));
    let captured = Arc::clone(&requests);
    let client = client_with(move |_method, path, _body, _idempotency_key| {
        let captured = Arc::clone(&captured);
        Box::pin(async move {
            captured.fetch_add(1, Ordering::SeqCst);
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                path if path.starts_with("/api/v1/workspaces?") => workspaces(),
                _ => json!({
                    "workspaceId": WORKSPACE_ID,
                    "conversationId": "33333333-3333-4333-8333-333333333333",
                    "highWaterCursor": 1,
                    "order": "createdCursor-ascending",
                    "items": [],
                    "nextCursor": null
                }),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();
    let before = requests.load(Ordering::SeqCst);

    let failure = workspace
        .get_timeline(
            "33333333-3333-4333-8333-333333333333",
            None,
            Some("mhc1.payload&limit=100.signature"),
        )
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::ContractViolation);
    assert_eq!(requests.load(Ordering::SeqCst), before);
}

#[tokio::test]
async fn workspace_resolves_bounded_author_sidecars() {
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
                        "punkId": PUNK_ID,
                        "displayName": "Mabza",
                        "avatarUrl": null
                    }]
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let authors = workspace
        .resolve_authors(&[AuthorReference::Punk {
            punk_id: PUNK_ID.to_owned(),
        }])
        .await
        .unwrap();

    assert_eq!(authors.len(), 1);
    assert_eq!(authors[0].display_name(), "Mabza");
}

#[test]
fn closed_failure_taxonomy_is_serialized_in_profile_spelling() {
    let kinds = [
        FailureKind::Problem,
        FailureKind::Transport,
        FailureKind::ContractViolation,
        FailureKind::Cancelled,
        FailureKind::StaleWorkspace,
        FailureKind::SessionExpired,
        FailureKind::Ambiguous,
    ];
    assert_eq!(
        serde_json::to_value(kinds).unwrap(),
        json!([
            "problem",
            "transport",
            "contract_violation",
            "cancelled",
            "stale_workspace",
            "session_expired",
            "ambiguous"
        ])
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowCorpus {
    profile: String,
    operation: String,
    traces: Vec<FollowTrace>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowTrace {
    name: String,
    initial_pagination_high_water: u64,
    steps: Vec<FollowStep>,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase")]
enum FollowStep {
    Frame {
        frame: FollowServerFrame,
        expected: ExpectedFollowTrace,
    },
    Confirm {
        #[serde(rename = "throughCursor")]
        through_cursor: u64,
        expected: ExpectedFollowTrace,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedFollowTrace {
    phase: String,
    effect: String,
    applied_cursor: u64,
    follow_checkpoint: u64,
    pending_confirmation_cursor: Option<u64>,
}

fn phase_trace(phase: FollowPhase) -> &'static str {
    match phase {
        FollowPhase::AwaitingAcceptance => "awaiting_acceptance",
        FollowPhase::CatchingUp => "catching_up",
        FollowPhase::Live => "live",
        FollowPhase::ResyncRequired => "resync_required",
        FollowPhase::Terminal => "terminal",
    }
}

fn assert_follow_trace(
    trace_name: &str,
    state: &FollowState,
    effect: &str,
    expected: &ExpectedFollowTrace,
) {
    assert_eq!(phase_trace(state.phase), expected.phase, "{trace_name}");
    assert_eq!(effect, expected.effect, "{trace_name}");
    assert_eq!(
        state.applied_cursor, expected.applied_cursor,
        "{trace_name}"
    );
    assert_eq!(
        state.follow_checkpoint, expected.follow_checkpoint,
        "{trace_name}"
    );
    assert_eq!(
        state.pending_confirmation_cursor, expected.pending_confirmation_cursor,
        "{trace_name}"
    );
}

#[test]
fn rust_replays_the_common_follow_conformance_corpus() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../cloudflare/packages/contracts/conformance/desktop-social-loop-follow.json"
    );
    let source = std::fs::read_to_string(path).unwrap();
    let corpus: FollowCorpus = serde_json::from_str(&source).unwrap();
    assert_eq!(corpus.profile, "desktop-social-loop@1");
    assert_eq!(corpus.operation, "followConversation");

    for trace in corpus.traces {
        let mut state = FollowState::new(trace.initial_pagination_high_water);
        for step in trace.steps {
            match step {
                FollowStep::Frame { frame, expected } => {
                    let reduction = reduce_follow_frame(&state, frame);
                    state = reduction.state;
                    assert_follow_trace(
                        &trace.name,
                        &state,
                        reduction.effect.trace_name(),
                        &expected,
                    );
                }
                FollowStep::Confirm {
                    through_cursor,
                    expected,
                } => {
                    let confirmation = confirm_follow_batch(&state, through_cursor);
                    state = confirmation.state;
                    let effect = if confirmation.ack.is_some() {
                        "ack"
                    } else {
                        "none"
                    };
                    assert_follow_trace(&trace.name, &state, effect, &expected);
                }
            }
        }
    }
}

// ── Corpus commun de validation (issue #50) ─────────────────────────────────
// Rejoue `desktop-social-loop-validation.json` avec les types générés du
// profil (contracts_profile), la taxonomie fermée du transport et les
// validateurs de curseurs — les mêmes traces normalisées que les exécutions
// TypeScript (vitest) et `workerd`.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationCase {
    operation: String,
    name: String,
    kind: String,
    #[serde(default)]
    contract: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    #[serde(default)]
    problem: Option<serde_json::Value>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    forbidden_marker: Option<String>,
    expect: ExpectedOutcome,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedOutcome {
    outcome: String,
    #[serde(default)]
    failure_kind: Option<String>,
}

fn kind_trace(kind: FailureKind) -> &'static str {
    match kind {
        FailureKind::Problem => "problem",
        FailureKind::Transport => "transport",
        FailureKind::ContractViolation => "contract_violation",
        FailureKind::Cancelled => "cancelled",
        FailureKind::StaleWorkspace => "stale_workspace",
        FailureKind::SessionExpired => "session_expired",
        FailureKind::Ambiguous => "ambiguous",
    }
}

fn profile_contract_accepted(contract: &str, payload: &serde_json::Value) -> bool {
    crate::contracts_profile::decode_profile_contract(contract, payload.clone()).is_ok()
}

#[test]
fn rust_replays_the_common_validation_conformance_corpus() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../cloudflare/packages/contracts/conformance/desktop-social-loop-validation.json"
    );
    let source = std::fs::read_to_string(path).unwrap();
    #[derive(Deserialize)]
    struct ValidationCorpus {
        cases: Vec<ValidationCase>,
    }
    let corpus: ValidationCorpus = serde_json::from_str(&source).unwrap();
    let corpus = corpus.cases;
    assert!(!corpus.is_empty());

    let mut markers = Vec::new();
    let mut traces = Vec::<serde_json::Value>::new();
    for case in &corpus {
        if let Some(marker) = &case.forbidden_marker {
            markers.push(marker.clone());
        }
        let (outcome, failure_kind): (&str, Option<&'static str>) = match case.kind.as_str() {
            "closed_error" => {
                let problem = case.problem.as_ref().unwrap();
                let status = problem["status"].as_u64().unwrap_or(0) as u16;
                let code = problem["code"].as_str().unwrap_or_default().to_owned();
                let retry = problem["retry"].as_str().unwrap_or_default().to_owned();
                (
                    "reject",
                    Some(kind_trace(crate::transport::problem_failure_kind(
                        status, &code, &retry,
                    ))),
                )
            }
            "cursor" => {
                let cursor = case.cursor.as_deref().unwrap_or_default();
                let result = if case.operation == "getTimeline" {
                    crate::validation::validate_history_cursor(cursor)
                } else {
                    crate::validation::validate_directory_cursor(cursor)
                };
                match result {
                    Ok(()) => ("ok", None),
                    Err(_) => ("reject", Some("contract_violation")),
                }
            }
            "valid_payload"
            | "unknown_field"
            | "version_incompatibility"
            | "malformed_response" => {
                let accepted = profile_contract_accepted(
                    case.contract.as_deref().unwrap_or_default(),
                    case.payload.as_ref().unwrap_or(&serde_json::Value::Null),
                );
                if accepted {
                    ("ok", None)
                } else {
                    ("reject", Some("contract_violation"))
                }
            }
            other => panic!("genre de cas inconnu : {other}"),
        };
        let expected_kind = case.expect.failure_kind.as_deref();
        assert_eq!(
            outcome,
            case.expect.outcome.as_str(),
            "opération {} / cas {}",
            case.operation,
            case.name
        );
        assert_eq!(
            failure_kind, expected_kind,
            "opération {} / cas {} : taxonomie divergente",
            case.operation, case.name
        );
        traces.push(serde_json::json!({
            "operation": case.operation,
            "case": case.name,
            "outcome": outcome,
            "failureKind": failure_kind,
        }));
    }

    // Redaction : aucun marqueur interdit ne franchit la normalisation.
    let serialized = serde_json::to_string(&traces).unwrap();
    for marker in &markers {
        assert!(
            !serialized.contains(marker.as_str()),
            "marqueur interdit présent dans les traces normalisées"
        );
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationCorpus {
    forbidden_markers: Vec<String>,
    operations: Vec<OperationCorpusEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationCorpusEntry {
    operation: String,
    owner: String,
    kind: String,
    cases: Vec<OperationCorpusCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationCorpusCase {
    name: String,
    diagnostic: String,
    events: Vec<crate::SemanticEvent>,
    expect: crate::SemanticTrace,
}

#[test]
fn semantic_events_drive_the_trace_instead_of_the_case_name() {
    let ambiguous = crate::run_semantic_scenario(
        "postMessage",
        "success",
        "workspace",
        "mutation",
        &[
            crate::SemanticEvent::Emit,
            crate::SemanticEvent::Cancel {
                phase: "in_flight".to_owned(),
            },
        ],
    );
    assert_eq!(ambiguous.outcome, "reject");
    assert_eq!(ambiguous.failure_kind.as_deref(), Some("ambiguous"));
    let completed = crate::run_semantic_scenario(
        "postMessage",
        "cancel_in_flight",
        "workspace",
        "mutation",
        &[crate::SemanticEvent::Complete],
    );
    assert_eq!(completed.outcome, "ok");
    assert_eq!(completed.failure_kind, None);
    let premature_ack = crate::run_semantic_scenario(
        "confirmFollowBatch",
        "ack-premature",
        "workspace",
        "local-orchestration",
        &[crate::SemanticEvent::Ack { cursor: 6 }],
    );
    assert_eq!(premature_ack.ack, "suppressed");
}

#[test]
fn rust_replays_every_profile_operation_with_the_canonical_trace() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../cloudflare/packages/contracts/conformance/desktop-social-loop-operations.json"
    );
    let source = std::fs::read_to_string(path).unwrap();
    let corpus: OperationCorpus = serde_json::from_str(&source).unwrap();
    assert_eq!(corpus.operations.len(), 23);
    let mut traces = Vec::new();
    for operation in &corpus.operations {
        assert!(!operation.cases.is_empty(), "{}", operation.operation);
        for case in &operation.cases {
            let actual = crate::normalize_semantic_trace(crate::SemanticObservation {
                trace: crate::run_semantic_scenario(
                    &operation.operation,
                    &case.name,
                    &operation.owner,
                    &operation.kind,
                    &case.events,
                ),
                diagnostic: serde_json::json!({
                    "detail": case.diagnostic,
                    "authorization": format!("Bearer {}", case.diagnostic),
                }),
            });
            assert_eq!(
                actual, case.expect,
                "{} / {}",
                operation.operation, case.name
            );
            traces.push(actual);
        }
    }
    let serialized = serde_json::to_string(&traces).unwrap();
    for marker in &corpus.forbidden_markers {
        assert!(
            !serialized.contains(marker),
            "la redaction Rust a laissé passer un marqueur interdit"
        );
    }
}
