import type {
  ClaimBotWakeCommand,
  CompleteBotWakeCommand,
} from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  deriveBotWakeId,
  deriveBotWakeOfferDigest,
} from "@punks/core";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const sourceEventId = "1".repeat(64);
const sourceEventDigest = "2".repeat(64);
const createdAt = "2026-08-21T08:00:00.000Z";
const runtimeRelease = await botRuntimeReleaseReference();
let fixtureSequence = 0;
const activeFixtureStubs = new Set<
  ReturnType<typeof env.BOT_INSTALLATIONS.getByName>
>();

afterEach(async () => {
  for (const stub of activeFixtureStubs) {
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM wake_queue_outbox");
      state.storage.sql.exec("DELETE FROM wake_receipt_archive_outbox");
      state.storage.sql.exec("DELETE FROM bot_wakes");
      await state.storage.deleteAlarm();
    });
  }
  activeFixtureStubs.clear();
});

function fixtureId(sequence: number, coordinate: number): string {
  return `${sequence.toString(16).padStart(8, "0")}-0000-8000-8000-${coordinate
    .toString()
    .padStart(12, "0")}`;
}

async function seedRunnableInstallation(): Promise<{
  stub: ReturnType<typeof env.BOT_INSTALLATIONS.getByName>;
  installationId: string;
  wakeId: string;
  candidate: {
    schemaVersion: 1;
    wakeId: string;
    workspaceId: string;
    installationId: string;
    botId: string;
    conversationId: string;
    messageId: string;
    messageCursor: number;
    subscriptionEpoch: number;
    sourceEventId: string;
    sourceEventDigest: string;
    createdAt: string;
  };
}> {
  fixtureSequence += 1;
  const workspaceId = fixtureId(fixtureSequence, 1);
  const conversationId = fixtureId(fixtureSequence, 2);
  const messageId = fixtureId(fixtureSequence, 3);
  const botId = fixtureId(fixtureSequence, 4);
  const installationId = fixtureId(fixtureSequence, 5);
  const stub = env.BOT_INSTALLATIONS.getByName(installationId);
  activeFixtureStubs.add(stub);
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)",
      JSON.stringify({
        id: installationId,
        workspaceId,
        botId,
        status: "active",
        runtimeRelease,
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
        grantCount: 2,
        openAdmissionCount: 0,
        authorityGeneration: 7,
        revision: 7,
        cursor: 7,
        createdAt,
        updatedAt: createdAt,
        revokedAt: null,
      }),
    );
    for (const capability of ["messages.react", "messages.read-context"]) {
      state.storage.sql.exec(
        `INSERT INTO grants
          (capability, resource_kind, resource_id, enabled, updated_cursor,
           enabled_at, tombstoned_at)
         VALUES (?, 'conversation', ?, 1, 7, ?, NULL)`,
        capability,
        conversationId,
        createdAt,
      );
    }
  });
  const wakeId = await deriveBotWakeId({
    installationId,
    subscriptionEpoch: 7,
    messageId,
    messageCursor: 11,
  });
  return {
    stub,
    installationId,
    wakeId,
    candidate: {
      schemaVersion: 1,
      wakeId,
      workspaceId,
      installationId,
      botId,
      conversationId,
      messageId,
      messageCursor: 11,
      subscriptionEpoch: 7,
      sourceEventId,
      sourceEventDigest,
      createdAt,
    },
  };
}

