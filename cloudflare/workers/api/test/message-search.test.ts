import type {
  ArchiveConversationCommand,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  MessageSearchResponse,
  MessageView,
  EditMessageCommand,
  PostMessageCommand,
  RemoveWorkspaceMemberCommand,
  RetractMessageCommand,
  SetWorkspaceMemberRoleCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import normalizationCorpus from "../../../packages/contracts/conformance/message-search-normalization.json";

import type { ApiEnv } from "../src/env";
import type { ConversationDO } from "../src/conversation-do";
import { route } from "../src/router";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
let workspaceSequence = 0;

async function resetSearchFixture(): Promise<void> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/reset",
    { method: "POST" },
  );
  expect(response.status).toBe(200);
  const erasure = await env.ERASURE_REGISTRY.fetch(
    "https://fixture/__test/reset",
    { method: "POST" },
  );
  expect(erasure.status).toBe(200);
}

async function searchCalls(): Promise<unknown[]> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/calls",
  );
  return ((await response.json()) as { calls: unknown[] }).calls;
}

async function programCandidates(candidates: unknown[]): Promise<void> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/candidates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(candidates),
    },
  );
  expect(response.status).toBe(200);
}

async function setSearchMode(mode: string): Promise<void> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/mode",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  expect(response.status).toBe(200);
}

async function setRawSearchResult(result: unknown): Promise<void> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/result",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    },
  );
  expect(response.status).toBe(200);
}

async function setSearchHold(held: boolean): Promise<void> {
  const response = await env.MESSAGE_SEARCH.fetch(
    `https://fixture/__test/${held ? "hold" : "release"}`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
}

async function searchHoldReached(): Promise<boolean> {
  const response = await env.MESSAGE_SEARCH.fetch(
    "https://fixture/__test/hold",
  );
  return ((await response.json()) as { reached: boolean }).reached;
}

async function overrideSearchSecrets(
  createdConversationId: string,
  masterKey: unknown,
  cursorKey: unknown,
): Promise<void> {
  await runInDurableObject(
    env.CONVERSATIONS.getByName(createdConversationId),
    async (instance: ConversationDO) => {
      const instanceEnv = (
        instance as unknown as {
          env: ApiEnv;
        }
      ).env;
      instanceEnv.MESSAGE_SEARCH_MASTER_KEY = masterKey as string;
      instanceEnv.MESSAGE_SEARCH_CURSOR_KEY = cursorKey as string;
    },
  );
}

async function search(
  createdWorkspaceId: string,
  createdConversationId: string,
  options: {
    query?: string;
    cursor?: string | null;
    limit?: number;
    cookie?: string;
    threadRootMessageId?: string | null;
  } = {},
): Promise<Response> {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: options.cookie ?? "__Host-punks_session=session-owner",
      },
      body: JSON.stringify({
        contract: "message.search@1",
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        threadRootMessageId: options.threadRootMessageId ?? null,
        query: options.query ?? "needle",
        cursor: options.cursor ?? null,
        limit: options.limit ?? 50,
      }),
    },
  );
}

async function createWorkspace(
  commandId = crypto.randomUUID(),
  slug?: string,
): Promise<string> {
  workspaceSequence += 1;
  const resolvedSlug = slug ?? `message-search-${workspaceSequence}`;
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: resolvedSlug,
      name: "Message search",
      visibility: "private",
    },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { workspace: { id: string } }).workspace
    .id;
}

async function createConversation(
  createdWorkspaceId: string,
  commandId = "12daac9b-2f58-456f-958d-660bf110cd06",
  name = "search-main",
): Promise<string> {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId,
    workspaceId: createdWorkspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { name, type: "stream", visibility: "open" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { conversation: { id: string } })
    .conversation.id;
}

