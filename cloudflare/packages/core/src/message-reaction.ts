import type {
  AddMessageReactionCommand,
  MessageReaction as ContractMessageReaction,
  RemoveMessageReactionCommand,
  ToggleMessageReactionCommand,
  UnsignedNostrEvent,
} from "@punks/contracts";

export type {
  AddMessageReactionCommand,
  RemoveMessageReactionCommand,
  ToggleMessageReactionCommand,
} from "@punks/contracts";

import { canonicalJson } from "./json";
import { roleHasPermission, type WorkspaceRole } from "./permissions";
import { PUNKS_EVENT_KINDS } from "./workspace";

export const MESSAGE_REACTION_MAX_SCALARS = 64;
export const MESSAGE_REACTION_MAX_CUSTOM_SHORTCODE_BYTES = 64;

export const MESSAGE_REACTION_EVENT_KINDS = {
  reactionAdded: PUNKS_EVENT_KINDS.messageReactionAdded,
  reactionRemoved: PUNKS_EVENT_KINDS.messageReactionRemoved,
} as const;

export type MessageReactionDomainErrorCode =
  | "forbidden"
  | "idempotency_conflict"
  | "invalid_transition"
  | "not_found";

export class MessageReactionDomainError extends Error {
  constructor(
    readonly code: MessageReactionDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MessageReactionDomainError";
  }
}

export type MessageReaction = ContractMessageReaction;
export type MessageReactionActor = MessageReaction["actor"];

export type MessageReactionBotCapability = "messages.react";
export type MessageReactionConversationAccess =
  | "owner"
  | "manager"
  | "member"
  | "guest";

export type MessageReactionCommand =
  | AddMessageReactionCommand
  | RemoveMessageReactionCommand
  | ToggleMessageReactionCommand;

export interface MessageReactionCommandRecord {
  commandId: string;
  contract: MessageReactionCommand["contract"];
  workspaceId: string;
  conversationId: string;
  messageId: string;
  reactionId: string;
  actor: MessageReactionActor;
  reaction: string;
  effect: "added" | "removed" | "unchanged";
}

export interface MessageReactionTarget {
  id: string;
  workspaceId: string;
  conversationId: string;
  status: "active" | "retracted" | "erased";
}

export type MessageReactionAuthority =
  | {
      kind: "workspace";
      workspaceCursor: number;
    }
  | {
      kind: "bot-installation";
      installationCursor: number;
      admissionId: string;
      actionId: string;
      actionDigest: string;
    };

export interface MessageReactionDecisionContext {
  reactionId: string;
  cursor: number;
  authority: MessageReactionAuthority;
  conversationCursor: number;
  now: Date;
  targetMessage: MessageReactionTarget | null;
  conversation: {
    status: "active" | "archived" | "deleting" | "deleted";
    visibility: "open" | "private";
  };
  authorization: {
    workspaceRole: WorkspaceRole | null;
    conversationAccess: MessageReactionConversationAccess | null;
    botCapabilities: ReadonlySet<MessageReactionBotCapability>;
  };
  /** Existing durable command-ledger record for this commandId, when any. */
  priorCommand: MessageReactionCommandRecord | null;
}

export type MessageReactionProjectionDelta =
  | {
      operation: "upsert";
      reaction: {
        id: string;
        messageId: string;
        actor: MessageReactionActor;
        reaction: string;
        reactedAt: string;
      };
    }
  | {
      operation: "remove";
      reactionId: string;
      messageId: string;
      actor: MessageReactionActor;
      reaction: string;
    };

export interface MessageReactionDecision {
  outcome: "applied" | "idempotent";
  effect: "added" | "removed" | "unchanged";
  nextState: MessageReaction | null;
  event: UnsignedNostrEvent | null;
  projectionDelta: MessageReactionProjectionDelta | null;
  commandRecord: MessageReactionCommandRecord;
}

/**
 * Canonicalize the visible Reaction coordinate shared by commands, storage,
 * idempotency receipts, and projections.
 */
export function canonicalMessageReaction(value: string): string {
  if (/[\r\n\u2028\u2029]/u.test(value)) {
    throw new MessageReactionDomainError(
      "invalid_transition",
      "Reaction cannot contain line separators",
    );
  }
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0) {
    // Frozen Punks/NIP-25 compatibility: empty kind:7 content means `+`.
    return "+";
  }

  if (normalized.startsWith(":") || normalized.endsWith(":")) {
    const shortcode = normalized.slice(1, -1);
    if (
      !normalized.startsWith(":") ||
      !normalized.endsWith(":") ||
      shortcode.length === 0 ||
      new TextEncoder().encode(shortcode).byteLength >
        MESSAGE_REACTION_MAX_CUSTOM_SHORTCODE_BYTES ||
      !/^[A-Za-z0-9_-]+$/.test(shortcode)
    ) {
      throw new MessageReactionDomainError(
        "invalid_transition",
        "A custom Reaction shortcode must contain 1-64 ASCII letters, digits, hyphens, or underscores",
      );
    }
    return `:${shortcode.toLowerCase()}:`;
  }

  const scalarCount = [...normalized].length;
  if (scalarCount > MESSAGE_REACTION_MAX_SCALARS) {
    throw new MessageReactionDomainError(
      "invalid_transition",
      `Reaction exceeds ${MESSAGE_REACTION_MAX_SCALARS} Unicode scalar values`,
    );
  }
  return normalized;
}

