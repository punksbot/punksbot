#![forbid(unsafe_code)]

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use reqwest::{cookie::Jar, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use social_validation::{
    validate_message_page_runtime, validate_stream_summary, validate_stream_view,
};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use validation::{directory_path, parse_origin, validate_history_cursor, validate_uuid};

/// Projection Rust générée des contrats du profil `desktop-social-loop@1`
/// (source : `cloudflare/packages/contracts`, générateur `generate-artifacts.mjs`).
#[allow(dead_code, non_snake_case, clippy::all)]
pub mod contracts_profile {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../cloudflare/packages/contracts/generated/rust/punks_contracts.rs"
    ));
}

mod authors;
pub mod ceremony;
pub mod desktop_auth;
mod failure;
mod follow;
mod follow_connection;
mod message_mutations;
mod message_search;
mod native_auth;
mod presence;
mod presence_connection;
mod profiles;
mod promotion_audit;
mod semantic_trace;
mod session;
mod social_validation;
mod transport;
mod validation;
mod workspace_governance;

pub use authors::{AuthorReference, AuthorSummary};
pub use failure::{ClientFailure, FailureKind};
pub use follow::{
    confirm_follow_batch, reduce_follow_frame, ClientResyncReason, ConversationUnavailableReason,
    FollowConfirmation, FollowEffect, FollowPhase, FollowReduction, FollowServerFrame, FollowState,
};
pub use follow_connection::{FollowCancellation, FollowConnection, FollowDelivery};
pub use message_mutations::MessageReplyTarget;
pub use message_search::{
    MessageSearchCompleteness, MessageSearchPage, MessageSearchPartialReason,
};
pub use presence::{
    reduce_presence_frame, PresenceAvailability, PresenceDegradedReason, PresenceDelivery,
    PresenceEffect, PresenceReduction, PresenceServerFrame, PresenceState, PresenceTypingPatch,
    PresenceView,
};
pub use presence_connection::{PresenceCancellation, PresenceConnection};
pub use profiles::{
    PunkProfile, PunkPublicSummary, PunkSearchInput, PunkSearchPage, PunkSummaryPage,
};
pub use semantic_trace::{
    normalize_semantic_trace, run_semantic_scenario, SemanticEvent, SemanticObservation,
    SemanticTrace,
};
#[cfg(test)]
use transport::TestHandler;
use transport::{decode, HttpTransport, RequestSafety, Transport};
pub use validation::{validate_navigation_url, PunksNavigationTarget};
pub use workspace_governance::{
    ClaimWorkspaceInvitationResult, CreateWorkspaceInvitationResult,
    RevokeWorkspaceInvitationResult, WorkspaceGovernanceMetadata, WorkspaceGovernancePage,
    WorkspaceInvitationRole, WorkspaceInvitationView, WorkspaceMembershipLifecycleResult,
    WorkspaceMembershipMutationResult, WorkspaceRole,
};

/// Build distribution used by the Compatibility handshake.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientDistribution {
    Development,
    Staging,
    Production,
}

/// Supported packaged desktop platform identifier.
#[derive(Debug, Clone, Copy, Serialize)]
pub enum ClientPlatform {
    #[serde(rename = "macos-arm64")]
    MacosArm64,
    #[serde(rename = "macos-x64")]
    MacosX64,
    #[serde(rename = "linux-x64")]
    LinuxX64,
    #[serde(rename = "windows-x64")]
    WindowsX64,
}

/// Compatibility result pinned to one distribution origin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopCompatibility {
    pub contract: String,
    pub compatible: bool,
    pub profile: String,
    pub registry_version: u32,
    pub minimum_client_version: String,
    pub environment: String,
    pub origin: String,
    pub capabilities: Vec<String>,
}

/// Non-secret Punk summary included in the Account Session view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PunkSummary {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

/// Account Session view. The cookie itself never crosses this interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSession {
    pub session_id: String,
    pub punk_id: String,
    pub authenticated_at: String,
    pub expires_at: String,
    pub recent_reauth_until: Option<String>,
    pub punk: PunkSummary,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionEnvelope {
    session: AccountSession,
}

