import type { BotProjectionEnvelope } from "@punks/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  isConsistentBotProjection,
  projectBotEnvelope,
} from "../src/bot-projector";
import worker from "../src/index";
import { globalProjectionDatabase } from "../src/shards";
import { attestNostrEvent } from "../../attestation/src/nostr";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const botId = "00000000-0000-8000-8000-000000000901";
const baseTime = Date.parse("2026-08-21T08:00:00.000Z");

function botProjection(
  cursor: number,
  status: "published" | "suspended" | "withdrawn",
): BotProjectionEnvelope {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  const state: BotProjectionEnvelope["state"] = {
    id: botId,
    slug: "punk-helper",
    name: "Punk Helper",
    description: "A Punks-operated global Bot",
    status,
    configContractId: "punks://contracts/bot.config.empty@1",
    supportedActionContracts: ["message.reaction-toggle@1"],
    revision: cursor,
    cursor,
    createdAt: new Date(baseTime + 1_000).toISOString(),
    updatedAt: timestamp,
    suspendedAt: status === "suspended" ? timestamp : null,
    withdrawnAt: status === "withdrawn" ? timestamp : null,
  };
  const contract = cursor === 1 ? "bot.publish@1" : "bot.update@1";
  const delta =
    cursor === 1
      ? { operation: "published" }
      : {
          operation: "set-status",
          status,
        };
  return {
    contract: "bot.projection@1",
    botId,
    cursor,
    event: {
      id: `9${String(cursor).padStart(63, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind: cursor === 1 ? 50300 : 50301,
      tags: [
        ["bot", botId],
        ["cursor", String(cursor)],
        [
          "command",
          `00000000-0000-8000-8000-${String(cursor).padStart(12, "0")}`,
        ],
        ["contract", contract],
        ["actor", "punk", "00000000-0000-8000-8000-000000000902"],
        ["attestation", "bot-key-v1"],
      ],
      content: JSON.stringify({ schemaVersion: 1, bot: state, delta }),
      sig: "0".repeat(128),
    },
    state,
  };
}

async function cryptographicallySign(
  envelope: BotProjectionEnvelope,
): Promise<BotProjectionEnvelope> {
  const { id: _id, pubkey: _pubkey, sig: _sig, ...event } = envelope.event;
  return {
    ...envelope,
    event: await attestNostrEvent(
      {
        ...event,
        tags: event.tags.filter(([name]) => name !== "attestation"),
      },
      `${"0".repeat(63)}1`,
      "local-v1",
    ),
  };
}

function rebindBot(
  envelope: BotProjectionEnvelope,
  nextBotId: string,
): BotProjectionEnvelope {
  return JSON.parse(
    JSON.stringify(envelope).replaceAll(botId, nextBotId),
  ) as BotProjectionEnvelope;
}

beforeAll(async () => {
  await Promise.all(
    [
      testEnv.PROJECTION_DB_0,
      testEnv.PROJECTION_DB_1,
      testEnv.PROJECTION_DB_2,
      testEnv.PROJECTION_DB_3,
    ].map((database) => applyD1Migrations(database, testEnv.TEST_MIGRATIONS)),
  );
});

describe("global Bot D1 projector", () => {
  it("rejects a winning status delta that also mutates the stable Bot definition", async () => {
    const transitionBotId = "00000000-0000-8000-8000-000000000903";
    const published = rebindBot(botProjection(1, "published"), transitionBotId);
    const illegalStatusUpdate = rebindBot(
      botProjection(2, "suspended"),
      transitionBotId,
    );
    illegalStatusUpdate.state.slug = "forbidden-status-slug";
    const illegalContent = JSON.parse(illegalStatusUpdate.event.content) as {
      schemaVersion: 1;
      bot: BotProjectionEnvelope["state"];
      delta: object;
    };
    illegalStatusUpdate.event.content = JSON.stringify({
      ...illegalContent,
      bot: illegalStatusUpdate.state,
    });
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, published);

    await expect(
      projectBotEnvelope(testEnv.PROJECTION_DB_0, illegalStatusUpdate),
    ).rejects.toThrow("transition");
  });

  it("is idempotent, ignores out-of-order state, and keeps withdrawal terminal", async () => {
    const published = botProjection(1, "published");
    const suspended = botProjection(2, "suspended");
    const withdrawn = botProjection(3, "withdrawn");

    expect(isConsistentBotProjection(withdrawn)).toBe(true);
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, published);
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, suspended);
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, withdrawn);
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, suspended);
    await projectBotEnvelope(testEnv.PROJECTION_DB_0, withdrawn);
    await expect(
      projectBotEnvelope(
        testEnv.PROJECTION_DB_0,
        botProjection(4, "published"),
      ),
    ).rejects.toThrow("transition");

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT slug, status, revision, last_cursor
       FROM bot_projection WHERE bot_id = ?`,
    )
      .bind(botId)
      .first();
    expect(row).toEqual({
      slug: "punk-helper",
      status: "withdrawn",
      revision: 3,
      last_cursor: 3,
    });
    const events = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT COUNT(*) AS count FROM bot_event_projection WHERE bot_id = ?",
    )
      .bind(botId)
      .first<{ count: number }>();
    expect(events?.count).toBe(3);
  });

  it("keeps FTS5 synchronized with the winning global catalogue state", async () => {
    const hit = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT bot_id FROM bot_search
       WHERE bot_search MATCH ? AND bot_id = ?`,
    )
      .bind("helper", botId)
      .first();
    expect(hit).toEqual({ bot_id: botId });
  });

  it("rejects every substitution or extension of the exact signed tag sequence", () => {
    const baseline = botProjection(2, "suspended");
    const substitutions: BotProjectionEnvelope["event"]["tags"][] = [
      baseline.event.tags.map((tag) =>
        tag[0] === "actor" ? ["actor", "bot", botId] : tag,
      ),
      baseline.event.tags.map((tag) =>
        tag[0] === "command" ? ["command", "not-a-uuid"] : tag,
      ),
      baseline.event.tags.map((tag) =>
        tag[0] === "attestation" ? ["attestation", ""] : tag,
      ),
      [...baseline.event.tags, ["extra", "forbidden"]],
      [
        baseline.event.tags[1] as [string, ...string[]],
        baseline.event.tags[0] as [string, ...string[]],
        ...baseline.event.tags.slice(2),
      ],
    ];

    for (const tags of substitutions) {
      expect(
        isConsistentBotProjection({
          ...baseline,
          event: { ...baseline.event, tags },
        }),
      ).toBe(false);
    }
  });

  it("routes a valid Bot envelope through Queue exclusively to shard 0", async () => {
    const body = await cryptographicallySign(
      rebindBot(
        botProjection(1, "published"),
        "00000000-0000-8000-8000-000000000904",
      ),
    );
    const invalid = {
      ...body,
      event: {
        ...body.event,
        tags: body.event.tags.map((tag) =>
          tag[0] === "actor" ? ["actor", "bot", botId] : tag,
        ),
      },
    };
    const batch = createMessageBatch("punks-projection-local", [
      { id: "bot-queue-3", timestamp: new Date(), body, attempts: 1 },
      {
        id: "bot-queue-invalid",
        timestamp: new Date(),
        body: invalid,
        attempts: 1,
      },
    ]);
    const context = createExecutionContext();

    expect(globalProjectionDatabase(testEnv)).toBe(testEnv.PROJECTION_DB_0);
    await worker.queue?.(batch, testEnv, context);

    const queueResult = await getQueueResult(batch, context);
    expect(queueResult.explicitAcks).toEqual(["bot-queue-3"]);
    expect(queueResult.retryMessages).toEqual([{ msgId: "bot-queue-invalid" }]);
  });

  it("retries gaps and cursor conflicts while acknowledging exact old replays", async () => {
    const orderedBotId = "00000000-0000-8000-8000-000000000905";
    const published = await cryptographicallySign(
      rebindBot(botProjection(1, "published"), orderedBotId),
    );
    const suspended = await cryptographicallySign(
      rebindBot(botProjection(2, "suspended"), orderedBotId),
    );
    const withdrawn = await cryptographicallySign(
      rebindBot(botProjection(3, "withdrawn"), orderedBotId),
    );

    const missingPredecessorBatch = createMessageBatch(
      "punks-projection-local",
      [
        {
          id: "bot-gap-c2",
          timestamp: new Date(),
          body: suspended,
          attempts: 1,
        },
      ],
    );
    const missingPredecessorContext = createExecutionContext();
    await worker.queue?.(
      missingPredecessorBatch,
      testEnv,
      missingPredecessorContext,
    );
    expect(
      await getQueueResult(missingPredecessorBatch, missingPredecessorContext),
    ).toMatchObject({
      explicitAcks: [],
      retryMessages: [{ msgId: "bot-gap-c2" }],
    });
    expect(
      await testEnv.PROJECTION_DB_0.prepare(
        "SELECT COUNT(*) AS count FROM bot_event_projection WHERE bot_id = ?",
      )
        .bind(orderedBotId)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });

    const orderedBatch = createMessageBatch("punks-projection-local", [
      {
        id: "bot-order-c1",
        timestamp: new Date(),
        body: published,
        attempts: 1,
      },
      {
        id: "bot-order-c2",
        timestamp: new Date(),
        body: suspended,
        attempts: 1,
      },
      {
        id: "bot-order-c3",
        timestamp: new Date(),
        body: withdrawn,
        attempts: 1,
      },
    ]);
    const orderedContext = createExecutionContext();
    await worker.queue?.(orderedBatch, testEnv, orderedContext);
    expect(await getQueueResult(orderedBatch, orderedContext)).toMatchObject({
      explicitAcks: ["bot-order-c1", "bot-order-c2", "bot-order-c3"],
      retryMessages: [],
    });

    const conflictingUnsigned = structuredClone(suspended);
    conflictingUnsigned.event.tags = conflictingUnsigned.event.tags.map(
      (tag) =>
        tag[0] === "command"
          ? ["command", "00000000-0000-8000-8000-000000009999"]
          : tag,
    );
    const conflicting = await cryptographicallySign(conflictingUnsigned);
    const replayBatch = createMessageBatch("punks-projection-local", [
      {
        id: "bot-old-exact-c2",
        timestamp: new Date(),
        body: suspended,
        attempts: 1,
      },
      {
        id: "bot-current-exact-c3",
        timestamp: new Date(),
        body: withdrawn,
        attempts: 1,
      },
      {
        id: "bot-conflict-c2",
        timestamp: new Date(),
        body: conflicting,
        attempts: 1,
      },
    ]);
    const replayContext = createExecutionContext();
    await worker.queue?.(replayBatch, testEnv, replayContext);
    expect(await getQueueResult(replayBatch, replayContext)).toMatchObject({
      explicitAcks: ["bot-old-exact-c2", "bot-current-exact-c3"],
      retryMessages: [{ msgId: "bot-conflict-c2" }],
    });
  });
});
