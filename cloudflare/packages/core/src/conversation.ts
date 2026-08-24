import type {
  ArchiveConversationCommand,
  Conversation,
  ConversationEventContentV2,
  ConversationMemberDeltaV2,
  ConversationMembershipCommitmentV2,
  ConversationTransitionV2,
  CreateConversationCommand,
  JoinConversationCommand,
  RemoveConversationMemberCommand,
  RestoreConversationCommand,
  SetConversationMemberAccessCommand,
  UnsignedNostrEvent,
  UpdateConversationCommand,
} from "@punks/contracts";

import { canonicalJson } from "./json";
import {
  type MembershipProjectionCommitment,
  type PreparedMembershipProjection,
  prepareMembershipProjection,
} from "./membership-projection";
import { roleHasPermission, type WorkspaceRole } from "./permissions";
import { PUNKS_EVENT_KINDS } from "./workspace";

export const CONVERSATION_EVENT_KINDS = {
  conversationCreated: PUNKS_EVENT_KINDS.conversationCreated,
  conversationMemberJoined: PUNKS_EVENT_KINDS.conversationMemberJoined,
  conversationMemberAccessSet: PUNKS_EVENT_KINDS.conversationMemberAccessSet,
  conversationMemberRemoved: PUNKS_EVENT_KINDS.conversationMemberRemoved,
  conversationMetadataUpdated: PUNKS_EVENT_KINDS.conversationMetadataUpdated,
  conversationArchived: PUNKS_EVENT_KINDS.conversationArchived,
  conversationRestored: PUNKS_EVENT_KINDS.conversationRestored,
} as const;

export type ConversationDomainErrorCode =
  | "already_exists"
  | "not_found"
  | "forbidden"
  | "invalid_transition";

export class ConversationDomainError extends Error {
  constructor(
    readonly code: ConversationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationDomainError";
  }
}

export interface ConversationDecisionContext {
  conversationId: string;
  cursor: number;
  now: Date;
  workspaceCursor: number;
  workspaceRole: WorkspaceRole;
}

export interface ConversationDecision {
  event: UnsignedNostrEvent;
  nextState: Conversation;
}

export interface ConversationDecisionV2 extends ConversationDecision {
  membershipProjection: PreparedMembershipProjection<ConversationMemberDeltaV2>;
}

type ConversationCommand =
  | CreateConversationCommand
  | JoinConversationCommand
  | SetConversationMemberAccessCommand
  | RemoveConversationMemberCommand
  | UpdateConversationCommand
  | ArchiveConversationCommand
  | RestoreConversationCommand;

function conversationMembershipCommitmentV2(
  commitment: MembershipProjectionCommitment,
): ConversationMembershipCommitmentV2 {
  const firstDigest = commitment.chunkDigests[0];
  if (firstDigest === undefined) {
    throw new TypeError("Membership commitment requires at least one chunk");
  }
  return {
    ...commitment,
    chunkDigests: [firstDigest, ...commitment.chunkDigests.slice(1)],
  };
}

