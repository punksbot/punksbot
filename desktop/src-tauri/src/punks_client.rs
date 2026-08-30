use std::{collections::HashMap, sync::Arc};

use punks_account_client::ceremony::CompiledPunksEnvironment;
use punks_account_client::{
    AuthorReference, AuthorSummary, ClientDistribution, ClientFailure, ClientPlatform,
    DesktopCompatibility, FollowCancellation, FollowConnection, FollowDelivery, FollowServerFrame,
    MessagePage, MessageReplyTarget, MessageView, PresenceCancellation, PresenceConnection,
    PromotionFaultObservation, PromotionFaultObservationInput, PunksAccountClient,
    PunksNavigationTarget, ReactionMutationResult, StreamSummary, StreamView, WorkspaceLease,
    WorkspaceSession, WorkspaceSummary,
};
use punks_account_client::{
    PresenceDelivery, PunkProfile, PunkSearchInput, PunkSearchPage, PunkSummaryPage,
};
use serde::Deserialize;
use tokio::sync::{Mutex, RwLock};

use crate::{
    punks_auth_state::NativeAuthenticationRuntime,
    punks_promotion_audit::{observe_result, record_ipc_coordinates},
};

/// Native state for the single Punks Account and mounted Workspace.
pub struct PunksDesktopClient {
    account: Result<PunksAccountClient, ClientFailure>,
    pub(crate) transitions: RwLock<()>,
    sessions: Mutex<HashMap<u64, WorkspaceSession>>,
    follows: Mutex<HashMap<String, FollowEntry>>,
    presences: Mutex<HashMap<String, PresenceEntry>>,
    pub(crate) authentication: Mutex<NativeAuthenticationRuntime>,
}

struct FollowEntry {
    cancellation: FollowCancellation,
    connection: Arc<Mutex<FollowConnection>>,
}

struct PresenceEntry {
    cancellation: PresenceCancellation,
    connection: Arc<PresenceConnection>,
}

