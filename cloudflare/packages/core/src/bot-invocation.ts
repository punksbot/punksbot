import {
  type BotInvocationClaims,
  type MintBotInvocationCredentialResult,
  type VerifyBotInvocationCredentialResult,
  validateContract,
} from "@punks/contracts";

import { canonicalJson, deriveOpaqueUuid } from "./json";

export const BOT_INVOCATION_AUDIENCE = "punks-bot-action" as const;
export const BOT_INVOCATION_TTL_SECONDS = 60;
export const BOT_INVOCATION_MAX_CREDENTIAL_BYTES = 2_048;

const CREDENTIAL_VERSION = "pbi1";
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4_096;
const HMAC_BYTES = 32;
const kidPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export interface BotInvocationKeyConfig {
  environment?: string;
  currentKid?: string;
  currentSecret?: string;
  previousKid?: string;
  previousSecret?: string;
}

interface ValidBotInvocationKey {
  kid: string;
  secret: Uint8Array;
}

interface ValidBotInvocationKeyring {
  environment: "local" | "staging" | "production";
  current: ValidBotInvocationKey;
  previous?: ValidBotInvocationKey;
}

function isValidSecret(secret: unknown): secret is string {
  if (typeof secret !== "string") {
    return false;
  }
  const byteLength = new TextEncoder().encode(secret).byteLength;
  return byteLength >= MIN_SECRET_BYTES && byteLength <= MAX_SECRET_BYTES;
}

