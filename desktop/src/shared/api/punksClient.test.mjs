import assert from "node:assert/strict";
import test from "node:test";
import { validateContract } from "@punks/contracts";

import { createFakePunksAccountClient } from "./punksClient.ts";
import { canonicalPunksReaction } from "./punksReaction.ts";

const origin = "https://staging.punks.bot";
const punkId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const secondWorkspaceId = "55555555-5555-4555-8555-555555555555";

function messageFixture(conversationId, cursor, overrides = {}) {
  const id = `00000000-0000-4000-8000-${String(cursor).padStart(12, "0")}`;
  return {
    id,
    workspaceId,
    conversationId,
    author: { kind: "punk", punkId },
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
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

const seed = {
  compatibility: {
    contract: "desktop.compatibility-response@1",
    compatible: true,
    profile: "desktop-social-loop@1",
    registryVersion: 1,
    minimumClientVersion: "0.6.0",
    environment: "staging",
    origin,
    capabilities: [
      "stream-list",
      "message-history",
      "message-post",
      "unicode-reactions",
      "message-lifecycle",
    ],
  },
  session: {
    sessionId: "99999999-9999-4999-8999-999999999999",
    punkId,
    authenticatedAt: "2026-08-22T10:00:00.000Z",
    expiresAt: "2026-09-22T10:00:00.000Z",
    recentReauthUntil: null,
    punk: { id: punkId, displayName: "Mabza", avatarUrl: null },
  },
  workspaces: [
    {
      id: workspaceId,
      slug: "alpha",
      name: "Alpha",
      visibility: "private",
      role: "owner",
      revision: 1,
    },
    {
      id: secondWorkspaceId,
      slug: "beta",
      name: "Beta",
      visibility: "private",
      role: "member",
      revision: 1,
    },
  ],
  streams: { [workspaceId]: [] },
  messages: {},
};

test("fake profile enforces the same generation-bound WorkspaceSession", async () => {
  const account = createFakePunksAccountClient(seed);
  await account.checkCompatibility();
  await account.getSession();
  await account.listWorkspaces();
  const first = await account.openWorkspace(workspaceId);
  const second = await account.openWorkspace(secondWorkspaceId);

  assert.equal(first.lease.generation, 1);
  assert.equal(second.lease.generation, 2);
  await assert.rejects(first.listStreams(), { kind: "stale_workspace" });
});

test("fake profile requires Compatibility before mounting a Workspace", async () => {
  const account = createFakePunksAccountClient(seed);

  await assert.rejects(account.openWorkspace(workspaceId), {
    kind: "contract_violation",
  });
});

test("fake history emits the same valid opaque response shape as Rust", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const historySeed = structuredClone(seed);
  historySeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 1,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  historySeed.messages[conversationId] = [];
  const account = createFakePunksAccountClient(historySeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);

  const page = await workspace.getTimeline({ conversationId, limit: 1 });
  assert.equal(
    validateContract("punks://contracts/message.history-response@1", page)
      .valid,
    true,
  );
  assert.equal(page.highWaterCursor, 1);
});

test("fake history follows the authoritative newest-first page contract", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const historySeed = structuredClone(seed);
  historySeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 3,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  historySeed.messages[conversationId] = [
    {
      ...messageFixture(conversationId, 1),
      id: "66666666-6666-4666-8666-666666666666",
    },
    {
      ...messageFixture(conversationId, 2),
      id: "77777777-7777-4777-8777-777777777777",
    },
    {
      ...messageFixture(conversationId, 3),
      id: "88888888-8888-4888-8888-888888888888",
    },
  ];
  const account = createFakePunksAccountClient(historySeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);

  const latest = await workspace.getTimeline({ conversationId, limit: 2 });
  assert.deepEqual(
    latest.items.map(({ cursor }) => cursor),
    [2, 3],
  );
  assert.notEqual(latest.nextCursor, null);
  const older = await workspace.getTimeline({
    conversationId,
    limit: 2,
    cursor: latest.nextCursor ?? undefined,
  });
  assert.deepEqual(
    older.items.map(({ cursor }) => cursor),
    [1],
  );
  assert.equal(older.nextCursor, null);
});

