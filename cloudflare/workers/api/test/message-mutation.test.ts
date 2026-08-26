import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  EditMessageCommand,
  MessageMutationResponse,
  PostMessageCommand,
  RemoveWorkspaceMemberCommand,
  RetractMessageCommand,
  RestoreMessageCommand,
  SetWorkspaceMemberRoleCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { canonicalJson, sha256Hex } from "@punks/core";
import {
  env,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

interface BindingSnapshot {
  hadPrevious: boolean;
  previous: unknown;
}

function replaceBinding(
  target: object,
  key: PropertyKey,
  replacement: unknown,
): BindingSnapshot {
  const snapshot = {
    hadPrevious: Object.hasOwn(target, key),
    previous: Reflect.get(target, key),
  };
  if (!Reflect.set(target, key, replacement)) {
    throw new Error(`Workerd refused to replace binding ${String(key)}`);
  }
  return snapshot;
}

function restoreBinding(
  target: object,
  key: PropertyKey,
  snapshot: BindingSnapshot,
): void {
  const restored = snapshot.hadPrevious
    ? Reflect.set(target, key, snapshot.previous)
    : Reflect.deleteProperty(target, key);
  if (!restored) {
    throw new Error(`Workerd refused to restore binding ${String(key)}`);
  }
}

function isRestoreProjectionForMessage(
  value: unknown,
  messageId: string,
): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const projection = value as {
    messageId?: unknown;
    event?: { kind?: unknown };
    state?: { status?: unknown };
  };
  return (
    projection.messageId === messageId &&
    projection.event?.kind === 50203 &&
    projection.state?.status === "active"
  );
}

async function createWorkspace(commandId: string, slug: string) {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { slug, name: "Message mutation tests", visibility: "private" },
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
      name: `mutations-${commandId.slice(0, 6)}`,
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

async function addWorkspaceMember(
  workspaceId: string,
  commandId: string,
  role: SetWorkspaceMemberRoleCommand["payload"]["role"] = "member",
) {
  const admission: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId:
      role === "member" || role === "guest" ? commandId : crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      targetPunkId: otherPunkId,
      role: role === "guest" ? "guest" : "member",
      expectedRevision: 1,
    },
  };
  const admissionResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": admission.commandId,
      },
      body: JSON.stringify(admission),
    },
  );
  expect(admissionResponse.status).toBe(200);
  if (role !== "owner" && role !== "moderator") return;
  const promotion: SetWorkspaceMemberRoleCommand = {
    ...admission,
    commandId,
    payload: {
      targetPunkId: otherPunkId,
      role,
      expectedRevision: 2,
    },
  };
  const promotionResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": promotion.commandId,
      },
      body: JSON.stringify(promotion),
    },
  );
  expect(promotionResponse.status).toBe(200);
}

async function removeWorkspaceMember(
  workspaceId: string,
  commandId: string,
  expectedRevision: number,
) {
  const command: RemoveWorkspaceMemberCommand = {
    contract: "workspace.member-remove@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId: otherPunkId, expectedRevision },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: "DELETE",
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

async function postRoot(
  workspaceId: string,
  conversationId: string,
  commandId: string,
  punkId = ownerPunkId,
  session = "session-owner",
) {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId },
    payload: {
      content: "version initiale",
      replyToMessageId: null,
      broadcast: false,
      topic: "topic initial",
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
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
  return ((await response.json()) as { message: { id: string } }).message.id;
}

async function postReply(
  workspaceId: string,
  conversationId: string,
  commandId: string,
  parentMessageId: string,
) {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content: `reply-${commandId.slice(0, 6)}`,
      replyToMessageId: parentMessageId,
      broadcast: false,
      topic: null,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
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
  return ((await response.json()) as { message: { id: string } }).message.id;
}

async function mutateMessage(
  method: "PATCH" | "DELETE" | "POST",
  workspaceId: string,
  conversationId: string,
  messageId: string,
  command: object,
  suffix = "",
  session = "session-owner",
) {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}${suffix}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": Reflect.get(command, "commandId") as string,
      },
      body: JSON.stringify(command),
    },
  );
}

