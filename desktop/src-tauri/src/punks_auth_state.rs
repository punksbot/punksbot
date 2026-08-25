use punks_account_client::desktop_auth::DesktopAuthClient;
use punks_account_client::{AccountSession, ClientFailure};

/// Process-local markers. Persisted flow secrets live only in the OS keyring.
pub(crate) struct NativeAuthenticationRuntime {
    pub(super) client: Result<DesktopAuthClient, ClientFailure>,
    pub(super) initiated_flow: Option<String>,
    pub(super) last_phase: CeremonyPhaseView,
}

impl NativeAuthenticationRuntime {
    pub(crate) fn new(origin: &str) -> Self {
        Self {
            client: DesktopAuthClient::new(origin),
            initiated_flow: None,
            last_phase: CeremonyPhaseView::Idle,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "phase")]
pub enum CeremonyPhaseView {
    Idle,
    Started {
        intent: String,
        method: String,
    },
    BrowserComplete,
    Ready,
    Delivering,
    Confirmed {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Cancelled,
    Expired,
    Failed {
        code: String,
    },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum AccountSessionStateView {
    SignedOut {
        authentication: CeremonyPhaseView,
        #[serde(rename = "resumeAvailable")]
        resume_available: bool,
    },
    Authenticated {
        session: AccountSession,
        authentication: CeremonyPhaseView,
        #[serde(rename = "resumeAvailable")]
        resume_available: bool,
    },
}
