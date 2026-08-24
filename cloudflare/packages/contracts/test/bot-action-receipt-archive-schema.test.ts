import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "30000000-0000-8000-8000-000000000003";
const actionId = "40000000-0000-8000-8000-000000000004";
const admissionId = "50000000-0000-8000-8000-000000000005";
const conversationId = "60000000-0000-8000-8000-000000000006";
const messageId = "70000000-0000-8000-8000-000000000007";
const actionDigest = "a".repeat(64);

const terminalAdmission = {
  id: admissionId,
  actionId,
  actionDigest,
  workspaceId,
  installationId,
  botId,
  actionContract: "message.reaction-toggle@1",
  capability: "messages.react",
  risk: "routine",
  resource: { kind: "message", conversationId, messageId },
  status: "completed",
  outcome: "succeeded",
  installationCursor: 8,
  authorityGeneration: 2,
  admittedCursor: 8,
  completedCursor: 9,
  admittedAt: "2026-08-21T10:00:00.000Z",
  completedAt: "2026-08-21T10:00:01.000Z",
} as const;

function proof(kind: 50320 | 50321, id: string) {
  return {
    id: id.repeat(64),
    pubkey: "b".repeat(64),
    created_at: 1_787_307_200,
    kind,
    tags: [["attestation", "staging-v1"]],
    content: "{}",
    sig: "c".repeat(128),
  };
}

const archive = {
  schemaVersion: 1,
  terminalAdmission,
  admissionProof50320: proof(50320, "d"),
  completionProof50321: proof(50321, "e"),
};

const contract = "punks://contracts/bot-action.receipt-archive@1" as never;

describe("Bot action terminal receipt archive JSON contract", () => {
  it("registers one strict, bounded terminal archive", () => {
    expect(Object.keys(contractSchemas)).toContain(
      "punks://contracts/bot-action.receipt-archive@1",
    );
    expect(validateContract(contract, archive)).toEqual({ valid: true });
  });

  it("rejects non-terminal receipts, wrong proof kinds and secret-bearing fields", () => {
    const cases = [
      {
        ...archive,
        terminalAdmission: {
          ...terminalAdmission,
          status: "admitted",
          outcome: null,
          completedCursor: null,
          completedAt: null,
        },
      },
      { ...archive, admissionProof50320: proof(50321, "d") },
      { ...archive, completionProof50321: proof(50320, "e") },
      { ...archive, credential: "pbi1.must-never-be-archived" },
      { ...archive, jti: actionId },
      { ...archive, payload: { reaction: "🔥" } },
      { ...archive, config: {} },
      {
        ...archive,
        admissionProof50320: {
          ...archive.admissionProof50320,
          tags: Array.from({ length: 33 }, () => ["bounded"]),
        },
      },
      {
        ...archive,
        completionProof50321: {
          ...archive.completionProof50321,
          content: "x".repeat(8_193),
        },
      },
    ];
    for (const candidate of cases) {
      expect(validateContract(contract, candidate).valid).toBe(false);
    }
  });
});
