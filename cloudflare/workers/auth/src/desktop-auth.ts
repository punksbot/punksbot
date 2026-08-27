import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type {
  AuthProviderProfile,
  DesktopAuthStartRequest,
  DesktopAuthStartResponse,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";

import { bytesToBase64Url, hash, pkceChallenge } from "./crypto";
import type {
  DesktopAuthFlowRecord,
  DesktopAuthIntent,
  DesktopAuthMethod,
  DesktopAuthOutcomeCode,
  DesktopPendingIdentity,
} from "./desktop-auth-flow-do";
import type { DesktopReauthTarget } from "./desktop-reauth-grant-do";
import {
  confirmationPage,
  expiredDesktopAuthPage,
  existingBrowserSessionPage,
  passkeyPage,
} from "./desktop-auth-browser-page";
import type { AuthEnv } from "./env";
import { json, problem, readJson, redirect } from "./http";
import {
  clearOauthCookie,
  oauthCookie,
  oauthCookieName,
  parseCookies,
} from "./cookies";
import { authorizationUrl } from "./provider";
import type { AuthTransaction, IdentityInput } from "./rpc";
import {
  aggregateName,
  getActiveSession,
  sameDesktopDistribution,
  sameOrigin,
} from "./session";

type FlowStub = DurableObjectStub<
  import("./desktop-auth-flow-do").DesktopAuthFlowDO
>;

function flowStub(env: AuthEnv, flowId: string): FlowStub {
  return env.DESKTOP_AUTH_FLOWS.getByName(flowId);
}

function validFlowId(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function completionUrl(environment: string, flowId: string): string {
  const scheme =
    environment === "production"
      ? "punks"
      : environment === "staging"
        ? "punks-staging"
        : "punks-local";
  const url = new URL(`${scheme}://auth/complete`);
  url.searchParams.set("flow", flowId);
  return url.toString();
}

function completionRedirect(flow: DesktopAuthFlowRecord): Response {
  return redirect(
    completionUrl(flow.environment, flow.flowId),
    flow.oauthState === null ? [] : [clearOauthCookie(flow.oauthState)],
  );
}

function browserUrl(env: AuthEnv, flowId: string): string {
  const url = new URL("/api/auth/v1/desktop/browser", env.AUTH_BASE_URL);
  url.searchParams.set("flow", flowId);
  return url.toString();
}

function refreshBrowserBinding(
  response: Response,
  flow: DesktopAuthFlowRecord,
): Response {
  if (flow.oauthState === null || flow.browserBinding === null) {
    return response;
  }
  const maxAge = Math.max(
    1,
    Math.floor((Date.parse(flow.expiresAt) - Date.now()) / 1_000),
  );
  response.headers.set(
    "set-cookie",
    oauthCookie(flow.oauthState, flow.browserBinding, maxAge),
  );
  return response;
}

function requestMessage<T extends { message: string }>(
  value: T,
): value is T & { message: "request" } {
  return value.message === "request";
}

function methodMatchesIntent(
  intent: DesktopAuthIntent,
  method: DesktopAuthMethod,
): boolean {
  if (intent === "link_google") return method === "google";
  if (intent === "link_github") return method === "github";
  if (intent === "register_passkey") return method === "passkey";
  return true;
}

async function boundSessionIsActive(
  env: AuthEnv,
  flow: DesktopAuthFlowRecord,
): Promise<boolean> {
  if (flow.currentSessionId === null || flow.currentPunkId === null) {
    return flow.intent === "sign_in";
  }
  const current = await env.SESSIONS.getByName(flow.currentSessionId).get();
  return (
    current !== null &&
    current.sessionId === flow.currentSessionId &&
    current.punkId === flow.currentPunkId
  );
}

function validateResponse(
  contract: Parameters<typeof validateContract>[0],
  body: unknown,
): boolean {
  return validateContract(contract, body).valid;
}

async function commandBody<T>(
  request: Request,
  contract: Parameters<typeof validateContract>[0],
): Promise<T | null> {
  try {
    const body = await readJson(request);
    return validateContract(contract, body).valid ? (body as T) : null;
  } catch {
    return null;
  }
}

function browserBinding(
  flow: DesktopAuthFlowRecord,
  request: Request,
): string | null {
  if (flow.oauthState === null) return null;
  return parseCookies(request).get(oauthCookieName(flow.oauthState)) ?? null;
}

async function accountConfirmationCapability(
  flow: DesktopAuthFlowRecord,
): Promise<string | null> {
  if (flow.oauthState === null || flow.browserBinding === null) return null;
  return pkceChallenge(
    `punks.desktop-oauth-confirmation.v1\n${flow.flowId}\n${flow.oauthState}\n${flow.browserBinding}`,
  );
}

export async function identityInput(
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

export async function startDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await commandBody<DesktopAuthStartRequest>(
    request,
    "punks://contracts/desktop-auth.start@1",
  );
  if (
    command === null ||
    !requestMessage(command) ||
    !methodMatchesIntent(
      command.intent as DesktopAuthIntent,
      command.method as DesktopAuthMethod,
    ) ||
    (command.intent === "reauthenticate" && command.purpose === undefined)
  ) {
    return problem(400, "invalid_input", "Desktop auth start is invalid");
  }
  const promotionSourceSha = request.headers.get(
    "x-punks-promotion-source-sha",
  );
  const promotionStagingDeploymentId = request.headers.get(
    "x-punks-promotion-staging-deployment-id",
  );
  if (
    (promotionSourceSha !== null || promotionStagingDeploymentId !== null) &&
    (env.ENVIRONMENT !== "staging" ||
      !/^[0-9a-f]{40}$/u.test(promotionSourceSha ?? "") ||
      !/^sha256:[0-9a-f]{64}$/u.test(promotionStagingDeploymentId ?? ""))
  ) {
    return problem(
      400,
      "invalid_input",
      "Desktop promotion binding is invalid",
    );
  }
  const current = await getActiveSession(request, env);
  const workspaceOwnershipTransfer =
    command.purpose === "transfer_workspace_ownership"
      ? (command.workspaceOwnershipTransfer ?? null)
      : null;
  if (
    (command.purpose === "transfer_workspace_ownership" &&
      workspaceOwnershipTransfer === null) ||
    (command.purpose !== "transfer_workspace_ownership" &&
      command.workspaceOwnershipTransfer !== undefined)
  ) {
    return problem(
      400,
      "invalid_input",
      "Desktop ownership reauthentication binding is invalid",
    );
  }
  if (command.intent === "sign_in" && current !== null) {
    return problem(
      409,
      "idempotency_conflict",
      "Sign-in requires an empty native Session",
    );
  }
  if (command.intent !== "sign_in" && current === null) {
    return problem(
      401,
      "unauthenticated",
      "This desktop intent requires the current native Session",
    );
  }
  const target = ["link_google", "link_github", "register_passkey"].includes(
    command.intent,
  )
    ? (command.intent as DesktopReauthTarget)
    : null;
  const now = Date.now();
  const expiresAt = new Date(
    now + (command.method === "passkey" ? 5 : 10) * 60_000,
  ).toISOString();
  const flowId = crypto.randomUUID();
  if (target !== null) {
    if (command.authorizationId === undefined || current === null) {
      return problem(
        403,
        "forbidden",
        "A target-bound reauthentication grant is required",
      );
    }
    const consumed = await env.DESKTOP_REAUTH_GRANTS.getByName(
      command.authorizationId,
    ).consume({
      authorizationId: command.authorizationId,
      sessionId: current.record.sessionId,
      punkId: current.record.punkId,
      targetMethod: target,
      workspaceOwnershipTransfer: null,
      flowId,
    });
    if (!consumed.ok) {
      return problem(
        consumed.code === "binding_mismatch" ? 403 : 409,
        consumed.code === "binding_mismatch"
          ? "forbidden"
          : "idempotency_conflict",
        `Desktop reauthentication grant is ${consumed.code}`,
      );
    }
  }
  const created = await flowStub(env, flowId).create({
    flowId,
    intent: command.intent as DesktopAuthIntent,
    method: command.method as DesktopAuthMethod,
    purpose: command.purpose ?? null,
    workspaceOwnershipTransfer,
    verifierCommitment: command.verifierCommitment,
    environment: env.ENVIRONMENT,
    currentSessionId: current?.record.sessionId ?? null,
    currentPunkId: current?.record.punkId ?? null,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    promotionSourceSha,
    promotionStagingDeploymentId,
  });
  if (!created) {
    return problem(
      503,
      "temporarily_unavailable",
      "Desktop auth flow could not start",
    );
  }
  const body: DesktopAuthStartResponse = {
    contract: "desktop-auth.start@1",
    message: "response",
    flowId,
    phase: "started",
    intent: command.intent,
    method: command.method,
    browserUrl: browserUrl(env, flowId),
    createdAt: new Date(now).toISOString(),
    expiresAt,
  };
  return validateResponse("punks://contracts/desktop-auth.start@1", body)
    ? json(body, 201)
    : problem(500, "internal", "Desktop auth start response is invalid");
}

export async function launchDesktopBrowser(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const flowId = new URL(request.url).searchParams.get("flow");
  if (!validFlowId(flowId)) {
    return problem(404, "not_found", "Desktop auth flow is unavailable");
  }
  const stub = flowStub(env, flowId);
  const current = await stub.browserMetadata();
  if (current?.phase === "expired") {
    return expiredDesktopAuthPage();
  }
  if (
    current?.phase === "browser_complete" &&
    current.outcomeCode === "account_creation_confirmation_required"
  ) {
    return resumeDesktopOAuthAccount(request, env);
  }
  const launched = await stub.browserLaunch();
  if (!launched.ok) {
    return problem(410, "not_found", "Desktop auth flow is unavailable");
  }
  const maxAge = Math.max(
    1,
    Math.floor((Date.parse(launched.flow.expiresAt) - Date.now()) / 1_000),
  );
  const cookie = oauthCookie(launched.state, launched.browserBinding, maxAge);
  const useSelectedMethod =
    new URL(request.url).searchParams.get("useMethod") === "1";
  if (
    !useSelectedMethod &&
    (launched.flow.intent === "sign_in" ||
      launched.flow.intent === "switch_account")
  ) {
    const browserSession = await getActiveSession(request, env);
    if (browserSession !== null) {
      const page = existingBrowserSessionPage({
        flowId,
        displayName: browserSession.punk.displayName,
        method: launched.flow.method,
      });
      page.headers.set("set-cookie", cookie);
      return page;
    }
  }
  if (launched.flow.method === "google" || launched.flow.method === "github") {
    const transaction: AuthTransaction = {
      provider: launched.flow.method,
      intent: "sign_in",
      returnTo: "/",
      browserBindingHash: await hash(launched.browserBinding),
      codeVerifier: launched.codeVerifier,
      currentPunkId: launched.flow.currentPunkId,
      currentSessionId: launched.flow.currentSessionId,
      createdAt: launched.flow.createdAt,
      expiresAt: launched.flow.expiresAt,
      desktop: { flowId },
    };
    const transactionId = await aggregateName("transaction", launched.state);
    if (
      !(await env.AUTH_TRANSACTIONS.getByName(transactionId).create(
        transaction,
      ))
    ) {
      return problem(
        503,
        "temporarily_unavailable",
        "Desktop browser transaction could not start",
      );
    }
    const target = authorizationUrl(env, launched.flow.method, {
      state: launched.state,
      challenge: await pkceChallenge(launched.codeVerifier),
    });
    return redirect(target, [cookie]);
  }
  let options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  let purpose: "authentication" | "registration" = "authentication";
  if (launched.flow.intent === "register_passkey") {
    if (launched.flow.currentPunkId === null) {
      return problem(403, "forbidden", "Passkey registration is not bound");
    }
    purpose = "registration";
    const ids = await env.PUNKS.getByName(
      launched.flow.currentPunkId,
    ).passkeyCredentialIds();
    options = (await generateRegistrationOptions({
      rpName: env.WEBAUTHN_RP_NAME,
      rpID: env.WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(launched.flow.currentPunkId),
      userName: `punk:${launched.flow.currentPunkId}`,
      userDisplayName: `punk:${launched.flow.currentPunkId}`,
      timeout: 300_000,
      attestationType: "none",
      excludeCredentials: ids.map((id) => ({ id })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-7, -257],
      challenge: launched.codeVerifier,
    })) as Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  } else {
    options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      timeout: 300_000,
      userVerification: "required",
      challenge: launched.codeVerifier,
    });
  }
  if (
    !(await flowStub(env, flowId).setPasskeyChallenge({
      browserBindingHash: await hash(launched.browserBinding),
      challenge: options.challenge,
    }))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Passkey challenge could not be bound",
    );
  }
  const response = passkeyPage({
    flowId,
    purpose,
    publicKey: options as unknown as Record<string, unknown>,
  });
  response.headers.set("set-cookie", cookie);
  return response;
}

