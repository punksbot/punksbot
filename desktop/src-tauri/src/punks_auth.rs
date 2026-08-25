//! Native orchestration for the recoverable desktop authentication ceremony.

#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use punks_account_client::ceremony::{
    AuthenticationMethod, NativeVerifier, PendingAuthIntent, PendingAuthPhase, QuarantineJar,
    RenewalPolicy,
};
use punks_account_client::desktop_auth::{
    ClaimedDelivery, ClaimedSession, DesktopAuthClient, DesktopAuthStatus,
};
use punks_account_client::{ClientFailure, FailureKind};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::punks_auth_state::NativeAuthenticationRuntime;
pub use crate::punks_auth_state::{AccountSessionStateView, CeremonyPhaseView};
use crate::punks_client::PunksDesktopClient;
use crate::punks_session_store::{
    KeyringSessionPersistence, PendingAuthFlow, PendingAuthPurpose, PendingReauthorization,
    PendingRenewal, QueuedRevocation, StagedActivation,
};

fn native_failure(kind: FailureKind, message: &'static str) -> ClientFailure {
    ClientFailure::native(kind, message)
}

fn store_failure() -> ClientFailure {
    native_failure(
        FailureKind::Transport,
        "Punks secure Account storage is unavailable",
    )
}

fn phase_for_pending(flow: &PendingAuthFlow) -> CeremonyPhaseView {
    match flow.phase {
        PendingAuthPhase::Started => CeremonyPhaseView::Started {
            intent: flow.intent.as_str().to_string(),
            method: flow.method.as_str().to_string(),
        },
        PendingAuthPhase::BrowserComplete => CeremonyPhaseView::BrowserComplete,
        PendingAuthPhase::Ready => CeremonyPhaseView::Ready,
        PendingAuthPhase::Delivering => CeremonyPhaseView::Delivering,
        // A server-confirmed flow is not locally confirmed until the durable
        // activation/authorization marker has been reconciled.
        PendingAuthPhase::Confirmed => CeremonyPhaseView::Delivering,
        PendingAuthPhase::Cancelled => CeremonyPhaseView::Cancelled,
        PendingAuthPhase::Expired => CeremonyPhaseView::Expired,
    }
}

fn phase_for_status(flow: &PendingAuthFlow, status: &DesktopAuthStatus) -> CeremonyPhaseView {
    match (status.phase, status.outcome_code.as_deref()) {
        (PendingAuthPhase::Cancelled, Some("cancelled")) => CeremonyPhaseView::Cancelled,
        (PendingAuthPhase::Expired, _) | (_, Some("expired")) => CeremonyPhaseView::Expired,
        (PendingAuthPhase::Cancelled, Some(code)) => CeremonyPhaseView::Failed {
            code: code.to_string(),
        },
        _ => phase_for_pending(flow),
    }
}

fn pending_purpose(value: PendingAuthPurpose) -> &'static str {
    match value {
        PendingAuthPurpose::LinkGoogle => "link_google",
        PendingAuthPurpose::LinkGithub => "link_github",
        PendingAuthPurpose::RegisterPasskey => "register_passkey",
    }
}

fn parse_method(value: &str) -> Result<AuthenticationMethod, ClientFailure> {
    AuthenticationMethod::try_from(value)
        .map_err(|_| native_failure(FailureKind::ContractViolation, "unsupported login method"))
}

fn auth_client(runtime: &NativeAuthenticationRuntime) -> Result<DesktopAuthClient, ClientFailure> {
    runtime.client.as_ref().cloned().map_err(Clone::clone)
}

fn take_authorization(
    store: &KeyringSessionPersistence,
    target_method: AuthenticationMethod,
) -> Result<String, ClientFailure> {
    let grant = store
        .take_reauthorization(target_method)
        .map_err(|_| store_failure())?
        .ok_or_else(|| {
            native_failure(
                FailureKind::Problem,
                "a fresh targeted reauthentication is required",
            )
        })?;
    Ok(grant.authorization_id)
}

