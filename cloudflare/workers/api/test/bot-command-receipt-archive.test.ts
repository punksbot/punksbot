import type {
  PublishBotCommand,
  UnsignedNostrEvent,
  UpdateBotCommand,
} from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  sha256Hex,
} from "@punks/core";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { commandReceiptCoordinate } from "../src/command-receipt-archive";
import type { ApiEnv } from "../src/env";
import type { BotExecuteResult } from "../src/rpc";

const operatorPunkId = "53000000-0000-4000-8000-000000000003";
const runtimeRelease = await botRuntimeReleaseReference();

function replaceBinding(
  target: object,
  key: PropertyKey,
  replacement: unknown,
): () => void {
  const hadPrevious = Object.hasOwn(target, key);
  const previous = Reflect.get(target, key);
  if (!Reflect.set(target, key, replacement)) {
    throw new Error(`Workerd refused to replace binding ${String(key)}`);
  }
  return () => {
    const restored = hadPrevious
      ? Reflect.set(target, key, previous)
      : Reflect.deleteProperty(target, key);
    if (!restored) {
      throw new Error(`Workerd refused to restore binding ${String(key)}`);
    }
  };
}

function publishCommand(
  commandId: string,
  slug: string,
  name = "Receipt reactor",
): PublishBotCommand {
  return {
    contract: "bot.publish@1",
    commandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug,
      name,
      description: "Cold receipt",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-toggle@1"],
      runtimeRelease,
    },
  };
}

async function execute(
  botId: string,
  command: PublishBotCommand,
): Promise<BotExecuteResult> {
  return env.BOTS.getByName(botId).execute({
    command,
    operatorAuthorized: true,
  });
}