async function conversationDecisionV2(
  decision: ConversationDecision,
  context: ConversationDecisionContext,
  transition: ConversationTransitionV2,
  memberDeltas: readonly ConversationMemberDeltaV2[],
): Promise<ConversationDecisionV2> {
  const membershipProjection = await prepareMembershipProjection(
    {
      workspaceId: decision.nextState.workspaceId,
      conversationId: context.conversationId,
      cursor: context.cursor,
    },
    memberDeltas,
  );
  const { members, ...conversation } = decision.nextState;
  const content: ConversationEventContentV2 = {
    schemaVersion: 2,
    conversation: { ...conversation, memberCount: members.length },
    transition,
    membershipCommitment: conversationMembershipCommitmentV2(
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

export function canonicalConversationName(name: string): string {
  return name
    .trimStart()
    .replace(/^#+\s*/, "")
    .trimEnd();
}

function actorPunkId(command: ConversationCommand): string {
  return command.actor.punkId;
}

function commandConversationId(command: ConversationCommand): string | null {
  return command.contract === "conversation.create@1"
    ? null
    : command.conversationId;
}

function eventTags(
  command: ConversationCommand,
  context: ConversationDecisionContext,
): [string, ...string[]][] {
  return [
    ["workspace", command.workspaceId],
    ["conversation", context.conversationId],
    ["cursor", String(context.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", "punk", actorPunkId(command)],
    ["workspace_cursor", String(context.workspaceCursor)],
    ["workspace_role", context.workspaceRole],
  ];
}

function requireCurrent(
  current: Conversation | null,
  command: Exclude<ConversationCommand, CreateConversationCommand>,
  context: ConversationDecisionContext,
): Conversation {
  if (
    current === null ||
    current.id !== commandConversationId(command) ||
    current.id !== context.conversationId ||
    current.workspaceId !== command.workspaceId
  ) {
    throw new ConversationDomainError(
      "not_found",
      "Conversation does not exist in this Workspace",
    );
  }
  return current;
}

function requireActive(current: Conversation): Conversation {
  if (current.status !== "active") {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation is not active",
    );
  }
  return current;
}

function requireWorkspacePermission(
  context: ConversationDecisionContext,
  permission: "workspace.read" | "conversations.write",
): void {
  if (!roleHasPermission(context.workspaceRole, permission)) {
    throw new ConversationDomainError(
      "forbidden",
      "Workspace role does not carry the required permission",
    );
  }
}

function canManageConversation(
  current: Conversation,
  punkId: string,
  workspaceRole: WorkspaceRole,
): boolean {
  const membership = current.members.find((member) => member.punkId === punkId);
  return (
    punkId === current.ownerPunkId ||
    membership?.access === "owner" ||
    membership?.access === "manager" ||
    roleHasPermission(workspaceRole, "moderation.perform")
  );
}

function uniquePunkIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nextState(
  current: Conversation,
  patch: Partial<Conversation>,
  context: ConversationDecisionContext,
): Conversation {
  const ttlSeconds =
    patch.ttlSeconds === undefined ? current.ttlSeconds : patch.ttlSeconds;
  const status = patch.status ?? current.status;
  return {
    ...current,
    ...patch,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
    ttlDeadline:
      status === "active" && ttlSeconds !== null
        ? new Date(context.now.getTime() + ttlSeconds * 1_000).toISOString()
        : null,
  };
}

function decision(
  command: ConversationCommand,
  context: ConversationDecisionContext,
  state: Conversation,
  kind: number,
  details: Record<string, unknown> = {},
  additionalTags: [string, ...string[]][] = [],
): ConversationDecision {
  const { members, ...metadata } = state;
  return {
    nextState: state,
    event: {
      created_at: Math.floor(context.now.getTime() / 1_000),
      kind,
      tags: [...eventTags(command, context), ...additionalTags],
      content: canonicalJson({
        schemaVersion: 1,
        ...details,
        conversation: { ...metadata, memberCount: members.length },
      }),
    },
  };
}

export function decideCreateConversation(
  current: Conversation | null,
  command: CreateConversationCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  if (current !== null) {
    throw new ConversationDomainError(
      "already_exists",
      "Conversation already exists",
    );
  }
  requireWorkspacePermission(context, "conversations.write");
  const requestedName = canonicalConversationName(command.payload.name);
  if (requestedName.length === 0) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation name is required",
    );
  }

  const participantPunkIds = uniquePunkIds([
    command.actor.punkId,
    ...(command.payload.participantPunkIds ?? []),
  ]);
  const isDm = command.payload.type === "dm";
  if (isDm) {
    if (command.payload.visibility !== "private") {
      throw new ConversationDomainError(
        "invalid_transition",
        "Direct conversations are always private",
      );
    }
    if (participantPunkIds.length < 2 || participantPunkIds.length > 9) {
      throw new ConversationDomainError(
        "invalid_transition",
        "Direct conversations require two to nine distinct Punks",
      );
    }
    if (
      command.payload.ttlSeconds !== undefined ||
      command.payload.maxMembers !== undefined
    ) {
      throw new ConversationDomainError(
        "invalid_transition",
        "Direct conversation participants are immutable",
      );
    }
  }
  const configuredMaximum = command.payload.maxMembers ?? null;
  if (
    configuredMaximum !== null &&
    participantPunkIds.length > configuredMaximum
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Initial participants exceed maxMembers",
    );
  }

  const timestamp = context.now.toISOString();
  const state: Conversation = {
    id: context.conversationId,
    workspaceId: command.workspaceId,
    name: isDm
      ? participantPunkIds.length === 2
        ? "DM"
        : `Group DM (${participantPunkIds.length})`
      : requestedName,
    type: command.payload.type,
    visibility: command.payload.visibility,
    description: command.payload.description ?? null,
    topic: null,
    purpose: null,
    topicRequired: command.payload.topicRequired ?? false,
    maxMembers: isDm ? participantPunkIds.length : configuredMaximum,
    ttlSeconds: command.payload.ttlSeconds ?? null,
    ttlDeadline:
      command.payload.ttlSeconds === undefined
        ? null
        : new Date(
            context.now.getTime() + command.payload.ttlSeconds * 1_000,
          ).toISOString(),
    ownerPunkId: command.actor.punkId,
    members: participantPunkIds.map((punkId) => ({
      punkId,
      access: isDm || punkId !== command.actor.punkId ? "member" : "owner",
      joinedAt: timestamp,
      invitedByPunkId:
        punkId === command.actor.punkId ? null : command.actor.punkId,
    })) as Conversation["members"],
    status: "active",
    revision: 1,
    cursor: context.cursor,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationCreated,
    {
      initialMembers: state.members.map(({ access, punkId }) => ({
        access,
        punkId,
      })),
    },
  );
}

export async function decideCreateConversationV2(
  current: Conversation | null,
  command: CreateConversationCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const decision = decideCreateConversation(current, command, context);
  return conversationDecisionV2(
    decision,
    context,
    { type: "created" },
    decision.nextState.members.map((member) => ({
      ...member,
      present: true,
    })),
  );
}

export function decideJoinConversation(
  current: Conversation | null,
  command: JoinConversationCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireActive(requireCurrent(current, command, context));
  requireWorkspacePermission(context, "conversations.write");
  if (current.type === "dm" || current.visibility !== "open") {
    throw new ConversationDomainError(
      "forbidden",
      "Only open non-DM conversations allow self-join",
    );
  }
  if (
    current.members.some((member) => member.punkId === command.actor.punkId)
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Punk is already a Conversation member",
    );
  }
  if (
    current.maxMembers !== null &&
    current.members.length >= current.maxMembers
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation has reached maxMembers",
    );
  }
  const state = nextState(
    current,
    {
      members: [
        ...current.members,
        {
          punkId: command.actor.punkId,
          access: "member",
          joinedAt: context.now.toISOString(),
          invitedByPunkId: null,
        },
      ] as Conversation["members"],
    },
    context,
  );
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationMemberJoined,
    { access: "member" },
    [["target", "punk", command.actor.punkId]],
  );
}

