import type {
  AuthSession,
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationResponse,
  DesktopCompatibilityResponse,
  RevokeWorkspaceInvitationResponse,
  Workspace,
  WorkspaceGovernanceResponse,
  WorkspaceGovernanceView,
  WorkspaceInvitationView,
  WorkspaceMembershipLifecycleResponse,
  WorkspaceMembershipMutationResponse,
  WorkspaceSummary,
} from "@punks/contracts";

import type {
  ClaimWorkspaceInvitationInput,
  CreateWorkspaceInvitationInput,
  PunksAccountClient,
  PunksWorkspaceSession,
  RemoveWorkspaceMemberInput,
  RevokeWorkspaceInvitationInput,
  SetWorkspaceMemberRoleInput,
  TransferWorkspaceOwnershipInput,
  WorkspaceLease,
  WorkspaceGovernancePageInput,
} from "./punksClientTypes";
import { PunksDesktopFailure } from "./punksFailure";

type GovernanceSeed = {
  compatibility: DesktopCompatibilityResponse;
  session: AuthSession;
  workspaces: WorkspaceSummary[];
  governance?: Record<string, Workspace>;
  invitations?: Array<{
    code: string;
    invitation: WorkspaceInvitationView;
    issuerPunkId?: string;
  }>;
};

type GovernanceAuthority = {
  account: Pick<
    PunksAccountClient,
    "getWorkspaceInvitation" | "claimWorkspaceInvitation"
  >;
  workspace(
    lease: WorkspaceLease,
  ): Pick<
    PunksWorkspaceSession,
    | "getGovernancePage"
    | "createInvitation"
    | "revokeInvitation"
    | "setMemberRole"
    | "removeMember"
    | "leaveWorkspace"
    | "transferOwnership"
  >;
};

function syntheticOwnerId(workspaceId: string): string {
  return workspaceId === "00000000-0000-4000-8000-000000000001"
    ? "00000000-0000-4000-8000-000000000002"
    : "00000000-0000-4000-8000-000000000001";
}

