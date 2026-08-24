import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "30000000-0000-8000-8000-000000000003";
const conversationId = "40000000-0000-8000-8000-000000000004";
const messageId = "50000000-0000-8000-8000-000000000005";
const wakeId = "6aaaaaaa-0000-8000-8000-000000000006";
const turnId = "70000000-0000-8000-8000-000000000007";
const actionId = "80000000-0000-8000-8000-000000000008";
const admissionId = "90000000-0000-8000-8000-000000000009";
const digest = "a".repeat(64);

const offer = {
  contract: "bot-wake.offer@1",
  wakeId,
  workspaceId,
  installationId,
  botId,
  conversationId,
  messageId,
  messageCursor: 41,
  subscriptionEpoch: 7,
  runtimeRelease: {
    releaseId: "punks.reaction-turn.v1",
    releaseDigest: digest,
  },
  sourceEventId: "b".repeat(64),
  sourceEventDigest: "c".repeat(64),
  createdAt: "2026-08-21T10:00:00.000Z",
} as const;

const receipt = {
  schemaVersion: 1,
  offer,
  turnId,
  claimedAt: "2026-08-21T10:00:01.000Z",
  completedAt: "2026-08-21T10:00:02.000Z",
  terminal: {
    outcome: "succeeded",
    decision: "skip",
    reason: "model_selected_skip",
  },
} as const;

const contract = (suffix: string) =>
  `punks://contracts/bot-wake.${suffix}@1` as never;

describe("Bot Wake JSON contracts", () => {
  it("registers a strict authoritative offer and an opaque two-id Queue body", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot-wake.offer@1",
        "punks://contracts/bot-wake.queue@1",
      ]),
    );
    expect(validateContract(contract("offer"), offer)).toEqual({ valid: true });
    expect(
      validateContract(contract("queue"), { installationId, wakeId }),
    ).toEqual({ valid: true });

    for (const candidate of [
      { ...offer, plaintext: "never" },
      { ...offer, config: {} },
      { ...offer, capability: "messages.read-context" },
      { ...offer, runtimeRelease: { ...offer.runtimeRelease, model: "free" } },
      { ...offer, createdAt: "2026-08-21T12:00:00+02:00" },
      { ...offer, wakeId: wakeId.toUpperCase() },
      { installationId, wakeId, contract: "bot-wake.queue@1" },
      { installationId, wakeId, conversationId },
    ]) {
      const id = "messageCursor" in candidate ? "offer" : "queue";
      expect(validateContract(contract(id), candidate).valid).toBe(false);
    }
  });

  it("bounds claim and terminal transitions as closed discriminated unions", () => {
    expect(
      validateContract(contract("claim"), {
        contract: "bot-wake.claim@1",
        installationId,
        wakeId,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract(contract("claim-result"), {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "claimed",
        offer,
        turnId,
        claimedAt: "2026-08-21T10:00:01.000Z",
        replayed: false,
      }),
    ).toEqual({ valid: true });

    const completions = [
      {
        contract: "bot-wake.complete@1",
        installationId,
        wakeId,
        turnId,
        terminal: {
          outcome: "succeeded",
          decision: "skip",
          reason: "model_selected_skip",
        },
      },
      {
        contract: "bot-wake.complete@1",
        installationId,
        wakeId,
        turnId,
        terminal: {
          outcome: "succeeded",
          decision: "react",
          actionId,
          admissionId,
          actionDigest: digest,
        },
      },
      {
        contract: "bot-wake.complete@1",
        installationId,
        wakeId,
        turnId,
        terminal: { outcome: "failed", code: "model_timeout" },
      },
    ];
    for (const completion of completions) {
      expect(validateContract(contract("complete"), completion)).toEqual({
        valid: true,
      });
    }

    for (const candidate of [
      {
        contract: "bot-wake.claim@1",
        installationId,
        wakeId,
        conversationId,
      },
      {
        contract: "bot-wake.claim@1",
        installationId,
        wakeId,
        runtimeRelease: offer.runtimeRelease,
      },
      {
        ...completions[0],
        terminal: {
          outcome: "succeeded",
          decision: "skip",
          reason: "model_selected_skip",
          output: "text",
        },
      },
      {
        ...completions[1],
        terminal: { ...completions[1]?.terminal, reaction: "🔥" },
      },
      {
        ...completions[2],
        terminal: { outcome: "failed", code: "provider said secret" },
      },
    ]) {
      const id =
        candidate.contract?.endsWith("claim@1") === true ? "claim" : "complete";
      expect(validateContract(contract(id), candidate).valid).toBe(false);
    }
  });

  it("archives only terminal receipts and can replay a terminal claim result", () => {
    expect(validateContract(contract("receipt-archive"), receipt)).toEqual({
      valid: true,
    });
    expect(
      validateContract(contract("claim-result"), {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "terminal",
        receipt,
        replayed: true,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract(contract("claim-result"), {
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "authority_revoked",
      }),
    ).toEqual({ valid: true });

    for (const candidate of [
      { ...receipt, prompt: "never" },
      { ...receipt, credential: "never" },
      { ...receipt, claimedAt: "2026-08-21T12:00:01+02:00" },
      { ...receipt, terminal: { outcome: "succeeded" } },
      {
        ...receipt,
        terminal: { outcome: "failed", code: "model_timeout", error: "raw" },
      },
      {
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "authority_revoked",
        messageId,
      },
    ]) {
      const id = "contract" in candidate ? "claim-result" : "receipt-archive";
      expect(validateContract(contract(id), candidate).valid).toBe(false);
    }
  });
});
