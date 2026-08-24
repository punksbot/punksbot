import type {
  AddMessageReactionCommand,
  ArchiveConversationCommand,
  ConversationFollowServerFrame,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  MessageView,
  PostMessageCommand,
  RemoveMessageReactionCommand,
  RemoveWorkspaceMemberCommand,
  RestoreMessageCommand,
  RetractMessageCommand,
  SetWorkspaceMemberRoleCommand,
  ToggleMessageReactionCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { ConversationDO } from "../src/conversation-do";
import type { ApiEnv } from "../src/env";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

async function createWorkspace(commandId: string, slug: string) {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { slug, name: "Follow tests", visibility: "private" },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { workspace: { id: string } }).workspace
    .id;
}

async function createConversation(workspaceId: string, commandId: string) {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      name: "realtime",
      type: "stream",
      visibility: "open",
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
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

async function setOtherMember(
  workspaceId: string,
  commandId: string,
  present: boolean,
) {
  const command: SetWorkspaceMemberRoleCommand | RemoveWorkspaceMemberCommand =
    present
      ? {
          contract: "workspace.member-set-role@1",
          commandId,
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { targetPunkId: otherPunkId, role: "member" },
        }
      : {
          contract: "workspace.member-remove@1",
          commandId,
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { targetPunkId: otherPunkId },
        };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: present ? "PUT" : "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function archiveConversation(
  workspaceId: string,
  conversationId: string,
  commandId: string,
) {
  const command: ArchiveConversationCommand = {
    contract: "conversation.archive@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { cause: "manual" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/archive`,
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
  expect(response.status).toBe(200);
}

async function rejectJournalArchiveAttestation(reject: boolean): Promise<void> {
  const response = await env.ATTESTATION.fetch(
    "https://fixture/__test/archive-failure",
    {
      method: "POST",
      body: JSON.stringify({ reject }),
    },
  );
  expect(response.ok).toBe(true);
}

async function retractMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  commandId: string,
): Promise<MessageView> {
  const command: RetractMessageCommand = {
    contract: "message.retract@1",
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { reasonCode: "author-request", publicReason: "Retiré" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/retract`,
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
  expect(response.status).toBe(200);
  return ((await response.json()) as { message: MessageView }).message;
}

async function restoreMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  commandId: string,
): Promise<MessageView> {
  const command: RestoreMessageCommand = {
    contract: "message.restore@1",
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {},
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/restore`,
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
  expect(response.status).toBe(200);
  return ((await response.json()) as { message: MessageView }).message;
}

function frameQueue(socket: WebSocket) {
  const frames: ConversationFollowServerFrame[] = [];
  const waiters: Array<{
    resolve: (frame: ConversationFollowServerFrame) => void;
    reject: (error: unknown) => void;
  }> = [];
  socket.addEventListener("message", (event) => {
    try {
      const frame: unknown = JSON.parse(String(event.data));
      expect(
        validateContract(
          "punks://contracts/conversation.follow-server-frame@1",
          frame,
        ).valid,
      ).toBe(true);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        frames.push(frame as ConversationFollowServerFrame);
      } else {
        waiter.resolve(frame as ConversationFollowServerFrame);
      }
    } catch (error) {
      waiters.shift()?.reject(error);
    }
  });
  return {
    next(): Promise<ConversationFollowServerFrame> {
      const frame = frames.shift();
      return frame === undefined
        ? new Promise((resolve, reject) => waiters.push({ resolve, reject }))
        : Promise.resolve(frame);
    },
  };
}

async function postMessage(
  workspaceId: string,
  conversationId: string,
  commandId: string,
): Promise<MessageView> {
  const command = postCommand(workspaceId, conversationId, commandId);
  const response = await postMessageRequest(command);
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: MessageView }).message;
}

function postCommand(
  workspaceId: string,
  conversationId: string,
  commandId: string,
): PostMessageCommand {
  return {
    contract: "message.post@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content: "Contenu temps réel autorisé",
      topic: "Sujet live",
      replyToMessageId: null,
      broadcast: false,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
}

function postMessageRequest(command: PostMessageCommand): Promise<Response> {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${command.workspaceId}/conversations/${command.conversationId}/messages`,
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
}

async function follow(
  workspaceId: string,
  conversationId: string,
  afterCursor = 0,
  session = "session-owner",
) {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/follow?afterCursor=${afterCursor}`,
    {
      headers: {
        cookie: `__Host-punks_session=${session}`,
        origin: "https://punks.bot",
        upgrade: "websocket",
        "sec-websocket-protocol": "punks.follow.v1",
      },
    },
  );
}