export async function confirmExistingBrowserSession(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin confirmation is required");
  }
  const form = await request.formData();
  const flowId = String(form.get("flow") ?? "");
  if (!validFlowId(flowId)) {
    return problem(400, "invalid_input", "Desktop flow is invalid");
  }
  const stub = flowStub(env, flowId);
  const flow = await stub.browserMetadata();
  if (
    flow === null ||
    (flow.intent !== "sign_in" && flow.intent !== "switch_account")
  ) {
    return problem(
      400,
      "invalid_input",
      "Browser Session choice is unavailable",
    );
  }
  const binding = browserBinding(flow, request);
  const browserSession = await getActiveSession(request, env);
  if (binding === null || browserSession === null) {
    return problem(
      400,
      "invalid_input",
      "Browser Session confirmation is unbound",
    );
  }
  const browserBindingHash = await hash(binding);
  const recorded = await stub.recordBrowserComplete({ browserBindingHash });
  if (
    !recorded.ok ||
    !(await stub.ready({
      punkId: browserSession.record.punkId,
      outcomeCode: "authenticated",
    }))
  ) {
    return problem(
      409,
      "idempotency_conflict",
      "Browser Session confirmation is terminal",
    );
  }
  return completionRedirect(flow);
}

async function provisionIdentity(
  env: AuthEnv,
  identity: DesktopPendingIdentity,
): Promise<
  { ok: true; punkId: string } | { ok: false; code: DesktopAuthOutcomeCode }