async fn cancel_existing_flow(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
) -> Result<(), ClientFailure> {
    if store
        .reread_renewal()
        .map_err(|_| store_failure())?
        .is_some()
    {
        return Err(native_failure(
            FailureKind::Ambiguous,
            "a Session rotation must be resumed before starting authentication",
        ));
    }
    let Some(flow) = store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?
    else {
        return Ok(());
    };
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    auth.cancel(&flow.flow_id, &flow.verifier).await?;
    if store
        .reread_staged_activation()
        .map_err(|_| store_failure())?
        .is_some()
    {
        let _ = store
            .discard_staged_activation()
            .map_err(|_| store_failure())?;
    } else {
        store
            .clear_pending_auth_flow()
            .map_err(|_| store_failure())?;
    }
    let mut runtime = client.authentication.lock().await;
    runtime.initiated_flow = None;
    runtime.last_phase = CeremonyPhaseView::Cancelled;
    Ok(())
}

async fn start_authentication(
    app: &tauri::AppHandle,
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
    intent: PendingAuthIntent,
    method: AuthenticationMethod,
    purpose: Option<PendingAuthPurpose>,
    authorization_id: Option<String>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    if intent == PendingAuthIntent::SwitchAccount {
        client.account()?.cancel_workspace_operations().await;
    }
    let _transition = client.transitions.write().await;
    if intent == PendingAuthIntent::SwitchAccount {
        client.invalidate_workspace_context().await?;
    }
    cancel_existing_flow(client, store).await?;
    let active = store.load_active_session().map_err(|_| store_failure())?;
    match (intent, active.is_some()) {
        (PendingAuthIntent::SignIn, false) => {}
        (PendingAuthIntent::SignIn, true) => {
            return Err(native_failure(
                FailureKind::Problem,
                "an authenticated Punk must explicitly switch Account",
            ));
        }
        (_, false) => {
            return Err(native_failure(
                FailureKind::SessionExpired,
                "an active Punks Account Session is required",
            ));
        }
        (_, true) => {}
    }
    let verifier = NativeVerifier::generate().map_err(|_| {
        native_failure(
            FailureKind::Transport,
            "native authentication entropy is unavailable",
        )
    })?;
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    let started = auth
        .start(
            intent,
            method,
            purpose.map(pending_purpose),
            authorization_id.as_deref(),
            &verifier,
            active.as_ref().map(|session| &session.cookie),
        )
        .await?;
    let absolute_expires_at = started
        .expires_at
        .checked_add(Duration::from_secs(20 * 60))
        .ok_or_else(store_failure)?;
    store
        .save_pending_auth_flow(&PendingAuthFlow {
            flow_id: started.flow_id.clone(),
            verifier,
            intent,
            method,
            purpose,
            phase: PendingAuthPhase::Started,
            phase_expires_at: started.expires_at,
            absolute_expires_at,
        })
        .map_err(|_| store_failure())?;
    {
        let mut runtime = client.authentication.lock().await;
        runtime.initiated_flow = Some(started.flow_id.clone());
        runtime.last_phase = CeremonyPhaseView::Started {
            intent: intent.as_str().to_string(),
            method: method.as_str().to_string(),
        };
    }
    if app
        .opener()
        .open_url(started.browser_url, None::<&str>)
        .is_err()
    {
        if let Ok(Some(flow)) = store.load_pending_auth_flow() {
            let _ = auth.cancel(&flow.flow_id, &flow.verifier).await;
            let _ = store.clear_pending_auth_flow();
        }
        let mut runtime = client.authentication.lock().await;
        runtime.initiated_flow = None;
        runtime.last_phase = CeremonyPhaseView::Failed {
            code: "browser_unavailable".to_string(),
        };
        return Err(native_failure(
            FailureKind::Transport,
            "system browser is unavailable",
        ));
    }
    let runtime = client.authentication.lock().await;
    Ok(runtime.last_phase.clone())
}

fn update_flow_from_status(flow: &mut PendingAuthFlow, status: &DesktopAuthStatus) {
    flow.phase = status.phase;
    flow.phase_expires_at = status.expires_at;
}

async fn refresh_pending_status(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
    mut flow: PendingAuthFlow,
) -> Result<(PendingAuthFlow, DesktopAuthStatus), ClientFailure> {
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    let status = auth.status(&flow.flow_id, &flow.verifier).await?;
    update_flow_from_status(&mut flow, &status);
    store
        .save_pending_auth_flow(&flow)
        .map_err(|_| store_failure())?;
    Ok((flow, status))
}

