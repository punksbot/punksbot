import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const workspaceId = "00000000-0000-8000-8000-000000000101";
const installationId = "a0000000-0000-8000-8000-000000000102";
const botId = "00000000-0000-8000-8000-000000000103";
const invocationId = "00000000-0000-8000-8000-000000000104";
const jti = "00000000-0000-8000-8000-000000000105";

const claims = {
  schemaVersion: 1,
  environment: "staging",
  audience: "punks-bot-action",
  kid: "staging-2026-08",
  jti,
  invocationId,
  workspaceId,
  installationId,
  botId,
  authorityGeneration: 7,
  issuedAt: 1_787_310_000,
  notBefore: 1_787_310_000,
  expiresAt: 1_787_310_060,
} as const;

describe("Bot invocation JSON contracts", () => {
  it("registers the five private invocation contracts", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot-invocation.claims@1",
        "punks://contracts/bot-invocation.mint@1",
        "punks://contracts/bot-invocation.mint-result@1",
        "punks://contracts/bot-invocation.verify@1",
        "punks://contracts/bot-invocation.verify-result@1",
      ]),
    );
  });

  it("accepts only the exact bounded invocation claims", () => {
    expect(
      validateContract("punks://contracts/bot-invocation.claims@1", claims),
    ).toEqual({ valid: true });

    for (const invalid of [
      { ...claims, capability: "messages.react" },
      { ...claims, resource: { kind: "workspace", workspaceId } },
      { ...claims, action: "message.reaction-add@1" },
      { ...claims, payload: { reaction: "+" } },
      { ...claims, audience: "another-service" },
      { ...claims, environment: "development" },
      { ...claims, authorityGeneration: 0 },
      { ...claims, authorityGeneration: 1.5 },
      { ...claims, workspaceId: "00000000-0000-4000-8000-000000000101" },
      { ...claims, installationId: installationId.toUpperCase() },
      { ...claims, botId: `${botId} ` },
    ]) {
      expect(
        validateContract("punks://contracts/bot-invocation.claims@1", invalid)
          .valid,
        JSON.stringify(invalid),
      ).toBe(false);
    }
    expect(
      validateContract("punks://contracts/bot-invocation.claims@1", {
        ...claims,
        environment: "production",
      }),
    ).toEqual({ valid: true });
  });

  it("keeps mint and verify inputs separate and authorization-free", () => {
    const mint = {
      contract: "bot-invocation.mint@1",
      invocationId,
      workspaceId,
      installationId,
      botId,
      authorityGeneration: 7,
    };
    expect(
      validateContract("punks://contracts/bot-invocation.mint@1", mint),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-invocation.mint@1", {
        ...mint,
        capability: "messages.react",
      }).valid,
    ).toBe(false);

    expect(
      validateContract("punks://contracts/bot-invocation.verify@1", {
        contract: "bot-invocation.verify@1",
        credential: `pbi1.staging-2026-08.${"a".repeat(32)}.${"b".repeat(43)}`,
        invocationId,
        workspaceId,
        installationId,
        botId,
        authorityGeneration: 7,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-invocation.verify@1", {
        contract: "bot-invocation.verify@1",
        credential: "x".repeat(2_049),
        invocationId,
        workspaceId,
        installationId,
        botId,
        authorityGeneration: 7,
      }).valid,
    ).toBe(false);
  });

  it("accepts only bounded success and failure results", () => {
    const credential = `pbi1.staging-2026-08.${"a".repeat(32)}.${"b".repeat(43)}`;
    expect(
      validateContract("punks://contracts/bot-invocation.mint-result@1", {
        ok: true,
        credential,
        principal: claims,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-invocation.verify-result@1", {
        ok: true,
        principal: claims,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-invocation.verify-result@1", {
        ok: false,
        code: "invalid_credential",
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/bot-invocation.verify-result@1", {
        ok: true,
        principal: claims,
        payload: {},
      }).valid,
    ).toBe(false);
  });
});