export async function decideJoinConversationV2(
  current: Conversation | null,
  command: JoinConversationCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const decision = decideJoinConversation(current, command, context);
  const membership = decision.nextState.members.find(
    (member) => member.punkId === command.actor.punkId,
  );
  if (membership === undefined) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Joined Conversation membership is missing",
    );
  }
  return conversationDecisionV2(
    decision,
    context,
    {
      type: "member-joined",
      targetPunkId: command.actor.punkId,
      access: membership.access,
    },
    [{ ...membership, present: true }],
  );
}

export function decideSetConversationMemberAccess(
  current: Conversation | null,
  command: SetConversationMemberAccessCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireActive(requireCurrent(current, command, context));
  requireWorkspacePermission(context, "workspace.read");
  if (current.type === "dm") {
    throw new ConversationDomainError(
      "invalid_transition",
      "Direct conversation participant sets are immutable",
    );
  }
  if (
    !canManageConversation(current, command.actor.punkId, context.workspaceRole)
  ) {
    throw new ConversationDomainError(
      "forbidden",
      "Actor cannot manage Conversation members",
    );
  }
  if (command.payload.targetPunkId === current.ownerPunkId) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Primary Conversation owner cannot be changed through member access",
    );
  }
  const index = current.members.findIndex(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const existing = current.members[index];
  if (existing?.access === command.payload.access) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Punk already has this Conversation access",
    );
  }
  if (
    existing === undefined &&
    current.maxMembers !== null &&
    current.members.length >= current.maxMembers
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation has reached maxMembers",
    );
  }
  const members = [...current.members];
  if (existing === undefined) {
    members.push({
      punkId: command.payload.targetPunkId,
      access: command.payload.access,
      joinedAt: context.now.toISOString(),
      invitedByPunkId: command.actor.punkId,
    });
  } else {
    members[index] = { ...existing, access: command.payload.access };
  }
  const state = nextState(
    current,
    { members: members as Conversation["members"] },
    context,
  );
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationMemberAccessSet,
    {
      access: command.payload.access,
      previousAccess: existing?.access ?? null,
    },
    [["target", "punk", command.payload.targetPunkId]],
  );
}

