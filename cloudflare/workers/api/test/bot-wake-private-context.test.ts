import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  PostMessageCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  deriveBotInstallationId,
  deriveBotWakeOfferDigest,
  deriveBotWakeTurnId,
  deriveOpaqueUuid,
  prepareBotWakeOffer,
  sha256Hex,
} from "@punks/core";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type {
  ReadBotWakeContextRequest,
  ReadBotWakeContextResult,
} from "../src/rpc";

const punkId = "00000000-0000-8000-8000-000000000001";
const secret = "Wake plaintext visible only during the private model step";

interface ConversationWakeContextRpc {
  readBotWakeContext(input: unknown): Promise<ReadBotWakeContextResult>;
}

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
    throw new Error(`Workerd refused to replace ${String(key)}`);
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
    throw new Error(`Workerd refused to restore ${String(key)}`);
  }
}

async function responseId(response: Response, key: string): Promise<string> {
  const body = (await response.json()) as Record<string, { id: string }>;
  return body[key]?.id ?? "";
}

async function privateContextFixture(): Promise<{
  stub: ReturnType<typeof env.CONVERSATIONS.getByName>;
  proof: ReadBotWakeContextRequest;
}> {
  const workspaceCommand: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId },
    payload: {
      slug: `wake-context-${crypto.randomUUID().slice(0, 8)}`,
      name: "Wake context",
      visibility: "private",
    },
  };
  const workspaceResponse = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer operator-test-token-00000000000000000000000000000000000000000000",
        "content-type": "application/json",
        "idempotency-key": workspaceCommand.commandId,
      },
      body: JSON.stringify(workspaceCommand),
    },
  );
  expect(workspaceResponse.status).toBe(201);
  const workspaceId = await responseId(workspaceResponse, "workspace");
  const conversationCommand: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "Private context source",
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
  const conversationId = await responseId(conversationResponse, "conversation");
  const post: PostMessageCommand = {
    contract: "message.post@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId },
    payload: {
      content: secret,
      replyToMessageId: null,
      broadcast: false,
      topic: "topic must not escape",
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
  expect(messageResponse.status, await messageResponse.clone().text()).toBe(
    201,
  );
  const messageId = await responseId(messageResponse, "message");
  const botId = await deriveOpaqueUuid(
    "punks.test.bot-wake-context.bot.v1",
    workspaceId,
  );
  const installationId = await deriveBotInstallationId(workspaceId, botId);
  const stub = env.CONVERSATIONS.getByName(conversationId);
  const source = await runInDurableObject(stub, (_instance, state) => {
    const message = state.storage.sql
      .exec<{ created_cursor: number; created_at: string }>(
        `SELECT created_cursor, created_at FROM messages
         WHERE message_id = ?`,
        messageId,
      )
      .one();
    const event = JSON.parse(
      state.storage.sql
        .exec<{ event_json: string }>(
          "SELECT event_json FROM journal WHERE cursor = ?",
          message.created_cursor,
        )
        .one().event_json,
    ) as SignedNostrEvent;
    state.storage.sql.exec(
      `INSERT INTO bot_wake_subscriptions
        (installation_id, workspace_id, conversation_id, bot_id, epoch,
         high_water_cursor, preparation_id, status, updated_at)
       VALUES (?, ?, ?, ?, 7, ?, ?, 'active', ?)`,
      installationId,
      workspaceId,
      conversationId,
      botId,
      message.created_cursor - 1,
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    return { ...message, event };
  });
  const offer = await prepareBotWakeOffer({
    workspaceId,
    installationId,
    botId,
    conversationId,
    messageId,
    messageCursor: source.created_cursor,
    subscriptionEpoch: 7,
    runtimeRelease: await botRuntimeReleaseReference(),
    sourceEventId: source.event.id,
    sourceEventDigest: await sha256Hex(canonicalJson(source.event)),
    createdAt: new Date(source.created_at),
  });
  return {
    stub,
    proof: {
      installationId,
      wakeId: offer.wakeId,
      turnId: await deriveBotWakeTurnId(offer.wakeId),
      authorityGeneration: 7,
      offerDigest: await deriveBotWakeOfferDigest(offer),
      offer,
    },
  };
}

describe("Bot Wake private context", () => {
  it("returns only the exact plaintext with bot-context authorization", async () => {
    const { stub, proof } = await privateContextFixture();

    const result = await (
      stub as ConversationWakeContextRpc
    ).readBotWakeContext(proof);

    expect(result).toEqual({ ok: true, content: secret });
    expect(Object.keys(result).sort()).toEqual(["content", "ok"]);
    expect(canonicalJson(result)).not.toContain("topic must not escape");
  }, 15_000);

  it("discards plaintext when the subscription changes during decryption", async () => {
    const { stub, proof } = await privateContextFixture();
    let snapshot: BindingSnapshot | undefined;
    await runInDurableObject(stub, (instance, state) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const original = runtimeEnv.MESSAGE_CONTENT as typeof env.MESSAGE_CONTENT;
      snapshot = replaceBinding(runtimeEnv, "MESSAGE_CONTENT", {
        getByName(name: string) {
          const content = original.getByName(name);
          return {
            async readAuthorized(input: unknown) {
              const result = await content.readAuthorized(input);
              state.storage.sql.exec(
                `UPDATE bot_wake_subscriptions SET status = 'disabled'
                 WHERE installation_id = ?`,
                proof.installationId,
              );
              return result;
            },
          };
        },
      });
    });
    try {
      await expect(
        (stub as ConversationWakeContextRpc).readBotWakeContext(proof),
      ).resolves.toEqual({ ok: false, code: "authority_revoked" });
    } finally {
      if (snapshot !== undefined) {
        const captured = snapshot;
        await runInDurableObject(stub, (instance) => {
          restoreBinding(
            Reflect.get(instance, "env") as object,
            "MESSAGE_CONTENT",
            captured,
          );
        });
      }
    }
  }, 15_000);

  it("fences plaintext when an aggregate mutation becomes pending during decryption", async () => {
    const { stub, proof } = await privateContextFixture();
    let snapshot: BindingSnapshot | undefined;
    await runInDurableObject(stub, (instance, state) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const original = runtimeEnv.MESSAGE_CONTENT as typeof env.MESSAGE_CONTENT;
      snapshot = replaceBinding(runtimeEnv, "MESSAGE_CONTENT", {
        getByName(name: string) {
          const content = original.getByName(name);
          return {
            async readAuthorized(input: unknown) {
              const result = await content.readAuthorized(input);
              const stateJson = state.storage.sql
                .exec<{ state_json: string }>(
                  "SELECT state_json FROM conversation_state WHERE singleton = 1",
                )
                .one().state_json;
              state.storage.sql.exec(
                `INSERT INTO pending_command
                  (singleton, command_id, payload_hash, command_json,
                   unsigned_json, next_state_json, reduction_overlay,
                   attempts, created_at)
                 VALUES (1, ?, ?, '{}', '{}', ?, 0, 0, ?)`,
                crypto.randomUUID(),
                "0".repeat(64),
                stateJson,
                new Date().toISOString(),
              );
              return result;
            },
          };
        },
      });
    });
    try {
      await expect(
        (stub as ConversationWakeContextRpc).readBotWakeContext(proof),
      ).resolves.toEqual({ ok: false, code: "authority_revoked" });
    } finally {
      if (snapshot !== undefined) {
        const captured = snapshot;
        await runInDurableObject(stub, (instance, state) => {
          state.storage.sql.exec("DELETE FROM pending_command");
          restoreBinding(
            Reflect.get(instance, "env") as object,
            "MESSAGE_CONTENT",
            captured,
          );
        });
      }
    }
  }, 15_000);

  it("rejects a validly-shaped proof that is bound to another digest", async () => {
    const { stub, proof } = await privateContextFixture();

    await expect(
      (stub as ConversationWakeContextRpc).readBotWakeContext({
        ...proof,
        offerDigest: "0".repeat(64),
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  }, 15_000);
});
