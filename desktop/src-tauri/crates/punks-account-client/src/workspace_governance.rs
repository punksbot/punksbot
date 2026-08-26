use chrono::DateTime;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    contracts_profile, decode, validate_uuid, ClientFailure, FailureKind, PunksAccountClient,
    RequestSafety, WorkspaceSession, WorkspaceSummary,
};

const IDENTITY_GOVERNANCE_CAPABILITY: &str = "identity-governance";

/// Roles that a bearer invitation may promise directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceInvitationRole {
    Member,
    Guest,
}

/// Closed normative Workspace role union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRole {
    Owner,
    Moderator,
    Member,
    Guest,
}

/// Generated, bounded response DTOs transported unchanged through Tauri IPC.
pub type WorkspaceGovernanceMetadata = contracts_profile::WorkspaceGovernanceView;
/// Generated bounded Workspace governance page transported through Tauri IPC.
pub type WorkspaceGovernancePage = contracts_profile::WorkspaceGovernanceResponse;
/// Generated Workspace invitation view transported through Tauri IPC.
pub type WorkspaceInvitationView = contracts_profile::WorkspaceInvitationView;
/// Generated result of creating a Workspace invitation.
pub type CreateWorkspaceInvitationResult = contracts_profile::CreateWorkspaceInvitationResponse;
/// Generated result of revoking a Workspace invitation.
pub type RevokeWorkspaceInvitationResult = contracts_profile::RevokeWorkspaceInvitationResponse;
/// Generated result of a Workspace membership mutation.
pub type WorkspaceMembershipMutationResult = contracts_profile::WorkspaceMembershipMutationResponse;
/// Generated result of leaving or transferring ownership of a Workspace.
pub type WorkspaceMembershipLifecycleResult =
    contracts_profile::WorkspaceMembershipLifecycleResponse;
/// Generated result of claiming a Workspace invitation.
pub type ClaimWorkspaceInvitationResult = contracts_profile::ClaimWorkspaceInvitationResponse;

fn valid_timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok()
}

fn claim_visibility(
    value: &contracts_profile::ClaimWorkspaceInvitationResponseWorkspaceVisibility,
) -> &'static str {
    use contracts_profile::ClaimWorkspaceInvitationResponseWorkspaceVisibility as Visibility;
    match value {
        Visibility::Private => "private",
        Visibility::Punks => "punks",
        Visibility::Public => "public",
    }
}

fn claim_role(
    value: &contracts_profile::ClaimWorkspaceInvitationResponseWorkspaceRole,
) -> &'static str {
    use contracts_profile::ClaimWorkspaceInvitationResponseWorkspaceRole as Role;
    match value {
        Role::Owner => "owner",
        Role::Moderator => "moderator",
        Role::Member => "member",
        Role::Guest => "guest",
    }
}

fn generated_role_matches(
    value: &contracts_profile::PresentWorkspaceMemberDeltaRole,
    expected: WorkspaceRole,
) -> bool {
    use contracts_profile::PresentWorkspaceMemberDeltaRole as Role;
    matches!(
        (value, expected),
        (Role::Owner, WorkspaceRole::Owner)
            | (Role::Moderator, WorkspaceRole::Moderator)
            | (Role::Member, WorkspaceRole::Member)
            | (Role::Guest, WorkspaceRole::Guest)
    )
}

fn invitation_workspace_id(code: &str) -> Result<&str, ClientFailure> {
    if code.len() != 80 {
        return Err(ClientFailure::contract("workspace invitation code"));
    }
    let Some((workspace_id, secret)) = code.split_once('.') else {
        return Err(ClientFailure::contract("workspace invitation code"));
    };
    validate_uuid(workspace_id, "workspaceId")?;
    if secret.len() != 43
        || !secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(ClientFailure::contract("workspace invitation code"));
    }
    Ok(workspace_id)
}

