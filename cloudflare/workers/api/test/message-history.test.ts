import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  MessageHistoryResponse,
  MessageView,
  PostMessageCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  buildMessageHistoryResponse,
  MESSAGE_HISTORY_MAX_RESPONSE_BYTES,
} from "../src/message-history";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const cursorKey = new TextEncoder().encode(
  "history-cursor-test-key-000000000000000000000000000000000000",
);
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

function view(
  createdCursor: number,
  content = `message-${createdCursor}`,
): MessageView {
  const timestamp = new Date(1_787_230_800_000 + createdCursor).toISOString();
  return {
    id: `00000000-0000-8000-8000-${String(createdCursor).padStart(12, "0")}`,
    workspaceId,
    conversationId,
    author: {
      kind: "punk",
      punkId: "00000000-0000-8000-8000-000000000001",
    },
    messageType: "stream-message",
    status: "active",
    content,
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: `00000000-0000-8000-8000-${String(createdCursor).padStart(12, "0")}`,
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
    createdCursor,
    cursor: createdCursor,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: null,
  };
}

describe("bounded Message history responses", () => {
  it("returns older traversal pages in ascending display order with a scoped cursor", async () => {
    const response = await buildMessageHistoryResponse({
      workspaceId,
      conversationId,
      highWaterCursor: 10,
      direction: "older",
      candidates: [view(10), view(9)],
      hasMoreAfterCandidates: true,
      cursorKey,
    });

    expect(response.items.map(({ createdCursor }) => createdCursor)).toEqual([
      9, 10,
    ]);
    expect(response.nextCursor).toMatch(/^mhc1\./);
    expect(
      validateContract(
        "punks://contracts/message.history-response@1",
        response,
      ),
    ).toEqual({ valid: true });
  });

  it("stops below one MiB and emits a cursor when authorized items remain", async () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      view(index + 1, "x".repeat(64 * 1_024 - 1_024)),
    );
    const response = await buildMessageHistoryResponse({
      workspaceId,
      conversationId,
      highWaterCursor: 20,
      direction: "newer",
      candidates,
      hasMoreAfterCandidates: false,
      cursorKey,
    });

    expect(response.items.length).toBeGreaterThan(0);
    expect(response.items.length).toBeLessThan(candidates.length);
    expect(response.nextCursor).toMatch(/^mhc1\./);
    expect(
      new TextEncoder().encode(JSON.stringify(response)).byteLength,
    ).toBeLessThanOrEqual(MESSAGE_HISTORY_MAX_RESPONSE_BYTES);
  });
});

async function createWorkspace(): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: "fb0ba386-5097-4ef1-95f5-0019b7af162d",
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: "message-history",
      name: "Message history",
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
  commandId: string,
  name: string,
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
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { conversation: { id: string } })
    .conversation.id;
}

async function post(
  createdWorkspaceId: string,
  createdConversationId: string,
  commandId: string,
  content: string,
): Promise<void> {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId,
    workspaceId: createdWorkspaceId,
    conversationId: createdConversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content,
      topic: null,
      replyToMessageId: null,
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
  expect(response.status).toBe(201);
}

describe("Message history API", () => {
  it("paginates a frozen creation high-water without duplicates or storage secrets", async () => {
    const createdWorkspaceId = await createWorkspace();
    const createdConversationId = await createConversation(
      createdWorkspaceId,
      "12daac9b-2f58-456f-958d-660bf110cd06",
      "history-main",
    );
    await post(
      createdWorkspaceId,
      createdConversationId,
      "837cff7f-b24a-4ccb-901c-c6fc55a01682",
      "first",
    );
    await post(
      createdWorkspaceId,
      createdConversationId,
      "91b0eecd-a265-4f00-8a84-31bb86677a9a",
      "second",
    );
    await post(
      createdWorkspaceId,
      createdConversationId,
      "d7d8aaec-e896-4c6a-8b18-46093e764783",
      "third",
    );

    const firstPageResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages?limit=2&direction=older`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    const firstText = await firstPageResponse.text();
    expect(firstPageResponse.status, firstText).toBe(200);
    const firstPage = JSON.parse(firstText) as MessageHistoryResponse;
    expect(firstPage.items.map(({ content }) => content)).toEqual([
      "second",
      "third",
    ]);
    expect(firstPage.items.map(({ createdCursor }) => createdCursor)).toEqual([
      3, 4,
    ]);
    expect(firstPage.highWaterCursor).toBe(4);
    expect(firstPage.nextCursor).toMatch(/^mhc1\./);
    expect(
      validateContract(
        "punks://contracts/message.history-response@1",
        firstPage,
      ),
    ).toEqual({ valid: true });
    expect(firstText).not.toMatch(
      /ciphertextRef|contentKeyId|contentCommitment|originalContentCommitment|pubkey|sig|event/,
    );

    await post(
      createdWorkspaceId,
      createdConversationId,
      "d0add743-9407-4b70-89fe-624c7715d648",
      "after-high-water",
    );
    const nextPageResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${createdConversationId}/messages?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(nextPageResponse.status).toBe(200);
    const nextPage = (await nextPageResponse.json()) as MessageHistoryResponse;
    expect(nextPage.highWaterCursor).toBe(4);
    expect(nextPage.items.map(({ content }) => content)).toEqual(["first"]);
    expect(nextPage.nextCursor).toBeNull();

    const otherConversationId = await createConversation(
      createdWorkspaceId,
      "85fe5f26-463d-449d-b4c8-ec4dbddedcc1",
      "history-other",
    );
    const crossScope = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${createdWorkspaceId}/conversations/${otherConversationId}/messages?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(crossScope.status).toBe(400);
  });
});
