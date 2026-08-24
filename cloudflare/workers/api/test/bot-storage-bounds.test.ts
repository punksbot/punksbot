import type { PublishBotCommand, UpdateBotCommand } from "@punks/contracts";
import { botRuntimeReleaseReference } from "@punks/core";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const operatorPunkId = "00000000-0000-8000-8000-000000000001";
const runtimeRelease = await botRuntimeReleaseReference();

function publishCommand(commandId: string, slug: string): PublishBotCommand {
  return {
    contract: "bot.publish@1",
    commandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug,
      name: "Storage Bound Bot",
      description: "BotDO local storage bound fixture",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-toggle@1"],
      runtimeRelease,
    },
  };
}

function setActionsCommand(
  commandId: string,
  botId: string,
  supportedActionContracts: Extract<
    UpdateBotCommand["payload"],
    { operation: "set-actions" }
  >["supportedActionContracts"],
): UpdateBotCommand {
  return {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-actions", supportedActionContracts },
  };
}

function setDescriptionCommand(
  commandId: string,
  botId: string,
  description: string,
): UpdateBotCommand {
  return {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-metadata", description },
  };
}

function setStatusCommand(
  commandId: string,
  botId: string,
  status: "published" | "suspended" | "withdrawn",
): UpdateBotCommand {
  return {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-status", status },
  };
}

function replaceProjectionQueue(
  instance: object,
  send: (message: unknown) => Promise<unknown>,
): () => void {
  const runtimeEnv: unknown = Reflect.get(instance, "env");
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) {
    throw new Error("BotDO runtime environment is unavailable");
  }
  const hadPrevious = Object.hasOwn(runtimeEnv, "PROJECTION_QUEUE");
  const previous = Reflect.get(runtimeEnv, "PROJECTION_QUEUE");
  if (!Reflect.set(runtimeEnv, "PROJECTION_QUEUE", { send })) {
    throw new Error("Workerd refused to replace PROJECTION_QUEUE");
  }
  return () => {
    const restored = hadPrevious
      ? Reflect.set(runtimeEnv, "PROJECTION_QUEUE", previous)
      : Reflect.deleteProperty(runtimeEnv, "PROJECTION_QUEUE");
    if (!restored) {
      throw new Error("Workerd refused to restore PROJECTION_QUEUE");
    }
  };
}

function rejectProjectionQueue(instance: object): () => void {
  return replaceProjectionQueue(instance, async (): Promise<never> => {
    throw new Error("projection Queue unavailable");
  });
}

async function failAttestationOnce(commandId: string): Promise<void> {
  const response = await env.ATTESTATION.fetch(
    "https://fixture/__test/fail-once",
    {
      method: "POST",
      body: JSON.stringify({ commandId }),
    },
  );
  expect(response.ok).toBe(true);
}

