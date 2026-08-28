//! Punks-only Account persistence in one versioned OS-keyring credential.

mod models;
mod retirement;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

use punks_account_client::ceremony::{
    CompiledPunksEnvironment, SessionMetadata, SessionPersistence, SessionSecret,
};
use punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding;

use models::{
    encode_time, enqueue_stored_revocation, invalid_state, validate_uuid, StoredAccountState,
    StoredActiveSession, StoredPendingAuthFlow, StoredPendingReauthorization, StoredPendingRenewal,
    StoredQueuedRevocation, StoredStagedActivation,
};
#[allow(unused_imports)]
pub(crate) use models::{
    ActiveAccountSession, PendingAuthFlow, PendingAuthPurpose, PendingReauthorization,
    PendingRenewal, QueuedRevocation, StagedActivation,
};

const ACCOUNT_STATE_KEY: &str = "account-state-v1";

fn storage_unavailable() -> String {
    "Punks secure Account storage is unavailable".to_string()
}

pub(crate) trait CredentialStore: Send + Sync {
    fn load(&self, service: &str, key: &str) -> Result<Option<String>, String>;
    fn store(&self, service: &str, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, service: &str, key: &str) -> Result<(), String>;
}

struct OsKeyringCredentialStore;

impl OsKeyringCredentialStore {
    fn entry(service: &str, key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(service, key).map_err(|_| storage_unavailable())
    }
}

impl CredentialStore for OsKeyringCredentialStore {
    fn load(&self, service: &str, key: &str) -> Result<Option<String>, String> {
        match Self::entry(service, key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(storage_unavailable()),
        }
    }

    fn store(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
        Self::entry(service, key)?
            .set_password(value)
            .map_err(|_| storage_unavailable())
    }

    fn delete(&self, service: &str, key: &str) -> Result<(), String> {
        match Self::entry(service, key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(storage_unavailable()),
        }
    }
}

/// Punks-only adapter. No filesystem or Buzz-keyring fallback exists.
pub struct KeyringSessionPersistence {
    service: Result<&'static str, ()>,
    credentials: Arc<dyn CredentialStore>,
    transaction: Mutex<()>,
}