fn claimed_matches_validation(
    claimed: &punks_account_client::ceremony::SessionMetadata,
    validated: &punks_account_client::ceremony::SessionMetadata,
) -> bool {
    claimed.session_id == validated.session_id
        && claimed.punk_id == validated.punk_id
        && claimed.expires_at == validated.expires_at
}

async fn queue_failed_claim(
    auth: &DesktopAuthClient,
    store: &KeyringSessionPersistence,
    flow: &PendingAuthFlow,
    claimed: ClaimedSession,
) -> Result<(), ClientFailure> {
    store
        .enqueue_revocation(&QueuedRevocation {
            session_id: claimed.metadata.session_id,
            capability: claimed.revocation.secret,
            expires_at: claimed.revocation.expires_at,
            queued_at: SystemTime::now(),
        })
        .map_err(|_| store_failure())?;
    let _ = auth.cancel(&flow.flow_id, &flow.verifier).await;
    store.clear_pending_auth_flow().map_err(|_| store_failure())
}

async fn finish_staged_activation(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
    flow: &PendingAuthFlow,
    staged: StagedActivation,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    client.activate_prepared_session(&staged.cookie).await?;
    let confirmed = auth
        .confirm(&flow.flow_id, &flow.verifier, &staged.delivery_id)
        .await?;
    if confirmed.session_id != staged.metadata.session_id {
        return Err(native_failure(
            FailureKind::ContractViolation,
            "confirmed Session does not match staged activation",
        ));
    }
    let _ = store
        .promote_staged_activation()
        .map_err(|_| store_failure())?;
    {
        let mut runtime = client.authentication.lock().await;
        runtime.initiated_flow = None;
        runtime.last_phase = CeremonyPhaseView::Confirmed {
            session_id: confirmed.session_id.clone(),
        };
    }
    flush_revocations(client, store).await?;
    Ok(CeremonyPhaseView::Confirmed {
        session_id: confirmed.session_id,
    })
}

