import type {
  MintBotInvocationCredentialResult,
  VerifyBotInvocationCredentialResult,
} from "@punks/contracts";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  AccountMergePlanningService,
  BotInvocationIssuer,
  BotInvocationVerifier,
  PunkSessionService,
} from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "a0000000-0000-8000-8000-000000000003";
const invocationId = "40000000-0000-8000-8000-000000000004";

const mintCommand = {
  contract: "bot-invocation.mint@1",
  invocationId,
  workspaceId,
  installationId,
  botId,
  authorityGeneration: 4,
} as const;

function issuer(props: unknown) {
  type IssuerRpc = {
    fetch(request: Request): Promise<Response>;
    mintBotInvocation(
      input: unknown,
    ): Promise<MintBotInvocationCredentialResult>;
  };
  const factory = workerExports.BotInvocationIssuer as (options: {
    props: unknown;
  }) => IssuerRpc;
  return factory({ props });
}

describe("role-separated private Auth RPC entrypoints", () => {
  it("mints only for the exact Punks Bot Runtime props and verifies separately", async () => {
    const minted = (await issuer({
      role: "punks-bot-runtime",
      environment: "local",
    }).mintBotInvocation(mintCommand)) as MintBotInvocationCredentialResult;
    expect(minted).toMatchObject({
      ok: true,
      principal: {
        environment: "local",
        invocationId,
        workspaceId,
        installationId,
        botId,
        authorityGeneration: 4,
      },
    });
    if (!minted.ok) {
      throw new Error("private mint fixture failed");
    }

    const verified =
      (await workerExports.BotInvocationVerifier.verifyBotInvocation({
        contract: "bot-invocation.verify@1",
        credential: minted.credential,
        invocationId,
        workspaceId,
        installationId,
        botId,
        authorityGeneration: 4,
      })) as VerifyBotInvocationCredentialResult;
    expect(verified).toEqual({ ok: true, principal: minted.principal });
  });

  it("fails closed for missing, malformed, extra or cross-environment issuer props", async () => {
    for (const props of [
      undefined,
      {},
      { role: "punks-bot-runtime" },
      { role: "api", environment: "local" },
      { role: "punks-bot-runtime", environment: "staging" },
      {
        role: "punks-bot-runtime",
        environment: "local",
        capability: "messages.react",
      },
    ]) {
      await expect(
        issuer(props).mintBotInvocation(mintCommand),
      ).resolves.toEqual({ ok: false, code: "invalid_request" });
    }
  });

  it("keeps session, issuer and verifier public method surfaces exactly disjoint", async () => {
    await expect(
      workerExports.PunkSessionService.resolveSessionId("not-an-id"),
    ).resolves.toBeNull();

    expect(
      Object.getOwnPropertyNames(PunkSessionService.prototype).sort(),
    ).toEqual(
      [
        "constructor",
        "fetch",
        "punkExists",
        "resolvePunkSummary",
        "resolveSessionCookie",
        "resolveSessionId",
      ].sort(),
    );
    expect(
      Object.getOwnPropertyNames(BotInvocationIssuer.prototype).sort(),
    ).toEqual(["constructor", "fetch", "mintBotInvocation"].sort());
    expect(
      Object.getOwnPropertyNames(BotInvocationVerifier.prototype).sort(),
    ).toEqual(["constructor", "fetch", "verifyBotInvocation"].sort());
    expect(
      Object.getOwnPropertyNames(AccountMergePlanningService.prototype).sort(),
    ).toEqual(
      [
        "constructor",
        "fetch",
        "prepareAccountMergePlan",
        "readAccountMergePlan",
        "recordAccountMergeFreshProof",
        "revokeAccountMergeFreshProof",
      ].sort(),
    );
  });

  it("returns 404 from every named capability entrypoint", async () => {
    const request = new Request("https://auth.punks.test/private");
    const responses = await Promise.all([
      workerExports.PunkSessionService.fetch(request),
      issuer({ role: "punks-bot-runtime", environment: "local" }).fetch(
        request,
      ),
      workerExports.BotInvocationVerifier.fetch(request),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("does not log credentials, props or secret material", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      await expect(
        issuer({
          role: "punks-bot-runtime",
          environment: "local",
        }).mintBotInvocation(mintCommand),
      ).resolves.toMatchObject({ ok: true });
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
