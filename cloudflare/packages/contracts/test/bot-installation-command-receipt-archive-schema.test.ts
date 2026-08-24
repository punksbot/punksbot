import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const installationId = "92000000-0000-4000-8000-000000000001";
const workspaceId = "92000000-0000-4000-8000-000000000002";
const botId = "92000000-0000-4000-8000-000000000003";
const commandId = "92000000-0000-4000-8000-000000000004";
const punkId = "92000000-0000-4000-8000-000000000005";
const payloadHash = "a".repeat(64);
const timestamp = "2026-08-21T10:00:00.000Z";
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

const state = {
  id: installationId,
  workspaceId,
  botId,
  status: "active",
  config: {
    contractId: "punks://contracts/bot.config.empty@1",
    value: {},
  },
  grantCount: 0,
  openAdmissionCount: 0,
  authorityGeneration: 1,
  revision: 1,
  cursor: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  revokedAt: null,
} as const;

const content = JSON.stringify({
  schemaVersion: 1,
  installation: {
    id: installationId,
    workspaceId,
    botId,
    status: "active",
    grantCount: 0,
    openAdmissionCount: 0,
    authorityGeneration: 1,
    revision: 1,
    cursor: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: null,
    configContractId: "punks://contracts/bot.config.empty@1",
    configDigest: "b".repeat(64),
  },
  delta: {
    operation: "installed",
    configContractId: "punks://contracts/bot.config.empty@1",
    configDigest: "b".repeat(64),
  },
});

const event = {
  id: "c".repeat(64),
  pubkey: "d".repeat(64),
  created_at: 1_787_307_200,
  kind: 50310,
  tags: [
    ["workspace", workspaceId],
    ["installation", installationId],
    ["bot", botId],
    ["cursor", "1"],
    ["command", commandId],
    ["contract", "bot-installation.install@1"],
    ["actor", "punk", punkId],
    ["attestation", "staging-v1"],
  ],
  content,
  sig: "e".repeat(128),
} as const;

const committedArchive = {
  schemaVersion: 1,
  aggregate: "bot-installation",
  installationId,
  commandId,
  payloadHash,
  terminal: { kind: "committed", value: { state, event } },
} as const;

const rejectedArchive = {
  schemaVersion: 1,
  aggregate: "bot-installation",
  installationId,
  commandId,
  payloadHash,
  terminal: { kind: "rejected", code: "forbidden" },
} as const;

const contract =
  "punks://contracts/bot-installation.command-receipt-archive@1" as never;

describe("Bot Installation command receipt archive JSON contract", () => {
  it("registers strict bounded committed and rejected receipts", () => {
    expect(Object.keys(contractSchemas)).toContain(
      "punks://contracts/bot-installation.command-receipt-archive@1",
    );
    expect(validateContract(contract, committedArchive)).toEqual({
      valid: true,
    });
    expect(validateContract(contract, rejectedArchive)).toEqual({
      valid: true,
    });
    expect(
      validateContract(contract, {
        ...committedArchive,
        terminal: {
          ...committedArchive.terminal,
          value: {
            ...committedArchive.terminal.value,
            state: { ...state, runtimeRelease },
          },
        },
      }),
    ).toEqual({ valid: true });
  });

  it("pins the only archived config to the public empty v1 contract", () => {
    const withSecretConfig = {
      ...committedArchive,
      terminal: {
        ...committedArchive.terminal,
        value: {
          ...committedArchive.terminal.value,
          state: {
            ...state,
            config: {
              ...state.config,
              value: { apiKey: "must-not-enter-r2" },
            },
          },
        },
      },
    };
    expect(validateContract(contract, withSecretConfig).valid).toBe(false);
    expect(
      validateContract(contract, {
        ...committedArchive,
        terminal: {
          ...committedArchive.terminal,
          value: {
            ...committedArchive.terminal.value,
            state: {
              ...state,
              runtimeRelease: { ...runtimeRelease, model: "must-not-enter-r2" },
            },
          },
        },
      }).valid,
    ).toBe(false);
  });

  it("rejects commands, credentials, payloads, malformed terminal data and unbounded events", () => {
    const cases = [
      { ...committedArchive, aggregate: "bot" },
      { ...committedArchive, payloadHash: "a".repeat(63) },
      { ...committedArchive, commandJson: "{}" },
      { ...committedArchive, command: { contract: "install" } },
      { ...committedArchive, credential: "must-not-enter-r2" },
      { ...committedArchive, payload: { grant: "must-not-enter-r2" } },
      {
        ...committedArchive,
        terminal: { ...committedArchive.terminal, unexpected: true },
      },
      {
        ...committedArchive,
        terminal: {
          ...committedArchive.terminal,
          value: {
            ...committedArchive.terminal.value,
            event: { ...event, content: "é".repeat(65_537) },
          },
        },
      },
      {
        ...rejectedArchive,
        terminal: { kind: "rejected", code: "internal" },
      },
      {
        ...rejectedArchive,
        terminal: {
          kind: "rejected",
          code: "forbidden",
          cause: "must-not-enter-r2",
        },
      },
    ];
    for (const candidate of cases) {
      expect(validateContract(contract, candidate).valid).toBe(false);
    }
  });
});
