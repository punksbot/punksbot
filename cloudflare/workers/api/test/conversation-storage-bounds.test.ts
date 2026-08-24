import type {
  AddMessageReactionCommand,
  BotActionAdmission,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  DeliverBotActionCommand,
  InstallBotCommand,
  PostMessageCommand,
  RemoveMessageReactionCommand,
  RestoreMessageCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  deriveBotInstallationId,
  deriveOpaqueUuid,
} from "@punks/core";
import {
  env,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ConversationDO } from "../src/conversation-do";

const punkId = "00000000-0000-8000-8000-000000000001";
const normalOutboxRows = 256;
const normalOutboxBytes = 2_097_152;
const normalContentFinalizationRows = 256;
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

async function conversationWithBot(): Promise<{
  workspaceId: string;
  conversationId: string;
  messageId: string;
  botId: string;
  installationId: string;
}> {
  const workspaceCommand: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId },
    payload: {
      slug: `conversation-bounds-${crypto.randomUUID().slice(0, 8)}`,
      name: "Conversation storage bounds",
      visibility: "private",
    },
  };
  const workspaceResponse = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": workspaceCommand.commandId,
      },
      body: JSON.stringify(workspaceCommand),
    },
  );
  expect(workspaceResponse.status, await workspaceResponse.clone().text()).toBe(
    201,
  );
  const workspaceId = (
    (await workspaceResponse.json()) as { workspace: { id: string } }
  ).workspace.id;

  const conversationCommand: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "Bounded Bot target",
      type: "stream",
      visibility: "private",
    },
  };
  const conversationResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": conversationCommand.commandId,
      },
      body: JSON.stringify(conversationCommand),
    },
  );
  expect(conversationResponse.status).toBe(201);
  const conversationId = (
    (await conversationResponse.json()) as { conversation: { id: string } }
  ).conversation.id;

  const post: PostMessageCommand = {
    contract: "message.post@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId },
    payload: {
      content: "Bot Reaction storage target",
      replyToMessageId: null,
      broadcast: false,
      topic: null,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const messageResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": post.commandId,
      },
      body: JSON.stringify(post),
    },
  );
  expect(messageResponse.status).toBe(201);
  const messageId = (
    (await messageResponse.json()) as { message: { id: string } }
  ).message.id;

  const botId = await deriveOpaqueUuid(
    "punks.test.conversation-storage-bounds.bot.v1",
    workspaceId,
  );
  const installationId = await deriveBotInstallationId(workspaceId, botId);
  const now = new Date().toISOString();
  await runInDurableObject(env.BOTS.getByName(botId), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)",
      JSON.stringify({
        id: botId,
        slug: "bounded-reactor",
        name: "Bounded reactor",
        description: "Punks-operated",
        status: "published",
        configContractId: "punks://contracts/bot.config.empty@1",
        supportedActionContracts: [
          "message.reaction-add@1",
          "message.reaction-remove@1",
          "message.reaction-toggle@1",
        ],
        revision: 1,
        cursor: 1,
        createdAt: now,
        updatedAt: now,
        suspendedAt: null,
        withdrawnAt: null,
      }),
    );
  });
  const install: InstallBotCommand = {
    contract: "bot-installation.install@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    botId,
    actor: { kind: "punk", punkId },
    payload: {
      config: {
        contractId: "punks://contracts/bot.config.empty@1",
        value: {},
      },
    },
  };
  const installResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": install.commandId,
      },
      body: JSON.stringify(install),
    },
  );
  expect(installResponse.status, await installResponse.clone().text()).toBe(
    201,
  );
  await runInDurableObject(
    env.BOT_INSTALLATIONS.getByName(installationId),
    (_instance, state) => {
      const installed = JSON.parse(
        state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM installation_state WHERE singleton = 1",
          )
          .one().state_json,
      ) as { grantCount: number };
      state.storage.sql.exec(
        "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify({ ...installed, grantCount: 1 }),
      );
      state.storage.sql.exec(
        `INSERT INTO grants
          (capability, resource_kind, resource_id, enabled, updated_cursor,
           enabled_at, tombstoned_at)
         VALUES ('messages.react', 'conversation', ?, 1, 1, ?, NULL)`,
        conversationId,
        now,
      );
    },
  );
  return { workspaceId, conversationId, messageId, botId, installationId };
}