export async function decideSetConversationMemberAccessV2(
  current: Conversation | null,
  command: SetConversationMemberAccessCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const previousAccess = current?.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  )?.access;
  const decision = decideSetConversationMemberAccess(current, command, context);
  const membership = decision.nextState.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  if (membership === undefined) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Updated Conversation membership is missing",
    );
  }
  return conversationDecisionV2(
    decision,
    context,
    {
      type: "member-access-set",
      targetPunkId: command.payload.targetPunkId,
      previousAccess: previousAccess ?? null,
      access: membership.access,
    },
    [{ ...membership, present: true }],
  );
}

export function decideRemoveConversationMember(
  current: Conversation | null,
  command: RemoveConversationMemberCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireActive(requireCurrent(current, command, context));
  requireWorkspacePermission(context, "workspace.read");
  if (current.type === "dm") {
    throw new ConversationDomainError(
      "invalid_transition",
      "Direct conversation participant sets are immutable",
    );
  }
  const selfRemoval = command.actor.punkId === command.payload.targetPunkId;
  if (
    !selfRemoval &&
    !canManageConversation(current, command.actor.punkId, context.workspaceRole)
  ) {
    throw new ConversationDomainError(
      "forbidden",
      "Actor cannot remove this Conversation member",
    );
  }
  if (command.payload.targetPunkId === current.ownerPunkId) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Primary Conversation owner cannot leave or be removed",
    );
  }
  const existing = current.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  if (existing === undefined) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Punk is not a Conversation member",
    );
  }
  const state = nextState(
    current,
    {
      members: current.members.filter(
        (member) => member.punkId !== command.payload.targetPunkId,
      ) as Conversation["members"],
    },
    context,
  );
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationMemberRemoved,
    { previousAccess: existing.access },
    [["target", "punk", command.payload.targetPunkId]],
  );
}

export async function decideRemoveConversationMemberV2(
  current: Conversation | null,
  command: RemoveConversationMemberCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const existing = current?.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  const decision = decideRemoveConversationMember(current, command, context);
  if (existing === undefined) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Punk is not a Conversation member",
    );
  }
  return conversationDecisionV2(
    decision,
    context,
    {
      type: "member-removed",
      targetPunkId: command.payload.targetPunkId,
      previousAccess: existing.access,
    },
    [{ ...existing, present: false }],
  );
}

function nullableText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function hasOwn(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}

function requireConversationManager(
  current: Conversation,
  actorPunkId: string,
  workspaceRole: WorkspaceRole,
): void {
  if (!canManageConversation(current, actorPunkId, workspaceRole)) {
    throw new ConversationDomainError(
      "forbidden",
      "Actor cannot manage Conversation metadata",
    );
  }
}

