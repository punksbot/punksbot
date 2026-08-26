use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::{social_validation::valid_rfc3339, validate_uuid, ClientFailure, FailureKind};

/// Public ephemeral presence state. It is presentation only, never authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceAvailability {
    Online,
    Away,
    Offline,
}

/// Bounded public view delivered to the renderer without a lease credential.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceView {
    pub punk_id: String,
    pub state: PresenceAvailability,
    pub status: Option<String>,
    pub lease_generation: u64,
    pub sequence: u64,
    pub expires_at: Option<String>,
}

/// Cursor-free, auto-expiring typing patch carried by Conversation FOLLOW.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceTypingPatch {
    pub workspace_id: String,
    pub conversation_id: String,
    pub punk_id: String,
    pub active: bool,
    pub lease_generation: u64,
    pub sequence: u64,
    pub expires_at: Option<String>,
}

/// Closed reason why ephemeral Presence cannot currently be delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceDegradedReason {
    AuthorizationUnavailable,
    CapacityUnavailable,
}

/// Closed `punks.presence.v1` server protocol. The token remains native-only.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PresenceServerFrame {
    Accepted {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "leaseToken")]
        lease_token: String,
        #[serde(rename = "leaseGeneration")]
        lease_generation: u64,
        #[serde(rename = "clientGeneration")]
        client_generation: u64,
        #[serde(rename = "heartbeatIntervalMs")]
        heartbeat_interval_ms: u64,
        #[serde(rename = "awayAfterMs")]
        away_after_ms: u64,
        #[serde(rename = "expiresAfterMs")]
        expires_after_ms: u64,
        presences: Vec<PresenceView>,
    },
    Presence {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        presence: PresenceView,
    },
    RealtimeDegraded {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        reason: PresenceDegradedReason,
    },
}

/// Renderer-safe delivery. Deliberately excludes token, Session and device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum PresenceDelivery {
    Accepted {
        client_generation: u64,
        lease_generation: u64,
        heartbeat_interval_ms: u64,
        away_after_ms: u64,
        expires_after_ms: u64,
        presences: Vec<PresenceView>,
    },
    Presence {
        presence: PresenceView,
    },
    RealtimeDegraded {
        reason: PresenceDegradedReason,
    },
}

/// Monotone volatile reducer for one Workspace generation.
#[derive(Clone)]
pub struct PresenceState {
    workspace_id: String,
    client_generation: u64,
    lease_token: Option<String>,
    lease_generation: Option<u64>,
    heartbeat_interval_ms: Option<u64>,
    views: HashMap<String, PresenceView>,
}

impl std::fmt::Debug for PresenceState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PresenceState")
            .field("workspace_id", &self.workspace_id)
            .field("client_generation", &self.client_generation)
            .field(
                "lease_token",
                &self.lease_token.as_ref().map(|_| "[redacted]"),
            )
            .field("lease_generation", &self.lease_generation)
            .field("heartbeat_interval_ms", &self.heartbeat_interval_ms)
            .field("views", &self.views)
            .finish()
    }
}

impl PresenceState {
    /// Creates an empty volatile reducer state for one mounted Workspace generation.
    pub fn new(workspace_id: &str, client_generation: u64) -> Self {
        Self {
            workspace_id: workspace_id.to_owned(),
            client_generation,
            lease_token: None,
            lease_generation: None,
            heartbeat_interval_ms: None,
            views: HashMap::new(),
        }
    }

    pub(crate) fn lease_token(&self) -> Option<&str> {
        self.lease_token.as_deref()
    }

    pub(crate) fn heartbeat_interval_ms(&self) -> Option<u64> {
        self.heartbeat_interval_ms
    }
}

/// Observable outcome produced while reducing one Presence server frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresenceEffect {
    None,
    Delivery(PresenceDelivery),
}

/// Next volatile Presence state paired with its optional renderer delivery.
#[derive(Debug, Clone)]
pub struct PresenceReduction {
    pub state: PresenceState,
    pub effect: PresenceEffect,
}

fn invalid_presence() -> ClientFailure {
    ClientFailure::contract("presence.hold-server-frame@1")
}