function admitted(value: unknown): {
  admissionId: string;
  admission: BotActionAdmission;
  proof: SignedNostrEvent;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Reflect.get(value, "ok") !== true
  ) {
    throw new Error(`Bot admission failed: ${JSON.stringify(value)}`);
  }
  const admissionId = Reflect.get(value, "admissionId");
  const admission = Reflect.get(value, "admission");
  const proof = Reflect.get(value, "proof");
  if (
    typeof admissionId !== "string" ||
    !validateContract("punks://contracts/bot-action.admission@1", admission)
      .valid ||
    !validateContract("punks://contracts/nostr.signed-event@1", proof).valid
  ) {
    throw new Error("Bot admission was malformed");
  }
  return {
    admissionId,
    admission: admission as BotActionAdmission,
    proof: proof as SignedNostrEvent,
  };
}

async function admitReaction(
  coordinates: Awaited<ReturnType<typeof conversationWithBot>>,
  contract:
    | "message.reaction-add@1"
    | "message.reaction-remove@1"
    | "message.reaction-toggle@1",
  reaction: string,
): Promise<DeliverBotActionCommand> {
  const nonce = crypto.randomUUID();
  const actionId = await deriveOpaqueUuid(
    "punks.test.conversation-storage-bounds.action.v1",
    nonce,
  );
  const invocationId = await deriveOpaqueUuid(
    "punks.test.conversation-storage-bounds.invocation.v1",
    nonce,
  );
  const jti = await deriveOpaqueUuid(
    "punks.test.conversation-storage-bounds.jti.v1",
    nonce,
  );
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const command = {
    contract: "bot-action.execute@1",
    credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
    invocationId,
    actionId,
    workspaceId: coordinates.workspaceId,
    installationId: coordinates.installationId,
    botId: coordinates.botId,
    authorityGeneration: 1,
    action: {
      contract,
      conversationId: coordinates.conversationId,
      messageId: coordinates.messageId,
      payload: { reaction },
    },
  } as const;
  const installation = env.BOT_INSTALLATIONS.getByName(
    coordinates.installationId,
  );
  const result = admitted(
    await installation.admitBotAction({
      command,
      credential: {
        jti,
        issuedAt: nowSeconds,
        notBefore: nowSeconds,
        expiresAt: nowSeconds + 60,
      },
      admissionCommandId: await deriveOpaqueUuid(
        "punks.bot-action-admit-command.v1",
        `${coordinates.installationId}\u0000${actionId}`,
      ),
    }),
  );
  return runInDurableObject(installation, (_instance, state) => {
    const delivery = JSON.parse(
      state.storage.sql
        .exec<{ request_json: string }>(
          "SELECT request_json FROM action_deliveries WHERE action_id = ?",
          actionId,
        )
        .one().request_json,
    ) as DeliverBotActionCommand;
    expect(delivery.admissionId).toBe(result.admissionId);
    expect(canonicalJson(delivery.proof)).toBe(canonicalJson(result.proof));
    return delivery;
  });
}