function initialGovernance(seed: GovernanceSeed): Map<string, Workspace> {
  const provided = new Map(
    Object.entries(structuredClone(seed.governance ?? {})),
  );
  for (const summary of seed.workspaces) {
    if (provided.has(summary.id)) continue;
    const ownerPunkId =
      summary.role === "owner"
        ? seed.session.punkId
        : syntheticOwnerId(summary.id);
    const timestamp = seed.session.authenticatedAt;
    provided.set(summary.id, {
      id: summary.id,
      slug: summary.slug,
      name: summary.name,
      visibility: summary.visibility,
      status: "active",
      ownerPunkId,
      members: [
        { punkId: ownerPunkId, role: "owner" },
        ...(ownerPunkId === seed.session.punkId
          ? []
          : [{ punkId: seed.session.punkId, role: summary.role }]),
      ],
      revision: summary.revision,
      cursor: summary.revision,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return provided;
}

function invitationStatus(invitation: WorkspaceInvitationView): string {
  if (invitation.status === "revoked") return "revoked";
  if (Date.parse(invitation.expiresAt) <= Date.now()) return "expired";
  if (invitation.uses >= invitation.maxUses) return "exhausted";
  return "issued";
}

function problem(code: string, message: string): never {
  throw new PunksDesktopFailure("problem", message, { code });
}

export function createFakeGovernanceAuthority(
  seed: GovernanceSeed,
  assertCapability: (capability: string) => void,
  assertCurrent: (lease: WorkspaceLease) => void,
  consumeOwnershipReauthorization: (
    lease: WorkspaceLease,
    input: TransferWorkspaceOwnershipInput,
  ) => void,
  invalidateWorkspace: (lease: WorkspaceLease) => void,
): GovernanceAuthority {
  const workspaces = initialGovernance(seed);
  const invitations = new Map(
    (seed.invitations ?? []).map((entry) => [
      entry.code,
      {
        invitation: structuredClone(entry.invitation),
        issuerPunkId: entry.issuerPunkId ?? seed.session.punkId,
      },
    ]),
  );
  const governanceCursors = new Map<
    string,
    {
      workspaceId: string;
      punkId: string;
      revision: number;
      offset: number;
      limit: number;
    }
  >();

  const governanceView = (workspace: Workspace): WorkspaceGovernanceView => ({
    contract: "workspace.governance-view@1",
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    visibility: workspace.visibility,
    status: "active",
    ownerPunkId: workspace.ownerPunkId,
    memberCount: workspace.members.length,
    revision: workspace.revision,
    cursor: workspace.cursor,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  });

  const currentWorkspace = (lease: WorkspaceLease): Workspace => {
    assertCapability("identity-governance");
    assertCurrent(lease);
    const workspace = workspaces.get(lease.workspaceId);
    if (
      workspace === undefined ||
      !workspace.members.some((member) => member.punkId === lease.punkId)
    ) {
      return problem("forbidden", "Workspace roster is not accessible");
    }
    return workspace;
  };

  const requireOwner = (workspace: Workspace, punkId: string): void => {
    if (
      !workspace.members.some(
        (member) => member.punkId === punkId && member.role === "owner",
      )
    ) {
      problem("forbidden", "Only a Workspace Owner can manage members");
    }
  };

  const updateSummary = (workspace: Workspace, punkId: string) => {
    const membership = workspace.members.find(
      (member) => member.punkId === punkId,
    );
    const index = seed.workspaces.findIndex(
      (candidate) => candidate.id === workspace.id,
    );
    if (membership === undefined) {
      if (index >= 0) seed.workspaces.splice(index, 1);
      return;
    }
    const summary: WorkspaceSummary = {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      visibility: workspace.visibility,
      role: membership.role,
      revision: workspace.revision,
    };
    if (index >= 0) seed.workspaces[index] = summary;
    else seed.workspaces.push(summary);
  };

  const account: GovernanceAuthority["account"] = {
    async getWorkspaceInvitation(code) {
      assertCapability("identity-governance");
      const record = invitations.get(code);
      if (record === undefined)
        return problem("invite_invalid", "Invitation is invalid");
      const invitation = structuredClone(record.invitation);
      invitation.status = invitationStatus(
        invitation,
      ) as WorkspaceInvitationView["status"];
      return invitation;
    },
    async claimWorkspaceInvitation(input: ClaimWorkspaceInvitationInput) {
      assertCapability("identity-governance");
      const record = invitations.get(input.code);
      if (record === undefined)
        return problem("invite_invalid", "Invitation is invalid");
      const workspace = workspaces.get(record.invitation.workspace.id);
      if (workspace === undefined)
        return problem("not_found", "Workspace is absent");
      if (workspace.revision !== input.expectedRevision) {
        return problem("revision_conflict", "Workspace revision changed");
      }
      const existing = workspace.members.find(
        (member) => member.punkId === seed.session.punkId,
      );
      let result: ClaimWorkspaceInvitationResponse["result"] = "already_member";
      if (existing === undefined) {
        const status = invitationStatus(record.invitation);
        if (status !== "issued")
          return problem(`invite_${status}`, `Invitation is ${status}`);
        workspace.members.push({
          punkId: seed.session.punkId,
          role: record.invitation.role,
        });
        workspace.revision += 1;
        workspace.cursor += 1;
        workspace.updatedAt = new Date().toISOString();
        record.invitation.uses += 1;
        record.invitation.usesRemaining -= 1;
        result = "joined";
      }
      const membership = workspace.members.find(
        (member) => member.punkId === seed.session.punkId,
      );
      if (membership === undefined)
        return problem("internal", "Membership is absent");
      updateSummary(workspace, seed.session.punkId);
      return {
        contract: "workspace.invite-claim-response@1",
        result,
        workspace: {
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          visibility: workspace.visibility,
          role: membership.role,
          revision: workspace.revision,
        },
        replayed: false,
      };
    },
  };

  return {
    account,
    workspace: (lease) => ({
      async getGovernancePage(input: WorkspaceGovernancePageInput) {
        const workspace = currentWorkspace(lease);
        requireOwner(workspace, lease.punkId);
        if (
          !Number.isInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 100
        ) {
          return problem("invalid_input", "Workspace roster limit is invalid");
        }
        let offset = 0;
        if (input.cursor !== null) {
          const continuation = governanceCursors.get(input.cursor);
          if (
            continuation === undefined ||
            continuation.workspaceId !== workspace.id ||
            continuation.punkId !== lease.punkId ||
            continuation.limit !== input.limit
          ) {
            return problem(
              "invalid_input",
              "Workspace roster cursor is invalid",
            );
          }
          if (continuation.revision !== workspace.revision) {
            return problem("revision_conflict", "Workspace roster changed");
          }
          offset = continuation.offset;
        }
        const ordered = [...workspace.members].sort((left, right) =>
          left.punkId.localeCompare(right.punkId),
        );
        const members = ordered.slice(offset, offset + input.limit);
        const nextOffset = offset + members.length;
        let nextCursor: string | null = null;
        if (nextOffset < ordered.length) {
          nextCursor = `pmc1.${crypto.randomUUID().replaceAll("-", "")}.${"A".repeat(43)}`;
          governanceCursors.set(nextCursor, {
            workspaceId: workspace.id,
            punkId: lease.punkId,
            revision: workspace.revision,
            offset: nextOffset,
            limit: input.limit,
          });
        }
        const response: WorkspaceGovernanceResponse = {
          contract: "workspace.governance-response@1",
          workspace: governanceView(workspace),
          members: structuredClone(members),
          nextCursor,
        };
        return response;
      },
      async createInvitation(input: CreateWorkspaceInvitationInput) {
        const workspace = currentWorkspace(lease);
        requireOwner(workspace, lease.punkId);
        if (workspace.revision !== input.expectedRevision) {
          return problem("revision_conflict", "Workspace revision changed");
        }
        const secret = crypto.randomUUID().replaceAll("-", "").padEnd(43, "A");
        const code = `${workspace.id}.${secret}`;
        const now = new Date();
        const invitation: WorkspaceInvitationView = {
          contract: "workspace.invitation@1",
          invitationId: crypto.randomUUID(),
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
          },
          workspaceRevision: workspace.revision,
          role: input.role,
          status: "issued",
          issuedAt: now.toISOString(),
          expiresAt: new Date(
            now.getTime() + (input.ttlSeconds ?? 604_800) * 1_000,
          ).toISOString(),
          revokedAt: null,
          maxUses: input.maxUses ?? 1,
          uses: 0,
          usesRemaining: input.maxUses ?? 1,
        };
        invitations.set(code, { invitation, issuerPunkId: lease.punkId });
        const response: CreateWorkspaceInvitationResponse = {
          contract: "workspace.invite-response@1",
          invitation: structuredClone(invitation),
          code,
          replayed: false,
        };
        return response;
      },
      async revokeInvitation(input: RevokeWorkspaceInvitationInput) {
        const workspace = currentWorkspace(lease);
        if (workspace.revision !== input.expectedRevision) {
          return problem("revision_conflict", "Workspace revision changed");
        }
        const record = [...invitations.values()].find(
          ({ invitation }) => invitation.invitationId === input.invitationId,
        );
        if (record === undefined)
          return problem("invite_invalid", "Invitation is invalid");
        const role = workspace.members.find(
          (member) => member.punkId === lease.punkId,
        )?.role;
        if (record.issuerPunkId !== lease.punkId && role !== "owner") {
          return problem("forbidden", "Invitation revocation is forbidden");
        }
        record.invitation.status = "revoked";
        record.invitation.revokedAt = new Date().toISOString();
        const response: RevokeWorkspaceInvitationResponse = {
          contract: "workspace.invite-revoke-response@1",
          invitation: structuredClone(record.invitation),
          replayed: false,
        };
        return response;
      },
      async setMemberRole(input: SetWorkspaceMemberRoleInput) {
        const workspace = currentWorkspace(lease);
        requireOwner(workspace, lease.punkId);
        if (workspace.revision !== input.expectedRevision) {
          return problem("revision_conflict", "Workspace revision changed");
        }
        if (
          input.targetPunkId === workspace.ownerPunkId &&
          input.role !== "owner"
        ) {
          return problem(
            "invalid_transition",
            "Primary Owner cannot be demoted",
          );
        }
        const existing = workspace.members.find(
          (member) => member.punkId === input.targetPunkId,
        );
        if (existing?.role === input.role) {
          return problem("invalid_transition", "Punk already has this role");
        }
        if (existing === undefined) {
          workspace.members.push({
            punkId: input.targetPunkId,
            role: input.role,
          });
        } else existing.role = input.role;
        workspace.revision += 1;
        workspace.cursor += 1;
        workspace.updatedAt = new Date().toISOString();
        updateSummary(workspace, seed.session.punkId);
        const response: WorkspaceMembershipMutationResponse = {
          contract: "workspace.membership-mutation-response@1",
          workspace: governanceView(workspace),
          memberDeltas: [
            { punkId: input.targetPunkId, present: true, role: input.role },
          ],
          replayed: false,
        };
        return response;
      },
      async removeMember(input: RemoveWorkspaceMemberInput) {
        const workspace = currentWorkspace(lease);
        requireOwner(workspace, lease.punkId);
        if (workspace.revision !== input.expectedRevision) {
          return problem("revision_conflict", "Workspace revision changed");
        }
        if (input.targetPunkId === workspace.ownerPunkId) {
          return problem(
            "invalid_transition",
            "Primary Owner cannot be removed",
          );
        }
        const before = workspace.members.length;
        workspace.members = workspace.members.filter(
          (member) => member.punkId !== input.targetPunkId,
        ) as Workspace["members"];
        if (workspace.members.length === before) {
          return problem("invalid_transition", "Punk is not a member");
        }
        workspace.revision += 1;
        workspace.cursor += 1;
        workspace.updatedAt = new Date().toISOString();
        updateSummary(workspace, seed.session.punkId);
        const response: WorkspaceMembershipMutationResponse = {
          contract: "workspace.membership-mutation-response@1",
          workspace: governanceView(workspace),
          memberDeltas: [
            { punkId: input.targetPunkId, present: false, role: null },
          ],
          replayed: false,
        };
        return response;
      },
      async transferOwnership(input) {
        const workspace = currentWorkspace(lease);
        requireOwner(workspace, lease.punkId);
        if (workspace.revision !== input.expectedRevision) {
          return problem("revision_conflict", "Workspace revision changed");
        }
        const target = workspace.members.find(
          (member) => member.punkId === input.targetPunkId,
        );
        if (target === undefined || target.punkId === workspace.ownerPunkId) {
          return problem(
            "invalid_transition",
            "Ownership transfer requires another current member",
          );
        }
        consumeOwnershipReauthorization(lease, input);
        const previousOwner = workspace.members.find(
          (member) => member.punkId === workspace.ownerPunkId,
        );
        if (previousOwner?.role !== "owner") {
          return problem("internal", "Primary Owner is inconsistent");
        }
        previousOwner.role = "member";
        target.role = "owner";
        workspace.ownerPunkId = target.punkId;
        workspace.revision += 1;
        workspace.cursor += 1;
        workspace.updatedAt = new Date().toISOString();
        updateSummary(workspace, lease.punkId);
        const response: WorkspaceMembershipLifecycleResponse = {
          contract: "workspace.membership-lifecycle-response@1",
          workspaceId: workspace.id,
          revision: workspace.revision,
          outcome: "ownership_transferred",
          role: "member",
          replayed: false,
        };
        return response;
      },
      async leaveWorkspace() {
        const workspace = currentWorkspace(lease);
        if (workspace.ownerPunkId === lease.punkId) {
          return problem(
            "invalid_transition",
            "Primary Owner must transfer ownership before leaving",
          );
        }
        workspace.members = workspace.members.filter(
          (member) => member.punkId !== lease.punkId,
        ) as Workspace["members"];
        workspace.revision += 1;
        workspace.cursor += 1;
        workspace.updatedAt = new Date().toISOString();
        updateSummary(workspace, lease.punkId);
        const response: WorkspaceMembershipLifecycleResponse = {
          contract: "workspace.membership-lifecycle-response@1",
          workspaceId: workspace.id,
          revision: workspace.revision,
          outcome: "left",
          role: null,
          replayed: false,
        };
        invalidateWorkspace(lease);
        return response;
      },
    }),
  };
}