fn valid_lease_token(value: &str) -> bool {
    value.len() == 48
        && value.starts_with("pls1.")
        && value[5..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_status(value: &str) -> bool {
    let canonical = value.nfc().collect::<String>();
    canonical == value
        && canonical == canonical.trim()
        && (1..=80).contains(&canonical.chars().count())
        && !canonical
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}'))
}

fn validate_presence_view(view: &PresenceView) -> Result<(), ClientFailure> {
    validate_uuid(&view.punk_id, "punkId")?;
    if view.lease_generation == 0
        || view.sequence == 0
        || view
            .status
            .as_deref()
            .is_some_and(|status| !valid_status(status))
    {
        return Err(invalid_presence());
    }
    match view.state {
        PresenceAvailability::Offline => {
            if view.expires_at.is_some() || view.status.is_some() {
                return Err(invalid_presence());
            }
        }
        PresenceAvailability::Online | PresenceAvailability::Away => {
            if !view.expires_at.as_deref().is_some_and(valid_rfc3339) {
                return Err(invalid_presence());
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_typing_patch(
    patch: &PresenceTypingPatch,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<(), ClientFailure> {
    validate_uuid(&patch.workspace_id, "workspaceId")?;
    validate_uuid(&patch.conversation_id, "conversationId")?;
    validate_uuid(&patch.punk_id, "punkId")?;
    if patch.workspace_id != workspace_id
        || patch.conversation_id != conversation_id
        || patch.lease_generation == 0
        || patch.sequence == 0
        || (patch.active && !patch.expires_at.as_deref().is_some_and(valid_rfc3339))
        || (!patch.active && patch.expires_at.is_some())
    {
        return Err(ClientFailure::contract("presence.typing.patch@1"));
    }
    Ok(())
}

/// Applies one server frame without ever exposing its native lease token.
pub fn reduce_presence_frame(
    state: &PresenceState,
    frame: PresenceServerFrame,
) -> Result<PresenceReduction, ClientFailure> {
    validate_uuid(&state.workspace_id, "workspaceId")?;
    match frame {
        PresenceServerFrame::Accepted {
            schema_version,
            lease_token,
            lease_generation,
            client_generation,
            heartbeat_interval_ms,
            away_after_ms,
            expires_after_ms,
            presences,
        } => {
            if client_generation != state.client_generation {
                return Err(ClientFailure::new(
                    FailureKind::StaleWorkspace,
                    "Punks Presence belongs to an older Workspace generation",
                ));
            }
            if schema_version != 1
                || state.lease_token.is_some()
                || !valid_lease_token(&lease_token)
                || lease_generation == 0
                || !(5_000..=30_000).contains(&heartbeat_interval_ms)
                || !(10_000..=60_000).contains(&away_after_ms)
                || !(15_000..=120_000).contains(&expires_after_ms)
                || heartbeat_interval_ms >= away_after_ms
                || away_after_ms >= expires_after_ms
                || presences.len() > 10_000
            {
                return Err(invalid_presence());
            }
            let mut views = HashMap::with_capacity(presences.len());
            let mut punk_ids = HashSet::with_capacity(presences.len());
            for presence in &presences {
                validate_presence_view(presence)?;
                if presence.state == PresenceAvailability::Offline
                    || !punk_ids.insert(presence.punk_id.as_str())
                {
                    return Err(invalid_presence());
                }
                views.insert(presence.punk_id.clone(), presence.clone());
            }
            let mut next = state.clone();
            next.lease_token = Some(lease_token);
            next.lease_generation = Some(lease_generation);
            next.heartbeat_interval_ms = Some(heartbeat_interval_ms);
            next.views = views;
            Ok(PresenceReduction {
                state: next,
                effect: PresenceEffect::Delivery(PresenceDelivery::Accepted {
                    client_generation,
                    lease_generation,
                    heartbeat_interval_ms,
                    away_after_ms,
                    expires_after_ms,
                    presences,
                }),
            })
        }
        PresenceServerFrame::Presence {
            schema_version,
            presence,
        } => {
            if schema_version != 1 || state.lease_token.is_none() {
                return Err(invalid_presence());
            }
            validate_presence_view(&presence)?;
            if let Some(current) = state.views.get(&presence.punk_id) {
                if presence.lease_generation < current.lease_generation
                    || (presence.lease_generation == current.lease_generation
                        && presence.sequence < current.sequence)
                {
                    return Ok(PresenceReduction {
                        state: state.clone(),
                        effect: PresenceEffect::None,
                    });
                }
                if presence.lease_generation == current.lease_generation
                    && presence.sequence == current.sequence
                {
                    return if presence == *current {
                        Ok(PresenceReduction {
                            state: state.clone(),
                            effect: PresenceEffect::None,
                        })
                    } else {
                        Err(invalid_presence())
                    };
                }
            }
            let mut next = state.clone();
            // Retain offline tombstones natively so a delayed online frame
            // from the same Bail cannot cross IPC after the visible state was
            // removed by the renderer.
            next.views
                .insert(presence.punk_id.clone(), presence.clone());
            Ok(PresenceReduction {
                state: next,
                effect: PresenceEffect::Delivery(PresenceDelivery::Presence { presence }),
            })
        }
        PresenceServerFrame::RealtimeDegraded {
            schema_version,
            reason,
        } => {
            if schema_version != 1 {
                return Err(invalid_presence());
            }
            Ok(PresenceReduction {
                state: state.clone(),
                effect: PresenceEffect::Delivery(PresenceDelivery::RealtimeDegraded { reason }),
            })
        }
    }
}
