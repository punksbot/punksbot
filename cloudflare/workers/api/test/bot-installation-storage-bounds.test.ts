import type {
  ConfigureBotInstallationCommand,
  RevokeBotInstallationCommand,
} from "@punks/contracts";
import { botRuntimeReleaseReference } from "@punks/core";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const punkId = "00000000-0000-8000-8000-000000000001";
const runtimeRelease = await botRuntimeReleaseReference();

function opaqueId(prefix: number, suffix: number): string {
  return `${prefix.toString(16).padStart(8, "0")}-0000-8000-8000-${suffix
    .toString()
    .padStart(12, "0")}`;
}

function installation(prefix: string) {
  return env.BOT_INSTALLATIONS.getByName(
    `${prefix}-0000-8000-8000-000000000001`,
  );
}

function replaceProjectionQueue(
  instance: object,
  send: (message: unknown) => Promise<unknown>,
): () => void {
  const runtimeEnv: unknown = Reflect.get(instance, "env");
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) {
    throw new Error("BotInstallationDO runtime environment is unavailable");
  }
  const previous = Reflect.get(runtimeEnv, "PROJECTION_QUEUE");
  Reflect.set(runtimeEnv, "PROJECTION_QUEUE", { send });
  return () => {
    Reflect.set(runtimeEnv, "PROJECTION_QUEUE", previous);
  };
}

function replaceAuthorityBindings(
  instance: object,
  coordinates: { workspaceId: string; botId: string },
): () => void {
  const runtimeEnv: unknown = Reflect.get(instance, "env");
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) {
    throw new Error("BotInstallationDO runtime environment is unavailable");
  }
  const previous = {
    workspaces: Reflect.get(runtimeEnv, "WORKSPACES"),
    conversations: Reflect.get(runtimeEnv, "CONVERSATIONS"),
    bots: Reflect.get(runtimeEnv, "BOTS"),
  };
  const now = "2026-08-21T00:00:00.000Z";
  Reflect.set(runtimeEnv, "WORKSPACES", {
    getByName: () => ({
      authorize: async () => ({
        ok: true,
        role: "owner",
        visibility: "private",
        workspaceCursor: 1,
      }),
      query: async () => ({
        ok: true,
        state: {
          id: coordinates.workspaceId,
          slug: "installation-storage",
          name: "Installation storage",
          visibility: "private",
          status: "active",
          ownerPunkId: punkId,
          members: [{ punkId, role: "owner" }],
          revision: 1,
          cursor: 1,
          createdAt: now,
          updatedAt: now,
        },
      }),
    }),
  });
  Reflect.set(runtimeEnv, "CONVERSATIONS", {
    getByName: () => ({
      authorizeBotGrant: async () => ({ ok: true, conversationCursor: 1 }),
    }),
  });
  Reflect.set(runtimeEnv, "BOTS", {
    getByName: () => ({
      query: async () => ({
        ok: true,
        state: {
          id: coordinates.botId,
          slug: "installation-storage-bot",
          name: "Installation storage Bot",
          description: "Storage bounds fixture",
          status: "published",
          configContractId: "punks://contracts/bot.config.empty@1",
          runtimeRelease,
          supportedActionContracts: ["message.reaction-toggle@1"],
          revision: 1,
          cursor: 1,
          createdAt: now,
          updatedAt: now,
          suspendedAt: null,
          withdrawnAt: null,
        },
      }),
    }),
  });
  return () => {
    Reflect.set(runtimeEnv, "WORKSPACES", previous.workspaces);
    Reflect.set(runtimeEnv, "CONVERSATIONS", previous.conversations);
    Reflect.set(runtimeEnv, "BOTS", previous.bots);
  };
}

function replaceWorkspaceAuthorization(
  instance: object,
  authorize: () => Promise<unknown>,
): () => void {
  const runtimeEnv: unknown = Reflect.get(instance, "env");
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) {
    throw new Error("BotInstallationDO runtime environment is unavailable");
  }
  const previous = Reflect.get(runtimeEnv, "WORKSPACES");
  Reflect.set(runtimeEnv, "WORKSPACES", {
    getByName: () => ({ authorize }),
  });
  return () => {
    Reflect.set(runtimeEnv, "WORKSPACES", previous);
  };
}

