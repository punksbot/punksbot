import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import admissionSchema from "../schemas/bot-action.admission.schema.json";
import admitSchema from "../schemas/bot-action.admit.schema.json";
import completeSchema from "../schemas/bot-action.complete.schema.json";
import replaySchema from "../schemas/bot-action.replay.schema.json";
import emptyConfigSchema from "../schemas/bot.config.empty.schema.json";
import installationSchema from "../schemas/bot-installation.schema.json";
import configureSchema from "../schemas/bot-installation.configure.schema.json";
import getSchema from "../schemas/bot-installation.get.schema.json";
import installSchema from "../schemas/bot-installation.install.schema.json";
import revokeSchema from "../schemas/bot-installation.revoke.schema.json";
import botSchema from "../schemas/bot.schema.json";
import botGetSchema from "../schemas/bot.get.schema.json";
import publishSchema from "../schemas/bot.publish.schema.json";
import updateSchema from "../schemas/bot.update.schema.json";
import { contractSchemas, validateContract } from "../src";

const workspaceId = "00000000-0000-8000-8000-000000000201";
const conversationId = "00000000-0000-8000-8000-000000000202";
const messageId = "00000000-0000-8000-8000-000000000203";
const botId = "00000000-0000-8000-8000-000000000204";
const installationId = "00000000-0000-8000-8000-000000000205";
const punkId = "00000000-0000-8000-8000-000000000206";
const commandId = "00000000-0000-8000-8000-000000000207";
const actionId = "00000000-0000-8000-8000-000000000208";
const admissionId = "00000000-0000-8000-8000-000000000209";
const timestamp = "2026-08-21T12:00:00.000Z";
const digest = "a".repeat(64);
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

function validates(schema: object, value: unknown): boolean {
  return new Validator(schema as never, "2020-12", false).validate(value).valid;
}

const emptyConfig = {
  contractId: "punks://contracts/bot.config.empty@1",
  value: {},
};

