import type {
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationResponse,
  WorkspaceGovernanceResponse,
  WorkspaceInvitationView,
  WorkspaceMembershipLifecycleResponse,
  WorkspaceMembershipMutationResponse,
  Punk,
  PunkSearchResponse,
  PunkSummaryBatchResponse,
} from "@punks/contracts";

import type {
  ClaimWorkspaceInvitationInput,
  CreateWorkspaceInvitationInput,
  RemoveWorkspaceMemberInput,
  RevokeWorkspaceInvitationInput,
  SetWorkspaceMemberRoleInput,
  WorkspaceLease,
  WorkspaceGovernancePageInput,
  PunkSearchInput,
  PunkSearchPage,
  UpdatePunkProfileInput,
  TransferWorkspaceOwnershipInput,
} from "./punksClientTypes";
import { invokePunks, requireContract } from "./punksTauriTransport";

export async function getPunkProfile(): Promise<Punk> {
  return requireContract<Punk>(
    "punks://contracts/punk@1",
    await invokePunks("punks_get_punk_profile"),
  );
}

export async function updatePunkProfile(
  input: UpdatePunkProfileInput,
): Promise<Punk> {
  return requireContract<Punk>(
    "punks://contracts/punk@1",
    await invokePunks("punks_update_punk_profile", { input }),
  );
}

export async function getPunkSummaries(
  lease: WorkspaceLease,
  punkIds: string[],
): Promise<PunkSummaryBatchResponse> {
  return requireContract<PunkSummaryBatchResponse>(
    "punks://contracts/punk.summary-batch-response@1",
    await invokePunks("punks_get_punk_summaries", { lease, punkIds }),
  );
}

export async function searchPunks(
  lease: WorkspaceLease,
  input: { query: PunkSearchInput; limit: number; cursor: string | null },
): Promise<PunkSearchPage> {
  return requireContract<PunkSearchResponse>(
    "punks://contracts/punk.search-response@1",
    await invokePunks("punks_search_punks", { lease, input }),
  );
}

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
  input: WorkspaceGovernancePageInput,
): Promise<WorkspaceGovernanceResponse> {
  return requireContract<WorkspaceGovernanceResponse>(
    "punks://contracts/workspace.governance-response@1",
    await invokePunks("punks_get_workspace_governance", { lease, input }),
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

export async function leaveWorkspace(
  lease: WorkspaceLease,
): Promise<WorkspaceMembershipLifecycleResponse> {
  return requireContract<WorkspaceMembershipLifecycleResponse>(
    "punks://contracts/workspace.membership-lifecycle-response@1",
    await invokePunks("punks_leave_workspace", { lease }),
  );
}

export async function transferWorkspaceOwnership(
  lease: WorkspaceLease,
  input: TransferWorkspaceOwnershipInput,
): Promise<WorkspaceMembershipLifecycleResponse> {
  return requireContract<WorkspaceMembershipLifecycleResponse>(
    "punks://contracts/workspace.membership-lifecycle-response@1",
    await invokePunks("punks_transfer_workspace_ownership", { lease, input }),
  );
}