describe("ConversationDO storage bounds", () => {
  it("spends a liability reserve on Bot Reaction removal and refuses a new add at N+1", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    const add = await admitReaction(
      coordinates,
      "message.reaction-add@1",
      "🔥",
    );
    const firstResult = await conversation.executeBotReaction(add);
    expect(firstResult, JSON.stringify(firstResult)).toMatchObject({
      ok: true,
    });
    await runInDurableObject(conversation, (instance: ConversationDO) =>
      instance.alarm(),
    );
    const remove = await admitReaction(
      coordinates,
      "message.reaction-remove@1",
      "🔥",
    );
    const blockedAdd = await admitReaction(
      coordinates,
      "message.reaction-add@1",
      "🔥",
    );

    let queueSnapshot: BindingSnapshot | undefined;
    try {
      await runInDurableObject(
        conversation,
        (instance: ConversationDO, state) => {
          state.storage.sql.exec("DELETE FROM outbox");
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
            send: async () => {
              throw new Error("projection queue unavailable");
            },
          });
          state.storage.transactionSync(() => {
            for (let index = 0; index < normalOutboxRows; index += 1) {
              state.storage.sql.exec(
                `INSERT INTO outbox
                  (event_id, cursor, payload_json, delivered_at, attempts)
                 VALUES (?, ?, '{}', NULL, 0)`,
                index.toString(16).padStart(64, "0"),
                10_000 + index,
              );
            }
          });
        },
      );
      await expect(
        conversation.executeBotReaction(remove),
      ).resolves.toMatchObject({ ok: true });

      const beforeBlockedAdd = await runInDurableObject(
        conversation,
        (_instance, state) => {
          return {
            cursor: JSON.parse(
              state.storage.sql
                .exec<{ state_json: string }>(
                  "SELECT state_json FROM conversation_state WHERE singleton = 1",
                )
                .one().state_json,
            ).cursor as number,
            journal: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
              .one().count,
            results: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM message_reaction_command_results",
              )
              .one().count,
            outbox: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
              .one().count,
          };
        },
      );
      await expect(
        conversation.executeBotReaction(blockedAdd),
      ).resolves.toEqual({
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "temporarily_unavailable",
      });
      await runInDurableObject(conversation, (_instance, state) => {
        expect({
          cursor: JSON.parse(
            state.storage.sql
              .exec<{ state_json: string }>(
                "SELECT state_json FROM conversation_state WHERE singleton = 1",
              )
              .one().state_json,
          ).cursor as number,
          journal: state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
            .one().count,
          results: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM message_reaction_command_results",
            )
            .one().count,
          outbox: state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
        }).toEqual(beforeBlockedAdd);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM message_reactions
               WHERE actor_kind = 'bot' AND status = 'active'`,
            )
            .one().count,
        ).toBe(0);
      });
    } finally {
      const snapshot = queueSnapshot;
      if (snapshot !== undefined) {
        await runInDurableObject(conversation, (instance: ConversationDO) => {
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          restoreBinding(bindings, "PROJECTION_QUEUE", snapshot);
        });
      }
    }
  });

  it("accepts the Nth Reaction no-op receipt and rejects N+1 without mutation", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    const command = async (
      suffix: string,
    ): Promise<AddMessageReactionCommand> => ({
      contract: "message.reaction-add@1",
      commandId: await deriveOpaqueUuid(
        "punks.test.conversation-storage-bounds.reaction-command.v1",
        `${coordinates.messageId}\u0000${suffix}`,
      ),
      workspaceId: coordinates.workspaceId,
      conversationId: coordinates.conversationId,
      messageId: coordinates.messageId,
      actor: { kind: "punk", punkId },
      payload: { reaction: "✅" },
    });
    await expect(
      conversation.mutateMessageReaction({ command: await command("add") }),
    ).resolves.toMatchObject({ ok: true });
    await runInDurableObject(conversation, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 1; index < normalOutboxRows - 1; index += 1) {
          const id = index.toString(16).padStart(64, "0");
          state.storage.sql.exec(
            `INSERT INTO message_reaction_command_results
              (command_id, semantic_hash, reaction_id, command_record_json,
               committed_cursor, committed_at)
             VALUES (?, ?, ?, '{}', NULL, ?)`,
            `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
            id,
            id,
            new Date().toISOString(),
          );
        }
      });
    });

    await expect(
      conversation.mutateMessageReaction({ command: await command("nth") }),
    ).resolves.toMatchObject({ ok: true });
    const before = await runInDurableObject(
      conversation,
      (_instance, state) => ({
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reaction_command_results",
          )
          .one().count,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }),
    );
    expect(before.results).toBe(normalOutboxRows);
    await expect(
      conversation.mutateMessageReaction({
        command: await command("n-plus-1"),
      }),
    ).resolves.toEqual({ ok: false, code: "internal" });
    await runInDurableObject(conversation, (_instance, state) => {
      expect({
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reaction_command_results",
          )
          .one().count,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }).toEqual(before);
    });
  });

  it("accepts the Nth Message no-op receipt and rejects N+1 without mutation", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    const command = (suffix: string): RestoreMessageCommand => ({
      contract: "message.restore@1",
      commandId: `10000000-0000-8000-8000-${suffix.padStart(12, "0")}`,
      workspaceId: coordinates.workspaceId,
      conversationId: coordinates.conversationId,
      messageId: coordinates.messageId,
      actor: { kind: "punk", punkId },
      payload: {},
    });
    await runInDurableObject(conversation, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 1; index < normalOutboxRows - 1; index += 1) {
          const id = index.toString(16).padStart(64, "0");
          state.storage.sql.exec(
            `INSERT INTO message_command_results
              (command_id, payload_hash, request_fingerprint, response_json,
               committed_at)
             VALUES (?, ?, ?, '{}', ?)`,
            `20000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
            id,
            id,
            new Date().toISOString(),
          );
        }
      });
    });

    await expect(
      conversation.mutateMessage({
        messageId: coordinates.messageId,
        command: command("1"),
      }),
    ).resolves.toMatchObject({ ok: true, replayed: false });
    const before = await runInDurableObject(
      conversation,
      (_instance, state) => ({
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_command_results",
          )
          .one().count,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }),
    );
    expect(before.results).toBe(normalOutboxRows);
    await expect(
      conversation.mutateMessage({
        messageId: coordinates.messageId,
        command: command("2"),
      }),
    ).resolves.toEqual({ ok: false, code: "internal" });
    await runInDurableObject(conversation, (_instance, state) => {
      expect({
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_command_results",
          )
          .one().count,
        cursor: JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number,
      }).toEqual(before);
    });
  });

  it("deletes Queue-accepted outbox rows and cleans legacy delivered rows after eviction", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversation, (instance: ConversationDO) =>
      instance.alarm(),
    );
    const cursor = await runInDurableObject(
      conversation,
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
        ).toBe(0);
        const aggregateCursor = JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM conversation_state WHERE singleton = 1",
            )
            .one().state_json,
        ).cursor as number;
        expect(
          state.storage.sql
            .exec<{ enqueued_through_cursor: number }>(
              `SELECT enqueued_through_cursor
               FROM projection_delivery_state WHERE singleton = 1`,
            )
            .one().enqueued_through_cursor,
        ).toBe(aggregateCursor);
        state.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, '{}', ?, 0)`,
          "f".repeat(64),
          aggregateCursor,
          new Date().toISOString(),
        );
        return aggregateCursor;
      },
    );

    await evictDurableObject(conversation);
    await runInDurableObject(conversation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ enqueued_through_cursor: number }>(
            `SELECT enqueued_through_cursor
             FROM projection_delivery_state WHERE singleton = 1`,
          )
          .one().enqueued_through_cursor,
      ).toBe(cursor);
    });
  });

  it("keeps every undelivered projection in the hot journal while Queue is unavailable", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    let queueSnapshot: BindingSnapshot | undefined;
    try {
      await runInDurableObject(conversation, (instance: ConversationDO) => {
        const bindings = Reflect.get(instance, "env") as Record<
          string,
          unknown
        >;
        queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
          send: async () => {
            throw new Error("projection queue unavailable");
          },
        });
      });
      const reactionCommandId = async (suffix: string) =>
        deriveOpaqueUuid(
          "punks.test.conversation-storage-bounds.hot-journal.v1",
          `${coordinates.messageId}\u0000${suffix}`,
        );
      const add: AddMessageReactionCommand = {
        contract: "message.reaction-add@1",
        commandId: await reactionCommandId("add"),
        workspaceId: coordinates.workspaceId,
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        actor: { kind: "punk", punkId },
        payload: { reaction: "💾" },
      };
      await expect(
        conversation.mutateMessageReaction({ command: add }),
      ).resolves.toMatchObject({ ok: true });
      const remove: RemoveMessageReactionCommand = {
        ...add,
        contract: "message.reaction-remove@1",
        commandId: await reactionCommandId("remove"),
      };
      await expect(
        conversation.mutateMessageReaction({ command: remove }),
      ).resolves.toMatchObject({ ok: true });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await runInDurableObject(conversation, (instance: ConversationDO) =>
          instance.alarm(),
        );
      }
      await runInDurableObject(conversation, (_instance, state) => {
        const undelivered = state.storage.sql
          .exec<{ cursor: number }>(
            "SELECT cursor FROM outbox WHERE delivered_at IS NULL ORDER BY cursor",
          )
          .toArray();
        expect(undelivered.length).toBe(2);
        expect(
          state.storage.sql
            .exec<{ cursor: number }>(
              `SELECT journal.cursor FROM journal JOIN outbox USING (event_id)
             WHERE outbox.delivered_at IS NULL ORDER BY journal.cursor`,
            )
            .toArray()
            .map(({ cursor }) => cursor),
        ).toEqual(undelivered.map(({ cursor }) => cursor));
      });
    } finally {
      const snapshot = queueSnapshot;
      if (snapshot !== undefined) {
        await runInDurableObject(conversation, (instance: ConversationDO) => {
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          restoreBinding(bindings, "PROJECTION_QUEUE", snapshot);
        });
      }
    }
  });

  it("measures multibyte outbox pressure as UTF-8 bytes", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversation, (instance: ConversationDO) =>
      instance.alarm(),
    );
    const payload = JSON.stringify({ data: "💾".repeat(262_140) });
    expect(new TextEncoder().encode(payload).byteLength).toBe(1_048_571);
    expect(payload.length).toBeLessThan(600_000);
    let queueSnapshot: BindingSnapshot | undefined;
    try {
      await runInDurableObject(
        conversation,
        (instance: ConversationDO, state) => {
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
            send: async () => {
              throw new Error("projection queue unavailable");
            },
          });
          for (let index = 0; index < 2; index += 1) {
            state.storage.sql.exec(
              `INSERT INTO outbox
                (event_id, cursor, payload_json, delivered_at, attempts)
               VALUES (?, ?, ?, NULL, 0)`,
              `${index + 1}`.repeat(64),
              20_000 + index,
              payload,
            );
          }
          const usage = state.storage.sql
            .exec<{ text_length: number; byte_length: number }>(
              `SELECT SUM(length(payload_json)) AS text_length,
                      SUM(length(CAST(payload_json AS BLOB))) AS byte_length
               FROM outbox`,
            )
            .one();
          expect(usage.text_length).toBeLessThan(normalOutboxBytes);
          expect(usage.byte_length).toBe(normalOutboxBytes - 10);
        },
      );

      const command: AddMessageReactionCommand = {
        contract: "message.reaction-add@1",
        commandId: await deriveOpaqueUuid(
          "punks.test.conversation-storage-bounds.multibyte.v1",
          coordinates.messageId,
        ),
        workspaceId: coordinates.workspaceId,
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        actor: { kind: "punk", punkId },
        payload: { reaction: "🧮" },
      };
      await expect(
        conversation.mutateMessageReaction({ command }),
      ).resolves.toEqual({ ok: false, code: "internal" });
      await runInDurableObject(conversation, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM message_reaction_command_results",
            )
            .one().count,
        ).toBe(0);
      });
    } finally {
      const snapshot = queueSnapshot;
      if (snapshot !== undefined) {
        await runInDurableObject(conversation, (instance: ConversationDO) => {
          const bindings = Reflect.get(instance, "env") as Record<
            string,
            unknown
          >;
          restoreBinding(bindings, "PROJECTION_QUEUE", snapshot);
        });
      }
    }
  });

  it("admits exactly 126000 Queue payload bytes and rejects the next multibyte byte", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(
      conversation,
      (instance: ConversationDO, state) => {
        state.storage.sql.exec("DELETE FROM outbox");
        const exact = JSON.stringify(`${"💾".repeat(31_499)}xx`);
        const oversized = `${exact}x`;
        expect(new TextEncoder().encode(exact).byteLength).toBe(126_000);
        expect(exact.length).toBe(63_002);
        expect(new TextEncoder().encode(oversized).byteLength).toBe(126_001);
        const capacity = Reflect.get(instance, "hasOutboxCommitCapacity") as (
          payloadJson: string,
          liabilityDelta: number,
          safetyReduction: boolean,
        ) => boolean;
        expect(Reflect.apply(capacity, instance, [exact, 0, false])).toBe(true);
        expect(Reflect.apply(capacity, instance, [oversized, 0, false])).toBe(
          false,
        );
      },
    );
  });

  it("saturates a repeatedly failed projection attempt counter at 63", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversation, (instance: ConversationDO) =>
      instance.alarm(),
    );
    await runInDurableObject(
      conversation,
      async (instance: ConversationDO, state) => {
        const bindings = Reflect.get(instance, "env") as Record<
          string,
          unknown
        >;
        const queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
          send: async () => {
            throw new Error("projection queue unavailable");
          },
        });
        try {
          const enqueuedThrough = state.storage.sql
            .exec<{ cursor: number }>(
              `SELECT enqueued_through_cursor AS cursor
               FROM projection_delivery_state WHERE singleton = 1`,
            )
            .one().cursor;
          state.storage.sql.exec(
            `INSERT INTO outbox
              (event_id, cursor, payload_json, delivered_at, attempts)
             VALUES (?, ?, '{}', NULL, 63)`,
            "e".repeat(64),
            enqueuedThrough + 1,
          );
          await instance.alarm();
          expect(
            state.storage.sql
              .exec<{ attempts: number }>(
                "SELECT attempts FROM outbox WHERE event_id = ?",
                "e".repeat(64),
              )
              .one().attempts,
          ).toBe(63);
          state.storage.sql.exec(
            "DELETE FROM outbox WHERE event_id = ?",
            "e".repeat(64),
          );
        } finally {
          restoreBinding(bindings, "PROJECTION_QUEUE", queueSnapshot);
        }
      },
    );
  });

  it("keeps a substituted outbox snapshot after the prior payload was Queue-accepted", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversation, (instance: ConversationDO) =>
      instance.alarm(),
    );
    await runInDurableObject(
      conversation,
      async (instance: ConversationDO, state) => {
        let signalSendStarted: () => void = () => undefined;
        let releaseSend: () => void = () => undefined;
        const sendStarted = new Promise<void>((resolve) => {
          signalSendStarted = resolve;
        });
        const sendHold = new Promise<void>((resolve) => {
          releaseSend = resolve;
        });
        const bindings = Reflect.get(instance, "env") as Record<
          string,
          unknown
        >;
        const queueSnapshot = replaceBinding(bindings, "PROJECTION_QUEUE", {
          send: async () => {
            signalSendStarted();
            await sendHold;
          },
        });
        try {
          const enqueuedThrough = state.storage.sql
            .exec<{ cursor: number }>(
              `SELECT enqueued_through_cursor AS cursor
               FROM projection_delivery_state WHERE singleton = 1`,
            )
            .one().cursor;
          const eventId = "d".repeat(64);
          state.storage.sql.exec(
            `INSERT INTO outbox
              (event_id, cursor, payload_json, delivered_at, attempts)
             VALUES (?, ?, ?, NULL, 0)`,
            eventId,
            enqueuedThrough + 1,
            JSON.stringify({ version: 1 }),
          );

          const flushing = instance.alarm();
          await sendStarted;
          state.storage.sql.exec(
            `UPDATE outbox SET payload_json = ?
             WHERE event_id = ? AND cursor = ?`,
            JSON.stringify({ version: 2 }),
            eventId,
            enqueuedThrough + 1,
          );
          releaseSend();
          await flushing;

          expect(
            state.storage.sql
              .exec<{ payload_json: string }>(
                "SELECT payload_json FROM outbox WHERE event_id = ?",
                eventId,
              )
              .one().payload_json,
          ).toBe(JSON.stringify({ version: 2 }));
          expect(
            state.storage.sql
              .exec<{ cursor: number }>(
                `SELECT enqueued_through_cursor AS cursor
                 FROM projection_delivery_state WHERE singleton = 1`,
              )
              .one().cursor,
          ).toBe(enqueuedThrough);
          state.storage.sql.exec(
            "DELETE FROM outbox WHERE event_id = ?",
            eventId,
          );
        } finally {
          releaseSend();
          restoreBinding(bindings, "PROJECTION_QUEUE", queueSnapshot);
        }
      },
    );
  });

  it("refuses a post before staging content when finalization backlog is full", async () => {
    const coordinates = await conversationWithBot();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    const command: PostMessageCommand = {
      contract: "message.post@1",
      commandId: "30000000-0000-8000-8000-000000000001",
      workspaceId: coordinates.workspaceId,
      conversationId: coordinates.conversationId,
      actor: { kind: "punk", punkId },
      payload: {
        content: "must never be staged at finalization capacity",
        replyToMessageId: null,
        broadcast: false,
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const messageId = await deriveOpaqueUuid(
      "punks.message.v1",
      canonicalJson({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        commandId: command.commandId,
      }),
    );
    await runInDurableObject(conversation, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 0; index < normalContentFinalizationRows; index += 1) {
          const suffix = String(index).padStart(12, "0");
          state.storage.sql.exec(
            `INSERT INTO content_finalization
              (event_id, workspace_id, conversation_id, message_id,
               command_id, content_key_id, attempts, next_attempt_at_ms,
               created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            index.toString(16).padStart(64, "0"),
            coordinates.workspaceId,
            coordinates.conversationId,
            `40000000-0000-8000-8000-${suffix}`,
            `50000000-0000-8000-8000-${suffix}`,
            `60000000-0000-8000-8000-${suffix}`,
            Date.now() + 60_000,
            new Date().toISOString(),
          );
        }
      });
    });

    await expect(
      conversation.postMessage({ messageId, command }),
    ).resolves.toEqual({ ok: false, code: "internal" });
    await runInDurableObject(conversation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM content_finalization",
          )
          .one().count,
      ).toBe(normalContentFinalizationRows);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM messages WHERE message_id = ?",
            messageId,
          )
          .one().count,
      ).toBe(0);
    });
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM content_versions",
            )
            .one().count,
        ).toBe(0);
      },
    );
  });
});