fn validate_invitation(
    invitation: WorkspaceInvitationView,
    expected_workspace_id: &str,
) -> Result<WorkspaceInvitationView, ClientFailure> {
    validate_uuid(&invitation.invitation_id, "invitationId")?;
    validate_uuid(&invitation.workspace.id, "workspaceId")?;
    if invitation.contract != "workspace.invitation@1"
        || invitation.workspace.id != expected_workspace_id
        || invitation.workspace_revision == 0
        || invitation.workspace.slug.is_empty()
        || invitation.workspace.slug.len() > 48
        || invitation.workspace.name.is_empty()
        || invitation.workspace.name.len() > 80
        || !valid_timestamp(&invitation.issued_at)
        || !valid_timestamp(&invitation.expires_at)
        || invitation
            .revoked_at
            .as_deref()
            .is_some_and(|value| !valid_timestamp(value))
        || invitation.max_uses == 0
        || invitation.max_uses > 100
        || invitation.uses > invitation.max_uses
        || invitation.uses_remaining != invitation.max_uses - invitation.uses
    {
        return Err(ClientFailure::contract("workspace.invitation@1"));
    }
    Ok(invitation)
}

fn validate_governance_metadata(
    workspace: WorkspaceGovernanceMetadata,
    expected_workspace_id: &str,
) -> Result<WorkspaceGovernanceMetadata, ClientFailure> {
    validate_uuid(&workspace.id, "workspaceId")?;
    validate_uuid(&workspace.owner_punk_id, "ownerPunkId")?;
    if workspace.contract != "workspace.governance-view@1"
        || workspace.id != expected_workspace_id
        || workspace.slug.is_empty()
        || workspace.slug.len() > 48
        || workspace.name.is_empty()
        || workspace.name.len() > 80
        || workspace.status != "active"
        || workspace.member_count == 0
        || workspace.revision == 0
        || workspace.cursor == 0
        || !valid_timestamp(&workspace.created_at)
        || !valid_timestamp(&workspace.updated_at)
    {
        return Err(ClientFailure::contract("workspace.governance-view@1"));
    }
    Ok(workspace)
}

pub(crate) async fn require_identity_governance(
    client: &PunksAccountClient,
) -> Result<(), ClientFailure> {
    let state = client.inner.state.lock().await;
    if state.compatibility.as_ref().is_some_and(|value| {
        value.compatible
            && value
                .capabilities
                .iter()
                .any(|candidate| candidate == IDENTITY_GOVERNANCE_CAPABILITY)
    }) {
        Ok(())
    } else {
        Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "Punks capability identity-governance is not available",
        ))
    }
}

async fn account_punk_id(client: &PunksAccountClient) -> Result<String, ClientFailure> {
    client
        .inner
        .state
        .lock()
        .await
        .session
        .as_ref()
        .map(|session| session.punk_id.clone())
        .ok_or_else(|| ClientFailure::new(FailureKind::SessionExpired, "Punks Session is absent"))
}

impl PunksAccountClient {
    /// Consults one opaque code without mounting or caching its Workspace roster.
    pub async fn get_workspace_invitation(
        &self,
        code: &str,
    ) -> Result<WorkspaceInvitationView, ClientFailure> {
        require_identity_governance(self).await?;
        let workspace_id = invitation_workspace_id(code)?.to_owned();
        let response = self
            .inner
            .transport
            .request(
                Method::GET,
                format!("/api/v1/workspace-invitations/{code}"),
                None,
                RequestSafety::Read,
            )
            .await?;
        validate_invitation(decode("workspace.invitation@1", response)?, &workspace_id)
    }

