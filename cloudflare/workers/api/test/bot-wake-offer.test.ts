import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  EditMessageCommand,
  PostMessageCommand,
  RetractMessageCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import {
  canonicalJson,
  deriveBotInstallationId,
  deriveBotWakeId,
  deriveOpaqueUuid,
  sha256Hex,
} from "@punks/core";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { BotWakeCandidate, OfferBotWakeResult } from "../src/rpc";

const punkId = "00000000-0000-8000-8000-000000000001";
const postSecret = "plaintext that must never enter the Wake source";

interface ConversationWakeRpc {
  offerBotWake(input: unknown): Promise<OfferBotWakeResult>;
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

function durableObjectEnv(instance: object): object {
  const runtimeEnv = Reflect.get(instance, "env");
  expect(runtimeEnv).not.toBeNull();
  expect(typeof runtimeEnv).toBe("object");
  return runtimeEnv as object;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function entityId(response: Response, key: string): Promise<string> {
  const body = (await response.json()) as Record<string, { id: string }>;
  return body[key]?.id ?? "";
}

async function wakeFixture() {
  const workspaceCommand: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId },
    payload: {
      slug: `wake-offer-${crypto.randomUUID().slice(0, 8)}`,
      name: "Wake offer",
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
  const workspaceId = await entityId(workspaceResponse, "workspace");

  const conversationCommand: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "Private Wake source",
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
  const conversationId = await entityId(conversationResponse, "conversation");

  const post: PostMessageCommand = {
    contract: "message.post@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId },
    payload: {
      content: postSecret,
      replyToMessageId: null,
      broadcast: false,
      topic: "private topic",
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
  const messageId = await entityId(messageResponse, "message");
  const botId = await deriveOpaqueUuid(
    "punks.test.bot-wake-offer.bot.v1",
    workspaceId,
  );
  const installationId = await deriveBotInstallationId(workspaceId, botId);
  const stored = await runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    (_instance, state) => {
      const message = state.storage.sql
        .exec<{ created_cursor: number }>(
          "SELECT created_cursor FROM messages WHERE message_id = ?",
          messageId,
        )
        .one();
      const journal = state.storage.sql
        .exec<{ event_json: string }>(
          "SELECT event_json FROM journal WHERE cursor = ?",
          message.created_cursor,
        )
        .one();
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
      return {
        messageCursor: message.created_cursor,
        sourceEvent: JSON.parse(journal.event_json) as SignedNostrEvent,
      };
    },
  );
  return {
    workspaceId,
    conversationId,
    messageId,
    botId,
    installationId,
    ...stored,
  };
}

type WakeFixture = Awaited<ReturnType<typeof wakeFixture>>;

async function expectedCandidate(
  fixture: WakeFixture,
  subscriptionEpoch = 7,
): Promise<BotWakeCandidate> {
  return {
    schemaVersion: 1,
    wakeId: await deriveBotWakeId({
      installationId: fixture.installationId,
      subscriptionEpoch,
      messageId: fixture.messageId,
      messageCursor: fixture.messageCursor,
    }),
    workspaceId: fixture.workspaceId,
    installationId: fixture.installationId,
    botId: fixture.botId,
    conversationId: fixture.conversationId,
    messageId: fixture.messageId,
    messageCursor: fixture.messageCursor,
    subscriptionEpoch,
    sourceEventId: fixture.sourceEvent.id,
    sourceEventDigest: await sha256Hex(canonicalJson(fixture.sourceEvent)),
    createdAt: (
      JSON.parse(fixture.sourceEvent.content) as {
        message: { createdAt: string };
      }
    ).message.createdAt,
  };
}

async function postAdditionalMessage(
  fixture: WakeFixture,
): Promise<WakeFixture> {
  const command: PostMessageCommand = {
    contract: "message.post@1",
    commandId: crypto.randomUUID(),
    workspaceId: fixture.workspaceId,
    conversationId: fixture.conversationId,
    actor: { kind: "punk", punkId },
    payload: {
      content: "second private source",
      replyToMessageId: null,
      broadcast: false,
      topic: null,
      mentionedPunkIds: [],
      mediaIds: [],
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${fixture.workspaceId}/conversations/${fixture.conversationId}/messages`,
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
  expect(response.status, await response.clone().text()).toBe(201);
  const messageId = await entityId(response, "message");
  const stored = await runInDurableObject(
    env.CONVERSATIONS.getByName(fixture.conversationId),
    (_instance, state) => {
      const messageCursor = state.storage.sql
        .exec<{ created_cursor: number }>(
          "SELECT created_cursor FROM messages WHERE message_id = ?",
          messageId,
        )
        .one().created_cursor;
      const sourceEvent = JSON.parse(
        state.storage.sql
          .exec<{ event_json: string }>(
            "SELECT event_json FROM journal WHERE cursor = ?",
            messageCursor,
          )
          .one().event_json,
      ) as SignedNostrEvent;
      return { messageCursor, sourceEvent };
    },
  );
  return { ...fixture, messageId, ...stored };
}

function mutateMessage(
  method: "PATCH" | "POST",
  fixture: WakeFixture,
  command: EditMessageCommand | RetractMessageCommand,
  suffix = "",
): Promise<Response> {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${fixture.workspaceId}/conversations/${fixture.conversationId}/messages/${fixture.messageId}${suffix}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

describe("Bot Wake source offer", () => {
  it("durably derives and delivers one opaque candidate, with an exact replay", async () => {
    const fixture = await wakeFixture();
    const conversation = env.CONVERSATIONS.getByName(
      fixture.conversationId,
    ) as ConversationWakeRpc;
    const accepted: BotWakeCandidate[] = [];
    let bindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(
      env.CONVERSATIONS.getByName(fixture.conversationId),
      (instance) => {
        bindingSnapshot = replaceBinding(
          durableObjectEnv(instance),
          "BOT_INSTALLATIONS",
          {
            getByName(name: string) {
              expect(name).toBe(fixture.installationId);
              return {
                acceptBotWakeCandidate(candidate: BotWakeCandidate) {
                  accepted.push(candidate);
                  return {
                    ok: true,
                    wakeId: candidate.wakeId,
                    replayed: accepted.length > 1,
                    terminal: false,
                  };
                },
              };
            },
          },
        );
      },
    );
    try {
      const request = {
        installationId: fixture.installationId,
        messageId: fixture.messageId,
      };
      const first = await conversation.offerBotWake(request);
      const replay = await conversation.offerBotWake(request);
      const expected = await expectedCandidate(fixture);
      expect(first).toEqual({ ok: true, wakeId: expected.wakeId });
      expect(replay).toEqual(first);
      expect(accepted).toEqual([expected, expected]);
      expect(canonicalJson(accepted)).not.toContain(postSecret);
      await runInDurableObject(
        env.CONVERSATIONS.getByName(fixture.conversationId),
        (_instance, state) => {
          expect(
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM bot_wake_candidate_outbox",
              )
              .one().count,
          ).toBe(0);
        },
      );
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(
          env.CONVERSATIONS.getByName(fixture.conversationId),
          (instance) => {
            restoreBinding(
              durableObjectEnv(instance),
              "BOT_INSTALLATIONS",
              snapshot,
            );
          },
        );
      }
    }
  });

  it("rejects edited and retracted Messages before creating a source", async () => {
    const edited = await wakeFixture();
    const edit: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: crypto.randomUUID(),
      workspaceId: edited.workspaceId,
      conversationId: edited.conversationId,
      messageId: edited.messageId,
      actor: { kind: "punk", punkId },
      payload: {
        content: "edited private content",
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const editedResponse = await mutateMessage("PATCH", edited, edit);
    expect(editedResponse.status, await editedResponse.clone().text()).toBe(
      200,
    );
    await expect(
      (
        env.CONVERSATIONS.getByName(
          edited.conversationId,
        ) as ConversationWakeRpc
      ).offerBotWake({
        installationId: edited.installationId,
        messageId: edited.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    const retracted = await wakeFixture();
    const retract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: crypto.randomUUID(),
      workspaceId: retracted.workspaceId,
      conversationId: retracted.conversationId,
      messageId: retracted.messageId,
      actor: { kind: "punk", punkId },
      payload: { reasonCode: "author-request", publicReason: null },
    };
    const retractedResponse = await mutateMessage(
      "POST",
      retracted,
      retract,
      "/retract",
    );
    expect(
      retractedResponse.status,
      await retractedResponse.clone().text(),
    ).toBe(200);
    await expect(
      (
        env.CONVERSATIONS.getByName(
          retracted.conversationId,
        ) as ConversationWakeRpc
      ).offerBotWake({
        installationId: retracted.installationId,
        messageId: retracted.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("rejects the subscription high-water and forged cursor or journal event", async () => {
    const highWater = await wakeFixture();
    await runInDurableObject(
      env.CONVERSATIONS.getByName(highWater.conversationId),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE bot_wake_subscriptions SET high_water_cursor = ?
           WHERE installation_id = ?`,
          highWater.messageCursor,
          highWater.installationId,
        );
      },
    );
    await expect(
      (
        env.CONVERSATIONS.getByName(
          highWater.conversationId,
        ) as ConversationWakeRpc
      ).offerBotWake({
        installationId: highWater.installationId,
        messageId: highWater.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    const forgedCursor = await wakeFixture();
    await runInDurableObject(
      env.CONVERSATIONS.getByName(forgedCursor.conversationId),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE messages SET created_cursor = ?, cursor = ?
           WHERE message_id = ?`,
          forgedCursor.messageCursor + 10,
          forgedCursor.messageCursor + 10,
          forgedCursor.messageId,
        );
      },
    );
    await expect(
      (
        env.CONVERSATIONS.getByName(
          forgedCursor.conversationId,
        ) as ConversationWakeRpc
      ).offerBotWake({
        installationId: forgedCursor.installationId,
        messageId: forgedCursor.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });

    const forgedEvent = await wakeFixture();
    await runInDurableObject(
      env.CONVERSATIONS.getByName(forgedEvent.conversationId),
      (_instance, state) => {
        const otherEventJson = state.storage.sql
          .exec<{ event_json: string }>(
            "SELECT event_json FROM journal WHERE cursor = 1",
          )
          .one().event_json;
        state.storage.sql.exec(
          "UPDATE journal SET event_json = ? WHERE cursor = ?",
          otherEventJson,
          forgedEvent.messageCursor,
        );
      },
    );
    await expect(
      (
        env.CONVERSATIONS.getByName(
          forgedEvent.conversationId,
        ) as ConversationWakeRpc
      ).offerBotWake({
        installationId: forgedEvent.installationId,
        messageId: forgedEvent.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
  });

  it("keeps an accept failure durable and repairs it after eviction", async () => {
    const fixture = await wakeFixture();
    const stub = env.CONVERSATIONS.getByName(fixture.conversationId);
    let outageSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(stub, (instance) => {
      outageSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(_candidate: BotWakeCandidate) {
                throw new Error("injected Queue-like accept outage");
              },
            };
          },
        },
      );
    });
    const result = await (stub as ConversationWakeRpc).offerBotWake({
      installationId: fixture.installationId,
      messageId: fixture.messageId,
    });
    expect(result).toEqual({
      ok: true,
      wakeId: (await expectedCandidate(fixture)).wakeId,
    });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ candidate_json: string; attempts: number }>(
          "SELECT candidate_json, attempts FROM bot_wake_candidate_outbox",
        )
        .one();
      expect(row.attempts).toBe(1);
      expect(row.candidate_json).not.toContain(postSecret);
    });
    if (outageSnapshot !== null) {
      const snapshot = outageSnapshot;
      await runInDurableObject(stub, (instance) => {
        restoreBinding(
          durableObjectEnv(instance),
          "BOT_INSTALLATIONS",
          snapshot,
        );
      });
    }

    await evictDurableObject(stub);
    let repairedSnapshot: BindingSnapshot | null = null;
    let repairedCalls = 0;
    await runInDurableObject(stub, async (instance, state) => {
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      state.storage.sql.exec(
        "UPDATE bot_wake_candidate_outbox SET next_attempt_at = 0",
      );
      repairedSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(candidate: BotWakeCandidate) {
                repairedCalls += 1;
                expect(candidate.installationId).toBe(fixture.installationId);
                return { ok: false, code: "authority_revoked" };
              },
            };
          },
        },
      );
    });
    try {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(repairedCalls).toBe(1);
      await runInDurableObject(stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM bot_wake_candidate_outbox",
            )
            .one().count,
        ).toBe(0);
      });
    } finally {
      if (repairedSnapshot !== null) {
        const snapshot = repairedSnapshot;
        await runInDurableObject(stub, (instance) => {
          restoreBinding(
            durableObjectEnv(instance),
            "BOT_INSTALLATIONS",
            snapshot,
          );
        });
      }
    }
  });

  it("uses an exact CAS delete and never forwards a substituted digest", async () => {
    const fixture = await wakeFixture();
    const stub = env.CONVERSATIONS.getByName(fixture.conversationId);
    let outageSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(stub, (instance) => {
      outageSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(_candidate: BotWakeCandidate) {
                throw new Error("retain the initial candidate");
              },
            };
          },
        },
      );
    });
    await expect(
      (stub as ConversationWakeRpc).offerBotWake({
        installationId: fixture.installationId,
        messageId: fixture.messageId,
      }),
    ).resolves.toMatchObject({ ok: true });
    if (outageSnapshot !== null) {
      const snapshot = outageSnapshot;
      await runInDurableObject(stub, (instance) => {
        restoreBinding(
          durableObjectEnv(instance),
          "BOT_INSTALLATIONS",
          snapshot,
        );
      });
    }

    let casSnapshot: BindingSnapshot | null = null;
    let substitutedJson = "";
    await runInDurableObject(stub, (instance, state) => {
      state.storage.sql.exec(
        "UPDATE bot_wake_candidate_outbox SET next_attempt_at = 0",
      );
      casSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(candidate: BotWakeCandidate) {
                substitutedJson = canonicalJson({
                  ...candidate,
                  sourceEventDigest: "f".repeat(64),
                });
                state.storage.sql.exec(
                  `UPDATE bot_wake_candidate_outbox
                   SET candidate_json = ?, next_attempt_at = ?
                   WHERE wake_id = ?`,
                  substitutedJson,
                  Date.now() + 60_000,
                  candidate.wakeId,
                );
                return {
                  ok: true,
                  wakeId: candidate.wakeId,
                  replayed: false,
                  terminal: false,
                };
              },
            };
          },
        },
      );
    });
    try {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
    } finally {
      if (casSnapshot !== null) {
        const snapshot = casSnapshot;
        await runInDurableObject(stub, (instance) => {
          restoreBinding(
            durableObjectEnv(instance),
            "BOT_INSTALLATIONS",
            snapshot,
          );
        });
      }
    }
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ candidate_json: string }>(
            "SELECT candidate_json FROM bot_wake_candidate_outbox",
          )
          .one().candidate_json,
      ).toBe(substitutedJson);
      state.storage.sql.exec(
        "UPDATE bot_wake_candidate_outbox SET next_attempt_at = 0",
      );
    });

    let forwarded = 0;
    let digestSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(stub, (instance) => {
      digestSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(_candidate: BotWakeCandidate) {
                forwarded += 1;
                throw new Error("a forged digest must not reach Installation");
              },
            };
          },
        },
      );
    });
    try {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(forwarded).toBe(0);
      await runInDurableObject(stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT attempts FROM bot_wake_candidate_outbox",
            )
            .one().attempts,
        ).toBe(2);
      });
    } finally {
      if (digestSnapshot !== null) {
        const snapshot = digestSnapshot;
        await runInDurableObject(stub, (instance) => {
          restoreBinding(
            durableObjectEnv(instance),
            "BOT_INSTALLATIONS",
            snapshot,
          );
        });
      }
    }
  });

  it("enforces both the row cap and the exact canonical UTF-8 cap", async () => {
    const rowBound = await wakeFixture();
    const rowStub = env.CONVERSATIONS.getByName(rowBound.conversationId);
    const rowIds = await Promise.all(
      Array.from({ length: 256 }, (_, index) =>
        deriveOpaqueUuid(
          "punks.test.bot-wake-offer.row-bound.v1",
          String(index),
        ),
      ),
    );
    await runInDurableObject(rowStub, (_instance, state) => {
      for (const wakeId of rowIds) {
        state.storage.sql.exec(
          `INSERT INTO bot_wake_candidate_outbox
            (wake_id, installation_id, message_id, candidate_json, attempts,
             next_attempt_at, created_at)
           VALUES (?, ?, ?, '{}', 0, ?, ?)`,
          wakeId,
          rowBound.installationId,
          rowBound.messageId,
          Date.now() + 60_000,
          rowBound.sourceEvent.created_at.toString(),
        );
      }
    });
    await expect(
      (rowStub as ConversationWakeRpc).offerBotWake({
        installationId: rowBound.installationId,
        messageId: rowBound.messageId,
      }),
    ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });

    const byteBound = await wakeFixture();
    const byteStub = env.CONVERSATIONS.getByName(byteBound.conversationId);
    const firstCandidate = await expectedCandidate(byteBound);
    const firstJson = canonicalJson(firstCandidate);
    const firstRowBytes =
      utf8ByteLength(firstCandidate.wakeId) +
      utf8ByteLength(firstCandidate.installationId) +
      utf8ByteLength(firstCandidate.messageId) +
      utf8ByteLength(firstJson) +
      utf8ByteLength(firstCandidate.createdAt) +
      16;
    const fillerWakeId = await deriveOpaqueUuid(
      "punks.test.bot-wake-offer.byte-bound.wake.v1",
      byteBound.workspaceId,
    );
    const fillerInstallationId = await deriveOpaqueUuid(
      "punks.test.bot-wake-offer.byte-bound.installation.v1",
      byteBound.workspaceId,
    );
    const fillerMessageId = await deriveOpaqueUuid(
      "punks.test.bot-wake-offer.byte-bound.message.v1",
      byteBound.workspaceId,
    );
    const fillerFixedBytes =
      utf8ByteLength(fillerWakeId) +
      utf8ByteLength(fillerInstallationId) +
      utf8ByteLength(fillerMessageId) +
      utf8ByteLength(firstCandidate.createdAt) +
      16;
    const fillerJsonBytes = 1_048_576 - firstRowBytes - fillerFixedBytes;
    expect(fillerJsonBytes).toBeGreaterThan(0);
    const fillerJson =
      "😀".repeat(Math.floor(fillerJsonBytes / 4)) +
      "x".repeat(fillerJsonBytes % 4);
    expect(utf8ByteLength(fillerJson)).toBe(fillerJsonBytes);
    let byteSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(byteStub, (instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO bot_wake_candidate_outbox
          (wake_id, installation_id, message_id, candidate_json, attempts,
           next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        fillerWakeId,
        fillerInstallationId,
        fillerMessageId,
        fillerJson,
        Date.now() + 60_000,
        firstCandidate.createdAt,
      );
      byteSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        {
          getByName(_name: string) {
            return {
              acceptBotWakeCandidate(_candidate: BotWakeCandidate) {
                throw new Error("retain the exact-bound candidate");
              },
            };
          },
        },
      );
    });
    try {
      await expect(
        (byteStub as ConversationWakeRpc).offerBotWake({
          installationId: byteBound.installationId,
          messageId: byteBound.messageId,
        }),
      ).resolves.toEqual({ ok: true, wakeId: firstCandidate.wakeId });
      const second = await postAdditionalMessage(byteBound);
      await expect(
        (byteStub as ConversationWakeRpc).offerBotWake({
          installationId: second.installationId,
          messageId: second.messageId,
        }),
      ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });
    } finally {
      if (byteSnapshot !== null) {
        const snapshot = byteSnapshot;
        await runInDurableObject(byteStub, (instance) => {
          restoreBinding(
            durableObjectEnv(instance),
            "BOT_INSTALLATIONS",
            snapshot,
          );
        });
      }
    }
  });

  it("limits one alarm to twenty accepts and saturates attempts at 63", async () => {
    const fixture = await wakeFixture();
    const stub = env.CONVERSATIONS.getByName(fixture.conversationId);
    const candidates = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        expectedCandidate(fixture, index + 10),
      ),
    );
    let calls = 0;
    let bindingSnapshot: BindingSnapshot | null = null;
    const temporarilyUnavailableBinding = {
      getByName(_name: string) {
        return {
          acceptBotWakeCandidate(_candidate: BotWakeCandidate) {
            calls += 1;
            return { ok: false, code: "temporarily_unavailable" };
          },
        };
      },
    };
    await runInDurableObject(stub, async (instance, state) => {
      for (const candidate of candidates) {
        state.storage.sql.exec(
          `INSERT INTO bot_wake_candidate_outbox
            (wake_id, installation_id, message_id, candidate_json, attempts,
             next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, 0, 0, ?)`,
          candidate.wakeId,
          candidate.installationId,
          candidate.messageId,
          canonicalJson(candidate),
          candidate.createdAt,
        );
      }
      bindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "BOT_INSTALLATIONS",
        temporarilyUnavailableBinding,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    try {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(calls).toBe(20);
      calls = 0;
      await runInDurableObject(stub, async (instance, state) => {
        replaceBinding(
          durableObjectEnv(instance),
          "BOT_INSTALLATIONS",
          temporarilyUnavailableBinding,
        );
        const attempts = state.storage.sql
          .exec<{ attempts: number; count: number }>(
            `SELECT attempts, COUNT(*) AS count
             FROM bot_wake_candidate_outbox GROUP BY attempts
             ORDER BY attempts`,
          )
          .toArray();
        expect(attempts).toEqual([
          { attempts: 0, count: 1 },
          { attempts: 1, count: 20 },
        ]);
        state.storage.sql.exec(
          "UPDATE bot_wake_candidate_outbox SET next_attempt_at = ?",
          Date.now() + 60_000,
        );
        state.storage.sql.exec(
          `UPDATE bot_wake_candidate_outbox
           SET attempts = 63, next_attempt_at = 0 WHERE wake_id = ?`,
          candidates[0]?.wakeId,
        );
        await instance.alarm();
      });
      expect(calls).toBe(1);
      await runInDurableObject(stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              `SELECT attempts FROM bot_wake_candidate_outbox
               WHERE wake_id = ?`,
              candidates[0]?.wakeId,
            )
            .one().attempts,
        ).toBe(63);
      });
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(stub, (instance) => {
          restoreBinding(
            durableObjectEnv(instance),
            "BOT_INSTALLATIONS",
            snapshot,
          );
        });
      }
    }
  });
});
