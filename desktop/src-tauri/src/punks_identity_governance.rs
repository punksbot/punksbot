use punks_account_client::{
    ClaimWorkspaceInvitationResult, ClientFailure, CreateWorkspaceInvitationResult,
    RevokeWorkspaceInvitationResult, WorkspaceGovernanceView, WorkspaceInvitationRole,
    WorkspaceInvitationView, WorkspaceLease, WorkspaceMembershipMutationResult, WorkspaceRole,
};
use serde::Deserialize;

use crate::punks_client::PunksDesktopClient;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInvitationInput {
    role: WorkspaceInvitationRole,
    expected_revision: u64,
    ttl_seconds: Option<u32>,
    max_uses: Option<u16>,
}

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

#[tauri::command]
pub async fn punks_get_workspace_invitation(
    client: tauri::State<'_, PunksDesktopClient>,
    code: String,
) -> Result<WorkspaceInvitationView, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.account()?.get_workspace_invitation(&code).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimInvitationInput {
    code: String,
    expected_revision: u64,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeInvitationInput {
    invitation_id: String,
    expected_revision: u64,
}

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

#[tauri::command]
pub async fn punks_get_workspace_governance(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
) -> Result<WorkspaceGovernanceView, ClientFailure> {
    let _operation = client.transitions.read().await;
    client.session(&lease).await?.get_governance().await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetMemberRoleInput {
    target_punk_id: String,
    role: WorkspaceRole,
    expected_revision: u64,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveMemberInput {
    target_punk_id: String,
    expected_revision: u64,
}

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
