import type {
  BotInvocationClaims,
  MintBotInvocationCredentialCommand,
  VerifyBotInvocationCredentialQuery,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  BOT_INVOCATION_AUDIENCE,
  BOT_INVOCATION_MAX_CREDENTIAL_BYTES,
  BOT_INVOCATION_TTL_SECONDS,
  canonicalJson,
  mintBotInvocationCredential,
  verifyBotInvocationCredential,
  type BotInvocationKeyConfig,
} from "../src";

const currentSecret = "current-secret-material-is-at-least-32-bytes";
const previousSecret = "previous-secret-material-is-also-32-bytes";
const now = 1_787_310_000;
const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "a0000000-0000-8000-8000-000000000003";
const invocationId = "40000000-0000-8000-8000-000000000004";

const mintCommand: MintBotInvocationCredentialCommand = {
  contract: "bot-invocation.mint@1",
  invocationId,
  workspaceId,
  installationId,
  botId,
  authorityGeneration: 9,
};

const keyConfig: BotInvocationKeyConfig = {
  environment: "staging",
  currentKid: "staging-v2",
  currentSecret,
  previousKid: "staging-v1",
  previousSecret,
};

function verificationQuery(
  credential: string,
): VerifyBotInvocationCredentialQuery {
  return {
    contract: "bot-invocation.verify@1",
    credential,
    invocationId,
    workspaceId,
    installationId,
    botId,
    authorityGeneration: 9,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function signedCredential(
  claims: BotInvocationClaims,
  secret = currentSecret,
  rawPayload = canonicalJson(claims),
): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(rawPayload));
  const authenticated = `pbi1.${claims.kid}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(authenticated),
    ),
  );
  return `${authenticated}.${toBase64Url(signature)}`;
}

async function minted(): Promise<{
  credential: string;
  principal: BotInvocationClaims;
}> {
  const result = await mintBotInvocationCredential(mintCommand, keyConfig, now);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("fixture mint failed");
  }
  return result;
}

describe("short Bot invocation credentials", () => {
  it("mints a fixed 60-second HMAC credential and verifies its exact binding", async () => {
    const first = await minted();
    const second = await minted();

    expect(first.credential).toMatch(
      /^pbi1\.staging-v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u,
    );
    expect(first.credential).not.toBe(second.credential);
    expect(first.principal).toMatchObject({
      schemaVersion: 1,
      environment: "staging",
      audience: BOT_INVOCATION_AUDIENCE,
      kid: "staging-v2",
      invocationId,
      workspaceId,
      installationId,
      botId,
      authorityGeneration: 9,
      issuedAt: now,
      notBefore: now,
      expiresAt: now + BOT_INVOCATION_TTL_SECONDS,
    });
    expect(first.principal.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(
      await verifyBotInvocationCredential(
        verificationQuery(first.credential),
        keyConfig,
        now,
      ),
    ).toEqual({ ok: true, principal: first.principal });

    const production = await mintBotInvocationCredential(
      mintCommand,
      { ...keyConfig, environment: "production" },
      now,
    );
    expect(production).toMatchObject({
      ok: true,
      principal: { environment: "production" },
    });
  });

  it("rejects payload and signature tampering", async () => {
    const { credential } = await minted();
    const parts = credential.split(".");
    const payload = parts[2] ?? "";
    const signature = parts[3] ?? "";
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    for (const tampered of [
      `pbi1.staging-v2.${tamperedPayload}.${signature}`,
      `pbi1.staging-v2.${payload}.${tamperedSignature}`,
    ]) {
      await expect(
        verifyBotInvocationCredential(
          verificationQuery(tampered),
          keyConfig,
          now,
        ),
      ).resolves.toEqual({ ok: false, code: "invalid_credential" });
    }
  });

  it("rejects expired, not-yet-valid, and overlong lifetimes", async () => {
    const { principal } = await minted();
    const expired = await signedCredential({
      ...principal,
      issuedAt: now - BOT_INVOCATION_TTL_SECONDS,
      notBefore: now - BOT_INVOCATION_TTL_SECONDS,
      expiresAt: now,
    });
    const future = await signedCredential({
      ...principal,
      issuedAt: now + 1,
      notBefore: now + 1,
      expiresAt: now + 60,
    });
    const overlong = await signedCredential({
      ...principal,
      expiresAt: now + BOT_INVOCATION_TTL_SECONDS + 1,
    });

    await expect(
      verifyBotInvocationCredential(verificationQuery(expired), keyConfig, now),
    ).resolves.toEqual({ ok: false, code: "expired" });
    await expect(
      verifyBotInvocationCredential(verificationQuery(future), keyConfig, now),
    ).resolves.toEqual({ ok: false, code: "not_yet_valid" });
    await expect(
      verifyBotInvocationCredential(
        verificationQuery(overlong),
        keyConfig,
        now,
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_credential" });
  });

  it("rejects wrong audience, environment, kid, ids, and authority generation", async () => {
    const { credential, principal } = await minted();
    const wrongAudience = await signedCredential({
      ...principal,
      audience: "another-service" as "punks-bot-action",
    });
    const wrongEnvironment = await signedCredential({
      ...principal,
      environment: "local",
    });
    const unknownKid = await signedCredential(
      { ...principal, kid: "staging-v3" },
      currentSecret,
    );

    for (const wrong of [wrongAudience, wrongEnvironment, unknownKid]) {
      await expect(
        verifyBotInvocationCredential(verificationQuery(wrong), keyConfig, now),
      ).resolves.toEqual({ ok: false, code: "invalid_credential" });
    }

    for (const query of [
      {
        ...verificationQuery(credential),
        invocationId: "50000000-0000-8000-8000-000000000005",
      },
      {
        ...verificationQuery(credential),
        workspaceId: "50000000-0000-8000-8000-000000000005",
      },
      {
        ...verificationQuery(credential),
        installationId: "50000000-0000-8000-8000-000000000005",
      },
      {
        ...verificationQuery(credential),
        botId: "50000000-0000-8000-8000-000000000005",
      },
      { ...verificationQuery(credential), authorityGeneration: 10 },
    ]) {
      await expect(
        verifyBotInvocationCredential(query, keyConfig, now),
      ).resolves.toEqual({ ok: false, code: "invalid_credential" });
    }
  });

  it("accepts the previous key during rotation but never mints with it", async () => {
    const { principal } = await minted();
    const previousCredential = await signedCredential(
      { ...principal, kid: "staging-v1" },
      previousSecret,
    );
    await expect(
      verifyBotInvocationCredential(
        verificationQuery(previousCredential),
        keyConfig,
        now,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects oversized and non-canonical credentials before accepting claims", async () => {
    expect(BOT_INVOCATION_MAX_CREDENTIAL_BYTES).toBe(2_048);
    await expect(
      verifyBotInvocationCredential(
        verificationQuery("x".repeat(BOT_INVOCATION_MAX_CREDENTIAL_BYTES + 1)),
        keyConfig,
        now,
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });

    const { principal } = await minted();
    const paddedPayload = await signedCredential(
      principal,
      currentSecret,
      ` ${JSON.stringify(principal)}`,
    );
    await expect(
      verifyBotInvocationCredential(
        verificationQuery(paddedPayload),
        keyConfig,
        now,
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_credential" });

    const canonical = await signedCredential(principal);
    const parts = canonical.split(".");
    await expect(
      verifyBotInvocationCredential(
        verificationQuery(`${parts[0]}.${parts[1]}.${parts[2]}=.${parts[3]}`),
        keyConfig,
        now,
      ),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it("fails closed for missing, short, paired, or identical rotation keys", async () => {
    const invalidConfigs: BotInvocationKeyConfig[] = [
      { environment: "staging", currentKid: "v2" },
      { environment: "staging", currentSecret },
      { environment: "staging", currentKid: "v2", currentSecret: "short" },
      {
        environment: "staging",
        currentKid: "v2",
        currentSecret,
        previousKid: "v1",
      },
      {
        environment: "staging",
        currentKid: "v2",
        currentSecret,
        previousSecret,
      },
      {
        environment: "staging",
        currentKid: "v2",
        currentSecret,
        previousKid: "v2",
        previousSecret,
      },
      {
        environment: "staging",
        currentKid: "v2",
        currentSecret,
        previousKid: "v1",
        previousSecret: currentSecret,
      },
      {
        environment: "development",
        currentKid: "v2",
        currentSecret,
      },
    ];

    const { credential } = await minted();
    for (const invalidConfig of invalidConfigs) {
      await expect(
        mintBotInvocationCredential(mintCommand, invalidConfig, now),
      ).resolves.toEqual({ ok: false, code: "configuration_invalid" });
      await expect(
        verifyBotInvocationCredential(
          verificationQuery(credential),
          invalidConfig,
          now,
        ),
      ).resolves.toEqual({ ok: false, code: "configuration_invalid" });
    }
  });

  it("rejects authorization payloads and non-canonical coordinates", async () => {
    for (const invalid of [
      { ...mintCommand, capability: "messages.react" },
      { ...mintCommand, resource: { kind: "workspace", workspaceId } },
      { ...mintCommand, action: "message.reaction-add@1" },
      { ...mintCommand, payload: {} },
      { ...mintCommand, botId: botId.toUpperCase() },
      { ...mintCommand, authorityGeneration: 0 },
    ]) {
      await expect(
        mintBotInvocationCredential(invalid, keyConfig, now),
      ).resolves.toEqual({ ok: false, code: "invalid_request" });
    }
  });
});
