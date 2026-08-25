import type {
  BotActionAdmission,
  BotActionReceiptArchive,
  ConfigureBotInstallationCommand,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  DeliverBotActionCommand,
  InstallBotCommand,
  PostMessageCommand,
  RevokeBotInstallationCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  deriveBotInstallationId,
  deriveOpaqueUuid,
} from "@punks/core";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const punkId = "00000000-0000-8000-8000-000000000001";
const runtimeRelease = await botRuntimeReleaseReference();
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

async function fixture(journalled = false): Promise<{
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
      slug: `bot-action-${crypto.randomUUID().slice(0, 8)}`,
      name: "Bot action",
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
  expect(workspaceResponse.status).toBe(201);
  const workspaceId = (
    (await workspaceResponse.json()) as { workspace: { id: string } }
  ).workspace.id;

  const conversationCommand: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "Private Bot target",
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
      content: "Punks Bot target",
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
    "punks.test.bot-action.bot.v1",
    workspaceId,
  );
  const installationId = await deriveBotInstallationId(workspaceId, botId);
  const now = new Date().toISOString();
  await runInDurableObject(env.BOTS.getByName(botId), (_instance, state) => {
    state.storage.sql.exec(
      "INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)",
      JSON.stringify({
        id: botId,
        slug: "action-reactor",
        name: "Action reactor",
        description: "Punks-operated",
        status: "published",
        configContractId: "punks://contracts/bot.config.empty@1",
        supportedActionContracts: ["message.reaction-toggle@1"],
        runtimeRelease,
        revision: 1,
        cursor: 1,
        createdAt: now,
        updatedAt: now,
        suspendedAt: null,
        withdrawnAt: null,
      }),
    );
  });
  const installationStub = env.BOT_INSTALLATIONS.getByName(installationId);
  if (journalled) {
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
    const response = await SELF.fetch(
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
    expect(response.status, await response.clone().text()).toBe(201);
  }
  await runInDurableObject(installationStub, (_instance, state) => {
    if (!journalled) {
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
          grantCount: 1,
          openAdmissionCount: 0,
          authorityGeneration: 1,
          revision: 1,
          cursor: 1,
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        }),
      );
    } else {
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
    }
    state.storage.sql.exec(
      `INSERT INTO grants
        (capability, resource_kind, resource_id, enabled, updated_cursor,
         enabled_at, tombstoned_at)
       VALUES ('messages.react', 'conversation', ?, 1, 1, ?, NULL)`,
      conversationId,
      now,
    );
  });
  return { workspaceId, conversationId, messageId, botId, installationId };
}

function opaqueFixtureId(prefix: number, suffix: number): string {
  return `${prefix.toString(16).padStart(8, "0")}-0000-8000-8000-${suffix
    .toString()
    .padStart(12, "0")}`;
}

function requireAdmissionResult(value: unknown): {
  ok: true;
  admissionId: string;
  admission: BotActionAdmission;
  proof: SignedNostrEvent;
  replayed: boolean;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bot admission fixture returned a non-object");
  }
  const admissionId = Reflect.get(value, "admissionId");
  const admission = Reflect.get(value, "admission");
  const proof = Reflect.get(value, "proof");
  const replayed = Reflect.get(value, "replayed");
  if (
    Reflect.get(value, "ok") !== true ||
    typeof admissionId !== "string" ||
    typeof replayed !== "boolean" ||
    !validateContract("punks://contracts/bot-action.admission@1", admission)
      .valid ||
    !validateContract("punks://contracts/nostr.signed-event@1", proof).valid
  ) {
    throw new Error("Bot admission fixture returned a malformed result");
  }
  return {
    ok: true,
    admissionId,
    admission: admission as BotActionAdmission,
    proof: proof as SignedNostrEvent,
    replayed,
  };
}

async function terminalReceiptFixture(
  prefix: number,
  outcome: "succeeded" | "failed" = "succeeded",
) {
  const coordinates = await fixture();
  const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
  const actionId = opaqueFixtureId(prefix, 1);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const command = {
    contract: "bot-action.execute@1",
    credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
    invocationId: opaqueFixtureId(prefix, 2),
    actionId,
    workspaceId: coordinates.workspaceId,
    installationId: coordinates.installationId,
    botId: coordinates.botId,
    authorityGeneration: 1,
    action: {
      contract: "message.reaction-toggle@1",
      conversationId: coordinates.conversationId,
      messageId: coordinates.messageId,
      payload: { reaction: outcome === "succeeded" ? "✅" : "❌" },
    },
  } as const;
  const credential = {
    jti: opaqueFixtureId(prefix, 3),
    issuedAt: nowSeconds,
    notBefore: nowSeconds,
    expiresAt: nowSeconds + 60,
  };
  const admissionCommandId = await deriveOpaqueUuid(
    "punks.bot-action-admit-command.v1",
    `${coordinates.installationId}\u0000${actionId}`,
  );
  const admittedRaw = await stub.admitBotAction({
    command,
    credential,
    admissionCommandId,
  });
  expect(admittedRaw).toMatchObject({ ok: true, replayed: false });
  const admitted = requireAdmissionResult(admittedRaw);
  const preCompletionSnapshot = await runInDurableObject(
    stub,
    (_instance, state) => ({
      stateJson: state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM installation_state WHERE singleton = 1",
        )
        .one().state_json,
      receipt: state.storage.sql
        .exec<{
          action_id: string;
          admission_id: string;
          action_digest: string;
          admission_json: string;
          proof_json: string;
          status: string;
          outcome: string | null;
          updated_at: string;
        }>("SELECT * FROM action_receipts WHERE action_id = ?", actionId)
        .one(),
      delivery: state.storage.sql
        .exec<{
          action_id: string;
          admission_id: string;
          request_json: string;
          delivered_at: string | null;
          attempts: number;
          next_attempt_at: number;
          created_at: string;
        }>("SELECT * FROM action_deliveries WHERE action_id = ?", actionId)
        .one(),
    }),
  );
  const completionCommandId = await deriveOpaqueUuid(
    "punks.bot-action-completion-command.v1",
    `${admitted.admissionId}\u0000${outcome}`,
  );
  await expect(
    stub.completeBotAction({
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      admissionId: admitted.admissionId,
      actionId,
      actionDigest: admitted.admission.actionDigest,
      outcome,
      completionCommandId,
    }),
  ).resolves.toEqual({ ok: true, replayed: false });
  return {
    ...coordinates,
    stub,
    actionId,
    command,
    credential,
    admissionCommandId,
    completionCommandId,
    admitted,
    preCompletionSnapshot,
    outcome,
  };
}

