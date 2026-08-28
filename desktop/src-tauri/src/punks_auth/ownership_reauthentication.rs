use punks_account_client::ceremony::{AuthenticationMethod, PendingAuthIntent};
use punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding;
use punks_account_client::{ClientFailure, FailureKind};
use serde::Deserialize;

use crate::punks_session_store::PendingAuthPurpose;

pub(super) type OwnershipBinding = WorkspaceOwnershipTransferBinding;

pub(super) struct NativeAuthStart {
    pub(super) intent: PendingAuthIntent,
    pub(super) method: AuthenticationMethod,
    pub(super) purpose: Option<PendingAuthPurpose>,
    pub(super) authorization_id: Option<String>,
    pub(super) workspace_ownership_transfer: Option<OwnershipBinding>,
}

impl NativeAuthStart {
    pub(super) fn basic(intent: PendingAuthIntent, method: AuthenticationMethod) -> Self {
        Self {
            intent,
            method,
            purpose: None,
            authorization_id: None,
            workspace_ownership_transfer: None,
        }
    }

    pub(super) fn reauthenticate(
        method: AuthenticationMethod,
        purpose: PendingAuthPurpose,
        workspace_ownership_transfer: Option<OwnershipBinding>,
    ) -> Self {
        Self {
            intent: PendingAuthIntent::Reauthenticate,
            method,
            purpose: Some(purpose),
            authorization_id: None,
            workspace_ownership_transfer,
        }
    }

    pub(super) fn authorized(
        intent: PendingAuthIntent,
        method: AuthenticationMethod,
        authorization_id: String,
    ) -> Self {
        Self {
            intent,
            method,
            purpose: None,
            authorization_id: Some(authorization_id),
            workspace_ownership_transfer: None,
        }
    }
}

/// Renderer input whose exact coordinates are sealed by native reauthentication.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceOwnershipReauthenticationInput {
    workspace_id: String,
    target_punk_id: String,
    expected_revision: u64,
}

pub(super) fn ownership_transfer_binding(
    purpose: PendingAuthPurpose,
    input: Option<WorkspaceOwnershipReauthenticationInput>,
) -> Result<Option<WorkspaceOwnershipTransferBinding>, ClientFailure> {
    let binding = input
        .map(|input| {
            let workspace_id = uuid::Uuid::parse_str(&input.workspace_id)
                .map_err(|_| invalid("ownership reauthentication Workspace is invalid"))?;
            let target_punk_id = uuid::Uuid::parse_str(&input.target_punk_id)
                .map_err(|_| invalid("ownership reauthentication target is invalid"))?;
            if workspace_id.to_string() != input.workspace_id
                || target_punk_id.to_string() != input.target_punk_id
                || input.expected_revision == 0
            {
                return Err(invalid("ownership reauthentication binding is invalid"));
            }
            Ok(WorkspaceOwnershipTransferBinding {
                workspace_id: input.workspace_id,
                target_punk_id: input.target_punk_id,
                expected_revision: input.expected_revision,
            })
        })
        .transpose()?;
    if (purpose == PendingAuthPurpose::TransferWorkspaceOwnership) != binding.is_some() {
        return Err(invalid(
            "ownership reauthentication requires its exact binding",
        ));
    }
    Ok(binding)
}

pub(super) fn parse_reauthentication_purpose(
    value: &str,
) -> Result<PendingAuthPurpose, ClientFailure> {
    match value {
        "link_google" => Ok(PendingAuthPurpose::LinkGoogle),
        "link_github" => Ok(PendingAuthPurpose::LinkGithub),
        "transfer_workspace_ownership" => Ok(PendingAuthPurpose::TransferWorkspaceOwnership),
        _ => Err(invalid("unsupported reauthentication purpose")),
    }
}

pub(super) fn pending_purpose(value: PendingAuthPurpose) -> &'static str {
    match value {
        PendingAuthPurpose::LinkGoogle => "link_google",
        PendingAuthPurpose::LinkGithub => "link_github",
        PendingAuthPurpose::TransferWorkspaceOwnership => "transfer_workspace_ownership",
    }
}

pub(super) fn parse_method(value: &str) -> Result<AuthenticationMethod, ClientFailure> {
    AuthenticationMethod::try_from(value).map_err(|_| invalid("unsupported login method"))
}

fn invalid(message: &'static str) -> ClientFailure {
    ClientFailure::native(FailureKind::ContractViolation, message)
}
