import type {
  AdmitBotActionCommand,
  Bot,
  BotActionAdmission,
  BotInstallation,
  CompleteBotActionCommand,
  ConfigureBotInstallationCommand,
  GetBotInstallationQuery,
  InstallBotCommand,
  ReplayBotActionCommand,
  RevokeBotInstallationCommand,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  assertPunksBotConfig,
  BOT_ACTION_REGISTRY,
  BOT_INSTALLATION_GRANT_CAPABILITIES,
  BOT_INSTALLATION_EVENT_KINDS,
  BotInstallationDomainError,
  deriveBotActionAdmissionId,
  deriveBotInstallationId,
  executeBotInstallation,
  queryBotInstallation,
  type BotInstallationExecutionContext,
  type BotInstallationGrant,
} from "../src/bot-installation";

const workspaceId = "00000000-0000-8000-8000-000000000201";
const conversationId = "00000000-0000-8000-8000-000000000202";
const messageId = "00000000-0000-8000-8000-000000000203";
const botId = "00000000-0000-8000-8000-000000000204";
const installationId = "b8fef268-2a45-8b29-9677-40bb4ec85b5a";
const punkId = "00000000-0000-8000-8000-000000000206";
const actionId = "00000000-0000-8000-8000-000000000208";
const admissionId = "38dbd84c-5dcd-82b4-b0ad-f3aebdadddaa";
const now = new Date("2026-08-21T12:00:00.000Z");
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

const bot: Bot = {
  id: botId,
  slug: "reaction-bot",
  name: "Reaction Bot",
  description: "Reacts to Messages when invoked.",
  status: "published",
  configContractId: "punks://contracts/bot.config.empty@1",
  runtimeRelease,
  supportedActionContracts: [
    "message.reaction-add@1",
    "message.reaction-remove@1",
    "message.reaction-toggle@1",
  ],
  revision: 1,
  cursor: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  suspendedAt: null,
  withdrawnAt: null,
};

const config = {
  contractId: "punks://contracts/bot.config.empty@1" as const,
  value: {},
};

function context(
  overrides: Partial<BotInstallationExecutionContext> = {},
): BotInstallationExecutionContext {
  return {
    installationId,
    cursor: 1,
    now,
    workspace: {
      id: workspaceId,
      status: "active",
      botsInstallAuthorized: true,
    },
    bot,
    currentGrant: null,
    existingAdmission: null,
    ...overrides,
  };
}

function installCommand(): InstallBotCommand {
  return {
    contract: "bot-installation.install@1",
    commandId: "00000000-0000-8000-8000-000000000207",
    workspaceId,
    botId,
    actor: { kind: "punk", punkId },
    payload: { config },
  };
}

function configureCommand(
  grant: BotInstallationGrant,
  commandId = "00000000-0000-8000-8000-000000000209",
): ConfigureBotInstallationCommand {
  return {
    contract: "bot-installation.configure@1",
    commandId,
    workspaceId,
    installationId,
    actor: { kind: "punk", punkId },
    payload: { operation: "set-grant", grant },
  };
}

function reactionGrant(enabled: boolean): BotInstallationGrant {
  return {
    capability: "messages.react",
    resource: { kind: "conversation", conversationId },
    enabled,
  };
}

function readContextGrant(enabled: boolean): BotInstallationGrant {
  return {
    capability: "messages.read-context",
    resource: { kind: "conversation", conversationId },
    enabled,
  };
}

function pinRuntimeReleaseCommand(): ConfigureBotInstallationCommand {
  return {
    contract: "bot-installation.configure@1",
    commandId: "00000000-0000-8000-8000-000000000217",
    workspaceId,
    installationId,
    actor: { kind: "punk", punkId },
    payload: { operation: "pin-runtime-release" },
  };
}

function admitCommand(
  overrides: Partial<AdmitBotActionCommand> = {},
): AdmitBotActionCommand {
  return {
    contract: "bot-action.admit@1",
    commandId: "00000000-0000-8000-8000-000000000210",
    actionId,
    workspaceId,
    installationId,
    actor: { kind: "bot", installationId },
    action: {
      contract: "message.reaction-toggle@1",
      conversationId,
      messageId,
      payload: { reaction: "🔥" },
    },
    ...overrides,
  };
}