export function decideUpdateConversation(
  current: Conversation | null,
  command: UpdateConversationCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireActive(requireCurrent(current, command, context));
  requireWorkspacePermission(context, "workspace.read");
  requireConversationManager(
    current,
    command.actor.punkId,
    context.workspaceRole,
  );

  const payload = command.payload;
  const patch: Partial<Conversation> = {};
  if (hasOwn(payload, "name")) {
    const name = canonicalConversationName(payload.name ?? "");
    if (name.length === 0) {
      throw new ConversationDomainError(
        "invalid_transition",
        "Conversation name is required",
      );
    }
    patch.name = name;
  }
  if (hasOwn(payload, "description")) {
    patch.description = nullableText(payload.description ?? null);
  }
  if (hasOwn(payload, "visibility")) {
    patch.visibility = payload.visibility ?? current.visibility;
  }
  if (hasOwn(payload, "topic")) {
    patch.topic = nullableText(payload.topic ?? null);
  }
  if (hasOwn(payload, "purpose")) {
    patch.purpose = nullableText(payload.purpose ?? null);
  }
  if (hasOwn(payload, "topicRequired")) {
    patch.topicRequired = payload.topicRequired ?? current.topicRequired;
  }
  if (hasOwn(payload, "maxMembers")) {
    patch.maxMembers = payload.maxMembers ?? null;
  }
  if (hasOwn(payload, "ttlSeconds")) {
    patch.ttlSeconds = payload.ttlSeconds ?? null;
  }

  const effectiveMaxMembers =
    patch.maxMembers === undefined ? current.maxMembers : patch.maxMembers;
  if (
    effectiveMaxMembers !== null &&
    effectiveMaxMembers < current.members.length
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "maxMembers cannot be lower than the active participant count",
    );
  }
  if (
    current.type === "dm" &&
    ((patch.name !== undefined && patch.name !== current.name) ||
      (patch.visibility !== undefined &&
        patch.visibility !== current.visibility) ||
      (patch.maxMembers !== undefined &&
        patch.maxMembers !== current.maxMembers) ||
      (patch.ttlSeconds !== undefined &&
        patch.ttlSeconds !== current.ttlSeconds))
  ) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Direct Conversation identity, visibility, participant limit, and permanence are immutable",
    );
  }

  const changedEntries = Object.entries(patch).filter(
    ([key, value]) => current[key as keyof Conversation] !== value,
  );
  if (changedEntries.length === 0) {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation metadata is unchanged",
    );
  }
  const changedPatch = Object.fromEntries(
    changedEntries,
  ) as Partial<Conversation>;
  const state = nextState(current, changedPatch, context);
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationMetadataUpdated,
    {
      changedFields: changedEntries.map(([key]) => key),
      previousMetadata: Object.fromEntries(
        changedEntries.map(([key]) => [
          key,
          current[key as keyof Conversation],
        ]),
      ),
    },
  );
}

const conversationMetadataKeys = [
  "name",
  "description",
  "visibility",
  "topic",
  "purpose",
  "topicRequired",
  "maxMembers",
  "ttlSeconds",
] as const;

export async function decideUpdateConversationV2(
  current: Conversation | null,
  command: UpdateConversationCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const decision = decideUpdateConversation(current, command, context);
  if (current === null) {
    throw new ConversationDomainError(
      "not_found",
      "Conversation does not exist in this Workspace",
    );
  }
  const changedFields = conversationMetadataKeys.filter(
    (key) => current[key] !== decision.nextState[key],
  );
  const previousMetadata = Object.fromEntries(
    changedFields.map((key) => [key, current[key]]),
  ) as Extract<
    ConversationTransitionV2,
    { type: "metadata-updated" }
  >["previousMetadata"];
  return conversationDecisionV2(
    decision,
    context,
    { type: "metadata-updated", changedFields, previousMetadata },
    [],
  );
}

export function decideArchiveConversation(
  current: Conversation | null,
  command: ArchiveConversationCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireActive(requireCurrent(current, command, context));
  requireWorkspacePermission(context, "workspace.read");
  requireConversationManager(
    current,
    command.actor.punkId,
    context.workspaceRole,
  );
  const state = nextState(
    current,
    { status: "archived", archivedAt: context.now.toISOString() },
    context,
  );
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationArchived,
    { cause: command.payload.cause },
  );
}

export async function decideArchiveConversationV2(
  current: Conversation | null,
  command: ArchiveConversationCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const decision = decideArchiveConversation(current, command, context);
  return conversationDecisionV2(
    decision,
    context,
    { type: "archived", cause: command.payload.cause },
    [],
  );
}

export function decideRestoreConversation(
  current: Conversation | null,
  command: RestoreConversationCommand,
  context: ConversationDecisionContext,
): ConversationDecision {
  current = requireCurrent(current, command, context);
  if (current.status !== "archived") {
    throw new ConversationDomainError(
      "invalid_transition",
      "Conversation is not archived",
    );
  }
  requireWorkspacePermission(context, "workspace.read");
  requireConversationManager(
    current,
    command.actor.punkId,
    context.workspaceRole,
  );
  const state = nextState(
    current,
    { status: "active", archivedAt: null },
    context,
  );
  return decision(
    command,
    context,
    state,
    CONVERSATION_EVENT_KINDS.conversationRestored,
  );
}

export async function decideRestoreConversationV2(
  current: Conversation | null,
  command: RestoreConversationCommand,
  context: ConversationDecisionContext,
): Promise<ConversationDecisionV2> {
  const decision = decideRestoreConversation(current, command, context);
  return conversationDecisionV2(decision, context, { type: "restored" }, []);
}
