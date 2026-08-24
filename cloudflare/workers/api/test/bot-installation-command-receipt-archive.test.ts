import type {
  CreateWorkspaceCommand,
  InstallBotCommand,
  PublishBotCommand,
  RevokeBotInstallationCommand,
  UnsignedNostrEvent,
} from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  deriveBotInstallationId,
  deriveOpaqueUuid,
  sha256Hex,
} from "@punks/core";
import {
  env,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { commandReceiptCoordinate } from "../src/command-receipt-archive";
import type { ApiEnv } from "../src/env";
import type { BotInstallationExecuteResult } from "../src/rpc";

const operatorPunkId = "00000000-0000-8000-8000-000000000001";
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

async function setupInstallation(seed: string): Promise<{
  installationId: string;
  command: InstallBotCommand;
}> {
  const botCommandId = await deriveOpaqueUuid("test.receipt.bot", seed);
  const botId = await deriveOpaqueUuid("punks.bot.v1", botCommandId);
  const publish: PublishBotCommand = {
    contract: "bot.publish@1",
    commandId: botCommandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug: `receipt-${seed}`,
      name: `Receipt ${seed}`,
      description: "Installation cold receipt fixture",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-toggle@1"],
      runtimeRelease,
    },
  };
  await expect(
    env.BOTS.getByName(botId).execute({
      command: publish,
      operatorAuthorized: true,
    }),
  ).resolves.toMatchObject({ ok: true });

  const workspaceCommandId = await deriveOpaqueUuid(
    "test.receipt.workspace",
    seed,
  );
  const workspaceId = await deriveOpaqueUuid(
    "punks.workspace.v1",
    workspaceCommandId,
  );
  const createWorkspace: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: workspaceCommandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug: `receipt-${seed}`,
      name: `Receipt ${seed}`,
      visibility: "private",
    },
  };
  await expect(
    env.WORKSPACES.getByName(workspaceId).execute(createWorkspace),
  ).resolves.toMatchObject({ ok: true });

  const installationId = await deriveBotInstallationId(workspaceId, botId);
  return {
    installationId,
    command: {
      contract: "bot-installation.install@1",
      commandId: await deriveOpaqueUuid("test.receipt.install", seed),
      workspaceId,
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
      },
    },
  };
}

async function execute(
  installationId: string,
  command: InstallBotCommand,
): Promise<BotInstallationExecuteResult> {
  return env.BOT_INSTALLATIONS.getByName(installationId).execute(command);
}