/// Accessible Workspace projection returned by the private directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSummary {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: String,
    pub role: String,
    pub revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceListResponse {
    contract: String,
    items: Vec<WorkspaceSummary>,
    next_cursor: Option<String>,
}

/// Active Stream projection returned by the private directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamSummary {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub stream_type: String,
    pub visibility: String,
    pub description: Option<String>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    pub topic_required: bool,
    pub ttl_seconds: Option<u64>,
    pub ttl_deadline: Option<String>,
    pub revision: u64,
    pub cursor: u64,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamListResponse {
    contract: String,
    workspace_id: String,
    items: Vec<StreamSummary>,
    next_cursor: Option<String>,
}

/// Full Stream view returned by its authoritative Conversation Durable Object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamView {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub stream_type: String,
    pub visibility: String,
    pub description: Option<String>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    pub topic_required: bool,
    pub max_members: Option<u64>,
    pub ttl_seconds: Option<u64>,
    pub ttl_deadline: Option<String>,
    pub status: String,
    pub revision: u64,
    pub cursor: u64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StreamEnvelope {
    conversation: StreamView,
}

/// Stable author coordinates admitted into desktop collaborative caches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MessageAuthor {
    Punk {
        #[serde(rename = "punkId")]
        punk_id: String,
    },
    Bot {
        #[serde(rename = "installationId")]
        installation_id: String,
    },
}

/// Generated-shape Message view used by timelines and mutation acknowledgements.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageView {
    pub id: String,
    pub workspace_id: String,
    pub conversation_id: String,
    pub author: MessageAuthor,
    pub message_type: String,
    pub status: String,
    pub content: Option<String>,
    pub topic: Option<String>,
    pub mentioned_punk_ids: Vec<String>,
    pub media_ids: Vec<String>,
    pub parent_message_id: Option<String>,
    pub thread_root_message_id: String,
    pub thread_depth: u64,
    pub broadcast: bool,
    pub reply_count: u64,
    pub descendant_count: u64,
    pub last_reply_at: Option<String>,
    pub current_version: Option<u64>,
    pub retraction_kind: Option<String>,
    pub retracted_at: Option<String>,
    pub erase_after: Option<String>,
    pub public_reason: Option<String>,
    pub erased_at: Option<String>,
    pub revision: u64,
    pub created_cursor: u64,
    pub cursor: u64,
    pub created_at: String,
    pub updated_at: String,
    pub edited_at: Option<String>,
}

/// One authoritative Message page with an opaque continuation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessagePage {
    pub workspace_id: String,
    pub conversation_id: String,
    pub high_water_cursor: u64,
    pub order: String,
    pub items: Vec<MessageView>,
    pub next_cursor: Option<String>,
}

/// Authoritative acknowledgement for a Message lifecycle mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageMutationResponse {
    pub message: MessageView,
    pub replayed: bool,
}

/// Authoritative Reaction view returned by add/remove operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionView {
    pub id: String,
    pub workspace_id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub actor: MessageAuthor,
    pub reaction: String,
    pub reacted_at: String,
}

/// Result of an explicit add/remove Reaction intent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionMutationResult {
    pub reaction: Option<ReactionView>,
    pub effect: String,
    pub replayed: bool,
}

/// Coordinates and generation for exactly one mounted Workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceLease {
    pub origin: String,
    pub punk_id: String,
    pub workspace_id: String,
    pub generation: u64,
}

#[derive(Default)]
struct AccountState {
    compatibility: Option<DesktopCompatibility>,
    session: Option<AccountSession>,
    workspaces_by_id: HashMap<String, WorkspaceSummary>,
    workspace_ids_by_slug: HashMap<String, String>,
    generation: u64,
    active_lease: Option<WorkspaceLease>,
    active_cancellation: Option<CancellationToken>,
    active_operations: Option<Arc<RwLock<()>>>,
}

struct AccountInner {
    origin: String,
    client_version: String,
    distribution: ClientDistribution,
    platform: ClientPlatform,
    transport: Transport,
    state: Mutex<AccountState>,
}

