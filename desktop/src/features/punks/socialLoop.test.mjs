import assert from "node:assert/strict";
import test from "node:test";

import {
  applyConversationBatch,
  applyConversationMessage,
  applyConversationReaction,
  createConversationCache,
  reduceConversationPage,
  reactionFor,
} from "./socialLoop.ts";
import { canRestoreMessage } from "./PunksConversationHelpers.ts";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const rootId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";

function message(id, cursor, overrides = {}) {
  return {
    id,
    workspaceId,
    conversationId,
    author: { kind: "punk", punkId: "11111111-1111-4111-8111-111111111111" },
    messageType: "stream-message",
    status: "active",
    content: `message-${cursor}`,
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: id,
    threadDepth: 0,
    broadcast: false,
    replyCount: 0,
    descendantCount: 0,
    lastReplyAt: null,
    currentVersion: 1,
    retractionKind: null,
    retractedAt: null,
    eraseAfter: null,
    publicReason: null,
    erasedAt: null,
    revision: 1,
    createdCursor: cursor,
    cursor,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

function page(items, highWaterCursor, nextCursor = null) {
  return {
    workspaceId,
    conversationId,
    highWaterCursor,
    order: "createdCursor-ascending",
    items,
    nextCursor,
  };
}

test("restore authority follows the retraction kind and fails closed", () => {
  assert.equal(
    canRestoreMessage(
      { status: "retracted", retractionKind: "author" },
      true,
      false,
    ),
    true,
  );
  assert.equal(
    canRestoreMessage(
      { status: "retracted", retractionKind: "author" },
      false,
      true,
    ),
    false,
  );
  assert.equal(
    canRestoreMessage(
      { status: "retracted", retractionKind: "moderation" },
      true,
      false,
    ),
    false,
  );
  assert.equal(
    canRestoreMessage(
      { status: "retracted", retractionKind: "moderation" },
      false,
      true,
    ),
    true,
  );
  assert.equal(
    canRestoreMessage(
      { status: "retracted", retractionKind: null },
      true,
      true,
    ),
    false,
  );
});

test("pages merge into one deduplicated timeline without duplicating Messages", () => {
  const initial = createConversationCache(
    page([message(rootId, 2), message(replyId, 3)], 3, "mhc1.older.A"),
  );

  const reduced = reduceConversationPage(
    initial,
    page([message("66666666-6666-4666-8666-666666666666", 1)], 3),
    "append",
  );

  assert.equal(reduced.kind, "applied");
  if (reduced.kind !== "applied") return;
  assert.deepEqual(
    reduced.state.history.items.map((item) => item.cursor),
    [1, 2, 3],
  );
  assert.equal(reduced.state.paginationHighWater, 3);
  assert.equal(reduced.state.history.nextCursor, null);
});

test("a snapshot rejects non-monotone created cursors instead of sorting a broken page", () => {
  assert.throws(
    () =>
      createConversationCache(
        page([message(replyId, 3), message(rootId, 2)], 3),
      ),
    /violated its closed scope/u,
  );
});

test("pagination rejects a divergent Message at the same revision and cursor", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const divergent = reduceConversationPage(
    initial,
    page(
      [
        message(rootId, 4, {
          content: "same coordinates, different content",
        }),
      ],
      4,
    ),
    "append",
  );

  assert.deepEqual(divergent, {
    kind: "resync-required",
    reason: "cursor_divergence",
  });
});

test("absolute thread patches survive pagination for Messages not yet loaded", () => {
  const olderRootId = "66666666-6666-4666-8666-666666666666";
  const initial = createConversationCache(
    page([message(rootId, 4)], 4, "mhc1.older.A"),
  );
  const followed = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 5,
    messages: [],
    threadPatches: [
      {
        messageId: olderRootId,
        replyCount: 3,
        descendantCount: 5,
        lastReplyAt: "2026-08-23T10:01:00.000Z",
        revision: 2,
        cursor: 5,
      },
    ],
    reactionPatches: [],
    reactionCollectionPatches: [],
  });

  assert.equal(followed.kind, "applied");
  if (followed.kind !== "applied") return;
  const older = reduceConversationPage(
    followed.state,
    page([message(olderRootId, 1)], 4),
    "append",
  );

  assert.equal(older.kind, "applied");
  if (older.kind !== "applied") return;
  assert.equal(older.state.history.items[0].replyCount, 3);
  assert.equal(older.state.history.items[0].descendantCount, 5);
});