/**
 * Applies Message lifecycle visibility to an absolute counter already derived
 * from unique presence rows. The domain never accepts an actor roster.
 */
export function projectVisibleMessageReactionCount(
  activePresenceCount: number,
  target: MessageReactionTarget,
): number {
  if (!Number.isSafeInteger(activePresenceCount) || activePresenceCount < 0) {
    throw new MessageReactionDomainError(
      "invalid_transition",
      "Reaction presence count must be a non-negative safe integer",
    );
  }
  if (target.status !== "active") {
    return 0;
  }
  return activePresenceCount;
}

function actorId(actor: MessageReactionActor): string {
  return actor.kind === "punk" ? actor.punkId : actor.installationId;
}

function actorsEqual(
  left: MessageReactionActor,
  right: MessageReactionActor,
): boolean {
  return left.kind === right.kind && actorId(left) === actorId(right);
}

function commandRecord(
  command: MessageReactionCommand,
  reactionId: string,
  reaction: string,
  effect: MessageReactionDecision["effect"],
): MessageReactionCommandRecord {
  return {
    commandId: command.commandId,
    contract: command.contract,
    workspaceId: command.workspaceId,
    conversationId: command.conversationId,
    messageId: command.messageId,
    reactionId,
    actor: command.actor,
    reaction,
    effect,
  };
}

function commandRecordsMatch(
  existing: MessageReactionCommandRecord,
  command: MessageReactionCommand,
  reactionId: string,
  reaction: string,
): boolean {
  return (
    existing.commandId === command.commandId &&
    existing.contract === command.contract &&
    existing.workspaceId === command.workspaceId &&
    existing.conversationId === command.conversationId &&
    existing.messageId === command.messageId &&
    existing.reactionId === reactionId &&
    actorsEqual(existing.actor, command.actor) &&
    existing.reaction === reaction
  );
}

function replayDecision(
  current: MessageReaction | null,
  existing: MessageReactionCommandRecord,
): MessageReactionDecision {
  return {
    outcome: "idempotent",
    effect: existing.effect,
    nextState: current,
    event: null,
    projectionDelta: null,
    commandRecord: existing,
  };
}

function currentHasCoordinate(
  current: MessageReaction,
  command: MessageReactionCommand,
  context: MessageReactionDecisionContext,
  reaction: string,
): boolean {
  return (
    current.id === context.reactionId &&
    current.workspaceId === command.workspaceId &&
    current.conversationId === command.conversationId &&
    current.messageId === command.messageId &&
    actorsEqual(current.actor, command.actor) &&
    current.reaction === reaction
  );
}

function requireReactionAccess(
  command: MessageReactionCommand,
  context: MessageReactionDecisionContext,
): void {
  const target = context.targetMessage;
  if (
    target === null ||
    target.id !== command.messageId ||
    target.workspaceId !== command.workspaceId ||
    target.conversationId !== command.conversationId
  ) {
    throw new MessageReactionDomainError(
      "not_found",
      "Message does not exist in this Conversation",
    );
  }
  if (
    context.authorization.conversationAccess === "guest" ||
    (context.conversation.visibility === "private" &&
      context.authorization.conversationAccess === null)
  ) {
    throw new MessageReactionDomainError(
      "forbidden",
      "Actor does not have writable Conversation access",
    );
  }
  if (command.actor.kind === "bot") {
    const authority = context.authority;
    if (
      authority.kind !== "bot-installation" ||
      !Number.isSafeInteger(authority.installationCursor) ||
      authority.installationCursor < 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        authority.admissionId,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        authority.actionId,
      ) ||
      !/^[0-9a-f]{64}$/.test(authority.actionDigest) ||
      !context.authorization.botCapabilities.has("messages.react")
    ) {
      throw new MessageReactionDomainError(
        "forbidden",
        "Bot installation lacks exact admitted messages.react capability authority",
      );
    }
    return;
  }
  if (
    context.authority.kind !== "workspace" ||
    !Number.isSafeInteger(context.authority.workspaceCursor) ||
    context.authority.workspaceCursor < 1 ||
    context.authorization.workspaceRole === null ||
    !roleHasPermission(
      context.authorization.workspaceRole,
      "conversations.write",
    )
  ) {
    throw new MessageReactionDomainError(
      "forbidden",
      "Workspace role does not carry the conversations.write permission",
    );
  }
}

function requireActiveReactionTarget(
  context: MessageReactionDecisionContext,
): void {
  if (context.conversation.status !== "active") {
    throw new MessageReactionDomainError(
      "invalid_transition",
      "Conversation is not active",
    );
  }
  if (context.targetMessage?.status !== "active") {
    throw new MessageReactionDomainError(
      "invalid_transition",
      "Reactions can target only an active Message",
    );
  }
}