async function archiveConversation(
  createdWorkspaceId: string,
  createdConversationId: string,
): Promise<void> {
  const command: ArchiveConversationCommand = {
    contract: "conversation.archive@1",
    commandId: crypto.randomUUID(),
    workspaceId: createdWorkspaceId,
    conversationId: createdConversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { cause: "manual" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/archive`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
}

async function edit(
  createdWorkspaceId: string,
  createdConversationId: string,
  message: MessageView,
  content: string,
  commandId = "f6ac66db-9a0e-44d6-b1e5-5605855acd41",
): Promise<MessageView> {
  const command: EditMessageCommand = {
    contract: "message.edit@1",
    commandId,
    workspaceId: createdWorkspaceId,
    conversationId: createdConversationId,
    messageId: message.id,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content,
      topic: null,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/${message.id}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return (JSON.parse(text) as { message: MessageView }).message;
}

async function retract(
  createdWorkspaceId: string,
  createdConversationId: string,
  message: MessageView,
  commandId = "b70bc5bb-cb0d-4a8b-ad06-5f9f93d3dc9b",
): Promise<void> {
  const command: RetractMessageCommand = {
    contract: "message.retract@1",
    commandId,
    workspaceId: createdWorkspaceId,
    conversationId: createdConversationId,
    messageId: message.id,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { publicReason: null, reasonCode: null },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/${message.id}/retract`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function setOtherMember(createdWorkspaceId: string): Promise<void> {
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId: "ea9ad4c9-e6d8-494a-834f-9d88f31308a1",
    workspaceId: createdWorkspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      targetPunkId: otherPunkId,
      role: "member",
      expectedRevision: 1,
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/members/${otherPunkId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
}

async function removeOtherMember(createdWorkspaceId: string): Promise<void> {
  const command: RemoveWorkspaceMemberCommand = {
    contract: "workspace.member-remove@1",
    commandId: "4cf40c29-70c5-4b0c-9da0-ea4a55f101f1",
    workspaceId: createdWorkspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId: otherPunkId, expectedRevision: 2 },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/members/${otherPunkId}`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function post(
  createdWorkspaceId: string,
  createdConversationId: string,
  commandId: string,
  content: string,
  topic: string | null = null,
  replyToMessageId: string | null = null,
): Promise<MessageView> {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId,
    workspaceId: createdWorkspaceId,
    conversationId: createdConversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content,
      topic,
      replyToMessageId,
      broadcast: false,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return (JSON.parse(text) as { message: MessageView }).message;
}

describe("Conversation Message search API", () => {
  beforeEach(resetSearchFixture);

  it("requires a Punk session before any Search RPC", async () => {
    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: "message.search@1",
          workspaceId,
          conversationId,
          threadRootMessageId: null,
          query: "needle",
          cursor: null,
          limit: 50,
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(await searchCalls()).toEqual([]);
  });

  it("returns authorized current Message views in projection order", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const first = await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "Auth refresh playbook",
    );
    const second = await post(
      createdWorkspaceId,
      createdConversationId,
      "91b0eecd-a265-4f00-8a84-31bb86677a9a",
      "Incident timeline",
      "Auth refresh",
    );
    await programCandidates(
      [first, second].map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
        },
        body: JSON.stringify({
          contract: "message.search@1",
          workspaceId: createdWorkspaceId,
          conversationId: createdConversationId,
          threadRootMessageId: null,
          query: "AUTH refresh",
          cursor: null,
          limit: 50,
        }),
      },
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = JSON.parse(text) as MessageSearchResponse;
    expect(
      validateContract("punks://contracts/message.search-response@1", body),
    ).toEqual({ valid: true });
    expect(body.items.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(body.items.map(({ content }) => content)).toEqual([
      "Incident timeline",
      "Auth refresh playbook",
    ]);
    expect(body.nextCursor).toBeNull();
    expect(text).not.toMatch(
      /score|snippet|h2_|ciphertext|contentKey|Commitment|pubkey|sig|event/,
    );

    const calls = await searchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceId: createdWorkspaceId,
      conversationId: createdConversationId,
      algorithm: "hmac-sha256-conversation-v2",
    });
    expect(calls[0]).toMatchObject({
      tokens: [
        expect.stringMatching(/^h2_[A-Za-z0-9_-]{43}$/),
        expect.stringMatching(/^h2_[A-Za-z0-9_-]{43}$/),
      ],
    });
    expect(JSON.stringify(calls[0])).not.toMatch(
      /AUTH refresh|cookie|punkId|session|msc1\./,
    );
  });

  it("replays the shared normalization corpus through workerd", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);

    for (const testCase of normalizationCorpus.cases) {
      const message = await post(
        createdWorkspaceId,
        createdConversationId,
        crypto.randomUUID(),
        testCase.document.content,
        testCase.document.topic,
      );
      await programCandidates([
        {
          workspaceId: createdWorkspaceId,
          conversationId: createdConversationId,
          messageId: message.id,
          createdCursor: message.createdCursor,
          lastCursor: message.cursor,
        },
      ]);

      const response = await search(createdWorkspaceId, createdConversationId, {
        query: testCase.query,
      });
      const text = await response.text();
      expect(response.status, `${testCase.name}: ${text}`).toBe(200);
      const body = JSON.parse(text) as MessageSearchResponse;
      expect(
        body.items.map(({ id }) => id),
        testCase.name,
      ).toEqual(testCase.matches ? [message.id] : []);
    }
  });

  it("confines one search to its requested Fil", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const firstRoot = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "first root",
    );
    const secondRoot = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "second root",
    );
    const firstReply = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "needle first thread",
      null,
      firstRoot.id,
    );
    const secondReply = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "needle second thread",
      null,
      secondRoot.id,
    );
    await programCandidates(
      [firstReply, secondReply].map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        threadRootMessageId: message.threadRootMessageId,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const response = await search(createdWorkspaceId, createdConversationId, {
      threadRootMessageId: firstRoot.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as MessageSearchResponse;
    expect(body.threadRootMessageId).toBe(firstRoot.id);
    expect(body.items.map(({ id }) => id)).toEqual([firstReply.id]);
    expect(body.items).not.toContainEqual(
      expect.objectContaining({ id: secondReply.id }),
    );
    expect(await searchCalls()).toEqual([
      expect.objectContaining({
        threadRootMessageId: firstRoot.id,
        expectedCursor: firstReply.cursor,
      }),
    ]);
  });

  it("returns a typed partial page when the index is unavailable or lagging", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const message = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "needle remains authorized",
    );

    await setSearchMode("unavailable");
    const unavailableResponse = await search(
      createdWorkspaceId,
      createdConversationId,
    );
    expect(unavailableResponse.status).toBe(200);
    expect(await unavailableResponse.json()).toMatchObject({
      completeness: "partial",
      partialReason: "index_unavailable",
      items: [],
      nextCursor: null,
    });

    await setSearchMode("available");
    await setRawSearchResult({
      ok: true,
      indexState: "lagging",
      candidates: [
        {
          messageId: message.id,
          conversationId: createdConversationId,
          createdCursor: message.createdCursor,
          lastCursor: message.cursor,
        },
      ],
      nextCursor: null,
    });
    const laggingResponse = await search(
      createdWorkspaceId,
      createdConversationId,
    );
    expect(laggingResponse.status).toBe(200);
    expect(await laggingResponse.json()).toMatchObject({
      completeness: "partial",
      partialReason: "index_lagging",
      items: [{ id: message.id }],
    });
  });

  it("removes an archived Conversation before consulting the index", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    await archiveConversation(createdWorkspaceId, createdConversationId);

    const response = await search(createdWorkspaceId, createdConversationId);

    expect(response.status).toBe(404);
    expect(await searchCalls()).toEqual([]);
  });

  it("does not disclose or consult the index for an unknown Fil", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);

    const response = await search(createdWorkspaceId, createdConversationId, {
      threadRootMessageId: "88888888-8888-4888-8888-888888888888",
    });

    expect(response.status).toBe(404);
    expect(await searchCalls()).toEqual([]);
  });

  it("keeps an unavailable continuation without dropping its opaque position", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const messages = [
      await post(
        createdWorkspaceId,
        createdConversationId,
        crypto.randomUUID(),
        "needle first",
      ),
      await post(
        createdWorkspaceId,
        createdConversationId,
        crypto.randomUUID(),
        "needle second",
      ),
    ];
    await programCandidates(
      messages.map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );
    const firstResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1 },
    );
    const first = (await firstResponse.json()) as MessageSearchResponse;
    expect(first.nextCursor).not.toBeNull();
    await setSearchMode("unavailable");

    const partialResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1, cursor: first.nextCursor },
    );
    const partial = (await partialResponse.json()) as MessageSearchResponse;

    expect(partial.completeness).toBe("partial");
    expect(partial.partialReason).toBe("index_unavailable");
    expect(partial.items).toEqual([]);
    expect(partial.nextCursor).toMatch(/^msc1\./u);
  });

  it("preserves the exact public continuation while the index is lagging", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const older = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "needle older",
    );
    const newer = await post(
      createdWorkspaceId,
      createdConversationId,
      crypto.randomUUID(),
      "needle newer",
    );
    await programCandidates(
      [older, newer].map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );
    const firstResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1 },
    );
    const first = (await firstResponse.json()) as MessageSearchResponse;
    expect(first.items.map(({ id }) => id)).toEqual([newer.id]);
    expect(first.nextCursor).toMatch(/^msc1\./u);

    await setRawSearchResult({
      ok: true,
      indexState: "lagging",
      candidates: [
        {
          messageId: older.id,
          conversationId: createdConversationId,
          createdCursor: older.createdCursor,
          lastCursor: older.cursor,
        },
      ],
      nextCursor: [older.createdCursor, createdConversationId, older.id],
    });
    const partialResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1, cursor: first.nextCursor },
    );
    const partial = (await partialResponse.json()) as MessageSearchResponse;

    expect(partial.completeness).toBe("partial");
    expect(partial.partialReason).toBe("index_lagging");
    expect(partial.items.map(({ id }) => id)).toEqual([older.id]);
    expect(partial.nextCursor).toBe(first.nextCursor);
  });

  it("refuses zero or thirty-three lexical terms before Search RPC", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);

    for (const query of [
      "— !!!",
      Array.from({ length: 33 }, (_, index) => `term${index}`).join(" "),
    ]) {
      const response = await search(createdWorkspaceId, createdConversationId, {
        query,
      });
      expect(response.status).toBe(400);
    }
    expect(await searchCalls()).toEqual([]);

    const missingQuery = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
        },
        body: JSON.stringify({
          contract: "message.search@1",
          workspaceId: createdWorkspaceId,
          conversationId: createdConversationId,
          threadRootMessageId: null,
        }),
      },
    );
    expect(missingQuery.status).toBe(400);
    expect(await searchCalls()).toEqual([]);

    for (const omitted of ["cursor", "limit", "threadRootMessageId"] as const) {
      const exactBody = {
        contract: "message.search@1",
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        threadRootMessageId: null,
        query: "needle",
        cursor: null,
        limit: 50,
      };
      const { [omitted]: _, ...body } = exactBody;
      const response = await SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "__Host-punks_session=session-owner",
          },
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(400);
    }
    expect(await searchCalls()).toEqual([]);

    const queryStringResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search?query=needle`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(queryStringResponse.status).toBe(404);
    expect(await searchCalls()).toEqual([]);
  });

  it("authorizes the Workspace and Conversation before Search RPC", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);

    const response = await search(createdWorkspaceId, createdConversationId, {
      cookie: "__Host-punks_session=session-other",
    });

    expect(response.status).toBe(403);
    expect(await searchCalls()).toEqual([]);
  });

  it("fails closed on malformed Workspace, Conversation and vault RPC results", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const message = await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle must remain private",
    );
    await programCandidates([
      {
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      },
    ]);
    const conversation = env.CONVERSATIONS.getByName(createdConversationId);
    const originalWorkspaces = env.WORKSPACES;
    const originalMessageContent = env.MESSAGE_CONTENT;

    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      const instanceEnv = (instance as unknown as { env: ApiEnv }).env;
      instanceEnv.WORKSPACES = {
        getByName: () => ({
          authorize: async () => ({ ok: "false" }),
        }),
      } as unknown as ApiEnv["WORKSPACES"];
    });
    const malformedWorkspace = await search(
      createdWorkspaceId,
      createdConversationId,
    );
    const malformedWorkspaceText = await malformedWorkspace.text();
    expect(malformedWorkspace.status, malformedWorkspaceText).toBe(503);
    expect(malformedWorkspaceText).not.toContain("needle must remain private");
    expect(await searchCalls()).toEqual([]);
    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      (instance as unknown as { env: ApiEnv }).env.WORKSPACES =
        originalWorkspaces;
    });

    const malformedConversation = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages/search`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "__Host-punks_session=session-owner",
          },
          body: JSON.stringify({
            contract: "message.search@1",
            workspaceId: createdWorkspaceId,
            conversationId: createdConversationId,
            threadRootMessageId: null,
            query: "needle",
            cursor: null,
            limit: 50,
          }),
        },
      ),
      {
        AUTH_SERVICE: env.AUTH_SERVICE,
        CONVERSATIONS: {
          getByName: () => ({
            searchMessages: async () => ({
              ok: "false",
              responseJson: JSON.stringify({
                items: [{ content: "needle must remain private" }],
              }),
            }),
          }),
        },
      } as unknown as ApiEnv,
    );
    const malformedConversationText = await malformedConversation.text();
    expect(malformedConversation.status, malformedConversationText).toBe(503);
    expect(malformedConversationText).not.toContain(
      "needle must remain private",
    );
    expect(await searchCalls()).toEqual([]);

    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      const instanceEnv = (instance as unknown as { env: ApiEnv }).env;
      instanceEnv.MESSAGE_CONTENT = {
        getByName: () => ({
          readAuthorized: async () => ({
            ok: "false",
            payload: {
              schemaVersion: 1,
              content: "needle must remain private",
              topic: null,
            },
            contentCommitment: "0".repeat(64),
            version: 1,
          }),
        }),
      } as unknown as ApiEnv["MESSAGE_CONTENT"];
    });
    const malformedVault = await search(
      createdWorkspaceId,
      createdConversationId,
    );
    const malformedVaultText = await malformedVault.text();
    expect(malformedVault.status, malformedVaultText).toBe(503);
    expect(malformedVaultText).not.toContain("needle must remain private");
    expect(await searchCalls()).toHaveLength(1);
    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      (instance as unknown as { env: ApiEnv }).env.MESSAGE_CONTENT =
        originalMessageContent;
    });
  });

  it("binds continuation cursors to Punk, scope, query and limit", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const messages = [
      await post(
        createdWorkspaceId,
        createdConversationId,
        "837cff7f-b24a-4ccb-901c-c6fc55a01682",
        "needle first",
      ),
      await post(
        createdWorkspaceId,
        createdConversationId,
        "91b0eecd-a265-4f00-8a84-31bb86677a9a",
        "needle second",
      ),
      await post(
        createdWorkspaceId,
        createdConversationId,
        "d7d8aaec-e896-4c6a-8b18-46093e764783",
        "needle third",
      ),
    ];
    await programCandidates(
      messages.map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const firstResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1 },
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as MessageSearchResponse;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toMatch(
      /^msc1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u,
    );
    const cursor = first.nextCursor;
    if (cursor === null) {
      throw new Error("Expected a Message search cursor");
    }
    const callsAfterFirst = (await searchCalls()).length;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    const otherConversationId = await createConversation(
      createdWorkspaceId,
      "85fe5f26-463d-449d-b4c8-ec4dbddedcc1",
      "search-other",
    );
    const otherWorkspaceId = await createWorkspace(
      "74fddbf3-cee0-4141-bc1d-0283106e632b",
      "search-cursor-other-workspace",
    );
    const otherWorkspaceConversationId = await createConversation(
      otherWorkspaceId,
      "ff92d70c-2d8a-48f5-aa1d-fd0a01ed4e2a",
      "search-cursor-other",
    );
    await setOtherMember(createdWorkspaceId);
    const invalidResponses = await Promise.all([
      search(createdWorkspaceId, createdConversationId, {
        cursor: tampered,
        limit: 1,
      }),
      search(createdWorkspaceId, createdConversationId, {
        cursor,
        limit: 1,
        query: "different",
      }),
      search(createdWorkspaceId, createdConversationId, {
        cursor,
        limit: 2,
      }),
      search(createdWorkspaceId, createdConversationId, {
        cursor,
        limit: 1,
        threadRootMessageId: messages[0]?.id ?? null,
      }),
      search(createdWorkspaceId, otherConversationId, { cursor, limit: 1 }),
      search(otherWorkspaceId, otherWorkspaceConversationId, {
        cursor,
        limit: 1,
      }),
      search(createdWorkspaceId, createdConversationId, {
        cursor,
        limit: 1,
        cookie: "__Host-punks_session=session-other",
      }),
    ]);
    expect(invalidResponses.map(({ status }) => status)).toEqual([
      400, 400, 400, 400, 400, 400, 400,
    ]);
    expect(await searchCalls()).toHaveLength(callsAfterFirst);

    const secondResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { cursor, limit: 1 },
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as MessageSearchResponse;
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("fills past edited and retracted candidates using current plaintext", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const matching = await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle remains",
    );
    const editedCandidate = await post(
      createdWorkspaceId,
      createdConversationId,
      "91b0eecd-a265-4f00-8a84-31bb86677a9a",
      "needle before edit",
    );
    const retractedCandidate = await post(
      createdWorkspaceId,
      createdConversationId,
      "d7d8aaec-e896-4c6a-8b18-46093e764783",
      "needle before retract",
    );
    await edit(
      createdWorkspaceId,
      createdConversationId,
      editedCandidate,
      "current text does not match",
    );
    await retract(
      createdWorkspaceId,
      createdConversationId,
      retractedCandidate,
    );
    await programCandidates(
      [matching, editedCandidate, retractedCandidate].map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const response = await search(createdWorkspaceId, createdConversationId, {
      limit: 1,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as MessageSearchResponse;
    expect(body.items.map(({ id }) => id)).toEqual([matching.id]);
    expect(body.nextCursor).toBeNull();
  });

  it("keeps a current index complete across the bounded stale-candidate budget", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const messages: MessageView[] = [];
    for (let index = 1; index <= 5; index += 1) {
      const message = await post(
        createdWorkspaceId,
        createdConversationId,
        `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        `needle stale ${index}`,
      );
      messages.push(message);
      await retract(
        createdWorkspaceId,
        createdConversationId,
        message,
        `b0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      );
    }
    await programCandidates(
      messages.map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const firstResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1 },
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as MessageSearchResponse;
    expect(first.items).toEqual([]);
    expect(first.completeness).toBe("complete");
    expect(first.partialReason).toBeNull();
    expect(first.nextCursor).toMatch(/^msc1\./);

    const secondResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 1, cursor: first.nextCursor },
    );
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as MessageSearchResponse;
    expect(second.items).toEqual([]);
    expect(second.completeness).toBe("complete");
    expect(second.partialReason).toBeNull();
    expect(second.nextCursor).toBeNull();
  });

  it("types index failures as partial and still fails the whole page for vault failures", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const first = await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle first",
    );
    const second = await post(
      createdWorkspaceId,
      createdConversationId,
      "91b0eecd-a265-4f00-8a84-31bb86677a9a",
      "needle second",
    );
    const candidates = [first, second].map((message) => ({
      workspaceId: createdWorkspaceId,
      conversationId: createdConversationId,
      messageId: message.id,
      createdCursor: message.createdCursor,
      lastCursor: message.cursor,
    }));
    await programCandidates(candidates);

    await setSearchMode("unavailable");
    const unavailable = await search(createdWorkspaceId, createdConversationId);
    const unavailableText = await unavailable.text();
    expect(unavailable.status, unavailableText).toBe(200);
    expect(JSON.parse(unavailableText)).toMatchObject({
      completeness: "partial",
      partialReason: "index_unavailable",
      items: [],
    });
    expect(unavailableText).not.toMatch(
      /msc1\.|h2_|needle|contentKey|ciphertext/,
    );

    await setSearchMode("malformed");
    const malformed = await search(createdWorkspaceId, createdConversationId);
    const malformedText = await malformed.text();
    expect(malformed.status, malformedText).toBe(503);
    expect(malformedText).not.toMatch(
      /msc1\.|h2_|needle|contentKey|ciphertext/,
    );
    await setSearchMode("available");

    await setRawSearchResult({
      ok: true,
      candidates: [
        {
          messageId: first.id,
          conversationId: createdConversationId,
          createdCursor: first.createdCursor,
          lastCursor: first.cursor,
        },
        {
          messageId: second.id,
          conversationId: createdConversationId,
          createdCursor: second.createdCursor,
          lastCursor: second.cursor,
        },
      ],
      nextCursor: null,
    });
    expect(
      (await search(createdWorkspaceId, createdConversationId)).status,
    ).toBe(503);

    await setRawSearchResult({
      ok: true,
      candidates: [
        {
          messageId: first.id,
          conversationId: "11111111-1111-8111-8111-111111111111",
          createdCursor: first.createdCursor,
          lastCursor: first.cursor,
        },
      ],
      nextCursor: null,
    });
    expect(
      (await search(createdWorkspaceId, createdConversationId)).status,
    ).toBe(503);

    await setRawSearchResult({
      ok: true,
      candidates: [
        {
          messageId: first.id,
          conversationId: createdConversationId,
          createdCursor: first.createdCursor + 1,
          lastCursor: first.cursor + 1,
        },
      ],
      nextCursor: null,
    });
    expect(
      (await search(createdWorkspaceId, createdConversationId)).status,
    ).toBe(503);

    await setRawSearchResult(null);
    await programCandidates(candidates);
    await env.ERASURE_REGISTRY.fetch("https://fixture/__test/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lookup: "unavailable" }),
    });
    const vaultFailure = await search(
      createdWorkspaceId,
      createdConversationId,
    );
    const vaultFailureText = await vaultFailure.text();
    expect(vaultFailure.status, vaultFailureText).toBe(503);
    expect(vaultFailureText).not.toMatch(
      /msc1\.|h2_|needle|contentKey|ciphertext/,
    );
  });

  it("returns no items when Workspace access is revoked while Search is in flight", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    await setOtherMember(createdWorkspaceId);
    const message = await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle private result",
    );
    await programCandidates([
      {
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      },
    ]);
    await setSearchHold(true);

    const pending = search(createdWorkspaceId, createdConversationId, {
      cookie: "__Host-punks_session=session-other",
    });
    await expect.poll(searchHoldReached).toBe(true);
    await removeOtherMember(createdWorkspaceId);
    await setSearchHold(false);

    const response = await pending;
    const text = await response.text();
    expect(response.status, text).toBe(403);
    expect(text).not.toMatch(/items|needle|private result|content|topic/);
  });

  it("fails closed before Search when either secret is missing, short, or reused", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const validMaster =
      "message-search-test-key-000000000000000000000000000000000000";
    const validCursor =
      "message-search-cursor-test-key-000000000000000000000000000000";
    const variants: [unknown, unknown][] = [
      [undefined, validCursor],
      ["short", validCursor],
      [validMaster, validMaster],
    ];
    for (const [masterKey, cursorKey] of variants) {
      await overrideSearchSecrets(createdConversationId, masterKey, cursorKey);
      const response = await search(createdWorkspaceId, createdConversationId);
      expect(response.status).toBe(503);
    }
    expect(await searchCalls()).toEqual([]);
    await overrideSearchSecrets(
      createdConversationId,
      validMaster,
      validCursor,
    );
  });

  it("isolates candidates by Workspace even when query and command ids match", async () => {
    const firstWorkspaceId = await createWorkspace();
    const firstConversationId = await createConversation(firstWorkspaceId);
    const firstMessage = await post(
      firstWorkspaceId,
      firstConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle isolated",
    );
    const secondWorkspaceId = await createWorkspace(
      "6ce0167d-a44f-449d-98d8-63234402a7b2",
      "message-search-other",
    );
    const secondConversationId = await createConversation(
      secondWorkspaceId,
      "85fe5f26-463d-449d-b4c8-ec4dbddedcc1",
      "search-other-workspace",
    );
    await post(
      secondWorkspaceId,
      secondConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "needle second workspace",
    );
    await programCandidates([
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        messageId: firstMessage.id,
        createdCursor: firstMessage.createdCursor,
        lastCursor: firstMessage.cursor,
      },
    ]);

    const response = await search(secondWorkspaceId, secondConversationId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as MessageSearchResponse;
    expect(body.items).toEqual([]);
    expect(body.workspaceId).toBe(secondWorkspaceId);
    expect(body.conversationId).toBe(secondConversationId);
  });

  it("keeps the first UTF-8 candidate that does not fit for the next page", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(createdWorkspaceId);
    const messages: MessageView[] = [];
    for (let index = 1; index <= 19; index += 1) {
      messages.push(
        await post(
          createdWorkspaceId,
          createdConversationId,
          `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `${"é".repeat(29_000)} needle ${index}`,
        ),
      );
    }
    await programCandidates(
      messages.map((message) => ({
        workspaceId: createdWorkspaceId,
        conversationId: createdConversationId,
        messageId: message.id,
        createdCursor: message.createdCursor,
        lastCursor: message.cursor,
      })),
    );

    const firstResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 100 },
    );
    const firstText = await firstResponse.text();
    expect(firstResponse.status, firstText).toBe(200);
    expect(new TextEncoder().encode(firstText).byteLength).toBeLessThanOrEqual(
      1_048_576,
    );
    const first = JSON.parse(firstText) as MessageSearchResponse;
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(messages.length);
    expect(first.nextCursor).toMatch(/^msc1\./);

    const secondResponse = await search(
      createdWorkspaceId,
      createdConversationId,
      { limit: 100, cursor: first.nextCursor },
    );
    const secondText = await secondResponse.text();
    expect(secondResponse.status, secondText).toBe(200);
    expect(new TextEncoder().encode(secondText).byteLength).toBeLessThanOrEqual(
      1_048_576,
    );
    const second = JSON.parse(secondText) as MessageSearchResponse;
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      [...messages].reverse().map(({ id }) => id),
    );
  }, 15_000);
});