describe("BotDO local storage bounds", () => {
  it("deletes a projection outbox entry after Queue accepts it", async () => {
    const botId = "91000000-0000-4000-8000-000000000001";
    const bot = env.BOTS.getByName(botId);
    const result = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000002",
        "storage-success",
      ),
      operatorAuthorized: true,
    });
    expect(result.ok).toBe(true);

    await runInDurableObject(bot, async (instance, state) => {
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
    });
  });

  it("garbage-collects legacy delivered outbox entries during initialization", async () => {
    const botId = "91000000-0000-4000-8000-000000000003";
    const bot = env.BOTS.getByName(botId);
    const result = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000004",
        "storage-legacy-delivered",
      ),
      operatorAuthorized: true,
    });
    expect(result.ok).toBe(true);

    await runInDurableObject(bot, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, ?, ?)`,
        "legacy-delivered-event",
        2,
        "{}",
        "2026-08-20T00:00:00.000Z",
        1,
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(bot);

    await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM outbox WHERE delivered_at IS NOT NULL",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("keeps an action extension blocked by a full outbox after journal capacity is archived", async () => {
    const botId = "91000000-0000-4000-8000-000000000005";
    const bot = env.BOTS.getByName(botId);
    const published = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000006",
        "storage-row-cap",
      ),
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);
    const updated = await bot.execute({
      command: setDescriptionCommand(
        "91000000-0000-4000-8000-000000000011",
        botId,
        "Second event fills the hot journal before archive.",
      ),
      operatorAuthorized: true,
    });
    expect(updated.ok).toBe(true);
    await runInDurableObject(bot, (instance) => instance.alarm?.());

    const observed = await runInDurableObject(bot, async (instance, state) => {
      for (let index = 0; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          `saturated-event-${index}`,
          1_000 + index,
          "{}",
        );
      }
      const extension = await instance.execute({
        command: setActionsCommand(
          "91000000-0000-4000-8000-000000000007",
          botId,
          ["message.reaction-toggle@1", "message.reaction-add@1"],
        ),
        operatorAuthorized: true,
      });
      return {
        extension,
        query: instance.query({ contract: "bot.get@1", botId }),
        outbox: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
        archives: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM archive_segments",
          )
          .one().count,
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });
    expect(observed.extension).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 2 },
    });
    expect(observed).toMatchObject({
      outbox: 256,
      pending: 0,
      journal: 1,
      archives: 1,
      results: 0,
    });
  });

  it("measures multibyte projection payloads as UTF-8 bytes at the normal outbox byte cap", async () => {
    const botId = "91000000-0000-4000-8000-000000000008";
    const bot = env.BOTS.getByName(botId);
    const published = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000009",
        "storage-byte-cap",
      ),
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);

    const normalOutboxBytes = 524_288;
    const payload = JSON.stringify("é".repeat((normalOutboxBytes - 2) / 2));
    const observed = await runInDurableObject(bot, async (instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, NULL, 0)`,
        "saturated-byte-event",
        1_000,
        payload,
      );
      const storedBytes = state.storage.sql
        .exec<{ bytes: number }>(
          `SELECT length(CAST(payload_json AS BLOB)) AS bytes
           FROM outbox WHERE event_id = ?`,
          "saturated-byte-event",
        )
        .one().bytes;
      const extension = await instance.execute({
        command: setActionsCommand(
          "91000000-0000-4000-8000-000000000010",
          botId,
          ["message.reaction-toggle@1", "message.reaction-add@1"],
        ),
        operatorAuthorized: true,
      });
      return {
        storedBytes,
        extension,
        query: instance.query({ contract: "bot.get@1", botId }),
      };
    });

    expect(observed.storedBytes).toBe(normalOutboxBytes);
    expect(observed.extension).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 1 },
    });
  });

  it("reserves exactly the four remaining terminal reductions while Queue is unavailable", async () => {
    const botId = "91000000-0000-4000-8000-000000000012";
    const bot = env.BOTS.getByName(botId);
    const command = publishCommand(
      "91000000-0000-4000-8000-000000000013",
      "storage-reduction-reserve",
    );
    command.payload.supportedActionContracts = [
      "message.reaction-add@1",
      "message.reaction-remove@1",
      "message.reaction-toggle@1",
    ];
    const published = await bot.execute({
      command,
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);

    const observed = await runInDurableObject(bot, async (instance, state) => {
      const restoreQueue = rejectProjectionQueue(instance);
      try {
        for (let index = 0; index < 256; index += 1) {
          state.storage.sql.exec(
            `INSERT INTO outbox
              (event_id, cursor, payload_json, delivered_at, attempts)
             VALUES (?, ?, ?, NULL, 0)`,
            `reserved-event-${index}`,
            1_000 + index,
            "{}",
          );
        }
        for (let index = 1; index < 256; index += 1) {
          state.storage.sql.exec(
            `INSERT INTO command_results
              (command_id, payload_hash, command_json, response_json, committed_at)
             VALUES (?, ?, ?, ?, ?)`,
            `reserved-command-${index}`,
            "0".repeat(64),
            "{}",
            "{}",
            "2026-08-21T00:00:00.000Z",
          );
        }
        const reductions = [
          setActionsCommand("91000000-0000-4000-8000-000000000014", botId, [
            "message.reaction-add@1",
            "message.reaction-toggle@1",
          ]),
          setActionsCommand("91000000-0000-4000-8000-000000000015", botId, [
            "message.reaction-toggle@1",
          ]),
          setStatusCommand(
            "91000000-0000-4000-8000-000000000016",
            botId,
            "suspended",
          ),
          setStatusCommand(
            "91000000-0000-4000-8000-000000000017",
            botId,
            "withdrawn",
          ),
        ];
        const results = [];
        for (const reduction of reductions) {
          results.push(
            await instance.execute({
              command: reduction,
              operatorAuthorized: true,
            }),
          );
        }
        const afterTerminal = await instance.execute({
          command: setStatusCommand(
            "91000000-0000-4000-8000-000000000031",
            botId,
            "published",
          ),
          operatorAuthorized: true,
        });
        return {
          results,
          afterTerminal,
          query: instance.query({ contract: "bot.get@1", botId }),
          outbox: state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
          pending: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_command",
            )
            .one().count,
          commandResults: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM command_results",
            )
            .one().count,
        };
      } finally {
        restoreQueue();
      }
    });

    expect(observed.results).toHaveLength(4);
    expect(observed.results.every((result) => result.ok)).toBe(true);
    expect(observed.afterTerminal).toEqual({
      ok: false,
      code: "invalid_transition",
    });
    expect(observed.query).toMatchObject({
      ok: true,
      state: {
        cursor: 5,
        status: "withdrawn",
        supportedActionContracts: ["message.reaction-toggle@1"],
      },
    });
    expect(observed).toMatchObject({
      outbox: 260,
      pending: 0,
      commandResults: 260,
    });
  });

  it("refuses a normal extension at the command result ledger cap without mutation", async () => {
    const botId = "91000000-0000-4000-8000-000000000018";
    const bot = env.BOTS.getByName(botId);
    const published = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000019",
        "storage-result-cap",
      ),
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);

    const observed = await runInDurableObject(bot, async (instance, state) => {
      for (let index = 1; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          `saturated-command-${index}`,
          "0".repeat(64),
          "{}",
          "{}",
          "2026-08-21T00:00:00.000Z",
        );
      }
      const extension = await instance.execute({
        command: setActionsCommand(
          "91000000-0000-4000-8000-000000000020",
          botId,
          ["message.reaction-toggle@1", "message.reaction-add@1"],
        ),
        operatorAuthorized: true,
      });
      return {
        extension,
        query: instance.query({ contract: "bot.get@1", botId }),
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      };
    });

    expect(observed.extension).toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 1 },
    });
    expect(observed).toMatchObject({ results: 256, pending: 0, journal: 1 });
  });

  it("saturates a pending command retry counter instead of overflowing it", async () => {
    const botId = "91000000-0000-4000-8000-000000000021";
    const bot = env.BOTS.getByName(botId);
    const command = publishCommand(
      "91000000-0000-4000-8000-000000000022",
      "storage-attempt-saturation",
    );
    command.payload.supportedActionContracts = [
      "message.reaction-add@1",
      "message.reaction-toggle@1",
    ];
    const published = await bot.execute({
      command,
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);

    const reduction = setActionsCommand(
      "91000000-0000-4000-8000-000000000023",
      botId,
      ["message.reaction-toggle@1"],
    );
    const maximumAttempts = 63;
    const saturated = await runInDurableObject(bot, async (instance, state) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const hadBinding = Object.hasOwn(runtimeEnv, "ATTESTATION");
      const previous = runtimeEnv.ATTESTATION;
      runtimeEnv.ATTESTATION = {
        fetch: async () =>
          Response.json({ code: "attestation_failed" }, { status: 503 }),
      };
      try {
        const first = await instance.execute({
          command: reduction,
          operatorAuthorized: true,
        });
        state.storage.sql.exec(
          "UPDATE pending_command SET attempts = ? WHERE singleton = 1",
          maximumAttempts,
        );
        await state.storage.deleteAlarm();
        const second = await instance.execute({
          command: reduction,
          operatorAuthorized: true,
        });
        const attempts = state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_command WHERE singleton = 1",
          )
          .one().attempts;
        return { first, second, attempts };
      } finally {
        await state.storage.deleteAlarm();
        if (hadBinding) {
          runtimeEnv.ATTESTATION = previous;
        } else {
          Reflect.deleteProperty(runtimeEnv, "ATTESTATION");
        }
      }
    });
    expect(saturated.first).toEqual({
      ok: false,
      code: "attestation_failed",
    });
    expect(saturated.second).toEqual({
      ok: false,
      code: "attestation_failed",
    });
    expect(saturated.attempts).toBe(maximumAttempts);
  });

  it("retries one exact projection after a post-enqueue crash and saturates its counter", async () => {
    const botId = "91000000-0000-4000-8000-000000000024";
    const bot = env.BOTS.getByName(botId);
    const published = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000025",
        "storage-crash-duplicate",
      ),
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);
    await runInDurableObject(bot, (instance) => instance.alarm?.());

    const maximumAttempts = 63;
    const observed = await runInDurableObject(bot, async (instance, state) => {
      const payload = {
        contract: "bot.projection-test@1",
        botId,
        cursor: 99,
      };
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, NULL, ?)`,
        "post-enqueue-crash-event",
        99,
        JSON.stringify(payload),
        maximumAttempts,
      );
      const deliveries: unknown[] = [];
      let crashAfterEnqueue = true;
      const restoreQueue = replaceProjectionQueue(instance, async (message) => {
        deliveries.push(structuredClone(message));
        if (crashAfterEnqueue) {
          crashAfterEnqueue = false;
          throw new Error("crash after Queue accepted the message");
        }
      });
      try {
        await instance.alarm?.();
        const afterCrash = state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM outbox WHERE event_id = ?",
            "post-enqueue-crash-event",
          )
          .one().attempts;
        await instance.alarm?.();
        const remaining = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM outbox WHERE event_id = ?",
            "post-enqueue-crash-event",
          )
          .one().count;
        return { payload, deliveries, afterCrash, remaining };
      } finally {
        restoreQueue();
      }
    });

    expect(observed.afterCrash).toBe(maximumAttempts);
    expect(observed.deliveries).toEqual([observed.payload, observed.payload]);
    expect(observed.remaining).toBe(0);
  });

  it("saturates a journal archive retry counter on a corrupt pending archive", async () => {
    const botId = "91000000-0000-4000-8000-000000000026";
    const bot = env.BOTS.getByName(botId);
    const published = await bot.execute({
      command: publishCommand(
        "91000000-0000-4000-8000-000000000027",
        "storage-archive-attempt-saturation",
      ),
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);
    await runInDurableObject(bot, (instance) => instance.alarm?.());

    const maximumAttempts = 63;
    await runInDurableObject(bot, async (instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO pending_archive
          (singleton, start_cursor, end_cursor, previous_segment_hash,
           segment_hash, object_key, events_json, unsigned_seal_json,
           attempts, created_at)
         VALUES (1, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        1,
        1,
        "a".repeat(64),
        "journal/v1/bot/corrupt/1-1-corrupt.json",
        "[]",
        "{}",
        maximumAttempts,
        "2026-08-21T00:00:00.000Z",
      );

      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_archive WHERE singleton = 1",
          )
          .one().attempts,
      ).toBe(maximumAttempts);
    });
  });

  it("exposes an exact pending reduction overlay at both normal caps without waiting on Queue or R2", async () => {
    const botId = "91000000-0000-4000-8000-000000000028";
    const bot = env.BOTS.getByName(botId);
    const command = publishCommand(
      "91000000-0000-4000-8000-000000000029",
      "storage-reduction-overlay",
    );
    command.payload.supportedActionContracts = [
      "message.reaction-add@1",
      "message.reaction-toggle@1",
    ];
    const published = await bot.execute({
      command,
      operatorAuthorized: true,
    });
    expect(published.ok).toBe(true);
    await runInDurableObject(bot, (instance) => instance.alarm?.());

    const reduction = setActionsCommand(
      "91000000-0000-4000-8000-000000000030",
      botId,
      ["message.reaction-toggle@1"],
    );
    await failAttestationOnce(reduction.commandId);
    const observed = await runInDurableObject(bot, async (instance, state) => {
      for (let index = 0; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          `overlay-event-${index}`,
          1_000 + index,
          "{}",
        );
      }
      for (let index = 1; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          `overlay-command-${index}`,
          "0".repeat(64),
          "{}",
          "{}",
          "2026-08-21T00:00:00.000Z",
        );
      }
      const result = await instance.execute({
        command: reduction,
        operatorAuthorized: true,
      });
      return {
        result,
        query: instance.query({ contract: "bot.get@1", botId }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        outbox: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      };
    });

    expect(observed.result).toEqual({
      ok: false,
      code: "attestation_failed",
    });
    expect(observed.query).toMatchObject({
      ok: true,
      state: {
        cursor: 2,
        supportedActionContracts: ["message.reaction-toggle@1"],
      },
    });
    expect(observed).toMatchObject({
      pending: 1,
      outbox: 256,
      results: 255,
      journal: 1,
    });
  });
});