async fn complete_pending_authentication(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let flow = store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?
        .ok_or_else(|| {
            native_failure(
                FailureKind::Cancelled,
                "no interrupted authentication is available",
            )
        })?;
    let staged = store
        .reread_staged_activation()
        .map_err(|_| store_failure())?;
    let (flow, status) = refresh_pending_status(client, store, flow).await?;
    match status.phase {
        PendingAuthPhase::Cancelled => {
            if staged.is_some() {
                let _ = store
                    .discard_staged_activation()
                    .map_err(|_| store_failure())?;
                let _ = flush_revocations(client, store).await?;
            } else {
                store
                    .clear_pending_auth_flow()
                    .map_err(|_| store_failure())?;
            }
            return Ok(phase_for_status(&flow, &status));
        }
        PendingAuthPhase::Expired => {
            if staged.is_some() {
                let _ = store
                    .discard_staged_activation()
                    .map_err(|_| store_failure())?;
                let _ = flush_revocations(client, store).await?;
            } else {
                store
                    .clear_pending_auth_flow()
                    .map_err(|_| store_failure())?;
            }
            return Ok(phase_for_status(&flow, &status));
        }
        PendingAuthPhase::Ready | PendingAuthPhase::Delivering | PendingAuthPhase::Confirmed => {}
        _ => return Ok(phase_for_pending(&flow)),
    }
    if let Some(staged) = staged {
        return finish_staged_activation(client, store, &flow, staged).await;
    }
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    match auth.claim(&flow.flow_id, &flow.verifier).await? {
        ClaimedDelivery::Session(claimed) => {
            let expected_metadata = claimed.metadata.clone();
            let mut quarantine = QuarantineJar::new();
            quarantine.deposit(claimed.cookie);
            let cookie = quarantine.take_secret().ok_or_else(|| {
                native_failure(FailureKind::ContractViolation, "native quarantine is empty")
            })?;
            let validated = match auth.validate(&cookie).await {
                Ok(validated) => validated,
                Err(error) => {
                    queue_failed_claim(&auth, store, &flow, ClaimedSession { cookie, ..claimed })
                        .await?;
                    return Err(error);
                }
            };
            if !claimed_matches_validation(&expected_metadata, &validated) {
                queue_failed_claim(&auth, store, &flow, ClaimedSession { cookie, ..claimed })
                    .await?;
                return Err(native_failure(
                    FailureKind::ContractViolation,
                    "claimed Session failed native validation",
                ));
            }
            let candidate = StagedActivation {
                activation_unconfirmed: true,
                cookie,
                metadata: claimed.metadata,
                revoke_capability: claimed.revocation.secret,
                revoke_expires_at: claimed.revocation.expires_at,
                flow_id: claimed.flow_id,
                delivery_id: claimed.delivery_id,
                delivery_expires_at: claimed.delivery_expires_at,
            };
            if store.stage_activation(&candidate).is_err() {
                store
                    .enqueue_revocation(&QueuedRevocation {
                        session_id: candidate.metadata.session_id,
                        capability: candidate.revoke_capability,
                        expires_at: candidate.revoke_expires_at,
                        queued_at: SystemTime::now(),
                    })
                    .map_err(|_| store_failure())?;
                let _ = auth.cancel(&flow.flow_id, &flow.verifier).await;
                store
                    .clear_pending_auth_flow()
                    .map_err(|_| store_failure())?;
                return Err(store_failure());
            }
            let staged = store
                .reread_staged_activation()
                .map_err(|_| store_failure())?
                .ok_or_else(store_failure)?;
            finish_staged_activation(client, store, &flow, staged).await
        }
        ClaimedDelivery::Reauthorization(claimed) => {
            let active = store
                .load_active_session()
                .map_err(|_| store_failure())?
                .ok_or_else(|| {
                    native_failure(
                        FailureKind::SessionExpired,
                        "reauthentication lost its Account Session",
                    )
                })?;
            if active.metadata.session_id != claimed.session_id
                || active.metadata.punk_id != claimed.punk_id
            {
                return Err(native_failure(
                    FailureKind::ContractViolation,
                    "reauthorization does not match the active Account",
                ));
            }
            let confirmed = auth
                .confirm(&flow.flow_id, &flow.verifier, &claimed.delivery_id)
                .await?;
            let target_method = match claimed.target_method.as_str() {
                "link_google" => AuthenticationMethod::Google,
                "link_github" => AuthenticationMethod::Github,
                "register_passkey" => AuthenticationMethod::Passkey,
                _ => {
                    return Err(native_failure(
                        FailureKind::ContractViolation,
                        "reauthorization target is invalid",
                    ));
                }
            };
            store
                .save_reauthorization(&PendingReauthorization {
                    authorization_id: claimed.authorization_id,
                    session_id: claimed.session_id,
                    punk_id: claimed.punk_id,
                    target_method,
                    handoff_id: claimed.handoff_id,
                    expires_at: claimed.expires_at,
                })
                .map_err(|_| store_failure())?;
            store
                .clear_pending_auth_flow()
                .map_err(|_| store_failure())?;
            let phase = CeremonyPhaseView::Confirmed {
                session_id: confirmed.session_id,
            };
            let mut runtime = client.authentication.lock().await;
            runtime.initiated_flow = None;
            runtime.last_phase = phase.clone();
            Ok(phase)
        }
    }
}

async fn finish_pending_renewal(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
    renewal: PendingRenewal,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    let validated = auth.validate(&renewal.cookie).await?;
    if validated.session_id != renewal.metadata.session_id
        || validated.punk_id != renewal.metadata.punk_id
        || validated.expires_at != renewal.metadata.expires_at
    {
        let _ = store.discard_renewal().map_err(|_| store_failure())?;
        return Err(native_failure(
            FailureKind::ContractViolation,
            "prepared Session rotation failed native validation",
        ));
    }
    client.account()?.install_session_secret(&renewal.cookie)?;
    let session_id = auth
        .confirm_renewal(&renewal.cookie, &renewal.command_id, &renewal.rotation_id)
        .await?;
    if session_id != renewal.metadata.session_id {
        return Err(native_failure(
            FailureKind::ContractViolation,
            "confirmed Session rotation changed identity",
        ));
    }
    let refreshed = client.account()?.get_session().await?;
    if refreshed.session_id != renewal.metadata.session_id
        || refreshed.punk_id != renewal.metadata.punk_id
    {
        return Err(native_failure(
            FailureKind::ContractViolation,
            "rotated Session view does not match its confirmation",
        ));
    }
    let _ = store.promote_renewal().map_err(|_| store_failure())?;
    flush_revocations(client, store).await?;
    let phase = CeremonyPhaseView::Confirmed { session_id };
    client.authentication.lock().await.last_phase = phase.clone();
    Ok(phase)
}