> {
  const punkId = await deriveOpaqueUuid(
    "punks.punk.v1",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const emailName = await aggregateName(
    "email",
    identity.profile.verifiedEmail.toLowerCase(),
  );
  const identityClaim = env.IDENTITY_CLAIMS.getByName(identityName);
  const emailClaim = env.EMAIL_CLAIMS.getByName(emailName);
  const email = await emailClaim.claim({
    emailHash: identity.emailHash,
    punkId,
    transactionId: identity.transactionId,
    now: new Date().toISOString(),
  });
  if (!email.ok) return { ok: false, code: "link_required" };
  const claim = await identityClaim.claim({
    provider: identity.profile.provider,
    subjectHash: identity.subjectHash,
    punkId,
    transactionId: identity.transactionId,
    now: new Date().toISOString(),
  });
  if (!claim.ok) {
    await emailClaim.release({ punkId, transactionId: identity.transactionId });
    return { ok: false, code: "link_required" };
  }
  const punk = env.PUNKS.getByName(punkId);
  const provisioned = await punk.provision({
    punkId,
    identity,
    now: new Date().toISOString(),
  });
  if (!provisioned.ok) {
    await identityClaim.release({
      punkId,
      transactionId: identity.transactionId,
    });
    await emailClaim.release({ punkId, transactionId: identity.transactionId });
    return { ok: false, code: "temporarily_unavailable" };
  }
  if (
    !(await identityClaim.activate({
      punkId,
      transactionId: identity.transactionId,
    })) ||
    !(await emailClaim.activate({
      punkId,
      transactionId: identity.transactionId,
    }))
  ) {
    return { ok: false, code: "temporarily_unavailable" };
  }
  return { ok: true, punkId };
}

export async function commitDesktopIdentityLink(
  env: AuthEnv,
  flow: DesktopAuthFlowRecord,
  identity: DesktopPendingIdentity,
): Promise<{ ok: true } | { ok: false; code: DesktopAuthOutcomeCode }> {
  if (flow.currentPunkId === null)
    return { ok: false, code: "session_expired" };
  const punkId = flow.currentPunkId;
  const identityName = await aggregateName(
    "identity",
    `${identity.profile.provider}:${identity.profile.subject}`,
  );
  const identityClaim = env.IDENTITY_CLAIMS.getByName(identityName);
  const resolution = await identityClaim.resolve();
  if (resolution.status !== "missing" && resolution.punkId !== punkId) {
    return { ok: false, code: "merge_required" };
  }
  const emailClaim = env.EMAIL_CLAIMS.getByName(
    await aggregateName("email", identity.profile.verifiedEmail.toLowerCase()),
  );
  const email = await emailClaim.claim({
    emailHash: identity.emailHash,
    punkId,
    transactionId: identity.transactionId,
    now: new Date().toISOString(),
  });
  if (!email.ok) return { ok: false, code: "merge_required" };
  const claim = await identityClaim.claim({
    provider: identity.profile.provider,
    subjectHash: identity.subjectHash,
    punkId,
    transactionId: identity.transactionId,
    now: new Date().toISOString(),
  });
  if (!claim.ok) {
    await emailClaim.release({ punkId, transactionId: identity.transactionId });
    return { ok: false, code: "merge_required" };
  }
  const linked = await env.PUNKS.getByName(punkId).linkIdentity({
    identity,
    now: new Date().toISOString(),
  });
  if (!linked.ok) return { ok: false, code: "temporarily_unavailable" };
  if (
    !(await identityClaim.activate({
      punkId,
      transactionId: identity.transactionId,
    })) ||
    !(await emailClaim.activate({
      punkId,
      transactionId: identity.transactionId,
    }))
  ) {
    return { ok: false, code: "temporarily_unavailable" };
  }
  return { ok: true };
}

/** Commits a browser-proven sensitive effect only inside native confirm. */
export async function commitDesktopBrowserEffect(
  env: AuthEnv,
  flow: DesktopAuthFlowRecord,
): Promise<{ ok: true } | { ok: false; code: DesktopAuthOutcomeCode }> {
  if (flow.browserEffectCommitted) return { ok: true };
  if (flow.intent === "link_google" || flow.intent === "link_github") {
    if (flow.pendingIdentity === null) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    return commitDesktopIdentityLink(env, flow, flow.pendingIdentity);
  }
  if (flow.intent === "register_passkey") {
    if (flow.pendingPasskey === null || flow.currentPunkId === null) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    const linked = await env.PUNKS.getByName(flow.currentPunkId).linkPasskey({
      credentialId: flow.pendingPasskey.credentialId,
      subjectHash: flow.pendingPasskey.subjectHash,
      emailHash: flow.pendingPasskey.emailHash,
      now: new Date().toISOString(),
    });
    if (!linked.ok) {
      return {
        ok: false,
        code:
          linked.code === "identity_conflict"
            ? "merge_required"
            : "temporarily_unavailable",
      };
    }
    const activated = await env.PASSKEY_CREDENTIALS.getByName(
      await aggregateName(
        "passkey-credential",
        flow.pendingPasskey.credentialId,
      ),
    ).activate({
      punkId: flow.currentPunkId,
      transactionId: flow.pendingPasskey.transactionId,
    });
    return activated
      ? { ok: true }
      : { ok: false, code: "temporarily_unavailable" };
  }
  return { ok: true };
}

async function failAndComplete(
  env: AuthEnv,
  flow: DesktopAuthFlowRecord,
  browserBindingHash: string,
  code: DesktopAuthOutcomeCode,
): Promise<Response> {
  await flowStub(env, flow.flowId).fail({
    browserBindingHash,
    result:
      code === "temporarily_unavailable"
        ? "transient_interruption"
        : code === "link_required" || code === "merge_required"
          ? "human_action_required"
          : "security_failure",
    outcomeCode: code,
  });
  return completionRedirect(flow);
}

export async function completeDesktopOAuth(input: {
  request: Request;
  env: AuthEnv;
  transaction: AuthTransaction;
  transactionId: string;
  browserBindingHash: string;
  identity: IdentityInput;
}): Promise<Response> {
  const flowId = input.transaction.desktop?.flowId ?? null;
  if (!validFlowId(flowId)) {
    return problem(400, "invalid_input", "Desktop flow binding is invalid");
  }
  const stub = flowStub(input.env, flowId);
  const flow = await stub.browserFlow(input.browserBindingHash);
  if (flow === null || flow.method !== input.identity.profile.provider) {
    return problem(400, "invalid_input", "Desktop OAuth flow is invalid");
  }
  if (!(await boundSessionIsActive(input.env, flow))) {
    return failAndComplete(
      input.env,
      flow,
      input.browserBindingHash,
      "session_expired",
    );
  }
  const pending: DesktopPendingIdentity = {
    ...input.identity,
    transactionId: input.transactionId,
  };
  const resolution = await input.env.IDENTITY_CLAIMS.getByName(
    await aggregateName(
      "identity",
      `${pending.profile.provider}:${pending.profile.subject}`,
    ),
  ).resolve();
  if (flow.intent === "link_google" || flow.intent === "link_github") {
    const recorded = await stub.recordBrowserComplete({
      browserBindingHash: input.browserBindingHash,
      pendingIdentity: pending,
      outcomeCode: "link_pending",
    });
    if (!recorded.ok) {
      return problem(
        400,
        "invalid_input",
        "Desktop OAuth completion is terminal",
      );
    }
    if (
      !(await stub.ready({
        punkId: flow.currentPunkId ?? "",
        outcomeCode: "link_pending",
      }))
    ) {
      return problem(
        409,
        "idempotency_conflict",
        "Desktop OAuth completion was cancelled",
      );
    }
    return completionRedirect(flow);
  }
  if (flow.intent === "reauthenticate") {
    if (
      resolution.status !== "active" ||
      resolution.punkId !== flow.currentPunkId ||
      flow.currentSessionId === null ||
      flow.currentPunkId === null
    ) {
      return failAndComplete(
        input.env,
        flow,
        input.browserBindingHash,
        "reauthentication_failed",
      );
    }
    const recorded = await stub.recordBrowserComplete({
      browserBindingHash: input.browserBindingHash,
    });
    if (
      !recorded.ok ||
      !(await stub.ready({
        punkId: flow.currentPunkId,
        outcomeCode: "reauthenticated",
      }))
    ) {
      return problem(
        400,
        "invalid_input",
        "Desktop OAuth completion is terminal",
      );
    }
    return completionRedirect(flow);
  }
  if (resolution.status === "active") {
    const recorded = await stub.recordBrowserComplete({
      browserBindingHash: input.browserBindingHash,
    });
    if (
      !recorded.ok ||
      !(await stub.ready({
        punkId: resolution.punkId,
        outcomeCode: "authenticated",
      }))
    ) {
      return problem(
        400,
        "invalid_input",
        "Desktop OAuth completion is terminal",
      );
    }
    return completionRedirect(flow);
  }
  if (resolution.status === "pending") {
    return failAndComplete(
      input.env,
      flow,
      input.browserBindingHash,
      "temporarily_unavailable",
    );
  }
  const recorded = await stub.recordBrowserComplete({
    browserBindingHash: input.browserBindingHash,
    pendingIdentity: pending,
    outcomeCode: "account_creation_confirmation_required",
  });
  if (flow.oauthState === null) {
    return problem(400, "invalid_input", "Desktop OAuth state is unavailable");
  }
  return recorded.ok
    ? refreshBrowserBinding(
        redirect(browserUrl(input.env, flow.flowId)),
        recorded.flow,
      )
    : problem(400, "invalid_input", "Desktop OAuth completion is invalid");
}

export async function failDesktopOAuth(input: {
  env: AuthEnv;
  transaction: AuthTransaction;
  browserBindingHash: string;
  code: DesktopAuthOutcomeCode;
}): Promise<Response> {
  const flowId = input.transaction.desktop?.flowId ?? null;
  if (!validFlowId(flowId)) {
    return problem(400, "invalid_input", "Desktop flow binding is invalid");
  }
  const flow = await flowStub(input.env, flowId).browserFlow(
    input.browserBindingHash,
  );
  return flow === null
    ? problem(400, "invalid_input", "Desktop OAuth flow is invalid")
    : failAndComplete(input.env, flow, input.browserBindingHash, input.code);
}

/**
 * Restores the pending account-creation page from the browser-bound OAuth
 * aggregate without replaying the consumed provider callback.
 */
export async function resumeDesktopOAuthAccount(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const flowId = new URL(request.url).searchParams.get("flow");
  if (!validFlowId(flowId)) {
    return problem(400, "invalid_input", "Desktop flow is invalid");
  }
  const stub = flowStub(env, flowId);
  const flow = await stub.browserMetadata();
  if (flow === null || flow.oauthState === null) {
    return problem(400, "invalid_input", "Desktop flow is unavailable");
  }
  if (flow.phase === "expired") {
    return expiredDesktopAuthPage();
  }
  const binding = browserBinding(flow, request);
  if (binding === null) {
    return problem(400, "invalid_input", "Browser binding is missing");
  }
  const pending = await stub.pendingIdentity(await hash(binding));
  if (!pending.ok) {
    return problem(400, "invalid_input", "Account confirmation is invalid");
  }
  const capability = await accountConfirmationCapability(flow);
  if (capability === null) {
    return problem(400, "invalid_input", "Account confirmation is invalid");
  }
  return refreshBrowserBinding(
    confirmationPage(
      flow.flowId,
      flow.oauthState,
      capability,
      pending.identity.profile.displayName,
      pending.flow.expiresAt,
    ),
    flow,
  );
}

export async function confirmDesktopOAuthAccount(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const form = await request.formData();
  const flowId = String(form.get("flow") ?? "");
  const state = String(form.get("state") ?? "");
  const capability = String(form.get("capability") ?? "");
  if (!validFlowId(flowId)) {
    return problem(400, "invalid_input", "Desktop flow is invalid");
  }
  const stub = flowStub(env, flowId);
  const flow = await stub.browserMetadata();
  if (flow === null || flow.oauthState === null) {
    return problem(400, "invalid_input", "Desktop flow is unavailable");
  }
  if (state !== flow.oauthState) {
    return problem(403, "forbidden", "OAuth confirmation state is invalid");
  }
  const expectedCapability = await accountConfirmationCapability(flow);
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(capability) ||
    capability !== expectedCapability
  ) {
    return problem(
      403,
      "forbidden",
      "OAuth confirmation capability is invalid",
    );
  }
  if (flow.phase === "expired") {
    return expiredDesktopAuthPage();
  }
  const binding = browserBinding(flow, request);
  if (
    binding === null ||
    flow.browserBindingHash === null ||
    (await hash(binding)) !== flow.browserBindingHash
  ) {
    return problem(403, "forbidden", "Browser binding is invalid");
  }
  const browserBindingHash = flow.browserBindingHash;
  const pending = await stub.pendingIdentity(browserBindingHash);
  if (!pending.ok) {
    return problem(400, "invalid_input", "Account confirmation is invalid");
  }
  const provisioned = await provisionIdentity(env, pending.identity);
  if (!provisioned.ok) {
    return failAndComplete(
      env,
      pending.flow,
      browserBindingHash,
      provisioned.code,
    );
  }
  await stub.ready({
    punkId: provisioned.punkId,
    outcomeCode: "account_created",
  });
  return completionRedirect(pending.flow);
}

