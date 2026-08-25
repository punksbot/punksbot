import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  commitConversationPage,
  purgeConversationProjections,
  replaceConversationProjection,
} from "./conversationCacheCoordinator.ts";
import {
  applyConversationBatch,
  createConversationCache,
} from "./socialLoop.ts";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const olderId = "44444444-4444-4444-8444-444444444444";
const initialId = "55555555-5555-4555-8555-555555555555";
const liveId = "66666666-6666-4666-8666-666666666666";

function message(id, cursor) {
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
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    editedAt: null,
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

test("pagination commits against the latest FOLLOW projection", () => {
  const queryClient = new QueryClient();
  const key = ["punks", "messages", workspaceId, 1, conversationId, "timeline"];
  const initial = createConversationCache(
    page([message(initialId, 2)], 2, "mhc1.older.signature"),
  );
  queryClient.setQueryData(key, initial);

  const followed = applyConversationBatch(initial, {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 2,
    throughCursor: 3,
    messages: [message(liveId, 3)],
    threadPatches: [],
    reactionPatches: [],
    reactionCollectionPatches: [],
  });
  assert.equal(followed.kind, "applied");
  if (followed.kind !== "applied") return;
  queryClient.setQueryData(key, followed.state);

  const committed = commitConversationPage(
    queryClient,
    key,
    page([message(olderId, 1)], 2),
  );

  assert.equal(committed.kind, "applied");
  assert.deepEqual(
    queryClient.getQueryData(key).history.items.map((item) => item.id),
    [olderId, initialId, liveId],
  );
  assert.equal(queryClient.getQueryData(key).appliedCursor, 3);
});

test("resync atomically replaces the bounded primary view without invalidating it", () => {
  const queryClient = new QueryClient();
  const prefix = ["punks", "messages", workspaceId, 1, conversationId];
  const timelineKey = [...prefix, "timeline"];
  const threadKey = [...prefix, "thread", initialId];
  queryClient.setQueryData(
    timelineKey,
    createConversationCache(page([message(initialId, 2)], 2)),
  );
  queryClient.setQueryData(
    threadKey,
    createConversationCache(page([message(initialId, 2)], 2), initialId),
  );
  const threadObserver = new QueryObserver(queryClient, {
    queryKey: threadKey,
    queryFn: () => new Promise(() => undefined),
  });
  const unsubscribe = threadObserver.subscribe(() => undefined);

  replaceConversationProjection(
    queryClient,
    timelineKey,
    prefix,
    page([message(liveId, 3)], 3),
  );

  assert.deepEqual(
    queryClient.getQueryData(timelineKey).history.items.map((item) => item.id),
    [liveId],
  );
  assert.equal(queryClient.getQueryState(timelineKey)?.isInvalidated, false);
  assert.equal(queryClient.getQueryData(threadKey), undefined);
  assert.equal(threadObserver.getCurrentResult().data, undefined);
  unsubscribe();
});

test("terminal purge redacts active Message and author observers", () => {
  const queryClient = new QueryClient();
  const messagePrefix = ["punks", "messages", workspaceId, 1, conversationId];
  const messageKey = [...messagePrefix, "timeline"];
  const authorPrefix = ["punks", "authors", workspaceId, 1];
  const authorKey = [...authorPrefix, "punk:secret"];
  const streamKey = ["punks", "stream", workspaceId, 1, conversationId];
  queryClient.setQueryData(
    messageKey,
    createConversationCache(page([message(initialId, 2)], 2)),
  );
  queryClient.setQueryData(authorKey, [
    {
      kind: "punk",
      punkId: "11111111-1111-4111-8111-111111111111",
      displayName: "Must be purged",
      avatarUrl: null,
    },
  ]);
  queryClient.setQueryData(streamKey, {
    name: "Private Stream",
    description: "Private description",
    topic: "Private topic",
    purpose: "Private purpose",
  });
  const messageObserver = new QueryObserver(queryClient, {
    queryKey: messageKey,
    enabled: false,
  });
  const authorObserver = new QueryObserver(queryClient, {
    queryKey: authorKey,
    enabled: false,
  });
  const streamObserver = new QueryObserver(queryClient, {
    queryKey: streamKey,
    enabled: false,
  });
  const unsubscribeMessage = messageObserver.subscribe(() => undefined);
  const unsubscribeAuthor = authorObserver.subscribe(() => undefined);
  const unsubscribeStream = streamObserver.subscribe(() => undefined);

  purgeConversationProjections(
    queryClient,
    messagePrefix,
    authorPrefix,
    streamKey,
  );

  assert.deepEqual(
    queryClient.getQueryData(messageKey).history.items.map((item) => item.id),
    [],
  );
  assert.deepEqual(queryClient.getQueryData(authorKey), []);
  assert.deepEqual(
    messageObserver
      .getCurrentResult()
      .data.history.items.map((item) => item.id),
    [],
  );
  assert.deepEqual(authorObserver.getCurrentResult().data, []);
  assert.deepEqual(streamObserver.getCurrentResult().data, {
    name: "Stream",
    description: null,
    topic: null,
    purpose: null,
  });
  unsubscribeMessage();
  unsubscribeAuthor();
  unsubscribeStream();
});
