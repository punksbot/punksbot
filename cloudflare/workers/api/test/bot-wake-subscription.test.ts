import type {
  BotInstallation,
  ConfigureBotInstallationCommand,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  InstallBotCommand,
  PublishBotCommand,
  RevokeBotInstallationCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import {
  canonicalJson,
  deriveBotInstallationId,
  deriveOpaqueUuid,
  PUNKS_REACTION_TURN_RELEASE_V1_DIGEST,
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

const punkId = "00000000-0000-8000-8000-000000000001";
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest: PUNKS_REACTION_TURN_RELEASE_V1_DIGEST,
} as const;
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

interface BotWakeSubscriptionRpc {
  executeBotWakeSubscription(input: unknown): Promise<unknown>;
  authorizeBotWake(input: unknown): Promise<unknown>;
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
  const runtimeEnv: unknown = Reflect.get(instance, "env");
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) {
    throw new Error("Durable Object runtime environment is unavailable");
  }
  return runtimeEnv;
}

async function advanceConversationCursor(
  conversationId: string,
  cursor: number,
): Promise<void> {
  await runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM conversation_state WHERE singleton = 1",
        )
        .one();
      const advanced = JSON.parse(stored.state_json) as Record<string, unknown>;
      advanced.cursor = cursor;
      advanced.revision = cursor;
      state.storage.sql.exec(
        "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(advanced),
      );
    },
  );
}

async function conversationFixture(): Promise<{
  workspaceId: string;
  conversationId: string;
  botId: string;
  installationId: string;
}> {
  const workspaceCommand: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId },
    payload: {
      slug: `bot-wake-${crypto.randomUUID().slice(0, 8)}`,
      name: "Bot Wake",
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
      name: "Private Wake target",
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
  const botId = await deriveOpaqueUuid(
    "punks.test.bot-wake-subscription.bot.v1",
    workspaceId,
  );
  return {
    workspaceId,
    conversationId,
    botId,
    installationId: await deriveBotInstallationId(workspaceId, botId),
  };
}

async function installedFixture(): Promise<
  Awaited<ReturnType<typeof conversationFixture>>