async function makeReceiptArchiveDue(
  stub: ReturnType<typeof env.BOT_INSTALLATIONS.getByName>,
  actionId: string,
): Promise<void> {
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE receipt_archive_outbox SET next_attempt_at = ? WHERE action_id = ?",
      Date.now() - 1,
      actionId,
    );
    await state.storage.setAlarm(Date.now() - 1);
  });
}

describe("private Punks Bot Reaction vertical slice", () => {
  it("refuses admission while an exact grant disable awaits attestation", async () => {
    const coordinates = await fixture();
    const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
    const disable: ConfigureBotInstallationCommand = {
      contract: "bot-installation.configure@1",
      commandId: "6f000000-0000-8000-8000-000000000001",
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: {
        operation: "set-grant",
        grant: {
          capability: "messages.react",
          resource: {
            kind: "conversation",
            conversationId: coordinates.conversationId,
          },
          enabled: false,
        },
      },
    };
    await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/__test/fail-once", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: disable.commandId }),
      }),
    );
    await expect(stub.execute(disable)).resolves.toEqual({
      ok: false,
      code: "attestation_failed",
    });

    const nowSeconds = Math.floor(Date.now() / 1_000);
    await expect(
      stub.admitBotAction({
        command: {
          contract: "bot-action.execute@1",
          credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
          invocationId: "6f000000-0000-8000-8000-000000000002",
          actionId: "6f000000-0000-8000-8000-000000000003",
          workspaceId: coordinates.workspaceId,
          installationId: coordinates.installationId,
          botId: coordinates.botId,
          authorityGeneration: 2,
          action: {
            contract: "message.reaction-toggle@1",
            conversationId: coordinates.conversationId,
            messageId: coordinates.messageId,
            payload: { reaction: "🔥" },
          },
        },
        credential: {
          jti: "6f000000-0000-8000-8000-000000000004",
          issuedAt: nowSeconds,
          notBefore: nowSeconds,
          expiresAt: nowSeconds + 60,
        },
        admissionCommandId: "6f000000-0000-8000-8000-000000000005",
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("admits, commits and completes one stable toggle exactly once", async () => {
    const coordinates = await fixture();
    const actionId = "a0000000-0000-8000-8000-000000000002";
    const input = {
      contract: "bot-action.execute@1",
      credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
      invocationId: "a0000000-0000-8000-8000-000000000003",
      actionId,
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      botId: coordinates.botId,
      authorityGeneration: 1,
      action: {
        contract: "message.reaction-toggle@1",
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        payload: { reaction: "🔥" },
      },
    };
    const binding = (env as unknown as Record<string, unknown>)
      .BOT_ACTION_SERVICE as {
      executeBotAction(input: unknown): Promise<unknown>;
    };

    const first = await binding.executeBotAction(input);
    expect(first).toEqual({
      ok: true,
      admissionId: expect.any(String),
      replayed: false,
    });
    const admission = await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(coordinates.installationId),
      (_instance, state) =>
        JSON.parse(
          state.storage.sql
            .exec<{ admission_json: string }>(
              "SELECT admission_json FROM action_receipts WHERE action_id = ?",
              actionId,
            )
            .one().admission_json,
        ) as {
          id: string;
          actionId: string;
          actionDigest: string;
          installationCursor: number;
        },
    );
    const conversationStub = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversationStub, (_instance, state) => {
      const event = JSON.parse(
        state.storage.sql
          .exec<{ event_json: string }>(
            "SELECT event_json FROM journal WHERE event_kind IN (50210, 50211)",
          )
          .one().event_json,
      ) as { tags: string[][] };
      expect(
        event.tags.filter(([name]) =>
          [
            "workspace_cursor",
            "installation_cursor",
            "admission",
            "action",
          ].includes(name ?? ""),
        ),
      ).toEqual([
        ["installation_cursor", String(admission.installationCursor)],
        ["admission", admission.id],
        ["action", admission.actionId, admission.actionDigest],
      ]);
    });
    await runInDurableObject(conversationStub, async (_instance, state) => {
      await state.storage.setAlarm(Date.now() - 1);
    });
    expect(await runDurableObjectAlarm(conversationStub)).toBe(true);
    let completionSnapshot: unknown;
    let deliverySnapshot: unknown;
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        const result = state.storage.sql
          .exec<{
            bot_admission_id: string;
            bot_action_digest: string;
            bot_outcome: string;
          }>(
            `SELECT bot_admission_id, bot_action_digest, bot_outcome
             FROM message_reaction_command_results
             WHERE bot_admission_id IS NOT NULL`,
          )
          .one();
        deliverySnapshot = {
          result,
          pendingCompletions: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM bot_action_completions",
            )
            .one().count,
        };
      },
    );
    await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(coordinates.installationId),
      (_instance, state) => {
        completionSnapshot = state.storage.sql
          .exec<{ status: string; outcome: string | null }>(
            "SELECT status, outcome FROM action_receipts WHERE action_id = ?",
            actionId,
          )
          .one();
      },
    );
    expect({ completionSnapshot, deliverySnapshot }).toEqual({
      completionSnapshot: { status: "completed", outcome: "succeeded" },
      deliverySnapshot: {
        result: {
          bot_admission_id: expect.any(String),
          bot_action_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          bot_outcome: "succeeded",
        },
        pendingCompletions: 0,
      },
    });
    await expect(binding.executeBotAction(input)).resolves.toMatchObject({
      ok: true,
      replayed: true,
    });

    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM message_reactions
               WHERE actor_kind = 'bot' AND actor_id = ? AND status = 'active'`,
              coordinates.installationId,
            )
            .one().count,
        ).toBe(1);
      },
    );
    await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(coordinates.installationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ status: string; outcome: string }>(
              "SELECT status, outcome FROM action_receipts WHERE action_id = ?",
              actionId,
            )
            .one(),
        ).toEqual({ status: "completed", outcome: "succeeded" });
      },
    );
  });

  it("garbage-collects expired JTI while preserving a pending admission across eviction", async () => {
    const coordinates = await fixture();
    const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const expiredFree = "20000000-0000-8000-8000-000000000001";
    const expiredPending = "20000000-0000-8000-8000-000000000002";
    const future = "20000000-0000-8000-8000-000000000003";
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      for (const [jti, expiresAt] of [
        [expiredFree, nowSeconds - 1],
        [expiredPending, nowSeconds - 1],
        [future, nowSeconds + 50],
      ] as const) {
        state.storage.sql.exec(
          `INSERT INTO used_jti
            (jti, action_id, action_digest, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?)`,
          jti,
          `20000000-0000-8000-8000-${jti.slice(-12)}`,
          "a".repeat(64),
          expiresAt,
          new Date().toISOString(),
        );
      }
      state.storage.sql.exec(
        `INSERT INTO pending_action_command
          (singleton, operation, command_id, action_id, action_digest, jti,
           command_json, unsigned_json, next_state_json, admission_json,
           attempts, created_at)
         VALUES (1, 'admit', ?, ?, ?, ?, '{}', '{}', '{}', '{}', 0, ?)`,
        "20000000-0000-8000-8000-000000000004",
        "20000000-0000-8000-8000-000000000005",
        "a".repeat(64),
        expiredPending,
        new Date().toISOString(),
      );
    });

    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ jti: string }>("SELECT jti FROM used_jti ORDER BY jti")
          .toArray()
          .map(({ jti }) => jti),
      ).toEqual([expiredPending, future]);
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      state.storage.sql.exec(
        "DELETE FROM pending_action_command WHERE singleton = 1",
      );
      await state.storage.setAlarm(Date.now() - 1);
    });
    await evictDurableObject(stub);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ jti: string }>("SELECT jti FROM used_jti ORDER BY jti")
          .toArray()
          .map(({ jti }) => jti),
      ).toEqual([future]);
    });
  });

  it("delivers a committed admission autonomously after eviction and post-admission revoke", async () => {
    const coordinates = await fixture();
    const installationStub = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    const actionId = "40000000-0000-8000-8000-000000000001";
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const command = {
      contract: "bot-action.execute@1",
      credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
      invocationId: "40000000-0000-8000-8000-000000000002",
      actionId,
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      botId: coordinates.botId,
      authorityGeneration: 1,
      action: {
        contract: "message.reaction-toggle@1",
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        payload: { reaction: "⚡" },
      },
    } as const;
    const admitted = await installationStub.admitBotAction({
      command,
      credential: {
        jti: "40000000-0000-8000-8000-000000000003",
        issuedAt: nowSeconds,
        notBefore: nowSeconds,
        expiresAt: nowSeconds + 60,
      },
      admissionCommandId: await deriveOpaqueUuid(
        "punks.bot-action-admit-command.v1",
        `${coordinates.installationId}\u0000${actionId}`,
      ),
    });
    expect(admitted).toMatchObject({ ok: true, replayed: false });
    const admissionId = (admitted as unknown as { admissionId: string })
      .admissionId;
    await runInDurableObject(installationStub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      state.storage.sql.exec(
        "UPDATE action_deliveries SET next_attempt_at = ? WHERE action_id = ?",
        Date.now() + 60_000,
        actionId,
      );
    });
    const delivery = await runInDurableObject(
      installationStub,
      (_instance, state) =>
        JSON.parse(
          state.storage.sql
            .exec<{ request_json: string }>(
              "SELECT request_json FROM action_deliveries WHERE action_id = ?",
              actionId,
            )
            .one().request_json,
        ) as DeliverBotActionCommand,
    );
    const conversationStub = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    );
    await runInDurableObject(conversationStub, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 0; index < 1_024; index += 1) {
          state.storage.sql.exec(
            `INSERT INTO bot_action_completions
              (admission_id, request_json, outcome, delivered_at, attempts,
               next_attempt_at, created_at)
             VALUES (?, '{}', 'failed', NULL, 0, ?, ?)`,
            `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
            Date.now() + 60_000,
            new Date().toISOString(),
          );
        }
      });
    });
    await expect(
      conversationStub.executeBotReaction(delivery),
    ).resolves.toEqual({
      contract: "bot-action.delivery-result@1",
      ok: false,
      code: "temporarily_unavailable",
    });
    await runInDurableObject(conversationStub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reactions WHERE actor_kind = 'bot'",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_bot_reaction",
          )
          .one().count,
      ).toBe(0);
      state.storage.sql.exec("DELETE FROM bot_action_completions");
    });
    const mutatedUuid = "40000000-0000-8000-8000-000000000099";
    for (const mutated of [
      {
        ...delivery,
        action: {
          ...delivery.action,
          payload: { reaction: "😈" },
        },
      },
      { ...delivery, reactionCommandId: mutatedUuid },
      { ...delivery, completionCommandId: mutatedUuid },
      { ...delivery, failureCompletionCommandId: mutatedUuid },
    ]) {
      await expect(
        conversationStub.executeBotReaction(mutated),
      ).resolves.toEqual({
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "forbidden",
      });
      await runInDurableObject(conversationStub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM bot_action_completions",
            )
            .one().count,
          JSON.stringify(mutated),
        ).toBe(0);
      });
    }
    await runInDurableObject(conversationStub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM message_reactions WHERE actor_kind = 'bot'",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM bot_action_completions",
          )
          .one().count,
      ).toBe(0);
    });

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: "40000000-0000-8000-8000-000000000004",
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Revoke after the signed admission" },
    };
    const revoked = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${coordinates.workspaceId}/bot-installations/${coordinates.installationId}/revoke`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": revoke.commandId,
        },
        body: JSON.stringify(revoke),
      },
    );
    expect(revoked.status, await revoked.clone().text()).toBe(200);

    const poisonAdmissionId = "00000000-0000-8000-8000-000000000001";
    await runInDurableObject(conversationStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO bot_action_completions
          (admission_id, request_json, outcome, delivered_at, attempts,
           next_attempt_at, created_at)
         VALUES (?, '{}', 'succeeded', NULL, 0, ?, ?)`,
        poisonAdmissionId,
        Date.now(),
        new Date().toISOString(),
      );
    });

    await runInDurableObject(installationStub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE action_deliveries SET next_attempt_at = ? WHERE action_id = ?",
        Date.now(),
        actionId,
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(installationStub);
    await runInDurableObject(installationStub, (instance) =>
      instance.alarm?.(),
    );
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM message_reactions WHERE actor_kind = 'bot'",
            )
            .one().count,
        ).toBe(1);
      },
    );

    let completionDelivery: unknown;
    let poisonDelivery: unknown;
    const completionRequest = {
      workspaceId: delivery.workspaceId,
      installationId: delivery.installationId,
      admissionId: delivery.admissionId,
      actionId: delivery.actionId,
      actionDigest: delivery.actionDigest,
      outcome: "succeeded",
      completionCommandId: delivery.completionCommandId,
    } as const;
    await runInDurableObject(conversationStub, (instance) =>
      instance.alarm?.(),
    );
    await runInDurableObject(conversationStub, (_instance, state) => {
      completionDelivery = {
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM bot_action_completions WHERE admission_id = ?",
            admissionId,
          )
          .one().count,
        result: state.storage.sql
          .exec<{
            bot_admission_id: string;
            bot_action_digest: string;
            bot_outcome: string;
          }>(
            `SELECT bot_admission_id, bot_action_digest, bot_outcome
             FROM message_reaction_command_results
             WHERE bot_admission_id = ?`,
            admissionId,
          )
          .one(),
      };
      poisonDelivery = state.storage.sql
        .exec<{
          delivered_at: string | null;
          attempts: number;
          next_attempt_at: number;
        }>(
          `SELECT delivered_at, attempts, next_attempt_at
           FROM bot_action_completions WHERE admission_id = ?`,
          poisonAdmissionId,
        )
        .one();
    });
    const directCompletion =
      await installationStub.completeBotAction(completionRequest);
    await runInDurableObject(installationStub, (_instance, state) => {
      const receipt = state.storage.sql
        .exec<{ status: string; outcome: string | null }>(
          "SELECT status, outcome FROM action_receipts WHERE action_id = ?",
          actionId,
        )
        .one();
      expect({
        receipt,
        completionDelivery,
        directCompletion,
        poisonDelivery,
      }).toEqual({
        receipt: { status: "completed", outcome: "succeeded" },
        directCompletion: { ok: true, replayed: expect.any(Boolean) },
        completionDelivery: {
          pending: 0,
          result: {
            bot_admission_id: admissionId,
            bot_action_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
            bot_outcome: "succeeded",
          },
        },
        poisonDelivery: {
          delivered_at: null,
          attempts: 1,
          next_attempt_at: expect.any(Number),
        },
      });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_deliveries WHERE action_id = ?",
            actionId,
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("does not hot-loop an expired JTI protected by a retrying admission", async () => {
    const coordinates = await fixture();
    const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const actionId = "30000000-0000-8000-8000-000000000001";
    const jti = "30000000-0000-8000-8000-000000000002";
    const result = await stub.admitBotAction({
      command: {
        contract: "bot-action.execute@1",
        credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
        invocationId: "30000000-0000-8000-8000-000000000003",
        actionId,
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        botId: coordinates.botId,
        authorityGeneration: 1,
        action: {
          contract: "message.reaction-toggle@1",
          conversationId: coordinates.conversationId,
          messageId: coordinates.messageId,
          payload: { reaction: "🔥" },
        },
      },
      credential: {
        jti,
        issuedAt: nowSeconds,
        notBefore: nowSeconds,
        expiresAt: nowSeconds + 60,
      },
      admissionCommandId: "90000000-0000-8000-8000-000000000001",
    });
    expect(result).toEqual({ ok: false, code: "attestation_failed" });
    let attemptsBeforeAlarm = 0;
    await runInDurableObject(stub, async (_instance, state) => {
      attemptsBeforeAlarm = state.storage.sql
        .exec<{ attempts: number }>(
          "SELECT attempts FROM pending_action_command WHERE singleton = 1",
        )
        .one().attempts;
      state.storage.sql.exec(
        "UPDATE used_jti SET expires_at = ? WHERE jti = ?",
        nowSeconds - 1,
        jti,
      );
      await state.storage.deleteAlarm();
    });
    await runInDurableObject(stub, (instance) => instance.alarm?.());

    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ attempts: number; jti: string }>(
            "SELECT attempts, jti FROM pending_action_command WHERE singleton = 1",
          )
          .one(),
      ).toEqual({ attempts: attemptsBeforeAlarm + 1, jti });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM used_jti WHERE jti = ?",
            jti,
          )
          .one().count,
      ).toBe(1);
      await expect(state.storage.getAlarm()).resolves.toSatisfy(
        (alarm: number | null) => alarm !== null && alarm >= Date.now() + 3_000,
      );
    });
  });

  it("archives a terminal receipt before deleting it and replays the exact tombstone from R2", async () => {
    const coordinates = await fixture(true);
    const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
    const actionId = "81000000-0000-8000-8000-000000000001";
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const command = {
      contract: "bot-action.execute@1",
      credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
      invocationId: "81000000-0000-8000-8000-000000000002",
      actionId,
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      botId: coordinates.botId,
      authorityGeneration: 1,
      action: {
        contract: "message.reaction-toggle@1",
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        payload: { reaction: "✅" },
      },
    } as const;
    const credential = {
      jti: "81000000-0000-8000-8000-000000000003",
      issuedAt: nowSeconds,
      notBefore: nowSeconds,
      expiresAt: nowSeconds + 60,
    };
    const admissionCommandId = await deriveOpaqueUuid(
      "punks.bot-action-admit-command.v1",
      `${coordinates.installationId}\u0000${actionId}`,
    );
    const admittedRaw = await stub.admitBotAction({
      command,
      credential,
      admissionCommandId,
    });
    expect(admittedRaw).toMatchObject({ ok: true, replayed: false });
    const admitted = requireAdmissionResult(admittedRaw);
    const completionCommandId = await deriveOpaqueUuid(
      "punks.bot-action-completion-command.v1",
      `${admitted.admissionId}\u0000succeeded`,
    );
    await expect(
      stub.completeBotAction({
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        admissionId: admitted.admissionId,
        actionId,
        actionDigest: admitted.admission.actionDigest,
        outcome: "succeeded",
        completionCommandId,
      }),
    ).resolves.toEqual({ ok: true, replayed: false });

    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
            actionId,
          )
          .one().count,
      ).toBe(1);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM receipt_archive_outbox WHERE action_id = ?",
            actionId,
          )
          .one().count,
      ).toBe(1);
      state.storage.sql.exec(
        "UPDATE receipt_archive_outbox SET next_attempt_at = ? WHERE action_id = ?",
        Date.now() - 1,
        actionId,
      );
      await state.storage.setAlarm(Date.now() - 1);
    });
    const journalArchivesBefore = await env.JOURNAL_ARCHIVE_BUCKET.list({
      prefix: "journal/v1/bot-installation/",
    });
    await runDurableObjectAlarm(stub);
    const journalArchivesAfter = await env.JOURNAL_ARCHIVE_BUCKET.list({
      prefix: "journal/v1/bot-installation/",
    });
    expect(journalArchivesAfter.objects.length).toBeGreaterThan(
      journalArchivesBefore.objects.length,
    );

    await runInDurableObject(stub, (_instance, state) => {
      const pending = state.storage.sql
        .exec<{ attempts: number }>(
          "SELECT attempts FROM receipt_archive_outbox WHERE action_id = ?",
          actionId,
        )
        .toArray()[0];
      expect(pending).toEqual(undefined);
    });

    const objects = await env.JOURNAL_ARCHIVE_BUCKET.list({
      prefix: "bot-action-receipts/v1/",
      include: ["httpMetadata", "customMetadata"],
    });
    const matchingObjects = objects.objects.filter(
      ({ customMetadata }) =>
        customMetadata?.admissionId === admitted.admissionId,
    );
    expect(matchingObjects).toHaveLength(1);
    const stored = await env.JOURNAL_ARCHIVE_BUCKET.get(
      matchingObjects[0]?.key ?? "missing",
    );
    expect(stored).not.toBeNull();
    if (stored === null) {
      throw new Error("terminal receipt archive was not written");
    }
    const body = await stored.text();
    const archive = JSON.parse(body) as BotActionReceiptArchive;
    expect(body).toBe(canonicalJson(archive));
    expect(stored.httpMetadata?.contentType).toBe("application/json");
    expect(stored.customMetadata).toEqual({
      aggregate: "bot-action-receipt",
      schemaVersion: "1",
      installationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      actionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      admissionId: admitted.admissionId,
      actionDigest: admitted.admission.actionDigest,
      outcome: "succeeded",
    });
    expect(archive).toMatchObject({
      schemaVersion: 1,
      terminalAdmission: {
        ...admitted.admission,
        status: "completed",
        outcome: "succeeded",
        completedCursor: expect.any(Number),
        completedAt: expect.any(String),
      },
      admissionProof50320: admitted.proof,
      completionProof50321: { kind: 50321 },
    });
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
            actionId,
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM receipt_archive_outbox WHERE action_id = ?",
            actionId,
          )
          .one().count,
      ).toBe(0);
    });

    const replayed = await stub.admitBotAction({
      command,
      credential,
      admissionCommandId,
    });
    expect(replayed).toEqual({
      ok: true,
      admissionId: admitted.admissionId,
      admission: archive.terminalAdmission,
      proof: admitted.proof,
      replayed: true,
    });
    await expect(
      stub.validateBotActionAdmission({
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        botId: coordinates.botId,
        actionId,
        admissionId: admitted.admissionId,
        actionDigest: admitted.admission.actionDigest,
        authorityGeneration: admitted.admission.authorityGeneration,
        proof: admitted.proof,
      }),
    ).resolves.toEqual({ ok: true, admission: archive.terminalAdmission });
    await expect(
      stub.completeBotAction({
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        admissionId: admitted.admissionId,
        actionId,
        actionDigest: admitted.admission.actionDigest,
        outcome: "succeeded",
        completionCommandId,
      }),
    ).resolves.toEqual({ ok: true, replayed: true });
    await expect(
      stub.admitBotAction({
        command: {
          ...command,
          action: {
            ...command.action,
            payload: { reaction: "different-digest" },
          },
        },
        credential: {
          ...credential,
          jti: opaqueFixtureId(0x81, 99),
        },
        admissionCommandId,
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
  });

  it("repairs an archive outbox after eviction before the R2 put", async () => {
    const receipt = await terminalReceiptFixture(0x82);
    await runInDurableObject(receipt.stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE receipt_archive_outbox SET next_attempt_at = ? WHERE action_id = ?",
        Date.now() - 1,
        receipt.actionId,
      );
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(receipt.stub);
    await runInDurableObject(receipt.stub, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      await state.storage.setAlarm(Date.now() - 1);
    });
    await runDurableObjectAlarm(receipt.stub);
    await runInDurableObject(receipt.stub, (instance) => instance.alarm?.());
    await runInDurableObject(receipt.stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM receipt_archive_outbox WHERE action_id = ?",
            receipt.actionId,
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
            receipt.actionId,
          )
          .one().count,
      ).toBe(0);
    });
    const cold = await receipt.stub.admitBotAction({
      command: receipt.command,
      credential: receipt.credential,
      admissionCommandId: receipt.admissionCommandId,
    });
    expect(cold).toMatchObject({
      ok: true,
      replayed: true,
      admission: { status: "completed", outcome: "succeeded" },
      proof: receipt.admitted.proof,
    });
  });

  it("accepts an exact object written before the local archive commit", async () => {
    const receipt = await terminalReceiptFixture(0x83);
    const pending = await runInDurableObject(receipt.stub, (_instance, state) =>
      state.storage.sql
        .exec<{ object_key: string; archive_json: string }>(
          `SELECT object_key, archive_json FROM receipt_archive_outbox
             WHERE action_id = ?`,
          receipt.actionId,
        )
        .one(),
    );
    const archive = JSON.parse(pending.archive_json) as BotActionReceiptArchive;
    const parts = pending.object_key.split("/");
    const metadata = {
      aggregate: "bot-action-receipt",
      schemaVersion: "1",
      installationHash: parts[2] ?? "",
      actionHash: (parts[3] ?? "").replace(/\.json$/, ""),
      admissionId: archive.terminalAdmission.id,
      actionDigest: archive.terminalAdmission.actionDigest,
      outcome: archive.terminalAdmission.outcome,
    };
    await expect(
      env.JOURNAL_ARCHIVE_BUCKET.put(pending.object_key, pending.archive_json, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: metadata,
      }),
    ).resolves.not.toBeNull();
    await makeReceiptArchiveDue(receipt.stub, receipt.actionId);
    await runDurableObjectAlarm(receipt.stub);
    await runInDurableObject(receipt.stub, (instance) => instance.alarm?.());
    await runInDurableObject(receipt.stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT (
              EXISTS(SELECT 1 FROM action_receipts WHERE action_id = ?) OR
              EXISTS(SELECT 1 FROM receipt_archive_outbox WHERE action_id = ?)
            ) AS count`,
            receipt.actionId,
            receipt.actionId,
          )
          .one().count,
      ).toBe(0);
    });
    await expect(
      env.JOURNAL_ARCHIVE_BUCKET.get(pending.object_key).then((object) =>
        object?.text(),
      ),
    ).resolves.toBe(pending.archive_json);
  });

  it("lets a cold failed tombstone dominate restored admitted deliveries", async () => {
    for (const [prefix, delivered] of [
      [0x84, false],
      [0x85, true],
    ] as const) {
      const receipt = await terminalReceiptFixture(prefix, "failed");
      await makeReceiptArchiveDue(receipt.stub, receipt.actionId);
      await runDurableObjectAlarm(receipt.stub);
      const reactionsBeforeRestore = await runInDurableObject(
        env.CONVERSATIONS.getByName(receipt.conversationId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM message_reactions WHERE actor_kind = 'bot'",
            )
            .one().count,
      );
      await runInDurableObject(receipt.stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
              receipt.actionId,
            )
            .one().count,
        ).toBe(0);
        const snapshot = receipt.preCompletionSnapshot;
        state.storage.sql.exec(
          "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
          snapshot.stateJson,
        );
        state.storage.sql.exec(
          `INSERT INTO action_receipts
            (action_id, admission_id, action_digest, admission_json, proof_json,
             status, outcome, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          snapshot.receipt.action_id,
          snapshot.receipt.admission_id,
          snapshot.receipt.action_digest,
          snapshot.receipt.admission_json,
          snapshot.receipt.proof_json,
          snapshot.receipt.status,
          snapshot.receipt.outcome,
          snapshot.receipt.updated_at,
        );
        state.storage.sql.exec(
          `INSERT INTO action_deliveries
            (action_id, admission_id, request_json, delivered_at, attempts,
             next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          snapshot.delivery.action_id,
          snapshot.delivery.admission_id,
          snapshot.delivery.request_json,
          delivered ? new Date().toISOString() : null,
          snapshot.delivery.attempts,
          Date.now() - 1,
          snapshot.delivery.created_at,
        );
        if (delivered) {
          state.storage.sql.exec(
            `INSERT INTO pending_action_command
              (singleton, operation, command_id, action_id, action_digest, jti,
               command_json, unsigned_json, next_state_json, admission_json,
               attempts, created_at)
             VALUES (1, 'complete', ?, ?, ?, NULL, '{}', '{}', '{}', '{}', 0, ?)`,
            receipt.completionCommandId,
            receipt.actionId,
            receipt.admitted.admission.actionDigest,
            new Date().toISOString(),
          );
        }
      });
      await runInDurableObject(receipt.stub, async (_instance, state) => {
        await state.storage.deleteAlarm();
      });
      await evictDurableObject(receipt.stub);
      await runInDurableObject(receipt.stub, async (_instance, state) => {
        await expect(state.storage.getAlarm()).resolves.not.toBeNull();
        await state.storage.setAlarm(Date.now() - 1);
      });
      await runDurableObjectAlarm(receipt.stub);
      await runInDurableObject(receipt.stub, (instance) => instance.alarm?.());
      await runInDurableObject(receipt.stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT (
                EXISTS(SELECT 1 FROM action_receipts WHERE action_id = ?) OR
                EXISTS(SELECT 1 FROM action_deliveries WHERE action_id = ?) OR
                EXISTS(SELECT 1 FROM pending_action_command WHERE action_id = ?)
              ) AS count`,
              receipt.actionId,
              receipt.actionId,
              receipt.actionId,
            )
            .one().count,
          delivered ? "delivered snapshot" : "undelivered snapshot",
        ).toBe(0);
        const installation = JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM installation_state WHERE singleton = 1",
            )
            .one().state_json,
        ) as { openAdmissionCount: number };
        expect(installation.openAdmissionCount).toBe(0);
      });
      await runInDurableObject(
        env.CONVERSATIONS.getByName(receipt.conversationId),
        (_instance, state) => {
          expect(
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM message_reactions WHERE actor_kind = 'bot'",
              )
              .one().count,
          ).toBe(reactionsBeforeRestore);
        },
      );
    }
  });

  // This matrix creates up to twelve Durable Object fixtures and R2 objects.
  // Keep its cold-run allowance local instead of weakening the global timeout.
  it("keeps hot receipts fail-closed for corrupt or non-canonical existing R2 objects", async () => {
    for (const [prefix, corruption] of [
      [0x86, "invalid-json"],
      [0x87, "non-canonical"],
      [0x88, "wrong-scope"],
      [0x89, "wrong-metadata"],
      [0x8a, "oversized-utf8"],
      [0x8b, "wrong-content-type"],
      [0x91, "substituted"],
      [0x92, "wrong-admission-proof"],
      [0x93, "wrong-completion-proof"],
    ] as const) {
      const receipt = await terminalReceiptFixture(prefix);
      const pending = await runInDurableObject(
        receipt.stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ object_key: string; archive_json: string }>(
              `SELECT object_key, archive_json FROM receipt_archive_outbox
               WHERE action_id = ?`,
              receipt.actionId,
            )
            .one(),
      );
      const archive = JSON.parse(
        pending.archive_json,
      ) as BotActionReceiptArchive;
      const donorArchive =
        corruption === "substituted" ||
        corruption === "wrong-admission-proof" ||
        corruption === "wrong-completion-proof"
          ? await terminalReceiptFixture(prefix + 0x10).then((donor) =>
              runInDurableObject(
                donor.stub,
                (_instance, state) =>
                  JSON.parse(
                    state.storage.sql
                      .exec<{ archive_json: string }>(
                        `SELECT archive_json FROM receipt_archive_outbox
                       WHERE action_id = ?`,
                        donor.actionId,
                      )
                      .one().archive_json,
                  ) as BotActionReceiptArchive,
              ),
            )
          : null;
      const parts = pending.object_key.split("/");
      const exactMetadata = {
        aggregate: "bot-action-receipt",
        schemaVersion: "1",
        installationHash: parts[2] ?? "",
        actionHash: (parts[3] ?? "").replace(/\.json$/, ""),
        admissionId: archive.terminalAdmission.id,
        actionDigest: archive.terminalAdmission.actionDigest,
        outcome: archive.terminalAdmission.outcome,
      };
      const body = (() => {
        if (corruption === "invalid-json") {
          return "{";
        }
        if (corruption === "non-canonical") {
          return JSON.stringify(archive, null, 2);
        }
        if (corruption === "wrong-scope") {
          return canonicalJson({
            ...archive,
            terminalAdmission: {
              ...archive.terminalAdmission,
              installationId: opaqueFixtureId(0x99, 99),
            },
          });
        }
        if (corruption === "oversized-utf8") {
          return canonicalJson({
            ...archive,
            completionProof50321: {
              ...archive.completionProof50321,
              content: "🔥".repeat(8_192),
            },
          });
        }
        if (corruption === "substituted" && donorArchive !== null) {
          return canonicalJson(donorArchive);
        }
        if (corruption === "wrong-admission-proof" && donorArchive !== null) {
          return canonicalJson({
            ...archive,
            admissionProof50320: donorArchive.admissionProof50320,
          });
        }
        if (corruption === "wrong-completion-proof" && donorArchive !== null) {
          return canonicalJson({
            ...archive,
            completionProof50321: donorArchive.completionProof50321,
          });
        }
        return pending.archive_json;
      })();
      const bodyArchive = (() => {
        try {
          return JSON.parse(body) as BotActionReceiptArchive;
        } catch {
          return archive;
        }
      })();
      const bodyMetadata = {
        ...exactMetadata,
        admissionId: bodyArchive.terminalAdmission.id,
        actionDigest: bodyArchive.terminalAdmission.actionDigest,
        outcome: bodyArchive.terminalAdmission.outcome,
      };
      await env.JOURNAL_ARCHIVE_BUCKET.put(pending.object_key, body, {
        httpMetadata: {
          contentType:
            corruption === "wrong-content-type"
              ? "application/octet-stream"
              : "application/json",
        },
        customMetadata:
          corruption === "wrong-metadata"
            ? { ...exactMetadata, outcome: "failed" }
            : bodyMetadata,
      });
      await makeReceiptArchiveDue(receipt.stub, receipt.actionId);
      await runInDurableObject(receipt.stub, (instance) => instance.alarm?.());
      const failed = await runInDurableObject(
        receipt.stub,
        (_instance, state) => ({
          receiptCount: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
              receipt.actionId,
            )
            .one().count,
          outbox: state.storage.sql
            .exec<{ attempts: number; next_attempt_at: number }>(
              `SELECT attempts, next_attempt_at FROM receipt_archive_outbox
               WHERE action_id = ?`,
              receipt.actionId,
            )
            .one(),
        }),
      );
      expect(failed.receiptCount, corruption).toBe(1);
      expect(failed.outbox.attempts, corruption).toBeGreaterThanOrEqual(1);
      expect(failed.outbox.next_attempt_at, corruption).toBeGreaterThan(
        Date.now(),
      );
      await expect(
        receipt.stub.admitBotAction({
          command: receipt.command,
          credential: receipt.credential,
          admissionCommandId: receipt.admissionCommandId,
        }),
      ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });

      await runInDurableObject(receipt.stub, async (instance, state) => {
        await state.storage.setAlarm(Date.now() - 1);
        await instance.alarm?.();
      });
      await runInDurableObject(receipt.stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT attempts FROM receipt_archive_outbox WHERE action_id = ?",
              receipt.actionId,
            )
            .one().attempts,
          corruption,
        ).toBe(failed.outbox.attempts);
      });
    }
  }, 30_000);

  it("fails closed when the receipt archive binding is unavailable", async () => {
    const receipt = await terminalReceiptFixture(0x8c);
    let bucketSnapshot: BindingSnapshot | undefined;
    try {
      await runInDurableObject(receipt.stub, (instance) => {
        const bindings = Reflect.get(instance, "env");
        if (typeof bindings !== "object" || bindings === null) {
          throw new Error("Durable Object bindings are unavailable in Workerd");
        }
        bucketSnapshot = replaceBinding(bindings, "JOURNAL_ARCHIVE_BUCKET", {
          get: async () => {
            throw new Error("simulated R2 outage");
          },
          put: async () => {
            throw new Error("simulated R2 outage");
          },
        });
      });

      await expect(
        receipt.stub.admitBotAction({
          command: receipt.command,
          credential: receipt.credential,
          admissionCommandId: receipt.admissionCommandId,
        }),
      ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });
      await expect(
        receipt.stub.validateBotActionAdmission({
          workspaceId: receipt.workspaceId,
          installationId: receipt.installationId,
          botId: receipt.botId,
          actionId: receipt.actionId,
          admissionId: receipt.admitted.admissionId,
          actionDigest: receipt.admitted.admission.actionDigest,
          authorityGeneration: receipt.admitted.admission.authorityGeneration,
          proof: receipt.admitted.proof,
        }),
      ).resolves.toEqual({ ok: false, code: "forbidden" });
      await expect(
        receipt.stub.completeBotAction({
          workspaceId: receipt.workspaceId,
          installationId: receipt.installationId,
          admissionId: receipt.admitted.admissionId,
          actionId: receipt.actionId,
          actionDigest: receipt.admitted.admission.actionDigest,
          outcome: receipt.outcome,
          completionCommandId: receipt.completionCommandId,
        }),
      ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });

      await makeReceiptArchiveDue(receipt.stub, receipt.actionId);
      await runInDurableObject(receipt.stub, (instance) => instance.alarm?.());
      await runInDurableObject(receipt.stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM action_receipts WHERE action_id = ?",
              receipt.actionId,
            )
            .one().count,
        ).toBe(1);
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT attempts FROM receipt_archive_outbox WHERE action_id = ?",
              receipt.actionId,
            )
            .one().attempts,
        ).toBe(1);
      });
    } finally {
      const snapshot = bucketSnapshot;
      if (snapshot !== undefined) {
        await runInDurableObject(receipt.stub, (instance) => {
          const bindings = Reflect.get(instance, "env");
          if (typeof bindings !== "object" || bindings === null) {
            throw new Error(
              "Durable Object bindings are unavailable in Workerd",
            );
          }
          restoreBinding(bindings, "JOURNAL_ARCHIVE_BUCKET", snapshot);
        });
      }
    }
  });

  it("counts every hot receipt at capacity while allowing revoke and completion", async () => {
    const coordinates = await fixture();
    const stub = env.BOT_INSTALLATIONS.getByName(coordinates.installationId);
    const actionId = opaqueFixtureId(0x8d, 1);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const command = {
      contract: "bot-action.execute@1",
      credential: `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`,
      invocationId: opaqueFixtureId(0x8d, 2),
      actionId,
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      botId: coordinates.botId,
      authorityGeneration: 1,
      action: {
        contract: "message.reaction-toggle@1",
        conversationId: coordinates.conversationId,
        messageId: coordinates.messageId,
        payload: { reaction: "📦" },
      },
    } as const;
    const credential = {
      jti: opaqueFixtureId(0x8d, 3),
      issuedAt: nowSeconds,
      notBefore: nowSeconds,
      expiresAt: nowSeconds + 60,
    };
    const admissionCommandId = await deriveOpaqueUuid(
      "punks.bot-action-admit-command.v1",
      `${coordinates.installationId}\u0000${actionId}`,
    );
    const admittedRaw = await stub.admitBotAction({
      command,
      credential,
      admissionCommandId,
    });
    expect(admittedRaw).toMatchObject({ ok: true });
    const admitted = requireAdmissionResult(admittedRaw);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "DELETE FROM action_deliveries WHERE action_id = ?",
        actionId,
      );
      const now = new Date().toISOString();
      state.storage.transactionSync(() => {
        for (let index = 0; index < 1_023; index += 1) {
          state.storage.sql.exec(
            `INSERT INTO action_receipts
              (action_id, admission_id, action_digest, admission_json,
               proof_json, status, outcome, updated_at)
             VALUES (?, ?, ?, '{}', '{}', 'completed', 'succeeded', ?)`,
            opaqueFixtureId(0x8e, index + 1),
            opaqueFixtureId(0x8f, index + 1),
            index.toString(16).padStart(64, "0"),
            now,
          );
        }
      });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_receipts",
          )
          .one().count,
      ).toBe(1_024);
    });

    const blockedActionId = opaqueFixtureId(0x90, 1);
    await expect(
      stub.admitBotAction({
        command: {
          ...command,
          invocationId: opaqueFixtureId(0x90, 2),
          actionId: blockedActionId,
        },
        credential: {
          ...credential,
          jti: opaqueFixtureId(0x90, 3),
        },
        admissionCommandId: await deriveOpaqueUuid(
          "punks.bot-action-admit-command.v1",
          `${coordinates.installationId}\u0000${blockedActionId}`,
        ),
      }),
    ).resolves.toEqual({ ok: false, code: "admission_limit" });

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: opaqueFixtureId(0x91, 1),
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Capacity must not block authority reduction" },
    };
    await expect(stub.execute(revoke)).resolves.toMatchObject({ ok: true });

    const completionCommandId = await deriveOpaqueUuid(
      "punks.bot-action-completion-command.v1",
      `${admitted.admissionId}\u0000failed`,
    );
    await expect(
      stub.completeBotAction({
        workspaceId: coordinates.workspaceId,
        installationId: coordinates.installationId,
        admissionId: admitted.admissionId,
        actionId,
        actionDigest: admitted.admission.actionDigest,
        outcome: "failed",
        completionCommandId,
      }),
    ).resolves.toEqual({ ok: true, replayed: false });
    await makeReceiptArchiveDue(stub, actionId);
    await runInDurableObject(stub, (instance) => instance.alarm?.());
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM action_receipts",
          )
          .one().count,
      ).toBe(1_023);
    });
  });
});
