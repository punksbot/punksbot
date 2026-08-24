import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  PostMessageCommand,
  MessageView,
  RemoveWorkspaceMemberCommand,
  SetWorkspaceMemberRoleCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "@punks/core";
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
    payload: { slug, name: "Message tests", visibility: "private" },
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

async function addMember(workspaceId: string, commandId: string) {
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId,
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
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function removeMember(workspaceId: string, commandId: string) {
  const command: RemoveWorkspaceMemberCommand = {
    contract: "workspace.member-remove@1",
    commandId,
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
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function createConversation(
  workspaceId: string,
  commandId: string,
  visibility: "open" | "private" = "open",
) {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      name: `messages-${commandId.slice(0, 6)}`,
      type: "stream",
      visibility,
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

function postCommand(
  workspaceId: string,
  conversationId: string,
  commandId: string,
  overrides: Partial<PostMessageCommand["payload"]> = {},
): PostMessageCommand {
  return {
    contract: "message.post@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      content: "Premier message chiffré",
      replyToMessageId: null,
      broadcast: false,
      topic: "Sujet secret",
      mentionedPunkIds: [],
      mediaIds: [],
      ...overrides,
    },
  };
}

async function postMessage(
  command: PostMessageCommand,
  session = "session-owner",
) {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${command.workspaceId}/conversations/${command.conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

function messageIdFor(command: PostMessageCommand) {
  return deriveOpaqueUuid(
    "punks.message.v1",
    canonicalJson({
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      commandId: command.commandId,
    }),
  );
}

describe("Punks Message post API", () => {
  it("finalizes committed content autonomously and blocks projection until then", async () => {
    const workspaceId = await createWorkspace(
      "5f6f2fd6-533f-46c9-b8db-3a3fcd4fa702",
      "message-finalization-saga",
    );
    const conversationId = await createConversation(
      workspaceId,
      "95024b10-ffcc-4545-a6e9-b42008fcb171",
    );
    const command = postCommand(
      workspaceId,
      conversationId,
      "ae14f42a-8762-4e2e-bd7b-c2fbaddf3f18",
      { content: "finalisation autonome", topic: "Saga chiffrée" },
    );
    const messageId = await messageIdFor(command);

    const posting = postMessage(command);
    await expect
      .poll(async () =>
        runInDurableObject(
          env.MESSAGE_CONTENT.getByName(messageId),
          (_instance, state) =>
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM content_versions WHERE status = 'staged'",
              )
              .one().count,
        ),
      )
      .toBe(1);
    const objectKey = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ object_key: string }>(
            "SELECT object_key FROM content_versions",
          )
          .one().object_key,
    );
    const stagedObject = await env.CONTENT_BUCKET.get(objectKey);
    expect(stagedObject).not.toBeNull();
    if (stagedObject === null) {
      return;
    }
    const ciphertext = await stagedObject.arrayBuffer();
    await env.CONTENT_BUCKET.delete(objectKey);

    const first = await posting;
    expect(first.status).toBe(503);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      code: "temporarily_unavailable",
    });
    const blocked = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        messages: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages")
          .one().count,
        finalizations: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM content_finalization",
          )
          .one().count,
        outbox: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
        enqueuedThrough: state.storage.sql
          .exec<{ cursor: number }>(
            `SELECT enqueued_through_cursor AS cursor
             FROM projection_delivery_state WHERE singleton = 1`,
          )
          .one().cursor,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }),
    );
    expect(blocked).toMatchObject({ messages: 1, finalizations: 1, outbox: 1 });
    expect(blocked.enqueuedThrough).toBe(blocked.cursor - 1);

    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      async (_instance, state) => {
        state.storage.sql.exec("UPDATE content_versions SET expires_at_ms = 0");
        await state.storage.setAlarm(Date.now());
      },
    );
    await env.ERASURE_REGISTRY.fetch("https://fixture/__test/mode", {
      method: "POST",
      body: JSON.stringify({ lookup: "unavailable" }),
    });
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      async (instance) => instance.alarm?.(),
    );
    const protectedContent = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ status: string; commit_claimed: number }>(
            "SELECT status, commit_claimed FROM content_versions",
          )
          .one(),
    );
    expect(protectedContent).toEqual({ status: "staged", commit_claimed: 1 });

    await env.CONTENT_BUCKET.put(objectKey, ciphertext);
    await env.ERASURE_REGISTRY.fetch("https://fixture/__test/mode", {
      method: "POST",
      body: JSON.stringify({ lookup: "available" }),
    });
    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      async (instance, state) => {
        state.storage.sql.exec(
          "UPDATE content_finalization SET next_attempt_at_ms = 0",
        );
        await state.storage.deleteAlarm();
        const repair = Reflect.get(
          instance,
          "repairDurableAlarm",
        ) as () => Promise<void>;
        await repair.call(instance);
        expect(await state.storage.getAlarm()).not.toBeNull();
      },
    );

    expect(
      await runDurableObjectAlarm(env.CONVERSATIONS.getByName(conversationId)),
    ).toBe(true);

    const reconciled = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        finalizations: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM content_finalization",
          )
          .one().count,
        outbox: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
        enqueuedThrough: state.storage.sql
          .exec<{ cursor: number }>(
            `SELECT enqueued_through_cursor AS cursor
             FROM projection_delivery_state WHERE singleton = 1`,
          )
          .one().cursor,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }),
    );
    expect(reconciled.finalizations).toBe(0);
    expect(reconciled.outbox).toBe(0);
    expect(reconciled.enqueuedThrough).toBe(reconciled.cursor);
    const finalizedStatus = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ status: string }>("SELECT status FROM content_versions")
          .one().status,
    );
    expect(finalizedStatus).toBe("finalized");

    const replay = await postMessage(command);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
  });

  it("abandons a pending Message when the Punk is revoked before attestation retry", async () => {
    const workspaceId = await createWorkspace(
      "87713bc6-287d-46ca-ad89-639436eadc41",
      "message-pending-reauth",
    );
    await addMember(workspaceId, "c99708a2-ee4c-4b98-9d5e-47b35cdfb980");
    const conversationId = await createConversation(
      workspaceId,
      "ef91e339-8680-4f22-917d-f705345081ff",
    );
    const command: PostMessageCommand = {
      ...postCommand(
        workspaceId,
        conversationId,
        "8a3837bd-6d5b-4f43-b5a5-cd50208a2c53",
        { content: "retry-attestation-message-pending-reauth" },
      ),
      actor: { kind: "punk", punkId: otherPunkId },
    };
    const resetFailure = await env.ATTESTATION.fetch(
      "https://fixture/__test/fail-once",
      {
        method: "POST",
        body: JSON.stringify({ commandId: command.commandId }),
      },
    );
    expect(resetFailure.ok).toBe(true);
    const first = await postMessage(command, "session-other");
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: "attestation_failed",
    });
    const messageId = await messageIdFor(command);

    await removeMember(workspaceId, "f87ccb05-5a5e-46c5-8688-5592ae72105a");
    expect(
      await runDurableObjectAlarm(env.CONVERSATIONS.getByName(conversationId)),
    ).toBe(true);

    const aggregate = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        messages: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages")
          .one().count,
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_command_results",
          )
          .one().count,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_message_command",
          )
          .one().count,
        messageJournal: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM journal WHERE event_kind = 50200",
          )
          .one().count,
        messageOutbox: state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM outbox
             WHERE payload_json LIKE '%message.post@1%'`,
          )
          .one().count,
      }),
    );
    expect(aggregate).toEqual({
      messages: 0,
      results: 0,
      pending: 0,
      messageJournal: 0,
      messageOutbox: 0,
    });
    const staged = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            status: string;
            expires_at_ms: number | null;
            commit_claimed: number;
          }>(
            `SELECT status, expires_at_ms, commit_claimed
             FROM content_versions`,
          )
          .one(),
    );
    expect(staged.status).toBe("staged");
    expect(staged.expires_at_ms).not.toBeNull();
    expect(staged.commit_claimed).toBe(0);
    const attestationCalls = await env.ATTESTATION.fetch(
      "https://fixture/__test/calls",
    ).then((response) =>
      response.json<{
        calls: Array<{
          purpose: string;
          event: { tags: string[][] };
        }>;
      }>(),
    );
    expect(
      attestationCalls.calls.filter(
        (call) =>
          call.purpose === "message-journal" &&
          call.event.tags.some(
            (tag) => tag[0] === "command" && tag[1] === command.commandId,
          ),
      ),
    ).toHaveLength(1);
  });

  it("rejects a contract-valid body whose canonical UTF-8 envelope exceeds 64 KiB", async () => {
    const workspaceId = await createWorkspace(
      "09e23f13-cc1c-40d5-8de3-fb17517053d6",
      "message-envelope-limit",
    );
    const conversationId = await createConversation(
      workspaceId,
      "9ee70d53-bc2c-4393-9258-b9cf657084e7",
    );
    const command = postCommand(
      workspaceId,
      conversationId,
      "2d6bcb85-7a17-4d81-b674-7f7224120a8d",
      { content: "a".repeat(65_536), topic: null },
    );

    const response = await postMessage(command);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "payload_too_large",
    });
  });

  it("posts a root Message with a bounded attested event and encrypted topic/content", async () => {
    const workspaceId = await createWorkspace(
      "2c40f5ee-e68b-4e73-bdbf-d3cd44cfa460",
      "message-root",
    );
    await addMember(workspaceId, "93d475de-54ab-48aa-b49b-c64560d77355");
    const conversationId = await createConversation(
      workspaceId,
      "ca36dd8d-566d-4f2b-8257-4f3f06cc1793",
    );
    const command = postCommand(
      workspaceId,
      conversationId,
      "0b52625b-1275-42c0-b500-27c95b874706",
    );

    const response = await postMessage(command);

    const responseText = await response.text();
    expect(response.status, responseText).toBe(201);
    const body = JSON.parse(responseText) as {
      message: MessageView;
      replayed: boolean;
    };
    expect(body).toMatchObject({
      message: {
        workspaceId,
        conversationId,
        status: "active",
        content: command.payload.content,
        topic: command.payload.topic,
        currentVersion: 1,
        replyCount: 0,
        descendantCount: 0,
      },
      replayed: false,
    });
    expect(
      validateContract("punks://contracts/message.view@1", body.message),
    ).toEqual({ valid: true });
    expect(body.message).not.toHaveProperty("topicPresent");
    expect(body.message).not.toHaveProperty("contentVersions");
    expect(body.message).not.toHaveProperty("originalContentCommitment");
    expect(body.message).not.toHaveProperty("retraction");
    expect(body.message).not.toHaveProperty("erasureMarker");
    expect(body.message).not.toHaveProperty("contentKeyId");
    expect(body.message).not.toHaveProperty("ciphertextRef");
    expect(body).not.toHaveProperty("event");
    expect(body).not.toHaveProperty("content");
    expect(body).not.toHaveProperty("cursor");
    expect(body.message.id).toBe(await messageIdFor(command));
    expect(body.message.createdCursor).toBe(body.message.cursor);

    const journalEvent = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) =>
        JSON.parse(
          state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE event_kind = 50200",
            )
            .one().event_json,
        ) as { kind: number; content: string },
    );
    expect(journalEvent.kind).toBe(50200);
    expect(journalEvent.content).not.toContain(command.payload.content);
    expect(journalEvent.content).not.toContain(command.payload.topic);
  });

  it("posts an unjoined Punk reply, updates thread counters, and replays idempotently", async () => {
    const workspaceId = await createWorkspace(
      "d96dfe6b-117d-4f30-b959-414070307526",
      "message-replies",
    );
    await addMember(workspaceId, "ac8e9652-528e-4e54-94fc-d4e9db948da0");
    const conversationId = await createConversation(
      workspaceId,
      "1d5c50c8-361c-4666-863b-7f27e5161a53",
    );
    const root = postCommand(
      workspaceId,
      conversationId,
      "805a360c-57bc-4574-92ec-bbd2f093e36d",
      { topic: null },
    );
    const rootResponse = await postMessage(root);
    expect(rootResponse.status).toBe(201);
    const rootBody = (await rootResponse.json()) as {
      message: { id: string; createdCursor: number };
    };

    const reply: PostMessageCommand = {
      ...postCommand(
        workspaceId,
        conversationId,
        "913db41f-a3c2-41be-9dcf-e4b7e667438d",
        {
          content: "Réponse par membre non joint",
          topic: null,
          replyToMessageId: rootBody.message.id,
        },
      ),
      actor: { kind: "punk", punkId: otherPunkId },
    };
    const posted = await postMessage(reply, "session-other");
    expect(posted.status).toBe(201);
    const postedBody = (await posted.json()) as {
      message: { id: string; createdCursor: number; parentMessageId: string };
    };
    expect(postedBody.message.parentMessageId).toBe(rootBody.message.id);

    const counters = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            reply_count: number;
            descendant_count: number;
            created_cursor: number;
            cursor: number;
          }>(
            `SELECT reply_count, descendant_count, created_cursor, cursor
             FROM messages WHERE message_id = ?`,
            rootBody.message.id,
          )
          .one(),
    );
    expect(counters).toMatchObject({
      reply_count: 1,
      descendant_count: 1,
      created_cursor: rootBody.message.createdCursor,
    });
    expect(counters.cursor).toBe(postedBody.message.createdCursor);

    const replay = await postMessage(reply, "session-other");
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      message: { id: postedBody.message.id },
      replayed: true,
    });
    const conflict = await postMessage(
      {
        ...reply,
        payload: { ...reply.payload, content: "payload différent" },
      },
      "session-other",
    );
    expect(conflict.status).toBe(409);
  });

  it("denies private non-members and public Bot spoofing", async () => {
    const workspaceId = await createWorkspace(
      "6910577b-e68f-4f15-bec0-62181685aaca",
      "message-access",
    );
    await addMember(workspaceId, "0107f07a-5b6d-41fd-94c5-3618d08cf3bc");
    const privateConversationId = await createConversation(
      workspaceId,
      "465f7d07-127f-4b1a-81f3-0179ec409536",
      "private",
    );
    const denied: PostMessageCommand = {
      ...postCommand(
        workspaceId,
        privateConversationId,
        "83efcbad-6c1d-4019-8843-96a8e28ac5ec",
      ),
      actor: { kind: "punk", punkId: otherPunkId },
    };
    expect((await postMessage(denied, "session-other")).status).toBe(403);

    const botCommand: PostMessageCommand = {
      ...postCommand(
        workspaceId,
        privateConversationId,
        "9dac833b-448d-4c34-837b-fc6010fc5dce",
      ),
      actor: {
        kind: "bot",
        installationId: "54d815ef-2cd1-4759-832a-115d70dc894e",
      },
    };
    expect((await postMessage(botCommand)).status).toBe(403);
  });

  it("rejects foreign parents and garbage-collects their precommit content", async () => {
    const workspaceId = await createWorkspace(
      "06807c6d-f2ae-4150-9578-481ae8eb5f71",
      "message-parent-scope",
    );
    const firstConversationId = await createConversation(
      workspaceId,
      "d78cad23-0354-4ee2-9125-4e26219dd6db",
    );
    const secondConversationId = await createConversation(
      workspaceId,
      "54285809-d510-4eb8-a6c7-588812324311",
    );
    const root = postCommand(
      workspaceId,
      firstConversationId,
      "21be2a9c-c78e-468e-96cd-fda16cc33eb4",
    );
    const rootResponse = await postMessage(root);
    const rootId = ((await rootResponse.json()) as { message: { id: string } })
      .message.id;
    const foreignReply = postCommand(
      workspaceId,
      secondConversationId,
      "9154362c-4cb0-4192-a4a8-214132507f6a",
      { replyToMessageId: rootId },
    );
    expect((await postMessage(foreignReply)).status).toBe(409);
    const orphanId = await messageIdFor(foreignReply);
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(orphanId),
      async (_instance, state) => {
        state.storage.sql.exec("UPDATE content_versions SET expires_at_ms = 0");
        await state.storage.setAlarm(Date.now());
      },
    );
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(orphanId),
      async (instance) => instance.alarm?.(),
    );
    const orphanArchived = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(orphanId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM expired_content_history",
          )
          .one().count,
    );
    expect(orphanArchived).toBe(1);

    const otherWorkspaceId = await createWorkspace(
      "00e7b8d9-8a08-4f83-9378-a40e81818710",
      "message-parent-other-workspace",
    );
    const otherConversationId = await createConversation(
      otherWorkspaceId,
      "ff56e261-456b-4c9f-98fe-1cd517e024fb",
    );
    const crossWorkspaceReply = postCommand(
      otherWorkspaceId,
      otherConversationId,
      "eb34da1e-1457-4467-8a71-a71431286622",
      { replyToMessageId: rootId },
    );
    expect((await postMessage(crossWorkspaceReply)).status).toBe(409);
  });

  it("keeps content/topic out of aggregate storage and recovers finalize after commit", async () => {
    const workspaceId = await createWorkspace(
      "57c56c01-eeba-439f-b77b-20eebc858e82",
      "message-confidential",
    );
    const conversationId = await createConversation(
      workspaceId,
      "14d8164e-fe39-4701-a1bd-130418beaa99",
    );
    const command = postCommand(
      workspaceId,
      conversationId,
      "94ff197a-4425-43d6-946f-c2fc39e20b23",
      {
        content: "PLAINTEXT_SENTINEL_c0c88f",
        topic: "TOPIC_SENTINEL_dac4aa",
      },
    );
    const posted = await postMessage(command);
    expect(posted.status).toBe(201);
    const body = (await posted.json()) as { message: { id: string } };
    const stored = await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      (_instance, state) => ({
        messages: state.storage.sql.exec("SELECT * FROM messages").toArray(),
        versions: state.storage.sql
          .exec("SELECT * FROM message_versions")
          .toArray(),
        journal: state.storage.sql.exec("SELECT * FROM journal").toArray(),
        outbox: state.storage.sql.exec("SELECT * FROM outbox").toArray(),
        results: state.storage.sql
          .exec("SELECT * FROM message_command_results")
          .toArray(),
      }),
    );
    expect(JSON.stringify(stored)).not.toContain(command.payload.content);
    expect(JSON.stringify(stored)).not.toContain(command.payload.topic);
    expect(JSON.stringify(stored)).not.toContain(
      await sha256Hex(canonicalJson(command)),
    );
    expect(JSON.stringify(stored)).not.toContain(
      await sha256Hex(command.payload.content),
    );
    const vault = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(body.message.id),
      (_instance, state) => ({
        rows: state.storage.sql
          .exec("SELECT * FROM content_versions")
          .toArray(),
        objectKey: state.storage.sql
          .exec<{ object_key: string }>(
            "SELECT object_key FROM content_versions",
          )
          .one().object_key,
      }),
    );
    expect(JSON.stringify(vault.rows)).not.toContain(command.payload.content);
    expect(JSON.stringify(vault.rows)).not.toContain(command.payload.topic);
    const ciphertext = await env.CONTENT_BUCKET.get(vault.objectKey);
    expect(ciphertext).not.toBeNull();
    if (ciphertext === null) {
      return;
    }
    const ciphertextText = new TextDecoder().decode(
      await ciphertext.arrayBuffer(),
    );
    expect(ciphertextText).not.toContain(command.payload.content);
    expect(ciphertextText).not.toContain(command.payload.topic);

    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(body.message.id),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE content_versions
           SET status = 'staged', finalized_at = NULL,
               expires_at_ms = ?`,
          Date.now() + 60_000,
        );
      },
    );
    const replay = await postMessage(command);
    expect(replay.status).toBe(200);
    const finalized = await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(body.message.id),
      (_instance, state) =>
        state.storage.sql
          .exec<{ status: string }>("SELECT status FROM content_versions")
          .one().status,
    );
    expect(finalized).toBe("finalized");
  });
});