    /// Claims one invitation exactly once; ambiguous transport is never retried here.
    pub async fn claim_workspace_invitation(
        &self,
        code: &str,
        expected_revision: u64,
    ) -> Result<ClaimWorkspaceInvitationResult, ClientFailure> {
        require_identity_governance(self).await?;
        if expected_revision == 0 {
            return Err(ClientFailure::contract("workspace.invite-claim@1"));
        }
        let workspace_id = invitation_workspace_id(code)?.to_owned();
        let punk_id = account_punk_id(self).await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .inner
            .transport
            .request(
                Method::POST,
                format!("/api/v1/workspace-invitations/{code}/claim"),
                Some(json!({
                    "contract": "workspace.invite-claim@1",
                    "commandId": command_id,
                    "workspaceId": workspace_id,
                    "actor": { "kind": "punk", "punkId": punk_id },
                    "payload": { "code": code, "expectedRevision": expected_revision },
                })),
                RequestSafety::Mutation,
            )
            .await?;
        let result: ClaimWorkspaceInvitationResult =
            decode("workspace.invite-claim-response@1", response)?;
        if result.contract != "workspace.invite-claim-response@1"
            || result.workspace.id != workspace_id
            || result.workspace.revision < expected_revision
        {
            return Err(ClientFailure::contract("workspace.invite-claim-response@1"));
        }
        validate_uuid(&result.workspace.id, "workspaceId")?;
        let summary = WorkspaceSummary {
            id: result.workspace.id.clone(),
            slug: result.workspace.slug.clone(),
            name: result.workspace.name.clone(),
            visibility: claim_visibility(&result.workspace.visibility).to_owned(),
            role: claim_role(&result.workspace.role).to_owned(),
            revision: result.workspace.revision,
        };
        let mut state = self.inner.state.lock().await;
        state
            .workspace_ids_by_slug
            .insert(summary.slug.clone(), summary.id.clone());
        state.workspaces_by_id.insert(summary.id.clone(), summary);
        Ok(result)
    }
}

