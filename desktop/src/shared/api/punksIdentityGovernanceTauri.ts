import type {
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationResponse,
  Workspace,
  WorkspaceInvitationView,
  WorkspaceMembershipMutationResponse,
} from "@punks/contracts";

import type {
  ClaimWorkspaceInvitationInput,
  CreateWorkspaceInvitationInput,
  RemoveWorkspaceMemberInput,
  RevokeWorkspaceInvitationInput,
  SetWorkspaceMemberRoleInput,
  WorkspaceLease,
} from "./punksClientTypes";
import { invokePunks, requireContract } from "./punksTauriTransport";

export async function getWorkspaceInvitation(
  code: string,
): Promise<WorkspaceInvitationView> {
  return requireContract<WorkspaceInvitationView>(
    "punks://contracts/workspace.invitation@1",
    await invokePunks("punks_get_workspace_invitation", { code }),
  );
}

export async function claimWorkspaceInvitation(
  input: ClaimWorkspaceInvitationInput,
): Promise<ClaimWorkspaceInvitationResponse> {
  return requireContract<ClaimWorkspaceInvitationResponse>(
    "punks://contracts/workspace.invite-claim-response@1",
    await invokePunks("punks_claim_workspace_invitation", { input }),
  );
}

export async function getWorkspaceGovernance(
  lease: WorkspaceLease,
): Promise<Workspace> {
  return requireContract<Workspace>(
    "punks://contracts/workspace@1",
    await invokePunks("punks_get_workspace_governance", { lease }),
  );
}

export async function createWorkspaceInvitation(
  lease: WorkspaceLease,
  input: CreateWorkspaceInvitationInput,
): Promise<CreateWorkspaceInvitationResponse> {
  return requireContract<CreateWorkspaceInvitationResponse>(
    "punks://contracts/workspace.invite-response@1",
    await invokePunks("punks_create_workspace_invitation", { lease, input }),
  );
}

export async function revokeWorkspaceInvitation(
  lease: WorkspaceLease,
  input: RevokeWorkspaceInvitationInput,
): Promise<RevokeWorkspaceInvitationResponse> {
  return requireContract<RevokeWorkspaceInvitationResponse>(
    "punks://contracts/workspace.invite-revoke-response@1",
    await invokePunks("punks_revoke_workspace_invitation", { lease, input }),
  );
}

export async function setWorkspaceMemberRole(
  lease: WorkspaceLease,
  input: SetWorkspaceMemberRoleInput,
): Promise<WorkspaceMembershipMutationResponse> {
  return requireContract<WorkspaceMembershipMutationResponse>(
    "punks://contracts/workspace.membership-mutation-response@1",
    await invokePunks("punks_set_workspace_member_role", { lease, input }),
  );
}

export async function removeWorkspaceMember(
  lease: WorkspaceLease,
  input: RemoveWorkspaceMemberInput,
): Promise<WorkspaceMembershipMutationResponse> {
  return requireContract<WorkspaceMembershipMutationResponse>(
    "punks://contracts/workspace.membership-mutation-response@1",
    await invokePunks("punks_remove_workspace_member", { lease, input }),
  );
}