function eventTags(
  command: MessageReactionCommand,
  context: MessageReactionDecisionContext,
): [string, ...string[]][] {
  const authorityTags: [string, ...string[]][] =
    context.authority.kind === "workspace"
      ? [["workspace_cursor", String(context.authority.workspaceCursor)]]
      : [
          ["installation_cursor", String(context.authority.installationCursor)],
          ["admission", context.authority.admissionId],
          [
            "action",
            context.authority.actionId,
            context.authority.actionDigest,
          ],
        ];
  return [
    ["workspace", command.workspaceId],
    ["conversation", command.conversationId],
    ["message", command.messageId],
    ["reaction_entity", context.reactionId],
    ["cursor", String(context.cursor)],
    ...authorityTags,
    ["conversation_cursor", String(context.conversationCursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", command.actor.kind, actorId(command.actor)],
  ];
}

function appliedDecision(
  command: MessageReactionCommand,
  context: MessageReactionDecisionContext,
  state: MessageReaction,
  effect: "added" | "removed",
  delta: MessageReactionProjectionDelta,
): MessageReactionDecision {
  return {
    outcome: "applied",
    effect,
    nextState: state,
    projectionDelta: delta,
    commandRecord: commandRecord(command, state.id, state.reaction, effect),
    event: {
      created_at: Math.floor(context.now.getTime() / 1_000),
      kind:
        effect === "added"
          ? MESSAGE_REACTION_EVENT_KINDS.reactionAdded
          : MESSAGE_REACTION_EVENT_KINDS.reactionRemoved,
      tags: eventTags(command, context),
      content: canonicalJson({
        schemaVersion: 1,
        reaction: state,
        projectionDelta: delta,
      }),
    },
  };
}

export function decideAddMessageReaction(
  current: MessageReaction | null,
  command: AddMessageReactionCommand,
  context: MessageReactionDecisionContext,
): MessageReactionDecision {
  return decideSetReactionPresence(current, command, context, true);
}

export function decideRemoveMessageReaction(
  current: MessageReaction | null,
  command: RemoveMessageReactionCommand,
  context: MessageReactionDecisionContext,
): MessageReactionDecision {
  return decideSetReactionPresence(current, command, context, false);
}

export function decideToggleMessageReaction(
  current: MessageReaction | null,
  command: ToggleMessageReactionCommand,
  context: MessageReactionDecisionContext,
): MessageReactionDecision {
  return decideSetReactionPresence(
    current,
    command,
    context,
    current?.status !== "active",
  );
}

function decideSetReactionPresence(
  current: MessageReaction | null,
  command: MessageReactionCommand,
  context: MessageReactionDecisionContext,
  active: boolean,
): MessageReactionDecision {
  requireReactionAccess(command, context);
  const reaction = canonicalMessageReaction(command.payload.reaction);
  if (context.priorCommand !== null) {
    if (
      !commandRecordsMatch(
        context.priorCommand,
        command,
        context.reactionId,
        reaction,
      )
    ) {
      throw new MessageReactionDomainError(
        "idempotency_conflict",
        "commandId is already bound to different Reaction semantics",
      );
    }
  }
  if (
    current !== null &&
    !currentHasCoordinate(current, command, context, reaction)
  ) {
    throw new MessageReactionDomainError(
      "idempotency_conflict",
      "Reaction entity is already bound to a different unique coordinate",
    );
  }
  if (context.priorCommand !== null) {
    return replayDecision(current, context.priorCommand);
  }
  requireActiveReactionTarget(context);
  if (
    (active && current?.status === "active") ||
    (!active && (current === null || current.status === "removed"))
  ) {
    return {
      outcome: "idempotent",
      effect: "unchanged",
      nextState: current,
      event: null,
      projectionDelta: null,
      commandRecord: commandRecord(
        command,
        context.reactionId,
        reaction,
        "unchanged",
      ),
    };
  }
  const timestamp = context.now.toISOString();
  if (!active && current !== null) {
    const state: MessageReaction = {
      ...current,
      status: "removed",
      revision: current.revision + 1,
      cursor: context.cursor,
      updatedAt: timestamp,
      reactedAt: null,
      removedAt: timestamp,
    };
    const delta: MessageReactionProjectionDelta = {
      operation: "remove",
      reactionId: state.id,
      messageId: state.messageId,
      actor: state.actor,
      reaction: state.reaction,
    };
    return appliedDecision(command, context, state, "removed", delta);
  }
  const state: MessageReaction = {
    id: context.reactionId,
    workspaceId: command.workspaceId,
    conversationId: command.conversationId,
    messageId: command.messageId,
    actor: command.actor,
    reaction,
    status: "active",
    revision: current === null ? 1 : current.revision + 1,
    createdCursor: current?.createdCursor ?? context.cursor,
    cursor: context.cursor,
    createdAt: current?.createdAt ?? timestamp,
    reactedAt: timestamp,
    updatedAt: timestamp,
    removedAt: null,
  };
  const delta: MessageReactionProjectionDelta = {
    operation: "upsert",
    reaction: {
      id: state.id,
      messageId: state.messageId,
      actor: state.actor,
      reaction: state.reaction,
      reactedAt: timestamp,
    },
  };
  return appliedDecision(command, context, state, "added", delta);
}
