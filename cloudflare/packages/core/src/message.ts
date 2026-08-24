import type { UnsignedNostrEvent } from "@punks/contracts";

import { canonicalJson } from "./json";
import { roleHasPermission, type WorkspaceRole } from "./permissions";
import { PUNKS_EVENT_KINDS } from "./workspace";

/** Seven complete days, measured from the accepted retraction instant. */
export const MESSAGE_ERASURE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;
export const MESSAGE_CONTENT_MAX_VERSIONS = 1_000;

export const MESSAGE_EVENT_KINDS = {
  messagePosted: PUNKS_EVENT_KINDS.messagePosted,
  messageEdited: PUNKS_EVENT_KINDS.messageEdited,
  messageRetracted: PUNKS_EVENT_KINDS.messageRetracted,
  messageRestored: PUNKS_EVENT_KINDS.messageRestored,
  messageErasureMarked: PUNKS_EVENT_KINDS.messageErasureMarked,
} as const;

export type MessageDomainErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid_transition"
  | "idempotency_conflict"
  | "grace_expired"
  | "key_destruction_unconfirmed";

export class MessageDomainError extends Error {
  constructor(
    readonly code: MessageDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MessageDomainError";
  }
}

export type MessageActor =
  | { kind: "punk"; punkId: string }
  | { kind: "bot"; installationId: string };

export type MessageCommandActor =
  | MessageActor
  | { kind: "service"; service: "crypto-erasure" };

export type MessageBotCapability =
  | "messages.write"
  | "messages.edit-own"
  | "messages.retract-own"
  | "messages.restore-own"
  | "messages.moderate";

export type ConversationAccess = "owner" | "manager" | "member" | "guest";
export type ConversationType = "stream" | "forum" | "dm" | "workflow";
export type MessageType = "stream-message" | "forum-post" | "forum-comment";

export interface PreparedMessageContent {
  version: number;
  contentCommitment: string;
  ciphertextRef: string;
  contentKeyId: string;
  topicPresent: boolean;
}

export interface MessageContentVersion extends PreparedMessageContent {
  createdAt: string;
}

export interface MessageRetraction {
  commandId: string;
  kind: "author" | "moderation";
  actor: MessageActor;
  requestedAt: string;
  eraseAfter: string;
  reasonCode: string | null;
  publicReason: string | null;
}

export interface MessageErasureMarker {
  erasedAt: string;
  retractedAt: string;
  retractionKind: "author" | "moderation";
  destroyedVersionCount: number;
}