describe("BotInstallationDO perpetual management command receipts", () => {
  it("atomically queues a config-safe receipt, compacts it, then cold-replays exactly", async () => {
    const { installationId, command } = await setupInstallation("cold-a");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    const created = await execute(installationId, command);
    expect(created).toMatchObject({ ok: true, replayed: false });

    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ command_json: string }>(
            "SELECT command_json FROM command_results WHERE command_id = ?",
            command.commandId,
          )
          .one().command_json,
      ).toBe("{}");
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_receipt_archive_outbox WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(1);
      state.storage.sql.exec(
        "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
        command.commandId,
      );
    });

    await runInDurableObject(installation, (instance) => instance.alarm());
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(0);
    });
    const laterRevoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: await deriveOpaqueUuid("test.receipt.later-revoke", "cold-a"),
      workspaceId: command.workspaceId,
      installationId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { cause: "Advance aggregate state after the archived install" },
    };
    await expect(installation.execute(laterRevoke)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    await expect(execute(installationId, command)).resolves.toEqual(
      created.ok
        ? { ok: true, value: created.value, replayed: true }
        : expect.unreachable(),
    );
    await expect(
      installation.query({
        contract: "bot-installation.get@1",
        workspaceId: command.workspaceId,
        installationId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: { status: "revoked", cursor: 2 },
    });
    await expect(
      execute(installationId, {
        ...command,
        actor: {
          kind: "punk",
          punkId: "00000000-0000-8000-8000-000000000099",
        },
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });

    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot-installation",
      aggregateId: installationId,
      commandId: command.commandId,
    });
    const stored = await env.JOURNAL_ARCHIVE_BUCKET.get(coordinate.key);
    const body = await stored?.text();
    expect(body).toContain('"value":{}');
    expect(body).not.toContain("command_json");
    expect(body).not.toContain(canonicalJson(command));
  });

  it("looks cold first and fails closed on outage or corrupt exact objects", async () => {
    const { installationId, command } = await setupInstallation("cold-b");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    expect((await execute(installationId, command)).ok).toBe(true);

    await runInDurableObject(installation, async (instance) => {
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
        await expect(instance.execute(command)).resolves.toEqual({
          ok: false,
          code: "temporarily_unavailable",
        });
      } finally {
        restoreBucket();
      }
    });

    await runInDurableObject(installation, (instance) => instance.alarm());
    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot-installation",
      aggregateId: installationId,
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
    await expect(execute(installationId, command)).resolves.toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("maps a malformed cold terminal to the exact Installation HTTP 503 retry contract", async () => {
    const { installationId, command } = await setupInstallation("http-503");
    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot-installation",
      aggregateId: installationId,
      commandId: command.commandId,
    });
    await env.JOURNAL_ARCHIVE_BUCKET.put(coordinate.key, "{}", {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        aggregate: "bot-installation-command-receipt",
        aggregateHash: coordinate.aggregateHash,
        bodyHash: "0".repeat(64),
        commandHash: coordinate.commandHash,
        payloadHash: "0".repeat(64),
        schemaVersion: "1",
        terminal: "committed",
      },
    });

    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${command.workspaceId}/bot-installations`,
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
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "temporarily_unavailable",
      retry: "same_command",
      retryAfterMs: 1_000,
      status: 503,
      title: "Bot Installation command receipt archive is unavailable",
    });
  });

  it("retains hot authority across pre/post-put crashes until exact recovery", async () => {
    for (const crashAfterPut of [false, true]) {
      const seed = crashAfterPut ? "crash-post" : "crash-pre";
      const { installationId, command } = await setupInstallation(seed);
      const installation = env.BOT_INSTALLATIONS.getByName(installationId);
      expect((await execute(installationId, command)).ok).toBe(true);

      await runInDurableObject(installation, async (instance, state) => {
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
          "UPDATE command_receipt_archive_outbox SET next_attempt_at = 0",
        );
      });
      await runInDurableObject(installation, (instance) => instance.alarm());
      await runInDurableObject(installation, (_instance, state) => {
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

  it("lets the verified cold commit dominate a PITR-restored pending decision", async () => {
    const { installationId, command } = await setupInstallation("pitr-a");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    const created = await execute(installationId, command);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    await runInDurableObject(installation, (instance) => instance.alarm());
    const payloadHash = await sha256Hex(canonicalJson(command));
    const signed = created.value.event;
    const unsigned: UnsignedNostrEvent = {
      created_at: signed.created_at,
      kind: signed.kind,
      tags: signed.tags.slice(0, -1),
      content: signed.content,
    };
    await runInDurableObject(installation, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM installation_state");
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
           next_state_json, grant_json, reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, NULL, 0, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(unsigned),
        JSON.stringify(created.value.state),
        new Date().toISOString(),
      );
    });

    await expect(execute(installationId, command)).resolves.toEqual({
      ok: true,
      value: created.value,
      replayed: true,
    });
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM installation_state WHERE singleton = 1",
            )
            .one().state_json,
        ),
      ).toEqual(created.value.state);
    });
  });

  it("lets a cold authority reduction dominate restored management and action pendings", async () => {
    const { installationId, command } = await setupInstallation("pitr-revoke");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    const installed = await execute(installationId, command);
    expect(installed.ok).toBe(true);
    if (!installed.ok) {
      return;
    }
    await runInDurableObject(installation, (instance) => instance.alarm());
    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: await deriveOpaqueUuid("test.receipt.revoke", "pitr-revoke"),
      workspaceId: command.workspaceId,
      installationId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { cause: "Verified cold reduction dominates restored work" },
    };
    const revoked = (await installation.execute(
      revoke,
    )) as BotInstallationExecuteResult;
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) {
      return;
    }
    await runInDurableObject(installation, (instance) => instance.alarm());
    const payloadHash = await sha256Hex(canonicalJson(revoke));
    const unsigned = {
      created_at: revoked.value.event.created_at,
      kind: revoked.value.event.kind,
      tags: revoked.value.event.tags.slice(0, -1),
      content: revoked.value.event.content,
    } satisfies UnsignedNostrEvent;
    const pendingActionCommandId = await deriveOpaqueUuid(
      "test.receipt.pending-action.command",
      "pitr-revoke",
    );
    const pendingActionId = await deriveOpaqueUuid(
      "test.receipt.pending-action.action",
      "pitr-revoke",
    );
    await runInDurableObject(installation, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(installed.value.state),
      );
      state.storage.sql.exec("DELETE FROM journal WHERE cursor = 2");
      state.storage.sql.exec("DELETE FROM outbox WHERE cursor = 2");
      state.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, grant_json, reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, NULL, 1, 0, ?)`,
        revoke.commandId,
        payloadHash,
        JSON.stringify(revoke),
        JSON.stringify(unsigned),
        JSON.stringify(revoked.value.state),
        new Date().toISOString(),
      );
      state.storage.sql.exec(
        `INSERT INTO pending_action_command
          (singleton, operation, command_id, action_id, action_digest, jti,
           command_json, unsigned_json, next_state_json, admission_json,
           attempts, created_at)
         VALUES (1, 'admit', ?, ?, ?, NULL, '{}', '{}', '{}', '{}', 0, ?)`,
        pendingActionCommandId,
        pendingActionId,
        "a".repeat(64),
        new Date().toISOString(),
      );
    });

    await expect(installation.execute(revoke)).resolves.toEqual({
      ok: true,
      value: revoked.value,
      replayed: true,
    });
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_action_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("migrates and cold-replays rejected legacy rows in batches of at most twenty", async () => {
    const { installationId, command } = await setupInstallation("legacy-r");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    const commands: InstallBotCommand[] = [];
    for (let index = 0; index < 21; index += 1) {
      commands.push({
        ...command,
        commandId: await deriveOpaqueUuid(
          "test.receipt.rejected",
          String(index),
        ),
      });
    }
    await runInDurableObject(installation, async (instance, state) => {
      for (const legacy of commands) {
        state.storage.sql.exec(
          `INSERT INTO rejected_commands
            (command_id, payload_hash, code, rejected_at)
           VALUES (?, ?, 'forbidden', ?)`,
          legacy.commandId,
          await sha256Hex(canonicalJson(legacy)),
          new Date().toISOString(),
        );
      }
      await instance.alarm();
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM rejected_commands",
          )
          .one().count,
      ).toBe(1);
      state.storage.sql.exec(
        "UPDATE command_receipt_archive_outbox SET next_attempt_at = 0",
      );
      await instance.alarm();
    });
    await expect(installation.execute(command)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    await expect(
      execute(installationId, commands[0] as InstallBotCommand),
    ).resolves.toEqual({
      ok: false,
      code: "forbidden",
    });
    await expect(
      execute(installationId, {
        ...(commands[0] as InstallBotCommand),
        actor: { kind: "punk", punkId: "00000000-0000-8000-8000-000000000099" },
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
  });

  it("repairs a lost alarm when management archive work exists", async () => {
    const installationId = await deriveOpaqueUuid(
      "test.receipt.installation.repair",
      "repair-r",
    );
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    await runInDurableObject(installation, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO command_receipt_archive_outbox
          (command_id, payload_hash, terminal_kind, object_key, archive_json,
           body_hash, attempts, next_attempt_at, created_at)
         VALUES (?, ?, 'rejected', ?, '{}', ?, 0, 0, ?)`,
        await deriveOpaqueUuid("test.receipt.command.repair", "repair-r"),
        "aa".repeat(32),
        `command-receipts/v1/bot-installation/${"bb".repeat(32)}/${"cc".repeat(32)}.json`,
        "dd".repeat(32),
        new Date().toISOString(),
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(installation);
    await runInDurableObject(installation, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      state.storage.sql.exec("DELETE FROM command_receipt_archive_outbox");
      await state.storage.deleteAlarm();
    });
  });

  it("caps management archive retry state at 63 with bounded backoff", async () => {
    const { installationId, command } = await setupInstallation("retry-r");
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    expect((await execute(installationId, command)).ok).toBe(true);
    await runInDurableObject(installation, async (instance, state) => {
      state.storage.sql.exec(
        "UPDATE command_receipt_archive_outbox SET attempts = 63, next_attempt_at = 0",
      );
      const instanceEnv = Reflect.get(instance, "env") as ApiEnv;
      const realBucket = instanceEnv.JOURNAL_ARCHIVE_BUCKET;
      const restoreBucket = replaceBinding(
        instanceEnv,
        "JOURNAL_ARCHIVE_BUCKET",
        {
          get: realBucket.get.bind(realBucket),
          put: async () => {
            throw new Error("retry outage");
          },
        } as unknown as R2Bucket,
      );
      try {
        await instance.alarm();
        const row = state.storage.sql
          .exec<{ attempts: number; next_attempt_at: number }>(
            "SELECT attempts, next_attempt_at FROM command_receipt_archive_outbox",
          )
          .one();
        expect(row.attempts).toBe(63);
        expect(row.next_attempt_at).toBeGreaterThan(Date.now());
      } finally {
        restoreBucket();
      }
    });
  });
});