export async function completeDesktopPasskey(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(
      403,
      "forbidden",
      "Same-origin passkey completion is required",
    );
  }
  let input: { flowId?: unknown; response?: unknown };
  try {
    input = (await readJson(request)) as typeof input;
  } catch {
    return problem(400, "invalid_input", "Passkey completion is invalid");
  }
  if (typeof input.flowId !== "string" || !validFlowId(input.flowId)) {
    return problem(400, "invalid_input", "Passkey flow is invalid");
  }
  const stub = flowStub(env, input.flowId);
  const launched = await stub.browserLaunch();
  if (!launched.ok) {
    return problem(400, "invalid_input", "Passkey flow is unavailable");
  }
  if (!(await boundSessionIsActive(env, launched.flow))) {
    return problem(401, "unauthenticated", "Bound native Session expired");
  }
  const binding = browserBinding(launched.flow, request);
  if (binding === null) {
    return problem(400, "invalid_input", "Passkey browser binding is missing");
  }
  const bindingHash = await hash(binding);
  if (launched.flow.intent === "register_passkey") {
    if (launched.flow.currentPunkId === null) {
      return problem(403, "forbidden", "Passkey registration is unbound");
    }
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response as RegistrationResponseJSON,
        expectedChallenge:
          launched.flow.passkeyChallenge ?? launched.codeVerifier,
        expectedOrigin: new URL(env.AUTH_BASE_URL).origin,
        expectedRPID: env.WEBAUTHN_RP_ID,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      await stub.fail({
        browserBindingHash: bindingHash,
        result: "security_failure",
        outcomeCode: "passkey_invalid",
      });
      return problem(
        400,
        "invalid_input",
        "Passkey registration proof is invalid",
      );
    }
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      return problem(
        400,
        "invalid_input",
        "Passkey registration was not verified",
      );
    }
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    const subjectHash = await hash(
      `punks.passkey-subject.v1\n${credential.id}`,
    );
    const credentialObject = env.PASSKEY_CREDENTIALS.getByName(
      await aggregateName("passkey-credential", credential.id),
    );
    const transactionId = input.flowId;
    const reserved = await credentialObject.reserve({
      credentialId: credential.id,
      punkId: launched.flow.currentPunkId,
      subjectHash,
      publicKey: bytesToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transactionId,
      now: new Date().toISOString(),
    });
    if (!reserved.ok) {
      return problem(
        409,
        "identity_conflict",
        "Passkey belongs to another Punk",
      );
    }
    const recorded = await stub.recordBrowserComplete({
      browserBindingHash: bindingHash,
      pendingPasskey: {
        credentialId: credential.id,
        subjectHash,
        emailHash: await hash(`punks.passkey-no-email.v1\n${credential.id}`),
        transactionId,
      },
      outcomeCode: "passkey_registration_pending",
    });
    if (
      !recorded.ok ||
      !(await stub.ready({
        punkId: launched.flow.currentPunkId,
        outcomeCode: "passkey_registration_pending",
      }))
    ) {
      await credentialObject.release({
        punkId: launched.flow.currentPunkId,
        transactionId,
      });
      return problem(
        409,
        "idempotency_conflict",
        "Passkey registration was cancelled",
      );
    }
  } else {
    const response = input.response as { id?: string };
    if (typeof response.id !== "string") {
      return problem(400, "invalid_input", "Passkey assertion is invalid");
    }
    const verified = await env.PASSKEY_CREDENTIALS.getByName(
      await aggregateName("passkey-credential", response.id),
    ).verifyAuthentication({
      ceremonyId: input.flowId,
      challenge: launched.flow.passkeyChallenge ?? launched.codeVerifier,
      origin: new URL(env.AUTH_BASE_URL).origin,
      rpId: env.WEBAUTHN_RP_ID,
      response: input.response as AuthenticationResponseJSON,
    });
    if (!verified.ok) {
      await stub.fail({
        browserBindingHash: bindingHash,
        result: "security_failure",
        outcomeCode: "passkey_unknown_or_invalid",
      });
      return problem(401, "unauthenticated", "Passkey authentication failed");
    }
    if (
      launched.flow.intent === "reauthenticate" &&
      (launched.flow.currentPunkId !== verified.punkId ||
        launched.flow.currentSessionId === null)
    ) {
      return problem(403, "forbidden", "Passkey is bound to another Punk");
    }
    if (!(await stub.recordPasskeyAuthentication(await hash(response.id)))) {
      return problem(
        409,
        "idempotency_conflict",
        "Passkey authentication binding was not recorded",
      );
    }
    await stub.recordBrowserComplete({ browserBindingHash: bindingHash });
    await stub.ready({
      punkId: verified.punkId,
      outcomeCode: "passkey_authenticated",
    });
  }
  return json(
    { completionUrl: completionUrl(env.ENVIRONMENT, input.flowId) },
    200,
    launched.flow.oauthState === null
      ? {}
      : { "set-cookie": clearOauthCookie(launched.flow.oauthState) },
  );
}