async fn flush_revocations(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
) -> Result<bool, ClientFailure> {
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    let now = SystemTime::now();
    let pending = store.list_revocations().map_err(|_| store_failure())?;
    let mut queued = false;
    for revocation in pending {
        if revocation.expires_at <= now || auth.revoke(&revocation.capability).await.is_ok() {
            let _ = store
                .remove_revocation(&revocation.session_id)
                .map_err(|_| store_failure())?;
        } else {
            queued = true;
        }
    }
    Ok(queued)
}

/// Returns the sanitized Account Session and recoverable ceremony state.
#[tauri::command]
pub async fn punks_get_account_session_state(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<AccountSessionStateView, ClientFailure> {
    let _transition = client.transitions.write().await;
    let _ = flush_revocations(&client, &store).await?;
    if let Some(renewal) = store.reread_renewal().map_err(|_| store_failure())? {
        return Ok(AccountSessionStateView::SignedOut {
            authentication: CeremonyPhaseView::Delivering,
            resume_available: renewal.confirm_by > SystemTime::now(),
        });
    }
    if let Some(flow) = store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?
    {
        let initiated = client.authentication.lock().await.initiated_flow.as_deref()
            == Some(flow.flow_id.as_str());
        let (flow, status) = refresh_pending_status(&client, &store, flow).await?;
        if initiated
            && matches!(
                status.phase,
                PendingAuthPhase::Ready | PendingAuthPhase::Delivering
            )
        {
            let phase = complete_pending_authentication(&client, &store).await?;
            if let CeremonyPhaseView::Confirmed { .. } = phase {
                return account_state_from_store(&client, &store, phase).await;
            }
        }
        if matches!(
            status.phase,
            PendingAuthPhase::Cancelled | PendingAuthPhase::Expired
        ) {
            if store
                .reread_staged_activation()
                .map_err(|_| store_failure())?
                .is_some()
            {
                let _ = store
                    .discard_staged_activation()
                    .map_err(|_| store_failure())?;
                let _ = flush_revocations(&client, &store).await?;
            } else {
                store
                    .clear_pending_auth_flow()
                    .map_err(|_| store_failure())?;
            }
        }
        return Ok(AccountSessionStateView::SignedOut {
            authentication: phase_for_status(&flow, &status),
            resume_available: !status.terminal || status.phase == PendingAuthPhase::Confirmed,
        });
    }
    let phase = client.authentication.lock().await.last_phase.clone();
    account_state_from_store(&client, &store, phase).await
}

async fn account_state_from_store(
    client: &PunksDesktopClient,
    store: &KeyringSessionPersistence,
    phase: CeremonyPhaseView,
) -> Result<AccountSessionStateView, ClientFailure> {
    let Some(active) = store.load_active_session().map_err(|_| store_failure())? else {
        return Ok(AccountSessionStateView::SignedOut {
            authentication: phase,
            resume_available: false,
        });
    };
    let session = match client
        .account()?
        .restore_session(&active.cookie, &active.metadata)
        .await
    {
        Ok(session) => session,
        Err(failure) if failure.kind == FailureKind::SessionExpired => {
            store.sign_out_local().map_err(|_| store_failure())?;
            return Ok(AccountSessionStateView::SignedOut {
                authentication: CeremonyPhaseView::Idle,
                resume_available: false,
            });
        }
        Err(failure) => return Err(failure),
    };
    Ok(AccountSessionStateView::Authenticated {
        session,
        authentication: phase,
        resume_available: false,
    })
}

/// Starts an explicit sign-in in the system browser.
#[tauri::command]
pub async fn punks_start_sign_in(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
    provider: String,
) -> Result<CeremonyPhaseView, ClientFailure> {
    start_authentication(
        &app,
        &client,
        &store,
        PendingAuthIntent::SignIn,
        parse_method(&provider)?,
        None,
        None,
    )
    .await
}

/// Starts an explicit Account switch in the system browser.
#[tauri::command]
pub async fn punks_start_account_switch(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
    provider: String,
) -> Result<CeremonyPhaseView, ClientFailure> {
    start_authentication(
        &app,
        &client,
        &store,
        PendingAuthIntent::SwitchAccount,
        parse_method(&provider)?,
        None,
        None,
    )
    .await
}

/// Starts a targeted reauthentication for one sensitive purpose.
#[tauri::command]
pub async fn punks_start_reauthentication(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
    method: String,
    purpose: String,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let purpose = match purpose.as_str() {
        "link_google" => PendingAuthPurpose::LinkGoogle,
        "link_github" => PendingAuthPurpose::LinkGithub,
        "register_passkey" => PendingAuthPurpose::RegisterPasskey,
        _ => {
            return Err(native_failure(
                FailureKind::ContractViolation,
                "unsupported reauthentication purpose",
            ));
        }
    };
    start_authentication(
        &app,
        &client,
        &store,
        PendingAuthIntent::Reauthenticate,
        parse_method(&method)?,
        Some(purpose),
        None,
    )
    .await
}

/// Starts an identity-link ceremony after targeted reauthentication.
#[tauri::command]
pub async fn punks_start_identity_link(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
    provider: String,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let (intent, method) = match provider.as_str() {
        "google" => (PendingAuthIntent::LinkGoogle, AuthenticationMethod::Google),
        "github" => (PendingAuthIntent::LinkGithub, AuthenticationMethod::Github),
        _ => {
            return Err(native_failure(
                FailureKind::ContractViolation,
                "only Google or GitHub can be linked",
            ));
        }
    };
    let authorization_id = take_authorization(&store, method)?;
    start_authentication(
        &app,
        &client,
        &store,
        intent,
        method,
        None,
        Some(authorization_id),
    )
    .await
}

/// Starts passkey registration after targeted reauthentication.
#[tauri::command]
pub async fn punks_start_passkey_registration(
    app: tauri::AppHandle,
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let authorization_id = take_authorization(&store, AuthenticationMethod::Passkey)?;
    start_authentication(
        &app,
        &client,
        &store,
        PendingAuthIntent::RegisterPasskey,
        AuthenticationMethod::Passkey,
        None,
        Some(authorization_id),
    )
    .await
}

/// Resumes a persisted authentication or Session rotation explicitly.
#[tauri::command]
pub async fn punks_resume_interrupted_authentication(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.write().await;
    if let Some(renewal) = store.reread_renewal().map_err(|_| store_failure())? {
        return finish_pending_renewal(&client, &store, renewal).await;
    }
    complete_pending_authentication(&client, &store).await
}

/// Cancels the current ceremony and revokes any prepared Session.
#[tauri::command]
pub async fn punks_cancel_authentication(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.write().await;
    if store
        .reread_renewal()
        .map_err(|_| store_failure())?
        .is_some()
    {
        let _ = store.discard_renewal().map_err(|_| store_failure())?;
        let _ = flush_revocations(&client, &store).await?;
    } else if let Some(flow) = store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?
    {
        let auth = {
            let runtime = client.authentication.lock().await;
            auth_client(&runtime)?
        };
        auth.cancel(&flow.flow_id, &flow.verifier).await?;
        if store
            .reread_staged_activation()
            .map_err(|_| store_failure())?
            .is_some()
        {
            let _ = store
                .discard_staged_activation()
                .map_err(|_| store_failure())?;
            let _ = flush_revocations(&client, &store).await?;
        } else {
            store
                .clear_pending_auth_flow()
                .map_err(|_| store_failure())?;
        }
    }
    let mut runtime = client.authentication.lock().await;
    runtime.initiated_flow = None;
    runtime.last_phase = CeremonyPhaseView::Cancelled;
    Ok(CeremonyPhaseView::Cancelled)
}

/// Renews an eligible Account Session through confirmed rotation.
#[tauri::command]
pub async fn punks_renew_account_session(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<CeremonyPhaseView, ClientFailure> {
    let _transition = client.transitions.write().await;
    if let Some(renewal) = store.reread_renewal().map_err(|_| store_failure())? {
        return finish_pending_renewal(&client, &store, renewal).await;
    }
    if store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?
        .is_some()
    {
        return Err(native_failure(
            FailureKind::Ambiguous,
            "authentication must finish before Session renewal",
        ));
    }
    let active = store
        .load_active_session()
        .map_err(|_| store_failure())?
        .ok_or_else(|| {
            native_failure(
                FailureKind::SessionExpired,
                "no active Punks Account Session",
            )
        })?;
    let now = SystemTime::now();
    if !RenewalPolicy.should_renew(
        now,
        active.metadata.expires_at,
        active.metadata.last_renewed_at,
    ) {
        return Ok(CeremonyPhaseView::Idle);
    }
    let auth = {
        let runtime = client.authentication.lock().await;
        auth_client(&runtime)?
    };
    let command_id = uuid::Uuid::new_v4().to_string();
    let prepared = auth
        .prepare_renewal(&active.cookie, &command_id, now)
        .await?;
    let candidate = PendingRenewal {
        activation_unconfirmed: true,
        command_id: prepared.command_id,
        rotation_id: prepared.rotation_id,
        cookie: prepared.cookie,
        metadata: prepared.metadata,
        revoke_capability: prepared.revocation.secret,
        revoke_expires_at: prepared.revocation.expires_at,
        confirm_by: prepared.confirm_by,
    };
    if store.stage_renewal(&candidate).is_err() {
        store
            .enqueue_revocation(&QueuedRevocation {
                session_id: candidate.metadata.session_id,
                capability: candidate.revoke_capability,
                expires_at: candidate.revoke_expires_at,
                queued_at: SystemTime::now(),
            })
            .map_err(|_| store_failure())?;
        return Err(store_failure());
    }
    let renewal = store
        .reread_renewal()
        .map_err(|_| store_failure())?
        .ok_or_else(store_failure)?;
    finish_pending_renewal(&client, &store, renewal).await
}

/// Signs out locally before attempting queued remote revocation.
#[tauri::command]
pub async fn punks_sign_out(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
) -> Result<String, ClientFailure> {
    client.account()?.cancel_workspace_operations().await;
    let _transition = client.transitions.write().await;
    let pending = store
        .load_pending_auth_flow()
        .map_err(|_| store_failure())?;
    client.invalidate_for_sign_out().await?;
    store.sign_out_local().map_err(|_| store_failure())?;
    {
        let mut runtime = client.authentication.lock().await;
        runtime.initiated_flow = None;
        runtime.last_phase = CeremonyPhaseView::Idle;
    }
    if let Some(flow) = pending {
        let auth = {
            let runtime = client.authentication.lock().await;
            auth_client(&runtime)?
        };
        let _ = auth.cancel(&flow.flow_id, &flow.verifier).await;
    }
    Ok(if flush_revocations(&client, &store).await? {
        "queued"
    } else {
        "revoked"
    }
    .to_string())
}

/// Receives a non-secret completion from the distribution-specific handler.
pub(crate) async fn handle_auth_completion(
    app: tauri::AppHandle,
    flow_id: &str,
) -> Result<(), String> {
    let client = app.state::<PunksDesktopClient>();
    let store = app.state::<Arc<KeyringSessionPersistence>>();
    let _transition = client.transitions.write().await;
    let flow = store
        .load_pending_auth_flow()
        .map_err(|_| "secure authentication state unavailable".to_string())?
        .ok_or_else(|| "authentication completion is not expected".to_string())?;
    if flow.flow_id != flow_id {
        return Err("authentication completion does not match the pending flow".to_string());
    }
    let initiated = client.authentication.lock().await.initiated_flow.as_deref() == Some(flow_id);
    let (flow, status) = refresh_pending_status(&client, &store, flow)
        .await
        .map_err(|failure| failure.message)?;
    client.authentication.lock().await.last_phase = phase_for_pending(&flow);
    if initiated
        && matches!(
            status.phase,
            PendingAuthPhase::Ready | PendingAuthPhase::Delivering
        )
    {
        let _ = complete_pending_authentication(&client, &store)
            .await
            .map_err(|failure| failure.message)?;
    }
    Ok(())
}
