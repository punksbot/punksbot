import type {
  AuthProviderProfile,
  AuthSession,
  StartAuthCommand,
  StartAuthResponse,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";

import {
  clearOauthCookie,
  clearSessionCookie,
  oauthCookie,
  oauthCookieName,
  parseCookies,
  sessionToken,
} from "./cookies";
import { hash, pkceChallenge, randomToken } from "./crypto";
import { completeDesktopOAuth, failDesktopOAuth } from "./desktop-auth";
import { routeDesktopAuth } from "./desktop-auth-router";
import type { AuthEnv, AuthProvider } from "./env";
import { json, problem, readJson, redirect } from "./http";
import { routePasskeys } from "./passkeys";
import {
  authorizationUrl,
  exchangeProfile,
  type ProviderFetch,
} from "./provider";
import type { AuthTransaction, IdentityInput } from "./rpc";
import {
  aggregateName,
  canonicalPunk,
  getActiveSession,
  newSession,
  resolveActivePunk,
  sameOrigin,
  sameDesktopDistribution,
  type ActiveSession,
} from "./session";

function validProvider(value: string): value is AuthProvider {
  return value === "google" || value === "github";
}

function resultRedirect(
  env: AuthEnv,
  transaction: AuthTransaction,
  state: string,
  result: string,
  cookies: string[] = [],
): Response {
  const target = new URL(transaction.returnTo, env.AUTH_BASE_URL);
  if (target.origin !== new URL(env.AUTH_BASE_URL).origin) {
    throw new Error("Auth return path escaped the configured origin");
  }
  target.searchParams.set("auth", result);
  return redirect(target.toString(), [clearOauthCookie(state), ...cookies]);
}

async function startAuth(request: Request, env: AuthEnv): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin auth request is required");
  }
  let input: unknown;
  try {
    input = await readJson(request);
  } catch {
    return problem(400, "invalid_input", "Auth start body is invalid");
  }
  if (!validateContract("punks://contracts/auth.start@1", input).valid) {
    return problem(400, "invalid_input", "Auth start command is invalid");
  }
  const command = input as StartAuthCommand;
  const returnTarget = new URL(command.returnTo, env.AUTH_BASE_URL);
  if (
    command.returnTo.includes("\\") ||
    returnTarget.origin !== new URL(env.AUTH_BASE_URL).origin
  ) {
    return problem(400, "invalid_input", "Auth return path must stay on Punks");
  }
  let current: ActiveSession | null = null;
  if (command.intent !== "sign_in") {
    current = await getActiveSession(request, env);
    if (current === null) {
      return problem(
        401,
        "unauthenticated",
        "An active Punk session is required",
      );
    }
    if (
      command.intent === "link" &&
      (current.record.recentReauthUntil === null ||
        Date.parse(current.record.recentReauthUntil) <= Date.now())
    ) {
      return problem(
        403,
        "forbidden",
        "A recent reauthentication is required before linking an identity",
      );
    }
  }

  const state = randomToken(32);
  const browserBinding = randomToken(32);
  const codeVerifier = randomToken(64);
  const now = new Date();
  const transaction: AuthTransaction = {
    provider: command.provider,
    intent: command.intent,
    returnTo: command.returnTo,
    browserBindingHash: await hash(browserBinding),
    codeVerifier,
    currentPunkId: current?.record.punkId ?? null,
    currentSessionId: current?.record.sessionId ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
  const transactionName = await aggregateName("transaction", state);
  if (
    !(await env.AUTH_TRANSACTIONS.getByName(transactionName).create(
      transaction,
    ))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Auth transaction could not start",
    );
  }
  const body: StartAuthResponse = {
    authorizationUrl: authorizationUrl(env, command.provider, {
      state,
      challenge: await pkceChallenge(codeVerifier),
    }),
    expiresAt: transaction.expiresAt,
  };
  if (
    !validateContract("punks://contracts/auth.start-response@1", body).valid
  ) {
    return problem(500, "internal", "Auth response violated its contract");
  }
  return json(body, 201, {
    "set-cookie": oauthCookie(state, browserBinding, 600),
  });
}

