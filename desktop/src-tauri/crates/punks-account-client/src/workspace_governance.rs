use chrono::DateTime;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    decode, validate_uuid, ClientFailure, FailureKind, PunksAccountClient, RequestSafety,
    WorkspaceSession, WorkspaceSummary,
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

/// One authoritative roster entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMember {
    pub punk_id: String,
    pub role: WorkspaceRole,
}

/// Full Workspace authority view available only to a current member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceGovernanceView {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: String,
    pub status: String,
    pub owner_punk_id: String,
    pub members: Vec<WorkspaceMember>,
    pub revision: u64,
    pub cursor: u64,
    pub created_at: String,
    pub updated_at: String,
}

/// Bounded Workspace coordinates exposed to a holder of an opaque code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceInvitationWorkspace {
    pub id: String,
    pub slug: String,
    pub name: String,
}

/// Invitation state deliberately excluding issuer identity and roster data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceInvitationView {
    pub contract: String,
    pub invitation_id: String,
    pub workspace: WorkspaceInvitationWorkspace,
    pub workspace_revision: u64,
    pub role: WorkspaceInvitationRole,
    pub status: String,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
    pub max_uses: u16,
    pub uses: u16,
    pub uses_remaining: u16,
}

/// Result returned only to the issuer; the opaque code is never cached by React Query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateWorkspaceInvitationResult {
    pub contract: String,
    pub invitation: WorkspaceInvitationView,
    pub code: String,
    pub replayed: bool,
}

/// Closed acknowledgement for an invitation revocation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeWorkspaceInvitationResult {
    pub contract: String,
    pub invitation: WorkspaceInvitationView,
    pub replayed: bool,
}

/// Closed acknowledgement for a Workspace role or membership mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMembershipMutationResult {
    pub contract: String,
    pub workspace: WorkspaceGovernanceView,
    pub replayed: bool,
}

/// Bounded Workspace summary returned after a claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimedWorkspaceSummary {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: String,
    pub role: String,
    pub revision: u64,
}

/// Idempotent result of an explicit invitation claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimWorkspaceInvitationResult {
    pub contract: String,
    pub result: String,
    pub workspace: ClaimedWorkspaceSummary,
    pub replayed: bool,
}

fn valid_timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok()
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
    let status = matches!(
        invitation.status.as_str(),
        "issued" | "revoked" | "expired" | "exhausted"
    );
    if invitation.contract != "workspace.invitation@1"
        || invitation.workspace.id != expected_workspace_id
        || invitation.workspace_revision == 0
        || invitation.workspace.slug.is_empty()
        || invitation.workspace.slug.len() > 48
        || invitation.workspace.name.is_empty()
        || invitation.workspace.name.len() > 80
        || !status
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

fn validate_governance(
    workspace: WorkspaceGovernanceView,
    expected_workspace_id: &str,
) -> Result<WorkspaceGovernanceView, ClientFailure> {
    validate_uuid(&workspace.id, "workspaceId")?;
    validate_uuid(&workspace.owner_punk_id, "ownerPunkId")?;
    let mut seen = std::collections::HashSet::with_capacity(workspace.members.len());
    for member in &workspace.members {
        validate_uuid(&member.punk_id, "member.punkId")?;
        if !seen.insert(member.punk_id.as_str()) {
            return Err(ClientFailure::contract("workspace@1"));
        }
    }
    if workspace.id != expected_workspace_id
        || workspace.slug.is_empty()
        || workspace.slug.len() > 48
        || workspace.name.is_empty()
        || workspace.name.len() > 80
        || !matches!(
            workspace.visibility.as_str(),
            "private" | "punks" | "public"
        )
        || workspace.status != "active"
        || workspace.members.is_empty()
        || workspace.revision == 0
        || workspace.cursor == 0
        || !valid_timestamp(&workspace.created_at)
        || !valid_timestamp(&workspace.updated_at)
        || !workspace.members.iter().any(|member| {
            member.punk_id == workspace.owner_punk_id && member.role == WorkspaceRole::Owner
        })
    {
        return Err(ClientFailure::contract("workspace@1"));
    }
    Ok(workspace)
}

async fn require_governance_capability(client: &PunksAccountClient) -> Result<(), ClientFailure> {
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
        require_governance_capability(self).await?;
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
        require_governance_capability(self).await?;
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
            || !matches!(result.result.as_str(), "joined" | "already_member")
            || result.workspace.id != workspace_id
            || result.workspace.revision < expected_revision
            || !matches!(
                result.workspace.role.as_str(),
                "owner" | "moderator" | "member" | "guest"
            )
        {
            return Err(ClientFailure::contract("workspace.invite-claim-response@1"));
        }
        validate_uuid(&result.workspace.id, "workspaceId")?;
        let summary = WorkspaceSummary {
            id: result.workspace.id.clone(),
            slug: result.workspace.slug.clone(),
            name: result.workspace.name.clone(),
            visibility: result.workspace.visibility.clone(),
            role: result.workspace.role.clone(),
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
    /// Reads the authoritative roster directly from the Workspace Durable Object.
    pub async fn get_governance(&self) -> Result<WorkspaceGovernanceView, ClientFailure> {
        require_governance_capability(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        self.assert_current().await?;
        let response = self
            .request(
                Method::GET,
                format!("/api/v1/workspaces/{}/governance", self.lease.workspace_id),
                None,
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        validate_governance(decode("workspace@1", response)?, &self.lease.workspace_id)
    }

    /// Emits one bounded invitation through the generation-bound native Session.
    pub async fn create_invitation(
        &self,
        role: WorkspaceInvitationRole,
        expected_revision: u64,
        ttl_seconds: Option<u32>,
        max_uses: Option<u16>,
    ) -> Result<CreateWorkspaceInvitationResult, ClientFailure> {
        require_governance_capability(&PunksAccountClient {
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
        require_governance_capability(&PunksAccountClient {
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
            || invitation.status != "revoked"
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
        require_governance_capability(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(target_punk_id, "targetPunkId")?;
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
        let workspace = validate_governance(result.workspace, &self.lease.workspace_id)?;
        if result.contract != "workspace.membership-mutation-response@1"
            || workspace.revision != expected_revision + 1
            || !workspace
                .members
                .iter()
                .any(|member| member.punk_id == target_punk_id && member.role == role)
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
        require_governance_capability(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(target_punk_id, "targetPunkId")?;
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
        let workspace = validate_governance(result.workspace, &self.lease.workspace_id)?;
        if result.contract != "workspace.membership-mutation-response@1"
            || workspace.revision != expected_revision + 1
            || workspace
                .members
                .iter()
                .any(|member| member.punk_id == target_punk_id)
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
}
