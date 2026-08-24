import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const botId = "91000000-0000-4000-8000-000000000001";
const commandId = "91000000-0000-4000-8000-000000000002";
const punkId = "91000000-0000-4000-8000-000000000003";
const payloadHash = "a".repeat(64);
const timestamp = "2026-08-21T10:00:00.000Z";
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

const state = {
  id: botId,
  slug: "receipt-bot",
  name: "Receipt Bot",
  description: "Canonical Bot command receipt fixture",
  status: "published",
  configContractId: "punks://contracts/bot.config.empty@1",
  supportedActionContracts: ["message.reaction-toggle@1"],
  revision: 1,
  cursor: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  suspendedAt: null,
  withdrawnAt: null,
} as const;

const content = JSON.stringify({
  bot: state,
  delta: { operation: "published" },
  schemaVersion: 1,
});

const event = {
  id: "b".repeat(64),
  pubkey: "c".repeat(64),
  created_at: 1_787_307_200,
  kind: 50300,
  tags: [
    ["bot", botId],
    ["cursor", "1"],
    ["command", commandId],
    ["contract", "bot.publish@1"],
    ["actor", "punk", punkId],
    ["attestation", "staging-v1"],
  ],
  content,
  sig: "d".repeat(128),
} as const;

const archive = {
  schemaVersion: 1,
  aggregate: "bot",
  botId,
  commandId,
  payloadHash,
  terminal: {
    kind: "committed",
    value: { state, event, previousSlug: null },
  },
} as const;

const contract = "punks://contracts/bot.command-receipt-archive@1" as never;

describe("Bot command receipt archive JSON contract", () => {
  it("registers one strict bounded committed receipt", () => {
    expect(Object.keys(contractSchemas)).toContain(
      "punks://contracts/bot.command-receipt-archive@1",
    );
    expect(validateContract(contract, archive)).toEqual({ valid: true });
    expect(
      validateContract(contract, {
        ...archive,
        terminal: {
          ...archive.terminal,
          value: {
            ...archive.terminal.value,
            state: { ...state, runtimeRelease },
          },
        },
      }),
    ).toEqual({ valid: true });
  });

  it("rejects non-terminal, secret-bearing, command-bearing and unbounded receipts", () => {
    const cases = [
      { ...archive, aggregate: "bot-installation" },
      { ...archive, payloadHash: "a".repeat(63) },
      { ...archive, commandJson: "{}" },
      { ...archive, command: { contract: "bot.publish@1" } },
      { ...archive, credential: "must-not-be-archived" },
      { ...archive, payload: { description: "must-not-be-archived" } },
      { ...archive, config: {} },
      {
        ...archive,
        terminal: { ...archive.terminal, kind: "rejected" },
      },
      {
        ...archive,
        terminal: {
          ...archive.terminal,
          value: { ...archive.terminal.value, unexpected: true },
        },
      },
      {
        ...archive,
        terminal: {
          ...archive.terminal,
          value: {
            ...archive.terminal.value,
            state: {
              ...state,
              runtimeRelease: { ...runtimeRelease, provider: "workers-ai" },
            },
          },
        },
      },
      {
        ...archive,
        terminal: {
          ...archive.terminal,
          value: {
            ...archive.terminal.value,
            event: { ...event, content: "x".repeat(65_537) },
          },
        },
      },
    ];
    for (const candidate of cases) {
      expect(validateContract(contract, candidate).valid).toBe(false);
    }
  });
});