/** Authoritative Message entity held by a Conversation aggregate. */
export interface Message {
  id: string;
  workspaceId: string;
  conversationId: string;
  author: MessageActor;
  messageType: MessageType;
  status: "active" | "retracted" | "erased";
  /** Whether the encrypted current version contains a topic. */
  topicPresent: boolean;
  mentionedPunkIds: string[];
  mediaIds: string[];
  parentMessageId: string | null;
  threadRootMessageId: string;
  threadDepth: number;
  broadcast: boolean;
  replyCount: number;
  descendantCount: number;
  lastReplyAt: string | null;
  /** Null only after every generation key has been irreversibly tombstoned. */
  originalContentCommitment: string | null;
  currentVersion: number | null;
  contentVersions: MessageContentVersion[];
  retraction: MessageRetraction | null;
  erasureMarker: MessageErasureMarker | null;
  revision: number;
  /** Stable Conversation cursor at which this Message was first posted. */
  createdCursor: number;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

interface MessageCommandBase {
  commandId: string;
  workspaceId: string;
  conversationId: string;
  actor: MessageActor;
}

export interface PostMessageCommand extends MessageCommandBase {
  contract: "message.post@1";
  payload: {
    content: string;
    replyToMessageId: string | null;
    broadcast: boolean;
    topic: string | null;
    mentionedPunkIds: string[];
    mediaIds: string[];
  };
}

export interface EditMessageCommand extends MessageCommandBase {
  contract: "message.edit@1";
  messageId: string;
  payload: {
    content: string;
    topic: string | null;
    mentionedPunkIds: string[];
    mediaIds: string[];
  };
}

export interface RetractMessageCommand extends MessageCommandBase {
  contract: "message.retract@1";
  messageId: string;
  payload: {
    reasonCode: string | null;
    publicReason: string | null;
  };
}

export interface RestoreMessageCommand extends MessageCommandBase {
  contract: "message.restore@1";
  messageId: string;
  payload: Record<string, never>;
}

export interface FinalizeMessageErasureCommand {
  contract: "message.finalize-erasure@1";
  commandId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  actor: { kind: "service"; service: "crypto-erasure" };
  payload: { expectedRetractionCommandId: string };
}

export interface MessageAuthorizationContext {
  workspaceRole: WorkspaceRole | null;
  conversationAccess: ConversationAccess | null;
  botCapabilities: ReadonlySet<MessageBotCapability>;
}

export type MessageMutationAuthorizationIntent = {
  contract: "message.edit@1" | "message.retract@1" | "message.restore@1";
  actor: MessageActor;
};

export interface MessageConversationContext {
  type: ConversationType;
  visibility: "open" | "private";
  status: "active" | "archived" | "deleting" | "deleted";
  topicRequired: boolean;
}

export interface MessageDecisionContext {
  messageId: string;
  cursor: number;
  now: Date;
  workspaceCursor: number;
  conversationCursor: number;
  conversation: MessageConversationContext;
  authorization: MessageAuthorizationContext;
}

export interface MessageWriteDecisionContext extends MessageDecisionContext {
  preparedContent: PreparedMessageContent;
  parentMessage: Message | null;
  threadRootMessage: Message | null;
}

export interface MessageErasureDecisionContext {
  cursor: number;
  now: Date;
  destroyedContentKeyIds: readonly string[];
}

export type ThreadCounterDelta =
  | { messageId: string; replyCountDelta: 1 | -1 }
  | { messageId: string; descendantCountDelta: 1 | -1 };

export interface MessageDecision {
  outcome: "applied" | "idempotent";
  event: UnsignedNostrEvent | null;
  nextState: Message;
  threadDeltas: ThreadCounterDelta[];
}

/** Bounded Message metadata safe for attestations, queues, and API metadata. */
export type BoundedMessageState = Omit<Message, "contentVersions">;

export type MessageVersionDelta =
  | { operation: "upsert"; version: MessageContentVersion }
  | { operation: "retain" }
  | { operation: "erase-all" };

export interface BoundedMessageEventBody {
  schemaVersion: 1;
  message: BoundedMessageState;
  versionDelta: MessageVersionDelta;
}

export function boundedMessageState(message: Message): BoundedMessageState {
  const { contentVersions: _contentVersions, ...bounded } = message;
  return bounded;
}

type MutableMessageCommand =
  | PostMessageCommand
  | EditMessageCommand
  | RetractMessageCommand
  | RestoreMessageCommand;

function actorId(actor: MessageCommandActor): string {
  switch (actor.kind) {
    case "punk":
      return actor.punkId;
    case "bot":
      return actor.installationId;
    case "service":
      return actor.service;
  }
}

function actorsEqual(left: MessageActor, right: MessageActor): boolean {
  return left.kind === right.kind && actorId(left) === actorId(right);
}

function normalizedUnique(values: readonly string[], sort: boolean): string[] {
  const unique = [...new Set(values)];
  return sort ? unique.sort() : unique;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

function requireActiveConversation(context: MessageDecisionContext): void {
  if (context.conversation.status !== "active") {
    throw new MessageDomainError(
      "invalid_transition",
      "Conversation is not active",
    );
  }
}

function requireConversationParticipation(
  context: MessageDecisionContext,
): void {
  if (
    context.authorization.conversationAccess === "guest" ||
    (context.conversation.visibility === "private" &&
      context.authorization.conversationAccess === null)
  ) {
    throw new MessageDomainError(
      "forbidden",
      "Actor does not have writable Conversation access",
    );
  }
}

function requireWriteAccess(
  actor: MessageActor,
  context: MessageDecisionContext,
  botCapability: MessageBotCapability,
): void {
  requireActiveConversation(context);
  if (actor.kind === "punk") {
    if (
      context.authorization.workspaceRole === null ||
      !roleHasPermission(
        context.authorization.workspaceRole,
        "conversations.write",
      )
    ) {
      throw new MessageDomainError(
        "forbidden",
        "Workspace role does not carry the conversations.write permission",
      );
    }
  } else if (!context.authorization.botCapabilities.has(botCapability)) {
    throw new MessageDomainError(
      "forbidden",
      `Bot installation lacks the ${botCapability} capability`,
    );
  }
  requireConversationParticipation(context);
}

function hasModerationAccess(
  actor: MessageActor,
  context: MessageDecisionContext,
): boolean {
  if (actor.kind === "bot") {
    return context.authorization.botCapabilities.has("messages.moderate");
  }
  return (
    context.authorization.workspaceRole !== null &&
    roleHasPermission(context.authorization.workspaceRole, "moderation.perform")
  );
}

function validatePreparedContent(
  prepared: PreparedMessageContent,
  expectedVersion: number,
): void {
  if (
    prepared.version !== expectedVersion ||
    !/^[0-9a-f]{64}$/.test(prepared.contentCommitment) ||
    prepared.ciphertextRef.length === 0 ||
    prepared.contentKeyId.length === 0
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Prepared Message content is incomplete or has an unexpected version",
    );
  }
}

function validateVisiblePayload(
  content: string,
  mediaIds: readonly string[],
): void {
  if (new TextEncoder().encode(content).byteLength > 64 * 1_024) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message content exceeds the Buzz-compatible 64 KiB limit",
    );
  }
  if (content.length === 0 && mediaIds.length === 0) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message content or media is required",
    );
  }
}