impl WorkspaceSession {
    /// Reads one stable, authority-bound roster page from the Workspace Durable Object.
    pub async fn get_governance_page(
        &self,
        limit: u16,
        cursor: Option<&str>,
    ) -> Result<WorkspaceGovernancePage, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        if !(1..=100).contains(&limit)
            || cursor.is_some_and(|value| {
                value.is_empty()
                    || value.len() > 1_024
                    || !value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-')
                    })
            })
        {
            return Err(ClientFailure::contract("workspace.governance@1"));
        }
        self.assert_current().await?;
        let query = {
            let mut serializer = url::form_urlencoded::Serializer::new(String::new());
            serializer.append_pair("limit", &limit.to_string());
            if let Some(cursor) = cursor {
                serializer.append_pair("cursor", cursor);
            }
            serializer.finish()
        };
        let response = self
            .request(
                Method::GET,
                format!(
                    "/api/v1/workspaces/{}/governance?{query}",
                    self.lease.workspace_id
                ),
                None,
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let mut page: WorkspaceGovernancePage =
            decode("workspace.governance-response@1", response)?;
        page.workspace = validate_governance_metadata(page.workspace, &self.lease.workspace_id)?;
        if page.contract != "workspace.governance-response@1"
            || page.members.len() > usize::from(limit)
            || page.members.len() as u64 > page.workspace.member_count
            || page.next_cursor.as_ref().is_some_and(|value| {
                value.is_empty()
                    || value.len() > 1_024
                    || !value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-')
                    })
            })
        {
            return Err(ClientFailure::contract("workspace.governance-response@1"));
        }
        let mut seen = std::collections::HashSet::with_capacity(page.members.len());
        for member in &page.members {
            validate_uuid(&member.punk_id, "member.punkId")?;
            if !seen.insert(member.punk_id.as_str()) {
                return Err(ClientFailure::contract("workspace.governance-response@1"));
            }
        }
        Ok(page)
    }

    /// Emits one bounded invitation through the generation-bound native Session.
    pub async fn create_invitation(
        &self,
        role: WorkspaceInvitationRole,
        expected_revision: u64,
        ttl_seconds: Option<u32>,
        max_uses: Option<u16>,
    ) -> Result<CreateWorkspaceInvitationResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        if expected_revision == 0
            || ttl_seconds.is_some_and(|value| !(60..=2_592_000).contains(&value))
            || max_uses.is_some_and(|value| !(1..=100).contains(&value))
        {
            return Err(ClientFailure::contract("workspace.invite@1"));
        }
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let mut payload = json!({
            "role": role,
            "expectedRevision": expected_revision,
        });
        if let Some(ttl_seconds) = ttl_seconds {
            payload["ttlSeconds"] = json!(ttl_seconds);
        }
        if let Some(max_uses) = max_uses {
            payload["maxUses"] = json!(max_uses);
        }
        let response = self
            .request(
                Method::POST,
                format!("/api/v1/workspaces/{}/invitations", self.lease.workspace_id),
                Some(json!({
                    "contract": "workspace.invite@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": payload,
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: CreateWorkspaceInvitationResult =
            decode("workspace.invite-response@1", response)?;
        if result.contract != "workspace.invite-response@1"
            || invitation_workspace_id(&result.code)? != self.lease.workspace_id
        {
            return Err(ClientFailure::contract("workspace.invite-response@1"));
        }
        let invitation = validate_invitation(result.invitation, &self.lease.workspace_id)?;
        Ok(CreateWorkspaceInvitationResult {
            invitation,
            ..result
        })
    }

    /// Revokes one invitation through an explicit revision-bound intent.
    pub async fn revoke_invitation(
        &self,
        invitation_id: &str,
        expected_revision: u64,
    ) -> Result<RevokeWorkspaceInvitationResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(invitation_id, "invitationId")?;
        if expected_revision == 0 {
            return Err(ClientFailure::contract("workspace.invite-revoke@1"));
        }
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::DELETE,
                format!(
                    "/api/v1/workspaces/{}/invitations/{invitation_id}",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "workspace.invite-revoke@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "invitationId": invitation_id,
                        "expectedRevision": expected_revision,
                    },
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: RevokeWorkspaceInvitationResult =
            decode("workspace.invite-revoke-response@1", response)?;
        let invitation = validate_invitation(result.invitation, &self.lease.workspace_id)?;
        if result.contract != "workspace.invite-revoke-response@1"
            || invitation.invitation_id != invitation_id
            || !matches!(
                invitation.status,
                contracts_profile::WorkspaceInvitationViewStatus::Revoked
            )
        {
            return Err(ClientFailure::contract(
                "workspace.invite-revoke-response@1",
            ));
        }
        Ok(RevokeWorkspaceInvitationResult {
            invitation,
            ..result
        })
    }

    /// Changes one current membership role and verifies the authoritative ACK.
    pub async fn set_member_role(
        &self,
        target_punk_id: &str,
        role: WorkspaceRole,
        expected_revision: u64,
    ) -> Result<WorkspaceMembershipMutationResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(target_punk_id, "targetPunkId")?;
        let Some(expected_next_revision) = expected_revision.checked_add(1) else {
            return Err(ClientFailure::contract("workspace.member-set-role@1"));
        };
        if expected_revision == 0 {
            return Err(ClientFailure::contract("workspace.member-set-role@1"));
        }
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::PUT,
                format!(
                    "/api/v1/workspaces/{}/members/{target_punk_id}",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "workspace.member-set-role@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "targetPunkId": target_punk_id,
                        "role": role,
                        "expectedRevision": expected_revision,
                    },
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: WorkspaceMembershipMutationResult =
            decode("workspace.membership-mutation-response@1", response)?;
        let workspace = validate_governance_metadata(result.workspace, &self.lease.workspace_id)?;
        let valid_delta = matches!(
            result.member_deltas.as_slice(),
            [contracts_profile::WorkspaceMembershipMutationResponseMemberDeltas::WorkspaceMembershipMutationResponseMemberDeltasSuccess(delta)]
                if delta.punk_id == target_punk_id
                    && delta.present
                    && generated_role_matches(&delta.role, role)
        );
        if result.contract != "workspace.membership-mutation-response@1"
            || workspace.revision != expected_next_revision
            || !valid_delta
        {
            return Err(ClientFailure::contract(
                "workspace.membership-mutation-response@1",
            ));
        }
        Ok(WorkspaceMembershipMutationResult {
            workspace,
            ..result
        })
    }

    /// Removes one non-primary member through an explicit revision-bound intent.
    pub async fn remove_member(
        &self,
        target_punk_id: &str,
        expected_revision: u64,
    ) -> Result<WorkspaceMembershipMutationResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(target_punk_id, "targetPunkId")?;
        let Some(expected_next_revision) = expected_revision.checked_add(1) else {
            return Err(ClientFailure::contract("workspace.member-remove@1"));
        };
        if expected_revision == 0 {
            return Err(ClientFailure::contract("workspace.member-remove@1"));
        }
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::DELETE,
                format!(
                    "/api/v1/workspaces/{}/members/{target_punk_id}",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "workspace.member-remove@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "targetPunkId": target_punk_id,
                        "expectedRevision": expected_revision,
                    },
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: WorkspaceMembershipMutationResult =
            decode("workspace.membership-mutation-response@1", response)?;
        let workspace = validate_governance_metadata(result.workspace, &self.lease.workspace_id)?;
        let valid_delta = matches!(
            result.member_deltas.as_slice(),
            [contracts_profile::WorkspaceMembershipMutationResponseMemberDeltas::WorkspaceMembershipMutationResponseMemberDeltasFailure(delta)]
                if delta.punk_id == target_punk_id && !delta.present
        );
        if result.contract != "workspace.membership-mutation-response@1"
            || workspace.revision != expected_next_revision
            || !valid_delta
        {
            return Err(ClientFailure::contract(
                "workspace.membership-mutation-response@1",
            ));
        }
        Ok(WorkspaceMembershipMutationResult {
            workspace,
            ..result
        })
    }

    /// Leaves the current Workspace and invalidates every local lease before returning.
    pub async fn leave_workspace(
        &self,
    ) -> Result<WorkspaceMembershipLifecycleResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::POST,
                format!("/api/v1/workspaces/{}/leave", self.lease.workspace_id),
                Some(json!({
                    "contract": "workspace.leave@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {},
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: WorkspaceMembershipLifecycleResult =
            decode("workspace.membership-lifecycle-response@1", response)?;
        if result.contract != "workspace.membership-lifecycle-response@1"
            || result.workspace_id != self.lease.workspace_id
            || result.revision == 0
            || !matches!(
                result.outcome,
                contracts_profile::WorkspaceMembershipLifecycleResponseOutcome::Left
            )
            || result.role.is_some()
        {
            return Err(ClientFailure::contract(
                "workspace.membership-lifecycle-response@1",
            ));
        }
        self.invalidate_departed_workspace().await;
        Ok(result)
    }

    /// Transfers primary ownership after one native-only reauthorization grant.
    pub async fn transfer_ownership(
        &self,
        target_punk_id: &str,
        expected_revision: u64,
        reauthorization_id: &str,
    ) -> Result<WorkspaceMembershipLifecycleResult, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(target_punk_id, "targetPunkId")?;
        validate_uuid(reauthorization_id, "reauthorizationId")?;
        let Some(expected_next_revision) = expected_revision.checked_add(1) else {
            return Err(ClientFailure::contract("workspace.transfer-ownership@1"));
        };
        if expected_revision == 0 {
            return Err(ClientFailure::contract("workspace.transfer-ownership@1"));
        }
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/transfer-ownership",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "workspace.transfer-ownership@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "targetPunkId": target_punk_id,
                        "expectedRevision": expected_revision,
                        "reauthorizationId": reauthorization_id,
                    },
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let result: WorkspaceMembershipLifecycleResult =
            decode("workspace.membership-lifecycle-response@1", response)?;
        if result.contract != "workspace.membership-lifecycle-response@1"
            || result.workspace_id != self.lease.workspace_id
            || result.revision != expected_next_revision
            || !matches!(
                result.outcome,
                contracts_profile::WorkspaceMembershipLifecycleResponseOutcome::OwnershipTransferred
            )
            || result.role.as_deref() != Some("member")
        {
            return Err(ClientFailure::contract(
                "workspace.membership-lifecycle-response@1",
            ));
        }
        self.record_membership_role("member", result.revision).await;
        Ok(result)
    }
}