describe("BotDO perpetual command receipt archive", () => {
  it("commits archive outbox atomically without terminal command JSON, then cold-replays exactly", async () => {
    const botId = "53000000-0000-4000-8000-000000000010";
    const command = publishCommand(
      "53000000-0000-4000-8000-000000000011",
      "cold-replay",
      "Réacteur 🤖",
    );
    const bot = env.BOTS.getByName(botId);
    const created = await execute(botId, command);
    expect(created).toMatchObject({ ok: true, replayed: false });

    await runInDurableObject(bot, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ command_json: string }>(
          "SELECT command_json FROM command_results WHERE command_id = ?",
          command.commandId,
        )
        .one();
      expect(row.command_json).toBe("{}");
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_receipt_archive_outbox WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(1);
    });

    await runInDurableObject(bot, (instance) => instance.alarm());
    await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_receipt_archive_outbox WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(0);
    });

    const later: UpdateBotCommand = {
      contract: "bot.update@1",
      commandId: "53000000-0000-4000-8000-000000000012",
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { operation: "set-metadata", name: "Later state" },
    };
    await expect(
      bot.execute({ command: later, operatorAuthorized: true }),
    ).resolves.toMatchObject({ ok: true, replayed: false });

    const replay = await execute(botId, command);
    expect(replay).toEqual(
      created.ok
        ? { ok: true, value: created.value, replayed: true }
        : expect.unreachable(),
    );
    const conflict = await execute(botId, {
      ...command,
      payload: { ...command.payload, name: "Different payload" },
    });
    expect(conflict).toEqual({ ok: false, code: "idempotency_conflict" });

    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: botId,
      commandId: command.commandId,
    });
    const stored = await env.JOURNAL_ARCHIVE_BUCKET.get(coordinate.key);
    expect(stored).not.toBeNull();
    const body = await stored?.text();
    expect(body).not.toContain("command_json");
    expect(body).not.toContain("operatorAuthorized");
    expect(body).not.toContain(canonicalJson(command));
  });

  it("fails closed before local replay or mutation on cold outage and corruption", async () => {
    const botId = "53000000-0000-4000-8000-000000000020";
    const command = publishCommand(
      "53000000-0000-4000-8000-000000000021",
      "cold-fail-closed",
    );
    const bot = env.BOTS.getByName(botId);
    const created = await execute(botId, command);
    expect(created.ok).toBe(true);

    await runInDurableObject(bot, async (instance) => {
      const instanceEnv = Reflect.get(instance, "env") as ApiEnv;
      const restoreBucket = replaceBinding(
        instanceEnv,
        "JOURNAL_ARCHIVE_BUCKET",
        {
          get: async () => {
            throw new Error("cold outage");
          },
        } as unknown as R2Bucket,
      );
      try {
        await expect(
          instance.execute({ command, operatorAuthorized: true }),
        ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });
      } finally {
        restoreBucket();
      }
    });

    await runInDurableObject(bot, (instance) => instance.alarm());
    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: botId,
      commandId: command.commandId,
    });
    const stored = await env.JOURNAL_ARCHIVE_BUCKET.get(coordinate.key);
    expect(stored).not.toBeNull();
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      coordinate.key,
      `${await stored?.text()} `,
      {
        ...(stored?.httpMetadata === undefined
          ? {}
          : { httpMetadata: stored.httpMetadata }),
        ...(stored?.customMetadata === undefined
          ? {}
          : { customMetadata: stored.customMetadata }),
      },
    );
    await expect(execute(botId, command)).resolves.toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("keeps the hot receipt through pre/post-put crashes and deletes it only after exact recovery", async () => {
    for (const crashAfterPut of [false, true]) {
      const suffix = crashAfterPut ? "31" : "30";
      const botId = `53000000-0000-4000-8000-0000000000${suffix}`;
      const command = publishCommand(
        `53000000-0000-4000-8000-0000000001${suffix}`,
        `archive-crash-${suffix}`,
      );
      const bot = env.BOTS.getByName(botId);
      expect((await execute(botId, command)).ok).toBe(true);

      await runInDurableObject(bot, async (instance, state) => {
        const instanceEnv = Reflect.get(instance, "env") as ApiEnv;
        const realBucket = instanceEnv.JOURNAL_ARCHIVE_BUCKET;
        const restoreBucket = replaceBinding(
          instanceEnv,
          "JOURNAL_ARCHIVE_BUCKET",
          {
            get: realBucket.get.bind(realBucket),
            put: async (...args: Parameters<R2Bucket["put"]>) => {
              if (crashAfterPut) {
                await realBucket.put(...args);
              }
              throw new Error("simulated archive crash");
            },
          } as unknown as R2Bucket,
        );
        try {
          await instance.alarm();
          expect(
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
                command.commandId,
              )
              .one().count,
          ).toBe(1);
          expect(
            state.storage.sql
              .exec<{ attempts: number }>(
                "SELECT attempts FROM command_receipt_archive_outbox WHERE command_id = ?",
                command.commandId,
              )
              .one().attempts,
          ).toBe(1);
        } finally {
          restoreBucket();
        }
        state.storage.sql.exec(
          `UPDATE command_receipt_archive_outbox
           SET next_attempt_at = 0 WHERE command_id = ?`,
          command.commandId,
        );
      });

      await runInDurableObject(bot, (instance) => instance.alarm());
      await runInDurableObject(bot, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
              command.commandId,
            )
            .one().count,
        ).toBe(0);
      });
    }
  });

  it("lets a verified cold terminal dominate PITR-restored pending and hot rows", async () => {
    const botId = "53000000-0000-4000-8000-000000000040";
    const command = publishCommand(
      "53000000-0000-4000-8000-000000000041",
      "pitr-dominates",
    );
    const bot = env.BOTS.getByName(botId);
    const created = await execute(botId, command);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    await runInDurableObject(bot, (instance) => instance.alarm());
    const payloadHash = await sha256Hex(canonicalJson(command));
    const signed = created.value.event;
    const unsigned: UnsignedNostrEvent = {
      created_at: signed.created_at,
      kind: signed.kind,
      tags: signed.tags.slice(0, -1),
      content: signed.content,
    };
    await runInDurableObject(bot, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM bot_state");
      state.storage.sql.exec("DELETE FROM journal");
      state.storage.sql.exec("DELETE FROM outbox");
      state.storage.sql.exec(
        `INSERT INTO command_results
          (command_id, payload_hash, command_json, response_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(created.value),
        new Date().toISOString(),
      );
      state.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, previous_slug, reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, NULL, 0, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(unsigned),
        JSON.stringify(created.value.state),
        new Date().toISOString(),
      );
    });

    await expect(execute(botId, command)).resolves.toEqual({
      ok: true,
      value: created.value,
      replayed: true,
    });
    await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(0);
      expect(
        JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM bot_state WHERE singleton = 1",
            )
            .one().state_json,
        ),
      ).toEqual(created.value.state);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("migrates at most twenty legacy hot rows per alarm", async () => {
    const botId = "53000000-0000-4000-8000-000000000050";
    const bot = env.BOTS.getByName(botId);
    const commands: Array<PublishBotCommand | UpdateBotCommand> = [
      publishCommand("53000000-0000-4000-8000-000000000051", "legacy-receipts"),
    ];
    for (let index = 1; index < 21; index += 1) {
      const command: UpdateBotCommand = {
        contract: "bot.update@1",
        commandId: `53000000-0000-4000-8000-${String(index + 51).padStart(12, "0")}`,
        botId,
        actor: { kind: "punk", punkId: operatorPunkId },
        payload: {
          operation: "set-metadata",
          name: index % 2 === 0 ? "Legacy even" : "Legacy odd",
        },
      };
      commands.push(command);
    }

    await runInDurableObject(bot, async (instance, state) => {
      const instanceEnv = Reflect.get(instance, "env") as ApiEnv;
      const realBucket = instanceEnv.JOURNAL_ARCHIVE_BUCKET;
      const restoreHotEvents = replaceBinding(
        instanceEnv,
        "JOURNAL_HOT_EVENTS",
        "1000",
      );
      try {
        const restoreSegmentEvents = replaceBinding(
          instanceEnv,
          "JOURNAL_SEGMENT_EVENTS",
          "250",
        );
        try {
          const restoreHoldBucket = replaceBinding(
            instanceEnv,
            "JOURNAL_ARCHIVE_BUCKET",
            {
              get: realBucket.get.bind(realBucket),
              put: async () => {
                throw new Error("hold legacy hot rows");
              },
            } as unknown as R2Bucket,
          );
          try {
            for (const command of commands) {
              const result = await instance.execute({
                command,
                operatorAuthorized: true,
              });
              expect(result).toMatchObject({ ok: true });
            }
          } finally {
            restoreHoldBucket();
          }
          state.storage.sql.exec("DELETE FROM command_receipt_archive_outbox");
          await state.storage.deleteAlarm();
          let puts = 0;
          const restoreBatchBucket = replaceBinding(
            instanceEnv,
            "JOURNAL_ARCHIVE_BUCKET",
            {
              get: realBucket.get.bind(realBucket),
              put: async (...args: Parameters<R2Bucket["put"]>) => {
                if (puts >= 20) {
                  throw new Error("stop after one migration batch");
                }
                puts += 1;
                return realBucket.put(...args);
              },
            } as unknown as R2Bucket,
          );
          try {
            await instance.alarm();
          } finally {
            restoreBatchBucket();
          }
          await state.storage.deleteAlarm();
          expect(puts).toBe(20);
          expect(
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM command_results",
              )
              .one().count,
          ).toBe(1);
        } finally {
          restoreSegmentEvents();
        }
      } finally {
        restoreHotEvents();
      }
    });

    for (const command of commands.slice(0, 20)) {
      const coordinate = await commandReceiptCoordinate({
        aggregate: "bot",
        aggregateId: botId,
        commandId: command.commandId,
      });
      await expect(
        env.JOURNAL_ARCHIVE_BUCKET.head(coordinate.key),
      ).resolves.not.toBeNull();
    }
    const lastCoordinate = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: botId,
      commandId: commands[20]?.commandId ?? "",
    });
    await expect(
      env.JOURNAL_ARCHIVE_BUCKET.head(lastCoordinate.key),
    ).resolves.toBeNull();

    await runInDurableObject(bot, async (instance, state) => {
      state.storage.sql.exec(
        "UPDATE command_receipt_archive_outbox SET next_attempt_at = 0",
      );
      await instance.alarm();
    });
    await expect(
      env.JOURNAL_ARCHIVE_BUCKET.head(lastCoordinate.key),
    ).resolves.not.toBeNull();
  });

  it("repairs a lost alarm when command receipt archive work exists", async () => {
    const bot = env.BOTS.getByName("53000000-0000-4000-8000-000000000090");
    await runInDurableObject(bot, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO command_receipt_archive_outbox
          (command_id, payload_hash, object_key, archive_json, body_hash,
           attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
        "53000000-0000-4000-8000-000000000091",
        "aa".repeat(32),
        `command-receipts/v1/bot/${"bb".repeat(32)}/${"cc".repeat(32)}.json`,
        "{}",
        "dd".repeat(32),
        new Date().toISOString(),
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(bot);
    await runInDurableObject(bot, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      state.storage.sql.exec("DELETE FROM command_receipt_archive_outbox");
      await state.storage.deleteAlarm();
    });
  });

  it("saturates archive retries at 63 and persists a bounded backoff", async () => {
    const botId = "53000000-0000-4000-8000-000000000080";
    const command = publishCommand(
      "53000000-0000-4000-8000-000000000081",
      "receipt-retry-cap",
    );
    const bot = env.BOTS.getByName(botId);
    expect((await execute(botId, command)).ok).toBe(true);

    await runInDurableObject(bot, async (instance, state) => {
      state.storage.sql.exec(
        `UPDATE command_receipt_archive_outbox
         SET attempts = 63, next_attempt_at = 0 WHERE command_id = ?`,
        command.commandId,
      );
      const instanceEnv = Reflect.get(instance, "env") as ApiEnv;
      const realBucket = instanceEnv.JOURNAL_ARCHIVE_BUCKET;
      const restoreBucket = replaceBinding(
        instanceEnv,
        "JOURNAL_ARCHIVE_BUCKET",
        {
          get: realBucket.get.bind(realBucket),
          put: async () => {
            throw new Error("retry cap outage");
          },
        } as unknown as R2Bucket,
      );
      try {
        const before = Date.now();
        await instance.alarm();
        const row = state.storage.sql
          .exec<{ attempts: number; next_attempt_at: number }>(
            `SELECT attempts, next_attempt_at
             FROM command_receipt_archive_outbox WHERE command_id = ?`,
            command.commandId,
          )
          .one();
        expect(row.attempts).toBe(63);
        expect(row.next_attempt_at).toBeGreaterThanOrEqual(before + 60_000);
      } finally {
        restoreBucket();
      }
      state.storage.sql.exec("DELETE FROM command_receipt_archive_outbox");
      await state.storage.deleteAlarm();
    });
  });
});