> {
  const coordinates = await conversationFixture();
  const publish: PublishBotCommand = {
    contract: "bot.publish@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId },
    payload: {
      slug: `wake-reactor-${crypto.randomUUID().slice(0, 8)}`,
      name: "Wake reactor",
      description: "Punks-owned Reaction turn",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-toggle@1"],
      runtimeRelease,
    },
  };
  const published = await SELF.fetch("https://punks.bot/api/internal/v1/bots", {
    method: "POST",
    headers: {
      ...operatorHeaders,
      "content-type": "application/json",
      "idempotency-key": publish.commandId,
    },
    body: JSON.stringify(publish),
  });
  expect(published.status, await published.clone().text()).toBe(201);
  const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
  const installationId = await deriveBotInstallationId(
    coordinates.workspaceId,
    botId,
  );
  const install: InstallBotCommand = {
    contract: "bot-installation.install@1",
    commandId: crypto.randomUUID(),
    workspaceId: coordinates.workspaceId,
    botId,
    actor: { kind: "punk", punkId },
    payload: {
      config: {
        contractId: "punks://contracts/bot.config.empty@1",
        value: {},
      },
    },
  };
  const installed = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${coordinates.workspaceId}/bot-installations`,
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
  expect(installed.status, await installed.clone().text()).toBe(201);
  await expect(installed.clone().json()).resolves.toMatchObject({
    installation: {
      id: installationId,
      runtimeRelease: publish.payload.runtimeRelease,
    },
  });
  return { ...coordinates, botId, installationId };
}

async function createConversationInWorkspace(
  workspaceId: string,
): Promise<string> {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "Second private Wake target",
      type: "stream",
      visibility: "private",
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
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
  return ((await response.json()) as { conversation: { id: string } })
    .conversation.id;
}

async function configureGrant(
  coordinates: Awaited<ReturnType<typeof installedFixture>>,
  capability: "messages.react" | "messages.read-context",
  enabled: boolean,
  commandId = crypto.randomUUID(),
): Promise<Response> {
  const command: ConfigureBotInstallationCommand = {
    contract: "bot-installation.configure@1",
    commandId,
    workspaceId: coordinates.workspaceId,
    installationId: coordinates.installationId,
    actor: { kind: "punk", punkId },
    payload: {
      operation: "set-grant",
      grant: {
        capability,
        resource: {
          kind: "conversation",
          conversationId: coordinates.conversationId,
        },
        enabled,
      },
    },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${coordinates.workspaceId}/bot-installations/${coordinates.installationId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

describe("Bot Wake subscriptions", () => {
  it("pins a known release onto legacy state and advances active subscriptions", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    expect(
      (await configureGrant(coordinates, "messages.read-context", true)).status,
    ).toBe(200);
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 3 });
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    await runInDurableObject(installation, (_instance, state) => {
      const stored = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM installation_state WHERE singleton = 1",
        )
        .one();
      const legacy = JSON.parse(stored.state_json) as Record<string, unknown>;
      Reflect.deleteProperty(legacy, "runtimeRelease");
      state.storage.sql.exec(
        "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(legacy),
      );
    });

    const command: ConfigureBotInstallationCommand = {
      contract: "bot-installation.configure@1",
      commandId: crypto.randomUUID(),
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: { operation: "pin-runtime-release" },
    };
    const request = () =>
      SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${coordinates.workspaceId}/bot-installations/${coordinates.installationId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: "__Host-punks_session=session-owner",
            "idempotency-key": command.commandId,
          },
          body: JSON.stringify(command),
        },
      );
    const pinned = await request();
    expect(pinned.status, await pinned.clone().text()).toBe(200);
    const terminal = (await pinned.json()) as Record<string, unknown>;
    expect(terminal).toMatchObject({
      installation: {
        runtimeRelease,
        authorityGeneration: 4,
        revision: 4,
      },
    });
    await advanceConversationCursor(coordinates.conversationId, 3);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 3,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 4,
        messageCursor: 3,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 4 });
    const replay = await request();
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      ...terminal,
      replayed: true,
    });
  });

  it("activates only the prepared epoch beyond its captured high-water", async () => {
    const coordinates = await conversationFixture();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    const preparationId = crypto.randomUUID();

    const prepared = await conversation.executeBotWakeSubscription({
      operation: "prepare",
      ...coordinates,
      epoch: 7,
      preparationId,
    });
    expect(prepared).toEqual({
      ok: true,
      status: "prepared",
      epoch: 7,
      highWaterCursor: 1,
      replayed: false,
    });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 7,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    const activated = await conversation.executeBotWakeSubscription({
      operation: "activate",
      ...coordinates,
      epoch: 7,
      preparationId,
      highWaterCursor: 1,
    });
    expect(activated).toEqual({
      ok: true,
      status: "active",
      epoch: 7,
      highWaterCursor: 1,
      replayed: false,
    });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 7,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 7,
        messageCursor: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 7,
        messageCursor: 2,
      }),
    ).resolves.toEqual({
      ok: true,
      epoch: 7,
      highWaterCursor: 1,
    });
  });

  it("recaptures high-water for a new command and rejects the orphaned preparation", async () => {
    const coordinates = await conversationFixture();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    const orphanedPreparationId = crypto.randomUUID();
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 7,
        preparationId: orphanedPreparationId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "prepared",
      highWaterCursor: 1,
    });
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        const stored = state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM conversation_state WHERE singleton = 1",
          )
          .one();
        const advanced = JSON.parse(stored.state_json) as Record<
          string,
          unknown
        >;
        advanced.cursor = 2;
        advanced.revision = 2;
        state.storage.sql.exec(
          "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(advanced),
        );
      },
    );

    const currentPreparationId = crypto.randomUUID();
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 7,
        preparationId: currentPreparationId,
      }),
    ).resolves.toEqual({
      ok: true,
      status: "prepared",
      epoch: 7,
      highWaterCursor: 2,
      replayed: false,
    });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "activate",
        ...coordinates,
        epoch: 7,
        preparationId: orphanedPreparationId,
        highWaterCursor: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "activate",
        ...coordinates,
        epoch: 7,
        preparationId: currentPreparationId,
        highWaterCursor: 2,
      }),
    ).resolves.toMatchObject({ ok: true, status: "active", epoch: 7 });
  });

  it("bounds active Conversation subscriptions before accepting a new preparation", async () => {
    const coordinates = await conversationFixture();
    const seeded = await Promise.all(
      Array.from({ length: 128 }, async (_, index) => ({
        installationId: await deriveOpaqueUuid(
          "punks.test.bot-wake-subscription.installation-cap.v1",
          String(index),
        ),
        botId: await deriveOpaqueUuid(
          "punks.test.bot-wake-subscription.bot-cap.v1",
          String(index),
        ),
      })),
    );
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        for (const [index, entry] of seeded.entries()) {
          state.storage.sql.exec(
            `INSERT INTO bot_wake_subscriptions
              (installation_id, workspace_id, conversation_id, bot_id, epoch,
               high_water_cursor, preparation_id, status, updated_at)
             VALUES (?, ?, ?, ?, 1, 1, ?, 'active', ?)`,
            entry.installationId,
            coordinates.workspaceId,
            coordinates.conversationId,
            entry.botId,
            crypto.randomUUID(),
            `2026-08-21T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
          );
        }
      },
    );
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 7,
        preparationId: crypto.randomUUID(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("makes deactivation win over late activation and requires a newer epoch", async () => {
    const coordinates = await conversationFixture();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    const preparationId = crypto.randomUUID();

    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 7,
        preparationId,
      }),
    ).resolves.toMatchObject({ ok: true, status: "prepared", epoch: 7 });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "activate",
        ...coordinates,
        epoch: 7,
        preparationId,
        highWaterCursor: 1,
      }),
    ).resolves.toMatchObject({ ok: true, status: "active", epoch: 7 });

    await expect(
      conversation.executeBotWakeSubscription({
        operation: "deactivate",
        ...coordinates,
        epoch: 8,
      }),
    ).resolves.toEqual({
      ok: true,
      status: "disabled",
      epoch: 8,
      highWaterCursor: 1,
      replayed: false,
    });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "activate",
        ...coordinates,
        epoch: 7,
        preparationId,
        highWaterCursor: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "activate",
        ...coordinates,
        epoch: 8,
        preparationId,
        highWaterCursor: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 7,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 8,
        preparationId,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 9,
        preparationId: crypto.randomUUID(),
      }),
    ).resolves.toEqual({
      ok: true,
      status: "prepared",
      epoch: 9,
      highWaterCursor: 1,
      replayed: false,
    });
  });

  it("activates grant-last and deactivates revoke-first from Installation authority", async () => {
    const coordinates = await installedFixture();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;

    const react = await configureGrant(coordinates, "messages.react", true);
    expect(react.status, await react.clone().text()).toBe(200);
    await expect(react.json()).resolves.toMatchObject({
      installation: { grantCount: 1, authorityGeneration: 2 },
    });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 2,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    const context = await configureGrant(
      coordinates,
      "messages.read-context",
      true,
    );
    expect(context.status, await context.clone().text()).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      installation: { grantCount: 2, authorityGeneration: 3 },
    });
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: true, epoch: 3, highWaterCursor: 1 });

    const disabled = await configureGrant(
      coordinates,
      "messages.read-context",
      false,
    );
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      installation: { grantCount: 1, authorityGeneration: 4 },
    });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("advances every still-authorized Conversation after any grant mutation", async () => {
    const first = await installedFixture();
    expect((await configureGrant(first, "messages.react", true)).status).toBe(
      200,
    );
    expect(
      (await configureGrant(first, "messages.read-context", true)).status,
    ).toBe(200);
    await advanceConversationCursor(first.conversationId, 2);

    const secondConversationId = await createConversationInWorkspace(
      first.workspaceId,
    );
    const second = { ...first, conversationId: secondConversationId };
    expect((await configureGrant(second, "messages.react", true)).status).toBe(
      200,
    );
    await advanceConversationCursor(first.conversationId, 3);
    await expect(
      (
        env.CONVERSATIONS.getByName(
          first.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...first,
        epoch: 4,
        messageCursor: 3,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 4 });

    expect(
      (await configureGrant(second, "messages.read-context", true)).status,
    ).toBe(200);
    await advanceConversationCursor(first.conversationId, 4);
    await advanceConversationCursor(second.conversationId, 2);
    await expect(
      (
        env.CONVERSATIONS.getByName(
          first.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...first,
        epoch: 5,
        messageCursor: 4,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 5 });
    await expect(
      (
        env.CONVERSATIONS.getByName(
          second.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...second,
        epoch: 5,
        messageCursor: 2,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 5 });

    expect(
      (await configureGrant(first, "messages.read-context", false)).status,
    ).toBe(200);
    await runDurableObjectAlarm(
      env.BOT_INSTALLATIONS.getByName(first.installationId),
    );
    await advanceConversationCursor(second.conversationId, 3);
    await expect(
      (
        env.CONVERSATIONS.getByName(
          first.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...first,
        epoch: 6,
        messageCursor: 4,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await expect(
      (
        env.CONVERSATIONS.getByName(
          second.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...second,
        epoch: 6,
        messageCursor: 3,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 6 });
  });

  it("deactivates every Wake subscription when the Installation is revoked", async () => {
    const coordinates = await installedFixture();
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    expect(
      (await configureGrant(coordinates, "messages.read-context", true)).status,
    ).toBe(200);
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 3 });

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: crypto.randomUUID(),
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Owner disabled autonomous execution" },
    };
    const response = await SELF.fetch(
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
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      installation: {
        status: "revoked",
        grantCount: 0,
        authorityGeneration: 4,
      },
    });
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("deactivates a subscription while its Conversation is archived", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    expect(
      (await configureGrant(coordinates, "messages.read-context", true)).status,
    ).toBe(200);
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        const stored = state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM conversation_state WHERE singleton = 1",
          )
          .one();
        const archived = JSON.parse(stored.state_json) as Record<
          string,
          unknown
        >;
        archived.status = "archived";
        state.storage.sql.exec(
          "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(archived),
        );
      },
    );

    const disabled = await configureGrant(
      coordinates,
      "messages.read-context",
      false,
    );
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    await runInDurableObject(
      env.CONVERSATIONS.getByName(coordinates.conversationId),
      (_instance, state) => {
        const stored = state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM conversation_state WHERE singleton = 1",
          )
          .one();
        const restored = JSON.parse(stored.state_json) as Record<
          string,
          unknown
        >;
        restored.status = "active";
        restored.cursor = 2;
        restored.revision = 2;
        state.storage.sql.exec(
          "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(restored),
        );
      },
    );
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("lets revoke preempt a blocked grant expansion without a late activation", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    let bindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(installation, (instance) => {
      bindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "CONVERSATIONS",
        {
          getByName(_name: string) {
            return {
              authorizeBotGrant(_input: unknown) {
                return {
                  ok: true,
                  conversationCursor: 1,
                };
              },
              executeBotWakeSubscription(_input: unknown) {
                throw new Error("injected prepare outage");
              },
            };
          },
        },
      );
    });
    const blockedCommandId = crypto.randomUUID();
    try {
      const blocked = await configureGrant(
        coordinates,
        "messages.read-context",
        true,
        blockedCommandId,
      );
      expect(blocked.status, await blocked.clone().text()).toBe(500);
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(installation, (instance) => {
          restoreBinding(durableObjectEnv(instance), "CONVERSATIONS", snapshot);
        });
      }
    }

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: crypto.randomUUID(),
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "Emergency revoke while preparation is blocked" },
    };
    let workspaceBindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(installation, (instance, state) => {
      let interleavingStep = 0;
      workspaceBindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "WORKSPACES",
        {
          getByName(_name: string) {
            return {
              authorize(_input: unknown) {
                if (interleavingStep === 0) {
                  const row = state.storage.sql
                    .exec<{ wake_subscription_json: string }>(
                      `SELECT wake_subscription_json FROM pending_command
                       WHERE singleton = 1`,
                    )
                    .one();
                  const transitions = JSON.parse(
                    row.wake_subscription_json,
                  ) as Array<Record<string, unknown>>;
                  state.storage.sql.exec(
                    `UPDATE pending_command SET wake_subscription_json = ?
                     WHERE singleton = 1`,
                    canonicalJson(
                      transitions.map((transition) => ({
                        ...transition,
                        operation: "activate",
                        highWaterCursor: 1,
                      })),
                    ),
                  );
                } else if (interleavingStep === 1) {
                  const row = state.storage.sql
                    .exec<{ command_id: string; payload_hash: string }>(
                      `SELECT command_id, payload_hash FROM pending_command
                       WHERE singleton = 1`,
                    )
                    .one();
                  state.storage.sql.exec(
                    `INSERT INTO rejected_commands
                      (command_id, payload_hash, code, rejected_at)
                     VALUES (?, ?, 'conflict', ?)`,
                    row.command_id,
                    row.payload_hash,
                    new Date().toISOString(),
                  );
                  state.storage.sql.exec(
                    "DELETE FROM pending_command WHERE singleton = 1",
                  );
                }
                interleavingStep += 1;
                return {
                  ok: true,
                  role: "owner",
                  visibility: "private",
                  workspaceCursor: 1,
                };
              },
            };
          },
        },
      );
    });
    let revoked: Response;
    try {
      revoked = await SELF.fetch(
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
    } finally {
      if (workspaceBindingSnapshot !== null) {
        const snapshot = workspaceBindingSnapshot;
        await runInDurableObject(installation, (instance) => {
          restoreBinding(durableObjectEnv(instance), "WORKSPACES", snapshot);
        });
      }
    }
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({
      installation: { status: "revoked", grantCount: 0 },
    });
    const rejectedReplay = await configureGrant(
      coordinates,
      "messages.read-context",
      true,
      blockedCommandId,
    );
    expect(rejectedReplay.status, await rejectedReplay.clone().text()).toBe(
      409,
    );
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      (
        env.CONVERSATIONS.getByName(
          coordinates.conversationId,
        ) as BotWakeSubscriptionRpc
      ).authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("returns the same terminal rejection when Conversation denies preparation", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    let bindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(installation, (instance) => {
      bindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "CONVERSATIONS",
        {
          getByName(_name: string) {
            return {
              authorizeBotGrant(_input: unknown) {
                return { ok: true, conversationCursor: 1 };
              },
              executeBotWakeSubscription(_input: unknown) {
                return { ok: false, code: "forbidden" };
              },
            };
          },
        },
      );
    });
    const commandId = crypto.randomUUID();
    try {
      const first = await configureGrant(
        coordinates,
        "messages.read-context",
        true,
        commandId,
      );
      expect(first.status, await first.clone().text()).toBe(403);
      const replay = await configureGrant(
        coordinates,
        "messages.read-context",
        true,
        commandId,
      );
      expect(replay.status, await replay.clone().text()).toBe(403);
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(installation, (instance) => {
          restoreBinding(durableObjectEnv(instance), "CONVERSATIONS", snapshot);
        });
      }
    }
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("repairs an activation outbox after delivery failure and eviction", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    const contextGrantCommandId = crypto.randomUUID();
    await expect(
      conversation.executeBotWakeSubscription({
        operation: "prepare",
        ...coordinates,
        epoch: 3,
        preparationId: contextGrantCommandId,
      }),
    ).resolves.toEqual({
      ok: true,
      status: "prepared",
      epoch: 3,
      highWaterCursor: 1,
      replayed: false,
    });
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    let bindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(installation, (instance) => {
      bindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "CONVERSATIONS",
        {
          getByName(_name: string) {
            return {
              authorizeBotGrant(_input: unknown) {
                return { ok: true, conversationCursor: 1 };
              },
              executeBotWakeSubscription(input: unknown) {
                if (
                  typeof input === "object" &&
                  input !== null &&
                  Reflect.get(input, "operation") === "activate"
                ) {
                  throw new Error("injected activation outage");
                }
                return {
                  ok: true,
                  status: "prepared",
                  epoch: 3,
                  highWaterCursor: 1,
                  replayed: true,
                };
              },
            };
          },
        },
      );
    });
    try {
      const configured = await configureGrant(
        coordinates,
        "messages.read-context",
        true,
        contextGrantCommandId,
      );
      expect(configured.status, await configured.clone().text()).toBe(200);
      await runInDurableObject(installation, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM wake_subscription_outbox",
            )
            .one().count,
        ).toBe(1);
      });
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(installation, async (instance, state) => {
          restoreBinding(durableObjectEnv(instance), "CONVERSATIONS", snapshot);
          state.storage.sql.exec(
            "UPDATE wake_subscription_outbox SET next_attempt_at = 0",
          );
          await state.storage.setAlarm(Date.now());
        });
      }
    }

    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await evictDurableObject(installation);
    await runDurableObjectAlarm(installation);
    await advanceConversationCursor(coordinates.conversationId, 2);
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toEqual({ ok: true, epoch: 3, highWaterCursor: 1 });
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM wake_subscription_outbox",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("restores a Wake activation when a cold command receipt dominates PITR state", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    const prior = await runInDurableObject(
      installation,
      (_instance, state) => ({
        stateJson: state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM installation_state WHERE singleton = 1",
          )
          .one().state_json,
        grant: state.storage.sql
          .exec<{
            capability: string;
            resource_kind: string;
            resource_id: string;
            enabled: number;
            updated_cursor: number;
            enabled_at: string | null;
            tombstoned_at: string | null;
          }>("SELECT * FROM grants")
          .one(),
      }),
    );
    const readContextGrant = {
      capability: "messages.read-context",
      resource: {
        kind: "conversation",
        conversationId: coordinates.conversationId,
      },
      enabled: true,
    } as const;
    const command: ConfigureBotInstallationCommand = {
      contract: "bot-installation.configure@1",
      commandId: crypto.randomUUID(),
      workspaceId: coordinates.workspaceId,
      installationId: coordinates.installationId,
      actor: { kind: "punk", punkId },
      payload: {
        operation: "set-grant",
        grant: readContextGrant,
      },
    };
    const request = () =>
      SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${coordinates.workspaceId}/bot-installations/${coordinates.installationId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: "__Host-punks_session=session-owner",
            "idempotency-key": command.commandId,
          },
          body: JSON.stringify(command),
        },
      );
    const committed = await request();
    expect(committed.status, await committed.clone().text()).toBe(200);
    const terminal = (await committed.json()) as {
      installation: BotInstallation;
      replayed: boolean;
    };
    const committedEvent = await runInDurableObject(
      installation,
      (_instance, state) =>
        JSON.parse(
          state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE cursor = 3",
            )
            .one().event_json,
        ) as SignedNostrEvent,
    );
    const unsigned = {
      created_at: committedEvent.created_at,
      kind: committedEvent.kind,
      tags: committedEvent.tags.slice(0, -1),
      content: committedEvent.content,
    };
    const payloadHash = await sha256Hex(canonicalJson(command));
    await runInDurableObject(installation, async (instance, state) => {
      state.storage.sql.exec(
        `UPDATE command_receipt_archive_outbox SET next_attempt_at = 0
         WHERE command_id = ?`,
        command.commandId,
      );
      await instance.alarm();
      state.storage.sql.exec(
        "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
        prior.stateJson,
      );
      state.storage.sql.exec("DELETE FROM grants");
      state.storage.sql.exec(
        `INSERT INTO grants
          (capability, resource_kind, resource_id, enabled, updated_cursor,
           enabled_at, tombstoned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        prior.grant.capability,
        prior.grant.resource_kind,
        prior.grant.resource_id,
        prior.grant.enabled,
        prior.grant.updated_cursor,
        prior.grant.enabled_at,
        prior.grant.tombstoned_at,
      );
      state.storage.sql.exec("DELETE FROM journal WHERE cursor >= 3");
      state.storage.sql.exec("DELETE FROM outbox WHERE cursor >= 3");
      state.storage.sql.exec(
        "DELETE FROM command_results WHERE command_id = ?",
        command.commandId,
      );
      state.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, grant_json, wake_subscription_json,
           reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(unsigned),
        JSON.stringify(terminal.installation),
        JSON.stringify(readContextGrant),
        canonicalJson([
          {
            operation: "activate",
            ...coordinates,
            epoch: 3,
            preparationId: command.commandId,
            highWaterCursor: 1,
          },
        ]),
        terminal.installation.updatedAt,
      );
    });
    const replay = await request();
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
    await runInDurableObject(installation, (instance) => instance.alarm());
    await advanceConversationCursor(coordinates.conversationId, 2);
    const conversation = env.CONVERSATIONS.getByName(
      coordinates.conversationId,
    ) as BotWakeSubscriptionRpc;
    await expect(
      conversation.authorizeBotWake({
        ...coordinates,
        epoch: 3,
        messageCursor: 2,
      }),
    ).resolves.toMatchObject({ ok: true, epoch: 3 });
    await runInDurableObject(installation, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("reserves bounded Wake outbox capacity while allowing a grant reduction", async () => {
    const coordinates = await installedFixture();
    expect(
      (await configureGrant(coordinates, "messages.react", true)).status,
    ).toBe(200);
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    const conversationIds = await Promise.all(
      Array.from({ length: 256 }, (_, index) =>
        deriveOpaqueUuid(
          "punks.test.bot-wake-subscription.outbox-cap.v1",
          String(index),
        ),
      ),
    );
    await runInDurableObject(installation, (_instance, state) => {
      for (const conversationId of conversationIds) {
        state.storage.sql.exec(
          `INSERT INTO wake_subscription_outbox
            (conversation_id, transition_json, attempts, next_attempt_at,
             created_at)
           VALUES (?, '{}', 0, ?, ?)`,
          conversationId,
          Date.now() + 24 * 60 * 60 * 1_000,
          "2026-08-21T00:00:00.000Z",
        );
      }
    });

    const expanded = await configureGrant(
      coordinates,
      "messages.read-context",
      true,
    );
    expect(expanded.status, await expanded.clone().text()).toBe(503);
    await expect(expanded.json()).resolves.toMatchObject({
      code: "temporarily_unavailable",
      retry: "same_command",
    });

    const reduced = await configureGrant(coordinates, "messages.react", false);
    expect(reduced.status, await reduced.clone().text()).toBe(200);
    await expect(reduced.json()).resolves.toMatchObject({
      installation: { grantCount: 0 },
    });
  });

  it("limits one Wake outbox alarm to twenty remote transitions", async () => {
    const coordinates = await conversationFixture();
    const installation = env.BOT_INSTALLATIONS.getByName(
      coordinates.installationId,
    );
    const conversationIds = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        deriveOpaqueUuid(
          "punks.test.bot-wake-subscription.alarm-batch.v1",
          String(index),
        ),
      ),
    );
    let calls = 0;
    let bindingSnapshot: BindingSnapshot | null = null;
    await runInDurableObject(installation, async (instance, state) => {
      const now = new Date().toISOString();
      for (const conversationId of conversationIds) {
        state.storage.sql.exec(
          `INSERT INTO wake_subscription_outbox
            (conversation_id, transition_json, attempts, next_attempt_at,
             created_at)
           VALUES (?, ?, 0, 0, ?)`,
          conversationId,
          canonicalJson({
            operation: "prepare",
            workspaceId: coordinates.workspaceId,
            conversationId,
            botId: coordinates.botId,
            installationId: coordinates.installationId,
            epoch: 2,
            preparationId: crypto.randomUUID(),
          }),
          now,
        );
      }
      bindingSnapshot = replaceBinding(
        durableObjectEnv(instance),
        "CONVERSATIONS",
        {
          getByName(_name: string) {
            return {
              executeBotWakeSubscription(_input: unknown) {
                calls += 1;
                return {
                  ok: true,
                  status: "prepared",
                  epoch: 2,
                  highWaterCursor: 1,
                  replayed: false,
                };
              },
            };
          },
        },
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    try {
      await runDurableObjectAlarm(installation);
      expect(calls).toBe(20);
      await runInDurableObject(installation, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM wake_subscription_outbox
               WHERE json_extract(transition_json, '$.operation') = 'activate'`,
            )
            .one().count,
        ).toBe(20);
      });
    } finally {
      if (bindingSnapshot !== null) {
        const snapshot = bindingSnapshot;
        await runInDurableObject(installation, (instance) => {
          restoreBinding(durableObjectEnv(instance), "CONVERSATIONS", snapshot);
        });
      }
    }
  });
});
