import type {
  Bot,
  ConfigureBotInstallationCommand,
  CreateWorkspaceCommand,
  InstallBotCommand,
  PublishBotCommand,
  RemoveWorkspaceMemberCommand,
  RevokeBotInstallationCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
  UpdateBotCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const authorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
const operatorPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

function publishCommand(commandId: string, slug: string): PublishBotCommand {
  return {
    contract: "bot.publish@1",
    commandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug,
      name: "Reactor",
      description: "A Punks-operated reaction Bot",
      configContractId: "punks://contracts/bot.config.empty@1",
      runtimeRelease,
      supportedActionContracts: ["message.reaction-toggle@1"],
    },
  };
}

async function publish(command: PublishBotCommand): Promise<Response> {
  return SELF.fetch("https://punks.bot/api/internal/v1/bots", {
    method: "POST",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function update(command: UpdateBotCommand): Promise<Response> {
  return SELF.fetch(`https://punks.bot/api/internal/v1/bots/${command.botId}`, {
    method: "PATCH",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function createWorkspace(
  command: CreateWorkspaceCommand,
): Promise<Response> {
  return SELF.fetch("https://punks.bot/api/internal/v1/workspaces", {
    method: "POST",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function seedManagedConversation(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)`,
        JSON.stringify({
          id: conversationId,
          workspaceId,
          name: "Grant authority",
          type: "stream",
          visibility: "private",
          description: null,
          topic: null,
          purpose: null,
          topicRequired: false,
          maxMembers: null,
          ttlSeconds: null,
          ttlDeadline: null,
          ownerPunkId: operatorPunkId,
          members: [
            {
              punkId: operatorPunkId,
              access: "owner",
              joinedAt: now,
              invitedByPunkId: null,
            },
          ],
          status: "active",
          revision: 1,
          cursor: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        }),
      );
    },
  );
}

describe("Punks Bot management API", () => {
  it("never rebinds a replayed slug claim to another stable Bot id", async () => {
    const slug = env.BOT_SLUGS.getByName("stable-identity");
    const commandId = "51000000-0000-4000-8000-000000000040";
    await expect(
      slug.claim({
        slug: "stable-identity",
        botId: "51000000-0000-4000-8000-000000000041",
        commandId,
      }),
    ).resolves.toEqual({
      ok: true,
      botId: "51000000-0000-4000-8000-000000000041",
      replayed: false,
    });
    await expect(
      slug.claim({
        slug: "stable-identity",
        botId: "51000000-0000-4000-8000-000000000042",
        commandId,
      }),
    ).resolves.toEqual({ ok: false, code: "slug_claimed" });

    await runInDurableObject(slug, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(slug);
    await runInDurableObject(slug, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.toSatisfy(
        (alarm: number | null) => alarm !== null && alarm > Date.now(),
      );
    });
  });

  it("publishes one global Punks-operated Bot and resolves its public slug", async () => {
    const command = publishCommand(
      "51000000-0000-4000-8000-000000000001",
      "reactor",
    );

    const created = await publish(command);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      bot: Bot;
      event: SignedNostrEvent;
      replayed: boolean;
    };
    expect(createdBody).toMatchObject({
      bot: {
        slug: "reactor",
        status: "published",
        runtimeRelease,
        cursor: 1,
      },
      event: { kind: 50300 },
      replayed: false,
    });
    expect(JSON.parse(createdBody.event.content)).toMatchObject({
      bot: { runtimeRelease },
      delta: { operation: "published" },
    });

    const read = await SELF.fetch("https://punks.bot/api/v1/bots/reactor");
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({
      bot: expect.objectContaining({
        id: createdBody.bot.id,
        slug: "reactor",
        status: "published",
      }),
      canonicalPath: "/bots/reactor",
    });
    const projection = {
      contract: "bot.projection@1",
      botId: createdBody.bot.id,
      cursor: createdBody.bot.cursor,
      event: createdBody.event,
      state: createdBody.bot,
    };
    expect(
      validateContract("punks://contracts/bot.projection@1", projection).valid,
    ).toBe(true);
    expect(Object.keys(projection).sort()).toEqual([
      "botId",
      "contract",
      "cursor",
      "event",
      "state",
    ]);
    await runInDurableObject(
      env.BOTS.getByName(createdBody.bot.id),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM outbox WHERE cursor = 1",
            )
            .one().count,
        ).toBe(0);
        expect(
          JSON.parse(
            state.storage.sql
              .exec<{ event_json: string }>(
                "SELECT event_json FROM journal WHERE cursor = 1",
              )
              .one().event_json,
          ),
        ).toEqual(createdBody.event);
      },
    );
  });

  it("keeps a Bot uncommitted when attestation adds an unauthorized tag", async () => {
    const command = publishCommand(
      "51000000-0000-4000-8000-000000000099",
      "malformed-attestation",
    );

    const rejected = await publish(command);
    expect(rejected.status).toBe(503);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "attestation_failed",
      retry: "same_command",
    });

    const read = await SELF.fetch(
      "https://punks.bot/api/v1/bots/malformed-attestation",
    );
    expect(read.status).toBe(503);
    await expect(read.json()).resolves.toMatchObject({
      code: "temporarily_unavailable",
    });

    const botId = await deriveOpaqueUuid("punks.bot.v1", command.commandId);
    const bot = env.BOTS.getByName(botId);
    const firstAlarm = await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_command WHERE singleton = 1",
          )
          .one().attempts,
      ).toBe(1);
      return state.storage.getAlarm();
    });
    expect(firstAlarm).not.toBeNull();
    expect(Number(firstAlarm)).toBeGreaterThan(Date.now());

    expect(await runDurableObjectAlarm(bot)).toBe(true);
    const secondAlarm = await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_command WHERE singleton = 1",
          )
          .one().attempts,
      ).toBe(2);
      return state.storage.getAlarm();
    });
    expect(Number(secondAlarm)).toBeGreaterThan(Number(firstAlarm));

    await runInDurableObject(bot, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(bot);
    await runInDurableObject(bot, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.toSatisfy(
        (alarm: number | null) => alarm !== null && alarm > Date.now(),
      );
    });
  });

  it("rejects an unknown Punk actor before claiming the Bot slug", async () => {
    const command = publishCommand(
      "51000000-0000-4000-8000-000000000003",
      "unknown-operator-punk",
    );
    command.actor.punkId = "00000000-0000-8000-8000-000000000099";

    const rejected = await publish(command);
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "invalid_input",
    });

    const read = await SELF.fetch(
      "https://punks.bot/api/v1/bots/unknown-operator-punk",
    );
    expect(read.status).toBe(404);
  });

  it("applies a removed action contract fail-closed before attestation recovers", async () => {
    const publishInput = publishCommand(
      "51000000-0000-4000-8000-000000000030",
      "shrinking-actions",
    );
    publishInput.payload.supportedActionContracts = [
      "message.reaction-add@1",
      "message.reaction-remove@1",
    ];
    const published = await publish(publishInput);
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const shrink: UpdateBotCommand = {
      contract: "bot.update@1",
      commandId: "51000000-0000-4000-8000-000000000098",
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        operation: "set-actions",
        supportedActionContracts: ["message.reaction-remove@1"],
      },
    };

    const pending = await update(shrink);
    expect(pending.status).toBe(503);
    await expect(pending.json()).resolves.toMatchObject({
      code: "attestation_failed",
    });

    const read = await SELF.fetch(
      "https://punks.bot/api/v1/bots/shrinking-actions",
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      bot: {
        supportedActionContracts: ["message.reaction-remove@1"],
      },
    });
  });

  it("rejects a mixed action-contract removal and extension", async () => {
    const publishInput = publishCommand(
      "51000000-0000-4000-8000-000000000031",
      "mixed-actions",
    );
    publishInput.payload.supportedActionContracts = [
      "message.reaction-add@1",
      "message.reaction-remove@1",
    ];
    const published = await publish(publishInput);
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const mixed: UpdateBotCommand = {
      contract: "bot.update@1",
      commandId: "51000000-0000-4000-8000-000000000032",
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        operation: "set-actions",
        supportedActionContracts: [
          "message.reaction-remove@1",
          "message.reaction-toggle@1",
        ],
      },
    };

    const rejected = await update(mixed);
    expect(rejected.status).toBe(409);
    const read = await SELF.fetch(
      "https://punks.bot/api/v1/bots/mixed-actions",
    );
    await expect(read.json()).resolves.toMatchObject({
      bot: {
        supportedActionContracts: [
          "message.reaction-add@1",
          "message.reaction-remove@1",
        ],
      },
    });
  });

  it("repairs an idempotent Bot rename into one canonical slug and one redirect", async () => {
    const published = await publish(
      publishCommand("51000000-0000-4000-8000-000000000050", "rename-source"),
    );
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const rename: UpdateBotCommand = {
      contract: "bot.update@1",
      commandId: "51000000-0000-4000-8000-000000000051",
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { operation: "set-slug", slug: "rename-target" },
    };

    const renamed = await update(rename);
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      bot: { id: botId, slug: "rename-target" },
      canonicalPath: "/bots/rename-target",
      replayed: false,
    });

    const replay = await update(rename);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      bot: { id: botId, slug: "rename-target" },
      replayed: true,
    });

    const oldSlug = await SELF.fetch(
      "https://punks.bot/api/v1/bots/rename-source",
      { redirect: "manual" },
    );
    expect(oldSlug.status).toBe(308);
    expect(oldSlug.headers.get("location")).toBe("/api/v1/bots/rename-target");
    const canonical = await SELF.fetch(
      "https://punks.bot/api/v1/bots/rename-target",
    );
    expect(canonical.status).toBe(200);
  });

  it("installs one Bot identity at most once in a Workspace", async () => {
    const published = await publish(
      publishCommand("51000000-0000-4000-8000-000000000010", "installable-bot"),
    );
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const workspaceCommand: CreateWorkspaceCommand = {
      contract: "workspace.create@1",
      commandId: "52000000-0000-4000-8000-000000000010",
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        slug: "bot-installation",
        name: "Bot owners",
        visibility: "private",
      },
    };
    const workspace = await createWorkspace(workspaceCommand);
    const workspaceId = (
      (await workspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const command: InstallBotCommand = {
      contract: "bot-installation.install@1",
      commandId: "53000000-0000-4000-8000-000000000010",
      workspaceId,
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
      },
    };
    const installed = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations`,
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

    expect(installed.status).toBe(201);
    const body = (await installed.json()) as {
      installation: { id: string; workspaceId: string; botId: string };
      replayed: boolean;
    };
    expect(Object.keys(body).sort()).toEqual(["installation", "replayed"]);
    expect(body).not.toHaveProperty("event");
    expect(body).toMatchObject({
      installation: {
        workspaceId,
        botId,
        status: "active",
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
        grantCount: 0,
        authorityGeneration: 1,
        cursor: 1,
      },
      replayed: false,
    });

    const read = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${body.installation.id}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({
      installation: expect.objectContaining({
        id: body.installation.id,
        workspaceId,
        botId,
        status: "active",
      }),
    });
    await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(body.installation.id),
      (_instance, state) => {
        const event = JSON.parse(
          state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE cursor = 1",
            )
            .one().event_json,
        ) as SignedNostrEvent;
        const content = JSON.parse(event.content) as {
          installation: Record<string, unknown>;
          delta: { operation: "installed" | "reinstalled" };
        };
        const projection = {
          contract: "bot-installation.projection@1",
          workspaceId,
          installationId: body.installation.id,
          cursor: 1,
          event,
          delta: {
            operation: content.delta.operation,
            installation: content.installation,
          },
        };
        expect(
          validateContract(
            "punks://contracts/bot-installation.projection@1",
            projection,
          ).valid,
        ).toBe(true);
        expect(projection).not.toHaveProperty("capabilityGrants");
        expect(projection).not.toHaveProperty("state");
      },
    );
  });

  it("normalizes grant tombstones and revokes an Installation fail-closed", async () => {
    const published = await publish(
      publishCommand("51000000-0000-4000-8000-000000000020", "grantable-bot"),
    );
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const workspace = await createWorkspace({
      contract: "workspace.create@1",
      commandId: "52000000-0000-4000-8000-000000000020",
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        slug: "bot-grants",
        name: "Bot grants",
        visibility: "private",
      },
    });
    const workspaceId = (
      (await workspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const install: InstallBotCommand = {
      contract: "bot-installation.install@1",
      commandId: "53000000-0000-4000-8000-000000000020",
      workspaceId,
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
      },
    };
    const installed = await SELF.fetch(
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
    const installationId = (
      (await installed.json()) as { installation: { id: string } }
    ).installation.id;
    const conversationId = "54000000-0000-4000-8000-000000000020";
    await seedManagedConversation(workspaceId, conversationId);
    const enable: ConfigureBotInstallationCommand = {
      contract: "bot-installation.configure@1",
      commandId: "55000000-0000-4000-8000-000000000020",
      workspaceId,
      installationId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        operation: "set-grant",
        grant: {
          capability: "messages.react",
          resource: { kind: "conversation", conversationId },
          enabled: true,
        },
      },
    };
    const configureUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${installationId}`;
    const enabled = await SELF.fetch(configureUrl, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": enable.commandId,
      },
      body: JSON.stringify(enable),
    });
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({
      installation: {
        grantCount: 1,
        authorityGeneration: 2,
        cursor: 2,
      },
    });

    const disable: ConfigureBotInstallationCommand = {
      ...enable,
      commandId: "55000000-0000-4000-8000-000000000021",
      payload: {
        operation: "set-grant",
        grant: {
          capability: "messages.react",
          resource: { kind: "conversation", conversationId },
          enabled: false,
        },
      },
    };
    const disabled = await SELF.fetch(configureUrl, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": disable.commandId,
      },
      body: JSON.stringify(disable),
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      installation: {
        grantCount: 0,
        authorityGeneration: 3,
        cursor: 3,
      },
    });

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: "56000000-0000-4000-8000-000000000020",
      workspaceId,
      installationId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { cause: "Workspace owner removed the Bot" },
    };
    const pendingRevoke = await SELF.fetch(`${configureUrl}/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": revoke.commandId,
      },
      body: JSON.stringify(revoke),
    });
    expect(pendingRevoke.status).toBe(503);
    const installation = env.BOT_INSTALLATIONS.getByName(installationId);
    await runInDurableObject(installation, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(1);
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(installation);
    await runInDurableObject(installation, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const pendingCount = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM pending_command",
        )
        .one().count;
      expect(
        (pendingCount === 1 && alarm !== null && alarm > Date.now()) ||
          (pendingCount === 0 && alarm === null),
      ).toBe(true);
    });
    const failClosedRead = await SELF.fetch(configureUrl, {
      headers: { cookie: "__Host-punks_session=session-owner" },
    });
    await expect(failClosedRead.json()).resolves.toMatchObject({
      installation: { status: "revoked", grantCount: 0, cursor: 4 },
    });

    const revoked = await SELF.fetch(`${configureUrl}/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": revoke.commandId,
      },
      body: JSON.stringify(revoke),
    });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const revokedBody = await revoked.json();
    expect(Object.keys(revokedBody as object).sort()).toEqual([
      "installation",
      "replayed",
    ]);
    expect(revokedBody).not.toHaveProperty("event");
    expect(revokedBody).toMatchObject({
      installation: {
        status: "revoked",
        grantCount: 0,
        authorityGeneration: 4,
        cursor: 4,
      },
    });

    await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(installationId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM grants WHERE resource_id = ?",
              conversationId,
            )
            .one(),
        ).toEqual({ count: 0 });
      },
    );
  });

  it("terminally rejects an extension when bots.install is revoked during attestation", async () => {
    const published = await publish(
      publishCommand("51000000-0000-4000-8000-000000000070", "reauth-bot"),
    );
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const workspace = await createWorkspace({
      contract: "workspace.create@1",
      commandId: "52000000-0000-4000-8000-000000000070",
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        slug: "bot-reauth",
        name: "Bot reauth",
        visibility: "private",
      },
    });
    const workspaceId = (
      (await workspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const admitMember: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "52000000-0000-4000-8000-000000000071",
      workspaceId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        targetPunkId: otherPunkId,
        role: "member",
        expectedRevision: 1,
      },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": admitMember.commandId,
            },
            body: JSON.stringify(admitMember),
          },
        )
      ).status,
    ).toBe(200);
    const promoteOwner: SetWorkspaceMemberRoleCommand = {
      ...admitMember,
      commandId: "52000000-0000-4000-8000-000000000074",
      payload: {
        targetPunkId: otherPunkId,
        role: "owner",
        expectedRevision: 2,
      },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": promoteOwner.commandId,
            },
            body: JSON.stringify(promoteOwner),
          },
        )
      ).status,
    ).toBe(200);

    const delayedInstall: InstallBotCommand = {
      contract: "bot-installation.install@1",
      commandId: "53000000-0000-4000-8000-000000000070",
      workspaceId,
      botId,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: {
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
      },
    };
    const collectionUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations`;
    const installing = SELF.fetch(collectionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": delayedInstall.commandId,
      },
      body: JSON.stringify(delayedInstall),
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const calls = (await (
        await env.ATTESTATION.fetch(
          "https://punks-attestation.invalid/__test/calls",
        )
      ).json()) as { calls: Array<{ event?: { tags?: string[][] } }> };
      if (
        calls.calls.some((call) =>
          call.event?.tags?.some(
            (tag) =>
              tag[0] === "command" && tag[1] === delayedInstall.commandId,
          ),
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const removeOwner: RemoveWorkspaceMemberCommand = {
      contract: "workspace.member-remove@1",
      commandId: "52000000-0000-4000-8000-000000000072",
      workspaceId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: { targetPunkId: otherPunkId, expectedRevision: 3 },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": removeOwner.commandId,
            },
            body: JSON.stringify(removeOwner),
          },
        )
      ).status,
    ).toBe(200);

    const rejected = await installing;
    expect(rejected.status).toBe(403);
    const replay = await SELF.fetch(collectionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": delayedInstall.commandId,
      },
      body: JSON.stringify(delayedInstall),
    });
    expect(replay.status).toBe(403);

    const ownerInstall: InstallBotCommand = {
      ...delayedInstall,
      commandId: "53000000-0000-4000-8000-000000000071",
      actor: { kind: "punk", punkId: operatorPunkId },
    };
    const installed = await SELF.fetch(collectionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": ownerInstall.commandId,
      },
      body: JSON.stringify(ownerInstall),
    });
    expect(installed.status).toBe(201);
    const installationId = (
      (await installed.json()) as { installation: { id: string } }
    ).installation.id;

    const restoreMember: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "52000000-0000-4000-8000-000000000073",
      workspaceId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        targetPunkId: otherPunkId,
        role: "member",
        expectedRevision: 4,
      },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": restoreMember.commandId,
            },
            body: JSON.stringify(restoreMember),
          },
        )
      ).status,
    ).toBe(200);
    const restoreOwner: SetWorkspaceMemberRoleCommand = {
      ...restoreMember,
      commandId: "52000000-0000-4000-8000-000000000075",
      payload: {
        targetPunkId: otherPunkId,
        role: "owner",
        expectedRevision: 5,
      },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": restoreOwner.commandId,
            },
            body: JSON.stringify(restoreOwner),
          },
        )
      ).status,
    ).toBe(200);
    const reduction: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: "56000000-0000-4000-8000-000000000070",
      workspaceId,
      installationId,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: { cause: "Authority was valid before attestation" },
    };
    const revokeUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${installationId}/revoke`;
    const reducing = SELF.fetch(revokeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": reduction.commandId,
      },
      body: JSON.stringify(reduction),
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const calls = (await (
        await env.ATTESTATION.fetch(
          "https://punks-attestation.invalid/__test/calls",
        )
      ).json()) as { calls: Array<{ event?: { tags?: string[][] } }> };
      if (
        calls.calls.some((call) =>
          call.event?.tags?.some(
            (tag) => tag[0] === "command" && tag[1] === reduction.commandId,
          ),
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const removeAgain: RemoveWorkspaceMemberCommand = {
      ...removeOwner,
      commandId: "52000000-0000-4000-8000-000000000076",
      payload: { targetPunkId: otherPunkId, expectedRevision: 6 },
    };
    expect(
      (
        await SELF.fetch(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              cookie: "__Host-punks_session=session-owner",
              "idempotency-key": removeAgain.commandId,
            },
            body: JSON.stringify(removeAgain),
          },
        )
      ).status,
    ).toBe(200);
    const reduced = await reducing;
    expect(reduced.status).toBe(200);
    await expect(reduced.json()).resolves.toMatchObject({
      installation: { status: "revoked" },
    });

    const oldReplay = await SELF.fetch(collectionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": delayedInstall.commandId,
      },
      body: JSON.stringify(delayedInstall),
    });
    expect(oldReplay.status).toBe(403);
  });

  it("keeps each projection grant delta bounded after more than one hundred grants", async () => {
    const published = await publish(
      publishCommand("51000000-0000-4000-8000-000000000060", "bounded-grants"),
    );
    const botId = ((await published.json()) as { bot: { id: string } }).bot.id;
    const workspace = await createWorkspace({
      contract: "workspace.create@1",
      commandId: "52000000-0000-4000-8000-000000000060",
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        slug: "bounded-bot-grants",
        name: "Bounded grants",
        visibility: "private",
      },
    });
    const workspaceId = (
      (await workspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const install: InstallBotCommand = {
      contract: "bot-installation.install@1",
      commandId: "53000000-0000-4000-8000-000000000060",
      workspaceId,
      botId,
      actor: { kind: "punk", punkId: operatorPunkId },
      payload: {
        config: {
          contractId: "punks://contracts/bot.config.empty@1",
          value: {},
        },
      },
    };
    const installed = await SELF.fetch(
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
    const installationId = (
      (await installed.json()) as { installation: { id: string } }
    ).installation.id;
    const url = `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${installationId}`;

    for (let index = 1; index <= 101; index += 1) {
      const suffix = String(index).padStart(12, "0");
      const conversationId = `57000000-0000-4000-8000-${suffix}`;
      await seedManagedConversation(workspaceId, conversationId);
      const command: ConfigureBotInstallationCommand = {
        contract: "bot-installation.configure@1",
        commandId: `58000000-0000-4000-8000-${suffix}`,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId: operatorPunkId },
        payload: {
          operation: "set-grant",
          grant: {
            capability: "messages.react",
            resource: {
              kind: "conversation",
              conversationId,
            },
            enabled: true,
          },
        },
      };
      const response = await SELF.fetch(url, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": command.commandId,
        },
        body: JSON.stringify(command),
      });
      expect(response.status).toBe(200);
    }

    await runInDurableObject(
      env.BOT_INSTALLATIONS.getByName(installationId),
      (_instance, state) => {
        const event = JSON.parse(
          state.storage.sql
            .exec<{ event_json: string }>(
              "SELECT event_json FROM journal WHERE cursor = 102",
            )
            .one().event_json,
        ) as SignedNostrEvent;
        const content = JSON.parse(event.content) as {
          installation: {
            authorityGeneration: number;
            revision: number;
            cursor: number;
          };
          delta: {
            operation: "set-grant";
            grant: {
              capability: string;
              resource: Record<string, unknown>;
              enabled: boolean;
            };
          };
        };
        const projection = {
          contract: "bot-installation.projection@1",
          workspaceId,
          installationId,
          cursor: 102,
          event,
          delta: {
            operation: content.delta.operation,
            capability: content.delta.grant.capability,
            resource: content.delta.grant.resource,
            enabled: content.delta.grant.enabled,
            authorityGeneration: content.installation.authorityGeneration,
            revision: content.installation.revision,
            cursor: content.installation.cursor,
          },
        };
        const payloadJson = JSON.stringify(projection);
        expect(payloadJson.length).toBeLessThan(8_192);
        expect(Object.keys(projection).sort()).toEqual([
          "contract",
          "cursor",
          "delta",
          "event",
          "installationId",
          "workspaceId",
        ]);
        expect(projection).not.toHaveProperty("capabilityGrants");
        expect(projection).not.toHaveProperty("state");
        expect(projection.delta).toMatchObject({
          operation: "set-grant",
          enabled: true,
          cursor: 102,
        });
      },
    );
  }, 30_000);
});