async function identityInput(
  profile: AuthProviderProfile,
): Promise<IdentityInput> {
  return {
    profile,
    subjectHash: await hash(
      `punks.provider-subject.v1\n${profile.provider}\n${profile.subject}`,
    ),
    emailHash: await hash(
      `punks.verified-email.v1\n${profile.verifiedEmail.trim().toLowerCase()}`,
    ),
  };
}

async function signIn(
  env: AuthEnv,
  transaction: AuthTransaction,
  transactionId: string,
  state: string,
  identity: IdentityInput,
): Promise<Response> {
  const fail = (result: string): Response =>
    resultRedirect(env, transaction, state, result);

  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const identityClaim = env.IDENTITY_CLAIMS.getByName(identityName);
  const resolution = await identityClaim.resolve();
  if (resolution.status === "active") {
    const punk = await resolveActivePunk(env, resolution.punkId);
    if (punk === null) {
      return fail("temporarily_unavailable");
    }
    const session = await newSession(env, canonicalPunk(punk));
    return resultRedirect(env, transaction, state, "signed_in", [
      session.cookie,
    ]);
  }
  if (resolution.status === "pending") {
    return fail("temporarily_unavailable");
  }

  const punkId = await deriveOpaqueUuid(
    "punks.punk.v1",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const emailName = await aggregateName(
    "email",
    identity.profile.verifiedEmail.toLowerCase(),
  );
  const emailClaim = env.EMAIL_CLAIMS.getByName(emailName);
  const email = await emailClaim.claim({
    emailHash: identity.emailHash,
    punkId,
    transactionId,
    now: new Date().toISOString(),
  });
  if (!email.ok) {
    return fail("link_required");
  }
  const claim = await identityClaim.claim({
    provider: identity.profile.provider,
    subjectHash: identity.subjectHash,
    punkId,
    transactionId,
    now: new Date().toISOString(),
  });
  if (!claim.ok) {
    await emailClaim.release({ punkId, transactionId });
    return fail("link_required");
  }
  const punk = env.PUNKS.getByName(punkId);
  const provisioned = await punk.provision({
    punkId,
    identity,
    now: new Date().toISOString(),
  });
  if (!provisioned.ok) {
    await identityClaim.release({ punkId, transactionId });
    await emailClaim.release({ punkId, transactionId });
    return fail("temporarily_unavailable");
  }
  const identityActivated = await identityClaim.activate({
    punkId,
    transactionId,
  });
  const emailActivated = await emailClaim.activate({
    punkId,
    transactionId,
  });
  if (!identityActivated || !emailActivated) {
    return fail("temporarily_unavailable");
  }
  const session = await newSession(env, canonicalPunk(provisioned.state));
  return resultRedirect(env, transaction, state, "signed_in", [session.cookie]);
}

async function transactionSession(
  request: Request,
  env: AuthEnv,
  transaction: AuthTransaction,
): Promise<ActiveSession | null> {
  const current = await getActiveSession(request, env);
  if (
    current === null ||
    current.record.punkId !== transaction.currentPunkId ||
    current.record.sessionId !== transaction.currentSessionId
  ) {
    return null;
  }
  return current;
}

async function reauthenticate(
  request: Request,
  env: AuthEnv,
  transaction: AuthTransaction,
  state: string,
  identity: IdentityInput,
): Promise<Response> {
  const current = await transactionSession(request, env, transaction);
  if (current === null) {
    return resultRedirect(env, transaction, state, "session_expired");
  }
  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const resolution =
    await env.IDENTITY_CLAIMS.getByName(identityName).resolve();
  if (
    resolution.status !== "active" ||
    resolution.punkId !== current.record.punkId
  ) {
    return resultRedirect(env, transaction, state, "reauthentication_failed");
  }
  const until = new Date(Date.now() + 5 * 60_000).toISOString();
  if (
    !(await current.stub.markReauthenticated({
      sessionId: current.record.sessionId,
      punkId: current.record.punkId,
      until,
      authenticationMethod: identity.profile.provider,
      providerSubjectBindingHash: identity.subjectHash,
    }))
  ) {
    return resultRedirect(env, transaction, state, "reauthentication_failed");
  }
  return resultRedirect(env, transaction, state, "reauthenticated");
}

async function linkIdentity(
  request: Request,
  env: AuthEnv,
  transaction: AuthTransaction,
  transactionId: string,
  state: string,
  identity: IdentityInput,
): Promise<Response> {
  const current = await transactionSession(request, env, transaction);
  if (
    current === null ||
    current.record.recentReauthUntil === null ||
    Date.parse(current.record.recentReauthUntil) <= Date.now()
  ) {
    return resultRedirect(env, transaction, state, "reauthentication_required");
  }
  const punkId = current.record.punkId;
  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const identityClaim = env.IDENTITY_CLAIMS.getByName(identityName);
  const identityResolution = await identityClaim.resolve();
  if (
    identityResolution.status !== "missing" &&
    identityResolution.punkId !== punkId
  ) {
    return resultRedirect(env, transaction, state, "merge_required");
  }
  const emailName = await aggregateName(
    "email",
    identity.profile.verifiedEmail.toLowerCase(),
  );
  const emailClaim = env.EMAIL_CLAIMS.getByName(emailName);
  const email = await emailClaim.claim({
    emailHash: identity.emailHash,
    punkId,
    transactionId,
    now: new Date().toISOString(),
  });
  if (!email.ok) {
    return resultRedirect(env, transaction, state, "merge_required");
  }
  const claim = await identityClaim.claim({
    provider: identity.profile.provider,
    subjectHash: identity.subjectHash,
    punkId,
    transactionId,
    now: new Date().toISOString(),
  });
  if (!claim.ok) {
    await emailClaim.release({ punkId, transactionId });
    return resultRedirect(env, transaction, state, "merge_required");
  }
  const linked = await env.PUNKS.getByName(punkId).linkIdentity({
    identity,
    now: new Date().toISOString(),
  });
  if (!linked.ok) {
    await identityClaim.release({ punkId, transactionId });
    await emailClaim.release({ punkId, transactionId });
    return resultRedirect(env, transaction, state, "temporarily_unavailable");
  }
  const identityActivated = await identityClaim.activate({
    punkId,
    transactionId,
  });
  const emailActivated = await emailClaim.activate({ punkId, transactionId });
  return resultRedirect(
    env,
    transaction,
    state,
    identityActivated && emailActivated ? "linked" : "temporarily_unavailable",
  );
}

async function oauthCallback(
  request: Request,
  env: AuthEnv,
  provider: AuthProvider,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (
    state === null ||
    state.length < 32 ||
    state.length > 256 ||
    code === null ||
    code.length < 1 ||
    code.length > 2048
  ) {
    return problem(400, "invalid_input", "OAuth callback is invalid");
  }
  const browserBinding = parseCookies(request).get(oauthCookieName(state));
  if (browserBinding === undefined) {
    return problem(400, "invalid_input", "OAuth browser binding is missing");
  }
  const browserBindingHash = await hash(browserBinding);
  const transactionId = await aggregateName("transaction", state);
  const begun =
    await env.AUTH_TRANSACTIONS.getByName(transactionId).begin(
      browserBindingHash,
    );
  if (!begun.ok || begun.transaction.provider !== provider) {
    return problem(
      400,
      "invalid_input",
      "OAuth transaction is invalid or consumed",
    );
  }
  const transaction = begun.transaction;
  try {
    const profile = await exchangeProfile(
      env,
      provider,
      code,
      transaction.codeVerifier,
      providerFetch,
    );
    const identity = await identityInput(profile);
    if (transaction.desktop !== undefined) {
      return completeDesktopOAuth({
        request,
        env,
        transaction,
        transactionId,
        browserBindingHash,
        identity,
      });
    }
    if (transaction.intent === "sign_in") {
      return signIn(env, transaction, transactionId, state, identity);
    }
    if (transaction.intent === "reauthenticate") {
      return reauthenticate(request, env, transaction, state, identity);
    }
    return linkIdentity(
      request,
      env,
      transaction,
      transactionId,
      state,
      identity,
    );
  } catch {
    if (transaction.desktop !== undefined) {
      return failDesktopOAuth({
        env,
        transaction,
        browserBindingHash,
        code: "provider_error",
      });
    }
    return resultRedirect(env, transaction, state, "provider_error");
  }
}

async function getSession(request: Request, env: AuthEnv): Promise<Response> {
  const active = await getActiveSession(request, env);
  let record = active?.record ?? null;
  let punk = active?.punk ?? null;
  if (record === null || punk === null) {
    const token = sessionToken(request, env);
    if (token !== null) {
      const sessionId = await aggregateName("session", token);
      const punkId =
        await env.SESSIONS.getByName(sessionId).readPunkIdForTerminalResolution(
          sessionId,
        );
      if (punkId !== null) {
        try {
          const lookup =
            await env.ACCOUNT_MERGE_RECEIPTS.lookupAccountMergeReceipt({
              absorbedPunkId: punkId,
            });
          if (
            typeof lookup !== "object" ||
            lookup === null ||
            Array.isArray(lookup) ||
            Reflect.get(lookup, "ok") !== true
          ) {
            return problem(
              503,
              "temporarily_unavailable",
              "Punk merge authority is unavailable",
            );
          }
          const receipt = Reflect.get(lookup, "receipt");
          if (
            receipt !== null &&
            validateContract(
              "punks://contracts/account-merge.receipt@1",
              receipt,
            ).valid &&
            Reflect.get(receipt, "absorbedPunkId") === punkId
          ) {
            return problem(
              409,
              "account_merged",
              "This Punk Account was merged; sign in to the surviving Account",
            );
          }
        } catch {
          return problem(
            503,
            "temporarily_unavailable",
            "Punk merge authority is unavailable",
          );
        }
      }
    }
    if (token === null || !sameDesktopDistribution(request, env)) {
      return problem(401, "unauthenticated", "No readable Punk session");
    }
    const sessionId = await aggregateName("session", token);
    const delivery =
      await env.SESSIONS.getByName(sessionId).readForDesktopDelivery();
    if (delivery === null || delivery.status !== "prepared") {
      return problem(401, "unauthenticated", "No readable Punk session");
    }
    const punkResult = await env.PUNKS.getByName(
      delivery.record.punkId,
    ).query();
    if (!punkResult.ok) {
      return problem(401, "unauthenticated", "Prepared Punk is unavailable");
    }
    record = delivery.record;
    punk = canonicalPunk(punkResult.state);
  }
  const session: AuthSession = {
    ...record,
    punk: {
      id: punk.id,
      displayName: punk.displayName,
      avatarUrl: punk.avatarUrl,
    },
  };
  if (!validateContract("punks://contracts/auth.session@1", session).valid) {
    return problem(500, "internal", "Session violated its contract");
  }
  return json({ session });
}

async function logout(request: Request, env: AuthEnv): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin logout is required");
  }
  const current = await getActiveSession(request, env);
  if (current !== null) {
    await current.stub.revoke();
  }
  return json({ signedOut: true }, 200, {
    "set-cookie": clearSessionCookie(env.ENVIRONMENT),
  });
}

export async function route(
  request: Request,
  env: AuthEnv,
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "GET" && path === "/api/auth/health") {
    return json({
      service: "punks-auth",
      environment: env.ENVIRONMENT,
      status: "ok",
    });
  }
  if (request.method === "POST" && path === "/api/auth/v1/start") {
    return startAuth(request, env);
  }
  const desktop = routeDesktopAuth(request, env, path);
  if (desktop !== null) {
    return desktop;
  }
  if (request.method === "GET" && path === "/api/auth/v1/session") {
    return getSession(request, env);
  }
  if (request.method === "POST" && path === "/api/auth/v1/logout") {
    return logout(request, env);
  }
  const passkey = routePasskeys(request, env, path);
  if (passkey !== null) {
    return passkey;
  }
  const callback = path.match(/^\/api\/auth\/v1\/oauth\/([^/]+)\/callback$/);
  if (
    request.method === "GET" &&
    callback?.[1] !== undefined &&
    validProvider(callback[1])
  ) {
    return oauthCallback(request, env, callback[1], providerFetch);
  }
  return problem(404, "not_found", "Auth endpoint not found");
}
