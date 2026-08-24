import type { AuthSession, Punk } from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";

import { localDevSessionCookie, sessionCookie, sessionToken } from "./cookies";
import { randomToken } from "./crypto";
import type { AuthEnv } from "./env";
import type { SessionRecord } from "./rpc";

export interface ActiveSession {
  token: string;
  stub: DurableObjectStub<import("./session-do").SessionDO>;
  record: SessionRecord;
  punk: Punk;
}

export function sameOrigin(request: Request, env: AuthEnv): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(env.AUTH_BASE_URL).origin;
  } catch {
    return false;
  }
}

export function configuredTtl(env: AuthEnv): number {
  const value = Number.parseInt(env.SESSION_TTL_SECONDS, 10);
  return Number.isSafeInteger(value) && value >= 300 && value <= 2_592_000
    ? value
    : 2_592_000;
}

export function canonicalPunk(value: unknown): Punk {
  if (!validateContract("punks://contracts/punk@1", value).valid) {
    throw new Error("Punk state violated its canonical contract");
  }
  return value as Punk;
}

export async function aggregateName(
  domain:
    | "identity"
    | "email"
    | "transaction"
    | "session"
    | "passkey-credential"
    | "desktop-delivery",
  value: string,
): Promise<string> {
  return deriveOpaqueUuid(`punks.auth.${domain}.v1`, value);
}

export async function getActiveSession(
  request: Request,
  env: AuthEnv,
): Promise<ActiveSession | null> {
  const token = sessionToken(request, env);
  if (token === null || token.length < 32 || token.length > 256) {
    return null;
  }
  const objectName = await aggregateName("session", token);
  const stub = env.SESSIONS.getByName(objectName);
  const record = await stub.get();
  if (record === null || record.sessionId !== objectName) {
    return null;
  }
  const punkResult = await env.PUNKS.getByName(record.punkId).query();
  if (!punkResult.ok) {
    return null;
  }
  return { token, stub, record, punk: canonicalPunk(punkResult.state) };
}

export async function newSession(
  env: AuthEnv,
  punk: Punk,
  clientKind: "browser" | "desktop" | "mobile" | "api" = "browser",
): Promise<{ value: AuthSession; cookie: string; token: string }> {
  return ensureSessionForToken(env, punk, randomToken(32), "host", clientKind);
}

export async function ensureSessionForToken(
  env: AuthEnv,
  punk: Punk,
  token: string,
  cookieMode: "host" | "local-dev" = "host",
  clientKind: "browser" | "desktop" | "mobile" | "api" = "browser",
): Promise<{ value: AuthSession; cookie: string; token: string }> {
  const sessionId = await aggregateName("session", token);
  const ttl = configuredTtl(env);
  const stub = env.SESSIONS.getByName(sessionId);
  let record: SessionRecord | null = await stub.get();
  if (record === null) {
    const now = new Date();
    const candidate: SessionRecord = {
      sessionId,
      punkId: punk.id,
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1_000).toISOString(),
      recentReauthUntil: null,
    };
    if (!(await stub.create(candidate, clientKind))) {
      throw new Error("Session identifier collision");
    }
    record = candidate;
  }
  if (record.sessionId !== sessionId || record.punkId !== punk.id) {
    throw new Error("Session identifier belongs to another Punk");
  }
  const value: AuthSession = {
    ...record,
    punk: {
      id: punk.id,
      displayName: punk.displayName,
      avatarUrl: punk.avatarUrl,
    },
  };
  if (!validateContract("punks://contracts/auth.session@1", value).valid) {
    throw new Error("Session violated its canonical contract");
  }
  const remainingTtl = Math.max(
    1,
    Math.min(
      ttl,
      Math.floor((Date.parse(record.expiresAt) - Date.now()) / 1_000),
    ),
  );
  return {
    value,
    cookie:
      cookieMode === "local-dev"
        ? localDevSessionCookie(token, remainingTtl)
        : sessionCookie(token, remainingTtl),
    token,
  };
}
