use punks_account_client::{
    ClaimWorkspaceInvitationResult, ClientFailure, CreateWorkspaceInvitationResult, FailureKind,
    RevokeWorkspaceInvitationResult, WorkspaceGovernancePage, WorkspaceInvitationRole,
    WorkspaceInvitationView, WorkspaceLease, WorkspaceMembershipLifecycleResult,
    WorkspaceMembershipMutationResult, WorkspaceRole,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::punks_client::PunksDesktopClient;
use crate::punks_session_store::{KeyringSessionPersistence, PendingAuthPurpose};

/// Renderer input for one bounded Workspace invitation intent.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInvitationInput {
    role: WorkspaceInvitationRole,
    expected_revision: u64,
    ttl_seconds: Option<u32>,
    max_uses: Option<u16>,
}

/// Creates one Workspace invitation through the generation-bound native client.
#[tauri::command]
pub async fn punks_create_workspace_invitation(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: CreateInvitationInput,
) -> Result<CreateWorkspaceInvitationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .create_invitation(
            input.role,
            input.expected_revision,
            input.ttl_seconds,
            input.max_uses,
        )
        .await
}

/// Resolves one invitation code without exposing the Account Session cookie.
#[tauri::command]
pub async fn punks_get_workspace_invitation(
    client: tauri::State<'_, PunksDesktopClient>,
    code: String,
) -> Result<WorkspaceInvitationView, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.account()?.get_workspace_invitation(&code).await
}

/// Renderer input for an explicit invitation claim at one Workspace revision.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimInvitationInput {
    code: String,
    expected_revision: u64,
}

/// Claims one Workspace invitation through the Account authority.
#[tauri::command]
pub async fn punks_claim_workspace_invitation(
    client: tauri::State<'_, PunksDesktopClient>,
    input: ClaimInvitationInput,
) -> Result<ClaimWorkspaceInvitationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .account()?
        .claim_workspace_invitation(&input.code, input.expected_revision)
        .await
}

/// Renderer input for revoking one invitation at an expected revision.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeInvitationInput {
    invitation_id: String,
    expected_revision: u64,
}

/// Revokes one Workspace invitation through the mounted Workspace Session.
#[tauri::command]
pub async fn punks_revoke_workspace_invitation(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: RevokeInvitationInput,
) -> Result<RevokeWorkspaceInvitationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .revoke_invitation(&input.invitation_id, input.expected_revision)
        .await
}

/// Reads one bounded governance roster page for the mounted Workspace.
#[tauri::command]
pub async fn punks_get_workspace_governance(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: GovernancePageInput,
) -> Result<WorkspaceGovernancePage, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .get_governance_page(input.limit, input.cursor.as_deref())
        .await
}

/// Renderer input for one bounded governance roster page.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GovernancePageInput {
    limit: u16,
    cursor: Option<String>,
}

/// Renderer input for changing one member's integrated Workspace role.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetMemberRoleInput {
    target_punk_id: String,
    role: WorkspaceRole,
    expected_revision: u64,
}

/// Changes one member role through the generation-bound Workspace authority.
#[tauri::command]
pub async fn punks_set_workspace_member_role(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: SetMemberRoleInput,
) -> Result<WorkspaceMembershipMutationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .set_member_role(&input.target_punk_id, input.role, input.expected_revision)
        .await
}

/// Renderer input for removing one member at an expected Workspace revision.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveMemberInput {
    target_punk_id: String,
    expected_revision: u64,
}

/// Removes one Workspace member through the mounted authority.
#[tauri::command]
pub async fn punks_remove_workspace_member(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: RemoveMemberInput,
) -> Result<WorkspaceMembershipMutationResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .remove_member(&input.target_punk_id, input.expected_revision)
        .await
}

/// Leaves the mounted Workspace and immediately invalidates its native context.
#[tauri::command]
pub async fn punks_leave_workspace(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<WorkspaceMembershipLifecycleResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    let result = client.session(&lease).await?.leave_workspace().await?;
    client.invalidate_workspace_context().await?;
    Ok(result)
}

/// Renderer input for a strongly reauthorized ownership transfer.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferWorkspaceOwnershipInput {
    target_punk_id: String,
    expected_revision: u64,
}

/// Transfers Workspace ownership using one freshly consumed reauthorization.
#[tauri::command]
pub async fn punks_transfer_workspace_ownership(
    client: tauri::State<'_, PunksDesktopClient>,
    store: tauri::State<'_, Arc<KeyringSessionPersistence>>,
    lease: WorkspaceLease,
    input: TransferWorkspaceOwnershipInput,
) -> Result<WorkspaceMembershipLifecycleResult, ClientFailure> {
    let _operation = client.transitions.read().await;
    let target = uuid::Uuid::parse_str(&input.target_punk_id).map_err(|_| {
        ClientFailure::native(
            FailureKind::ContractViolation,
            "Punks ownership-transfer target is invalid",
        )
    })?;
    if target.to_string() != input.target_punk_id || input.expected_revision == 0 {
        return Err(ClientFailure::native(
            FailureKind::ContractViolation,
            "Punks ownership-transfer input is invalid",
        ));
    }
    let session = client.session(&lease).await?;
    let authorization = store
        .take_reauthorization(PendingAuthPurpose::TransferWorkspaceOwnership)
        .map_err(|_| {
            ClientFailure::native(
                FailureKind::Problem,
                "Punks strong reauthorization storage is unavailable",
            )
        })?
        .ok_or_else(|| {
            ClientFailure::native(
                FailureKind::Problem,
                "A fresh ownership-transfer reauthorization is required",
            )
        })?;
    session
        .transfer_ownership(
            &input.target_punk_id,
            input.expected_revision,
            &authorization.authorization_id,
        )
        .await
}
