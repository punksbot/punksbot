import type {
  ConversationFollowServerFrame,
  MessageHistoryResponse,
  MessageReactionMutationResponse,
  MessageView,
} from "@punks/contracts";
import { canonicalPunksReaction } from "../../shared/api/punksReaction";

type ChangesFrame = Extract<ConversationFollowServerFrame, { type: "changes" }>;
const MAX_SEEN_BATCH_SIGNATURES = 256;

/** Absolute counter patch admitted from one validated FOLLOW batch. */
export type ThreadPatch = ChangesFrame["threadPatches"][number];
/** Absolute reaction-count patch admitted from one validated FOLLOW batch. */
export type ReactionPatch = ChangesFrame["reactionPatches"][number];
/** Visibility patch for a reaction collection. */
export type ReactionCollectionPatch =
  ChangesFrame["reactionCollectionPatches"][number];

/** The renderer's bounded, volatile projection of one Stream. */
export type ConversationCache = {
  history: MessageHistoryResponse;
  /** The high-water captured by the first timeline page. */
  paginationHighWater: number;
  /** The last cursor accepted from FOLLOW or the initial page. */
  appliedCursor: number;
  threadPatches: ThreadPatch[];
  reactionPatches: ReactionPatch[];
  reactionCollectionPatches: ReactionCollectionPatch[];
  threadRootMessageId?: string;
  seenBatchSignatures: string[];
};

/** Outcome of one monotone cache reduction. */
export type ConversationReduction =
  | { kind: "applied"; state: ConversationCache }
  | { kind: "ignored"; state: ConversationCache }
  | {
      kind: "resync-required";
      reason:
        | "cursor_gap"
        | "cursor_divergence"
        | "high_water_divergence"
        | "protocol_violation";
    };

/** Snapshot, pagination, mutation and FOLLOW inputs for the one reducer. */
export type ConversationAction =
  | {
      type: "snapshot";
      page: MessageHistoryResponse;
      threadRootMessageId?: string;
    }
  | {
      type: "page";
      page: MessageHistoryResponse;
      mode: "append" | "replace";
    }
  | { type: "message"; message: MessageView }
  | { type: "follow"; frame: ChangesFrame };

function cloneMessage(message: MessageView): MessageView {
  return { ...message };
}

function cloneHistory(history: MessageHistoryResponse): MessageHistoryResponse {
  return {
    ...history,
    items: history.items.map(cloneMessage),
  };
}