test("a FOLLOW batch updates Messages, thread counters and reaction counts atomically", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const reduced = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 6,
    messages: [
      message(replyId, 5, {
        parentMessageId: rootId,
        threadRootMessageId: rootId,
        threadDepth: 1,
      }),
    ],
    threadPatches: [
      {
        messageId: rootId,
        replyCount: 1,
        descendantCount: 1,
        lastReplyAt: "2026-08-23T10:01:00.000Z",
        revision: 2,
        cursor: 5,
      },
    ],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 2,
        reactedByPunk: true,
        cursor: 6,
      },
    ],
    reactionCollectionPatches: [],
  });

  assert.equal(reduced.kind, "applied");
  if (reduced.kind !== "applied") return;
  assert.deepEqual(
    reduced.state.history.items.map((item) => item.id),
    [rootId, replyId],
  );
  assert.equal(reduced.state.history.items[0].replyCount, 1);
  assert.deepEqual(reactionFor(reduced.state, rootId, "👍"), {
    count: 2,
    reactedByPunk: true,
    cursor: 6,
  });
  assert.equal(reduced.state.appliedCursor, 6);
});

test("a FOLLOW batch rejects conflicting absolute patches at one cursor", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const reduced = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 5,
    messages: [],
    threadPatches: [],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 1,
        reactedByPunk: false,
        cursor: 5,
      },
      {
        messageId: rootId,
        reaction: "👍",
        count: 2,
        reactedByPunk: false,
        cursor: 5,
      },
    ],
    reactionCollectionPatches: [],
  });

  assert.deepEqual(reduced, {
    kind: "resync-required",
    reason: "protocol_violation",
  });
});

test("the same batch is idempotent, while a gap requires a bounded resync", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const frame = {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 5,
    messages: [message(replyId, 5)],
    threadPatches: [],
    reactionPatches: [],
    reactionCollectionPatches: [],
  };
  const applied = applyConversationBatch(initial, frame);
  assert.equal(applied.kind, "applied");
  if (applied.kind !== "applied") return;

  const duplicate = applyConversationBatch(
    applied.state,
    structuredClone(frame),
  );
  assert.equal(duplicate.kind, "ignored");

  const next = applyConversationBatch(applied.state, {
    ...frame,
    fromExclusiveCursor: 5,
    throughCursor: 6,
    messages: [message("77777777-7777-4777-8777-777777777777", 6)],
  });
  assert.equal(next.kind, "applied");
  if (next.kind !== "applied") return;
  const delayedDuplicate = applyConversationBatch(
    next.state,
    structuredClone(frame),
  );
  assert.equal(delayedDuplicate.kind, "ignored");

  const gap = applyConversationBatch(next.state, {
    ...frame,
    fromExclusiveCursor: 7,
    throughCursor: 8,
  });
  assert.deepEqual(gap, {
    kind: "resync-required",
    reason: "cursor_gap",
  });
});

test("a mutation acknowledgement updates the view without moving FOLLOW's cursor", () => {
  const initial = createConversationCache(page([], 4));
  const acknowledged = applyConversationMessage(initial, message(replyId, 5));

  assert.equal(acknowledged.kind, "applied");
  if (acknowledged.kind !== "applied") return;
  assert.equal(acknowledged.state.history.highWaterCursor, 5);
  assert.equal(acknowledged.state.appliedCursor, 4);
  assert.deepEqual(
    acknowledged.state.history.items.map((item) => item.id),
    [replyId],
  );
});

test("a divergent Message acknowledgement cannot rewrite FOLLOW authority at equal coordinates", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const acknowledged = applyConversationMessage(
    initial,
    message(rootId, 4, { content: "divergent acknowledgement" }),
  );

  assert.deepEqual(acknowledged, {
    kind: "resync-required",
    reason: "cursor_divergence",
  });
});