/// Semantic Account client that owns HTTP, cookies and Workspace generations.
#[derive(Clone)]
pub struct PunksAccountClient {
    inner: Arc<AccountInner>,
}

impl PunksAccountClient {
    fn invalidate_workspace_state(state: &mut AccountState) -> Option<Arc<RwLock<()>>> {
        if let Some(cancellation) = state.active_cancellation.take() {
            cancellation.cancel();
        }
        let active_operations = state.active_operations.take();
        state.active_lease = None;
        state.generation = state.generation.saturating_add(1);
        active_operations
    }

    /// Builds an Account client with a private cookie jar pinned to one origin.
    pub fn new(
        origin: &str,
        client_version: impl Into<String>,
        distribution: ClientDistribution,
        platform: ClientPlatform,
    ) -> Result<Self, ClientFailure> {
        let origin_url = parse_origin(origin)?;
        let jar = Arc::new(Jar::default());
        let client = Client::builder()
            .cookie_provider(Arc::clone(&jar))
            .build()
            .map_err(|_| {
                ClientFailure::new(
                    FailureKind::Transport,
                    "Punks HTTP client could not be initialized",
                )
            })?;
        Ok(Self::from_transport(
            origin_url.origin().ascii_serialization(),
            client_version.into(),
            distribution,
            platform,
            Transport::Http(HttpTransport {
                client,
                jar,
                origin: origin_url,
            }),
        ))
    }

    fn from_transport(
        origin: String,
        client_version: String,
        distribution: ClientDistribution,
        platform: ClientPlatform,
        transport: Transport,
    ) -> Self {
        Self {
            inner: Arc::new(AccountInner {
                origin,
                client_version,
                distribution,
                platform,
                transport,
                state: Mutex::new(AccountState::default()),
            }),
        }
    }

    #[cfg(test)]
    fn with_test_transport(
        origin: &str,
        client_version: &str,
        distribution: ClientDistribution,
        platform: ClientPlatform,
        handler: TestHandler,
    ) -> Result<Self, ClientFailure> {
        let origin = parse_origin(origin)?.origin().ascii_serialization();
        Ok(Self::from_transport(
            origin,
            client_version.to_owned(),
            distribution,
            platform,
            Transport::Test(handler),
        ))
    }

    /// Confirms the exact client profile before any Account or Workspace read.
    pub async fn check_compatibility(&self) -> Result<DesktopCompatibility, ClientFailure> {
        let response = self
            .inner
            .transport
            .request(
                Method::POST,
                "/api/v1/desktop/compatibility".to_owned(),
                Some(json!({
                    "contract": "desktop.compatibility@1",
                    "profile": "desktop-social-loop@1",
                    "clientVersion": self.inner.client_version,
                    "distribution": self.inner.distribution,
                    "platform": self.inner.platform,
                })),
                RequestSafety::Read,
            )
            .await?;
        let compatibility: DesktopCompatibility =
            decode("desktop.compatibility-response@1", response)?;
        if compatibility.contract != "desktop.compatibility-response@1"
            || compatibility.profile != "desktop-social-loop@1"
            || compatibility.registry_version != 1
            || compatibility.origin != self.inner.origin
        {
            return Err(ClientFailure::contract("desktop.compatibility-response@1"));
        }
        self.inner.state.lock().await.compatibility = Some(compatibility.clone());
        Ok(compatibility)
    }

