import type {
  ClaimWorkspaceInvitationCommand,
  CreateWorkspaceCommand,
  LeaveWorkspaceCommand,
  RemoveWorkspaceMemberCommand,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  TransferWorkspaceOwnershipCommand,
  UnsignedNostrEvent,
  Workspace,
  WorkspaceEventContentV2,
  WorkspaceMemberDeltaV2,
  WorkspaceMembershipCommitmentV2,
  WorkspaceTransitionV2,
} from "@punks/contracts";

import { canonicalJson } from "./json";
import {
  type MembershipProjectionCommitment,
  type PreparedMembershipProjection,
  prepareMembershipProjection,
} from "./membership-projection";
import { roleHasPermission, type WorkspaceRole } from "./permissions";

export const PUNKS_EVENT_KINDS = {
  workspaceCreated: 50000,
  workspaceRenamed: 50001,
  journalSegmentSealed: 50002,
  workspaceMemberRoleSet: 50003,
  workspaceMemberRemoved: 50004,
  workspaceAccountMerged: 50005,
  conversationCreated: 50100,
  conversationMemberJoined: 50101,
  conversationMemberAccessSet: 50102,
  conversationMemberRemoved: 50103,
  conversationJournalSegmentSealed: 50104,
  conversationMetadataUpdated: 50105,
  conversationArchived: 50106,
  conversationRestored: 50107,
  messagePosted: 50200,
  messageEdited: 50201,
  messageRetracted: 50202,
  messageRestored: 50203,
  messageErasureMarked: 50204,
  messageReactionAdded: 50210,
  messageReactionRemoved: 50211,
  botPublished: 50300,
  botUpdated: 50301,
  botJournalSegmentSealed: 50302,
  botInstallationInstalled: 50310,
  botInstallationConfigured: 50311,
  botInstallationRevoked: 50312,
  botInstallationJournalSegmentSealed: 50313,
  botActionAdmitted: 50320,
  botActionCompleted: 50321,
} as const;

export type WorkspaceDomainErrorCode =
  | "already_exists"
  | "not_found"
  | "forbidden"
  | "invalid_transition"
  | "revision_conflict"
  | "invite_role_forbidden";

export class WorkspaceDomainError extends Error {
  constructor(
    readonly code: WorkspaceDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceDomainError";
  }
}

function requireWorkspacePermission(
  current: Workspace | null,
  workspaceId: string,
  punkId: string,
  permission: "workspace.rename" | "members.manage",
): Workspace {
  if (current === null || current.id !== workspaceId) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  const member = current.members.find(
    (candidate) => candidate.punkId === punkId,
  );
  if (
    member === undefined ||
    !roleHasPermission(member.role as WorkspaceRole, permission)
  ) {
    throw new WorkspaceDomainError(
      "forbidden",
      "Actor does not have the required Workspace permission",
    );
  }
  return current;
}

export interface WorkspaceDecision {
  event: UnsignedNostrEvent;
  nextState: Workspace;
}

export interface WorkspaceDecisionV2 extends WorkspaceDecision {
  membershipProjection: PreparedMembershipProjection<WorkspaceMemberDeltaV2>;
}

export interface WorkspaceDecisionContext {
  workspaceId: string;
  cursor: number;
  now: Date;
}

function workspaceMembershipCommitmentV2(
  commitment: MembershipProjectionCommitment,
): WorkspaceMembershipCommitmentV2 {
  const firstDigest = commitment.chunkDigests[0];
  if (firstDigest === undefined) {
    throw new TypeError("Membership commitment requires at least one chunk");
  }
  return {
    ...commitment,
    chunkDigests: [firstDigest, ...commitment.chunkDigests.slice(1)],
  };
}

async function workspaceDecisionV2(
  decision: WorkspaceDecision,
  context: WorkspaceDecisionContext,
  transition: WorkspaceTransitionV2,
  memberDeltas: readonly WorkspaceMemberDeltaV2[],
): Promise<WorkspaceDecisionV2> {
  const membershipProjection = await prepareMembershipProjection(
    { workspaceId: context.workspaceId, cursor: context.cursor },
    memberDeltas,
  );
  const { members, ...workspace } = decision.nextState;
  const content: WorkspaceEventContentV2 = {
    schemaVersion: 2,
    workspace: { ...workspace, memberCount: members.length },
    transition,
    membershipCommitment: workspaceMembershipCommitmentV2(
      membershipProjection.commitment,
    ),
  };
  return {
    ...decision,
    event: {
      ...decision.event,
      tags: [
        ...decision.event.tags,
        [
          "delta",
          "sha256",
          membershipProjection.commitment.deltaDigest,
          String(membershipProjection.commitment.deltaCount),
          String(membershipProjection.commitment.chunkCount),
        ],
      ],
      content: canonicalJson(content),
    },
    membershipProjection,
  };
}