describe("Bot JSON contracts", () => {
  it("admits the two exact Bot journal attestation purposes", () => {
    const event = {
      created_at: 1_787_310_000,
      kind: 50300,
      tags: [["bot", botId]],
      content: "{}",
    };
    for (const purpose of ["bot-journal", "bot-installation-journal"]) {
      expect(
        validateContract("punks://contracts/attestation.request@1", {
          purpose,
          event,
        }),
      ).toEqual({ valid: true });
    }
  });

  it("loads every first-slice Bot contract from the canonical registry", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot@1",
        "punks://contracts/bot.publish@1",
        "punks://contracts/bot.update@1",
        "punks://contracts/bot.get@1",
        "punks://contracts/bot.projection@1",
        "punks://contracts/bot.config.empty@1",
        "punks://contracts/bot-installation@1",
        "punks://contracts/bot-installation.install@1",
        "punks://contracts/bot-installation.configure@1",
        "punks://contracts/bot-installation.revoke@1",
        "punks://contracts/bot-installation.get@1",
        "punks://contracts/bot-installation.projection@1",
        "punks://contracts/bot-action.admission@1",
        "punks://contracts/bot-action.admit@1",
        "punks://contracts/bot-action.replay@1",
        "punks://contracts/bot-action.complete@1",
      ]),
    );
  });

  it("publishes and updates one bounded global Punks Bot definition", () => {
    expect(validates(botGetSchema, { contract: "bot.get@1", botId })).toBe(
      true,
    );
    const publish = {
      contract: "bot.publish@1",
      commandId,
      actor: { kind: "punk", punkId },
      payload: {
        slug: "reaction-bot",
        name: "Reaction Bot",
        description: "Reacts to Messages when invoked.",
        configContractId: "punks://contracts/bot.config.empty@1",
        runtimeRelease,
        supportedActionContracts: [
          "message.reaction-add@1",
          "message.reaction-remove@1",
          "message.reaction-toggle@1",
        ],
      },
    };
    expect(validates(publishSchema, publish)).toBe(true);
    const legacyPublish = structuredClone(publish) as Record<string, unknown>;
    const legacyPayload = legacyPublish.payload as Record<string, unknown>;
    delete legacyPayload.runtimeRelease;
    expect(validates(publishSchema, legacyPublish)).toBe(false);
    expect(
      validates(publishSchema, {
        ...publish,
        payload: {
          ...publish.payload,
          runtimeRelease: { ...runtimeRelease, model: "caller-controlled" },
        },
      }),
    ).toBe(false);
    expect(validates(publishSchema, { ...publish, code: "fetch('x')" })).toBe(
      false,
    );
    expect(
      validates(updateSchema, {
        contract: "bot.update@1",
        commandId,
        botId,
        actor: { kind: "punk", punkId },
        payload: { operation: "set-slug", slug: "reaction-bot-v2" },
      }),
    ).toBe(true);
    expect(
      validates(updateSchema, {
        contract: "bot.update@1",
        commandId,
        botId,
        actor: { kind: "punk", punkId },
        payload: { operation: "set-runtime-release", runtimeRelease },
      }),
    ).toBe(true);
    expect(
      validates(updateSchema, {
        contract: "bot.update@1",
        commandId,
        botId,
        actor: { kind: "punk", punkId },
        payload: { operation: "set-metadata" },
      }),
    ).toBe(false);
    expect(
      validates(updateSchema, {
        contract: "bot.update@1",
        commandId,
        botId,
        actor: { kind: "punk", punkId },
        payload: { operation: "set-status", status: "suspended" },
      }),
    ).toBe(true);

    const legacyBot = {
      id: botId,
      slug: "reaction-bot",
      name: "Reaction Bot",
      description: "Reacts to Messages when invoked.",
      status: "published",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-add@1"],
      revision: 1,
      cursor: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      suspendedAt: null,
      withdrawnAt: null,
    };
    expect(validates(botSchema, legacyBot)).toBe(true);
    expect(validates(botSchema, { ...legacyBot, runtimeRelease: null })).toBe(
      true,
    );
    expect(validates(botSchema, { ...legacyBot, runtimeRelease })).toBe(true);
    expect(
      validates(botSchema, {
        ...legacyBot,
        runtimeRelease: { ...runtimeRelease, releaseId: "unknown" },
      }),
    ).toBe(false);
  });

  it("accepts only the Punks-owned empty configuration in the first slice", () => {
    expect(validates(emptyConfigSchema, {})).toBe(true);
    for (const forbidden of [
      { code: "export default 1" },
      { url: "https://example.com" },
      { command: "echo hi" },
      { env: { TOKEN: "secret" } },
    ]) {
      expect(validates(emptyConfigSchema, forbidden)).toBe(false);
    }
  });

  it("installs, configures one normalized grant delta, queries, and revokes", () => {
    const install = {
      contract: "bot-installation.install@1",
      commandId,
      workspaceId,
      botId,
      actor: { kind: "punk", punkId },
      payload: { config: emptyConfig },
    };
    expect(validates(installSchema, install)).toBe(true);
    expect(
      validates(installSchema, {
        ...install,
        payload: { ...install.payload, runtimeRelease },
      }),
    ).toBe(false);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: {
          operation: "set-grant",
          grant: {
            capability: "messages.react",
            resource: { kind: "conversation", conversationId },
            enabled: true,
          },
        },
      }),
    ).toBe(true);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: {
          operation: "set-grant",
          grant: {
            capability: "messages.read-context",
            resource: { kind: "conversation", conversationId },
            enabled: true,
          },
        },
      }),
    ).toBe(true);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: { operation: "pin-runtime-release" },
      }),
    ).toBe(true);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: { operation: "pin-runtime-release", runtimeRelease },
      }),
    ).toBe(false);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: {
          operation: "set-grant",
          grant: {
            capability: "messages.react",
            resource: { kind: "workspace", workspaceId },
            enabled: true,
          },
        },
      }),
    ).toBe(false);
    expect(
      validates(configureSchema, {
        contract: "bot-installation.configure@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: { operation: "replace-config", config: emptyConfig },
      }),
    ).toBe(true);
    expect(
      validates(getSchema, {
        contract: "bot-installation.get@1",
        workspaceId,
        installationId,
      }),
    ).toBe(true);
    expect(
      validates(revokeSchema, {
        contract: "bot-installation.revoke@1",
        commandId,
        workspaceId,
        installationId,
        actor: { kind: "punk", punkId },
        payload: { cause: "owner-request" },
      }),
    ).toBe(true);

    const legacyInstallation = {
      id: installationId,
      workspaceId,
      botId,
      status: "active",
      config: emptyConfig,
      grantCount: 1,
      openAdmissionCount: 0,
      authorityGeneration: 2,
      revision: 2,
      cursor: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
      revokedAt: null,
    };
    expect(validates(installationSchema, legacyInstallation)).toBe(true);
    expect(
      validates(installationSchema, {
        ...legacyInstallation,
        runtimeRelease: null,
      }),
    ).toBe(true);
    expect(
      validates(installationSchema, {
        ...legacyInstallation,
        runtimeRelease,
      }),
    ).toBe(true);
  });

  it("admits only exact Reaction actions and keeps replay and completion payload-free", () => {
    const actor = { kind: "bot", installationId };
    const admit = {
      contract: "bot-action.admit@1",
      commandId,
      actionId,
      workspaceId,
      installationId,
      actor,
      action: {
        contract: "message.reaction-toggle@1",
        conversationId,
        messageId,
        payload: { reaction: "🔥" },
      },
    };
    expect(validates(admitSchema, admit)).toBe(true);
    expect(
      validates(admitSchema, {
        ...admit,
        capability: "messages.moderate",
      }),
    ).toBe(false);
    expect(
      validates(admitSchema, {
        ...admit,
        action: { kind: "anything", input: { plaintext: "hello" } },
      }),
    ).toBe(false);

    const replay = {
      contract: "bot-action.replay@1",
      commandId,
      admissionId,
      actionId,
      actionDigest: digest,
      workspaceId,
      installationId,
      actor,
    };
    expect(validates(replaySchema, replay)).toBe(true);
    expect(validates(replaySchema, { ...replay, payload: admit.action })).toBe(
      false,
    );
    expect(
      validates(completeSchema, {
        ...replay,
        contract: "bot-action.complete@1",
        outcome: "succeeded",
      }),
    ).toBe(true);
  });

  it("stores a compact admission receipt and enforces completed tombstones", () => {
    const admitted = {
      id: admissionId,
      actionId,
      actionDigest: digest,
      workspaceId,
      installationId,
      botId,
      actionContract: "message.reaction-toggle@1",
      capability: "messages.react",
      risk: "routine",
      resource: {
        kind: "message",
        conversationId,
        messageId,
      },
      status: "admitted",
      outcome: null,
      installationCursor: 4,
      authorityGeneration: 2,
      admittedCursor: 4,
      completedCursor: null,
      admittedAt: timestamp,
      completedAt: null,
    };
    expect(validates(admissionSchema, admitted)).toBe(true);
    expect(
      validates(admissionSchema, {
        ...admitted,
        status: "completed",
        outcome: "succeeded",
        completedCursor: 6,
        completedAt: timestamp,
      }),
    ).toBe(true);
    expect(
      validates(admissionSchema, {
        ...admitted,
        status: "completed",
      }),
    ).toBe(false);
    expect(
      validates(admissionSchema, {
        ...admitted,
        action: { reaction: "secret-ish payload" },
      }),
    ).toBe(false);
  });

  it("projects Bot and Installation deltas without configuration plaintext", () => {
    const event = {
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      created_at: 1_787_310_000,
      kind: 50310,
      tags: [["workspace", workspaceId]],
      content: "{}",
      sig: "3".repeat(128),
    };
    const state = {
      id: botId,
      slug: "reaction-bot",
      name: "Reaction Bot",
      description: "Reacts to Messages when invoked.",
      status: "published",
      configContractId: "punks://contracts/bot.config.empty@1",
      supportedActionContracts: ["message.reaction-toggle@1"],
      revision: 1,
      cursor: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      suspendedAt: null,
      withdrawnAt: null,
    };
    expect(
      validateContract("punks://contracts/bot.projection@1", {
        contract: "bot.projection@1",
        botId,
        cursor: 1,
        event: { ...event, kind: 50300 },
        state,
      }),
    ).toEqual({ valid: true });

    const installation = {
      id: installationId,
      workspaceId,
      botId,
      status: "active",
      configContractId: "punks://contracts/bot.config.empty@1",
      configDigest: digest,
      grantCount: 0,
      openAdmissionCount: 0,
      authorityGeneration: 1,
      revision: 1,
      cursor: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revokedAt: null,
    };
    const envelope = {
      contract: "bot-installation.projection@1",
      workspaceId,
      installationId,
      cursor: 1,
      event,
      delta: { operation: "installed", installation },
    };
    expect(
      validateContract(
        "punks://contracts/bot-installation.projection@1",
        envelope,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-installation.projection@1", {
        ...envelope,
        delta: {
          operation: "installed",
          installation: { ...installation, value: {} },
        },
      }).valid,
    ).toBe(false);
  });
});