    /// Returns the current Account Session view without exposing its cookie.
    pub async fn get_session(&self) -> Result<AccountSession, ClientFailure> {
        self.require_compatible().await?;
        let response = match self
            .inner
            .transport
            .request(
                Method::GET,
                "/api/auth/v1/session".to_owned(),
                None,
                RequestSafety::Read,
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                if matches!(
                    error.kind,
                    FailureKind::SessionExpired | FailureKind::AccountMerged
                ) {
                    self.clear_account_session().await;
                }
                return Err(error);
            }
        };
        let envelope: SessionEnvelope = decode("auth.session@1", response)?;
        self.inner.state.lock().await.session = Some(envelope.session.clone());
        Ok(envelope.session)
    }

    /// Lists every currently accessible Workspace using opaque continuations.
    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceSummary>, ClientFailure> {
        self.require_compatible().await?;
        let mut items = Vec::new();
        let mut seen_cursors = HashSet::new();
        let mut cursor: Option<String> = None;
        loop {
            let path = directory_path("/api/v1/workspaces", cursor.as_deref())?;
            let response = self
                .inner
                .transport
                .request(Method::GET, path, None, RequestSafety::Read)
                .await?;
            let page: WorkspaceListResponse = decode("workspace.list-response@1", response)?;
            if page.contract != "workspace.list-response@1" {
                return Err(ClientFailure::contract("workspace.list-response@1"));
            }
            items.extend(page.items);
            if page
                .next_cursor
                .as_ref()
                .is_some_and(|next| !seen_cursors.insert(next.clone()))
            {
                return Err(ClientFailure::contract("workspace.list-response@1"));
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        let mut workspaces_by_id = HashMap::new();
        let mut workspace_ids_by_slug = HashMap::new();
        for workspace in &items {
            validate_uuid(&workspace.id, "workspaceId")?;
            if workspaces_by_id
                .insert(workspace.id.clone(), workspace.clone())
                .is_some()
                || workspace_ids_by_slug
                    .insert(workspace.slug.clone(), workspace.id.clone())
                    .is_some()
            {
                return Err(ClientFailure::contract("workspace.list-response@1"));
            }
        }
        let mut state = self.inner.state.lock().await;
        state.workspaces_by_id = workspaces_by_id;
        state.workspace_ids_by_slug = workspace_ids_by_slug;
        Ok(items)
    }

    /// Resolves a durable Workspace UUID, refreshing the authorized directory once.
    pub async fn resolve_workspace_by_id(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceSummary>, ClientFailure> {
        validate_uuid(workspace_id, "workspaceId")?;
        if let Some(workspace) = self
            .inner
            .state
            .lock()
            .await
            .workspaces_by_id
            .get(workspace_id)
            .cloned()
        {
            return Ok(Some(workspace));
        }
        self.list_workspaces().await?;
        Ok(self
            .inner
            .state
            .lock()
            .await
            .workspaces_by_id
            .get(workspace_id)
            .cloned())
    }

    /// Resolves a canonical route slug without conflating it with a durable UUID.
    pub async fn resolve_workspace_by_slug(
        &self,
        workspace_slug: &str,
    ) -> Result<Option<WorkspaceSummary>, ClientFailure> {
        let resolve_cached = |state: &AccountState| {
            state
                .workspace_ids_by_slug
                .get(workspace_slug)
                .and_then(|workspace_id| state.workspaces_by_id.get(workspace_id))
                .cloned()
        };
        if let Some(workspace) = resolve_cached(&*self.inner.state.lock().await) {
            return Ok(Some(workspace));
        }
        self.list_workspaces().await?;
        Ok(resolve_cached(&*self.inner.state.lock().await))
    }

    /// Opens the only active Workspace and invalidates every older generation.
    pub async fn open_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceSession, ClientFailure> {
        validate_uuid(workspace_id, "workspaceId")?;
        self.require_compatible().await?;
        let (opening_generation, cached_session, previous_operations) = {
            let mut state = self.inner.state.lock().await;
            let previous_operations = Self::invalidate_workspace_state(&mut state);
            (state.generation, state.session.clone(), previous_operations)
        };
        if let Some(previous_operations) = previous_operations {
            let _closed = previous_operations.write().await;
        }
        let session = match cached_session {
            Some(session) => session,
            None => self.get_session().await?,
        };
        if self.inner.state.lock().await.generation != opening_generation {
            return Err(ClientFailure::stale_workspace());
        }
        let workspace = self.resolve_workspace_by_id(workspace_id).await?;
        if workspace.as_ref().map(|value| value.id.as_str()) != Some(workspace_id) {
            return Err(ClientFailure::new(
                FailureKind::Problem,
                "Workspace is not accessible",
            ));
        }
        let mut state = self.inner.state.lock().await;
        if state.generation != opening_generation {
            return Err(ClientFailure::stale_workspace());
        }
        let lease = WorkspaceLease {
            origin: self.inner.origin.clone(),
            punk_id: session.punk_id,
            workspace_id: workspace_id.to_owned(),
            generation: opening_generation,
        };
        let cancellation = CancellationToken::new();
        let operations = Arc::new(RwLock::new(()));
        state.active_lease = Some(lease.clone());
        state.active_cancellation = Some(cancellation.clone());
        state.active_operations = Some(Arc::clone(&operations));
        Ok(WorkspaceSession {
            inner: Arc::clone(&self.inner),
            lease,
            device_id: uuid::Uuid::new_v4().to_string(),
            cancellation,
            operations,
        })
    }

    async fn require_compatible(&self) -> Result<(), ClientFailure> {
        if self
            .inner
            .state
            .lock()
            .await
            .compatibility
            .as_ref()
            .is_some_and(|value| value.compatible)
        {
            return Ok(());
        }
        Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "desktop-social-loop@1 compatibility must be confirmed first",
        ))
    }
}