impl PunksDesktopClient {
    pub fn from_distribution() -> Self {
        let origin = option_env!("PUNKS_ORIGIN").unwrap_or("http://127.0.0.1:8787");
        let distribution = CompiledPunksEnvironment::current().map(|value| match value {
            CompiledPunksEnvironment::Local => ClientDistribution::Development,
            CompiledPunksEnvironment::Staging => ClientDistribution::Staging,
            CompiledPunksEnvironment::Production => ClientDistribution::Production,
        });
        Self {
            account: distribution
                .map_err(|_| {
                    ClientFailure::native(
                        punks_account_client::FailureKind::ContractViolation,
                        "unknown compiled Punks environment",
                    )
                })
                .and_then(|distribution| {
                    PunksAccountClient::new(
                        origin,
                        env!("CARGO_PKG_VERSION"),
                        distribution,
                        current_platform(),
                    )
                }),
            transitions: RwLock::new(()),
            sessions: Mutex::new(HashMap::new()),
            follows: Mutex::new(HashMap::new()),
            presences: Mutex::new(HashMap::new()),
            authentication: Mutex::new(NativeAuthenticationRuntime::new(origin)),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(origin: &str) -> Self {
        Self {
            account: PunksAccountClient::new(
                origin,
                env!("CARGO_PKG_VERSION"),
                ClientDistribution::Development,
                current_platform(),
            ),
            transitions: RwLock::new(()),
            sessions: Mutex::new(HashMap::new()),
            follows: Mutex::new(HashMap::new()),
            presences: Mutex::new(HashMap::new()),
            authentication: Mutex::new(NativeAuthenticationRuntime::new(origin)),
        }
    }

    pub(crate) fn account(&self) -> Result<&PunksAccountClient, ClientFailure> {
        self.account.as_ref().map_err(Clone::clone)
    }

    /// Cancels the mounted Workspace while retaining Compatibility and the
    /// active Account Session needed to authorize an explicit Account switch.
    pub(crate) async fn invalidate_workspace_context(&self) -> Result<(), ClientFailure> {
        self.account()?.clear_workspace_session().await;
        self.cancel_follows().await;
        self.cancel_presences().await;
        self.sessions.lock().await.clear();
        Ok(())
    }

    /// Invalidates all native Punks state before a logout or Account switch
    /// can perform any further social I/O.
    pub(crate) async fn invalidate_for_sign_out(&self) -> Result<(), ClientFailure> {
        self.cancel_follows().await;
        self.cancel_presences().await;
        self.sessions.lock().await.clear();
        self.account()?.clear_account_session().await;
        Ok(())
    }

    pub(crate) async fn activate_prepared_session(
        &self,
        secret: &punks_account_client::ceremony::SessionSecret,
    ) -> Result<(), ClientFailure> {
        self.cancel_follows().await;
        self.cancel_presences().await;
        self.sessions.lock().await.clear();
        self.account()?.activate_prepared_session(secret).await
    }

    pub(crate) async fn session(
        &self,
        lease: &WorkspaceLease,
    ) -> Result<WorkspaceSession, ClientFailure> {
        self.sessions
            .lock()
            .await
            .get(&lease.generation)
            .filter(|session| session.lease() == lease)
            .cloned()
            .ok_or_else(ClientFailure::stale_workspace)
    }

    pub(crate) async fn cancel_follows(&self) {
        let entries = self
            .follows
            .lock()
            .await
            .drain()
            .map(|(_, entry)| entry)
            .collect::<Vec<_>>();
        for entry in entries {
            entry.cancellation.cancel();
            let mut connection = entry.connection.lock().await;
            let _ = connection.close().await;
        }
    }

    pub(crate) async fn cancel_presences(&self) {
        let entries = self
            .presences
            .lock()
            .await
            .drain()
            .map(|(_, entry)| entry)
            .collect::<Vec<_>>();
        for entry in entries {
            entry.cancellation.cancel();
            let _ = entry.connection.close().await;
        }
    }

    /// Lets every native Presence supervisor bypass only its current backoff
    /// when the packaged app returns to the foreground.
    pub(crate) async fn resume_presences(&self) {
        let connections = self
            .presences
            .lock()
            .await
            .values()
            .map(|entry| Arc::clone(&entry.connection))
            .collect::<Vec<_>>();
        for connection in connections {
            connection.reconnect_now();
        }
    }

    async fn follow(
        &self,
        operation_id: &str,
    ) -> Result<Arc<Mutex<FollowConnection>>, ClientFailure> {
        self.follows
            .lock()
            .await
            .get(operation_id)
            .map(|entry| Arc::clone(&entry.connection))
            .ok_or_else(|| ClientFailure::cancelled("Punks FOLLOW operation is closed"))
    }

    async fn presence(&self, operation_id: &str) -> Result<Arc<PresenceConnection>, ClientFailure> {
        self.presences
            .lock()
            .await
            .get(operation_id)
            .map(|entry| Arc::clone(&entry.connection))
            .ok_or_else(|| ClientFailure::cancelled("Punks Presence operation is closed"))
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn current_platform() -> ClientPlatform {
    ClientPlatform::MacosArm64
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn current_platform() -> ClientPlatform {
    ClientPlatform::MacosX64
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn current_platform() -> ClientPlatform {
    ClientPlatform::LinuxX64
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn current_platform() -> ClientPlatform {
    ClientPlatform::WindowsX64
}

#[tauri::command]
pub async fn punks_check_compatibility(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<DesktopCompatibility, ClientFailure> {
    let _transition = client.transitions.write().await;
    let result = client.account()?.check_compatibility().await;
    observe_result(
        "punks_check_compatibility",
        "desktop.compatibility-response@1",
        result,
    )
}

#[tauri::command]
/// Observes the fault state bound to one protected staging promotion run.
///
/// This command is unavailable outside the compiled staging distribution and
/// returns only the closed public observation contract, never operator
/// credentials or controller internals.
pub async fn punks_observe_promotion_fault(
    client: tauri::State<'_, PunksDesktopClient>,
    input: PromotionFaultObservationInput,
) -> Result<PromotionFaultObservation, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client.account()?.observe_promotion_fault(input).await;
    observe_result(
        "punks_observe_promotion_fault",
        "promotion.fault-observe@1",
        result,
    )
}

/// Native navigation envelope.  The expected origin comes from the compiled
/// Account client, while the path validator accepts only canonical Punks
/// routes and never legacy/hash/query forms.
#[tauri::command]
pub fn punks_validate_navigation(
    client: tauri::State<'_, PunksDesktopClient>,
    url: String,
) -> Result<PunksNavigationTarget, ClientFailure> {
    client.account()?.validate_navigation(&url)
}

#[tauri::command]
pub async fn punks_list_workspaces(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<Vec<WorkspaceSummary>, ClientFailure> {
    let _transition = client.transitions.write().await;
    let result = client.account()?.list_workspaces().await;
    observe_result("punks_list_workspaces", "workspace.summary[]@1", result)
}

#[tauri::command]
pub async fn punks_get_punk_profile(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<PunkProfile, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.account()?.get_punk_profile().await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePunkProfileInput {
    expected_revision: u64,
    display_name: String,
    avatar_url: Option<String>,
}

#[tauri::command]
pub async fn punks_update_punk_profile(
    client: tauri::State<'_, PunksDesktopClient>,
    input: UpdatePunkProfileInput,
) -> Result<PunkProfile, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .account()?
        .update_punk_profile(
            input.expected_revision,
            &input.display_name,
            input.avatar_url.as_deref(),
        )
        .await
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
/// Explicit identity namespace used to resolve an authorized Workspace.
pub enum WorkspaceIdentityInput {
    /// Durable Workspace UUID used by leases and storage.
    Id { workspace_id: String },
    /// Mutable canonical slug used only by product routes.
    Slug { workspace_slug: String },
}

#[tauri::command]
pub async fn punks_resolve_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    identity: WorkspaceIdentityInput,
) -> Result<Option<WorkspaceSummary>, ClientFailure> {
    let _transition = client.transitions.write().await;
    match identity {
        WorkspaceIdentityInput::Id { workspace_id } => {
            client
                .account()?
                .resolve_workspace_by_id(&workspace_id)
                .await
        }
        WorkspaceIdentityInput::Slug { workspace_slug } => {
            client
                .account()?
                .resolve_workspace_by_slug(&workspace_slug)
                .await
        }
    }
}

#[tauri::command]
pub async fn punks_open_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    workspace_id: String,
) -> Result<WorkspaceLease, ClientFailure> {
    let result = async {
        client.account()?.cancel_workspace_operations().await;
        let _transition = client.transitions.write().await;
        client.cancel_follows().await;
        client.sessions.lock().await.clear();
        let session = client.account()?.open_workspace(&workspace_id).await?;
        let lease = session.lease().clone();
        let mut sessions = client.sessions.lock().await;
        sessions.insert(lease.generation, session);
        Ok(lease)
    }
    .await;
    observe_result("punks_open_workspace", "workspace.lease@1", result)
}

#[tauri::command]
pub async fn punks_close_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<(), ClientFailure> {
    client.account()?.cancel_workspace_operations().await;
    let _transition = client.transitions.write().await;
    let session = {
        let mut sessions = client.sessions.lock().await;
        if sessions
            .get(&lease.generation)
            .is_some_and(|session| session.lease() == &lease)
        {
            sessions.remove(&lease.generation)
        } else {
            None
        }
    };
    if let Some(session) = session {
        session.close().await;
    }
    client.cancel_follows().await;
    client.cancel_presences().await;
    Ok(())
}

#[tauri::command]
pub async fn punks_list_streams(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<Vec<StreamSummary>, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client.session(&lease).await?.list_streams().await;
    observe_result("punks_list_streams", "conversation.summary[]@1", result)
}

#[tauri::command]
pub async fn punks_get_stream(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    conversation_id: String,
) -> Result<StreamView, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .get_stream(&conversation_id)
        .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessagePageInput {
    conversation_id: String,
    limit: Option<u16>,
    cursor: Option<String>,
}

#[tauri::command]
pub async fn punks_get_timeline(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: MessagePageInput,
) -> Result<MessagePage, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client
        .session(&lease)
        .await?
        .get_timeline(&input.conversation_id, input.limit, input.cursor.as_deref())
        .await;
    observe_result("punks_get_timeline", "message.history-response@1", result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadPageInput {
    conversation_id: String,
    thread_root_message_id: String,
    limit: Option<u16>,
    cursor: Option<String>,
}

#[tauri::command]
pub async fn punks_get_thread(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: ThreadPageInput,
) -> Result<MessagePage, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client
        .session(&lease)
        .await?
        .get_thread(
            &input.conversation_id,
            &input.thread_root_message_id,
            input.limit,
            input.cursor.as_deref(),
        )
        .await;
    observe_result("punks_get_thread", "message.history-response@1", result)
}

#[tauri::command]
pub async fn punks_resolve_authors(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    authors: Vec<AuthorReference>,
) -> Result<Vec<AuthorSummary>, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .resolve_authors(&authors)
        .await
}

#[tauri::command]
pub async fn punks_get_punk_summaries(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    punk_ids: Vec<String>,
) -> Result<PunkSummaryPage, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .get_punk_summaries(&punk_ids)
        .await
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PunkSearchQueryInput {
    Prefix { value: String },
    PunkId { punk_id: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchPunksInput {
    query: PunkSearchQueryInput,
    limit: u8,
    cursor: Option<String>,
}

#[tauri::command]
pub async fn punks_search_punks(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: SearchPunksInput,
) -> Result<PunkSearchPage, ClientFailure> {
    let _operation = client.transitions.read().await;
    let query = match input.query {
        PunkSearchQueryInput::Prefix { value } => PunkSearchInput::Prefix(value),
        PunkSearchQueryInput::PunkId { punk_id } => PunkSearchInput::PunkId(punk_id),
    };
    client
        .session(&lease)
        .await?
        .search_punks(query, input.limit, input.cursor.as_deref())
        .await
}

#[tauri::command]
pub async fn punks_follow_conversation(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    conversation_id: String,
    after_cursor: u64,
) -> Result<String, ClientFailure> {
    let result = async {
        let _operation = client.transitions.read().await;
        let connection = client
            .session(&lease)
            .await?
            .follow_conversation(&conversation_id, after_cursor)
            .await?;
        let operation_id = connection.operation_id().to_string();
        client.follows.lock().await.insert(
            operation_id.clone(),
            FollowEntry {
                cancellation: connection.cancellation(),
                connection: Arc::new(Mutex::new(connection)),
            },
        );
        Ok(operation_id)
    }
    .await;
    let coordinates = match &result {
        Ok(operation_id) => {
            serde_json::json!({ "operationId": operation_id, "afterCursor": after_cursor })
        }
        Err(_) => serde_json::json!({ "afterCursor": after_cursor }),
    };
    record_ipc_coordinates(
        "punks_follow_conversation",
        "follow.operation@1",
        result.is_ok(),
        &coordinates,
    );
    result
}

#[tauri::command]
pub async fn punks_follow_next(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<FollowDelivery, ClientFailure> {
    let result = client
        .follow(&operation_id)
        .await?
        .lock()
        .await
        .next_delivery()
        .await;
    let coordinates = match &result {
        Ok(FollowDelivery::ApplyBatch {
            frame:
                FollowServerFrame::Changes {
                    from_exclusive_cursor,
                    through_cursor,
                    ..
                },
        }) => serde_json::json!({
            "operationId": operation_id,
            "kind": "apply_batch",
            "fromExclusiveCursor": from_exclusive_cursor,
            "throughCursor": through_cursor,
        }),
        Ok(FollowDelivery::BecameLive) => {
            serde_json::json!({ "operationId": operation_id, "kind": "became_live" })
        }
        Ok(FollowDelivery::Resync {
            reason,
            after_cursor,
            high_water_cursor,
        }) => serde_json::json!({
            "operationId": operation_id,
            "kind": "resync",
            "reason": reason,
            "afterCursor": after_cursor,
            "highWaterCursor": high_water_cursor,
        }),
        Ok(FollowDelivery::Terminal { reason, cursor }) => serde_json::json!({
            "operationId": operation_id,
            "kind": "terminal",
            "reason": reason,
            "cursor": cursor,
        }),
        Ok(FollowDelivery::Typing { .. }) => {
            serde_json::json!({ "operationId": operation_id, "kind": "typing" })
        }
        Ok(FollowDelivery::ApplyBatch { .. }) => {
            serde_json::json!({ "operationId": operation_id, "kind": "unexpected_batch" })
        }
        Err(_) => serde_json::json!({ "operationId": operation_id }),
    };
    record_ipc_coordinates(
        "punks_follow_next",
        "follow.delivery@1",
        result.is_ok(),
        &coordinates,
    );
    crate::punks_promotion_audit::record_live_follow_conformance_if_ready(&operation_id);
    result
}

#[tauri::command]
pub async fn punks_confirm_follow_batch(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
    through_cursor: u64,
) -> Result<(), ClientFailure> {
    let result = client
        .follow(&operation_id)
        .await?
        .lock()
        .await
        .confirm_batch(through_cursor)
        .await;
    record_ipc_coordinates(
        "punks_confirm_follow_batch",
        "follow.acknowledgement@1",
        result.is_ok(),
        &serde_json::json!({
            "operationId": operation_id,
            "throughCursor": through_cursor,
        }),
    );
    crate::punks_promotion_audit::record_live_follow_conformance_if_ready(&operation_id);
    result
}

#[tauri::command]
pub async fn punks_close_follow(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<(), ClientFailure> {
    let entry = client.follows.lock().await.remove(&operation_id);
    let Some(entry) = entry else {
        record_ipc_coordinates(
            "punks_close_follow",
            "follow.terminal@1",
            true,
            &serde_json::json!({
                "operationId": operation_id,
                "alreadyClosed": true,
            }),
        );
        return Ok(());
    };
    entry.cancellation.cancel();
    let result = entry.connection.lock().await.close().await;
    record_ipc_coordinates(
        "punks_close_follow",
        "follow.terminal@1",
        result.is_ok(),
        &serde_json::json!({
            "operationId": operation_id,
            "alreadyClosed": false,
        }),
    );
    result
}

#[tauri::command]
pub async fn punks_hold_presence(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<String, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.cancel_presences().await;
    let connection = Arc::new(client.session(&lease).await?.hold_presence().await?);
    let operation_id = uuid::Uuid::new_v4().to_string();
    client.presences.lock().await.insert(
        operation_id.clone(),
        PresenceEntry {
            cancellation: connection.cancellation(),
            connection,
        },
    );
    Ok(operation_id)
}

#[tauri::command]
pub async fn punks_presence_next(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<PresenceDelivery, ClientFailure> {
    client.presence(&operation_id).await?.next_delivery().await
}

#[tauri::command]
pub async fn punks_set_presence_status(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
    status: Option<String>,
) -> Result<(), ClientFailure> {
    client
        .presence(&operation_id)
        .await?
        .set_status(status.as_deref())
        .await
}

#[tauri::command]
pub async fn punks_signal_presence_typing(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
    conversation_id: String,
    active: bool,
) -> Result<(), ClientFailure> {
    client
        .presence(&operation_id)
        .await?
        .signal_typing(&conversation_id, active)
        .await
}

#[tauri::command]
pub async fn punks_close_presence(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<(), ClientFailure> {
    let entry = client.presences.lock().await.remove(&operation_id);
    let Some(entry) = entry else {
        return Ok(());
    };
    entry.cancellation.cancel();
    entry.connection.close().await
}

/// Payload for posting a root Message or a reply in a Workspace Stream.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostTextInput {
    conversation_id: String,
    content: String,
    topic: Option<String>,
    reply_target: Option<MessageReplyTarget>,
}

#[tauri::command]
/// Posts one explicit Message intent through the generation-bound session.
pub async fn punks_post_message(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: PostTextInput,
) -> Result<MessageView, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client
        .session(&lease)
        .await?
        .post_text(
            &input.conversation_id,
            &input.content,
            input.topic.as_deref(),
            input.reply_target.as_ref(),
        )
        .await;
    let coordinates = match &result {
        Ok(message) => serde_json::json!({
            "messageId": message.id,
            "topicPresent": message.topic.is_some(),
            "threadDepth": message.thread_depth,
        }),
        Err(_) => serde_json::json!({}),
    };
    record_ipc_coordinates(
        "punks_post_message",
        "message.view@1",
        result.is_ok(),
        &coordinates,
    );
    result
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionInput {
    conversation_id: String,
    message_id: String,
    reaction: String,
}

#[tauri::command]
pub async fn punks_add_reaction(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: ReactionInput,
) -> Result<ReactionMutationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client
        .session(&lease)
        .await?
        .add_reaction(&input.conversation_id, &input.message_id, &input.reaction)
        .await;
    record_ipc_coordinates(
        "punks_add_reaction",
        "message.reaction-mutation-response@1",
        result.is_ok(),
        &serde_json::json!({
            "messageId": input.message_id,
            "reaction": input.reaction,
        }),
    );
    result
}

#[tauri::command]
pub async fn punks_remove_reaction(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: ReactionInput,
) -> Result<ReactionMutationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .remove_reaction(&input.conversation_id, &input.message_id, &input.reaction)
        .await
}
