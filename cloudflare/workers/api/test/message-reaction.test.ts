import type {
  AddMessageReactionCommand,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  MessageReactionMutationResponse,
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
import { describe, expect, it } from "vitest";

import type { ConversationDO } from "../src/conversation-do";
import type { ApiEnv } from "../src/env";
import type { MessageContentDO } from "../src/message-content-do";
import { route } from "../src/router";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
let setupSequence = 0;

async function createWorkspace(): Promise<string> {
  setupSequence += 1;
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: `message-reactions-${setupSequence}`,
      name: "Message reactions",
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

async function createConversation(workspaceId: string): Promise<string> {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      name: `reactions-${setupSequence}`,
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
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { conversation: { id: string } })
    .conversation.id;
}

async function postMessage(
  workspaceId: string,
  conversationId: string,
): Promise<MessageView> {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content: "Message à réagir",
      replyToMessageId: null,
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
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { message: MessageView }).message;
}

type ReactionCommand =
  | AddMessageReactionCommand
  | RemoveMessageReactionCommand
  | ToggleMessageReactionCommand;

function reactionCommand(
  contract: ReactionCommand["contract"],
  workspaceId: string,
  conversationId: string,
  messageId: string,
  commandId: string,
  reaction = "🔥",
  punkId = ownerPunkId,
): ReactionCommand {
  return {
    contract,
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction },
  } as ReactionCommand;
}

async function mutateReaction(
  command: ReactionCommand,
  session = "session-owner",
  idempotencyKey = command.commandId,
): Promise<Response> {
  const operation = command.contract.slice(
    "message.reaction-".length,
    -"@1".length,
  );
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${command.workspaceId}/conversations/${command.conversationId}/messages/${command.messageId}/reactions/${operation}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(command),
    },
  );
}

async function addWorkspaceMember(workspaceId: string): Promise<void> {
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId: "04000000-0000-4000-8000-000000000020",
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId: otherPunkId, role: "member" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
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
  expect(response.status).toBe(200);
}

