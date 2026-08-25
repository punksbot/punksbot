use std::{collections::HashMap, sync::Arc};

use punks_account_client::ceremony::CompiledPunksEnvironment;
use punks_account_client::{
    AuthorReference, AuthorSummary, ClientDistribution, ClientFailure, ClientPlatform,
    DesktopCompatibility, FollowCancellation, FollowConnection, FollowDelivery, MessagePage,
    MessageView, PunksAccountClient, PunksNavigationTarget, ReactionMutationResult, StreamSummary,
    StreamView, WorkspaceLease, WorkspaceSession, WorkspaceSummary,
};
use serde::Deserialize;
use tokio::sync::{Mutex, RwLock};

use crate::punks_auth_state::NativeAuthenticationRuntime;

#[path = "punks_message_lifecycle.rs"]
/// Tauri commands for capability-gated Message lifecycle mutations.
pub mod punks_message_lifecycle;

/// Native state for the single Punks Account and mounted Workspace.
pub struct PunksDesktopClient {
    account: Result<PunksAccountClient, ClientFailure>,
    pub(crate) transitions: RwLock<()>,
    sessions: Mutex<HashMap<u64, WorkspaceSession>>,
    follows: Mutex<HashMap<String, FollowEntry>>,
    pub(crate) authentication: Mutex<NativeAuthenticationRuntime>,
}

struct FollowEntry {
    cancellation: FollowCancellation,
    connection: Arc<Mutex<FollowConnection>>,
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
        self.sessions.lock().await.clear();
        Ok(())
    }

    /// Invalidates all native Punks state before a logout or Account switch
    /// can perform any further social I/O.
    pub(crate) async fn invalidate_for_sign_out(&self) -> Result<(), ClientFailure> {
        self.cancel_follows().await;
        self.sessions.lock().await.clear();
        self.account()?.clear_account_session().await;
        Ok(())
    }

    pub(crate) async fn activate_prepared_session(
        &self,
        secret: &punks_account_client::ceremony::SessionSecret,
    ) -> Result<(), ClientFailure> {
        self.cancel_follows().await;
        self.sessions.lock().await.clear();
        self.account()?.activate_prepared_session(secret).await
    }

    async fn session(&self, lease: &WorkspaceLease) -> Result<WorkspaceSession, ClientFailure> {
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
    client.account()?.check_compatibility().await
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
    client.account()?.list_workspaces().await
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

#[tauri::command]
pub async fn punks_close_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<(), ClientFailure> {
    client.account()?.cancel_workspace_operations().await;
    let _transition = client.transitions.write().await;
    let session = client.session(&lease).await?;
    session.close().await;
    client.cancel_follows().await;
    client.sessions.lock().await.remove(&lease.generation);
    Ok(())
}

#[tauri::command]
pub async fn punks_list_streams(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<Vec<StreamSummary>, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.session(&lease).await?.list_streams().await
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
    client
        .session(&lease)
        .await?
        .get_timeline(&input.conversation_id, input.limit, input.cursor.as_deref())
        .await
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
    client
        .session(&lease)
        .await?
        .get_thread(
            &input.conversation_id,
            &input.thread_root_message_id,
            input.limit,
            input.cursor.as_deref(),
        )
        .await
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
pub async fn punks_follow_conversation(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    conversation_id: String,
    after_cursor: u64,
) -> Result<String, ClientFailure> {
    let _operation = client.transitions.read().await;
    let connection = client
        .session(&lease)
        .await?
        .follow_conversation(&conversation_id, after_cursor)
        .await?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    client.follows.lock().await.insert(
        operation_id.clone(),
        FollowEntry {
            cancellation: connection.cancellation(),
            connection: Arc::new(Mutex::new(connection)),
        },
    );
    Ok(operation_id)
}

#[tauri::command]
pub async fn punks_follow_next(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<FollowDelivery, ClientFailure> {
    client
        .follow(&operation_id)
        .await?
        .lock()
        .await
        .next_delivery()
        .await
}

#[tauri::command]
pub async fn punks_confirm_follow_batch(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
    through_cursor: u64,
) -> Result<(), ClientFailure> {
    client
        .follow(&operation_id)
        .await?
        .lock()
        .await
        .confirm_batch(through_cursor)
        .await
}

#[tauri::command]
pub async fn punks_close_follow(
    client: tauri::State<'_, PunksDesktopClient>,
    operation_id: String,
) -> Result<(), ClientFailure> {
    let entry = client.follows.lock().await.remove(&operation_id);
    let Some(entry) = entry else {
        return Ok(());
    };
    entry.cancellation.cancel();
    let result = entry.connection.lock().await.close().await;
    result
}

/// Payload for posting a root Message or a reply in a Workspace Stream.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostTextInput {
    conversation_id: String,
    content: String,
    topic: Option<String>,
    reply_to_message_id: Option<String>,
}

#[tauri::command]
/// Posts one explicit Message intent through the generation-bound session.
pub async fn punks_post_message(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: PostTextInput,
) -> Result<MessageView, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .post_text(
            &input.conversation_id,
            &input.content,
            input.topic.as_deref(),
            input.reply_to_message_id.as_deref(),
        )
        .await
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
    client
        .session(&lease)
        .await?
        .add_reaction(&input.conversation_id, &input.message_id, &input.reaction)
        .await
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