function eventTags(
  workspaceId: string,
  cursor: number,
  commandId: string,
  contract: string,
  punkId: string,
): [string, ...string[]][] {
  return [
    ["workspace", workspaceId],
    ["cursor", String(cursor)],
    ["command", commandId],
    ["contract", contract],
    ["actor", "punk", punkId],
  ];
}

export function decideCreateWorkspace(
  current: Workspace | null,
  command: CreateWorkspaceCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (current !== null) {
    throw new WorkspaceDomainError(
      "already_exists",
      "Workspace already exists",
    );
  }

  const timestamp = context.now.toISOString();
  const nextState: Workspace = {
    id: context.workspaceId,
    slug: command.payload.slug,
    name: command.payload.name,
    visibility: command.payload.visibility,
    status: "active",
    ownerPunkId: command.actor.punkId,
    members: [{ punkId: command.actor.punkId, role: "owner" }],
    revision: 1,
    cursor: context.cursor,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceCreated,
      tags: eventTags(
        context.workspaceId,
        context.cursor,
        command.commandId,
        command.contract,
        command.actor.punkId,
      ),
      content: canonicalJson({ schemaVersion: 1, workspace: nextState }),
    },
  };
}

export async function decideCreateWorkspaceV2(
  current: Workspace | null,
  command: CreateWorkspaceCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const decision = decideCreateWorkspace(current, command, context);
  return workspaceDecisionV2(decision, context, { type: "created" }, [
    {
      punkId: command.actor.punkId,
      present: true,
      role: "owner",
    },
  ]);
}

export function decideRenameWorkspace(
  current: Workspace | null,
  command: RenameWorkspaceCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (command.workspaceId !== context.workspaceId) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  current = requireWorkspacePermission(
    current,
    command.workspaceId,
    command.actor.punkId,
    "workspace.rename",
  );
  if (current.slug === command.payload.slug) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Workspace already has this slug",
    );
  }

  const nextState: Workspace = {
    ...current,
    slug: command.payload.slug,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };

  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceRenamed,
      tags: eventTags(
        context.workspaceId,
        context.cursor,
        command.commandId,
        command.contract,
        command.actor.punkId,
      ),
      content: canonicalJson({
        previousSlug: current.slug,
        schemaVersion: 1,
        workspace: nextState,
      }),
    },
  };
}

export async function decideRenameWorkspaceV2(
  current: Workspace | null,
  command: RenameWorkspaceCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const previousSlug = current?.slug;
  const decision = decideRenameWorkspace(current, command, context);
  if (previousSlug === undefined) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  return workspaceDecisionV2(
    decision,
    context,
    { type: "renamed", previousSlug },
    [],
  );
}

export function decideSetWorkspaceMemberRole(
  current: Workspace | null,
  command: SetWorkspaceMemberRoleCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (command.workspaceId !== context.workspaceId) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  current = requireWorkspacePermission(
    current,
    command.workspaceId,
    command.actor.punkId,
    "members.manage",
  );
  if (command.payload.expectedRevision !== current.revision) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace revision changed before role assignment",
    );
  }
  const existingIndex = current.members.findIndex(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const existing = current.members[existingIndex];
  if (
    existing === undefined &&
    (command.payload.role === "owner" || command.payload.role === "moderator")
  ) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk must be admitted before receiving an elevated Workspace role",
    );
  }
  if (existing?.role === command.payload.role) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk already has this Workspace role",
    );
  }
  if (
    command.payload.targetPunkId === current.ownerPunkId &&
    command.payload.role !== "owner"
  ) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Primary Workspace owner cannot be demoted",
    );
  }
  const nextMembers = [...current.members];
  if (existingIndex < 0) {
    nextMembers.push({
      punkId: command.payload.targetPunkId,
      role: command.payload.role,
    });
  } else {
    nextMembers[existingIndex] = {
      punkId: command.payload.targetPunkId,
      role: command.payload.role,
    };
  }
  const nextState: Workspace = {
    ...current,
    members: nextMembers as Workspace["members"],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceMemberRoleSet,
      tags: [
        ...eventTags(
          context.workspaceId,
          context.cursor,
          command.commandId,
          command.contract,
          command.actor.punkId,
        ),
        ["target", "punk", command.payload.targetPunkId],
      ],
      content: canonicalJson({
        previousRole: existing?.role ?? null,
        role: command.payload.role,
        schemaVersion: 1,
        targetPunkId: command.payload.targetPunkId,
        workspace: nextState,
      }),
    },
  };
}