function validateScope(
  current: Message | null,
  command: Exclude<MutableMessageCommand, PostMessageCommand>,
  context: MessageDecisionContext,
): Message {
  if (
    current === null ||
    current.id !== command.messageId ||
    current.id !== context.messageId ||
    current.workspaceId !== command.workspaceId ||
    current.conversationId !== command.conversationId
  ) {
    throw new MessageDomainError(
      "not_found",
      "Message does not exist in this Conversation",
    );
  }
  return current;
}

function eventTags(
  command: MutableMessageCommand | FinalizeMessageErasureCommand,
  message: Message,
  context:
    | MessageDecisionContext
    | (MessageErasureDecisionContext & {
        workspaceCursor?: never;
        conversationCursor?: never;
      }),
): [string, ...string[]][] {
  const tags: [string, ...string[]][] = [
    ["workspace", message.workspaceId],
    ["conversation", message.conversationId],
    ["message", message.id],
    ["cursor", String(context.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", command.actor.kind, actorId(command.actor)],
  ];
  if ("workspaceCursor" in context) {
    tags.push(["workspace_cursor", String(context.workspaceCursor)]);
    tags.push(["conversation_cursor", String(context.conversationCursor)]);
  }
  if (message.parentMessageId !== null) {
    tags.push(["parent", message.parentMessageId]);
    tags.push(["root", message.threadRootMessageId]);
    tags.push(["depth", String(message.threadDepth)]);
  }
  if (message.broadcast) {
    tags.push(["broadcast", "1"]);
  }
  return tags;
}

function appliedDecision(
  command: MutableMessageCommand | FinalizeMessageErasureCommand,
  context: MessageDecisionContext | MessageErasureDecisionContext,
  state: Message,
  kind: number,
  threadDeltas: ThreadCounterDelta[] = [],
  versionDelta: MessageVersionDelta = { operation: "retain" },
): MessageDecision {
  return {
    outcome: "applied",
    nextState: state,
    threadDeltas,
    event: {
      created_at: Math.floor(context.now.getTime() / 1_000),
      kind,
      tags: eventTags(command, state, context),
      content: canonicalJson({
        schemaVersion: 1,
        message: boundedMessageState(state),
        versionDelta,
      } satisfies BoundedMessageEventBody),
    },
  };
}

function idempotentDecision(state: Message): MessageDecision {
  return {
    outcome: "idempotent",
    event: null,
    nextState: state,
    threadDeltas: [],
  };
}

function threadDeltas(message: Message, delta: 1 | -1): ThreadCounterDelta[] {
  if (message.parentMessageId === null) {
    return [];
  }
  return [
    { messageId: message.parentMessageId, replyCountDelta: delta },
    { messageId: message.threadRootMessageId, descendantCountDelta: delta },
  ];
}

function classifyMessage(
  conversationType: ConversationType,
  isReply: boolean,
): MessageType {
  if (conversationType === "forum") {
    return isReply ? "forum-comment" : "forum-post";
  }
  return "stream-message";
}

function resolveThread(
  command: PostMessageCommand,
  context: MessageWriteDecisionContext,
): {
  parentMessageId: string | null;
  rootMessageId: string;
  depth: number;
} {
  const requestedParentId = command.payload.replyToMessageId;
  if (requestedParentId === null) {
    if (context.parentMessage !== null || context.threadRootMessage !== null) {
      throw new MessageDomainError(
        "invalid_transition",
        "Root Message cannot carry reply ancestry",
      );
    }
    return {
      parentMessageId: null,
      rootMessageId: context.messageId,
      depth: 0,
    };
  }

  const parent = context.parentMessage;
  if (
    parent === null ||
    parent.id !== requestedParentId ||
    parent.workspaceId !== command.workspaceId ||
    parent.conversationId !== command.conversationId
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Reply parent belongs to a different Conversation or is missing",
    );
  }
  if (parent.status !== "active") {
    throw new MessageDomainError(
      "invalid_transition",
      "Cannot reply to a retracted or erased Message",
    );
  }
  if (parent.threadDepth >= 100) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message thread depth limit exceeded",
    );
  }

  const root = context.threadRootMessage;
  if (
    root === null ||
    root.id !== parent.threadRootMessageId ||
    root.threadRootMessageId !== root.id ||
    root.threadDepth !== 0 ||
    root.workspaceId !== command.workspaceId ||
    root.conversationId !== command.conversationId
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Thread root does not match authoritative ancestry",
    );
  }
  return {
    parentMessageId: parent.id,
    rootMessageId: root.id,
    depth: parent.threadDepth + 1,
  };
}