impl KeyringSessionPersistence {
    pub fn new() -> Self {
        Self {
            service: CompiledPunksEnvironment::current()
                .map(|value| value.keyring_service())
                .map_err(|_| ()),
            credentials: Arc::new(OsKeyringCredentialStore),
            transaction: Mutex::new(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_store(service: &'static str, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            service: Ok(service),
            credentials,
            transaction: Mutex::new(()),
        }
    }

    fn service(&self) -> Result<&'static str, String> {
        self.service.map_err(|_| storage_unavailable())
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.transaction.lock().map_err(|_| storage_unavailable())
    }

    fn read_state(&self) -> Result<StoredAccountState, String> {
        let Some(raw) = self.credentials.load(self.service()?, ACCOUNT_STATE_KEY)? else {
            return Ok(StoredAccountState::empty());
        };
        let (state, migrated) = retirement::decode_account_state(&raw, SystemTime::now())?;
        if migrated {
            self.write_state(&state)?;
        }
        Ok(state)
    }

    fn write_state(&self, state: &StoredAccountState) -> Result<(), String> {
        state.validate()?;
        let service = self.service()?;
        if state.is_empty() {
            self.credentials.delete(service, ACCOUNT_STATE_KEY)?;
            return match self.credentials.load(service, ACCOUNT_STATE_KEY)? {
                None => Ok(()),
                Some(_) => Err(storage_unavailable()),
            };
        }
        let encoded = serde_json::to_string(state).map_err(|_| invalid_state())?;
        self.credentials
            .store(service, ACCOUNT_STATE_KEY, &encoded)?;
        match self.credentials.load(service, ACCOUNT_STATE_KEY)? {
            Some(read_back) if read_back.as_bytes() == encoded.as_bytes() => Ok(()),
            _ => Err(storage_unavailable()),
        }
    }

    fn inspect<R>(
        &self,
        read: impl FnOnce(StoredAccountState) -> Result<R, String>,
    ) -> Result<R, String> {
        let _transaction = self.lock()?;
        read(self.read_state()?)
    }

    fn update<R>(
        &self,
        change: impl FnOnce(&mut StoredAccountState) -> Result<R, String>,
    ) -> Result<R, String> {
        let _transaction = self.lock()?;
        let mut state = self.read_state()?;
        let result = change(&mut state)?;
        self.write_state(&state)?;
        Ok(result)
    }

    pub(crate) fn save_pending_auth_flow(&self, flow: &PendingAuthFlow) -> Result<(), String> {
        let pending = StoredPendingAuthFlow::try_from(flow)?;
        self.update(move |state| {
            if state.pending_renewal.is_some()
                || state.pending_reauthorization.is_some()
                || state
                    .pending_auth_flow
                    .as_ref()
                    .is_some_and(|current| current.flow_id != pending.flow_id)
            {
                return Err("another native Account transition is active".to_string());
            }
            state.pending_auth_flow = Some(pending);
            Ok(())
        })
    }

    pub(crate) fn load_pending_auth_flow(&self) -> Result<Option<PendingAuthFlow>, String> {
        self.inspect(|state| {
            state
                .pending_auth_flow
                .map(PendingAuthFlow::try_from)
                .transpose()
        })
    }

    pub(crate) fn clear_pending_auth_flow(&self) -> Result<(), String> {
        self.update(|state| {
            if state.staged_activation.is_some() {
                return Err("a staged activation must be resolved first".to_string());
            }
            state.pending_auth_flow = None;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(crate) fn save_active_session(&self, active: &ActiveAccountSession) -> Result<(), String> {
        let replacement = StoredActiveSession::try_from(active)?;
        self.update(move |state| {
            if state.active_session.as_ref().is_some_and(|current| {
                current.metadata.session_id != replacement.metadata.session_id
            }) {
                return Err("active Session replacement requires staging".to_string());
            }
            state.active_session = Some(replacement);
            Ok(())
        })
    }

    pub(crate) fn load_active_session(&self) -> Result<Option<ActiveAccountSession>, String> {
        self.inspect(|state| {
            state
                .active_session
                .map(ActiveAccountSession::try_from)
                .transpose()
        })
    }

    pub(crate) fn stage_activation(&self, activation: &StagedActivation) -> Result<(), String> {
        let staged = StoredStagedActivation::try_from(activation)?;
        let now = encode_time(SystemTime::now())?;
        self.update(move |state| {
            if state.pending_renewal.is_some() || state.pending_reauthorization.is_some() {
                return Err("a Session renewal is already pending".to_string());
            }
            let pending = state
                .pending_auth_flow
                .as_mut()
                .ok_or_else(|| "activation requires its pending authentication".to_string())?;
            if pending.flow_id != staged.flow_id
                || pending.phase != punks_account_client::ceremony::PendingAuthPhase::Ready
                || staged.delivery_expires_at_seconds <= now
                || staged.delivery_expires_at_seconds > pending.absolute_expires_at_seconds
            {
                return Err("activation does not match its pending authentication".to_string());
            }
            if state
                .staged_activation
                .as_ref()
                .is_some_and(|current| current.delivery_id != staged.delivery_id)
            {
                return Err("another activation is already staged".to_string());
            }
            pending.phase = punks_account_client::ceremony::PendingAuthPhase::Delivering;
            pending.phase_expires_at_seconds = staged.delivery_expires_at_seconds;
            state.staged_activation = Some(staged);
            Ok(())
        })
    }

    pub(crate) fn reread_staged_activation(&self) -> Result<Option<StagedActivation>, String> {
        self.inspect(|state| {
            state
                .staged_activation
                .map(StagedActivation::try_from)
                .transpose()
        })
    }

    pub(crate) fn stage_renewal(&self, renewal: &PendingRenewal) -> Result<(), String> {
        let pending = StoredPendingRenewal::try_from(renewal)?;
        let now = encode_time(SystemTime::now())?;
        self.update(move |state| {
            let active = state
                .active_session
                .as_ref()
                .ok_or_else(|| "Session renewal requires an active Session".to_string())?;
            if active.metadata.punk_id != pending.metadata.punk_id {
                return Err("Session renewal changed the active Punk".to_string());
            }
            if pending.confirm_by_seconds <= now {
                return Err("Session renewal confirmation expired".to_string());
            }
            if state.pending_auth_flow.is_some()
                || state.staged_activation.is_some()
                || state.pending_reauthorization.is_some()
            {
                return Err("an authentication flow is already pending".to_string());
            }
            if state
                .pending_renewal
                .as_ref()
                .is_some_and(|current| current.rotation_id != pending.rotation_id)
            {
                return Err("another Session renewal is already pending".to_string());
            }
            state.pending_renewal = Some(pending);
            Ok(())
        })
    }

    pub(crate) fn reread_renewal(&self) -> Result<Option<PendingRenewal>, String> {
        self.inspect(|state| {
            state
                .pending_renewal
                .map(PendingRenewal::try_from)
                .transpose()
        })
    }

    pub(crate) fn save_reauthorization(
        &self,
        reauthorization: &PendingReauthorization,
    ) -> Result<(), String> {
        let pending = StoredPendingReauthorization::try_from(reauthorization)?;
        let now = encode_time(SystemTime::now())?;
        self.update(move |state| {
            if pending.expires_at_seconds <= now {
                return Err("reauthorization handoff expired".to_string());
            }
            let active = state
                .active_session
                .as_ref()
                .ok_or_else(|| "reauthorization requires an active Session".to_string())?;
            if active.metadata.session_id != pending.session_id
                || active.metadata.punk_id != pending.punk_id
            {
                return Err("reauthorization changed the active Account".to_string());
            }
            if state
                .pending_reauthorization
                .as_ref()
                .is_some_and(|current| {
                    current.authorization_id != pending.authorization_id
                        || current.handoff_id != pending.handoff_id
                })
            {
                return Err("another reauthorization handoff is pending".to_string());
            }
            state.pending_reauthorization = Some(pending);
            Ok(())
        })
    }

    #[cfg(test)]
    pub(crate) fn load_reauthorization(&self) -> Result<Option<PendingReauthorization>, String> {
        self.inspect(|state| {
            state
                .pending_reauthorization
                .map(PendingReauthorization::try_from)
                .transpose()
        })
    }

    pub(crate) fn take_reauthorization(
        &self,
        target: PendingAuthPurpose,
    ) -> Result<Option<PendingReauthorization>, String> {
        self.take_reauthorization_with_binding_at(target, None, SystemTime::now())
    }

    #[cfg(test)]
    pub(crate) fn take_workspace_ownership_reauthorization(
        &self,
        binding: &WorkspaceOwnershipTransferBinding,
    ) -> Result<Option<PendingReauthorization>, String> {
        self.take_reauthorization_with_binding_at(
            PendingAuthPurpose::TransferWorkspaceOwnership,
            Some(binding),
            SystemTime::now(),
        )
    }

    #[cfg(test)]
    fn take_reauthorization_at(
        &self,
        target: PendingAuthPurpose,
        now: SystemTime,
    ) -> Result<Option<PendingReauthorization>, String> {
        self.take_reauthorization_with_binding_at(target, None, now)
    }

    fn take_reauthorization_with_binding_at(
        &self,
        target: PendingAuthPurpose,
        binding: Option<&WorkspaceOwnershipTransferBinding>,
        now: SystemTime,
    ) -> Result<Option<PendingReauthorization>, String> {
        let now = encode_time(now)?;
        let pending = self.update(|state| {
            let Some(current) = state.pending_reauthorization.as_ref() else {
                return Ok(None);
            };
            if current.expires_at_seconds <= now {
                state.pending_reauthorization = None;
                return Ok(None);
            }
            let current_purpose = current
                .target_purpose
                .unwrap_or(match current.target_method {
                    punks_account_client::ceremony::AuthenticationMethod::Google => {
                        PendingAuthPurpose::LinkGoogle
                    }
                    punks_account_client::ceremony::AuthenticationMethod::Github => {
                        PendingAuthPurpose::LinkGithub
                    }
                });
            if current_purpose != target || current.workspace_ownership_transfer.as_ref() != binding
            {
                return Ok(None);
            }
            Ok(state.pending_reauthorization.take())
        })?;
        pending.map(PendingReauthorization::try_from).transpose()
    }

    fn promote_candidate(&self, renewal: bool) -> Result<Option<QueuedRevocation>, String> {
        let queued = self.update(|state| {
            let now = encode_time(SystemTime::now())?;
            let next = if renewal {
                let pending = state
                    .pending_renewal
                    .clone()
                    .ok_or_else(|| "no Session renewal is pending".to_string())?;
                if pending.confirm_by_seconds <= now {
                    return Err("Session renewal confirmation expired".to_string());
                }
                pending.into_active()
            } else {
                let staged = state
                    .staged_activation
                    .clone()
                    .ok_or_else(|| "no activation is staged".to_string())?;
                if staged.delivery_expires_at_seconds <= now {
                    return Err("authentication confirmation expired".to_string());
                }
                staged.into_active()
            };
            let queued = state
                .active_session
                .as_ref()
                .map(|active| {
                    active.queued_revocation(Some(&next.metadata.session_id), now, renewal)
                })
                .transpose()?
                .flatten();
            if let Some(revocation) = queued.as_ref() {
                enqueue_stored_revocation(state, revocation.clone(), now)?;
            }
            state.active_session = Some(next);
            state.pending_reauthorization = None;
            if renewal {
                state.pending_renewal = None;
            } else {
                state.pending_auth_flow = None;
                state.staged_activation = None;
            }
            Ok(queued)
        })?;
        queued.map(QueuedRevocation::try_from).transpose()
    }

    pub(crate) fn replace_active_with_staged(&self) -> Result<Option<QueuedRevocation>, String> {
        self.promote_candidate(false)
    }

    pub(crate) fn promote_staged_activation(&self) -> Result<Option<QueuedRevocation>, String> {
        self.replace_active_with_staged()
    }

    pub(crate) fn promote_renewal(&self) -> Result<Option<QueuedRevocation>, String> {
        self.promote_candidate(true)
    }

    fn discard_candidate(&self, renewal: bool) -> Result<Option<QueuedRevocation>, String> {
        let queued = self.update(|state| {
            let now = encode_time(SystemTime::now())?;
            let queued = if renewal {
                state
                    .pending_renewal
                    .as_ref()
                    .ok_or_else(|| "no Session renewal is pending".to_string())?
                    .queued_revocation(now)
            } else {
                state
                    .staged_activation
                    .as_ref()
                    .ok_or_else(|| "no activation is staged".to_string())?
                    .queued_revocation(now)
            };
            if let Some(revocation) = queued.as_ref() {
                enqueue_stored_revocation(state, revocation.clone(), now)?;
            }
            if renewal {
                state.pending_renewal = None;
            } else {
                state.staged_activation = None;
                state.pending_auth_flow = None;
            }
            Ok(queued)
        })?;
        queued.map(QueuedRevocation::try_from).transpose()
    }

    pub(crate) fn discard_staged_activation(&self) -> Result<Option<QueuedRevocation>, String> {
        self.discard_candidate(false)
    }

    pub(crate) fn discard_renewal(&self) -> Result<Option<QueuedRevocation>, String> {
        self.discard_candidate(true)
    }

    /// Atomically makes every local Session unusable and preserves every usable
    /// revoke-only capability before any network request is attempted.
    pub(crate) fn sign_out_local(&self) -> Result<Vec<String>, String> {
        self.update(|state| {
            let now = encode_time(SystemTime::now())?;
            let candidates = [
                state
                    .active_session
                    .as_ref()
                    .and_then(|active| active.queued_revocation(None, now, true).ok().flatten()),
                state
                    .staged_activation
                    .as_ref()
                    .and_then(|staged| staged.queued_revocation(now)),
                state
                    .pending_renewal
                    .as_ref()
                    .and_then(|renewal| renewal.queued_revocation(now)),
            ];
            let mut moved = Vec::new();
            for revocation in candidates.into_iter().flatten() {
                // A prepared/rotated capability for the same Session supersedes
                // an older revoke-only capability during this one local sign-out.
                state.revocation_queue.retain(|queued| {
                    queued.session_id != revocation.session_id
                        || queued.capability == revocation.capability
                });
                enqueue_stored_revocation(state, revocation.clone(), now)?;
                if !moved.contains(&revocation.session_id) {
                    moved.push(revocation.session_id);
                }
            }
            state.active_session = None;
            state.pending_auth_flow = None;
            state.staged_activation = None;
            state.pending_renewal = None;
            state.pending_reauthorization = None;
            Ok(moved)
        })
    }

    pub(crate) fn enqueue_revocation(&self, revocation: &QueuedRevocation) -> Result<(), String> {
        let stored = StoredQueuedRevocation::try_from(revocation)?;
        let now = encode_time(revocation.queued_at)?;
        self.update(move |state| enqueue_stored_revocation(state, stored, now))
    }

    pub(crate) fn list_revocations(&self) -> Result<Vec<QueuedRevocation>, String> {
        self.inspect(|state| {
            state
                .revocation_queue
                .into_iter()
                .map(QueuedRevocation::try_from)
                .collect()
        })
    }

    pub(crate) fn remove_revocation(&self, session_id: &str) -> Result<bool, String> {
        validate_uuid(session_id)?;
        self.update(|state| {
            let before = state.revocation_queue.len();
            state
                .revocation_queue
                .retain(|revocation| revocation.session_id != session_id);
            Ok(before != state.revocation_queue.len())
        })
    }
}

impl Default for KeyringSessionPersistence {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionPersistence for KeyringSessionPersistence {
    fn persist(&self, secret: &SessionSecret, metadata: &SessionMetadata) -> Result<(), String> {
        self.update(|state| {
            let (capability, expiry) = match state.active_session.as_ref() {
                Some(current) if current.metadata.session_id == metadata.session_id => {
                    if current.metadata.punk_id != metadata.punk_id {
                        return Err(invalid_state());
                    }
                    (
                        current.revoke_capability.clone(),
                        current.revoke_expires_at_seconds,
                    )
                }
                Some(_) => return Err("active Session replacement requires staging".to_string()),
                None => (None, None),
            };
            state.active_session = Some(StoredActiveSession::from_parts(
                secret,
                metadata,
                capability
                    .as_deref()
                    .map(punks_account_client::ceremony::RevocationSecret::from_token)
                    .transpose()
                    .map_err(|_| invalid_state())?
                    .as_ref(),
                expiry
                    .map(|seconds| {
                        std::time::UNIX_EPOCH
                            .checked_add(std::time::Duration::from_secs(seconds))
                            .ok_or_else(invalid_state)
                    })
                    .transpose()?,
            )?);
            Ok(())
        })
    }

    fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String> {
        self.load_active_session()
            .map(|active| active.map(|active| (active.cookie, active.metadata)))
    }

    fn destroy(&self) -> Result<(), String> {
        self.update(|state| {
            state.active_session = None;
            state.pending_reauthorization = None;
            Ok(())
        })
    }
}