export async function decideSetWorkspaceMemberRoleV2(
  current: Workspace | null,
  command: SetWorkspaceMemberRoleCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const existing = current?.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const decision = decideSetWorkspaceMemberRole(current, command, context);
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "member-upserted",
      targetPunkId: command.payload.targetPunkId,
      previousRole: existing?.role ?? null,
      role: command.payload.role,
    },
    [
      {
        punkId: command.payload.targetPunkId,
        present: true,
        role: command.payload.role,
      },
    ],
  );
}

/**
 * Admits the authenticated claimant at the role promised by a stateful
 * invitation. Invitation validity and consumption remain the WorkspaceDO's
 * responsibility; this decision owns only the authoritative membership fact.
 */
export function decideClaimWorkspaceInvitation(
  current: Workspace | null,
  command: ClaimWorkspaceInvitationCommand,
  promisedRole: "member" | "guest",
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (
    current === null ||
    current.id !== command.workspaceId ||
    command.workspaceId !== context.workspaceId
  ) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  if (current.revision !== command.payload.expectedRevision) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace revision changed before invitation claim",
    );
  }
  if (promisedRole !== "member" && promisedRole !== "guest") {
    throw new WorkspaceDomainError(
      "invite_role_forbidden",
      "Invitation cannot promise this Workspace role",
    );
  }
  if (
    current.members.some((member) => member.punkId === command.actor.punkId)
  ) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is already a Workspace member",
    );
  }

  const nextState: Workspace = {
    ...current,
    members: [
      ...current.members,
      { punkId: command.actor.punkId, role: promisedRole },
    ] as Workspace["members"],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceMemberRoleSet,
      tags: [
        ...eventTags(
          context.workspaceId,
          context.cursor,
          command.commandId,
          command.contract,
          command.actor.punkId,
        ),
        ["target", "punk", command.actor.punkId],
      ],
      content: canonicalJson({
        previousRole: null,
        role: promisedRole,
        schemaVersion: 1,
        targetPunkId: command.actor.punkId,
        workspace: nextState,
      }),
    },
  };
}

/** Builds the bounded V2 membership delta for one invitation claim. */
export async function decideClaimWorkspaceInvitationV2(
  current: Workspace | null,
  command: ClaimWorkspaceInvitationCommand,
  promisedRole: "member" | "guest",
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const decision = decideClaimWorkspaceInvitation(
    current,
    command,
    promisedRole,
    context,
  );
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "member-upserted",
      targetPunkId: command.actor.punkId,
      previousRole: null,
      role: promisedRole,
    },
    [
      {
        punkId: command.actor.punkId,
        present: true,
        role: promisedRole,
      },
    ],
  );
}

export function decideRemoveWorkspaceMember(
  current: Workspace | null,
  command: RemoveWorkspaceMemberCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (command.workspaceId !== context.workspaceId) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  current = requireWorkspacePermission(
    current,
    command.workspaceId,
    command.actor.punkId,
    "members.manage",
  );
  if (command.payload.expectedRevision !== current.revision) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace revision changed before member removal",
    );
  }
  if (command.payload.targetPunkId === current.ownerPunkId) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Primary Workspace owner cannot be removed",
    );
  }
  const existing = current.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  if (existing === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is not a Workspace member",
    );
  }
  const nextState: Workspace = {
    ...current,
    members: current.members.filter(
      (member) => member.punkId !== command.payload.targetPunkId,
    ) as Workspace["members"],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceMemberRemoved,
      tags: [
        ...eventTags(
          context.workspaceId,
          context.cursor,
          command.commandId,
          command.contract,
          command.actor.punkId,
        ),
        ["target", "punk", command.payload.targetPunkId],
      ],
      content: canonicalJson({
        previousRole: existing.role,
        schemaVersion: 1,
        targetPunkId: command.payload.targetPunkId,
        workspace: nextState,
      }),
    },
  };
}

export async function decideRemoveWorkspaceMemberV2(
  current: Workspace | null,
  command: RemoveWorkspaceMemberCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const existing = current?.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const decision = decideRemoveWorkspaceMember(current, command, context);
  if (existing === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is not a Workspace member",
    );
  }
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "member-removed",
      targetPunkId: command.payload.targetPunkId,
      previousRole: existing.role,
    },
    [
      {
        punkId: command.payload.targetPunkId,
        present: false,
        role: existing.role,
      },
    ],
  );
}