describe("Bot Wake authoritative ledger", () => {
  it("rejects an offer before persistence when either exact grant is absent", async () => {
    const { stub, wakeId, candidate } = await seedRunnableInstallation();
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `DELETE FROM grants
         WHERE capability = 'messages.read-context' AND resource_id = ?`,
        candidate.conversationId,
      );
    });

    expect(await stub.acceptBotWakeCandidate(candidate)).toEqual({
      ok: false,
      code: "authority_revoked",
    });
    expect(
      await runInDurableObject(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM bot_wakes WHERE wake_id = ?",
              wakeId,
            )
            .one().count,
      ),
    ).toBe(0);
  });

  it("reserves terminal capacity by refusing the sixty-fifth open Wake", async () => {
    const { stub, wakeId, candidate } = await seedRunnableInstallation();
    await runInDurableObject(stub, (_instance, state) => {
      for (let index = 0; index < 64; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO bot_wakes
            (wake_id, offer_json, offer_digest, status, turn_id, claimed_at,
             terminal_json, completed_at, updated_at)
           VALUES (?, '{}', ?, 'offered', NULL, NULL, NULL, NULL, ?)`,
          fixtureId(0x70000000 + index, 1_000 + index),
          "0".repeat(64),
          createdAt,
        );
      }
    });

    expect(await stub.acceptBotWakeCandidate(candidate)).toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
    expect(
      await runInDurableObject(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM bot_wakes WHERE wake_id = ?",
              wakeId,
            )
            .one().count,
      ),
    ).toBe(0);
  });

  it("atomically admits an exact candidate and its opaque Queue outbox", async () => {
    const { stub, wakeId, candidate } = await seedRunnableInstallation();

    const observed = await runInDurableObject(
      stub,
      async (instance, state) => ({
        accepted: await instance.acceptBotWakeCandidate(candidate),
        rows: {
          wakes: state.storage.sql
            .exec<{
              wake_id: string;
              status: string;
              offer_json: string;
            }>("SELECT wake_id, status, offer_json FROM bot_wakes")
            .toArray(),
          queue: state.storage.sql
            .exec<{ wake_id: string }>("SELECT wake_id FROM wake_queue_outbox")
            .toArray(),
        },
      }),
    );
    const { accepted, rows } = observed;

    expect(accepted).toEqual({
      ok: true,
      wakeId,
      replayed: false,
      terminal: false,
    });
    expect(rows.wakes).toHaveLength(1);
    expect(rows.wakes[0]).toMatchObject({ wake_id: wakeId, status: "offered" });
    expect(JSON.parse(rows.wakes[0]?.offer_json ?? "null")).toMatchObject({
      contract: "bot-wake.offer@1",
      wakeId,
      runtimeRelease,
    });
    expect(rows.queue).toEqual([{ wake_id: wakeId }]);
  });

  it("claims one admitted Wake with a stable deterministic Turn", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim: ClaimBotWakeCommand = {
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    };

    const first = await stub.claimBotWake(claim);
    const replay = await stub.claimBotWake(claim);

    expect(first).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "claimed",
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
  });

  it("commits a terminal skip and its cold receipt outbox atomically", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const complete: CompleteBotWakeCommand = {
      contract: "bot-wake.complete@1",
      installationId,
      wakeId,
      turnId: claim.turnId,
      terminal: {
        outcome: "succeeded",
        decision: "skip",
        reason: "model_selected_skip",
      },
    };

    const committed = await runInDurableObject(
      stub,
      async (instance, state) => ({
        terminal: await instance.completeBotWake(complete),
        rows: {
          wake: state.storage.sql
            .exec<{ status: string; terminal_json: string }>(
              "SELECT status, terminal_json FROM bot_wakes WHERE wake_id = ?",
              wakeId,
            )
            .one(),
          archive: state.storage.sql
            .exec<{ wake_id: string; archive_json: string }>(
              "SELECT wake_id, archive_json FROM wake_receipt_archive_outbox",
            )
            .one(),
        },
      }),
    );
    const { rows, terminal } = committed;

    if (!terminal.ok || terminal.status !== "terminal") {
      throw new Error("Wake completion fixture failed");
    }

    expect(terminal).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      replayed: true,
      receipt: {
        schemaVersion: 1,
        turnId: claim.turnId,
        terminal: complete.terminal,
      },
    });
    expect(rows.wake.status).toBe("terminal");
    expect(JSON.parse(rows.wake.terminal_json).terminal).toEqual(
      complete.terminal,
    );
    expect(JSON.parse(rows.archive.archive_json)).toEqual(terminal.receipt);
  });

  it("archives a terminal receipt create-only and replays cold-first", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const objectKey = await runInDurableObject(
      stub,
      async (instance, state) => {
        await instance.completeBotWake({
          contract: "bot-wake.complete@1",
          installationId,
          wakeId,
          turnId: claim.turnId,
          terminal: {
            outcome: "succeeded",
            decision: "skip",
            reason: "model_selected_skip",
          },
        } satisfies CompleteBotWakeCommand);
        return state.storage.sql
          .exec<{ object_key: string }>(
            "SELECT object_key FROM wake_receipt_archive_outbox WHERE wake_id = ?",
            wakeId,
          )
          .one().object_key;
      },
    );

    await runInDurableObject(stub, (instance) => instance.alarm());
    await evictDurableObject(stub);

    const object = await env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe("application/json");
    const local = await runInDurableObject(stub, (_instance, state) => ({
      wakes: state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM bot_wakes")
        .one().count,
      outbox: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM wake_receipt_archive_outbox",
        )
        .one().count,
    }));
    expect(local).toEqual({ wakes: 0, outbox: 0 });

    const replay = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    expect(replay).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      replayed: true,
      receipt: { offer: { wakeId } },
    });
  });

  it("recovers an exact receipt already written before the local cleanup", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const pending = await runInDurableObject(stub, async (instance, state) => {
      await instance.completeBotWake({
        contract: "bot-wake.complete@1",
        installationId,
        wakeId,
        turnId: claim.turnId,
        terminal: {
          outcome: "succeeded",
          decision: "skip",
          reason: "model_selected_skip",
        },
      } satisfies CompleteBotWakeCommand);
      return state.storage.sql
        .exec<{
          object_key: string;
          archive_json: string;
          body_hash: string;
        }>(
          `SELECT object_key, archive_json, body_hash
             FROM wake_receipt_archive_outbox WHERE wake_id = ?`,
          wakeId,
        )
        .one();
    });
    const coordinateHash =
      pending.object_key.split("/")[3]?.replace(/\.json$/, "") ?? "";
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.object_key,
      pending.archive_json,
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          aggregate: "bot-wake-receipt",
          coordinateHash,
          bodyHash: pending.body_hash,
        },
      },
    );

    await runInDurableObject(stub, (instance) => instance.alarm());

    expect(
      await runInDurableObject(stub, (_instance, state) => ({
        wakes: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM bot_wakes")
          .one().count,
        archives: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM wake_receipt_archive_outbox",
          )
          .one().count,
      })),
    ).toEqual({ wakes: 0, archives: 0 });
    expect(
      await (await env.JOURNAL_ARCHIVE_BUCKET.get(pending.object_key))?.text(),
    ).toBe(pending.archive_json);
  });

  it("keeps the hot terminal authoritative when an existing cold receipt is noncanonical", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const pending = await runInDurableObject(stub, async (instance, state) => {
      await instance.completeBotWake({
        contract: "bot-wake.complete@1",
        installationId,
        wakeId,
        turnId: claim.turnId,
        terminal: {
          outcome: "succeeded",
          decision: "skip",
          reason: "model_selected_skip",
        },
      } satisfies CompleteBotWakeCommand);
      return state.storage.sql
        .exec<{
          object_key: string;
          archive_json: string;
          body_hash: string;
        }>(
          `SELECT object_key, archive_json, body_hash
           FROM wake_receipt_archive_outbox WHERE wake_id = ?`,
          wakeId,
        )
        .one();
    });
    const coordinateHash =
      pending.object_key.split("/")[3]?.replace(/\.json$/, "") ?? "";
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.object_key,
      `${pending.archive_json}\n`,
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          aggregate: "bot-wake-receipt",
          coordinateHash,
          bodyHash: pending.body_hash,
        },
      },
    );

    await runInDurableObject(stub, (instance) => instance.alarm());

    const local = await runInDurableObject(stub, (_instance, state) => ({
      status: state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM bot_wakes WHERE wake_id = ?",
          wakeId,
        )
        .one().status,
      archive: state.storage.sql
        .exec<{ attempts: number }>(
          `SELECT attempts FROM wake_receipt_archive_outbox
           WHERE wake_id = ?`,
          wakeId,
        )
        .one(),
    }));
    expect(local.status).toBe("terminal");
    expect(local.archive.attempts).toBe(1);
    expect(
      await stub.claimBotWake({
        contract: "bot-wake.claim@1",
        installationId,
        wakeId,
      } satisfies ClaimBotWakeCommand),
    ).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("lets a cold terminal receipt erase a restored live Wake and Queue outbox", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    await stub.completeBotWake({
      contract: "bot-wake.complete@1",
      installationId,
      wakeId,
      turnId: claim.turnId,
      terminal: {
        outcome: "succeeded",
        decision: "skip",
        reason: "model_selected_skip",
      },
    } satisfies CompleteBotWakeCommand);
    await runInDurableObject(stub, (instance) => instance.alarm());
    const terminal = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!terminal.ok || terminal.status !== "terminal") {
      throw new Error("Cold Wake receipt fixture failed");
    }
    const offerJson = canonicalJson(terminal.receipt.offer);
    const offerDigest = await deriveBotWakeOfferDigest(terminal.receipt.offer);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO bot_wakes
          (wake_id, offer_json, offer_digest, status, turn_id, claimed_at,
           terminal_json, completed_at, updated_at)
         VALUES (?, ?, ?, 'offered', NULL, NULL, NULL, NULL, ?)`,
        wakeId,
        offerJson,
        offerDigest,
        terminal.receipt.offer.createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO wake_queue_outbox
          (wake_id, attempts, next_attempt_at, created_at)
         VALUES (?, 0, 0, ?)`,
        wakeId,
        terminal.receipt.offer.createdAt,
      );
    });
    const delivered: unknown[] = [];
    await runInDurableObject(stub, async (instance) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const hadBinding = Object.hasOwn(runtimeEnv, "BOT_WAKE_QUEUE");
      const previous = runtimeEnv.BOT_WAKE_QUEUE;
      runtimeEnv.BOT_WAKE_QUEUE = {
        send: async (body: unknown) => {
          delivered.push(body);
        },
      };
      try {
        await instance.alarm();
      } finally {
        if (hadBinding) {
          runtimeEnv.BOT_WAKE_QUEUE = previous;
        } else {
          Reflect.deleteProperty(runtimeEnv, "BOT_WAKE_QUEUE");
        }
      }
    });

    const replay = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);

    expect(replay).toEqual(terminal);
    expect(delivered).toEqual([]);
    expect(
      await runInDurableObject(stub, (_instance, state) => ({
        wakes: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM bot_wakes")
          .one().count,
        queue: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM wake_queue_outbox",
          )
          .one().count,
      })),
    ).toEqual({ wakes: 0, queue: 0 });
  });

  it("terminalizes before inference when the daily Turn budget is exhausted", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO bot_wake_daily_budget (budget_day, claimed_count)
         VALUES (?, 256)`,
        new Date().toISOString().slice(0, 10),
      );
    });

    const result = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);

    expect(result).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      replayed: true,
      receipt: {
        offer: { wakeId },
        terminal: { outcome: "failed", code: "budget_exhausted" },
      },
    });
    const usage = await runInDurableObject(stub, (_instance, state) => ({
      budget: state.storage.sql
        .exec<{ claimed_count: number }>(
          "SELECT claimed_count FROM bot_wake_daily_budget",
        )
        .one().claimed_count,
      wake: state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM bot_wakes WHERE wake_id = ?",
          wakeId,
        )
        .one().status,
      archiveRows: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM wake_receipt_archive_outbox",
        )
        .one().count,
    }));
    expect(usage).toEqual({ budget: 256, wake: "terminal", archiveRows: 1 });
  });

  it("authorizes context only while the claimed Wake retains both exact grants", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }

    const authorized = await stub.authorizeBotWakeContext({
      installationId,
      wakeId,
      turnId: claim.turnId,
    });
    expect(authorized).toMatchObject({
      ok: true,
      offer: { wakeId, conversationId: candidate.conversationId },
      turnId: claim.turnId,
      authorityGeneration: 7,
    });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `DELETE FROM grants
         WHERE capability = 'messages.read-context'
           AND resource_id = ?`,
        candidate.conversationId,
      );
    });
    expect(
      await stub.authorizeBotWakeContext({
        installationId,
        wakeId,
        turnId: claim.turnId,
      }),
    ).toEqual({ ok: false, code: "authority_revoked" });
  });

  it("delivers the exact opaque Queue body and retains a leased watchdog until terminal", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const delivered: unknown[] = [];
    const deliveredAfter = Date.now();

    await runInDurableObject(stub, async (instance) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const hadBinding = Object.hasOwn(runtimeEnv, "BOT_WAKE_QUEUE");
      const previous = runtimeEnv.BOT_WAKE_QUEUE;
      runtimeEnv.BOT_WAKE_QUEUE = {
        send: async (body: unknown) => {
          delivered.push(body);
        },
      };
      try {
        await instance.alarm();
      } finally {
        if (hadBinding) {
          runtimeEnv.BOT_WAKE_QUEUE = previous;
        } else {
          Reflect.deleteProperty(runtimeEnv, "BOT_WAKE_QUEUE");
        }
      }
    });

    expect(delivered.length).toBeGreaterThanOrEqual(1);
    expect(
      delivered.every(
        (body) =>
          JSON.stringify(body) === JSON.stringify({ installationId, wakeId }),
      ),
    ).toBe(true);
    expect(Object.keys(delivered[0] as object).sort()).toEqual([
      "installationId",
      "wakeId",
    ]);
    const watchdog = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ attempts: number; next_attempt_at: number }>(
          `SELECT attempts, next_attempt_at FROM wake_queue_outbox
           WHERE wake_id = ?`,
          wakeId,
        )
        .one(),
    );
    expect(watchdog.attempts).toBe(0);
    expect(watchdog.next_attempt_at).toBeGreaterThanOrEqual(
      deliveredAfter + 60_000,
    );
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM wake_queue_outbox");
      state.storage.sql.exec("DELETE FROM bot_wakes");
      await state.storage.deleteAlarm();
    });
  });

  it("redelivers a claimed Wake after revoke so the Workflow can terminalize it", async () => {
    const { stub, installationId, wakeId, candidate } =
      await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    const claim = await stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId,
      wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const delivered: unknown[] = [];
    await runInDurableObject(stub, async (instance, state) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const hadBinding = Object.hasOwn(runtimeEnv, "BOT_WAKE_QUEUE");
      const previous = runtimeEnv.BOT_WAKE_QUEUE;
      runtimeEnv.BOT_WAKE_QUEUE = {
        send: async (body: unknown) => {
          delivered.push(body);
        },
      };
      try {
        state.storage.sql.exec(
          `DELETE FROM grants
           WHERE capability = 'messages.read-context' AND resource_id = ?`,
          candidate.conversationId,
        );
        state.storage.sql.exec(
          "UPDATE wake_queue_outbox SET next_attempt_at = 0 WHERE wake_id = ?",
          wakeId,
        );
        await state.storage.deleteAlarm();
        await instance.alarm();
      } finally {
        await state.storage.deleteAlarm();
        if (hadBinding) {
          runtimeEnv.BOT_WAKE_QUEUE = previous;
        } else {
          Reflect.deleteProperty(runtimeEnv, "BOT_WAKE_QUEUE");
        }
      }
    });

    expect(delivered.length).toBeGreaterThanOrEqual(1);
    for (const body of delivered) {
      expect(body).toEqual({ installationId, wakeId });
    }
    expect(
      await stub.claimBotWake({
        contract: "bot-wake.claim@1",
        installationId,
        wakeId,
      } satisfies ClaimBotWakeCommand),
    ).toMatchObject({ ok: true, status: "claimed", replayed: true });
    expect(
      await stub.authorizeBotWakeContext({
        installationId,
        wakeId,
        turnId: claim.turnId,
      }),
    ).toEqual({ ok: false, code: "authority_revoked" });
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM wake_queue_outbox");
      state.storage.sql.exec("DELETE FROM bot_wakes");
      await state.storage.deleteAlarm();
    });
  });

  it("terminalizes an offered Wake revoked before Queue delivery", async () => {
    const { stub, wakeId, candidate } = await seedRunnableInstallation();
    await stub.acceptBotWakeCandidate(candidate);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `DELETE FROM grants
         WHERE capability = 'messages.read-context' AND resource_id = ?`,
        candidate.conversationId,
      );
    });
    const delivered: unknown[] = [];
    await runInDurableObject(stub, async (instance) => {
      const runtimeEnv = Reflect.get(instance, "env") as Record<
        string,
        unknown
      >;
      const hadBinding = Object.hasOwn(runtimeEnv, "BOT_WAKE_QUEUE");
      const previous = runtimeEnv.BOT_WAKE_QUEUE;
      runtimeEnv.BOT_WAKE_QUEUE = {
        send: async (body: unknown) => {
          delivered.push(body);
        },
      };
      try {
        await instance.alarm();
      } finally {
        if (hadBinding) {
          runtimeEnv.BOT_WAKE_QUEUE = previous;
        } else {
          Reflect.deleteProperty(runtimeEnv, "BOT_WAKE_QUEUE");
        }
      }
    });

    expect(delivered).toEqual([]);
    expect(
      await runInDurableObject(stub, (_instance, state) => ({
        live: state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM bot_wakes
             WHERE wake_id = ? AND status != 'terminal'`,
            wakeId,
          )
          .one().count,
        queue: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM wake_queue_outbox",
          )
          .one().count,
      })),
    ).toEqual({ live: 0, queue: 0 });
    expect(
      await stub.claimBotWake({
        contract: "bot-wake.claim@1",
        installationId: candidate.installationId,
        wakeId,
      } satisfies ClaimBotWakeCommand),
    ).toMatchObject({
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      receipt: { terminal: { outcome: "failed", code: "revoked" } },
    });
  });

  it("rearms the earliest future Queue and receipt work after an earlier alarm fires", async () => {
    const queue = await seedRunnableInstallation();
    await queue.stub.acceptBotWakeCandidate(queue.candidate);
    const queueDueAt = Date.now() + 30_000;
    const queueAlarm = await runInDurableObject(
      queue.stub,
      async (instance, state) => {
        state.storage.sql.exec(
          "UPDATE wake_queue_outbox SET next_attempt_at = ? WHERE wake_id = ?",
          queueDueAt,
          queue.wakeId,
        );
        await state.storage.deleteAlarm();
        await instance.alarm();
        return state.storage.getAlarm();
      },
    );
    expect(queueAlarm).not.toBeNull();
    expect(queueAlarm ?? 0).toBeLessThanOrEqual(queueDueAt);

    const receipt = await seedRunnableInstallation();
    await receipt.stub.acceptBotWakeCandidate(receipt.candidate);
    const claim = await receipt.stub.claimBotWake({
      contract: "bot-wake.claim@1",
      installationId: receipt.installationId,
      wakeId: receipt.wakeId,
    } satisfies ClaimBotWakeCommand);
    if (!claim.ok || claim.status !== "claimed") {
      throw new Error("Wake claim fixture failed");
    }
    const receiptDueAt = Date.now() + 45_000;
    const receiptAlarm = await runInDurableObject(
      receipt.stub,
      async (instance, state) => {
        await instance.completeBotWake({
          contract: "bot-wake.complete@1",
          installationId: receipt.installationId,
          wakeId: receipt.wakeId,
          turnId: claim.turnId,
          terminal: {
            outcome: "succeeded",
            decision: "skip",
            reason: "model_selected_skip",
          },
        } satisfies CompleteBotWakeCommand);
        state.storage.sql.exec(
          `UPDATE wake_receipt_archive_outbox
         SET next_attempt_at = ? WHERE wake_id = ?`,
          receiptDueAt,
          receipt.wakeId,
        );
        await state.storage.deleteAlarm();
        await instance.alarm();
        return state.storage.getAlarm();
      },
    );
    expect(receiptAlarm).not.toBeNull();
    expect(receiptAlarm ?? 0).toBeLessThanOrEqual(receiptDueAt);

    for (const fixture of [queue, receipt]) {
      await runInDurableObject(fixture.stub, async (_instance, state) => {
        state.storage.sql.exec("DELETE FROM wake_queue_outbox");
        state.storage.sql.exec("DELETE FROM wake_receipt_archive_outbox");
        state.storage.sql.exec("DELETE FROM bot_wakes");
        await state.storage.deleteAlarm();
      });
    }
  });
});
