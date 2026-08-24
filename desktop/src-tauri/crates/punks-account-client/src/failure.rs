use std::fmt;

use serde::Serialize;
use serde_json::Value;

/// Closed failure taxonomy of `desktop-social-loop@1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    Problem,
    Transport,
    ContractViolation,
    Cancelled,
    StaleWorkspace,
    SessionExpired,
    Ambiguous,
}

pub(crate) struct ObservedInterruption {
    pub(crate) phase: &'static str,
    pub(crate) kind: FailureKind,
    pub(crate) recovery_decision: &'static str,
}

/// Classification partagée entre le transport produit et le corpus commun.
pub(crate) fn classify_observed_interruption(
    operation_kind: &str,
    emitted: bool,
    committed: bool,
    cancelled: bool,
) -> ObservedInterruption {
    let phase = if committed {
        "after_commit"
    } else if emitted {
        "after_emit"
    } else {
        "before_emit"
    };
    if cancelled && !emitted {
        return ObservedInterruption {
            phase,
            kind: FailureKind::Cancelled,
            recovery_decision: "effect_excluded",
        };
    }
    if operation_kind == "mutation" && emitted {
        return ObservedInterruption {
            phase,
            kind: FailureKind::Ambiguous,
            recovery_decision: "authoritative_read",
        };
    }
    if cancelled {
        return ObservedInterruption {
            phase,
            kind: FailureKind::Cancelled,
            recovery_decision: "effect_excluded",
        };
    }
    ObservedInterruption {
        phase,
        kind: FailureKind::Transport,
        recovery_decision: if operation_kind == "mutation" {
            "new_intent_required"
        } else {
            "retry_active_lease"
        },
    }
}

/// Stable, serializable failure returned through typed Tauri commands.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFailure {
    pub kind: FailureKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<Value>,
}

impl ClientFailure {
    /// Constructeur public réservé aux couches natives (cérémonie, IPC) :
    /// le message ne doit jamais contenir de secret de session.
    pub fn native(kind: FailureKind, message: impl Into<String>) -> Self {
        Self::new(kind, message)
    }

    pub(crate) fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            problem: None,
        }
    }

    /// Creates the fail-closed error used by adapters for an unknown lease.
    pub fn stale_workspace() -> Self {
        Self::new(
            FailureKind::StaleWorkspace,
            "WorkspaceSession lease is no longer current",
        )
    }

    /// Creates the stable error for a closed or unknown asynchronous operation.
    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::new(FailureKind::Cancelled, message)
    }

    pub(crate) fn contract(contract: &str) -> Self {
        Self::new(
            FailureKind::ContractViolation,
            format!("Punks response violated {contract}"),
        )
    }
}

impl fmt::Display for ClientFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ClientFailure {}
