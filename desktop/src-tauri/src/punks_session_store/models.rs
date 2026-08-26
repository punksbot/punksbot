use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use punks_account_client::ceremony::{
    AuthenticationMethod, NativeVerifier, PendingAuthIntent, PendingAuthPhase, RevocationSecret,
    SessionMetadata, SessionSecret,
};

pub(super) const ACCOUNT_STATE_VERSION: &str = "account-state-v1";
pub(super) const MAX_REVOCATIONS: usize = 64;
const MAX_COOKIE_BYTES: usize = 4_096;

pub(super) fn invalid_state() -> String {
    "Punks Account state is invalid".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PendingAuthPurpose {
    LinkGoogle,
    LinkGithub,
    RegisterPasskey,
    TransferWorkspaceOwnership,
}

#[derive(Debug)]
pub(crate) struct PendingAuthFlow {
    pub(crate) flow_id: String,
    pub(crate) verifier: NativeVerifier,
    pub(crate) intent: PendingAuthIntent,
    pub(crate) method: AuthenticationMethod,
    pub(crate) purpose: Option<PendingAuthPurpose>,
    pub(crate) phase: PendingAuthPhase,
    pub(crate) phase_expires_at: SystemTime,
    pub(crate) absolute_expires_at: SystemTime,
}

#[derive(Debug)]
pub(crate) struct ActiveAccountSession {
    pub(crate) cookie: SessionSecret,
    pub(crate) metadata: SessionMetadata,
    pub(crate) revoke_capability: Option<RevocationSecret>,
    pub(crate) revoke_expires_at: Option<SystemTime>,
}

#[derive(Debug)]
pub(crate) struct StagedActivation {
    pub(crate) activation_unconfirmed: bool,
    pub(crate) cookie: SessionSecret,
    pub(crate) metadata: SessionMetadata,
    pub(crate) revoke_capability: RevocationSecret,
    pub(crate) revoke_expires_at: SystemTime,
    pub(crate) flow_id: String,
    pub(crate) delivery_id: String,
    pub(crate) delivery_expires_at: SystemTime,
}

#[derive(Debug)]
pub(crate) struct PendingRenewal {
    pub(crate) activation_unconfirmed: bool,
    pub(crate) command_id: String,
    pub(crate) rotation_id: String,
    pub(crate) cookie: SessionSecret,
    pub(crate) metadata: SessionMetadata,
    pub(crate) revoke_capability: RevocationSecret,
    pub(crate) revoke_expires_at: SystemTime,
    pub(crate) confirm_by: SystemTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingReauthorization {
    pub(crate) authorization_id: String,
    pub(crate) session_id: String,
    pub(crate) punk_id: String,
    pub(crate) target_method: AuthenticationMethod,
    pub(crate) target_purpose: PendingAuthPurpose,
    pub(crate) handoff_id: String,
    pub(crate) expires_at: SystemTime,
}

#[derive(Debug)]
pub(crate) struct QueuedRevocation {
    pub(crate) session_id: String,
    pub(crate) capability: RevocationSecret,
    pub(crate) expires_at: SystemTime,
    pub(crate) queued_at: SystemTime,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredAccountState {
    pub(super) version: String,
    pub(super) active_session: Option<StoredActiveSession>,
    pub(super) pending_auth_flow: Option<StoredPendingAuthFlow>,
    pub(super) staged_activation: Option<StoredStagedActivation>,
    pub(super) pending_renewal: Option<StoredPendingRenewal>,
    pub(super) pending_reauthorization: Option<StoredPendingReauthorization>,
    pub(super) revocation_queue: Vec<StoredQueuedRevocation>,
}

impl StoredAccountState {
    pub(super) fn empty() -> Self {
        Self {
            version: ACCOUNT_STATE_VERSION.into(),
            active_session: None,
            pending_auth_flow: None,
            staged_activation: None,
            pending_renewal: None,
            pending_reauthorization: None,
            revocation_queue: Vec::new(),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.active_session.is_none()
            && self.pending_auth_flow.is_none()
            && self.staged_activation.is_none()
            && self.pending_renewal.is_none()
            && self.pending_reauthorization.is_none()
            && self.revocation_queue.is_empty()
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        if self.version != ACCOUNT_STATE_VERSION
            || self.revocation_queue.len() > MAX_REVOCATIONS
            || (self.pending_auth_flow.is_some() && self.pending_renewal.is_some())
            || (self.staged_activation.is_some() && self.pending_renewal.is_some())
        {
            return Err(invalid_state());
        }
        if let Some(active) = self.active_session.clone() {
            let _ = ActiveAccountSession::try_from(active)?;
        }
        if let Some(pending) = self.pending_auth_flow.clone() {
            let _ = PendingAuthFlow::try_from(pending)?;
        }
        if let Some(staged) = self.staged_activation.clone() {
            let decoded = StagedActivation::try_from(staged)?;
            let pending = self.pending_auth_flow.as_ref().ok_or_else(invalid_state)?;
            if pending.flow_id != decoded.flow_id || pending.phase != PendingAuthPhase::Delivering {
                return Err(invalid_state());
            }
        }
        if let Some(renewal) = self.pending_renewal.clone() {
            let _ = PendingRenewal::try_from(renewal)?;
        }
        if let Some(reauthorization) = self.pending_reauthorization.clone() {
            let decoded = PendingReauthorization::try_from(reauthorization)?;
            let active = self.active_session.as_ref().ok_or_else(invalid_state)?;
            if active.metadata.session_id != decoded.session_id
                || active.metadata.punk_id != decoded.punk_id
            {
                return Err(invalid_state());
            }
        }
        let mut session_ids = HashSet::new();
        for revocation in self.revocation_queue.clone() {
            if !session_ids.insert(revocation.session_id.clone()) {
                return Err(invalid_state());
            }
            let _ = QueuedRevocation::try_from(revocation)?;
        }
        Ok(())
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredSessionMetadata {
    pub(super) session_id: String,
    pub(super) punk_id: String,
    pub(super) expires_at_seconds: u64,
    pub(super) last_renewed_at_seconds: Option<u64>,
}

impl StoredSessionMetadata {
    pub(super) fn from_metadata(metadata: &SessionMetadata) -> Result<Self, String> {
        validate_uuid(&metadata.session_id)?;
        validate_uuid(&metadata.punk_id)?;
        let expires_at_seconds = encode_time(metadata.expires_at)?;
        let last_renewed_at_seconds = metadata.last_renewed_at.map(encode_time).transpose()?;
        if last_renewed_at_seconds.is_some_and(|renewed| renewed > expires_at_seconds) {
            return Err(invalid_state());
        }
        Ok(Self {
            session_id: metadata.session_id.clone(),
            punk_id: metadata.punk_id.clone(),
            expires_at_seconds,
            last_renewed_at_seconds,
        })
    }

    fn into_metadata(self) -> Result<SessionMetadata, String> {
        validate_uuid(&self.session_id)?;
        validate_uuid(&self.punk_id)?;
        if self
            .last_renewed_at_seconds
            .is_some_and(|renewed| renewed > self.expires_at_seconds)
        {
            return Err(invalid_state());
        }
        Ok(SessionMetadata {
            session_id: self.session_id,
            punk_id: self.punk_id,
            expires_at: decode_time(self.expires_at_seconds)?,
            last_renewed_at: self.last_renewed_at_seconds.map(decode_time).transpose()?,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredActiveSession {
    pub(super) cookie: String,
    pub(super) metadata: StoredSessionMetadata,
    pub(super) revoke_capability: Option<String>,
    pub(super) revoke_expires_at_seconds: Option<u64>,
}

impl StoredActiveSession {
    pub(super) fn from_parts(
        cookie: &SessionSecret,
        metadata: &SessionMetadata,
        capability: Option<&RevocationSecret>,
        revoke_expires_at: Option<SystemTime>,
    ) -> Result<Self, String> {
        validate_cookie(cookie.raw())?;
        let (revoke_capability, revoke_expires_at_seconds) = match (capability, revoke_expires_at) {
            (Some(secret), Some(expiry)) => (Some(secret.raw().into()), Some(encode_time(expiry)?)),
            (None, None) => (None, None),
            _ => return Err(invalid_state()),
        };
        Ok(Self {
            cookie: cookie.raw().into(),
            metadata: StoredSessionMetadata::from_metadata(metadata)?,
            revoke_capability,
            revoke_expires_at_seconds,
        })
    }

    pub(super) fn queued_revocation(
        &self,
        replacement_session_id: Option<&str>,
        now: u64,
        force: bool,
    ) -> Result<Option<StoredQueuedRevocation>, String> {
        if !force && replacement_session_id == Some(&self.metadata.session_id) {
            return Ok(None);
        }
        match (&self.revoke_capability, self.revoke_expires_at_seconds) {
            (Some(capability), Some(expiry)) if expiry > now => Ok(Some(StoredQueuedRevocation {
                session_id: self.metadata.session_id.clone(),
                capability: capability.clone(),
                expires_at_seconds: expiry,
                queued_at_seconds: now,
            })),
            _ if self.metadata.expires_at_seconds <= now => Ok(None),
            _ => Err("active Session has no usable revocation capability".to_string()),
        }
    }
}

impl TryFrom<&ActiveAccountSession> for StoredActiveSession {
    type Error = String;
    fn try_from(active: &ActiveAccountSession) -> Result<Self, String> {
        Self::from_parts(
            &active.cookie,
            &active.metadata,
            active.revoke_capability.as_ref(),
            active.revoke_expires_at,
        )
    }
}

impl TryFrom<StoredActiveSession> for ActiveAccountSession {
    type Error = String;
    fn try_from(active: StoredActiveSession) -> Result<Self, String> {
        validate_cookie(&active.cookie)?;
        let (revoke_capability, revoke_expires_at) =
            match (active.revoke_capability, active.revoke_expires_at_seconds) {
                (Some(capability), Some(expiry)) => (
                    Some(RevocationSecret::from_token(&capability).map_err(|_| invalid_state())?),
                    Some(decode_time(expiry)?),
                ),
                (None, None) => (None, None),
                _ => return Err(invalid_state()),
            };
        Ok(Self {
            cookie: SessionSecret::from_cookie_header(&active.cookie),
            metadata: active.metadata.into_metadata()?,
            revoke_capability,
            revoke_expires_at,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredPendingAuthFlow {
    pub(super) flow_id: String,
    verifier: String,
    intent: PendingAuthIntent,
    method: AuthenticationMethod,
    purpose: Option<PendingAuthPurpose>,
    pub(super) phase: PendingAuthPhase,
    pub(super) phase_expires_at_seconds: u64,
    pub(super) absolute_expires_at_seconds: u64,
}

impl TryFrom<&PendingAuthFlow> for StoredPendingAuthFlow {
    type Error = String;
    fn try_from(flow: &PendingAuthFlow) -> Result<Self, String> {
        validate_uuid(&flow.flow_id)?;
        validate_auth_coordinates(flow.intent, flow.method, flow.purpose)?;
        let phase_expires_at_seconds = encode_time(flow.phase_expires_at)?;
        let absolute_expires_at_seconds = encode_time(flow.absolute_expires_at)?;
        if phase_expires_at_seconds > absolute_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            flow_id: flow.flow_id.clone(),
            verifier: flow.verifier.encoded(),
            intent: flow.intent,
            method: flow.method,
            purpose: flow.purpose,
            phase: flow.phase,
            phase_expires_at_seconds,
            absolute_expires_at_seconds,
        })
    }
}

impl TryFrom<StoredPendingAuthFlow> for PendingAuthFlow {
    type Error = String;
    fn try_from(flow: StoredPendingAuthFlow) -> Result<Self, String> {
        validate_uuid(&flow.flow_id)?;
        validate_auth_coordinates(flow.intent, flow.method, flow.purpose)?;
        if flow.phase_expires_at_seconds > flow.absolute_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            flow_id: flow.flow_id,
            verifier: NativeVerifier::decode(&flow.verifier).map_err(|_| invalid_state())?,
            intent: flow.intent,
            method: flow.method,
            purpose: flow.purpose,
            phase: flow.phase,
            phase_expires_at: decode_time(flow.phase_expires_at_seconds)?,
            absolute_expires_at: decode_time(flow.absolute_expires_at_seconds)?,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredStagedActivation {
    activation_unconfirmed: bool,
    cookie: String,
    pub(super) metadata: StoredSessionMetadata,
    revoke_capability: String,
    pub(super) revoke_expires_at_seconds: u64,
    pub(super) flow_id: String,
    pub(super) delivery_id: String,
    pub(super) delivery_expires_at_seconds: u64,
}

impl StoredStagedActivation {
    pub(super) fn into_active(self) -> StoredActiveSession {
        StoredActiveSession {
            cookie: self.cookie,
            metadata: self.metadata,
            revoke_capability: Some(self.revoke_capability),
            revoke_expires_at_seconds: Some(self.revoke_expires_at_seconds),
        }
    }

    pub(super) fn queued_revocation(&self, now: u64) -> Option<StoredQueuedRevocation> {
        (self.revoke_expires_at_seconds > now).then(|| StoredQueuedRevocation {
            session_id: self.metadata.session_id.clone(),
            capability: self.revoke_capability.clone(),
            expires_at_seconds: self.revoke_expires_at_seconds,
            queued_at_seconds: now,
        })
    }
}

impl TryFrom<&StagedActivation> for StoredStagedActivation {
    type Error = String;
    fn try_from(activation: &StagedActivation) -> Result<Self, String> {
        if !activation.activation_unconfirmed {
            return Err(invalid_state());
        }
        validate_cookie(activation.cookie.raw())?;
        validate_uuid(&activation.flow_id)?;
        validate_uuid(&activation.delivery_id)?;
        let revoke_expires_at_seconds = encode_time(activation.revoke_expires_at)?;
        let delivery_expires_at_seconds = encode_time(activation.delivery_expires_at)?;
        if delivery_expires_at_seconds > revoke_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            activation_unconfirmed: true,
            cookie: activation.cookie.raw().into(),
            metadata: StoredSessionMetadata::from_metadata(&activation.metadata)?,
            revoke_capability: activation.revoke_capability.raw().into(),
            revoke_expires_at_seconds,
            flow_id: activation.flow_id.clone(),
            delivery_id: activation.delivery_id.clone(),
            delivery_expires_at_seconds,
        })
    }
}

impl TryFrom<StoredStagedActivation> for StagedActivation {
    type Error = String;
    fn try_from(activation: StoredStagedActivation) -> Result<Self, String> {
        if !activation.activation_unconfirmed {
            return Err(invalid_state());
        }
        validate_cookie(&activation.cookie)?;
        validate_uuid(&activation.flow_id)?;
        validate_uuid(&activation.delivery_id)?;
        if activation.delivery_expires_at_seconds > activation.revoke_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            activation_unconfirmed: true,
            cookie: SessionSecret::from_cookie_header(&activation.cookie),
            metadata: activation.metadata.into_metadata()?,
            revoke_capability: RevocationSecret::from_token(&activation.revoke_capability)
                .map_err(|_| invalid_state())?,
            revoke_expires_at: decode_time(activation.revoke_expires_at_seconds)?,
            flow_id: activation.flow_id,
            delivery_id: activation.delivery_id,
            delivery_expires_at: decode_time(activation.delivery_expires_at_seconds)?,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredPendingRenewal {
    activation_unconfirmed: bool,
    pub(super) command_id: String,
    pub(super) rotation_id: String,
    cookie: String,
    pub(super) metadata: StoredSessionMetadata,
    revoke_capability: String,
    pub(super) revoke_expires_at_seconds: u64,
    pub(super) confirm_by_seconds: u64,
}

impl StoredPendingRenewal {
    pub(super) fn into_active(self) -> StoredActiveSession {
        StoredActiveSession {
            cookie: self.cookie,
            metadata: self.metadata,
            revoke_capability: Some(self.revoke_capability),
            revoke_expires_at_seconds: Some(self.revoke_expires_at_seconds),
        }
    }

    pub(super) fn queued_revocation(&self, now: u64) -> Option<StoredQueuedRevocation> {
        (self.revoke_expires_at_seconds > now).then(|| StoredQueuedRevocation {
            session_id: self.metadata.session_id.clone(),
            capability: self.revoke_capability.clone(),
            expires_at_seconds: self.revoke_expires_at_seconds,
            queued_at_seconds: now,
        })
    }
}

impl TryFrom<&PendingRenewal> for StoredPendingRenewal {
    type Error = String;
    fn try_from(renewal: &PendingRenewal) -> Result<Self, String> {
        if !renewal.activation_unconfirmed {
            return Err(invalid_state());
        }
        validate_uuid(&renewal.command_id)?;
        validate_uuid(&renewal.rotation_id)?;
        validate_cookie(renewal.cookie.raw())?;
        let confirm_by_seconds = encode_time(renewal.confirm_by)?;
        let revoke_expires_at_seconds = encode_time(renewal.revoke_expires_at)?;
        if confirm_by_seconds > revoke_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            activation_unconfirmed: true,
            command_id: renewal.command_id.clone(),
            rotation_id: renewal.rotation_id.clone(),
            cookie: renewal.cookie.raw().into(),
            metadata: StoredSessionMetadata::from_metadata(&renewal.metadata)?,
            revoke_capability: renewal.revoke_capability.raw().into(),
            revoke_expires_at_seconds,
            confirm_by_seconds,
        })
    }
}

impl TryFrom<StoredPendingRenewal> for PendingRenewal {
    type Error = String;
    fn try_from(renewal: StoredPendingRenewal) -> Result<Self, String> {
        if !renewal.activation_unconfirmed {
            return Err(invalid_state());
        }
        validate_uuid(&renewal.command_id)?;
        validate_uuid(&renewal.rotation_id)?;
        validate_cookie(&renewal.cookie)?;
        if renewal.confirm_by_seconds > renewal.revoke_expires_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            activation_unconfirmed: true,
            command_id: renewal.command_id,
            rotation_id: renewal.rotation_id,
            cookie: SessionSecret::from_cookie_header(&renewal.cookie),
            metadata: renewal.metadata.into_metadata()?,
            revoke_capability: RevocationSecret::from_token(&renewal.revoke_capability)
                .map_err(|_| invalid_state())?,
            revoke_expires_at: decode_time(renewal.revoke_expires_at_seconds)?,
            confirm_by: decode_time(renewal.confirm_by_seconds)?,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredPendingReauthorization {
    pub(super) authorization_id: String,
    pub(super) session_id: String,
    pub(super) punk_id: String,
    pub(super) target_method: AuthenticationMethod,
    #[serde(default)]
    pub(super) target_purpose: Option<PendingAuthPurpose>,
    pub(super) handoff_id: String,
    pub(super) expires_at_seconds: u64,
}

impl TryFrom<&PendingReauthorization> for StoredPendingReauthorization {
    type Error = String;
    fn try_from(value: &PendingReauthorization) -> Result<Self, String> {
        validate_uuid(&value.authorization_id)?;
        validate_uuid(&value.session_id)?;
        validate_uuid(&value.punk_id)?;
        validate_uuid(&value.handoff_id)?;
        Ok(Self {
            authorization_id: value.authorization_id.clone(),
            session_id: value.session_id.clone(),
            punk_id: value.punk_id.clone(),
            target_method: value.target_method,
            target_purpose: Some(value.target_purpose),
            handoff_id: value.handoff_id.clone(),
            expires_at_seconds: encode_time(value.expires_at)?,
        })
    }
}

impl TryFrom<StoredPendingReauthorization> for PendingReauthorization {
    type Error = String;
    fn try_from(value: StoredPendingReauthorization) -> Result<Self, String> {
        validate_uuid(&value.authorization_id)?;
        validate_uuid(&value.session_id)?;
        validate_uuid(&value.punk_id)?;
        validate_uuid(&value.handoff_id)?;
        let target_purpose = value.target_purpose.unwrap_or(match value.target_method {
            AuthenticationMethod::Google => PendingAuthPurpose::LinkGoogle,
            AuthenticationMethod::Github => PendingAuthPurpose::LinkGithub,
            AuthenticationMethod::Passkey => PendingAuthPurpose::RegisterPasskey,
        });
        Ok(Self {
            authorization_id: value.authorization_id,
            session_id: value.session_id,
            punk_id: value.punk_id,
            target_method: value.target_method,
            target_purpose,
            handoff_id: value.handoff_id,
            expires_at: decode_time(value.expires_at_seconds)?,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredQueuedRevocation {
    pub(super) session_id: String,
    pub(super) capability: String,
    pub(super) expires_at_seconds: u64,
    pub(super) queued_at_seconds: u64,
}

impl TryFrom<&QueuedRevocation> for StoredQueuedRevocation {
    type Error = String;
    fn try_from(revocation: &QueuedRevocation) -> Result<Self, String> {
        validate_uuid(&revocation.session_id)?;
        let expires_at_seconds = encode_time(revocation.expires_at)?;
        let queued_at_seconds = encode_time(revocation.queued_at)?;
        if expires_at_seconds <= queued_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            session_id: revocation.session_id.clone(),
            capability: revocation.capability.raw().into(),
            expires_at_seconds,
            queued_at_seconds,
        })
    }
}

impl TryFrom<StoredQueuedRevocation> for QueuedRevocation {
    type Error = String;
    fn try_from(revocation: StoredQueuedRevocation) -> Result<Self, String> {
        validate_uuid(&revocation.session_id)?;
        if revocation.expires_at_seconds <= revocation.queued_at_seconds {
            return Err(invalid_state());
        }
        Ok(Self {
            session_id: revocation.session_id,
            capability: RevocationSecret::from_token(&revocation.capability)
                .map_err(|_| invalid_state())?,
            expires_at: decode_time(revocation.expires_at_seconds)?,
            queued_at: decode_time(revocation.queued_at_seconds)?,
        })
    }
}

pub(super) fn enqueue_stored_revocation(
    state: &mut StoredAccountState,
    revocation: StoredQueuedRevocation,
    now: u64,
) -> Result<(), String> {
    state
        .revocation_queue
        .retain(|queued| queued.expires_at_seconds > now);
    if let Some(existing) = state
        .revocation_queue
        .iter()
        .find(|queued| queued.session_id == revocation.session_id)
    {
        return if existing.capability == revocation.capability
            && existing.expires_at_seconds == revocation.expires_at_seconds
        {
            Ok(())
        } else {
            Err("conflicting revocation capability for one Session".to_string())
        };
    }
    if state.revocation_queue.len() >= MAX_REVOCATIONS {
        return Err("secure revocation queue is full".to_string());
    }
    state.revocation_queue.push(revocation);
    Ok(())
}

pub(super) fn encode_time(value: SystemTime) -> Result<u64, String> {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| invalid_state())
}

fn decode_time(seconds: u64) -> Result<SystemTime, String> {
    UNIX_EPOCH
        .checked_add(Duration::from_secs(seconds))
        .ok_or_else(invalid_state)
}

pub(super) fn validate_uuid(value: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| invalid_state())?;
    (parsed.to_string() == value)
        .then_some(())
        .ok_or_else(invalid_state)
}

fn validate_cookie(value: &str) -> Result<(), String> {
    let token = value
        .strip_prefix("__Host-punks_session=")
        .or_else(|| value.strip_prefix("punks_session_dev="));
    (token.is_some_and(|token| {
        (32..=MAX_COOKIE_BYTES).contains(&token.len())
            && token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }))
    .then_some(())
    .ok_or_else(invalid_state)
}

fn validate_auth_coordinates(
    intent: PendingAuthIntent,
    method: AuthenticationMethod,
    purpose: Option<PendingAuthPurpose>,
) -> Result<(), String> {
    let valid = match intent {
        PendingAuthIntent::LinkGoogle => {
            method == AuthenticationMethod::Google
                && matches!(purpose, None | Some(PendingAuthPurpose::LinkGoogle))
        }
        PendingAuthIntent::LinkGithub => {
            method == AuthenticationMethod::Github
                && matches!(purpose, None | Some(PendingAuthPurpose::LinkGithub))
        }
        PendingAuthIntent::RegisterPasskey => {
            method == AuthenticationMethod::Passkey
                && matches!(purpose, None | Some(PendingAuthPurpose::RegisterPasskey))
        }
        PendingAuthIntent::Reauthenticate => purpose.is_some(),
        PendingAuthIntent::SignIn | PendingAuthIntent::SwitchAccount => purpose.is_none(),
    };
    valid.then_some(()).ok_or_else(invalid_state)
}