async function failAttestationOnce(commandId: string): Promise<void> {
  const response = await env.ATTESTATION.fetch(
    "https://fixture/__test/fail-once",
    { method: "POST", body: JSON.stringify({ commandId }) },
  );
  expect(response.ok).toBe(true);
}

async function seedInstallation(
  prefix: number,
  grantCount: number,
): Promise<{
  stub: ReturnType<typeof env.BOT_INSTALLATIONS.getByName>;
  workspaceId: string;
  installationId: string;
  botId: string;
  grantConversationIds: string[];
}> {
  const workspaceId = opaqueId(prefix, 1);
  const installationId = opaqueId(prefix, 2);
  const botId = opaqueId(prefix, 3);
  const stub = env.BOT_INSTALLATIONS.getByName(installationId);
  const now = new Date().toISOString();
  const grantConversationIds = Array.from({ length: grantCount }, (_, index) =>
    opaqueId(prefix + 1, index + 1),
  );
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)",
      JSON.stringify({
        id: installationId,
        workspaceId,
        botId,
        status: "active",
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
        runtimeRelease,
        grantCount,
        openAdmissionCount: 0,
        authorityGeneration: 1,
        revision: 1,
        cursor: 1,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      }),
    );
    for (const conversationId of grantConversationIds) {
      state.storage.sql.exec(
        `INSERT INTO grants
          (capability, resource_kind, resource_id, enabled, updated_cursor,
           enabled_at, tombstoned_at)
         VALUES ('messages.react', 'conversation', ?, 1, 1, ?, NULL)`,
        conversationId,
        now,
      );
    }
  });
  return {
    stub,
    workspaceId,
    installationId,
    botId,
    grantConversationIds,
  };
}

function grantCommand(
  coordinates: Awaited<ReturnType<typeof seedInstallation>>,
  commandId: string,
  conversationId: string,
  enabled: boolean,
): ConfigureBotInstallationCommand {
  return {
    contract: "bot-installation.configure@1",
    commandId,
    workspaceId: coordinates.workspaceId,
    installationId: coordinates.installationId,
    actor: { kind: "punk", punkId },
    payload: {
      operation: "set-grant",
      grant: {
        capability: "messages.react",
        resource: { kind: "conversation", conversationId },
        enabled,
      },
    },
  };
}

function admissionRequest(
  coordinates: Awaited<ReturnType<typeof seedInstallation>>,
  prefix: number,
) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const actionId = opaqueId(prefix, 1);
  return {
    actionId,
    request: {
      command: {
        contract: "bot-action.execute@1",
        credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
        invocationId: opaqueId(prefix, 2),
        actionId,
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        botId: coordinates.botId,
        authorityGeneration: 1,
        action: {
          contract: "message.reaction-toggle@1",
          conversationId:
            coordinates.grantConversationIds[0] ?? opaqueId(prefix, 10),
          messageId: opaqueId(prefix, 11),
          payload: { reaction: "📦" },
        },
      },
      credential: {
        jti: opaqueId(prefix, 3),
        issuedAt: nowSeconds,
        notBefore: nowSeconds,
        expiresAt: nowSeconds + 60,
      },
      admissionCommandId: opaqueId(prefix, 4),
    },
  } as const;
}