test("fake social mutations preserve Message subjects, replies, and Reaction ACKs", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const rootId = "66666666-6666-4666-8666-666666666666";
  const mutationSeed = structuredClone(seed);
  mutationSeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: true,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 1,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  mutationSeed.messages[conversationId] = [
    messageFixture(conversationId, 1, {
      id: rootId,
      threadRootMessageId: rootId,
    }),
  ];

  const account = createFakePunksAccountClient(mutationSeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);

  await assert.rejects(
    workspace.postMessage({ conversationId, content: "Sans sujet" }),
    { kind: "problem" },
  );

  const reply = await workspace.postMessage({
    conversationId,
    content: "Une réponse",
    topic: "Sujet de test",
    replyToMessageId: rootId,
  });
  assert.equal(reply.topic, "Sujet de test");
  assert.equal(reply.parentMessageId, rootId);
  assert.equal(reply.threadRootMessageId, rootId);
  const beforeReaction = await workspace.getTimeline({ conversationId });
  assert.deepEqual(
    beforeReaction.items.map((message) => message.id),
    [rootId, reply.id],
  );
  assert.equal(
    beforeReaction.items.find((message) => message.id === rootId)?.status,
    "active",
  );

  const added = await workspace.addReaction({
    conversationId,
    messageId: rootId,
    reaction: "🦄",
  });
  assert.equal(added.effect, "added");
  assert.equal(added.reaction?.reaction, "🦄");

  const removed = await workspace.removeReaction({
    conversationId,
    messageId: rootId,
    reaction: "🦄",
  });
  assert.equal(removed.effect, "removed");
  assert.equal(removed.reaction, null);

  const shortcode = await workspace.addReaction({
    conversationId,
    messageId: rootId,
    reaction: ":Party_Parrot:",
  });
  assert.equal(shortcode.reaction?.reaction, ":party_parrot:");
  const shortcodeRemoved = await workspace.removeReaction({
    conversationId,
    messageId: rootId,
    reaction: " :PARTY_PARROT: ",
  });
  assert.equal(shortcodeRemoved.effect, "removed");
});

test("desktop Reaction canonicalization matches the authority", () => {
  assert.equal(canonicalPunksReaction(""), "+");
  assert.equal(canonicalPunksReaction("  e\u0301  "), "é");
  assert.equal(canonicalPunksReaction(":Party_Parrot:"), ":party_parrot:");
  assert.throws(() => canonicalPunksReaction("a\nb"), {
    kind: "contract_violation",
  });
  assert.throws(() => canonicalPunksReaction("x".repeat(65)), {
    kind: "contract_violation",
  });
  assert.throws(() => canonicalPunksReaction(":party parrot:"), {
    kind: "contract_violation",
  });
});

test("fake Message lifecycle returns authoritative edit, tombstone, and restore views", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const lifecycleSeed = structuredClone(seed);
  lifecycleSeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: true,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 1,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  lifecycleSeed.messages[conversationId] = [];
  const account = createFakePunksAccountClient(lifecycleSeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);
  const posted = await workspace.postMessage({
    conversationId,
    content: "Original",
    topic: "Topic",
  });

  await assert.rejects(
    workspace.editMessage({
      conversationId,
      messageId: posted.id,
      content: "Edited",
      topic: null,
    }),
    { kind: "problem" },
  );

  const edited = await workspace.editMessage({
    conversationId,
    messageId: posted.id,
    content: "Edited",
    topic: "New topic",
  });
  assert.equal(edited.content, "Edited");
  assert.equal(edited.topic, "New topic");
  assert.equal(edited.editedAt !== null, true);

  const retracted = await workspace.retractMessage({
    conversationId,
    messageId: posted.id,
    reasonCode: "author-request",
    publicReason: "Author request",
  });
  assert.equal(retracted.status, "retracted");
  assert.equal(retracted.content, null);
  assert.equal(retracted.publicReason, "Author request");
  await assert.rejects(
    workspace.retractMessage({
      conversationId,
      messageId: posted.id,
    }),
    { kind: "problem" },
  );
  await assert.rejects(
    workspace.addReaction({
      conversationId,
      messageId: posted.id,
      reaction: "🦄",
    }),
    { kind: "problem" },
  );

  const restored = await workspace.restoreMessage({
    conversationId,
    messageId: posted.id,
  });
  assert.equal(restored.status, "active");
  assert.equal(restored.content, "Edited");
  assert.equal(restored.topic, "New topic");
});