async function addReaction(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  commandId: string,
  session = "session-owner",
  reaction = "🔥",
): Promise<void> {
  const punkId = session === "session-other" ? otherPunkId : ownerPunkId;
  const command: AddMessageReactionCommand = {
    contract: "message.reaction-add@1",
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/reactions/add`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
}

async function mutateExistingReaction(
  operation: "remove" | "toggle",
  workspaceId: string,
  conversationId: string,
  messageId: string,
  commandId: string,
  reaction = "🔥",
  session = "session-owner",
): Promise<void> {
  const punkId = session === "session-other" ? otherPunkId : ownerPunkId;
  const command: RemoveMessageReactionCommand | ToggleMessageReactionCommand =
    operation === "remove"
      ? {
          contract: "message.reaction-remove@1",
          commandId,
          workspaceId,
          conversationId,
          messageId,
          actor: { kind: "punk", punkId },
          payload: { reaction },
        }
      : {
          contract: "message.reaction-toggle@1",
          commandId,
          workspaceId,
          conversationId,
          messageId,
          actor: { kind: "punk", punkId },
          payload: { reaction },
        };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/reactions/${operation}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
}

describe("Punks Conversation follow WebSocket", () => {
  it("fails closed when the Workspace binding returns malformed authorization", async () => {
    const workspaceId = await createWorkspace(
      "a57ce3da-5a77-44a3-836c-715823e58d07",
      "follow-malformed-workspace",
    );
    const conversationId = await createConversation(
      workspaceId,
      "63c6e521-8fd3-4c7e-9325-dafc692f7629",
    );
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    const originalWorkspaces = env.WORKSPACES;
    await runInDurableObject(conversation, (instance: ConversationDO) => {
      (instance as unknown as { env: ApiEnv }).env.WORKSPACES = {
        getByName: () => ({
          authorize: async () => ({
            ok: "false",
            role: "owner",
            workspaceCursor: 1,
            visibility: "private",
          }),
        }),
      } as unknown as ApiEnv["WORKSPACES"];
    });
    try {
      const response = await follow(workspaceId, conversationId);
      expect(response.status).toBe(403);
      expect(response.webSocket).toBeNull();
    } finally {
      await runInDurableObject(conversation, (instance: ConversationDO) => {
        (instance as unknown as { env: ApiEnv }).env.WORKSPACES =
          originalWorkspaces;
      });
    }
  });

  it("delivers an absolute Reaction patch before its cursor can be acknowledged", async () => {
    const workspaceId = await createWorkspace(
      "807e0fa8-5465-49fd-8650-b9fe6c187019",
      "follow-reaction-patch",
    );
    const conversationId = await createConversation(
      workspaceId,
      "e4d3b056-1227-4504-9716-b8f466e4801a",
    );
    const message = await postMessage(
      workspaceId,
      conversationId,
      "71791f2a-873c-4f62-8ee5-d56dc68ec806",
    );
    await addReaction(
      workspaceId,
      conversationId,
      message.id,
      "471a5f8f-313a-454e-9962-ab86fc72037c",
    );

    const response = await follow(workspaceId, conversationId, message.cursor);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toMatchObject({
      type: "accepted",
      resumeAfterCursor: message.cursor,
      targetHighWaterCursor: message.cursor + 1,
    });
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: message.cursor,
      throughCursor: message.cursor + 1,
      messages: [],
      threadPatches: [],
      reactionPatches: [
        {
          messageId: message.id,
          reaction: "🔥",
          count: 1,
          reactedByPunk: true,
          cursor: message.cursor + 1,
        },
      ],
      reactionCollectionPatches: [],
    });
    socket.close(1000, "test complete");
  });

  it("personalizes absolute Reaction updates and resumes after ACK/reconnect", async () => {
    const workspaceId = await createWorkspace(
      "594c1848-acdb-4012-b18a-a5e959000e70",
      "follow-reaction-coalesce",
    );
    await setOtherMember(
      workspaceId,
      "ef9343e4-96d3-4b65-b226-d8ccdd24bb4c",
      true,
    );
    const conversationId = await createConversation(
      workspaceId,
      "46526f72-e94b-44a5-96cf-1a81ff5dc2f0",
    );
    const message = await postMessage(
      workspaceId,
      conversationId,
      "e97f1ce0-a3b5-44a7-8dbc-3f3ef6f2533a",
    );
    const response = await follow(workspaceId, conversationId, message.cursor);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await expect(frames.next()).resolves.toMatchObject({ type: "ready" });
    const otherResponse = await follow(
      workspaceId,
      conversationId,
      message.cursor,
      "session-other",
    );
    const otherSocket = otherResponse.webSocket;
    expect(otherSocket).not.toBeNull();
    if (otherSocket === null) {
      return;
    }
    const otherFrames = frameQueue(otherSocket);
    otherSocket.accept();
    await otherFrames.next();
    await expect(otherFrames.next()).resolves.toMatchObject({ type: "ready" });

    const expectPatch = async (
      queue: ReturnType<typeof frameQueue>,
      cursor: number,
      count: number,
      reactedByPunk: boolean,
    ) => {
      await expect(queue.next()).resolves.toMatchObject({
        type: "changes",
        throughCursor: cursor,
        reactionPatches: [
          {
            messageId: message.id,
            reaction: "🔥",
            count,
            reactedByPunk,
            cursor,
          },
        ],
      });
    };
    const acknowledge = (target: WebSocket, cursor: number) => {
      target.send(
        JSON.stringify({
          schemaVersion: 1,
          type: "ack",
          throughCursor: cursor,
        }),
      );
    };

    await addReaction(
      workspaceId,
      conversationId,
      message.id,
      "55948fe1-6618-45f7-b033-d96fb509ad28",
    );
    await Promise.all([
      expectPatch(frames, message.cursor + 1, 1, true),
      expectPatch(otherFrames, message.cursor + 1, 1, false),
    ]);
    acknowledge(socket, message.cursor + 1);
    acknowledge(otherSocket, message.cursor + 1);

    await addReaction(
      workspaceId,
      conversationId,
      message.id,
      "0e49817a-bb2b-4642-ad2b-1bc5c8853918",
      "session-other",
    );
    await Promise.all([
      expectPatch(frames, message.cursor + 2, 2, true),
      expectPatch(otherFrames, message.cursor + 2, 2, true),
    ]);
    acknowledge(socket, message.cursor + 2);
    acknowledge(otherSocket, message.cursor + 2);

    await mutateExistingReaction(
      "remove",
      workspaceId,
      conversationId,
      message.id,
      "2e81da3f-b82d-497f-959e-7c12c1df1791",
    );
    await Promise.all([
      expectPatch(frames, message.cursor + 3, 1, false),
      expectPatch(otherFrames, message.cursor + 3, 1, true),
    ]);
    acknowledge(socket, message.cursor + 3);
    acknowledge(otherSocket, message.cursor + 3);

    await mutateExistingReaction(
      "toggle",
      workspaceId,
      conversationId,
      message.id,
      "423c69b2-f0c9-4842-ad7c-a720fe3cc213",
    );
    await Promise.all([
      expectPatch(frames, message.cursor + 4, 2, true),
      expectPatch(otherFrames, message.cursor + 4, 2, true),
    ]);
    socket.close(1000, "owner caught up");
    otherSocket.close(1000, "other caught up");

    const resumedResponse = await follow(
      workspaceId,
      conversationId,
      message.cursor + 3,
    );
    const resumedSocket = resumedResponse.webSocket;
    expect(resumedSocket).not.toBeNull();
    if (resumedSocket === null) {
      return;
    }
    const resumedFrames = frameQueue(resumedSocket);
    resumedSocket.accept();
    await resumedFrames.next();
    await expect(resumedFrames.next()).resolves.toMatchObject({
      type: "changes",
      fromExclusiveCursor: message.cursor + 3,
      throughCursor: message.cursor + 4,
      reactionPatches: [
        {
          messageId: message.id,
          reaction: "🔥",
          count: 2,
          reactedByPunk: true,
          cursor: message.cursor + 4,
        },
      ],
    });
    resumedSocket.send(
      JSON.stringify({
        schemaVersion: 1,
        type: "ack",
        throughCursor: message.cursor + 4,
      }),
    );
    await expect(resumedFrames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: message.cursor + 4,
    });
    resumedSocket.close(1000, "test complete");
  });

  it("keeps a popular Reaction rosterless and does not consume its newest cursor silently", async () => {
    const workspaceId = await createWorkspace(
      "54a6701e-7f67-4dac-a5e7-6629587ff3bf",
      "follow-popular-reaction",
    );
    const conversationId = await createConversation(
      workspaceId,
      "76d1ef8d-8753-4c40-94ea-cb2c13711631",
    );
    const message = await postMessage(
      workspaceId,
      conversationId,
      "a847b47d-9bd4-4ba9-b0a6-e25c54622f7a",
    );
    const response = await follow(workspaceId, conversationId, message.cursor);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await expect(frames.next()).resolves.toMatchObject({ type: "ready" });

    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversation, (instance, state) => {
      const current = JSON.parse(
        state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM conversation_state WHERE singleton = 1",
          )
          .one().state_json,
      ) as { cursor: number; revision: number; updatedAt: string };
      const reactedAt = new Date().toISOString();
      for (let index = 1; index <= 101; index += 1) {
        const cursor = message.cursor + index;
        const reactionId = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const actorId = `20000000-0000-8000-8000-${String(index).padStart(12, "0")}`;
        state.storage.sql.exec(
          `INSERT INTO message_reactions
            (reaction_id, workspace_id, conversation_id, message_id,
             actor_kind, actor_id, reaction, status, revision, created_cursor,
             cursor, created_at, reacted_at, updated_at, removed_at)
           VALUES (?, ?, ?, ?, 'punk', ?, '🔥', 'active', 1, ?, ?, ?, ?, ?, NULL)`,
          reactionId,
          workspaceId,
          conversationId,
          message.id,
          actorId,
          cursor,
          cursor,
          reactedAt,
          reactedAt,
          reactedAt,
        );
        state.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, 50210, ?, ?)`,
          cursor,
          cursor.toString(16).padStart(64, "0"),
          JSON.stringify({
            id: cursor.toString(16).padStart(64, "0"),
            pubkey: "0".repeat(64),
            sig: "0".repeat(128),
            created_at: Math.floor(Date.now() / 1_000),
            kind: 50210,
            tags: [
              ["message", message.id],
              ["reaction_entity", reactionId],
            ],
            content: "",
          }),
          reactedAt,
        );
      }
      state.storage.sql.exec(
        `INSERT INTO message_reaction_counts
          (message_id, reaction, active_count, last_cursor)
         VALUES (?, '🔥', 101, ?)`,
        message.id,
        message.cursor + 101,
      );
      current.cursor = message.cursor + 101;
      current.revision += 101;
      current.updatedAt = reactedAt;
      state.storage.sql.exec(
        "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(current),
      );
      const plan = state.storage.sql
        .exec<{ detail: string }>(
          `EXPLAIN QUERY PLAN SELECT EXISTS(
             SELECT 1 FROM message_reactions
             WHERE workspace_id = ? AND conversation_id = ?
               AND message_id = ? AND reaction = ? AND actor_kind = 'punk'
               AND actor_id = ? AND status = 'active'
           )`,
          workspaceId,
          conversationId,
          message.id,
          "🔥",
          ownerPunkId,
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(plan).toMatch(/SEARCH message_reactions USING INDEX/u);
      expect(plan).not.toMatch(/SCAN message_reactions/u);
      (
        instance as unknown as {
          wakeFollowers(): void;
        }
      ).wakeFollowers();
    });

    const superseded = await frames.next();
    expect(superseded).toMatchObject({
      type: "changes",
      fromExclusiveCursor: message.cursor,
      throughCursor: message.cursor + 100,
      reactionPatches: [],
    });
    expect(JSON.stringify(superseded)).not.toMatch(/actorId|punkId|roster/u);
    socket.send(
      JSON.stringify({
        schemaVersion: 1,
        type: "ack",
        throughCursor: message.cursor + 100,
      }),
    );
    const current = await frames.next();
    expect(current).toMatchObject({
      type: "changes",
      fromExclusiveCursor: message.cursor + 100,
      throughCursor: message.cursor + 101,
      reactionPatches: [
        {
          messageId: message.id,
          reaction: "🔥",
          count: 101,
          reactedByPunk: false,
          cursor: message.cursor + 101,
        },
      ],
    });
    expect(JSON.stringify(current)).not.toMatch(/actorId|punkId|roster/u);
    socket.close(1000, "test complete");
  });

  it("drops a superseded Reaction patch after final auth and delivers its newer cursor next", async () => {
    const workspaceId = await createWorkspace(
      "00956e99-aa33-4e7b-8277-995615623dde",
      "follow-reaction-race",
    );
    const conversationId = await createConversation(
      workspaceId,
      "22e5cfe7-9260-4320-b75a-6a195017efbb",
    );
    const authControl = env.AUTH_SERVICE as unknown as {
      holdSessionResolution(
        sessionId: string,
        callNumber: number,
      ): Promise<void>;
      sessionResolutionHoldReached(sessionId: string): Promise<boolean>;
      releaseSessionResolution(sessionId: string): Promise<void>;
    };
    const ownerSessionId = "11111111-1111-8111-8111-111111111111";
    try {
      const message = await postMessage(
        workspaceId,
        conversationId,
        "9a694188-c8ca-4475-a0e2-290f77a50f5a",
      );
      await runDurableObjectAlarm(env.CONVERSATIONS.getByName(conversationId));
      await rejectJournalArchiveAttestation(true);
      await addReaction(
        workspaceId,
        conversationId,
        message.id,
        "564018aa-5c85-4640-997a-3c7e5e72d136",
      );
      await authControl.holdSessionResolution(ownerSessionId, 3);

      const response = await follow(
        workspaceId,
        conversationId,
        message.cursor,
      );
      const socket = response.webSocket;
      expect(socket).not.toBeNull();
      if (socket === null) {
        return;
      }
      const frames = frameQueue(socket);
      socket.accept();
      await expect(frames.next()).resolves.toMatchObject({ type: "accepted" });
      await expect
        .poll(() => authControl.sessionResolutionHoldReached(ownerSessionId))
        .toBe(true);
      await mutateExistingReaction(
        "remove",
        workspaceId,
        conversationId,
        message.id,
        "09056531-b284-4d67-aa17-06da19392558",
      );
      await authControl.releaseSessionResolution(ownerSessionId);

      await expect(frames.next()).resolves.toMatchObject({
        type: "changes",
        fromExclusiveCursor: message.cursor,
        throughCursor: message.cursor + 1,
        reactionPatches: [],
      });
      socket.send(
        JSON.stringify({
          schemaVersion: 1,
          type: "ack",
          throughCursor: message.cursor + 1,
        }),
      );
      await expect(frames.next()).resolves.toEqual({
        schemaVersion: 1,
        type: "ready",
        highWaterCursor: message.cursor + 1,
      });
      await expect(frames.next()).resolves.toMatchObject({
        type: "changes",
        fromExclusiveCursor: message.cursor + 1,
        throughCursor: message.cursor + 2,
        reactionPatches: [
          {
            messageId: message.id,
            reaction: "🔥",
            count: 0,
            reactedByPunk: false,
            cursor: message.cursor + 2,
          },
        ],
      });
      socket.close(1000, "test complete");
    } finally {
      await authControl.releaseSessionResolution(ownerSessionId);
      await rejectJournalArchiveAttestation(false);
    }
  });

  it("rejects unauthenticated, cross-origin, wrong-protocol and unbounded handshakes", async () => {
    const workspaceId = "00000000-0000-8000-8000-000000000010";
    const conversationId = "00000000-0000-8000-8000-000000000011";
    const url = `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/follow?afterCursor=0`;
    const baseHeaders = {
      origin: "https://punks.bot",
      upgrade: "websocket",
      "sec-websocket-protocol": "punks.follow.v1",
    };
    const unauthenticated = await SELF.fetch(url, { headers: baseHeaders });
    expect(unauthenticated.status).toBe(401);

    const crossOrigin = await SELF.fetch(url, {
      headers: {
        ...baseHeaders,
        cookie: "__Host-punks_session=session-owner",
        origin: "https://attacker.example",
      },
    });
    expect(crossOrigin.status).toBe(403);

    const wrongProtocol = await SELF.fetch(url, {
      headers: {
        ...baseHeaders,
        cookie: "__Host-punks_session=session-owner",
        "sec-websocket-protocol": "punks.follow.v1, other",
      },
    });
    expect(wrongProtocol.status).toBe(426);

    const unbounded = await SELF.fetch(
      url.replace("afterCursor=0", "afterCursor=9007199254740992"),
      {
        headers: {
          ...baseHeaders,
          cookie: "__Host-punks_session=session-owner",
        },
      },
    );
    expect(unbounded.status).toBe(400);
  });

  it("accepts an authenticated same-origin Punk with the exact protocol", async () => {
    const workspaceId = await createWorkspace(
      "d695d3c4-f1b4-4a69-977d-75ce50f8cab1",
      "follow-handshake",
    );
    const conversationId = await createConversation(
      workspaceId,
      "a5c5413e-2905-46c4-9034-8012569ae391",
    );

    const response = await follow(workspaceId, conversationId);

    expect(response.status).toBe(101);
    expect(response.headers.get("sec-websocket-protocol")).toBe(
      "punks.follow.v1",
    );
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "accepted",
      resumeAfterCursor: 0,
      targetHighWaterCursor: 1,
    });
    socket.close(1000, "test complete");
  });

  it("delivers authorized Message views through changes then becomes ready after ACK", async () => {
    const workspaceId = await createWorkspace(
      "6f68ec3b-75c0-4eb8-b23c-9566128fb159",
      "follow-message",
    );
    const conversationId = await createConversation(
      workspaceId,
      "b6f96a4f-7112-41b3-97db-72eb8100f084",
    );
    const message = await postMessage(
      workspaceId,
      conversationId,
      "cc08a33c-8f16-4e4a-9272-9e0c9248b084",
    );

    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toMatchObject({
      type: "accepted",
      targetHighWaterCursor: 2,
    });
    const changes = await frames.next();
    expect(changes).toEqual({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 0,
      throughCursor: 2,
      messages: [message],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [
        {
          messageId: message.id,
          visibility: "visible",
          cursor: 2,
          refreshRequired: false,
        },
      ],
    });
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 2 }),
    );
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 2,
    });
    socket.close(1000, "test complete");
  });

  it("never advances past unfinished content and wakes the follower after finalization", async () => {
    const workspaceId = await createWorkspace(
      "9a5ff38f-6e9d-45dd-9881-a3aec5e48706",
      "follow-finalization-barrier",
    );
    const conversationId = await createConversation(
      workspaceId,
      "e0451962-1ddd-4261-a5bf-0a91448fd327",
    );
    const command = postCommand(
      workspaceId,
      conversationId,
      "ae14f42a-8762-4e2e-bd7b-c2fbaddf3f18",
    );

    const keysBefore = new Set(
      (await env.CONTENT_BUCKET.list()).objects.map((object) => object.key),
    );
    const posting = postMessageRequest(command);
    let stagedKey = "";
    await expect
      .poll(async () => {
        const listed = await env.CONTENT_BUCKET.list();
        stagedKey =
          listed.objects.find((object) => !keysBefore.has(object.key))?.key ??
          "";
        return stagedKey.length > 0;
      })
      .toBe(true);
    const staged = await env.CONTENT_BUCKET.get(stagedKey);
    expect(staged).not.toBeNull();
    if (staged === null) {
      return;
    }
    const ciphertext = await staged.arrayBuffer();
    await env.CONTENT_BUCKET.delete(stagedKey);
    const failed = await posting;
    expect(failed.status).toBe(503);

    const invisibleResume = await follow(workspaceId, conversationId, 2);
    expect(invisibleResume.status).toBe(409);
    expect(invisibleResume.webSocket).toBeNull();

    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toMatchObject({
      type: "accepted",
      targetHighWaterCursor: 1,
    });
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 0,
      throughCursor: 1,
      messages: [],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [],
    });
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 1 }),
    );
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 1,
    });

    await env.CONTENT_BUCKET.put(stagedKey, ciphertext);
    const replay = await postMessageRequest(command);
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as { message: MessageView };
    const changes = await frames.next();
    expect(changes).toMatchObject({
      type: "changes",
      fromExclusiveCursor: 1,
      throughCursor: 2,
      messages: [replayed.message],
      threadPatches: [],
    });
    const serialized = JSON.stringify(changes);
    for (const forbidden of [
      "ciphertext",
      "contentKey",
      "commitment",
      "search",
      "outbox",
      "nostr",
      "event_json",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    socket.close(1000, "test complete");
  });

  it("revalidates synchronously after final auth so a concurrent tombstone wins", async () => {
    const workspaceId = await createWorkspace(
      "7ddba0bd-9fab-470f-8011-e417883fb06c",
      "follow-final-auth-race",
    );
    const conversationId = await createConversation(
      workspaceId,
      "447eeb0e-4728-418a-bdb8-d75152820e5b",
    );
    const authControl = env.AUTH_SERVICE as unknown as {
      holdSessionResolution(
        sessionId: string,
        callNumber: number,
      ): Promise<void>;
      sessionResolutionHoldReached(sessionId: string): Promise<boolean>;
      releaseSessionResolution(sessionId: string): Promise<void>;
    };
    const ownerSessionId = "11111111-1111-8111-8111-111111111111";
    try {
      const active = await postMessage(
        workspaceId,
        conversationId,
        "ba4adb8d-d1e4-43f7-b070-8e242397823b",
      );
      await runDurableObjectAlarm(env.CONVERSATIONS.getByName(conversationId));
      await rejectJournalArchiveAttestation(true);
      await authControl.holdSessionResolution(ownerSessionId, 4);

      const response = await follow(workspaceId, conversationId, 1);
      const socket = response.webSocket;
      expect(socket).not.toBeNull();
      if (socket === null) {
        return;
      }
      const frames = frameQueue(socket);
      socket.accept();
      await expect(frames.next()).resolves.toMatchObject({ type: "accepted" });
      await expect
        .poll(() => authControl.sessionResolutionHoldReached(ownerSessionId))
        .toBe(true);
      const interleaved = await postMessage(
        workspaceId,
        conversationId,
        "65346378-79a6-459c-a12e-6312ead8df6c",
      );
      const tombstone = await retractMessage(
        workspaceId,
        conversationId,
        active.id,
        "87576bbc-6b9a-44af-b46b-a1ec67152a7e",
      );
      await authControl.releaseSessionResolution(ownerSessionId);

      const racedBatch = await frames.next();
      expect(racedBatch).toEqual({
        schemaVersion: 1,
        type: "changes",
        fromExclusiveCursor: 1,
        throughCursor: 2,
        messages: [],
        threadPatches: [],
        reactionPatches: [],
        reactionCollectionPatches: [],
      });
      expect(JSON.stringify(racedBatch)).not.toContain(active.content);
      socket.send(
        JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 2 }),
      );
      await expect(frames.next()).resolves.toEqual({
        schemaVersion: 1,
        type: "ready",
        highWaterCursor: 2,
      });
      const interleavedBatch = await frames.next();
      expect(interleavedBatch).toMatchObject({
        type: "changes",
        fromExclusiveCursor: 2,
        throughCursor: 3,
        messages: [interleaved],
      });
      if (interleavedBatch.type === "changes") {
        expect(
          interleavedBatch.messages.every(
            (message) => message.cursor <= interleavedBatch.throughCursor,
          ),
        ).toBe(true);
        expect(
          interleavedBatch.threadPatches.every(
            (patch) => patch.cursor <= interleavedBatch.throughCursor,
          ),
        ).toBe(true);
      }
      socket.send(
        JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 3 }),
      );
      await expect(frames.next()).resolves.toMatchObject({
        type: "changes",
        fromExclusiveCursor: 3,
        throughCursor: 4,
        messages: [tombstone],
      });
      socket.close(1000, "test complete");
    } finally {
      await authControl.releaseSessionResolution(ownerSessionId);
      await rejectJournalArchiveAttestation(false);
    }
  });

  it("resumes the same logical delivery after Durable Object hibernation", async () => {
    const workspaceId = await createWorkspace(
      "5f85456a-f8df-424a-be35-0935f2da9a9a",
      "follow-hibernation",
    );
    const conversationId = await createConversation(
      workspaceId,
      "2d3659b2-c76a-44d1-b89e-c03db8b54640",
    );
    const message = await postMessage(
      workspaceId,
      conversationId,
      "97b8d6dd-a805-4c6b-b734-bbe7a1ce7b5e",
    );
    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await expect(frames.next()).resolves.toMatchObject({
      type: "changes",
      throughCursor: 2,
      messages: [message],
    });

    await evictDurableObject(env.CONVERSATIONS.getByName(conversationId));
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 2 }),
    );

    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 2,
    });
    socket.close(1000, "test complete");
  });

  it("recovers a persisted pumping phase after Durable Object eviction", async () => {
    const workspaceId = await createWorkspace(
      "ab2f2819-35c2-44d8-833e-a8a9fde896cc",
      "follow-pump-eviction",
    );
    const conversationId = await createConversation(
      workspaceId,
      "2ddeef34-b760-4e77-b9ad-4a1b026758a5",
    );
    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toMatchObject({
      type: "accepted",
      targetHighWaterCursor: 1,
    });
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 0,
      throughCursor: 1,
      messages: [],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [],
    });
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 1 }),
    );
    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 1,
    });

    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversation, async (_instance, state) => {
      const server = state.getWebSockets()[0];
      expect(server).toBeDefined();
      if (server === undefined) {
        return;
      }
      const attachment = server.deserializeAttachment() as Record<
        string,
        unknown
      >;
      expect(attachment.phase).toBe("live");
      server.serializeAttachment({
        ...attachment,
        phase: "pumping-live",
        pumpDeadlineAt: Date.now() + 30_000,
      });
      await state.storage.setAlarm(Date.now() + 30_000);
    });
    const message = await postMessage(
      workspaceId,
      conversationId,
      "9f345d65-a21c-430f-b16d-b388eb249b81",
    );
    await evictDurableObject(conversation);
    await runInDurableObject(conversation, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(conversation);
    await expect(runDurableObjectAlarm(conversation)).resolves.toBe(true);

    const recovered = await Promise.race([
      frames.next(),
      scheduler.wait(750).then(() => null),
    ]);
    expect(recovered).toMatchObject({
      type: "changes",
      fromExclusiveCursor: 1,
      throughCursor: 2,
      messages: [message],
    });
    socket.close(1000, "test complete");
  });

  it("revalidates Workspace membership before continuing an acknowledged stream", async () => {
    const workspaceId = await createWorkspace(
      "2f20ed21-e799-4254-82ec-b13c3ac6a074",
      "follow-revocation",
    );
    await setOtherMember(
      workspaceId,
      "09443f09-8745-4593-a385-e156a6d4c2ec",
      true,
    );
    const conversationId = await createConversation(
      workspaceId,
      "f83f1cc3-fe84-4388-b606-a7543e5a2c9c",
    );
    await postMessage(
      workspaceId,
      conversationId,
      "5ee5e09f-da59-4e26-8ea7-cd710935b980",
    );
    const response = await follow(
      workspaceId,
      conversationId,
      0,
      "session-other",
    );
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await expect(frames.next()).resolves.toMatchObject({
      type: "changes",
      throughCursor: 2,
    });
    await setOtherMember(
      workspaceId,
      "40bd23d7-d4c9-483e-9627-a655b792344d",
      false,
    );
    const closed = nextClose(socket);
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 2 }),
    );
    await expect(closed).resolves.toMatchObject({ code: 1008 });
  });

  it("revalidates the durable session id before every delivery", async () => {
    const workspaceId = await createWorkspace(
      "9cc4a932-b09d-4bc4-b297-c6874275c64d",
      "follow-session-revocation",
    );
    await setOtherMember(
      workspaceId,
      "5b59f844-85d0-49ec-a310-3f50227ce954",
      true,
    );
    const conversationId = await createConversation(
      workspaceId,
      "37d2c04f-f468-4390-ab59-24863684db6c",
    );
    await postMessage(
      workspaceId,
      conversationId,
      "54428ad8-8877-4a1d-9a5c-0461807ce7e1",
    );
    const response = await follow(
      workspaceId,
      conversationId,
      0,
      "session-revocable",
    );
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await frames.next();
    const authFixture = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    await authFixture.setSessionRevoked(
      "33333333-3333-8333-8333-333333333333",
      true,
    );
    const closed = nextClose(socket);
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 2 }),
    );
    await expect(closed).resolves.toMatchObject({ code: 1008 });
    await authFixture.setSessionRevoked(
      "33333333-3333-8333-8333-333333333333",
      false,
    );
  });

  it("requires history resync below the hot floor without reading archived R2", async () => {
    const workspaceId = await createWorkspace(
      "65526a83-2ea0-46bc-b366-557ba3cb7e07",
      "follow-hot-floor",
    );
    const conversationId = await createConversation(
      workspaceId,
      "22c9ba8a-6055-48a4-9517-987a26391dda",
    );
    for (const commandId of [
      "709567f8-b4c5-499b-b60c-b3b1b08c79a4",
      "00efc888-5bd7-4209-955b-1c9b73c0242b",
      "1e1e65b1-67af-4e14-bcb2-ddad350ff14e",
      "1f568e72-918f-49d8-9de0-7c5e7b72f721",
      "3f4b61de-1a4b-4e30-b594-a9e05bcbefca",
    ]) {
      await postMessage(workspaceId, conversationId, commandId);
    }
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runDurableObjectAlarm(conversation);
    const prefix = `workspaces/${workspaceId}/conversations/${conversationId}/journal/`;
    await expect
      .poll(
        async () => (await env.JOURNAL_ARCHIVE_BUCKET.list({ prefix })).objects,
      )
      .not.toHaveLength(0);
    const archived = await env.JOURNAL_ARCHIVE_BUCKET.list({ prefix });
    for (const object of archived.objects) {
      await env.JOURNAL_ARCHIVE_BUCKET.delete(object.key);
    }

    const response = await follow(workspaceId, conversationId, 0);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await expect(frames.next()).resolves.toMatchObject({ type: "accepted" });
    const closed = nextClose(socket);
    await expect(frames.next()).resolves.toMatchObject({
      type: "resync-required",
      reason: "history_required",
      afterCursor: 0,
      highWaterCursor: 6,
    });
    await expect(closed).resolves.toMatchObject({ code: 1000 });
  });

  it("expires an unacknowledged catch-up batch after hibernation with a resumable close", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace(
        "49a49fbf-1397-47c5-92ed-0eb39d98bfa9",
        "follow-slow-consumer",
      );
      const conversationId = await createConversation(
        workspaceId,
        "43226bea-cf36-4bc7-989f-e6dd03dc748a",
      );
      await postMessage(
        workspaceId,
        conversationId,
        "f718da21-233f-4332-b79d-62728808e5e4",
      );
      const response = await follow(workspaceId, conversationId);
      const socket = response.webSocket;
      expect(socket).not.toBeNull();
      if (socket === null) {
        return;
      }
      const frames = frameQueue(socket);
      socket.accept();
      await frames.next();
      await expect(frames.next()).resolves.toMatchObject({
        type: "changes",
        throughCursor: 2,
      });
      const closed = nextClose(socket);

      const conversation = env.CONVERSATIONS.getByName(conversationId);
      await evictDurableObject(conversation);
      vi.setSystemTime(new Date("2032-01-01T00:00:31.000Z"));
      await expect(runDurableObjectAlarm(conversation)).resolves.toBe(true);

      await expect(frames.next()).resolves.toEqual({
        schemaVersion: 1,
        type: "resync-required",
        reason: "slow_consumer",
        afterCursor: 0,
        highWaterCursor: 2,
      });
      await expect(closed).resolves.toMatchObject({ code: 1013 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates every follower with an allowlisted frame when the Conversation archives", async () => {
    const workspaceId = await createWorkspace(
      "c5f62f37-7ce2-49f9-9e02-caa33ab62a76",
      "follow-archive",
    );
    const conversationId = await createConversation(
      workspaceId,
      "502fc6c8-628f-4d71-8914-6779e7e21302",
    );
    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await frames.next();
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 1 }),
    );
    await expect(frames.next()).resolves.toMatchObject({ type: "ready" });
    const closed = nextClose(socket);

    await archiveConversation(
      workspaceId,
      conversationId,
      "6526b102-ed88-41de-8d73-f6650180a32f",
    );

    await expect(frames.next()).resolves.toEqual({
      schemaVersion: 1,
      type: "conversation-unavailable",
      reason: "archived",
      cursor: 2,
    });
    await expect(closed).resolves.toMatchObject({ code: 1000 });
  });

  it("closes with policy violation when an ACK skips beyond the sent cursor", async () => {
    const workspaceId = await createWorkspace(
      "1ea7a948-cffe-438e-a97f-e6e6388386ca",
      "follow-invalid-ack",
    );
    const conversationId = await createConversation(
      workspaceId,
      "21564b86-d6b9-4484-8a98-3fd5a19b823f",
    );
    await postMessage(
      workspaceId,
      conversationId,
      "34e8fab4-5f53-4e4e-8446-8dcc30484de0",
    );
    const response = await follow(workspaceId, conversationId);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    await frames.next();
    const closed = nextClose(socket);
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 3 }),
    );
    await expect(closed).resolves.toMatchObject({ code: 1008 });
  });

  it("delivers the latest tombstone without leaking its former content", async () => {
    const workspaceId = await createWorkspace(
      "dfb1d1aa-c6e9-4be6-a598-1f1ea858692f",
      "follow-tombstone",
    );
    const conversationId = await createConversation(
      workspaceId,
      "0053bb16-775a-4a0f-b3a8-337186362f10",
    );
    const active = await postMessage(
      workspaceId,
      conversationId,
      "4b28b4d7-c239-4a63-80d8-5ec8cad513e7",
    );
    await addReaction(
      workspaceId,
      conversationId,
      active.id,
      "b816d310-a7ee-4340-a1a3-d718ad5e2cb3",
    );
    const tombstone = await retractMessage(
      workspaceId,
      conversationId,
      active.id,
      "6e497593-c115-4e84-bc00-eb7aa47ee703",
    );
    const response = await follow(workspaceId, conversationId, 3);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    if (socket === null) {
      return;
    }
    const frames = frameQueue(socket);
    socket.accept();
    await frames.next();
    const changes = await frames.next();
    expect(changes).toMatchObject({
      type: "changes",
      fromExclusiveCursor: 3,
      throughCursor: 4,
      messages: [tombstone],
      reactionPatches: [],
      reactionCollectionPatches: [
        {
          messageId: active.id,
          visibility: "temporarily-hidden",
          cursor: 4,
          refreshRequired: false,
        },
      ],
    });
    expect(JSON.stringify(changes)).not.toContain(active.content);
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 4 }),
    );
    await expect(frames.next()).resolves.toMatchObject({ type: "ready" });
    const restored = await restoreMessage(
      workspaceId,
      conversationId,
      active.id,
      "2e629f85-1027-45ae-a022-356c1307975b",
    );
    await expect(frames.next()).resolves.toMatchObject({
      type: "changes",
      fromExclusiveCursor: 4,
      throughCursor: 5,
      messages: [restored],
      reactionPatches: [],
      reactionCollectionPatches: [
        {
          messageId: active.id,
          visibility: "visible",
          cursor: 5,
          refreshRequired: true,
        },
      ],
    });
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 5 }),
    );
    const secondTombstone = await retractMessage(
      workspaceId,
      conversationId,
      active.id,
      "0921529c-6e74-47e5-be14-762139bfb6c9",
    );
    await expect(frames.next()).resolves.toMatchObject({
      type: "changes",
      throughCursor: 6,
      messages: [secondTombstone],
      reactionPatches: [],
      reactionCollectionPatches: [
        {
          messageId: active.id,
          visibility: "temporarily-hidden",
          cursor: 6,
          refreshRequired: false,
        },
      ],
    });
    socket.send(
      JSON.stringify({ schemaVersion: 1, type: "ack", throughCursor: 6 }),
    );
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversation, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ retraction_json: string }>(
          "SELECT retraction_json FROM messages WHERE message_id = ?",
          active.id,
        )
        .one();
      const retraction = JSON.parse(row.retraction_json) as {
        eraseAfter: string;
      };
      retraction.eraseAfter = "2000-01-01T00:00:00.000Z";
      state.storage.sql.exec(
        "UPDATE messages SET retraction_json = ? WHERE message_id = ?",
        JSON.stringify(retraction),
        active.id,
      );
      state.storage.sql.exec(
        `UPDATE message_erasure_schedule
         SET erase_after = ?, next_attempt_at_ms = 0 WHERE message_id = ?`,
        retraction.eraseAfter,
        active.id,
      );
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await runDurableObjectAlarm(conversation);
    }
    await expect(frames.next()).resolves.toMatchObject({
      type: "changes",
      throughCursor: 7,
      messages: [
        { id: active.id, status: "erased", content: null, topic: null },
      ],
      reactionPatches: [],
      reactionCollectionPatches: [
        {
          messageId: active.id,
          visibility: "permanently-hidden",
          cursor: 7,
          refreshRequired: false,
        },
      ],
    });
    socket.close(1000, "test complete");
  });
});