export function decideLeaveWorkspace(
  current: Workspace | null,
  command: LeaveWorkspaceCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (
    current === null ||
    current.id !== command.workspaceId ||
    command.workspaceId !== context.workspaceId
  ) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  const existing = current.members.find(
    (member) => member.punkId === command.actor.punkId,
  );
  if (existing === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is not a Workspace member",
    );
  }
  if (command.actor.punkId === current.ownerPunkId) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Primary Workspace owner must transfer ownership before leaving",
    );
  }
  const nextState: Workspace = {
    ...current,
    members: current.members.filter(
      (member) => member.punkId !== command.actor.punkId,
    ) as Workspace["members"],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceMemberRemoved,
      tags: [
        ...eventTags(
          context.workspaceId,
          context.cursor,
          command.commandId,
          command.contract,
          command.actor.punkId,
        ),
        ["target", "punk", command.actor.punkId],
      ],
      content: canonicalJson({
        previousRole: existing.role,
        schemaVersion: 1,
        targetPunkId: command.actor.punkId,
        workspace: nextState,
      }),
    },
  };
}

export async function decideLeaveWorkspaceV2(
  current: Workspace | null,
  command: LeaveWorkspaceCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const existing = current?.members.find(
    (member) => member.punkId === command.actor.punkId,
  );
  const decision = decideLeaveWorkspace(current, command, context);
  if (existing === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is not a Workspace member",
    );
  }
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "member-removed",
      targetPunkId: command.actor.punkId,
      previousRole: existing.role,
    },
    [
      {
        punkId: command.actor.punkId,
        present: false,
        role: existing.role,
      },
    ],
  );
}
export function decideTransferWorkspaceOwnership(
  current: Workspace | null,
  command: TransferWorkspaceOwnershipCommand,
  context: WorkspaceDecisionContext,
): WorkspaceDecision {
  if (command.workspaceId !== context.workspaceId) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  current = requireWorkspacePermission(
    current,
    command.workspaceId,
    command.actor.punkId,
    "members.manage",
  );
  if (command.payload.expectedRevision !== current.revision) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace revision changed before ownership transfer",
    );
  }
  if (command.actor.punkId !== current.ownerPunkId) {
    throw new WorkspaceDomainError(
      "forbidden",
      "Only the primary Workspace owner can transfer ownership",
    );
  }
  if (command.payload.targetPunkId === current.ownerPunkId) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Punk is already the primary Workspace owner",
    );
  }
  const previousOwnerIndex = current.members.findIndex(
    (member) => member.punkId === current.ownerPunkId,
  );
  const targetIndex = current.members.findIndex(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const previousOwner = current.members[previousOwnerIndex];
  const target = current.members[targetIndex];
  if (previousOwner?.role !== "owner" || target === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Ownership transfer requires a current eligible Workspace member",
    );
  }
  const nextMembers = [...current.members];
  nextMembers[previousOwnerIndex] = {
    punkId: previousOwner.punkId,
    role: "member",
  };
  nextMembers[targetIndex] = { punkId: target.punkId, role: "owner" };
  const nextState: Workspace = {
    ...current,
    ownerPunkId: target.punkId,
    members: nextMembers as Workspace["members"],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceMemberRoleSet,
      tags: [
        ...eventTags(
          context.workspaceId,
          context.cursor,
          command.commandId,
          command.contract,
          command.actor.punkId,
        ),
        ["previous_owner", "punk", previousOwner.punkId],
        ["target", "punk", target.punkId],
      ],
      content: canonicalJson({
        previousOwnerPunkId: previousOwner.punkId,
        previousTargetRole: target.role,
        schemaVersion: 1,
        targetPunkId: target.punkId,
        workspace: nextState,
      }),
    },
  };
}

export async function decideTransferWorkspaceOwnershipV2(
  current: Workspace | null,
  command: TransferWorkspaceOwnershipCommand,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  const previousOwner = current?.members.find(
    (member) => member.punkId === current?.ownerPunkId,
  );
  const target = current?.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const decision = decideTransferWorkspaceOwnership(current, command, context);
  if (previousOwner?.role !== "owner" || target === undefined) {
    throw new WorkspaceDomainError(
      "invalid_transition",
      "Ownership transfer requires a current eligible Workspace member",
    );
  }
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "ownership-transferred",
      memberTransitions: [
        {
          type: "member-upserted",
          targetPunkId: previousOwner.punkId,
          previousRole: "owner",
          role: "member",
        },
        {
          type: "member-upserted",
          targetPunkId: target.punkId,
          previousRole: target.role,
          role: "owner",
        },
      ],
    },
    [
      { punkId: previousOwner.punkId, present: true, role: "member" },
      { punkId: target.punkId, present: true, role: "owner" },
    ],
  );
}