function seedOutboxRows(
  state: DurableObjectState,
  count: number,
  prefix: string,
  startCursor = 10_000,
  payloadJson = "{}",
): void {
  state.storage.transactionSync(() => {
    for (let index = 0; index < count; index += 1) {
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, NULL, 0)`,
        `${prefix}-${index}`,
        startCursor + index,
        payloadJson,
      );
    }
  });
}

function seedCommandLedger(
  state: DurableObjectState,
  resultRows: number,
  rejectedRows: number,
  prefix: string,
  responseJson = "{}",
): void {
  state.storage.transactionSync(() => {
    for (let index = 0; index < resultRows; index += 1) {
      state.storage.sql.exec(
        `INSERT INTO command_results
          (command_id, payload_hash, response_json, committed_at)
         VALUES (?, ?, ?, ?)`,
        `${prefix}-result-${index}`,
        "0".repeat(64),
        responseJson,
        "2026-08-21T00:00:00.000Z",
      );
    }
    for (let index = 0; index < rejectedRows; index += 1) {
      state.storage.sql.exec(
        `INSERT INTO rejected_commands
          (command_id, payload_hash, code, rejected_at)
         VALUES (?, ?, 'forbidden', ?)`,
        `${prefix}-rejected-${index}`,
        "1".repeat(64),
        "2026-08-21T00:00:00.000Z",
      );
    }
  });
}

describe("BotInstallationDO local storage bounds", () => {
  it("deletes a projection outbox row after Queue accepts it", async () => {
    const stub = installation("a1000000");
    const observed = await runInDurableObject(stub, async (instance, state) => {
      const payload = { contract: "installation-projection.fixture@1" };
      state.storage.sql.exec(
        `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, 1, ?, NULL, 0)`,
        "accepted-projection",
        JSON.stringify(payload),
      );
      const sent: unknown[] = [];
      let substituteCursor = true;
      const restore = replaceProjectionQueue(instance, async (message) => {
        sent.push(structuredClone(message));
        if (substituteCursor) {
          state.storage.sql.exec("UPDATE outbox SET cursor = 9");
          substituteCursor = false;
        }
      });
      try {
        await instance.alarm?.();
        await instance.alarm?.();
      } finally {
        restore();
      }
      state.storage.sql.exec(
        `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES ('retry-projection', 2, '{}', NULL, 63)`,
      );
      const restoreFailure = replaceProjectionQueue(instance, async () => {
        throw new Error("Queue unavailable");
      });
      try {
        await instance.alarm?.();
      } finally {
        restoreFailure();
      }
      return {
        sent,
        rows: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
        attempts: state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM outbox WHERE event_id = 'retry-projection'",
          )
          .one().attempts,
        alarm: await state.storage.getAlarm(),
      };
    });
    expect(observed).toEqual({
      sent: Array(2).fill({ contract: "installation-projection.fixture@1" }),
      rows: 1,
      attempts: 63,
      alarm: expect.toSatisfy(
        (alarm: number | null) => alarm !== null && alarm > Date.now(),
      ),
    });
  });

  it("garbage-collects legacy delivered projection rows after eviction", async () => {
    const stub = installation("a1000001");
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES ('legacy-delivered', 1, '{}', ?, 0)`,
        new Date().toISOString(),
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
    });
  });

  it("refuses a 129th active grant before any local effect", async () => {
    const coordinates = await seedInstallation(0xa2, 128);
    const command = grantCommand(
      coordinates,
      opaqueId(0xa2, 500),
      opaqueId(0xa3, 500),
      true,
    );
    const observed = await runInDurableObject(
      coordinates.stub,
      async (instance, state) => {
        const restore = replaceAuthorityBindings(instance, coordinates);
        try {
          const result = await instance.execute(command);
          return {
            result,
            grants: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
              .one().count,
            pending: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_command",
              )
              .one().count,
          };
        } finally {
          restore();
        }
      },
    );
    expect(observed).toEqual({
      result: { ok: false, code: "invalid_transition" },
      grants: 128,
      pending: 0,
    });
  });

  it("keeps an exact fail-closed reduction overlay while attestation is pending", async () => {
    const coordinates = await seedInstallation(0xa7, 1);
    const disable = grantCommand(
      coordinates,
      opaqueId(0xa7, 500),
      coordinates.grantConversationIds[0] ?? "missing",
      false,
    );
    await failAttestationOnce(disable.commandId);
    await runInDurableObject(coordinates.stub, async (instance, state) => {
      const restore = replaceAuthorityBindings(instance, coordinates);
      try {
        await expect(instance.execute(disable)).resolves.toEqual({
          ok: false,
          code: "attestation_failed",
        });
        expect(
          instance.query({
            contract: "bot-installation.get@1",
            workspaceId: coordinates.workspaceId,
            installationId: coordinates.installationId,
          }),
        ).toMatchObject({ ok: true, state: { grantCount: 0, cursor: 2 } });
        const attempted = admissionRequest(coordinates, 0xa9);
        await expect(
          instance.admitBotAction(attempted.request),
        ).resolves.toEqual({
          ok: false,
          code: "forbidden",
        });
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
            .one().count,
        ).toBe(1);
        state.storage.sql.exec(
          "UPDATE pending_command SET grant_json = '{}' WHERE singleton = 1",
        );
        expect(
          instance.query({
            contract: "bot-installation.get@1",
            workspaceId: coordinates.workspaceId,
            installationId: coordinates.installationId,
          }),
        ).toEqual({ ok: false, code: "not_found" });
      } finally {
        restore();
      }
    });
  });

  it("GCs expired JTIs before insertion and refuses the 4097th live JTI without admission state", async () => {
    const reusable = await seedInstallation(0xa8, 1);
    const reusableAdmission = admissionRequest(reusable, 0xaa);
    const reusableResult = await runInDurableObject(
      reusable.stub,
      async (instance, state) => {
        const nowSeconds = Math.floor(Date.now() / 1_000);
        state.storage.transactionSync(() => {
          for (let index = 0; index < 4_095; index += 1) {
            state.storage.sql.exec(
              `INSERT INTO used_jti
                (jti, action_id, action_digest, expires_at, consumed_at)
               VALUES (?, ?, ?, ?, ?)`,
              `live-${index}`,
              opaqueId(0xab, index + 1),
              index.toString(16).padStart(64, "0"),
              nowSeconds + 60,
              new Date().toISOString(),
            );
          }
          state.storage.sql.exec(
            `INSERT INTO used_jti
              (jti, action_id, action_digest, expires_at, consumed_at)
             VALUES ('expired-jti', ?, ?, ?, ?)`,
            opaqueId(0xab, 5_000),
            "f".repeat(64),
            nowSeconds - 1,
            new Date().toISOString(),
          );
        });
        const restore = replaceAuthorityBindings(instance, reusable);
        try {
          const result = await instance.admitBotAction(
            reusableAdmission.request,
          );
          return {
            result,
            live: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM used_jti")
              .one().count,
            expired: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM used_jti WHERE jti = 'expired-jti'",
              )
              .one().count,
          };
        } finally {
          restore();
        }
      },
    );
    expect(reusableResult).toMatchObject({
      result: { ok: true },
      live: 4_096,
      expired: 0,
    });

    const saturated = await seedInstallation(0xac, 1);
    const saturatedAdmission = admissionRequest(saturated, 0xae);
    const saturatedResult = await runInDurableObject(
      saturated.stub,
      async (instance, state) => {
        const nowSeconds = Math.floor(Date.now() / 1_000);
        state.storage.transactionSync(() => {
          for (let index = 0; index < 4_096; index += 1) {
            state.storage.sql.exec(
              `INSERT INTO used_jti
                (jti, action_id, action_digest, expires_at, consumed_at)
               VALUES (?, ?, ?, ?, ?)`,
              `saturated-${index}`,
              opaqueId(0xaf, index + 1),
              index.toString(16).padStart(64, "0"),
              nowSeconds + 60,
              new Date().toISOString(),
            );
          }
        });
        const restore = replaceAuthorityBindings(instance, saturated);
        try {
          const result = await instance.admitBotAction(
            saturatedAdmission.request,
          );
          return {
            result,
            receipts: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM action_receipts",
              )
              .one().count,
            pending: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_action_command",
              )
              .one().count,
          };
        } finally {
          restore();
        }
      },
    );
    expect(saturatedResult).toEqual({
      result: { ok: false, code: "temporarily_unavailable" },
      receipts: 0,
      pending: 0,
    });
  });

  it("indexes JTI expiry and preserves the one JTI owned by a pending admission", async () => {
    const coordinates = await seedInstallation(0xb0, 1);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    await runInDurableObject(coordinates.stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO used_jti
          (jti, action_id, action_digest, expires_at, consumed_at)
         VALUES ('pending-expired', ?, ?, ?, ?)`,
        opaqueId(0xb1, 1),
        "a".repeat(64),
        nowSeconds - 1,
        new Date().toISOString(),
      );
      state.storage.sql.exec(
        `INSERT INTO pending_action_command
          (singleton, operation, command_id, action_id, action_digest, jti,
           command_json, unsigned_json, next_state_json, admission_json,
           attempts, created_at)
         VALUES (1, 'admit', ?, ?, ?, 'pending-expired', '{}', '{}', '{}', '{}', 0, ?)`,
        opaqueId(0xb1, 2),
        opaqueId(0xb1, 1),
        "a".repeat(64),
        new Date().toISOString(),
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(coordinates.stub);
    await runInDurableObject(coordinates.stub, async (_instance, state) => {
      const indexes = state.storage.sql
        .exec<{ name: string }>("PRAGMA index_list(used_jti)")
        .toArray();
      expect(indexes.map(({ name }) => name)).toContain(
        "used_jti_expires_at_idx",
      );
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM used_jti WHERE jti = 'pending-expired'",
          )
          .one().count,
      ).toBe(1);
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
    });
  });

  it("blocks normal management at 1024 queued projections while disable and revoke consume their hard reserve", async () => {
    const normal = await seedInstallation(0xb2, 0);
    const normalCommand = grantCommand(
      normal,
      opaqueId(0xb2, 500),
      opaqueId(0xb3, 500),
      true,
    );
    const normalObserved = await runInDurableObject(
      normal.stub,
      async (instance, state) => {
        seedOutboxRows(state, 1_024, "normal-cap");
        const restoreAuthority = replaceAuthorityBindings(instance, normal);
        const restoreQueue = replaceProjectionQueue(instance, async () => {
          throw new Error("Queue unavailable");
        });
        try {
          return {
            result: await instance.execute(normalCommand),
            grants: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
              .one().count,
            pending: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_command",
              )
              .one().count,
          };
        } finally {
          restoreQueue();
          restoreAuthority();
        }
      },
    );
    expect(normalObserved).toEqual({
      result: { ok: false, code: "internal" },
      grants: 0,
      pending: 0,
    });

    const disabled = await seedInstallation(0xb4, 1);
    const disable = grantCommand(
      disabled,
      opaqueId(0xb4, 500),
      disabled.grantConversationIds[0] ?? "missing",
      false,
    );
    await runInDurableObject(disabled.stub, async (instance, state) => {
      seedOutboxRows(state, 2_178, "disable-reserve");
      const restoreAuthority = replaceAuthorityBindings(instance, disabled);
      const restoreQueue = replaceProjectionQueue(instance, async () => {
        throw new Error("Queue unavailable");
      });
      try {
        await expect(instance.execute(disable)).resolves.toMatchObject({
          ok: true,
        });
      } finally {
        restoreQueue();
        restoreAuthority();
      }
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
          .one().count,
      ).toBe(0);
    });

    const revoked = await seedInstallation(0xb6, 2);
    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: opaqueId(0xb6, 500),
      workspaceId: revoked.workspaceId,
      installationId: revoked.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Hard-reserve finalizer" },
    };
    await runInDurableObject(revoked.stub, async (instance, state) => {
      seedOutboxRows(state, 2_178, "revoke-reserve");
      const restoreAuthority = replaceAuthorityBindings(instance, revoked);
      const restoreQueue = replaceProjectionQueue(instance, async () => {
        throw new Error("Queue unavailable");
      });
      try {
        await expect(instance.execute(revoke)).resolves.toMatchObject({
          ok: true,
        });
      } finally {
        restoreQueue();
        restoreAuthority();
      }
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
          .one().count,
      ).toBe(0);
    });
  });

  it("measures normal projection capacity in UTF-8 bytes", async () => {
    const coordinates = await seedInstallation(0xb8, 0);
    const command = grantCommand(
      coordinates,
      opaqueId(0xb8, 500),
      opaqueId(0xb9, 500),
      true,
    );
    const maximumProjectionBytes = 131_072;
    const payload = JSON.stringify(
      "é".repeat((maximumProjectionBytes - 2) / 2),
    );
    const observed = await runInDurableObject(
      coordinates.stub,
      async (instance, state) => {
        seedOutboxRows(state, 256, "multibyte-cap", 20_000, payload);
        const bytes = state.storage.sql
          .exec<{ bytes: number }>(
            `SELECT SUM(length(CAST(payload_json AS BLOB))) AS bytes
             FROM outbox`,
          )
          .one().bytes;
        const restoreAuthority = replaceAuthorityBindings(
          instance,
          coordinates,
        );
        const restoreQueue = replaceProjectionQueue(instance, async () => {
          throw new Error("Queue unavailable");
        });
        try {
          return { bytes, result: await instance.execute(command) };
        } finally {
          restoreQueue();
          restoreAuthority();
        }
      },
    );
    expect(observed).toEqual({
      bytes: 32 * 1_024 * 1_024,
      result: { ok: false, code: "internal" },
    });
  });

  it("enforces the decimal 126000-byte Queue payload boundary", async () => {
    const coordinates = await seedInstallation(0xb9, 0);
    await runInDurableObject(coordinates.stub, (instance) => {
      const check = Reflect.get(instance, "hasProjectionOutboxCapacity") as (
        reduction: boolean,
        stateAfterWrite: null,
        writeBytes: number,
      ) => boolean;
      const exact = new TextEncoder().encode("é".repeat(63_000)).byteLength;
      expect(check.call(instance, false, null, exact)).toBe(true);
      expect(check.call(instance, false, null, exact + 1)).toBe(false);
    });
  });

  it("keeps the completion reserve after normal admission capacity is exhausted", async () => {
    const coordinates = await seedInstallation(0xba, 128);
    const first = admissionRequest(coordinates, 0xbc);
    const admitted = await runInDurableObject(
      coordinates.stub,
      async (instance, state) => {
        const restore = replaceAuthorityBindings(instance, coordinates);
        try {
          const result = await instance.admitBotAction(first.request);
          if (!result.ok) {
            throw new Error(`Admission fixture failed: ${result.code}`);
          }
          state.storage.sql.exec(
            "DELETE FROM action_deliveries WHERE action_id = ?",
            first.actionId,
          );
          return result;
        } finally {
          restore();
        }
      },
    );
    const second = admissionRequest(coordinates, 0xbd);
    const observed = await runInDurableObject(
      coordinates.stub,
      async (instance, state) => {
        state.storage.sql.exec("DELETE FROM outbox");
        seedOutboxRows(state, 2_047, "completion-reserve", 30_000);
        const restoreAuthority = replaceAuthorityBindings(
          instance,
          coordinates,
        );
        const restoreQueue = replaceProjectionQueue(instance, async () => {
          throw new Error("Queue unavailable");
        });
        try {
          const completion = await instance.completeBotAction({
            workspaceId: coordinates.workspaceId,
            installationId: coordinates.installationId,
            admissionId: admitted.admissionId,
            actionId: first.actionId,
            actionDigest: admitted.admission.actionDigest,
            outcome: "succeeded",
            completionCommandId: opaqueId(0xbc, 20),
          });
          const newAdmission = await instance.admitBotAction(second.request);
          return { completion, newAdmission };
        } finally {
          restoreQueue();
          restoreAuthority();
        }
      },
    );
    expect(observed).toEqual({
      completion: { ok: true, replayed: false },
      newAdmission: { ok: false, code: "temporarily_unavailable" },
    });
  });

  it("caps the combined management ledger while preserving disable and revoke reserves", async () => {
    const normal = await seedInstallation(0xbe, 0);
    const normalCommand = grantCommand(
      normal,
      opaqueId(0xbe, 500),
      opaqueId(0xbf, 500),
      true,
    );
    const normalObserved = await runInDurableObject(
      normal.stub,
      async (instance, state) => {
        seedCommandLedger(state, 512, 512, "normal-ledger");
        const restore = replaceAuthorityBindings(instance, normal);
        try {
          return {
            result: await instance.execute(normalCommand),
            grants: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
              .one().count,
            pending: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_command",
              )
              .one().count,
          };
        } finally {
          restore();
        }
      },
    );
    expect(normalObserved).toEqual({
      result: { ok: false, code: "temporarily_unavailable" },
      grants: 0,
      pending: 0,
    });

    const disabled = await seedInstallation(0xc0, 1);
    const disable = grantCommand(
      disabled,
      opaqueId(0xc0, 500),
      disabled.grantConversationIds[0] ?? "missing",
      false,
    );
    await runInDurableObject(disabled.stub, async (instance, state) => {
      seedCommandLedger(state, 577, 577, "disable-ledger");
      const restore = replaceAuthorityBindings(instance, disabled);
      try {
        await expect(instance.execute(disable)).resolves.toMatchObject({
          ok: true,
        });
      } finally {
        restore();
      }
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT
              (SELECT COUNT(*) FROM command_results) +
              (SELECT COUNT(*) FROM rejected_commands) AS count`,
          )
          .one().count,
      ).toBe(1_155);
    });

    const revoked = await seedInstallation(0xc2, 2);
    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: opaqueId(0xc2, 500),
      workspaceId: revoked.workspaceId,
      installationId: revoked.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Ledger reserve finalizer" },
    };
    await runInDurableObject(revoked.stub, async (instance, state) => {
      seedCommandLedger(state, 577, 577, "revoke-ledger");
      const restore = replaceAuthorityBindings(instance, revoked);
      try {
        await expect(instance.execute(revoke)).resolves.toMatchObject({
          ok: true,
        });
      } finally {
        restore();
      }
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT
              (SELECT COUNT(*) FROM command_results) +
              (SELECT COUNT(*) FROM rejected_commands) AS count`,
          )
          .one().count,
      ).toBe(1_155);
    });
  });

  it("fails internally and keeps an exact pending command when no rejection ledger slot remains", async () => {
    const coordinates = await seedInstallation(0xc4, 0);
    const command = grantCommand(
      coordinates,
      opaqueId(0xc4, 500),
      opaqueId(0xc5, 500),
      true,
    );
    await runInDurableObject(coordinates.stub, (instance, state) => {
      seedCommandLedger(state, 1_023, 0, "pending-ledger");
      return Promise.resolve().then(async () => {
        const restore = replaceAuthorityBindings(instance, coordinates);
        try {
          await failAttestationOnce(command.commandId);
          await expect(instance.execute(command)).resolves.toEqual({
            ok: false,
            code: "attestation_failed",
          });
        } finally {
          restore();
        }
      });
    });
    const observed = await runInDurableObject(
      coordinates.stub,
      async (instance, state) => {
        seedCommandLedger(state, 0, 130, "exhausted-rejection");
        const restore = replaceWorkspaceAuthorization(instance, async () => ({
          ok: false,
          code: "forbidden",
        }));
        try {
          return {
            result: await instance.execute(command),
            pending: state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM pending_command",
              )
              .one().count,
            grants: state.storage.sql
              .exec<{ count: number }>("SELECT COUNT(*) AS count FROM grants")
              .one().count,
          };
        } finally {
          restore();
        }
      },
    );
    expect(observed).toEqual({
      result: { ok: false, code: "internal" },
      pending: 1,
      grants: 0,
    });
  });
});