describe("Punks Message mutation API", () => {
  it("edits an authored Message through a bounded encrypted version delta", async () => {
    const workspaceId = await createWorkspace(
      "01c12417-2a2d-4f17-b864-304886c4ced7",
      "message-edit-author",
    );
    const conversationId = await createConversation(
      workspaceId,
      "7e934db8-b065-4bb4-a804-6852821de2a5",
    );
    const messageId = await postRoot(
      workspaceId,
      conversationId,
      "2d174044-bbc7-42c8-91b8-5e50a709490b",
    );
    const command: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "04710cf1-72f3-4791-81bb-67c78cd7b00e",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        content: "version éditée secrète",
        topic: "topic édité secret",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };

    const response = await mutateMessage(
      "PATCH",
      workspaceId,
      conversationId,
      messageId,
      command,
    );

    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text) as MessageMutationResponse;
    expect(
      validateContract("punks://contracts/message.mutation-response@1", body),
    ).toEqual({ valid: true });
    expect(body).toMatchObject({
      replayed: false,
      message: {
        id: messageId,
        status: "active",
        content: command.payload.content,
        topic: command.payload.topic,
        currentVersion: 2,
      },
    });
    expect(body).not.toHaveProperty("event");
    expect(JSON.stringify(body)).not.toMatch(
      /contentCommitment|contentKeyId|ciphertextRef|search|versionDelta/,
    );

    const replay = await mutateMessage(
      "PATCH",
      workspaceId,
      conversationId,
      messageId,
      command,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      message: { content: command.payload.content, currentVersion: 2 },
    });
    const conflict = await mutateMessage(
      "PATCH",
      workspaceId,
      conversationId,
      messageId,
      { ...command, payload: { ...command.payload, content: "conflit" } },
    );
    expect(conflict.status).toBe(409);

    const stored = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        versions: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_versions WHERE message_id = ?",
            messageId,
          )
          .one().count,
        editEvent: state.storage.sql
          .exec<{ event_json: string }>(
            "SELECT event_json FROM journal WHERE event_kind = 50201",
          )
          .one().event_json,
        all: JSON.stringify({
          messages: state.storage.sql.exec("SELECT * FROM messages").toArray(),
          versions: state.storage.sql
            .exec("SELECT * FROM message_versions")
            .toArray(),
          journal: state.storage.sql.exec("SELECT * FROM journal").toArray(),
          outbox: state.storage.sql.exec("SELECT * FROM outbox").toArray(),
        }),
      }),
    );
    expect(stored.versions).toBe(2);
    expect(stored.editEvent).not.toContain(command.payload.content);
    expect(stored.editEvent).not.toContain(command.payload.topic);
    expect(stored.all).not.toContain(command.payload.content);
    expect(stored.all).not.toContain(command.payload.topic);
    expect(stored.all).not.toContain(await sha256Hex(canonicalJson(command)));
  });

  it("keeps author edits private while allowing current moderator retract and restore", async () => {
    const workspaceId = await createWorkspace(
      "4b6dd418-7897-41a7-a675-4e8e2e286dc3",
      "message-moderation-policy",
    );
    await addWorkspaceMember(
      workspaceId,
      "d5f9afec-6f20-48a9-a21e-534926a5d95a",
      "moderator",
    );
    const conversationId = await createConversation(
      workspaceId,
      "641ffb32-a26e-4e32-b0cb-99519e834d14",
    );
    const messageId = await postRoot(
      workspaceId,
      conversationId,
      "acddf36c-2cba-4aab-9821-817448ed1899",
    );
    const forbiddenEdit: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "f60832d8-0bdd-4195-8e74-178e5940d1bb",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: {
        content: "un moderator ne devient pas auteur",
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    expect(
      (
        await mutateMessage(
          "PATCH",
          workspaceId,
          conversationId,
          messageId,
          forbiddenEdit,
          "",
          "session-other",
        )
      ).status,
    ).toBe(403);

    const moderationRetract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "d314a938-274e-454f-9eca-3f2aaf24600f",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: { reasonCode: "workspace-policy", publicReason: "Modéré" },
    };
    const retracted = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      moderationRetract,
      "/retract",
      "session-other",
    );
    expect(retracted.status).toBe(200);
    expect(await retracted.json()).toMatchObject({
      message: {
        status: "retracted",
        retractionKind: "moderation",
        publicReason: "Modéré",
      },
    });

    const authorRestore: RestoreMessageCommand = {
      contract: "message.restore@1",
      commandId: "f8c40400-d58a-46b0-8cd9-529ef7df7130",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {},
    };
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          messageId,
          authorRestore,
          "/restore",
        )
      ).status,
    ).toBe(200);
    const moderatorRestore: RestoreMessageCommand = {
      ...authorRestore,
      commandId: "42835795-b45f-4388-8d55-692e98f359d5",
      actor: { kind: "punk", punkId: otherPunkId },
    };
    const restored = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      moderatorRestore,
      "/restore",
      "session-other",
    );
    expect(restored.status).toBe(403);

    const noOpRestore: RestoreMessageCommand = {
      ...authorRestore,
      commandId: "70e4c3f2-7d15-4c6b-9381-19b4254af643",
    };
    const noOp = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      noOpRestore,
      "/restore",
    );
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toMatchObject({
      replayed: false,
      message: { status: "active", content: "version initiale" },
    });
    const noOpReplay = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      noOpRestore,
      "/restore",
    );
    expect(noOpReplay.status).toBe(200);
    expect(await noOpReplay.json()).toMatchObject({ replayed: true });

    const publicBot = {
      ...forbiddenEdit,
      commandId: "19a0688e-2c30-4b2b-9675-a03ff57923b2",
      actor: {
        kind: "bot",
        installationId: "5ed198ca-2aad-4181-841a-a7df4314f048",
      },
    };
    expect(
      (
        await mutateMessage(
          "PATCH",
          workspaceId,
          conversationId,
          messageId,
          publicBot,
        )
      ).status,
    ).toBe(403);
  });

  it("abandons a pending edit when its author loses Workspace access before retry", async () => {
    const workspaceId = await createWorkspace(
      "2e608b43-6457-4ca2-b224-df47051f2adb",
      "message-edit-revocation",
    );
    await addWorkspaceMember(
      workspaceId,
      "0a1dbfae-e7b9-4885-87ec-3bb6a766804a",
    );
    const conversationId = await createConversation(
      workspaceId,
      "07c94e31-e0bc-4e72-83f5-dfa1d6af2de6",
    );
    const messageId = await postRoot(
      workspaceId,
      conversationId,
      "cb52c971-991e-4562-a8f9-872986966467",
      otherPunkId,
      "session-other",
    );
    const edit: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "91b49ce8-fc79-44c2-bc25-06e8d067f802",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: {
        content: "ne doit jamais être committé",
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const failed = await mutateMessage(
      "PATCH",
      workspaceId,
      conversationId,
      messageId,
      edit,
      "",
      "session-other",
    );
    expect(failed.status).toBe(503);

    await removeWorkspaceMember(
      workspaceId,
      "256c91b7-1940-44c7-a60a-1860dbd69c5e",
      2,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const status = await runInDurableObject(
        env.CONVERSATIONS.getByName(conversationId),
        async (instance, state) => {
          const before = state.storage.sql
            .exec<{ status: string }>(
              "SELECT status FROM messages WHERE message_id = ?",
              messageId,
            )
            .one().status;
          if (before !== "erased") {
            await instance.alarm();
          }
          return state.storage.sql
            .exec<{ status: string }>(
              "SELECT status FROM messages WHERE message_id = ?",
              messageId,
            )
            .one().status;
        },
      );
      if (status === "erased") {
        break;
      }
    }
    const stored = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        message: state.storage.sql
          .exec<{ current_version: number }>(
            "SELECT current_version FROM messages WHERE message_id = ?",
            messageId,
          )
          .one(),
        edits: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM journal WHERE event_kind = 50201",
          )
          .one().count,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_command",
          )
          .one().count,
      }),
    );
    expect(stored).toEqual({
      message: { current_version: 1 },
      edits: 0,
      pending: 0,
    });
    expect(
      JSON.stringify(
        await runInDurableObject(
          env.CONVERSATIONS.getByName(conversationId),
          (_instance, state) =>
            state.storage.sql.exec("SELECT * FROM outbox").toArray(),
        ),
      ),
    ).not.toContain(edit.payload.content);
  });

  it("retracts immediately without exposing encrypted content", async () => {
    const workspaceId = await createWorkspace(
      "3eadf39b-50ec-4511-bced-e5bf0b278bef",
      "message-retract-author",
    );
    const conversationId = await createConversation(
      workspaceId,
      "a988c6b9-5049-44d8-b638-21df86bd4c86",
    );
    const postCommandId = "8871f8e7-9489-4b98-a14a-18408f125e6a";
    const messageId = await postRoot(
      workspaceId,
      conversationId,
      postCommandId,
    );
    const command: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "407662d8-9083-4dda-9c1d-6679c36447dd",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { reasonCode: null, publicReason: "Retiré par son auteur" },
    };

    const response = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      command,
      "/retract",
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text) as MessageMutationResponse;
    expect(
      validateContract("punks://contracts/message.mutation-response@1", body),
    ).toEqual({ valid: true });
    expect(body.message).toMatchObject({
      id: messageId,
      status: "retracted",
      content: null,
      topic: null,
      currentVersion: null,
      mediaIds: [],
      retractionKind: "author",
      publicReason: command.payload.publicReason,
      erasedAt: null,
    });
    expect(body.message.retractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.message.eraseAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(body)).not.toMatch(
      /reasonCode|commandId|contentKeyId|ciphertextRef|contentCommitment/,
    );
    const replayRetract = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      command,
      "/retract",
    );
    expect(replayRetract.status).toBe(200);
    expect(await replayRetract.json()).toMatchObject({
      replayed: true,
      message: { status: "retracted", content: null, topic: null },
    });
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          messageId,
          {
            ...command,
            payload: { ...command.payload, publicReason: "Conflit" },
          },
          "/retract",
        )
      ).status,
    ).toBe(409);
    const duplicateIntent = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      {
        ...command,
        commandId: "6ec2b77f-9b25-4930-b0e5-bab9bded6b50",
      },
      "/retract",
    );
    expect(duplicateIntent.status).toBe(409);

    const replayPost = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": postCommandId,
        },
        body: JSON.stringify({
          contract: "message.post@1",
          commandId: postCommandId,
          workspaceId,
          conversationId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            content: "version initiale",
            replyToMessageId: null,
            broadcast: false,
            topic: "topic initial",
            mentionedPunkIds: [],
            mediaIds: [],
          },
        }),
      },
    );
    expect(replayPost.status).toBe(200);
    expect(await replayPost.json()).toMatchObject({
      replayed: true,
      message: { status: "retracted", content: null, topic: null },
    });

    const stored = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        message: state.storage.sql
          .exec<{ status: string; retraction_json: string }>(
            "SELECT status, retraction_json FROM messages WHERE message_id = ?",
            messageId,
          )
          .one(),
        event: state.storage.sql
          .exec<{ event_json: string }>(
            "SELECT event_json FROM journal WHERE event_kind = 50202",
          )
          .one().event_json,
      }),
    );
    expect(stored.message.status).toBe("retracted");
    expect(
      new Date(
        (JSON.parse(stored.message.retraction_json) as { eraseAfter: string })
          .eraseAfter,
      ).getTime() -
        new Date(
          (
            JSON.parse(stored.message.retraction_json) as {
              requestedAt: string;
            }
          ).requestedAt,
        ).getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(stored.event).not.toContain("version initiale");
    expect(stored.event).not.toContain("topic initial");

    const conversationStub = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversationStub, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(conversationStub);
    await runInDurableObject(conversationStub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    const restore: RestoreMessageCommand = {
      contract: "message.restore@1",
      commandId: "67b5fc85-3523-439e-81e6-5dc05604207f",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {},
    };
    let restoreProjection: unknown;
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    let queueSnapshot: BindingSnapshot | undefined;
    try {
      await runInDurableObject(conversation, (instance) => {
        const bindings = Reflect.get(instance, "env") as Record<
          string,
          unknown
        >;
        queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
          send: async (payload: unknown) => {
            if (isRestoreProjectionForMessage(payload, messageId)) {
              restoreProjection = structuredClone(payload);
            }
          },
        });
      });
      const restored = await mutateMessage(
        "POST",
        workspaceId,
        conversationId,
        messageId,
        restore,
        "/restore",
      );
      expect(restored.status, await restored.clone().text()).toBe(200);
      expect(await restored.json()).toMatchObject({
        replayed: false,
        message: {
          status: "active",
          content: "version initiale",
          topic: "topic initial",
          currentVersion: 1,
        },
      });
      await vi.waitFor(() => {
        expect(restoreProjection).toBeDefined();
      });
    } finally {
      const snapshot = queueSnapshot;
      if (snapshot !== undefined) {
        await runInDurableObject(conversation, (instance) => {
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          restoreBinding(bindings, "PROJECTION_QUEUE", snapshot);
        });
      }
    }
    expect(restoreProjection).toMatchObject({
      search: {
        algorithm: "hmac-sha256-conversation-v2",
        tokens: expect.arrayContaining([expect.stringMatching(/^h2_/)]),
      },
    });
    expect(JSON.stringify(restoreProjection)).not.toMatch(
      /version initiale|topic initial/,
    );

    const secondRetract: RetractMessageCommand = {
      ...command,
      commandId: "4ba8f6de-a542-4cff-aafc-f1dd50680042",
    };
    const retractedAgain = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      secondRetract,
      "/retract",
    );
    expect(retractedAgain.status).toBe(200);
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      async (instance, state) => {
        state.storage.sql.exec(
          `UPDATE message_erasure_schedule
           SET retraction_command_id = ?, erase_after = ?, next_attempt_at_ms = 0
           WHERE message_id = ?`,
          command.commandId,
          "2026-08-20T19:59:59.000Z",
          messageId,
        );
        await instance.alarm();
        const current = state.storage.sql
          .exec<{ status: string; retraction_json: string }>(
            "SELECT status, retraction_json FROM messages WHERE message_id = ?",
            messageId,
          )
          .one();
        expect(current.status).toBe("retracted");
        expect(
          (JSON.parse(current.retraction_json) as { commandId: string })
            .commandId,
        ).toBe(secondRetract.commandId);
      },
    );
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => {
        const row = state.storage.sql
          .exec<{ retraction_json: string }>(
            "SELECT retraction_json FROM messages WHERE message_id = ?",
            messageId,
          )
          .one();
        const retraction = JSON.parse(row.retraction_json) as {
          eraseAfter: string;
        };
        retraction.eraseAfter = new Date().toISOString();
        state.storage.sql.exec(
          "UPDATE messages SET retraction_json = ? WHERE message_id = ?",
          JSON.stringify(retraction),
          messageId,
        );
      },
    );
    const expiredRestore: RestoreMessageCommand = {
      ...restore,
      commandId: "c5bf22af-c692-459f-b5fd-d3f92b29988f",
    };
    const expired = await mutateMessage(
      "POST",
      workspaceId,
      conversationId,
      messageId,
      expiredRestore,
      "/restore",
    );
    expect(expired.status).toBe(409);
  });

  it("starts the full seven-day grace when a delayed retraction retry is accepted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const preparedAt = new Date("2030-01-01T10:00:00.000Z");
      vi.setSystemTime(preparedAt);
      const workspaceId = await createWorkspace(
        "bd792c8c-5c5d-4208-b682-9033549cf74a",
        "message-retract-delayed-grace",
      );
      const conversationId = await createConversation(
        workspaceId,
        "bed71e6d-9b65-47e8-ae1f-a46c0ec020df",
      );
      const messageId = await postRoot(
        workspaceId,
        conversationId,
        "548c67e9-4d8c-44c5-97fb-a2c80629e537",
      );
      const command: RetractMessageCommand = {
        contract: "message.retract@1",
        commandId: "77efbe16-0455-421b-a015-e151cd4a2fae",
        workspaceId,
        conversationId,
        messageId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: {
          reasonCode: null,
          publicReason: "retry-attestation-delayed-grace",
        },
      };

      const firstAttempt = await mutateMessage(
        "POST",
        workspaceId,
        conversationId,
        messageId,
        command,
        "/retract",
      );
      expect(firstAttempt.status).toBe(503);
      await expect(firstAttempt.json()).resolves.toMatchObject({
        code: "attestation_failed",
      });

      const acceptedAt = new Date("2030-01-09T10:00:00.000Z");
      const eraseAfter = new Date("2030-01-16T10:00:00.000Z");
      vi.setSystemTime(acceptedAt);
      await runInDurableObject(
        env.CONVERSATIONS.getByName(conversationId),
        async (instance) => {
          await instance.alarm();
        },
      );

      const replay = await mutateMessage(
        "POST",
        workspaceId,
        conversationId,
        messageId,
        command,
        "/retract",
      );
      const replayText = await replay.text();
      expect(replay.status, replayText).toBe(200);
      const replayBody = JSON.parse(replayText) as MessageMutationResponse;
      expect(replayBody).toMatchObject({
        replayed: true,
        message: {
          status: "retracted",
          retractedAt: acceptedAt.toISOString(),
          eraseAfter: eraseAfter.toISOString(),
        },
      });

      const durable = await runInDurableObject(
        env.CONVERSATIONS.getByName(conversationId),
        (_instance, state) => ({
          journalEvent: state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE event_kind = 50202",
            )
            .one().event_json,
          schedule: state.storage.sql
            .exec<{ erase_after: string; next_attempt_at_ms: number }>(
              `SELECT erase_after, next_attempt_at_ms
               FROM message_erasure_schedule WHERE message_id = ?`,
              messageId,
            )
            .one(),
        }),
      );
      const event = JSON.parse(durable.journalEvent) as {
        created_at: number;
        content: string;
      };
      const eventBody = JSON.parse(event.content) as {
        message: {
          retraction: { requestedAt: string; eraseAfter: string };
        };
      };
      expect(event.created_at).toBe(1_894_183_200);
      expect(eventBody.message.retraction).toMatchObject({
        requestedAt: acceptedAt.toISOString(),
        eraseAfter: eraseAfter.toISOString(),
      });
      expect(durable.schedule).toEqual({
        erase_after: eraseAfter.toISOString(),
        next_attempt_at_ms: eraseAfter.getTime(),
      });

      vi.setSystemTime(new Date(eraseAfter.getTime() - 1));
      const restore: RestoreMessageCommand = {
        contract: "message.restore@1",
        commandId: "898a4dd7-d328-4078-b239-254483f272a1",
        workspaceId,
        conversationId,
        messageId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: {},
      };
      const restored = await mutateMessage(
        "POST",
        workspaceId,
        conversationId,
        messageId,
        restore,
        "/restore",
      );
      const restoredText = await restored.text();
      expect(restored.status, restoredText).toBe(200);
      expect(JSON.parse(restoredText)).toMatchObject({
        replayed: false,
        message: { status: "active" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("recomputes root counters and lastReplyAt from active replies", async () => {
    const workspaceId = await createWorkspace(
      "e08a7164-0fb3-4eab-9082-f0c0d42bd379",
      "message-thread-mutations",
    );
    const conversationId = await createConversation(
      workspaceId,
      "87c454ed-f05b-4108-8faf-d53d777af10e",
    );
    const rootId = await postRoot(
      workspaceId,
      conversationId,
      "6d980c60-130c-414b-93e7-797def72a0b3",
    );
    const firstReplyId = await postReply(
      workspaceId,
      conversationId,
      "3b4299b0-5f92-4aa8-b079-36442991c736",
      rootId,
    );
    const secondReplyId = await postReply(
      workspaceId,
      conversationId,
      "19dc4b00-3d3d-40c4-8561-53c86a8f72c7",
      rootId,
    );
    const snapshot = () =>
      runInDurableObject(
        env.CONVERSATIONS.getByName(conversationId),
        (_instance, state) => ({
          root: state.storage.sql
            .exec<{
              reply_count: number;
              descendant_count: number;
              last_reply_at: string | null;
            }>(
              `SELECT reply_count, descendant_count, last_reply_at
               FROM messages WHERE message_id = ?`,
              rootId,
            )
            .one(),
          firstCreatedAt: state.storage.sql
            .exec<{ created_at: string }>(
              "SELECT created_at FROM messages WHERE message_id = ?",
              firstReplyId,
            )
            .one().created_at,
          secondCreatedAt: state.storage.sql
            .exec<{ created_at: string }>(
              "SELECT created_at FROM messages WHERE message_id = ?",
              secondReplyId,
            )
            .one().created_at,
        }),
      );
    const posted = await snapshot();
    expect(posted.root).toEqual({
      reply_count: 2,
      descendant_count: 2,
      last_reply_at: posted.secondCreatedAt,
    });

    const retract = (
      commandId: string,
      messageId: string,
    ): RetractMessageCommand => ({
      contract: "message.retract@1",
      commandId,
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { reasonCode: null, publicReason: null },
    });
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          firstReplyId,
          retract("9b0108ea-8335-457a-aef6-521fce396114", firstReplyId),
          "/retract",
        )
      ).status,
    ).toBe(200);
    expect((await snapshot()).root).toEqual({
      reply_count: 1,
      descendant_count: 1,
      last_reply_at: posted.secondCreatedAt,
    });
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          secondReplyId,
          retract("06889225-cbaa-4a87-a7c9-010eb475f057", secondReplyId),
          "/retract",
        )
      ).status,
    ).toBe(200);
    expect((await snapshot()).root).toEqual({
      reply_count: 0,
      descendant_count: 0,
      last_reply_at: null,
    });

    const restore: RestoreMessageCommand = {
      contract: "message.restore@1",
      commandId: "819702cd-a290-4756-93af-fab22d45438e",
      workspaceId,
      conversationId,
      messageId: firstReplyId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {},
    };
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          firstReplyId,
          restore,
          "/restore",
        )
      ).status,
    ).toBe(200);
    expect((await snapshot()).root).toEqual({
      reply_count: 1,
      descendant_count: 1,
      last_reply_at: posted.firstCreatedAt,
    });
  });

  it("finalizes a due multi-version erasure through the Conversation alarm", async () => {
    const workspaceId = await createWorkspace(
      "c3103755-768c-4638-b79c-4bce47e1a6b3",
      "message-final-erasure",
    );
    const conversationId = await createConversation(
      workspaceId,
      "9272e91b-2fe6-4770-a8ca-f8ae4286100e",
    );
    const postCommandId = "ac363fee-14dc-4617-a420-a315c8b98eb4";
    const messageId = await postRoot(
      workspaceId,
      conversationId,
      postCommandId,
    );
    const edit: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "1e12f1ea-81d3-4ff5-95e0-95801b9efeab",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        content: "version finale avant destruction",
        topic: "topic final avant destruction",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    expect(
      (
        await mutateMessage(
          "PATCH",
          workspaceId,
          conversationId,
          messageId,
          edit,
        )
      ).status,
    ).toBe(200);
    const retract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "86b87f79-4716-44e8-bb2b-753c138b2b94",
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { reasonCode: "author-request", publicReason: "Supprimé" },
    };
    expect(
      (
        await mutateMessage(
          "POST",
          workspaceId,
          conversationId,
          messageId,
          retract,
          "/retract",
        )
      ).status,
    ).toBe(200);

    const due = "2026-08-20T19:59:59.000Z";
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      async (instance, state) => {
        const row = state.storage.sql
          .exec<{ retraction_json: string }>(
            "SELECT retraction_json FROM messages WHERE message_id = ?",
            messageId,
          )
          .one();
        const retraction = JSON.parse(row.retraction_json) as {
          eraseAfter: string;
        };
        retraction.eraseAfter = due;
        state.storage.sql.exec(
          "UPDATE messages SET retraction_json = ? WHERE message_id = ?",
          JSON.stringify(retraction),
          messageId,
        );
        state.storage.sql.exec(
          `UPDATE message_erasure_schedule
           SET erase_after = ?, next_attempt_at_ms = 0
           WHERE message_id = ?`,
          due,
          messageId,
        );
        state.storage.sql.exec(
          `INSERT INTO content_finalization
            (event_id, workspace_id, conversation_id, message_id, command_id,
             content_key_id, attempts, next_attempt_at_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
          "0".repeat(64),
          workspaceId,
          conversationId,
          messageId,
          "0db1b253-ae38-46c1-96a8-807350548d2d",
          "1cb06dfb-058d-41b7-807b-3ba4fa7af12e",
          new Date().toISOString(),
        );
        await instance.alarm();
        expect(
          state.storage.sql
            .exec<{ status: string }>(
              "SELECT status FROM messages WHERE message_id = ?",
              messageId,
            )
            .one().status,
        ).toBe("retracted");
        state.storage.sql.exec(
          "DELETE FROM content_finalization WHERE message_id = ?",
          messageId,
        );
        state.storage.sql.exec(
          `UPDATE message_erasure_schedule SET next_attempt_at_ms = 0
           WHERE message_id = ?`,
          messageId,
        );
        await instance.alarm();
      },
    );

    const afterPrioritizedFinalization = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        status: state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM messages WHERE message_id = ?",
            messageId,
          )
          .one().status,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM journal WHERE event_kind = 50204",
          )
          .one().count,
      }),
    );
    expect(afterPrioritizedFinalization).toEqual({
      status: "erased",
      pending: 0,
      journal: 1,
    });

    const stored = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        message: state.storage.sql
          .exec<{
            status: string;
            current_version: number | null;
            erasure_marker_json: string;
          }>(
            `SELECT status, current_version, erasure_marker_json
             FROM messages WHERE message_id = ?`,
            messageId,
          )
          .one(),
        versions: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_versions WHERE message_id = ?",
            messageId,
          )
          .one().count,
        event:
          state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE event_kind = 50204",
            )
            .toArray()[0]?.event_json ?? "",
        schedule: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_erasure_schedule WHERE message_id = ?",
            messageId,
          )
          .one().count,
        pending: state.storage.sql
          .exec("SELECT * FROM pending_message_command")
          .toArray(),
        schedules: state.storage.sql
          .exec("SELECT * FROM message_erasure_schedule")
          .toArray(),
      }),
    );
    const vaultDebug = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) => ({
        versions: state.storage.sql
          .exec("SELECT * FROM content_versions")
          .toArray(),
        proofs: state.storage.sql
          .exec("SELECT * FROM destruction_proofs")
          .toArray(),
      }),
    );
    expect(stored.message.status, JSON.stringify({ stored, vaultDebug })).toBe(
      "erased",
    );
    expect(stored.message.current_version).toBeNull();
    expect(stored.versions).toBe(0);
    expect(stored.schedule).toBe(0);
    expect(stored.event).not.toMatch(
      /version initiale|topic initial|contentKeyId|ciphertextRef/,
    );

    const vault = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            status: string;
            key_material: ArrayBuffer | null;
            iv: ArrayBuffer | null;
          }>("SELECT status, key_material, iv FROM content_versions")
          .toArray(),
    );
    expect(vault).toHaveLength(2);
    expect(vault.every((row) => row.status === "destroyed")).toBe(true);
    expect(
      vault.every((row) => row.key_material === null && row.iv === null),
    ).toBe(true);

    const replayEdit = await mutateMessage(
      "PATCH",
      workspaceId,
      conversationId,
      messageId,
      edit,
    );
    expect(replayEdit.status).toBe(200);
    expect(await replayEdit.json()).toMatchObject({
      replayed: true,
      message: {
        status: "erased",
        content: null,
        topic: null,
        retractionKind: "author",
        retractedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        eraseAfter: null,
        publicReason: null,
        erasedAt: "2026-08-20T20:00:00.000Z",
      },
    });
  });
});
