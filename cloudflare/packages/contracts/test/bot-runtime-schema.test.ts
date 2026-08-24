import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "a0000000-0000-8000-8000-000000000003";
const invocationId = "40000000-0000-8000-8000-000000000004";
const actionId = "50000000-0000-8000-8000-000000000005";
const admissionId = "60000000-0000-8000-8000-000000000006";

const invocation = {
  contract: "bot-runtime.reaction-invoke@1",
  workspaceId,
  installationId,
  botId,
  actionId,
  authorityGeneration: 4,
  action: {
    contract: "message.reaction-add@1",
    conversationId: "70000000-0000-8000-8000-000000000007",
    messageId: "80000000-0000-8000-8000-000000000008",
    payload: { reaction: "+" },
  },
} as const;

describe("private Bot Runtime Reaction contracts", () => {
  it("registers exact invoke and result contracts", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot-action.execute@1",
        "punks://contracts/bot-action.execute-result@1",
        "punks://contracts/bot-runtime.reaction-invoke@1",
        "punks://contracts/bot-runtime.reaction-result@1",
      ]),
    );
  });

  it("binds the runtime credential and fresh invocation to one stable action", () => {
    const execute = {
      contract: "bot-action.execute@1",
      credential: `pbi1.local-v1.${"a".repeat(32)}.${"b".repeat(43)}`,
      invocationId,
      actionId,
      workspaceId,
      installationId,
      botId,
      authorityGeneration: 4,
      action: invocation.action,
    };
    expect(
      validateContract("punks://contracts/bot-action.execute@1", execute),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-action.execute@1", {
        ...execute,
        capability: "messages.react",
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/bot-action.execute-result@1", {
        ok: true,
        admissionId,
        replayed: false,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts an exact Reaction invocation without caller-supplied authority", () => {
    expect(
      validateContract(
        "punks://contracts/bot-runtime.reaction-invoke@1",
        invocation,
      ),
    ).toEqual({ valid: true });

    for (const invalid of [
      { ...invocation, capability: "messages.react" },
      { ...invocation, credential: "caller-controlled" },
      { ...invocation, invocationId },
      { ...invocation, authorityGeneration: 0 },
      { ...invocation, botId: botId.toUpperCase() },
      {
        ...invocation,
        action: { ...invocation.action, commandId: actionId },
      },
      {
        ...invocation,
        action: { ...invocation.action, payload: { reaction: "+", env: {} } },
      },
    ]) {
      expect(
        validateContract(
          "punks://contracts/bot-runtime.reaction-invoke@1",
          invalid,
        ).valid,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });

  it("bounds success and failure results without exposing credentials", () => {
    const success = {
      contract: "bot-runtime.reaction-result@1",
      ok: true,
      invocationId,
      actionId,
      admissionId,
      replayed: false,
    };
    expect(
      validateContract(
        "punks://contracts/bot-runtime.reaction-result@1",
        success,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-runtime.reaction-result@1", {
        ...success,
        credential: "must-not-leak",
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/bot-runtime.reaction-result@1", {
        contract: "bot-runtime.reaction-result@1",
        ok: false,
        code: "credential_unavailable",
      }),
    ).toEqual({ valid: true });
  });
});
