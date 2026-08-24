use std::{collections::HashMap, sync::Arc};

use punks_account_client::{
    ceremony::{
        logout_local_first, Ceremony, CeremonyPhase, QuarantineJar, RenewalPolicy, RevocationQueue,
        SessionMetadata, SessionPersistence, SystemClock,
    },
    desktop_auth::DesktopAuthClient,
    AccountSession, AuthorReference, AuthorSummary, ClientDistribution, ClientFailure,
    ClientPlatform, DesktopCompatibility, FollowCancellation, FollowConnection, FollowDelivery,
    MessagePage, MessageView, PunksAccountClient, PunksNavigationTarget, ReactionMutationResult,
    StreamSummary, StreamView, WorkspaceLease, WorkspaceSession, WorkspaceSummary,
};
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::punks_session_store::KeyringSessionPersistence;

#[path = "punks_message_lifecycle.rs"]
/// Tauri commands for capability-gated Message lifecycle mutations.
pub mod punks_message_lifecycle;

/// Native state for the single Punks Account and mounted Workspace.
pub struct PunksDesktopClient {
    account: Result<PunksAccountClient, ClientFailure>,
    transitions: Mutex<()>,
    sessions: Mutex<HashMap<u64, WorkspaceSession>>,
    follows: Mutex<HashMap<String, FollowEntry>>,
    /// Cérémonie de connexion desktop (issue #54) : états, quarantaine et
    /// jeton d'installation — le cookie ne franchit jamais cette frontière.
    ceremony: Mutex<CeremonyDriver>,
}

/// Vue IPC de la phase de cérémonie : aucune donnée sensible.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "phase")]
pub enum CeremonyPhaseView {
    Idle,
    Started { provider: String },
    BrowserComplete,
    Ready,
    Delivering,
    Confirmed { session_id: String },
    Cancelled,
    Expired,
    Failed { code: String },
}

/// Pilote de cérémonie : machine à états + quarantaine + client desktop.
pub struct CeremonyDriver {
    pub ceremony: Ceremony,
    pub quarantine: QuarantineJar,
    pub desktop_auth: Result<DesktopAuthClient, ClientFailure>,
}

/// File durable de révocations distantes en attente.
pub struct DurableRevocationQueue {
    directory: std::path::PathBuf,
}

impl DurableRevocationQueue {
    pub fn new(directory: std::path::PathBuf) -> Self {
        Self { directory }
    }
}