async function removeWorkspaceMember(workspaceId: string): Promise<void> {
  const command: RemoveWorkspaceMemberCommand = {
    contract: "workspace.member-remove@1",
    commandId: "04000000-0000-4000-8000-000000000021",
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId: otherPunkId },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
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

async function mutateMessageLifecycle(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  operation: "retract" | "restore",
  commandId: string,
): Promise<Response> {
  const command: RetractMessageCommand | RestoreMessageCommand =
    operation === "retract"
      ? {
          contract: "message.retract@1",
          commandId,
          workspaceId,
          conversationId,
          messageId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { reasonCode: null, publicReason: null },
        }
      : {
          contract: "message.restore@1",
          commandId,
          workspaceId,
          conversationId,
          messageId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {},
        };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/${operation}`,
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
}

async function saturateConversationJournal(conversationId: string) {
  await runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    async (_instance, state) => {
      await state.storage.deleteAlarm();
      const hasPoison = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM journal WHERE cursor = -1",
        )
        .one().count;
      if (hasPoison === 1) {
        return;
      }
      const source = state.storage.sql
        .exec<{ event_json: string; event_kind: number }>(
          "SELECT event_json, event_kind FROM journal ORDER BY cursor DESC LIMIT 1",
        )
        .one();
      const event = JSON.parse(source.event_json) as { id: string };
      state.storage.sql.exec(
        `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
         VALUES (-1, ?, ?, ?, ?)`,
        "a".repeat(64),
        source.event_kind,
        JSON.stringify({ ...event, id: "a".repeat(64) }),
        new Date().toISOString(),
      );
    },
  );
}

describe("Punks Message Reaction API", () => {
  it("classifies toggle after its effect and permits only monotone removals at journal capacity", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const add = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "13000000-0000-4000-8000-000000000001",
    );
    expect((await mutateReaction(add)).status).toBe(201);
    await saturateConversationJournal(conversationId);

    const blockedAdd = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "13000000-0000-4000-8000-000000000002",
      "🎉",
    );
    expect((await mutateReaction(blockedAdd)).status).toBe(500);

    const removeToggle = reactionCommand(
      "message.reaction-toggle@1",
      workspaceId,
      conversationId,
      message.id,
      "13000000-0000-4000-8000-000000000003",
    );
    const removed = await mutateReaction(removeToggle);
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ effect: "removed" });

    const blockedAddToggle = reactionCommand(
      "message.reaction-toggle@1",
      workspaceId,
      conversationId,
      message.id,
      "13000000-0000-4000-8000-000000000004",
    );
    expect((await mutateReaction(blockedAddToggle)).status).toBe(500);

    const retract = await mutateMessageLifecycle(
      workspaceId,
      conversationId,
      message.id,
      "retract",
      "13000000-0000-4000-8000-000000000005",
    );
    expect(retract.status).toBe(200);
    const restore = await mutateMessageLifecycle(
      workspaceId,
      conversationId,
      message.id,
      "restore",
      "13000000-0000-4000-8000-000000000006",
    );
    expect(restore.status).toBe(500);
  });

  it("adds one authoritative Punk Reaction through the public route", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const command: AddMessageReactionCommand = {
      contract: "message.reaction-add@1",
      commandId: "04000000-0000-4000-8000-000000000004",
      workspaceId,
      conversationId,
      messageId: message.id,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { reaction: "🔥" },
    };

    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${message.id}/reactions/add`,
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as MessageReactionMutationResponse;
    expect(
      validateContract(
        "punks://contracts/message.reaction-mutation-response@1",
        body,
      ).valid,
    ).toBe(true);
    expect(body).toMatchObject({
      effect: "added",
      replayed: false,
      reaction: {
        workspaceId,
        conversationId,
        messageId: message.id,
        actor: { kind: "punk", punkId: ownerPunkId },
        reaction: "🔥",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /event|pubkey|sig|roster|contentKey|ciphertext/i,
    );
  });

  it("keeps one stable presence and records add, no-op, remove, replay and toggle exactly once", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const add = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000030",
    );
    const addedResponse = await mutateReaction(add);
    expect(addedResponse.status).toBe(201);
    const added =
      (await addedResponse.json()) as MessageReactionMutationResponse;
    expect(added.effect).toBe("added");
    const reactionId = added.reaction?.id;
    expect(reactionId).toMatch(/^[0-9a-f-]{36}$/);

    const beforeNoOpCursor = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) =>
        JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
    );
    const noOp = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000031",
    );
    const noOpResponse = await mutateReaction(noOp);
    expect(noOpResponse.status).toBe(200);
    expect(await noOpResponse.json()).toMatchObject({
      effect: "unchanged",
      replayed: false,
      reaction: { id: reactionId },
    });

    const remove = reactionCommand(
      "message.reaction-remove@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000032",
    );
    const removedResponse = await mutateReaction(remove);
    expect(removedResponse.status).toBe(200);
    expect(await removedResponse.json()).toMatchObject({
      effect: "removed",
      replayed: false,
      reaction: null,
    });

    const replayResponse = await mutateReaction(add);
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({
      reaction: null,
      effect: "added",
      replayed: true,
    });

    const toggle = reactionCommand(
      "message.reaction-toggle@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000033",
    );
    const toggledResponse = await mutateReaction(toggle);
    expect(toggledResponse.status).toBe(200);
    expect(await toggledResponse.json()).toMatchObject({
      effect: "added",
      replayed: false,
      reaction: { id: reactionId },
    });

    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => {
        const reaction = state.storage.sql
          .exec<{
            reaction_id: string;
            status: string;
            created_cursor: number;
            cursor: number;
          }>("SELECT * FROM message_reactions")
          .one();
        expect(reaction.reaction_id).toBe(reactionId);
        expect(reaction.status).toBe("active");
        expect(reaction.cursor).toBeGreaterThan(reaction.created_cursor);
        expect(
          state.storage.sql
            .exec<{ active_count: number }>(
              "SELECT active_count FROM message_reaction_counts",
            )
            .one().active_count,
        ).toBe(1);
        const results = state.storage.sql
          .exec<{ command_id: string; committed_cursor: number | null }>(
            `SELECT command_id, committed_cursor
             FROM message_reaction_command_results ORDER BY committed_at`,
          )
          .toArray();
        expect(results).toHaveLength(4);
        expect(
          results.find((row) => row.command_id === noOp.commandId)
            ?.committed_cursor,
        ).toBeNull();
        expect(
          results.filter(({ committed_cursor }) => committed_cursor !== null),
        ).toHaveLength(3);
        const conversationCursor = JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number;
        expect(conversationCursor).toBe(beforeNoOpCursor + 2);
        const reactionJournal = state.storage.sql
          .exec<{ event_kind: number }>(
            `SELECT event_kind FROM journal
             WHERE event_kind IN (50210, 50211) ORDER BY cursor`,
          )
          .toArray();
        expect(reactionJournal.map(({ event_kind }) => event_kind)).toEqual([
          50211, 50210,
        ]);
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
        ).toBe(0);
        expect(
          state.storage.sql
            .exec<{ cursor: number }>(
              `SELECT enqueued_through_cursor AS cursor
               FROM projection_delivery_state WHERE singleton = 1`,
            )
            .one().cursor,
        ).toBe(conversationCursor);
      },
    );
  });

  it("hides an active presence on retract and exposes it again only after restore", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const add = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000040",
    );
    expect((await mutateReaction(add)).status).toBe(201);
    expect(
      (
        await mutateMessageLifecycle(
          workspaceId,
          conversationId,
          message.id,
          "retract",
          "04000000-0000-4000-8000-000000000041",
        )
      ).status,
    ).toBe(200);
    const hiddenReplay = await mutateReaction(add);
    expect(hiddenReplay.status).toBe(200);
    expect(await hiddenReplay.json()).toEqual({
      reaction: null,
      effect: "added",
      replayed: true,
    });
    const rejectedNew = await mutateReaction(
      reactionCommand(
        "message.reaction-toggle@1",
        workspaceId,
        conversationId,
        message.id,
        "04000000-0000-4000-8000-000000000042",
      ),
    );
    expect(rejectedNew.status).toBe(409);
    expect(
      (
        await mutateMessageLifecycle(
          workspaceId,
          conversationId,
          message.id,
          "restore",
          "04000000-0000-4000-8000-000000000043",
        )
      ).status,
    ).toBe(200);
    const visibleReplay = await mutateReaction(add);
    expect(visibleReplay.status).toBe(200);
    expect(await visibleReplay.json()).toMatchObject({
      reaction: { reaction: "🔥" },
      effect: "added",
      replayed: true,
    });
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ visibility: string }>(
              "SELECT visibility FROM message_reaction_visibility WHERE message_id = ?",
              message.id,
            )
            .one().visibility,
        ).toBe("visible");
        expect(
          state.storage.sql
            .exec<{ active_count: number }>(
              "SELECT active_count FROM message_reaction_counts",
            )
            .one().active_count,
        ).toBe(1);
      },
    );
  });

  it("keeps the Reaction collection permanently hidden after final Message erasure", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const add = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000044",
    );
    expect((await mutateReaction(add)).status).toBe(201);
    expect(
      (
        await mutateMessageLifecycle(
          workspaceId,
          conversationId,
          message.id,
          "retract",
          "04000000-0000-4000-8000-000000000045",
        )
      ).status,
    ).toBe(200);
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    const due = "2026-08-20T00:00:00.000Z";
    await runInDurableObject(conversation, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ retraction_json: string }>(
          "SELECT retraction_json FROM messages WHERE message_id = ?",
          message.id,
        )
        .one();
      const retraction = JSON.parse(row.retraction_json) as {
        eraseAfter: string;
      };
      retraction.eraseAfter = due;
      state.storage.sql.exec(
        "UPDATE messages SET retraction_json = ? WHERE message_id = ?",
        JSON.stringify(retraction),
        message.id,
      );
      state.storage.sql.exec(
        `UPDATE message_erasure_schedule
         SET erase_after = ?, next_attempt_at_ms = 0 WHERE message_id = ?`,
        due,
        message.id,
      );
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await runInDurableObject(conversation, async (_instance, state) => {
        await state.storage.setAlarm(Date.now() - 1);
      });
      await runDurableObjectAlarm(conversation);
    }
    await runInDurableObject(conversation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM messages WHERE message_id = ?",
            message.id,
          )
          .one().status,
      ).toBe("erased");
      expect(
        state.storage.sql
          .exec<{ visibility: string }>(
            "SELECT visibility FROM message_reaction_visibility WHERE message_id = ?",
            message.id,
          )
          .one().visibility,
      ).toBe("permanently-hidden");
    });
    const replay = await mutateReaction(add);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      reaction: null,
      effect: "added",
      replayed: true,
    });
  });

  it("resumes a failed attestation from the durable alarm after eviction", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const command = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000099",
    );
    expect((await mutateReaction(command)).status).toBe(503);
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
          )
          .one().count,
      ).toBe(1);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM journal WHERE event_kind IN (50210, 50211)",
          )
          .one().count,
      ).toBe(0);
    });
    await evictDurableObject(conversation);
    expect(await runDurableObjectAlarm(conversation)).toBe(true);
    await runInDurableObject(conversation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reactions WHERE status = 'active'",
          )
          .one().count,
      ).toBe(1);
    });
    const replay = await mutateReaction(command);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      effect: "added",
      replayed: true,
    });
  });

  it("blocks Message mutations while a Reaction attestation is pending", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const delayed = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000098",
    );
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(conversation, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO pending_message_reaction_command
          (singleton, command_id, semantic_hash, reaction_id, command_json,
           command_record_json, unsigned_json, next_reaction_json,
           projection_delta_json, next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, '{}', '{}', '{}', '{}', '{}', '{}', 0, ?)`,
        delayed.commandId,
        "0".repeat(64),
        "04000000-0000-8000-8000-000000000098",
        new Date().toISOString(),
      );
    });
    try {
      const competingReaction = await mutateReaction(
        reactionCommand(
          "message.reaction-toggle@1",
          workspaceId,
          conversationId,
          message.id,
          "04000000-0000-4000-8000-000000000050",
          "👍",
        ),
      );
      expect(competingReaction.status).toBe(409);
      const competingMessage = await mutateMessageLifecycle(
        workspaceId,
        conversationId,
        message.id,
        "retract",
        "04000000-0000-4000-8000-000000000051",
      );
      expect(competingMessage.status).toBe(409);
    } finally {
      await runInDurableObject(conversation, (_instance, state) => {
        state.storage.sql.exec("DELETE FROM pending_message_reaction_command");
        return state.storage.deleteAlarm();
      });
    }
    expect((await mutateReaction(delayed)).status).toBe(201);
  });

  it("lets a due final erasure preempt a pending Reaction retry", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const activeMessage = await postMessage(workspaceId, conversationId);
    const dueMessage = await postMessage(workspaceId, conversationId);
    expect(
      (
        await mutateMessageLifecycle(
          workspaceId,
          conversationId,
          dueMessage.id,
          "retract",
          "04000000-0000-4000-8000-000000000080",
        )
      ).status,
    ).toBe(200);
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    const pendingCommand = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      activeMessage.id,
      "04000000-0000-4000-8000-000000000096",
    );
    const pendingResponse = await mutateReaction(pendingCommand);
    expect(pendingResponse.status, await pendingResponse.clone().text()).toBe(
      503,
    );
    await runInDurableObject(
      conversation,
      async (instance: ConversationDO, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
            )
            .one().count,
        ).toBe(1);
        const row = state.storage.sql
          .exec<{ retraction_json: string }>(
            "SELECT retraction_json FROM messages WHERE message_id = ?",
            dueMessage.id,
          )
          .one();
        const retraction = JSON.parse(row.retraction_json) as {
          eraseAfter: string;
        };
        retraction.eraseAfter = "2000-01-01T00:00:00.000Z";
        state.storage.sql.exec(
          "UPDATE messages SET retraction_json = ? WHERE message_id = ?",
          JSON.stringify(retraction),
          dueMessage.id,
        );
        state.storage.sql.exec(
          `UPDATE message_erasure_schedule
           SET erase_after = ?, next_attempt_at_ms = 0 WHERE message_id = ?`,
          retraction.eraseAfter,
          dueMessage.id,
        );
        await instance.alarm();
        await instance.alarm();
        await instance.alarm();
      },
    );
    await runInDurableObject(conversation, (_instance, state) => {
      const due = state.storage.sql
        .exec<{ status: string; cursor: number }>(
          "SELECT status, cursor FROM messages WHERE message_id = ?",
          dueMessage.id,
        )
        .one();
      expect(due.status).toBe("erased");
      expect(due.cursor).toBeGreaterThan(dueMessage.cursor + 1);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ? AND status = 'active'",
            activeMessage.id,
          )
          .one().count,
      ).toBe(0);
    });
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(dueMessage.id),
      (_instance: MessageContentDO, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM destruction_proofs",
            )
            .one().count,
        ).toBe(1);
      },
    );
  });

  it("abandons a pending Reaction when Workspace access is revoked during attestation", async () => {
    const workspaceId = await createWorkspace();
    await addWorkspaceMember(workspaceId);
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const delayed = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000098",
      "👍",
      otherPunkId,
    );
    const adding = mutateReaction(delayed, "session-other");
    await expect
      .poll(() =>
        runInDurableObject(
          env.CONVERSATIONS.getByName(conversationId),
          (_instance, state) =>
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
              )
              .one().count,
        ),
      )
      .toBe(1);
    await removeWorkspaceMember(workspaceId);
    expect((await adding).status).toBe(403);
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
            )
            .one().count,
        ).toBe(0);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM message_reactions",
            )
            .one().count,
        ).toBe(0);
      },
    );
  });

  it("keeps a malformed attestation pending without journal or outbox", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const malformed = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000097",
    );
    expect((await mutateReaction(malformed)).status).toBe(503);
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_message_reaction_command",
            )
            .one().count,
        ).toBe(1);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM journal WHERE event_kind IN (50210, 50211)",
            )
            .one().count,
        ).toBe(0);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM outbox
               WHERE payload_json LIKE '%message-reaction.projection@1%'`,
            )
            .one().count,
        ).toBe(0);
      },
    );
    const beforeAlarm = Date.now();
    expect(
      await runDurableObjectAlarm(env.CONVERSATIONS.getByName(conversationId)),
    ).toBe(true);
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      async (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT attempts FROM pending_message_reaction_command",
            )
            .one().attempts,
        ).toBe(2);
        expect(await state.storage.getAlarm()).toBeGreaterThanOrEqual(
          beforeAlarm + 3_000,
        );
      },
    );
  });

  it("rejects unauthenticated, spoofed, Bot, mismatched and conflicting commands", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const command = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000060",
    );
    expect((await mutateReaction(command, "missing")).status).toBe(401);
    expect((await mutateReaction(command, "session-other")).status).toBe(403);
    expect(
      (await mutateReaction(command, "session-owner", "wrong")).status,
    ).toBe(400);
    const bot = {
      ...command,
      actor: {
        kind: "bot" as const,
        installationId: "00000000-0000-8000-8000-000000000099",
      },
    };
    expect((await mutateReaction(bot)).status).toBe(403);
    await expect(
      env.CONVERSATIONS.getByName(conversationId).mutateMessageReaction({
        command: bot,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    const mismatch = { ...command, messageId: crypto.randomUUID() };
    expect((await mutateReaction(mismatch)).status).toBe(404);
    expect((await mutateReaction(command)).status).toBe(201);
    expect(
      (
        await mutateReaction({
          ...command,
          payload: { reaction: "👍" },
        })
      ).status,
    ).toBe(409);
  });

  it("fails closed on a malformed Workspace authorization result before attestation", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const conversation = env.CONVERSATIONS.getByName(conversationId);
    const originalWorkspaces = env.WORKSPACES;
    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      (instance as unknown as { env: ApiEnv }).env.WORKSPACES = {
        getByName: () => ({
          authorize: async () => ({
            ok: true,
            role: "owner",
            workspaceCursor: "not-a-cursor",
            visibility: "private",
          }),
        }),
      } as unknown as ApiEnv["WORKSPACES"];
    });
    const response = await mutateReaction(
      reactionCommand(
        "message.reaction-add@1",
        workspaceId,
        conversationId,
        message.id,
        "04000000-0000-4000-8000-000000000070",
      ),
    );
    expect(response.status).toBe(403);
    await runInDurableObject(conversation, async (instance: ConversationDO) => {
      (instance as unknown as { env: ApiEnv }).env.WORKSPACES =
        originalWorkspaces;
    });
  });

  it("fails closed on contradictory or mismatched Conversation RPC success", async () => {
    const workspaceId = await createWorkspace();
    const conversationId = await createConversation(workspaceId);
    const message = await postMessage(workspaceId, conversationId);
    const command = reactionCommand(
      "message.reaction-add@1",
      workspaceId,
      conversationId,
      message.id,
      "04000000-0000-4000-8000-000000000071",
    );
    const rawResponses: unknown[] = [
      {
        ok: true,
        response: { reaction: null, effect: "removed", replayed: false },
      },
      {
        ok: true,
        response: {
          reaction: {
            id: "04000000-0000-4000-8000-000000000072",
            workspaceId,
            conversationId,
            messageId: message.id,
            actor: { kind: "punk", punkId: ownerPunkId },
            reaction: "👍",
            reactedAt: new Date().toISOString(),
          },
          effect: "added",
          replayed: false,
        },
      },
    ];
    for (const rawResponse of rawResponses) {
      const fakeEnv = {
        ...env,
        CONVERSATIONS: {
          getByName: () => ({
            mutateMessageReaction: async () => rawResponse,
          }),
        },
      } as unknown as ApiEnv;
      const response = await route(
        new Request(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${message.id}/reactions/add`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": command.commandId,
            },
            body: JSON.stringify(command),
          },
        ),
        fakeEnv,
      );
      const text = await response.text();
      expect(response.status, text).toBe(503);
      expect(text).not.toMatch(
        /👍|removed|reactionId|roster|event|pubkey|sig/i,
      );
    }
  });
});