async function installed(): Promise<BotInstallation> {
  return (await executeBotInstallation(null, installCommand(), context()))
    .nextState;
}

async function installedWithGrant(): Promise<BotInstallation> {
  const state = await installed();
  return (
    await executeBotInstallation(
      state,
      configureCommand(reactionGrant(true)),
      context({ cursor: 2 }),
    )
  ).nextState;
}

describe("Bot Installation domain module", () => {
  it("derives stable Installation identity only from Workspace and Bot", async () => {
    await expect(deriveBotInstallationId(workspaceId, botId)).resolves.toBe(
      installationId,
    );
    await expect(
      deriveBotInstallationId(
        workspaceId,
        "00000000-0000-8000-8000-000000000299",
      ),
    ).resolves.not.toBe(installationId);
    await expect(
      deriveBotActionAdmissionId(installationId, actionId),
    ).resolves.toBe(admissionId);
  });

  it("installs one published Bot with no inherited grants", async () => {
    const decision = await executeBotInstallation(
      null,
      installCommand(),
      context(),
    );
    expect(decision.nextState).toEqual({
      id: installationId,
      workspaceId,
      botId,
      status: "active",
      runtimeRelease,
      config,
      grantCount: 0,
      openAdmissionCount: 0,
      authorityGeneration: 1,
      revision: 1,
      cursor: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      revokedAt: null,
    });
    expect(decision.event?.kind).toBe(
      BOT_INSTALLATION_EVENT_KINDS.installationInstalled,
    );
    expect(decision.admission).toBeNull();
    expect(decision.event?.content).not.toContain("credential");
    const content = JSON.parse(decision.event?.content ?? "null");
    expect(content.installation.config).toBeUndefined();
    expect(content.installation.configContractId).toBe(
      "punks://contracts/bot.config.empty@1",
    );
    expect(content.installation.configDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(decision.event?.content).not.toContain('"value"');

    await expect(
      executeBotInstallation(
        null,
        installCommand(),
        context({
          installationId: "00000000-0000-8000-8000-000000000299",
        }),
      ),
    ).rejects.toThrowError(/derived from Workspace and Bot/);
  });

  it("inherits only the published Bot runtime release and normalizes legacy absence to null", async () => {
    const inherited = await installed();
    expect(inherited.runtimeRelease).toEqual(runtimeRelease);

    const legacyBot: Bot = { ...bot, runtimeRelease: null };
    const legacy = await executeBotInstallation(
      null,
      installCommand(),
      context({ bot: legacyBot }),
    );
    expect(legacy.nextState.runtimeRelease).toBeNull();
  });

  it("pins a legacy Installation to the current known Bot release without caller input", async () => {
    const legacy = { ...(await installed()), runtimeRelease: null };
    const pinned = await executeBotInstallation(
      legacy,
      pinRuntimeReleaseCommand(),
      context({ cursor: 2 }),
    );
    expect(pinned.nextState).toMatchObject({
      runtimeRelease,
      authorityGeneration: 2,
      revision: 2,
      cursor: 2,
    });
    expect(JSON.parse(pinned.event?.content ?? "null")).toMatchObject({
      installation: { runtimeRelease },
      delta: { operation: "pin-runtime-release", runtimeRelease },
    });

    await expect(
      executeBotInstallation(
        pinned.nextState,
        pinRuntimeReleaseCommand(),
        context({ cursor: 3 }),
      ),
    ).rejects.toThrowError(/already pinned/);
    await expect(
      executeBotInstallation(
        legacy,
        pinRuntimeReleaseCommand(),
        context({ cursor: 2, bot: { ...bot, runtimeRelease: null } }),
      ),
    ).rejects.toThrowError(/known runtime release/);
  });

  it("accepts only the bounded Punks config contract", () => {
    expect(() => assertPunksBotConfig(config)).not.toThrow();
    for (const value of [
      { code: "export default 1" },
      { url: "https://example.com" },
      { command: "echo hi" },
      { env: { TOKEN: "secret" } },
    ]) {
      expect(() =>
        assertPunksBotConfig({
          contractId: "punks://contracts/bot.config.empty@1",
          value,
        }),
      ).toThrowError(/empty configuration/);
    }
  });

  it("applies one exact Conversation grant delta without a grant snapshot", async () => {
    const state = await installed();
    const granted = await executeBotInstallation(
      state,
      configureCommand(reactionGrant(true)),
      context({ cursor: 2 }),
    );
    expect(granted.nextState).toMatchObject({
      grantCount: 1,
      authorityGeneration: 2,
      revision: 2,
      cursor: 2,
    });
    expect(granted.event?.kind).toBe(
      BOT_INSTALLATION_EVENT_KINDS.installationConfigured,
    );
    expect(granted.event?.content).toContain('"operation":"set-grant"');
    expect(granted.event?.content).not.toContain('"grants"');
    expect(granted.event?.content).not.toContain('"value"');
    expect(
      JSON.parse(granted.event?.content ?? "null").installation.configDigest,
    ).toMatch(/^[0-9a-f]{64}$/);

    const revokedGrant = await executeBotInstallation(
      granted.nextState,
      configureCommand(
        reactionGrant(false),
        "00000000-0000-8000-8000-000000000211",
      ),
      context({ cursor: 3, currentGrant: reactionGrant(true) }),
    );
    expect(revokedGrant.nextState.grantCount).toBe(0);

    const query: GetBotInstallationQuery = {
      contract: "bot-installation.get@1",
      workspaceId,
      installationId,
    };
    expect(queryBotInstallation(revokedGrant.nextState, query)).toBe(
      revokedGrant.nextState,
    );
  });

  it("enables read-context only when Bot and Installation pin the same known release", async () => {
    const state = await installed();
    const granted = await executeBotInstallation(
      state,
      configureCommand(readContextGrant(true)),
      context({ cursor: 2 }),
    );
    expect(granted.nextState).toMatchObject({
      grantCount: 1,
      authorityGeneration: 2,
      revision: 2,
    });
    expect(granted.event?.content).toContain(
      '"capability":"messages.read-context"',
    );

    await expect(
      executeBotInstallation(
        { ...state, runtimeRelease: null },
        configureCommand(readContextGrant(true)),
        context({ cursor: 2 }),
      ),
    ).rejects.toThrowError(/matching known runtime release/);
    await expect(
      executeBotInstallation(
        state,
        configureCommand(readContextGrant(true)),
        context({ cursor: 2, bot: { ...bot, runtimeRelease: null } }),
      ),
    ).rejects.toThrowError(/matching known runtime release/);
    await expect(
      executeBotInstallation(
        state,
        configureCommand(readContextGrant(true)),
        context({
          cursor: 2,
          bot: {
            ...bot,
            runtimeRelease: {
              ...runtimeRelease,
              releaseDigest: "0".repeat(64),
            },
          } as unknown as Bot,
        }),
      ),
    ).rejects.toThrowError(/matching known runtime release/);
  });

  it("maps exact Reaction contracts to one routine capability requirement", () => {
    expect(BOT_INSTALLATION_GRANT_CAPABILITIES).toEqual([
      "messages.react",
      "messages.read-context",
    ]);
    expect(BOT_ACTION_REGISTRY).toEqual({
      "message.reaction-add@1": {
        capability: "messages.react",
        risk: "routine",
      },
      "message.reaction-remove@1": {
        capability: "messages.react",
        risk: "routine",
      },
      "message.reaction-toggle@1": {
        capability: "messages.react",
        risk: "routine",
      },
    });
  });

  it("admits one exact action with a compact receipt and no action payload in the event", async () => {
    const state = await installedWithGrant();
    const admitted = await executeBotInstallation(
      state,
      admitCommand(),
      context({ cursor: 3, currentGrant: reactionGrant(true) }),
    );
    expect(admitted.nextState).toMatchObject({
      openAdmissionCount: 1,
      authorityGeneration: 2,
      revision: 3,
      cursor: 3,
    });
    expect(admitted.admission).toMatchObject({
      id: admissionId,
      actionId,
      workspaceId,
      installationId,
      botId,
      actionContract: "message.reaction-toggle@1",
      capability: "messages.react",
      risk: "routine",
      resource: { kind: "message", conversationId, messageId },
      status: "admitted",
      outcome: null,
      installationCursor: 3,
      authorityGeneration: 2,
      admittedCursor: 3,
      completedCursor: null,
    });
    expect(admitted.admission?.actionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(admitted.event?.kind).toBe(
      BOT_INSTALLATION_EVENT_KINDS.botActionAdmitted,
    );
    expect(admitted.event?.content).not.toContain("🔥");
    expect(admitted.event?.content).not.toContain('"payload"');
  });

  it("denies a new admission after grant or Installation revocation", async () => {
    const state = await installedWithGrant();
    await expect(
      executeBotInstallation(
        state,
        admitCommand(),
        context({ cursor: 3, currentGrant: null }),
      ),
    ).rejects.toThrowError(/messages.react grant/);
    await expect(
      executeBotInstallation(
        state,
        admitCommand(),
        context({
          cursor: 3,
          currentGrant: {
            ...reactionGrant(true),
            resource: {
              kind: "conversation",
              conversationId: "00000000-0000-8000-8000-000000000299",
            },
          },
        }),
      ),
    ).rejects.toThrowError(/messages.react grant/);
    await expect(
      executeBotInstallation(
        state,
        admitCommand(),
        context({
          cursor: 3,
          currentGrant: reactionGrant(true),
          bot: {
            ...bot,
            status: "suspended",
            suspendedAt: now.toISOString(),
          },
        }),
      ),
    ).rejects.toThrowError(/Bot is not published/);
    await expect(
      executeBotInstallation(
        state,
        admitCommand(),
        context({
          cursor: 3,
          currentGrant: reactionGrant(true),
          bot: {
            ...bot,
            supportedActionContracts: ["message.reaction-add@1"],
          },
        }),
      ),
    ).rejects.toThrowError(/exact action contract/);

    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: "00000000-0000-8000-8000-000000000212",
      workspaceId,
      installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "owner-request" },
    };
    const revoked = await executeBotInstallation(
      state,
      revoke,
      context({ cursor: 3 }),
    );
    expect(revoked.nextState.authorityGeneration).toBe(3);
    const revokedContent = JSON.parse(revoked.event?.content ?? "null");
    const { config: revokedConfig, ...reconstructibleRevokedState } =
      revoked.nextState;
    expect(revokedContent.installation).toEqual({
      ...reconstructibleRevokedState,
      configContractId: revokedConfig.contractId,
      configDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(revoked.event?.content).not.toContain('"value"');
    await expect(
      executeBotInstallation(
        revoked.nextState,
        admitCommand(),
        context({ cursor: 4, currentGrant: reactionGrant(true) }),
      ),
    ).rejects.toThrowError(/Installation is not active/);
  });

  it("replays and completes an admitted receipt after revocation without cross-DO atomicity", async () => {
    const state = await installedWithGrant();
    const admitted = await executeBotInstallation(
      state,
      admitCommand(),
      context({ cursor: 3, currentGrant: reactionGrant(true) }),
    );
    const receipt = admitted.admission;
    if (receipt === null) {
      throw new Error("test admission receipt is required");
    }
    const revoke: RevokeBotInstallationCommand = {
      contract: "bot-installation.revoke@1",
      commandId: "00000000-0000-8000-8000-000000000212",
      workspaceId,
      installationId,
      actor: { kind: "punk", punkId },
      payload: { cause: "owner-request" },
    };
    const revoked = await executeBotInstallation(
      admitted.nextState,
      revoke,
      context({ cursor: 4 }),
    );

    const replay: ReplayBotActionCommand = {
      contract: "bot-action.replay@1",
      commandId: "00000000-0000-8000-8000-000000000213",
      admissionId: receipt.id,
      actionId,
      actionDigest: receipt.actionDigest,
      workspaceId,
      installationId,
      actor: { kind: "bot", installationId },
    };
    const replayed = await executeBotInstallation(
      revoked.nextState,
      replay,
      context({
        cursor: 5,
        bot: null,
        currentGrant: null,
        existingAdmission: receipt,
      }),
    );
    expect(replayed).toMatchObject({
      event: null,
      nextState: revoked.nextState,
      admission: receipt,
      replayed: true,
    });

    const admittedWithoutPunkPermission = await executeBotInstallation(
      admitted.nextState,
      admitCommand({
        actionId: "00000000-0000-8000-8000-000000000216",
      }),
      context({
        cursor: 5,
        currentGrant: reactionGrant(true),
        workspace: {
          id: workspaceId,
          status: "active",
          botsInstallAuthorized: false,
        },
      }),
    );
    expect(admittedWithoutPunkPermission.admission?.status).toBe("admitted");

    const complete: CompleteBotActionCommand = {
      ...replay,
      contract: "bot-action.complete@1",
      commandId: "00000000-0000-8000-8000-000000000214",
      outcome: "succeeded",
    };
    const completed = await executeBotInstallation(
      revoked.nextState,
      complete,
      context({
        cursor: 5,
        bot: null,
        currentGrant: null,
        existingAdmission: receipt,
      }),
    );
    expect(completed.nextState.openAdmissionCount).toBe(0);
    expect(completed.nextState.authorityGeneration).toBe(3);
    expect(completed.admission).toMatchObject({
      id: admissionId,
      actionId,
      actionDigest: receipt.actionDigest,
      status: "completed",
      outcome: "succeeded",
      completedCursor: 5,
      completedAt: now.toISOString(),
    });
    expect(completed.event?.content).not.toContain('"payload"');

    const tombstone = completed.admission as BotActionAdmission;
    const completedReplay = await executeBotInstallation(
      completed.nextState,
      complete,
      context({
        cursor: 6,
        bot: null,
        existingAdmission: tombstone,
      }),
    );
    expect(completedReplay).toMatchObject({
      event: null,
      nextState: completed.nextState,
      admission: tombstone,
      replayed: true,
    });
    await expect(
      executeBotInstallation(
        completed.nextState,
        { ...complete, outcome: "failed" },
        context({
          cursor: 6,
          bot: null,
          existingAdmission: tombstone,
        }),
      ),
    ).rejects.toThrowError(/outcome cannot change/);
  });

  it("rejects a forged receipt coordinate and command reuse with another payload", async () => {
    const state = await installedWithGrant();
    const admitted = await executeBotInstallation(
      state,
      admitCommand(),
      context({ cursor: 3, currentGrant: reactionGrant(true) }),
    );
    const receipt = admitted.admission;
    if (receipt === null) {
      throw new Error("test admission receipt is required");
    }
    const forgedReplay: ReplayBotActionCommand = {
      contract: "bot-action.replay@1",
      commandId: "00000000-0000-8000-8000-000000000215",
      admissionId: "00000000-0000-8000-8000-000000000299",
      actionId,
      actionDigest: receipt.actionDigest,
      workspaceId,
      installationId,
      actor: { kind: "bot", installationId },
    };
    await expect(
      executeBotInstallation(
        admitted.nextState,
        forgedReplay,
        context({ cursor: 4, existingAdmission: receipt }),
      ),
    ).rejects.toThrowError(/does not match the durable admission receipt/);

    await expect(
      executeBotInstallation(
        admitted.nextState,
        admitCommand({
          action: {
            contract: "message.reaction-toggle@1",
            conversationId,
            messageId,
            payload: { reaction: "👍" },
          },
        }),
        context({
          cursor: 4,
          currentGrant: reactionGrant(true),
          existingAdmission: receipt,
        }),
      ),
    ).rejects.toThrowError(/actionId is already bound/);
  });

  it("fails closed for non-owner management and suspended global Bots", async () => {
    await expect(
      executeBotInstallation(
        null,
        installCommand(),
        context({
          workspace: {
            id: workspaceId,
            status: "active",
            botsInstallAuthorized: false,
          },
        }),
      ),
    ).rejects.toThrowError(BotInstallationDomainError);
    await expect(
      executeBotInstallation(
        null,
        installCommand(),
        context({
          bot: {
            ...bot,
            status: "suspended",
            suspendedAt: now.toISOString(),
          },
        }),
      ),
    ).rejects.toThrowError(/Bot is not published/);
  });
});