/// Semantic operations scoped to one generation-bound Workspace.
#[derive(Clone)]
pub struct WorkspaceSession {
    inner: Arc<AccountInner>,
    lease: WorkspaceLease,
    device_id: String,
    cancellation: CancellationToken,
    operations: Arc<RwLock<()>>,
}

impl WorkspaceSession {
    /// Returns the immutable coordinates carried by this session.
    pub fn lease(&self) -> &WorkspaceLease {
        &self.lease
    }

    /// Invalidates this session when it is still the active generation.
    pub async fn close(&self) {
        self.cancellation.cancel();
        let active_operations = {
            let mut state = self.inner.state.lock().await;
            if state.active_lease.as_ref() == Some(&self.lease) {
                PunksAccountClient::invalidate_workspace_state(&mut state)
            } else {
                None
            }
        };
        if let Some(active_operations) = active_operations {
            let _closed = active_operations.write().await;
        }
    }

    async fn invalidate_departed_workspace(&self) {
        self.cancellation.cancel();
        let active_operations = {
            let mut state = self.inner.state.lock().await;
            state.workspaces_by_id.remove(&self.lease.workspace_id);
            state
                .workspace_ids_by_slug
                .retain(|_, workspace_id| workspace_id != &self.lease.workspace_id);
            if state.active_lease.as_ref() == Some(&self.lease) {
                PunksAccountClient::invalidate_workspace_state(&mut state)
            } else {
                None
            }
        };
        if let Some(active_operations) = active_operations {
            let _closed = active_operations.write().await;
        }
    }

    async fn record_membership_role(&self, role: &str, revision: u64) {
        let mut state = self.inner.state.lock().await;
        if state.active_lease.as_ref() != Some(&self.lease) {
            return;
        }
        if let Some(workspace) = state.workspaces_by_id.get_mut(&self.lease.workspace_id) {
            workspace.role = role.to_owned();
            workspace.revision = revision;
        }
    }

