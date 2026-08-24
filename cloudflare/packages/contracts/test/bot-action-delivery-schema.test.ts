import { describe, expect, it } from "vitest";

import type { DeliverBotActionCommand } from "../src";
import { contractSchemas, validateContract } from "../src";

const uuid = (prefix: string) => `${prefix}0000000-0000-8000-8000-000000000001`;

const proof: DeliverBotActionCommand["proof"] = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1_800_000_000,
  kind: 50320,
  tags: [
    ["workspace", uuid("1")],
    ["installation", uuid("2")],
    ["bot", uuid("3")],
    ["cursor", "8"],
    ["command", uuid("8")],
    ["contract", "bot-action.admit@1"],
    ["actor", "bot", uuid("2")],
    ["admission", uuid("5")],
    ["action", uuid("4"), "d".repeat(64)],
    ["action_contract", "message.reaction-toggle@1"],
    ["capability", "messages.react"],
    ["conversation", uuid("6")],
    ["message", uuid("7")],
    ["attestation", "local-v1"],
  ],
  content: "{}",
  sig: "c".repeat(128),
};

const delivery: DeliverBotActionCommand = {
  contract: "bot-action.delivery@1",
  workspaceId: uuid("1"),
  installationId: uuid("2"),
  botId: uuid("3"),
  actionId: uuid("4"),
  admissionId: uuid("5"),
  actionDigest: "d".repeat(64),
  authorityGeneration: 7,
  proof,
  action: {
    contract: "message.reaction-toggle@1",
    conversationId: uuid("6"),
    messageId: uuid("7"),
    payload: { reaction: `:${"x".repeat(64)}:` },
  },
  reactionCommandId: uuid("8"),
  completionCommandId: uuid("9"),
  failureCompletionCommandId: uuid("a"),
};

describe("private Bot action delivery contracts", () => {
  it("registers the exact delivery request and result contracts", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot-action.delivery@1",
        "punks://contracts/bot-action.delivery-result@1",
      ]),
    );
  });

  it("accepts the bounded delivery and the canonical 66-character shortcode", () => {
    expect(
      validateContract("punks://contracts/bot-action.delivery@1", delivery),
    ).toEqual({ valid: true });

    const proofKind: 50320 = delivery.proof.kind;
    const proofContent: string = delivery.proof.content;
    const proofTags: [string, ...string[]][] = delivery.proof.tags;
    expect({ proofKind, proofContent, proofTags }).toEqual({
      proofKind: 50320,
      proofContent: "{}",
      proofTags: proof.tags,
    });
  });

  it("requires canonical v8 identifiers, generation, digest, and proof kind", () => {
    for (const invalid of [
      { ...delivery, actionId: "40000000-0000-4000-8000-000000000001" },
      {
        ...delivery,
        failureCompletionCommandId:
          delivery.failureCompletionCommandId.toUpperCase(),
      },
      { ...delivery, actionDigest: "D".repeat(64) },
      { ...delivery, authorityGeneration: 0 },
      { ...delivery, proof: { ...proof, kind: 50321 } },
      { ...delivery, proof: { ...proof, content: "x".repeat(8193) } },
      { ...delivery, proof: { ...proof, tags: Array(33).fill(["x"]) } },
      {
        ...delivery,
        action: {
          ...delivery.action,
          messageId: "70000000-0000-4000-8000-000000000001",
        },
      },
      {
        ...delivery,
        action: {
          ...delivery.action,
          payload: { reaction: `:${"x".repeat(65)}:` },
        },
      },
    ]) {
      expect(
        validateContract("punks://contracts/bot-action.delivery@1", invalid)
          .valid,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });

  it("never transports credentials or caller-supplied authority", () => {
    for (const forbidden of [
      "credential",
      "jti",
      "capability",
      "grant",
      "config",
    ]) {
      expect(
        validateContract("punks://contracts/bot-action.delivery@1", {
          ...delivery,
          [forbidden]: "must-not-cross-the-boundary",
        }).valid,
        forbidden,
      ).toBe(false);
    }
  });

  it("bounds the target result to replay success or enumerated failures", () => {
    for (const valid of [
      {
        contract: "bot-action.delivery-result@1",
        ok: true,
        replayed: false,
      },
      {
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "command_in_progress",
      },
      {
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "temporarily_unavailable",
      },
    ]) {
      expect(
        validateContract(
          "punks://contracts/bot-action.delivery-result@1",
          valid,
        ),
      ).toEqual({ valid: true });
    }
    for (const invalid of [
      {
        contract: "bot-action.delivery-result@1",
        ok: true,
        replayed: false,
        credential: "leak",
      },
      {
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "invalid_credential",
      },
      {
        contract: "bot-action.delivery-result@1",
        ok: false,
        code: "unexpected",
      },
      { ok: true, replayed: false },
    ]) {
      expect(
        validateContract(
          "punks://contracts/bot-action.delivery-result@1",
          invalid,
        ).valid,
      ).toBe(false);
    }
  });
});