impl RevocationQueue for DurableRevocationQueue {
    fn enqueue(
        &self,
        pending: punks_account_client::ceremony::PendingRevocation,
    ) -> Result<(), String> {
        std::fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let path = self
            .directory
            .join(format!("{}.revocation.json", pending.session_id));
        if path.exists() {
            return Ok(());
        }
        let body = serde_json::json!({
            "sessionId": pending.session_id,
            "queuedAtSeconds": pending
                .queued_at
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
        std::fs::write(path, body.to_string()).map_err(|e| e.to_string())
    }
}

struct FollowEntry {
    cancellation: FollowCancellation,
    connection: Arc<Mutex<FollowConnection>>,
}

impl PunksDesktopClient {
    pub fn from_distribution() -> Self {
        let origin = option_env!("PUNKS_ORIGIN").unwrap_or("http://127.0.0.1:8787");
        let distribution = match option_env!("PUNKS_DISTRIBUTION") {
            Some("staging") => ClientDistribution::Staging,
            Some("production") => ClientDistribution::Production,
            _ => ClientDistribution::Development,
        };
        let environment = match option_env!("PUNKS_DISTRIBUTION") {
            Some("production") => "production",
            Some("staging") => "staging",
            _ => "local",
        };
        let installation_identity =
            crate::punks_session_store::load_or_create_installation_identity().map_err(|message| {
                ClientFailure::native(punks_account_client::FailureKind::Transport, message)
            });
        Self {
            account: PunksAccountClient::new(
                origin,
                env!("CARGO_PKG_VERSION"),
                distribution,
                current_platform(),
            ),
            transitions: Mutex::new(()),
            sessions: Mutex::new(HashMap::new()),
            follows: Mutex::new(HashMap::new()),
            ceremony: Mutex::new(CeremonyDriver {
                ceremony: Ceremony::new(Arc::new(SystemClock)),
                quarantine: QuarantineJar::new(),
                desktop_auth: installation_identity
                    .and_then(|identity| DesktopAuthClient::new(origin, environment, identity)),
            }),
        }
    }

    fn account(&self) -> Result<&PunksAccountClient, ClientFailure> {
        self.account.as_ref().map_err(Clone::clone)
    }

    /// Invalidates all native Punks state before a logout or Account switch
    /// can perform any further social I/O.
    async fn invalidate_local(&self) -> Result<(), ClientFailure> {
        let _transition = self.transitions.lock().await;
        self.cancel_follows().await;
        self.sessions.lock().await.clear();
        self.account()?.invalidate().await;
        let mut ceremony = self.ceremony.lock().await;
        if matches!(
            ceremony.ceremony.phase(),
            CeremonyPhase::Started { .. }
                | CeremonyPhase::BrowserComplete { .. }
                | CeremonyPhase::Ready
                | CeremonyPhase::Delivering
        ) {
            let _ = ceremony.ceremony.cancel();
        }
        ceremony.quarantine.discard();
        Ok(())
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

    async fn cancel_follows(&self) {
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

fn phase_view(phase: &CeremonyPhase) -> CeremonyPhaseView {
    match phase {
        CeremonyPhase::Idle => CeremonyPhaseView::Idle,
        CeremonyPhase::Started { provider, .. } => CeremonyPhaseView::Started {
            provider: provider.clone(),
        },
        CeremonyPhase::BrowserComplete { .. } => CeremonyPhaseView::BrowserComplete,
        CeremonyPhase::Ready => CeremonyPhaseView::Ready,
        CeremonyPhase::Delivering => CeremonyPhaseView::Delivering,
        CeremonyPhase::Confirmed { session_id } => CeremonyPhaseView::Confirmed {
            session_id: session_id.clone(),
        },
        CeremonyPhase::Cancelled => CeremonyPhaseView::Cancelled,
        CeremonyPhase::Expired => CeremonyPhaseView::Expired,
        CeremonyPhase::Failed { reason } => CeremonyPhaseView::Failed {
            code: reason.code().to_string(),
        },
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

// ── Cérémonie de connexion desktop (issue #54) ─────────────────────────────

/// Démarre la cérémonie et ouvre le navigateur système vers l'URL
/// d'autorisation (PKCE/state/verifier détenus par le Worker, ADR 0042).
#[tauri::command]
pub async fn punks_ceremony_start(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    provider: String,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.lock().await;
    let mut driver = client.ceremony.lock().await;
    let auth = driver.desktop_auth.as_ref().map_err(Clone::clone)?;
    let started = auth.start(&provider).await?;
    driver.ceremony.start(&provider).map_err(|message| {
        ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            message,
        )
    })?;
    // Le navigateur système est ouvert vers l'autorisation ; le secret de
    // session ne transite jamais par le WebView.
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(started.authorization_url.clone(), None::<&str>)
        .map_err(|_| {
            ClientFailure::native(
                punks_account_client::FailureKind::Transport,
                "navigateur système indisponible",
            )
        })?;
    Ok(phase_view(driver.ceremony.phase()))
}

/// Phase publique de la cérémonie — sans aucune donnée sensible.
#[tauri::command]
pub async fn punks_ceremony_status(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let driver = client.ceremony.lock().await;
    Ok(phase_view(driver.ceremony.phase()))
}

/// Annulation explicite : la cérémonie se ferme sans créer de session.
#[tauri::command]
pub async fn punks_ceremony_cancel(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.lock().await;
    let mut driver = client.ceremony.lock().await;
    driver.ceremony.cancel().map_err(|message| {
        ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            message,
        )
    })?;
    driver.quarantine.discard();
    Ok(phase_view(driver.ceremony.phase()))
}

/// Reçoit un deeplink `punks://session` : l'environnement du lien doit
/// correspondre à la distribution compilée, puis la livraison à usage unique
/// est consommée, validée en quarantaine, persistée et confirmée.
pub async fn handle_session_deeplink(app: tauri::AppHandle, url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "deeplink Punks invalide".to_string())?;
    if parsed.scheme() != "punks" || parsed.host_str() != Some("session") {
        return Err("seul punks://session est pris en charge".to_string());
    }
    let params: std::collections::HashMap<String, String> = parsed
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let delivery_token = params.get("delivery").cloned().unwrap_or_default();
    let environment = params.get("environment").cloned().unwrap_or_default();
    if delivery_token.is_empty() {
        return Err("deeplink sans livraison".to_string());
    }
    use tauri::Manager;
    let client = app.state::<PunksDesktopClient>();
    let persistence = app.state::<std::sync::Arc<KeyringSessionPersistence>>();
    let expected = expected_environment();
    let _transition = client.transitions.lock().await;
    browser_complete_driver(
        &client.ceremony,
        &environment,
        &delivery_token,
        &expected,
        persistence.inner().as_ref(),
    )
    .await
    .map(|_| ())
    .map_err(|failure| failure.message)
}

fn expected_environment() -> String {
    match option_env!("PUNKS_DISTRIBUTION") {
        Some("production") => "production".to_string(),
        Some("staging") => "staging".to_string(),
        _ => "local".to_string(),
    }
}

async fn browser_complete_driver(
    ceremony_lock: &Mutex<CeremonyDriver>,
    environment: &str,
    delivery_token: &str,
    expected_environment: &str,
    persistence: &KeyringSessionPersistence,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let mut driver = ceremony_lock.lock().await;
    let expected = expected_environment;
    if let Err(reason) = driver.ceremony.browser_complete(&environment, &expected) {
        driver.ceremony.fail(reason.clone());
        return Err(ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            reason.code(),
        ));
    }
    if let Err(reason) = driver.ceremony.begin_delivery() {
        driver.ceremony.fail(reason.clone());
        return Err(ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            reason.code(),
        ));
    }
    let auth = match &driver.desktop_auth {
        Ok(auth) => auth.clone(),
        Err(failure) => return Err(failure.clone()),
    };
    let delivered = match auth.deliver(&delivery_token).await {
        Ok(delivered) => delivered,
        Err(failure) => {
            driver.quarantine.discard();
            driver
                .ceremony
                .fail(punks_account_client::ceremony::CeremonyFailure::ProviderError);
            return Err(failure);
        }
    };
    // Quarantaine : le cookie livré vit isolé jusqu'à validation réussie,
    // puis est transféré par propriété vers la persistance OS.
    driver.quarantine.deposit(delivered.cookie);
    let Some(quarantined) = driver.quarantine.take_secret() else {
        driver
            .ceremony
            .fail(punks_account_client::ceremony::CeremonyFailure::ValidationFailed);
        return Err(ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            "quarantaine vide",
        ));
    };
    let validated = match auth.validate(&quarantined).await {
        Ok(validated) => validated,
        Err(failure) => {
            driver
                .ceremony
                .fail(punks_account_client::ceremony::CeremonyFailure::ValidationFailed);
            return Err(failure);
        }
    };
    if let Err(reason) = driver.ceremony.quarantine_validated() {
        driver.ceremony.fail(reason.clone());
        return Err(ClientFailure::native(
            punks_account_client::FailureKind::ContractViolation,
            reason.code(),
        ));
    }
    let metadata = SessionMetadata {
        session_id: validated.session_id.clone(),
        punk_id: validated.punk_id.clone(),
        expires_at: validated.expires_at,
        last_renewed_at: None,
    };
    if persistence.persist(&quarantined, &metadata).is_err() {
        driver
            .ceremony
            .fail(punks_account_client::ceremony::CeremonyFailure::ValidationFailed);
        return Err(ClientFailure::native(
            punks_account_client::FailureKind::Transport,
            "stockage sécurisé OS indisponible",
        ));
    }
    driver
        .ceremony
        .confirm(&validated.session_id)
        .map_err(|reason| {
            ClientFailure::native(
                punks_account_client::FailureKind::ContractViolation,
                reason.code(),
            )
        })?;
    Ok(phase_view(driver.ceremony.phase()))
}

/// Renouvellement glissant : 30 jours, seuil de 7 jours, une fois par 24 h.
#[tauri::command]
pub async fn punks_session_renew(
    client: tauri::State<'_, PunksDesktopClient>,
    persistence: tauri::State<'_, std::sync::Arc<KeyringSessionPersistence>>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.lock().await;
    let driver = client.ceremony.lock().await;
    let auth = match &driver.desktop_auth {
        Ok(auth) => auth.clone(),
        Err(failure) => return Err(failure.clone()),
    };
    let (secret, metadata) = persistence
        .load()
        .map_err(|_| {
            ClientFailure::native(
                punks_account_client::FailureKind::Transport,
                "stockage sécurisé OS indisponible",
            )
        })?
        .ok_or_else(|| {
            ClientFailure::native(
                punks_account_client::FailureKind::ContractViolation,
                "aucune session persistée",
            )
        })?;
    let policy = RenewalPolicy;
    if !policy.should_renew(
        std::time::SystemTime::now(),
        metadata.expires_at,
        metadata.last_renewed_at,
    ) {
        return Ok(phase_view(driver.ceremony.phase()));
    }
    let renewed = auth.renew(&secret).await?;
    let new_metadata = SessionMetadata {
        session_id: renewed.session_id,
        punk_id: renewed.punk_id,
        expires_at: renewed.expires_at,
        last_renewed_at: Some(std::time::SystemTime::now()),
    };
    persistence
        .persist(&renewed.cookie, &new_metadata)
        .map_err(|_| {
            ClientFailure::native(
                punks_account_client::FailureKind::Transport,
                "stockage sécurisé OS indisponible",
            )
        })?;
    // The renewed secret must replace the in-memory jar as well; otherwise a
    // later Workspace request would continue using the pre-renewal cookie.
    client.account()?.install_session_secret(&renewed.cookie)?;
    Ok(phase_view(driver.ceremony.phase()))
}

/// Déconnexion local-first : l'état local meurt d'abord, puis la révocation
/// distante part immédiatement ou reste en file durable.
#[tauri::command]
pub async fn punks_logout(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    persistence: tauri::State<'_, std::sync::Arc<KeyringSessionPersistence>>,
) -> Result<String, ClientFailure> {
    // Local invalidation is deliberately first: FOLLOWs, Workspace leases,
    // query bodies and callbacks are dead before persistence or remote
    // revocation is touched.
    client.invalidate_local().await?;
    let _transition = client.transitions.lock().await;
    let loaded = persistence.load().map_err(|_| {
        ClientFailure::native(
            punks_account_client::FailureKind::Transport,
            "stockage sécurisé OS indisponible",
        )
    })?;
    let queue = DurableRevocationQueue::new(revocation_directory(&app));
    match loaded {
        Some((secret, metadata)) => {
            let driver = client.ceremony.lock().await;
            let revoke = async {
                match driver.desktop_auth.as_ref() {
                    Ok(auth) => auth.revoke(&secret).await.map(|_| ()).map_err(|_| ()),
                    Err(_) => Err(()),
                }
            };
            let outcome = logout_local_first(persistence.as_ref(), &queue, &metadata, revoke)
                .await
                .map_err(|_| {
                    ClientFailure::native(
                        punks_account_client::FailureKind::Transport,
                        "déconnexion locale impossible",
                    )
                })?;
            match outcome {
                punks_account_client::ceremony::LogoutOutcome::Revoked => Ok("revoked".to_string()),
                punks_account_client::ceremony::LogoutOutcome::Queued => Ok("queued".to_string()),
            }
        }
        None => {
            // Sans session persistée, la déconnexion reste local-first totale.
            persistence.destroy().map_err(|_| {
                ClientFailure::native(
                    punks_account_client::FailureKind::Transport,
                    "stockage sécurisé OS indisponible",
                )
            })?;
            Ok("revoked".to_string())
        }
    }
}

fn revocation_directory(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("punks-revocations")
}

#[tauri::command]
pub async fn punks_check_compatibility(
    client: tauri::State<'_, PunksDesktopClient>,
) -> Result<DesktopCompatibility, ClientFailure> {
    let _transition = client.transitions.lock().await;
    client.account()?.check_compatibility().await
}

#[tauri::command]
pub async fn punks_get_session(
    client: tauri::State<'_, PunksDesktopClient>,
    persistence: tauri::State<'_, std::sync::Arc<KeyringSessionPersistence>>,
) -> Result<AccountSession, ClientFailure> {
    let _transition = client.transitions.lock().await;
    let loaded = persistence.load().map_err(|_| {
        ClientFailure::native(
            punks_account_client::FailureKind::Transport,
            "stockage sécurisé OS indisponible",
        )
    })?;
    match loaded {
        Some((secret, metadata)) => {
            let result = client.account()?.restore_session(&secret, &metadata).await;
            if matches!(
                result.as_ref().err().map(|failure| failure.kind),
                Some(punks_account_client::FailureKind::SessionExpired)
            ) {
                // A revoked or mixed-up persisted cookie must not be retried
                // forever, and its contents never cross the IPC boundary.
                let _ = persistence.destroy();
            }
            result
        }
        None => client.account()?.get_session().await,
    }
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
    let _transition = client.transitions.lock().await;
    client.account()?.list_workspaces().await
}

#[tauri::command]
pub async fn punks_resolve_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    id_or_slug: String,
) -> Result<Option<WorkspaceSummary>, ClientFailure> {
    let _transition = client.transitions.lock().await;
    client.account()?.resolve_workspace(&id_or_slug).await
}

#[tauri::command]
pub async fn punks_open_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    workspace_id: String,
) -> Result<WorkspaceLease, ClientFailure> {
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
    let session = client.session(&lease).await?;
    client.cancel_follows().await;
    session.close().await;
    client.sessions.lock().await.remove(&lease.generation);
    Ok(())
}

#[tauri::command]
pub async fn punks_list_streams(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<Vec<StreamSummary>, ClientFailure> {
    let _transition = client.transitions.lock().await;
    client.session(&lease).await?.list_streams().await
}

#[tauri::command]
pub async fn punks_get_stream(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    conversation_id: String,
) -> Result<StreamView, ClientFailure> {
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
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
    let _transition = client.transitions.lock().await;
    client
        .session(&lease)
        .await?
        .remove_reaction(&input.conversation_id, &input.message_id, &input.reaction)
        .await
}
