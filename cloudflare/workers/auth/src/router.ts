import type {
  AuthProviderProfile,
  AuthSession,
  DeliverDesktopSessionCommand,
  DesktopSessionResponse,
  StartAuthCommand,
  StartAuthResponse,
  StartDesktopAuthCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";

import {
  clearOauthCookie,
  clearSessionCookie,
  oauthCookie,
  oauthCookieName,
  parseCookies,
  sessionCookie,
} from "./cookies";
import { hash, pkceChallenge, randomToken } from "./crypto";
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
  configuredTtl,
  ensureSessionForToken,
  getActiveSession,
  newSession,
  sameOrigin,
  type ActiveSession,
} from "./session";

function validProvider(value: string): value is AuthProvider {
  return value === "google" || value === "github";
}

/** Politique de renouvellement glissant de la Session desktop (issue #54). */
const RENEWAL_THRESHOLD_SECONDS = 7 * 24 * 3_600;
const RENEWAL_MIN_INTERVAL_SECONDS = 24 * 3_600;
const DESKTOP_DELIVERY_TTL_MS = 120_000;

function desktopDeeplink(
  environment: string,
  params: Record<string, string>,
): string {
  const url = new URL("punks://session");
  url.searchParams.set("environment", environment);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function desktopResultRedirect(
  environment: string,
  state: string,
  result: string,
): Response {
  return redirect(
    desktopDeeplink(environment, { state, result: `error_${result}` }),
    [clearOauthCookie(state)],
  );
}

/**
 * Dépose la session fraîche dans la livraison à usage unique et ramène le
 * navigateur vers le deeplink desktop — le navigateur ne reçoit jamais le
 * cookie de la session desktop (issue #54).
 */
async function deliverDesktopSession(
  env: AuthEnv,
  transaction: AuthTransaction,
  state: string,
  punk: ReturnType<typeof canonicalPunk>,
  session: { value: AuthSession; cookie: string; token: string },
): Promise<Response> {
  const target = transaction.desktop;
  if (target === undefined) {
    throw new Error("Desktop delivery requires a desktop transaction");
  }
  const deliveryToken = randomToken(32);
  const created = await env.DESKTOP_DELIVERIES.getByName(
    await aggregateName("desktop-delivery", deliveryToken),
  ).create({
    sessionToken: session.token,
    punkId: punk.id,
    installationHash: target.installationHash,
    expiresAt: new Date(Date.now() + DESKTOP_DELIVERY_TTL_MS).toISOString(),
  });
  if (!created) {
    return desktopResultRedirect(
      target.environment,
      state,
      "temporarily_unavailable",
    );
  }
  return redirect(
    desktopDeeplink(target.environment, { state, delivery: deliveryToken }),
    [clearOauthCookie(state)],
  );
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
  const desktop = transaction.desktop ?? null;
  const fail = (result: string): Response =>
    desktop !== null
      ? desktopResultRedirect(desktop.environment, state, result)
      : resultRedirect(env, transaction, state, result);

  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const identityClaim = env.IDENTITY_CLAIMS.getByName(identityName);
  const resolution = await identityClaim.resolve();
  if (resolution.status === "active") {
    const punk = await env.PUNKS.getByName(resolution.punkId).query();
    if (!punk.ok) {
      return fail("temporarily_unavailable");
    }
    const session = await newSession(
      env,
      canonicalPunk(punk.state),
      desktop === null ? "browser" : "desktop",
    );
    if (desktop !== null) {
      return deliverDesktopSession(
        env,
        transaction,
        state,
        canonicalPunk(punk.state),
        session,
      );
    }
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
  const session = await newSession(
    env,
    canonicalPunk(provisioned.state),
    desktop === null ? "browser" : "desktop",
  );
  if (desktop !== null) {
    return deliverDesktopSession(
      env,
      transaction,
      state,
      canonicalPunk(provisioned.state),
      session,
    );
  }
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
  const transactionId = await aggregateName("transaction", state);
  const begun = await env.AUTH_TRANSACTIONS.getByName(transactionId).begin(
    await hash(browserBinding),
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
    return resultRedirect(env, transaction, state, "provider_error");
  }
}

async function getSession(request: Request, env: AuthEnv): Promise<Response> {
  const current = await getActiveSession(request, env);
  if (current === null) {
    return problem(401, "unauthenticated", "No active Punk session");
  }
  const session: AuthSession = {
    ...current.record,
    punk: {
      id: current.punk.id,
      displayName: current.punk.displayName,
      avatarUrl: current.punk.avatarUrl,
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

/**
 * Démarre la Cérémonie de connexion desktop (issue #54) : même discipline
 * OAuth/PKCE/state que le web (ADR 0042), mais la transaction porte la
 * cible desktop (installation attendue + environnement) et l'issue est une
 * livraison à usage unique, pas un cookie de navigateur.
 */
async function startDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin auth request is required");
  }
  let input: unknown;
  try {
    input = await readJson(request);
  } catch {
    return problem(400, "invalid_input", "Desktop auth start body is invalid");
  }
  if (
    !validateContract("punks://contracts/auth.desktop-start@1", input).valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Desktop auth start command is invalid",
    );
  }
  const command = input as StartDesktopAuthCommand;
  if (command.environment !== env.ENVIRONMENT) {
    return problem(
      403,
      "forbidden",
      "Desktop ceremony environment does not match this deployment",
    );
  }
  const state = randomToken(32);
  const browserBinding = randomToken(32);
  const codeVerifier = randomToken(64);
  const now = new Date();
  const transaction: AuthTransaction = {
    provider: command.provider,
    intent: "sign_in",
    returnTo: "/",
    browserBindingHash: await hash(browserBinding),
    codeVerifier,
    currentPunkId: null,
    currentSessionId: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    desktop: {
      installationHash: await hash(
        `punks.desktop-installation.v1\n${command.installationId}`,
      ),
      environment: command.environment,
    },
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
    !validateContract("punks://contracts/auth.desktop-start-response@1", body)
      .valid
  ) {
    return problem(500, "internal", "Auth response violated its contract");
  }
  return json(body, 201, {
    "set-cookie": oauthCookie(state, browserBinding, 600),
  });
}

/** Consomme la livraison à usage unique et remet le cookie au client natif. */
async function deliverDesktopSessionCommand(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin auth request is required");
  }
  let input: unknown;
  try {
    input = await readJson(request);
  } catch {
    return problem(400, "invalid_input", "Desktop delivery body is invalid");
  }
  if (
    !validateContract("punks://contracts/auth.desktop-delivery@1", input).valid
  ) {
    return problem(400, "invalid_input", "Desktop delivery command is invalid");
  }
  const command = input as DeliverDesktopSessionCommand;
  const installationHash = await hash(
    `punks.desktop-installation.v1\n${command.installationId}`,
  );
  const consumed = await env.DESKTOP_DELIVERIES.getByName(
    await aggregateName("desktop-delivery", command.deliveryToken),
  ).consume(installationHash);
  if (!consumed.ok) {
    return problem(
      consumed.code === "consumed" ? 409 : 400,
      consumed.code === "consumed" ? "idempotency_conflict" : "invalid_input",
      `Desktop delivery is ${consumed.code}`,
    );
  }
  const punk = await env.PUNKS.getByName(consumed.record.punkId).query();
  if (!punk.ok) {
    return problem(
      401,
      "unauthenticated",
      "Delivered Punk is no longer active",
    );
  }
  const session = await ensureSessionForToken(
    env,
    canonicalPunk(punk.state),
    consumed.record.sessionToken,
  );
  const body: DesktopSessionResponse = { session: session.value };
  if (
    !validateContract("punks://contracts/auth.desktop-session-response@1", body)
      .valid
  ) {
    return problem(500, "internal", "Session violated its contract");
  }
  return json(body, 200, { "set-cookie": session.cookie });
}

/** Renouvellement glissant : 30 jours, seuil de 7 jours, une fois par 24 h. */
async function renewDesktopSession(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin renewal is required");
  }
  const current = await getActiveSession(request, env);
  if (current === null) {
    return problem(401, "unauthenticated", "No active Punk session");
  }
  const renewed = await current.stub.extend({
    now: Date.now(),
    ttlSeconds: configuredTtl(env),
    thresholdSeconds: RENEWAL_THRESHOLD_SECONDS,
    minIntervalSeconds: RENEWAL_MIN_INTERVAL_SECONDS,
  });
  if (!renewed.ok) {
    return problem(
      renewed.code === "too_recent" ? 429 : 409,
      renewed.code === "too_recent"
        ? "command_in_progress"
        : "idempotency_conflict",
      `Session renewal is ${renewed.code}`,
    );
  }
  const value: AuthSession = {
    ...renewed.record,
    punk: {
      id: current.punk.id,
      displayName: current.punk.displayName,
      avatarUrl: current.punk.avatarUrl,
    },
  };
  const body: DesktopSessionResponse = { session: value };
  if (
    !validateContract("punks://contracts/auth.desktop-session-response@1", body)
      .valid
  ) {
    return problem(500, "internal", "Session violated its contract");
  }
  const remainingTtl = Math.max(
    1,
    Math.floor((Date.parse(renewed.record.expiresAt) - Date.now()) / 1_000),
  );
  return json(body, 200, {
    "set-cookie": sessionCookie(current.token, remainingTtl),
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
  if (request.method === "POST" && path === "/api/auth/v1/desktop/start") {
    return startDesktopAuth(request, env);
  }
  if (request.method === "POST" && path === "/api/auth/v1/desktop/deliver") {
    return deliverDesktopSessionCommand(request, env);
  }
  if (
    request.method === "POST" &&
    path === "/api/auth/v1/desktop/session/renew"
  ) {
    return renewDesktopSession(request, env);
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