    pub(crate) async fn request(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
        safety: RequestSafety,
    ) -> Result<Value, ClientFailure> {
        let _operation = self.operations.read().await;
        self.assert_current().await?;
        let cancellation = self.cancellation.clone();
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(ClientFailure::new(
                if matches!(safety, RequestSafety::Mutation) {
                    FailureKind::Ambiguous
                } else {
                    FailureKind::Cancelled
                },
                if matches!(safety, RequestSafety::Mutation) {
                    "Punks mutation was cancelled with an ambiguous result"
                } else {
                    "Punks Workspace operation was cancelled"
                },
            )),
            result = self.inner.transport.request(method, path, body, safety) => result,
        }
    }

    /// Lists active Streams reauthorized by their owning Durable Objects.
    pub async fn list_streams(&self) -> Result<Vec<StreamSummary>, ClientFailure> {
        self.assert_current().await?;
        let mut items = Vec::new();
        let mut seen_stream_ids = HashSet::new();
        let mut seen_cursors = HashSet::new();
        let mut cursor: Option<String> = None;
        loop {
            self.assert_current().await?;
            let base = format!(
                "/api/v1/workspaces/{}/conversations",
                self.lease.workspace_id
            );
            let path = directory_path(&base, cursor.as_deref())?;
            let response = self
                .request(Method::GET, path, None, RequestSafety::Read)
                .await?;
            self.assert_current().await?;
            let page: StreamListResponse = decode("conversation.list-response@1", response)?;
            self.assert_current().await?;
            if page.contract != "conversation.list-response@1"
                || page.workspace_id != self.lease.workspace_id
                || page.items.len() > 100
            {
                return Err(ClientFailure::contract("conversation.list-response@1"));
            }
            for stream in &page.items {
                validate_stream_summary(stream, &self.lease.workspace_id)?;
                if !seen_stream_ids.insert(stream.id.clone()) {
                    return Err(ClientFailure::contract("conversation.list-response@1"));
                }
            }
            items.extend(page.items);
            if let Some(next_cursor) = &page.next_cursor {
                validation::validate_directory_cursor(next_cursor)?;
            }
            if page
                .next_cursor
                .as_ref()
                .is_some_and(|next| !seen_cursors.insert(next.clone()))
            {
                return Err(ClientFailure::contract("conversation.list-response@1"));
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        self.assert_current().await?;
        Ok(items)
    }

    /// Loads one Stream detail through the active Workspace lease.
    pub async fn get_stream(&self, conversation_id: &str) -> Result<StreamView, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        self.assert_current().await?;
        let response = self
            .request(
                Method::GET,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}",
                    self.lease.workspace_id
                ),
                None,
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let envelope: StreamEnvelope = decode("conversation.view@1", response)?;
        self.assert_current().await?;
        validate_stream_view(
            &envelope.conversation,
            &self.lease.workspace_id,
            conversation_id,
        )?;
        Ok(envelope.conversation)
    }

    /// Loads an authoritative timeline page with an opaque continuation.
    pub async fn get_timeline(
        &self,
        conversation_id: &str,
        limit: Option<u16>,
        cursor: Option<&str>,
    ) -> Result<MessagePage, ClientFailure> {
        self.get_message_page(conversation_id, None, limit, cursor)
            .await
    }

    /// Loads an authoritative thread page with an opaque continuation.
    pub async fn get_thread(
        &self,
        conversation_id: &str,
        thread_root_message_id: &str,
        limit: Option<u16>,
        cursor: Option<&str>,
    ) -> Result<MessagePage, ClientFailure> {
        validate_uuid(thread_root_message_id, "threadRootMessageId")?;
        self.get_message_page(conversation_id, Some(thread_root_message_id), limit, cursor)
            .await
    }

    async fn get_message_page(
        &self,
        conversation_id: &str,
        thread_root_message_id: Option<&str>,
        limit: Option<u16>,
        cursor: Option<&str>,
    ) -> Result<MessagePage, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        if limit.is_some_and(|value| value == 0 || value > 100) {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "Message page limit must be between 1 and 100",
            ));
        }
        self.assert_current().await?;
        let mut query = Vec::new();
        if let Some(limit) = limit {
            query.push(format!("limit={limit}"));
        }
        if let Some(thread_root_message_id) = thread_root_message_id {
            query.push(format!("threadRootMessageId={thread_root_message_id}"));
        }
        if let Some(cursor) = cursor {
            validate_history_cursor(cursor)?;
            query.push(format!("cursor={cursor}"));
        }
        let suffix = if query.is_empty() {
            String::new()
        } else {
            format!("?{}", query.join("&"))
        };
        let response = self
            .request(
                Method::GET,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages{suffix}",
                    self.lease.workspace_id
                ),
                None,
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let page: MessagePage = decode("message.history-response@1", response)?;
        self.assert_current().await?;
        if page.workspace_id != self.lease.workspace_id
            || page.conversation_id != conversation_id
            || page.order != "createdCursor-ascending"
        {
            return Err(ClientFailure::contract("message.history-response@1"));
        }
        if let Some(next_cursor) = &page.next_cursor {
            validate_history_cursor(next_cursor)?;
        }
        validate_message_page_runtime(
            &page,
            &self.lease.workspace_id,
            conversation_id,
            thread_root_message_id,
        )?;
        Ok(page)
    }
}

#[cfg(test)]
mod tests;
