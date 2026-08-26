use punks_account_client::{ClientFailure, FailureKind};

use super::{store_failure, AccountSessionStateView, CeremonyPhaseView};
use crate::punks_client::PunksDesktopClient;
use crate::punks_session_store::KeyringSessionPersistence;

pub(super) async fn account_state_from_store(
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
        Err(failure)
            if matches!(
                failure.kind,
                FailureKind::AccountMerged | FailureKind::SessionExpired
            ) =>
        {
            store.sign_out_local().map_err(|_| store_failure())?;
            return Ok(AccountSessionStateView::SignedOut {
                authentication: if failure.kind == FailureKind::AccountMerged {
                    CeremonyPhaseView::Failed {
                        code: "account_merged".to_string(),
                    }
                } else {
                    CeremonyPhaseView::Idle
                },
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