function samePost(
  current: Message,
  command: PostMessageCommand,
  context: MessageWriteDecisionContext,
  thread: ReturnType<typeof resolveThread>,
): boolean {
  const mentions = normalizedUnique(command.payload.mentionedPunkIds, true);
  const media = normalizedUnique(command.payload.mediaIds, false);
  return (
    current.id === context.messageId &&
    current.workspaceId === command.workspaceId &&
    current.conversationId === command.conversationId &&
    actorsEqual(current.author, command.actor) &&
    current.messageType ===
      classifyMessage(
        context.conversation.type,
        thread.parentMessageId !== null,
      ) &&
    current.topicPresent === (command.payload.topic !== null) &&
    current.parentMessageId === thread.parentMessageId &&
    current.threadRootMessageId === thread.rootMessageId &&
    current.threadDepth === thread.depth &&
    current.broadcast === command.payload.broadcast &&
    arraysEqual(current.mentionedPunkIds, mentions) &&
    arraysEqual(current.mediaIds, media) &&
    current.originalContentCommitment ===
      context.preparedContent.contentCommitment
  );
}

export function decidePostMessage(
  current: Message | null,
  command: PostMessageCommand,
  context: MessageWriteDecisionContext,
): MessageDecision {
  requireWriteAccess(command.actor, context, "messages.write");
  validateVisiblePayload(command.payload.content, command.payload.mediaIds);
  const thread = resolveThread(command, context);
  if (
    context.conversation.topicRequired &&
    thread.parentMessageId === null &&
    (command.payload.topic === null ||
      command.payload.topic.trim().length === 0)
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Conversation requires a topic for root Messages",
    );
  }
  if (current !== null) {
    if (samePost(current, command, context, thread)) {
      return idempotentDecision(current);
    }
    throw new MessageDomainError(
      "idempotency_conflict",
      "Message id is already bound to different post semantics",
    );
  }
  validatePreparedContent(context.preparedContent, 1);
  if (
    context.preparedContent.topicPresent !==
    (command.payload.topic !== null)
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Prepared content topic metadata does not match the command",
    );
  }

  const timestamp = context.now.toISOString();
  const postedVersion: MessageContentVersion = {
    ...context.preparedContent,
    version: 1,
    createdAt: timestamp,
  };
  const state: Message = {
    id: context.messageId,
    workspaceId: command.workspaceId,
    conversationId: command.conversationId,
    author: command.actor,
    messageType: classifyMessage(
      context.conversation.type,
      thread.parentMessageId !== null,
    ),
    status: "active",
    topicPresent: command.payload.topic !== null,
    mentionedPunkIds: normalizedUnique(command.payload.mentionedPunkIds, true),
    mediaIds: normalizedUnique(command.payload.mediaIds, false),
    parentMessageId: thread.parentMessageId,
    threadRootMessageId: thread.rootMessageId,
    threadDepth: thread.depth,
    broadcast: command.payload.broadcast,
    replyCount: 0,
    descendantCount: 0,
    lastReplyAt: null,
    originalContentCommitment: context.preparedContent.contentCommitment,
    currentVersion: 1,
    contentVersions: [postedVersion],
    retraction: null,
    erasureMarker: null,
    revision: 1,
    createdCursor: context.cursor,
    cursor: context.cursor,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: null,
  };
  return appliedDecision(
    command,
    context,
    state,
    MESSAGE_EVENT_KINDS.messagePosted,
    threadDeltas(state, 1),
    { operation: "upsert", version: postedVersion },
  );
}