test("fake Message lifecycle refuses restore by the wrong authority", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const otherPunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const stream = {
    id: conversationId,
    workspaceId,
    name: "general",
    type: "stream",
    visibility: "open",
    description: null,
    topic: null,
    purpose: null,
    topicRequired: false,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: 2,
    updatedAt: "2026-08-22T10:00:00.000Z",
  };
  for (const retractionKind of ["author", "moderation"]) {
    const lifecycleSeed = structuredClone(seed);
    lifecycleSeed.streams[workspaceId] = [stream];
    lifecycleSeed.messages[conversationId] = [
      messageFixture(conversationId, 2, {
        author:
          retractionKind === "author"
            ? { kind: "punk", punkId: otherPunkId }
            : { kind: "punk", punkId },
        status: "retracted",
        content: null,
        topic: null,
        retractionKind,
        retractedAt: "2026-08-23T10:00:00.000Z",
        eraseAfter: "2099-08-30T10:00:00.000Z",
      }),
    ];
    const account = createFakePunksAccountClient(lifecycleSeed);
    await account.checkCompatibility();
    const workspace = await account.openWorkspace(workspaceId);

    await assert.rejects(
      workspace.restoreMessage({
        conversationId,
        messageId: lifecycleSeed.messages[conversationId][0].id,
      }),
      { kind: "problem" },
    );
  }
});

test("fake FOLLOW reaches live when the Stream has no pending changes", async () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const followSeed = structuredClone(seed);
  followSeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 4,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  const account = createFakePunksAccountClient(followSeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);
  const follow = await workspace.followConversation(conversationId, 4);

  assert.deepEqual(await follow.nextDelivery(), { kind: "became_live" });
});

test("fake FOLLOW applies one batch and becomes live only after confirmation", async () => {
  const followSeed = structuredClone(seed);
  const conversationId = "33333333-3333-4333-8333-333333333333";
  followSeed.streams[workspaceId] = [
    {
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      ttlSeconds: null,
      ttlDeadline: null,
      revision: 1,
      cursor: 6,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];
  followSeed.followFrames = {
    [conversationId]: [
      {
        schemaVersion: 1,
        type: "accepted",
        resumeAfterCursor: 4,
        targetHighWaterCursor: 6,
      },
      {
        schemaVersion: 1,
        type: "changes",
        fromExclusiveCursor: 4,
        throughCursor: 6,
        messages: [],
        threadPatches: [],
        reactionPatches: [],
        reactionCollectionPatches: [],
      },
      { schemaVersion: 1, type: "ready", highWaterCursor: 6 },
    ],
  };
  const account = createFakePunksAccountClient(followSeed);
  await account.checkCompatibility();
  const workspace = await account.openWorkspace(workspaceId);
  const follow = await workspace.followConversation(conversationId, 4);

  const batch = await follow.nextDelivery();
  assert.equal(batch.kind, "apply_batch");
  await follow.confirmBatch(6);
  assert.deepEqual(await follow.nextDelivery(), { kind: "became_live" });
});