test("reaction acknowledgements update only the Punk overlay and converge with FOLLOW", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const followed = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 6,
    messages: [],
    threadPatches: [],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 1,
        reactedByPunk: false,
        cursor: 6,
      },
    ],
    reactionCollectionPatches: [],
  });

  assert.equal(followed.kind, "applied");
  if (followed.kind !== "applied") return;
  const added = applyConversationReaction(
    followed.state,
    rootId,
    "👍",
    {
      reaction: {
        id: "66666666-6666-4666-8666-666666666666",
        workspaceId,
        conversationId,
        messageId: rootId,
        actor: {
          kind: "punk",
          punkId: "11111111-1111-4111-8111-111111111111",
        },
        reaction: "👍",
        reactedAt: "2026-08-23T10:01:00.000Z",
      },
      effect: "added",
      replayed: false,
    },
    6,
  );
  assert.equal(added.kind, "applied");
  if (added.kind !== "applied") return;
  assert.deepEqual(reactionFor(added.state, rootId, "👍"), {
    count: 1,
    reactedByPunk: true,
    cursor: 6,
  });
  assert.equal(added.state.appliedCursor, 6);

  const removed = applyConversationReaction(
    added.state,
    rootId,
    "👍",
    {
      reaction: null,
      effect: "removed",
      replayed: false,
    },
    6,
  );
  assert.equal(removed.kind, "applied");
  if (removed.kind !== "applied") return;
  assert.equal(reactionFor(removed.state, rootId, "👍")?.reactedByPunk, false);

  const later = applyConversationBatch(removed.state, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 6,
    throughCursor: 7,
    messages: [],
    threadPatches: [],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 2,
        reactedByPunk: true,
        cursor: 7,
      },
    ],
    reactionCollectionPatches: [],
  });
  assert.equal(later.kind, "applied");
  if (later.kind !== "applied") return;
  assert.deepEqual(reactionFor(later.state, rootId, "👍"), {
    count: 2,
    reactedByPunk: true,
    cursor: 7,
  });
});

test("a delayed Reaction acknowledgement cannot overwrite a newer FOLLOW patch", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const followed = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 5,
    messages: [],
    threadPatches: [],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 0,
        reactedByPunk: false,
        cursor: 5,
      },
    ],
    reactionCollectionPatches: [],
  });
  assert.equal(followed.kind, "applied");
  if (followed.kind !== "applied") return;

  const delayed = applyConversationReaction(
    followed.state,
    rootId,
    "👍",
    {
      reaction: {
        id: "66666666-6666-4666-8666-666666666666",
        workspaceId,
        conversationId,
        messageId: rootId,
        actor: {
          kind: "punk",
          punkId: "11111111-1111-4111-8111-111111111111",
        },
        reaction: "👍",
        reactedAt: "2026-08-23T10:01:00.000Z",
      },
      effect: "added",
      replayed: false,
    },
    4,
  );

  assert.equal(delayed.kind, "ignored");
  if (delayed.kind !== "ignored") return;
  assert.deepEqual(reactionFor(delayed.state, rootId, "👍"), {
    count: 0,
    reactedByPunk: false,
    cursor: 5,
  });
});

test("reaction visibility and Message tombstones mask stale reaction patches", () => {
  const initial = createConversationCache(page([message(rootId, 4)], 4));
  const hidden = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 4,
    throughCursor: 6,
    messages: [],
    threadPatches: [],
    reactionPatches: [
      {
        messageId: rootId,
        reaction: "👍",
        count: 3,
        reactedByPunk: true,
        cursor: 5,
      },
    ],
    reactionCollectionPatches: [
      {
        messageId: rootId,
        visibility: "temporarily-hidden",
        cursor: 6,
        refreshRequired: true,
      },
    ],
  });

  assert.equal(hidden.kind, "applied");
  if (hidden.kind !== "applied") return;
  assert.equal(reactionFor(hidden.state, rootId, "👍"), null);

  const retracted = applyConversationMessage(
    hidden.state,
    message(rootId, 7, { status: "retracted", content: null }),
  );
  assert.equal(retracted.kind, "applied");
  if (retracted.kind !== "applied") return;
  assert.equal(reactionFor(retracted.state, rootId, "👍"), null);
});