function latestContent(current: Message): MessageContentVersion {
  const latest = current.contentVersions.find(
    (version) => version.version === current.currentVersion,
  );
  if (latest === undefined) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message current content version is missing",
    );
  }
  return latest;
}

export function decideEditMessage(
  current: Message | null,
  command: EditMessageCommand,
  context: MessageWriteDecisionContext,
): MessageDecision {
  current = validateScope(current, command, context);
  authorizeMessageMutation(current, command, context);
  if (current.status !== "active") {
    throw new MessageDomainError(
      "invalid_transition",
      "Only an active Message can be edited",
    );
  }
  validateVisiblePayload(command.payload.content, command.payload.mediaIds);
  if (
    current.parentMessageId === null &&
    context.conversation.topicRequired &&
    (command.payload.topic === null ||
      command.payload.topic.trim().length === 0)
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "This Conversation requires a topic on root Messages",
    );
  }
  const mentions = normalizedUnique(command.payload.mentionedPunkIds, true);
  const media = normalizedUnique(command.payload.mediaIds, false);
  const latest = latestContent(current);
  if (
    latest.contentCommitment === context.preparedContent.contentCommitment &&
    current.topicPresent === (command.payload.topic !== null) &&
    arraysEqual(current.mentionedPunkIds, mentions) &&
    arraysEqual(current.mediaIds, media)
  ) {
    return idempotentDecision(current);
  }

  const nextVersion = (current.currentVersion ?? 0) + 1;
  if (nextVersion > MESSAGE_CONTENT_MAX_VERSIONS) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message content version limit reached",
    );
  }
  validatePreparedContent(context.preparedContent, nextVersion);
  if (
    context.preparedContent.topicPresent !==
    (command.payload.topic !== null)
  ) {
    throw new MessageDomainError(
      "invalid_transition",
      "Prepared content topic metadata does not match the command",
    );
  }
  const timestamp = context.now.toISOString();
  const editedVersion: MessageContentVersion = {
    ...context.preparedContent,
    version: nextVersion,
    createdAt: timestamp,
  };
  const state: Message = {
    ...current,
    topicPresent: command.payload.topic !== null,
    mentionedPunkIds: mentions,
    mediaIds: media,
    currentVersion: nextVersion,
    contentVersions: [...current.contentVersions, editedVersion],
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
    editedAt: timestamp,
  };
  return appliedDecision(
    command,
    context,
    state,
    MESSAGE_EVENT_KINDS.messageEdited,
    [],
    { operation: "upsert", version: editedVersion },
  );
}