function readKeyConfig(
  config: BotInvocationKeyConfig,
): ValidBotInvocationKeyring | null {
  if (
    (config.environment !== "local" &&
      config.environment !== "staging" &&
      config.environment !== "production") ||
    typeof config.currentKid !== "string" ||
    !kidPattern.test(config.currentKid) ||
    !isValidSecret(config.currentSecret)
  ) {
    return null;
  }

  const hasPreviousKid = config.previousKid !== undefined;
  const hasPreviousSecret = config.previousSecret !== undefined;
  if (hasPreviousKid !== hasPreviousSecret) {
    return null;
  }

  let previous: ValidBotInvocationKey | undefined;
  if (hasPreviousKid && hasPreviousSecret) {
    if (
      typeof config.previousKid !== "string" ||
      !kidPattern.test(config.previousKid) ||
      !isValidSecret(config.previousSecret) ||
      config.previousKid === config.currentKid ||
      config.previousSecret === config.currentSecret
    ) {
      return null;
    }
    previous = {
      kid: config.previousKid,
      secret: new TextEncoder().encode(config.previousSecret),
    };
  }

  return {
    environment: config.environment,
    current: {
      kid: config.currentKid,
      secret: new TextEncoder().encode(config.currentSecret),
    },
    ...(previous === undefined ? {} : { previous }),
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

function fromCanonicalBase64Url(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (padded.length % 4)) % 4;
  try {
    const binary = atob(`${padded}${"=".repeat(paddingLength)}`);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return toBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importHmacKey(
  secret: Uint8Array,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    copiedArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function sign(
  authenticated: string,
  key: ValidBotInvocationKey,
): Promise<Uint8Array> {
  const cryptoKey = await importHmacKey(key.secret, "sign");
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(authenticated),
    ),
  );
}

async function hasValidSignature(
  authenticated: string,
  signature: Uint8Array,
  key: ValidBotInvocationKey,
): Promise<boolean> {
  if (signature.byteLength !== HMAC_BYTES) {
    return false;
  }
  const cryptoKey = await importHmacKey(key.secret, "verify");
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    copiedArrayBuffer(signature),
    new TextEncoder().encode(authenticated),
  );
}

function validNow(nowSeconds: number): boolean {
  return (
    Number.isSafeInteger(nowSeconds) &&
    nowSeconds >= 0 &&
    nowSeconds <= Number.MAX_SAFE_INTEGER
  );
}

export async function mintBotInvocationCredential(
  input: unknown,
  config: BotInvocationKeyConfig,
  nowSeconds: number,
): Promise<MintBotInvocationCredentialResult> {
  if (
    !validNow(nowSeconds) ||
    !validateContract("punks://contracts/bot-invocation.mint@1", input).valid
  ) {
    return { ok: false, code: "invalid_request" };
  }
  const keyring = readKeyConfig(config);
  if (keyring === null) {
    return { ok: false, code: "configuration_invalid" };
  }

  const command = input as {
    invocationId: string;
    workspaceId: string;
    installationId: string;
    botId: string;
    authorityGeneration: number;
  };
  const principal: BotInvocationClaims = {
    schemaVersion: 1,
    environment: keyring.environment,
    audience: BOT_INVOCATION_AUDIENCE,
    kid: keyring.current.kid,
    jti: await deriveOpaqueUuid(
      "punks.bot-invocation-jti.v1",
      crypto.randomUUID(),
    ),
    invocationId: command.invocationId,
    workspaceId: command.workspaceId,
    installationId: command.installationId,
    botId: command.botId,
    authorityGeneration: command.authorityGeneration,
    issuedAt: nowSeconds,
    notBefore: nowSeconds,
    expiresAt: nowSeconds + BOT_INVOCATION_TTL_SECONDS,
  };
  const payload = toBase64Url(
    new TextEncoder().encode(canonicalJson(principal)),
  );
  const authenticated = `${CREDENTIAL_VERSION}.${keyring.current.kid}.${payload}`;
  try {
    const signature = await sign(authenticated, keyring.current);
    const credential = `${authenticated}.${toBase64Url(signature)}`;
    if (credential.length > BOT_INVOCATION_MAX_CREDENTIAL_BYTES) {
      return { ok: false, code: "configuration_invalid" };
    }
    return { ok: true, credential, principal };
  } catch {
    return { ok: false, code: "configuration_invalid" };
  }
}

export async function verifyBotInvocationCredential(
  input: unknown,
  config: BotInvocationKeyConfig,
  nowSeconds: number,
): Promise<VerifyBotInvocationCredentialResult> {
  if (
    !validNow(nowSeconds) ||
    typeof input !== "object" ||
    input === null ||
    !("credential" in input) ||
    typeof input.credential !== "string" ||
    input.credential.length > BOT_INVOCATION_MAX_CREDENTIAL_BYTES ||
    !validateContract("punks://contracts/bot-invocation.verify@1", input).valid
  ) {
    return { ok: false, code: "invalid_request" };
  }
  const keyring = readKeyConfig(config);
  if (keyring === null) {
    return { ok: false, code: "configuration_invalid" };
  }

  const query = input as {
    credential: string;
    invocationId: string;
    workspaceId: string;
    installationId: string;
    botId: string;
    authorityGeneration: number;
  };
  const parts = query.credential.split(".");
  if (parts.length !== 4) {
    return { ok: false, code: "invalid_credential" };
  }
  const [version, kid, encodedPayload, encodedSignature] = parts;
  if (
    version !== CREDENTIAL_VERSION ||
    kid === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !kidPattern.test(kid)
  ) {
    return { ok: false, code: "invalid_credential" };
  }
  const key =
    keyring.current.kid === kid
      ? keyring.current
      : keyring.previous?.kid === kid
        ? keyring.previous
        : null;
  if (key === null || key === undefined) {
    return { ok: false, code: "invalid_credential" };
  }

  const signature = fromCanonicalBase64Url(encodedSignature);
  if (signature === null) {
    return { ok: false, code: "invalid_credential" };
  }
  const authenticated = `${version}.${kid}.${encodedPayload}`;
  try {
    if (!(await hasValidSignature(authenticated, signature, key))) {
      return { ok: false, code: "invalid_credential" };
    }
  } catch {
    return { ok: false, code: "invalid_credential" };
  }

  const payload = fromCanonicalBase64Url(encodedPayload);
  if (payload === null) {
    return { ok: false, code: "invalid_credential" };
  }
  let decoded: string;
  let principal: unknown;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    principal = JSON.parse(decoded);
  } catch {
    return { ok: false, code: "invalid_credential" };
  }
  if (
    !validateContract("punks://contracts/bot-invocation.claims@1", principal)
      .valid ||
    canonicalJson(principal) !== decoded
  ) {
    return { ok: false, code: "invalid_credential" };
  }

  const claims = principal as BotInvocationClaims;
  if (
    claims.kid !== kid ||
    claims.environment !== keyring.environment ||
    claims.audience !== BOT_INVOCATION_AUDIENCE ||
    claims.invocationId !== query.invocationId ||
    claims.workspaceId !== query.workspaceId ||
    claims.installationId !== query.installationId ||
    claims.botId !== query.botId ||
    claims.authorityGeneration !== query.authorityGeneration ||
    claims.notBefore < claims.issuedAt ||
    claims.notBefore >= claims.expiresAt ||
    claims.expiresAt - claims.issuedAt > BOT_INVOCATION_TTL_SECONDS
  ) {
    return { ok: false, code: "invalid_credential" };
  }
  if (nowSeconds < claims.notBefore) {
    return { ok: false, code: "not_yet_valid" };
  }
  if (nowSeconds >= claims.expiresAt) {
    return { ok: false, code: "expired" };
  }
  return { ok: true, principal: claims };
}