/** Exact authority snapshot held by one Workspace during Account Merge. */
export interface ApplyAccountMergeToWorkspaceInput {
  workspaceId: string;
  planId: string;
  receiptId: string;
  commitCommandId: string;
  survivorPunkId: string;
  absorbedPunkId: string;
  expectedRevision: number;
  survivorRole: WorkspaceRole | null;
  absorbedRole: WorkspaceRole;
  resultingRole: WorkspaceRole;
}

const ACCOUNT_MERGE_ROLE_STRENGTH = {
  guest: 0,
  member: 1,
  moderator: 2,
  owner: 3,
} as const satisfies Readonly<Record<WorkspaceRole, number>>;

function strongestAccountMergeRole(
  survivorRole: WorkspaceRole | null,
  absorbedRole: WorkspaceRole,
): WorkspaceRole {
  return survivorRole !== null &&
    ACCOUNT_MERGE_ROLE_STRENGTH[survivorRole] >=
      ACCOUNT_MERGE_ROLE_STRENGTH[absorbedRole]
    ? survivorRole
    : absorbedRole;
}

/**
 * Moves only current Workspace authority. Prior journal entries keep the
 * absorbed Punk ID and are never rewritten.
 */
export async function decideApplyAccountMergeToWorkspaceV2(
  current: Workspace | null,
  input: ApplyAccountMergeToWorkspaceInput,
  context: WorkspaceDecisionContext,
): Promise<WorkspaceDecisionV2> {
  if (
    current === null ||
    current.id !== input.workspaceId ||
    context.workspaceId !== input.workspaceId ||
    current.status !== "active"
  ) {
    throw new WorkspaceDomainError("not_found", "Workspace does not exist");
  }
  if (
    current.revision !== input.expectedRevision ||
    input.survivorPunkId === input.absorbedPunkId
  ) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace authority changed before Account Merge",
    );
  }
  const survivor = current.members.find(
    (member) => member.punkId === input.survivorPunkId,
  );
  const absorbed = current.members.find(
    (member) => member.punkId === input.absorbedPunkId,
  );
  if (
    (survivor?.role ?? null) !== input.survivorRole ||
    absorbed?.role !== input.absorbedRole ||
    strongestAccountMergeRole(input.survivorRole, input.absorbedRole) !==
      input.resultingRole
  ) {
    throw new WorkspaceDomainError(
      "revision_conflict",
      "Workspace roles changed before Account Merge",
    );
  }
  const members: Workspace["members"] = [
    { punkId: input.survivorPunkId, role: input.resultingRole },
    ...current.members.filter(
      (member) =>
        member.punkId !== input.survivorPunkId &&
        member.punkId !== input.absorbedPunkId,
    ),
  ];
  const nextState: Workspace = {
    ...current,
    ownerPunkId:
      current.ownerPunkId === input.absorbedPunkId
        ? input.survivorPunkId
        : current.ownerPunkId,
    members,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  const decision: WorkspaceDecision = {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1000),
      kind: PUNKS_EVENT_KINDS.workspaceAccountMerged,
      tags: [
        ["workspace", input.workspaceId],
        ["cursor", String(context.cursor)],
        ["command", input.commitCommandId],
        ["contract", "account-merge.commit@1"],
        ["actor", "system", "account-merge"],
        ["plan", input.planId],
        ["receipt", input.receiptId],
        ["survivor", "punk", input.survivorPunkId],
        ["absorbed", "punk", input.absorbedPunkId],
      ],
      content: canonicalJson({
        schemaVersion: 1,
        planId: input.planId,
        receiptId: input.receiptId,
        survivorPunkId: input.survivorPunkId,
        absorbedPunkId: input.absorbedPunkId,
        survivorPreviousRole: input.survivorRole,
        absorbedPreviousRole: input.absorbedRole,
        resultingRole: input.resultingRole,
        workspace: nextState,
      }),
    },
  };
  return workspaceDecisionV2(
    decision,
    context,
    {
      type: "account-merge-applied",
      planId: input.planId,
      receiptId: input.receiptId,
      survivorPunkId: input.survivorPunkId,
      absorbedPunkId: input.absorbedPunkId,
      survivorPreviousRole: input.survivorRole,
      absorbedPreviousRole: input.absorbedRole,
      resultingRole: input.resultingRole,
    },
    [
      {
        punkId: input.absorbedPunkId,
        present: false,
        role: input.absorbedRole,
      },
      {
        punkId: input.survivorPunkId,
        present: true,
        role: input.resultingRole,
      },
    ],
  );
}