function sortMessages(messages: Iterable<MessageView>): MessageView[] {
  return [...messages].sort(
    (left, right) => left.createdCursor - right.createdCursor,
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasDuplicateKeys<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function pageMatchesClosedRuntime(
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): boolean {
  if (
    page.order !== "createdCursor-ascending" ||
    !Number.isSafeInteger(page.highWaterCursor) ||
    page.highWaterCursor < 1 ||
    page.items.length > 100 ||
    hasDuplicateKeys(page.items, (message) => message.id)
  ) {
    return false;
  }
  let previousCreatedCursor = 0;
  for (const message of page.items) {
    if (
      !Number.isSafeInteger(message.createdCursor) ||
      !Number.isSafeInteger(message.cursor) ||
      !Number.isSafeInteger(message.revision) ||
      message.createdCursor <= previousCreatedCursor ||
      message.createdCursor > page.highWaterCursor ||
      message.cursor < message.createdCursor ||
      message.revision < 1 ||
      (threadRootMessageId !== undefined &&
        message.threadRootMessageId !== threadRootMessageId)
    ) {
      return false;
    }
    previousCreatedCursor = message.createdCursor;
  }
  return true;
}

function messagesDiverge(
  existing: readonly MessageView[],
  incoming: readonly MessageView[],
): boolean {
  const existingById = new Map(
    existing.map((message) => [message.id, message]),
  );
  return incoming.some((message) => {
    const previous = existingById.get(message.id);
    if (previous === undefined) return false;
    if (
      (message.revision > previous.revision &&
        message.cursor < previous.cursor) ||
      (message.revision < previous.revision && message.cursor > previous.cursor)
    ) {
      return true;
    }
    return (
      message.revision === previous.revision &&
      message.cursor === previous.cursor &&
      canonical(message) !== canonical(previous)
    );
  });
}

function shouldReplaceMessage(
  existing: MessageView | undefined,
  incoming: MessageView,
): boolean {
  if (existing === undefined) return true;
  return (
    incoming.revision > existing.revision ||
    (incoming.revision === existing.revision &&
      incoming.cursor >= existing.cursor)
  );
}

function mergeMessages(
  existing: readonly MessageView[],
  incoming: readonly MessageView[],
  threadRootMessageId?: string,
): MessageView[] {
  const byId = new Map(
    existing.map((message) => [message.id, cloneMessage(message)]),
  );
  for (const message of incoming) {
    const belongsToThread =
      threadRootMessageId === undefined ||
      message.threadRootMessageId === threadRootMessageId ||
      byId.has(message.id);
    if (!belongsToThread) continue;
    if (shouldReplaceMessage(byId.get(message.id), message)) {
      byId.set(message.id, cloneMessage(message));
    }
  }
  return sortMessages(byId.values());
}

function messagesMatchScope(
  messages: readonly MessageView[],
  workspaceId: string,
  conversationId: string,
): boolean {
  return messages.every(
    (message) =>
      message.workspaceId === workspaceId &&
      message.conversationId === conversationId,
  );
}

function patchThreads(
  messages: readonly MessageView[],
  patches: readonly ThreadPatch[],
): MessageView[] {
  if (patches.length === 0) return messages.map(cloneMessage);
  const latest = new Map<string, ThreadPatch>();
  for (const patch of patches) {
    const previous = latest.get(patch.messageId);
    if (previous === undefined || patch.cursor >= previous.cursor) {
      latest.set(patch.messageId, patch);
    }
  }
  return messages.map((message) => {
    const patch = latest.get(message.id);
    if (patch === undefined || patch.revision < message.revision) {
      return cloneMessage(message);
    }
    return {
      ...message,
      replyCount: patch.replyCount,
      descendantCount: patch.descendantCount,
      lastReplyAt: patch.lastReplyAt,
      revision: Math.max(message.revision, patch.revision),
      cursor: Math.max(message.cursor, patch.cursor),
    };
  });
}

function mergeThreadPatches(
  existing: readonly ThreadPatch[],
  incoming: readonly ThreadPatch[],
): ThreadPatch[] {
  const byMessage = new Map(existing.map((patch) => [patch.messageId, patch]));
  for (const patch of incoming) {
    const previous = byMessage.get(patch.messageId);
    if (previous === undefined || patch.cursor >= previous.cursor) {
      byMessage.set(patch.messageId, { ...patch });
    }
  }
  return [...byMessage.values()].sort(
    (left, right) => left.cursor - right.cursor,
  );
}

function reactionKey(messageId: string, reaction: string): string {
  return `${messageId}\u0000${reaction}`;
}

function mergeReactionPatches(
  existing: readonly ReactionPatch[],
  incoming: readonly ReactionPatch[],
): ReactionPatch[] {
  const byKey = new Map(
    existing.map((patch) => [
      reactionKey(patch.messageId, patch.reaction),
      patch,
    ]),
  );
  for (const patch of incoming) {
    const key = reactionKey(patch.messageId, patch.reaction);
    const previous = byKey.get(key);
    if (previous === undefined || patch.cursor >= previous.cursor) {
      byKey.set(key, { ...patch });
    }
  }
  return [...byKey.values()].sort((left, right) => left.cursor - right.cursor);
}

function mergeReactionCollectionPatches(
  existing: readonly ReactionCollectionPatch[],
  incoming: readonly ReactionCollectionPatch[],
): ReactionCollectionPatch[] {
  const byMessage = new Map(existing.map((patch) => [patch.messageId, patch]));
  for (const patch of incoming) {
    const previous = byMessage.get(patch.messageId);
    if (previous === undefined || patch.cursor >= previous.cursor) {
      byMessage.set(patch.messageId, { ...patch });
    }
  }
  return [...byMessage.values()].sort(
    (left, right) => left.cursor - right.cursor,
  );
}

function rememberBatchSignature(
  previous: readonly string[],
  signature: string,
): string[] {
  const next = [
    ...previous.filter((candidate) => candidate !== signature),
    signature,
  ];
  return next.length > MAX_SEEN_BATCH_SIGNATURES
    ? next.slice(-MAX_SEEN_BATCH_SIGNATURES)
    : next;
}

function withMessages(
  state: ConversationCache,
  messages: readonly MessageView[],
): ConversationCache {
  return {
    ...state,
    history: {
      ...state.history,
      items: sortMessages(messages),
    },
  };
}

function snapshotState(
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): ConversationCache {
  const items = mergeMessages([], page.items, threadRootMessageId);
  return {
    history: {
      ...cloneHistory(page),
      items,
    },
    paginationHighWater: page.highWaterCursor,
    appliedCursor: page.highWaterCursor,
    threadPatches: [],
    reactionPatches: [],
    reactionCollectionPatches: [],
    ...(threadRootMessageId === undefined ? {} : { threadRootMessageId }),
    seenBatchSignatures: [],
  };
}

function replaceState(
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): ConversationCache {
  return snapshotState(page, threadRootMessageId);
}

function reducePageState(
  state: ConversationCache,
  page: MessageHistoryResponse,
  mode: "append" | "replace",
): ConversationReduction {
  if (
    !pageMatchesClosedRuntime(page, state.threadRootMessageId) ||
    page.workspaceId !== state.history.workspaceId ||
    page.conversationId !== state.history.conversationId ||
    !messagesMatchScope(
      page.items,
      state.history.workspaceId,
      state.history.conversationId,
    )
  ) {
    return { kind: "resync-required", reason: "protocol_violation" };
  }
  if (mode === "replace") {
    return {
      kind: "applied",
      state: replaceState(page, state.threadRootMessageId),
    };
  }
  if (page.highWaterCursor !== state.paginationHighWater) {
    return { kind: "resync-required", reason: "high_water_divergence" };
  }
  if (
    page.nextCursor !== null &&
    page.nextCursor === state.history.nextCursor
  ) {
    return { kind: "resync-required", reason: "cursor_divergence" };
  }
  if (messagesDiverge(state.history.items, page.items)) {
    return { kind: "resync-required", reason: "cursor_divergence" };
  }
  const merged = mergeMessages(
    state.history.items,
    page.items,
    state.threadRootMessageId,
  );
  return {
    kind: "applied",
    state: {
      ...state,
      history: {
        ...state.history,
        items: patchThreads(merged, state.threadPatches),
        nextCursor: page.nextCursor,
      },
    },
  };
}

function applyMessageState(
  state: ConversationCache,
  message: MessageView,
): ConversationReduction {
  if (
    message.workspaceId !== state.history.workspaceId ||
    message.conversationId !== state.history.conversationId
  ) {
    return { kind: "resync-required", reason: "protocol_violation" };
  }
  const messages = mergeMessages(
    state.history.items,
    [message],
    state.threadRootMessageId,
  );
  const patchedMessages = patchThreads(messages, state.threadPatches);
  return {
    kind: "applied",
    state: {
      ...withMessages(state, patchedMessages),
      history: {
        ...state.history,
        items: patchedMessages,
        highWaterCursor: Math.max(
          state.history.highWaterCursor,
          message.cursor,
        ),
      },
    },
  };
}

function applyBatchState(
  state: ConversationCache,
  frame: ChangesFrame,
): ConversationReduction {
  const signature = canonical(frame);
  if (state.seenBatchSignatures.includes(signature)) {
    return { kind: "ignored", state };
  }
  if (frame.fromExclusiveCursor < state.appliedCursor) {
    return { kind: "resync-required", reason: "cursor_divergence" };
  }
  if (frame.fromExclusiveCursor > state.appliedCursor) {
    return { kind: "resync-required", reason: "cursor_gap" };
  }
  if (
    frame.schemaVersion !== 1 ||
    frame.throughCursor <= frame.fromExclusiveCursor ||
    frame.messages.length > 100 ||
    frame.threadPatches.length > 100 ||
    frame.reactionPatches.length > 100 ||
    frame.reactionCollectionPatches.length > 100 ||
    hasDuplicateKeys(frame.messages, (message) => message.id) ||
    hasDuplicateKeys(frame.threadPatches, (patch) => patch.messageId) ||
    hasDuplicateKeys(frame.reactionPatches, (patch) =>
      reactionKey(patch.messageId, patch.reaction),
    ) ||
    hasDuplicateKeys(
      frame.reactionCollectionPatches,
      (patch) => patch.messageId,
    ) ||
    !messagesMatchScope(
      frame.messages,
      state.history.workspaceId,
      state.history.conversationId,
    ) ||
    frame.messages.some(
      (message) =>
        message.cursor <= frame.fromExclusiveCursor ||
        message.cursor > frame.throughCursor,
    ) ||
    frame.threadPatches.some(
      (patch) =>
        patch.cursor <= frame.fromExclusiveCursor ||
        patch.cursor > frame.throughCursor,
    ) ||
    frame.reactionPatches.some(
      (patch) =>
        patch.cursor <= frame.fromExclusiveCursor ||
        patch.cursor > frame.throughCursor,
    ) ||
    frame.reactionCollectionPatches.some(
      (patch) =>
        patch.cursor <= frame.fromExclusiveCursor ||
        patch.cursor > frame.throughCursor,
    )
  ) {
    return { kind: "resync-required", reason: "protocol_violation" };
  }

  const threadPatches = mergeThreadPatches(
    state.threadPatches,
    frame.threadPatches,
  );
  const messages = patchThreads(
    mergeMessages(
      state.history.items,
      frame.messages,
      state.threadRootMessageId,
    ),
    threadPatches,
  );
  return {
    kind: "applied",
    state: {
      ...withMessages(state, messages),
      history: {
        ...state.history,
        items: messages,
        highWaterCursor: Math.max(
          state.history.highWaterCursor,
          frame.throughCursor,
        ),
      },
      appliedCursor: frame.throughCursor,
      threadPatches,
      reactionPatches: mergeReactionPatches(
        state.reactionPatches,
        frame.reactionPatches,
      ),
      reactionCollectionPatches: mergeReactionCollectionPatches(
        state.reactionCollectionPatches,
        frame.reactionCollectionPatches,
      ),
      seenBatchSignatures: rememberBatchSignature(
        state.seenBatchSignatures,
        signature,
      ),
    },
  };
}

/** Applies one monotone action to a bounded Stream projection. */
export function reduceConversation(
  state: ConversationCache | undefined,
  action: ConversationAction,
): ConversationReduction {
  if (action.type === "snapshot") {
    if (
      !pageMatchesClosedRuntime(action.page, action.threadRootMessageId) ||
      !messagesMatchScope(
        action.page.items,
        action.page.workspaceId,
        action.page.conversationId,
      )
    ) {
      return { kind: "resync-required", reason: "protocol_violation" };
    }
    return {
      kind: "applied",
      state: snapshotState(action.page, action.threadRootMessageId),
    };
  }
  if (state === undefined) {
    return { kind: "resync-required", reason: "protocol_violation" };
  }
  switch (action.type) {
    case "page":
      return reducePageState(state, action.page, action.mode);
    case "message":
      return applyMessageState(state, action.message);
    case "follow":
      return applyBatchState(state, action.frame);
  }
}

/** Starts a cache from one authoritative timeline or thread page. */
export function createConversationCache(
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): ConversationCache {
  const reduction = reduceConversation(undefined, {
    type: "snapshot",
    page,
    threadRootMessageId,
  });
  if (reduction.kind !== "applied") {
    throw new Error("Conversation snapshot violated its closed scope");
  }
  return reduction.state;
}

/** Replaces a bounded view after a resync and resets its volatile overlays. */
export function replaceConversationPage(
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): ConversationCache {
  return createConversationCache(page, threadRootMessageId);
}

/** Applies one continuation page without changing FOLLOW's checkpoint. */
export function reduceConversationPage(
  state: ConversationCache,
  page: MessageHistoryResponse,
  mode: "append" | "replace",
): ConversationReduction {
  return reduceConversation(state, { type: "page", page, mode });
}

/** Applies an acknowledged Message without advancing the FOLLOW cursor. */
export function applyConversationMessage(
  state: ConversationCache,
  message: MessageView,
): ConversationCache {
  const reduction = reduceConversation(state, { type: "message", message });
  return reduction.kind === "applied" ? reduction.state : state;
}

/**
 * Applies the current authorized Reaction returned by a mutation ACK without
 * advancing FOLLOW. The next absolute FOLLOW patch remains authoritative and
 * wins by cursor.
 */
export function applyConversationReaction(
  state: ConversationCache,
  messageId: string,
  reaction: string,
  response: MessageReactionMutationResponse,
): ConversationReduction {
  const view = response.reaction;
  if (
    view !== null &&
    (view.workspaceId !== state.history.workspaceId ||
      view.conversationId !== state.history.conversationId ||
      view.messageId !== messageId ||
      view.reaction !== reaction)
  ) {
    return { kind: "resync-required", reason: "protocol_violation" };
  }
  const previous = reactionFor(state, messageId, reaction);
  const cursor = Math.max(state.appliedCursor, previous?.cursor ?? 0);
  const patch: ReactionPatch = {
    messageId,
    reaction,
    count: previous?.count ?? 0,
    reactedByPunk: view !== null,
    cursor,
  };
  return {
    kind: "applied",
    state: {
      ...state,
      reactionPatches: mergeReactionPatches(state.reactionPatches, [patch]),
    },
  };
}

/** Applies a validated FOLLOW batch as one renderer-visible cache update. */
export function applyConversationBatch(
  state: ConversationCache,
  frame: ChangesFrame,
): ConversationReduction {
  return reduceConversation(state, { type: "follow", frame });
}

/** Returns the latest absolute reaction patch for a Message/value pair. */
export function reactionFor(
  state: ConversationCache,
  messageId: string,
  reaction: string,
): Pick<ReactionPatch, "count" | "reactedByPunk" | "cursor"> | null {
  const message = state.history.items.find(
    (candidate) => candidate.id === messageId,
  );
  if (message !== undefined && message.status !== "active") return null;
  const collection = state.reactionCollectionPatches.find(
    (candidate) => candidate.messageId === messageId,
  );
  if (collection !== undefined && collection.visibility !== "visible") {
    return null;
  }
  const patch = state.reactionPatches.find(
    (candidate) =>
      candidate.messageId === messageId && candidate.reaction === reaction,
  );
  return patch === undefined
    ? null
    : {
        count: patch.count,
        reactedByPunk: patch.reactedByPunk,
        cursor: patch.cursor,
      };
}

/** Finds one canonical Reaction across the timeline and bounded thread views. */
export function reactionForCaches(
  caches: readonly (readonly [
    readonly unknown[],
    ConversationCache | undefined,
  ])[],
  messageId: string,
  requestedReaction = "👍",
) {
  let reaction: string;
  try {
    reaction = canonicalPunksReaction(requestedReaction);
  } catch {
    return null;
  }
  for (const [, cached] of caches) {
    const view =
      cached === undefined ? null : reactionFor(cached, messageId, reaction);
    if (view !== null) return view;
  }
  return null;
}