function authorizeRetraction(
  current: Message,
  actor: MessageActor,
  context: MessageDecisionContext,
): "author" | "moderation" {
  if (actorsEqual(current.author, actor)) {
    requireWriteAccess(actor, context, "messages.retract-own");
    return "author";
  }
  requireActiveConversation(context);
  if (hasModerationAccess(actor, context)) {
    return "moderation";
  }
  throw new MessageDomainError(
    "forbidden",
    "Only the Message author or a current moderator can retract it",
  );
}

export function decideRetractMessage(
  current: Message | null,
  command: RetractMessageCommand,
  context: MessageDecisionContext,
): MessageDecision {
  current = validateScope(current, command, context);
  const kind = authorizeMessageMutation(current, command, context);
  if (kind === null) {
    throw new MessageDomainError(
      "invalid_transition",
      "Retraction authorization kind is missing",
    );
  }
  if (current.status === "retracted") {
    throw new MessageDomainError(
      "invalid_transition",
      "Message is already retracted",
    );
  }
  if (current.status === "erased") {
    throw new MessageDomainError(
      "invalid_transition",
      "An erased Message cannot be retracted",
    );
  }

  const timestamp = context.now.toISOString();
  const state: Message = {
    ...current,
    status: "retracted",
    retraction: {
      commandId: command.commandId,
      kind,
      actor: command.actor,
      requestedAt: timestamp,
      eraseAfter: new Date(
        context.now.getTime() + MESSAGE_ERASURE_GRACE_MS,
      ).toISOString(),
      reasonCode: command.payload.reasonCode,
      publicReason: command.payload.publicReason,
    },
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return appliedDecision(
    command,
    context,
    state,
    MESSAGE_EVENT_KINDS.messageRetracted,
    threadDeltas(current, -1),
  );
}

function authorizeRestore(
  current: Message,
  actor: MessageActor,
  context: MessageDecisionContext,
): void {
  if (current.retraction?.kind === "moderation") {
    requireActiveConversation(context);
    if (!hasModerationAccess(actor, context)) {
      throw new MessageDomainError(
        "forbidden",
        "A moderation retraction can only be restored by a current moderator",
      );
    }
    return;
  }
  if (!actorsEqual(current.author, actor)) {
    throw new MessageDomainError(
      "forbidden",
      "Only the Message author can restore an author retraction",
    );
  }
  requireWriteAccess(actor, context, "messages.restore-own");
}

/**
 * Applies the canonical current-actor policy used both by decisions and by
 * Durable Object retries before attestation/commit.
 */
export function authorizeMessageMutation(
  current: Message,
  intent: MessageMutationAuthorizationIntent,
  context: MessageDecisionContext,
): "author" | "moderation" | null {
  switch (intent.contract) {
    case "message.edit@1":
      requireWriteAccess(intent.actor, context, "messages.edit-own");
      if (!actorsEqual(current.author, intent.actor)) {
        throw new MessageDomainError(
          "forbidden",
          "Only the Message author can edit this Message",
        );
      }
      return null;
    case "message.retract@1":
      return authorizeRetraction(current, intent.actor, context);
    case "message.restore@1":
      authorizeRestore(current, intent.actor, context);
      return null;
  }
}

export function decideRestoreMessage(
  current: Message | null,
  command: RestoreMessageCommand,
  context: MessageDecisionContext,
): MessageDecision {
  current = validateScope(current, command, context);
  if (current.status === "erased") {
    throw new MessageDomainError(
      "invalid_transition",
      "An erased Message cannot be restored",
    );
  }
  authorizeMessageMutation(current, command, context);
  if (current.status === "active") {
    return idempotentDecision(current);
  }
  const retraction = current.retraction;
  if (retraction === null) {
    throw new MessageDomainError(
      "invalid_transition",
      "Retracted Message is missing its retraction record",
    );
  }
  if (context.now.getTime() >= new Date(retraction.eraseAfter).getTime()) {
    throw new MessageDomainError(
      "grace_expired",
      "Message restoration grace has expired",
    );
  }

  const timestamp = context.now.toISOString();
  const state: Message = {
    ...current,
    status: "active",
    retraction: null,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return appliedDecision(
    command,
    context,
    state,
    MESSAGE_EVENT_KINDS.messageRestored,
    threadDeltas(current, 1),
  );
}

function isSubsetOfUniqueSet(
  required: readonly string[],
  confirmed: readonly string[],
): boolean {
  const confirmedSet = new Set(confirmed);
  return (
    confirmedSet.size === confirmed.length &&
    required.every((value) => confirmedSet.has(value))
  );
}

export function decideFinalizeMessageErasure(
  current: Message | null,
  command: FinalizeMessageErasureCommand,
  context: MessageErasureDecisionContext,
): MessageDecision {
  if (
    current === null ||
    current.id !== command.messageId ||
    current.workspaceId !== command.workspaceId ||
    current.conversationId !== command.conversationId
  ) {
    throw new MessageDomainError(
      "not_found",
      "Message does not exist in this Conversation",
    );
  }
  if (
    command.actor.kind !== "service" ||
    command.actor.service !== "crypto-erasure"
  ) {
    throw new MessageDomainError(
      "forbidden",
      "Only the crypto-erasure service can finalize Message erasure",
    );
  }
  if (current.status === "erased") {
    return idempotentDecision(current);
  }
  const retraction = current.retraction;
  if (current.status !== "retracted" || retraction === null) {
    throw new MessageDomainError(
      "invalid_transition",
      "Only a retracted Message can be finalized",
    );
  }
  if (retraction.commandId !== command.payload.expectedRetractionCommandId) {
    throw new MessageDomainError(
      "idempotency_conflict",
      "Erasure command targets a different retraction generation",
    );
  }
  if (context.now.getTime() < new Date(retraction.eraseAfter).getTime()) {
    throw new MessageDomainError(
      "invalid_transition",
      "Message erasure is not due yet",
    );
  }
  const expectedKeys = current.contentVersions.map(
    (version) => version.contentKeyId,
  );
  if (!isSubsetOfUniqueSet(expectedKeys, context.destroyedContentKeyIds)) {
    throw new MessageDomainError(
      "key_destruction_unconfirmed",
      "Erasure requires confirmed destruction of every content key",
    );
  }

  const timestamp = context.now.toISOString();
  const state: Message = {
    ...current,
    status: "erased",
    originalContentCommitment: null,
    currentVersion: null,
    contentVersions: [],
    retraction: null,
    erasureMarker: {
      erasedAt: timestamp,
      retractedAt: retraction.requestedAt,
      retractionKind: retraction.kind,
      destroyedVersionCount: expectedKeys.length,
    },
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return appliedDecision(
    command,
    context,
    state,
    MESSAGE_EVENT_KINDS.messageErasureMarked,
    [],
    { operation: "erase-all" },
  );
}
