import type {
  DesktopAuthCancelRequest,
  DesktopAuthCancelResponse,
  DesktopAuthClaimRequest,
  DesktopAuthClaimResponse,
  DesktopAuthConfirmRequest,
  DesktopAuthConfirmResponse,
  DesktopAuthStatusRequest,
  DesktopAuthStatusResponse,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import { desktopAuthDecision } from "./desktop-auth-browser-page";
import { commitDesktopBrowserEffect } from "./desktop-auth";
import type { DesktopAuthFlowRecord } from "./desktop-auth-flow-do";
import { pkceChallenge } from "./crypto";
import type { AuthEnv } from "./env";
import { json, problem, readJson } from "./http";
import {
  aggregateName,
  canonicalPunk,
  prepareDesktopSessionForToken,
  resolveActivePunk,
  sameDesktopDistribution,
} from "./session";

type FlowStub = DurableObjectStub<
  import("./desktop-auth-flow-do").DesktopAuthFlowDO
>;

function flowStub(env: AuthEnv, flowId: string): FlowStub {
  return env.DESKTOP_AUTH_FLOWS.getByName(flowId);
}

function requestMessage<T extends { message: string }>(
  value: T,
): value is T & { message: "request" } {
  return value.message === "request";
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

function validateResponse(
  contract: Parameters<typeof validateContract>[0],
  body: unknown,
): boolean {
  return validateContract(contract, body).valid;
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

export async function statusDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await commandBody<DesktopAuthStatusRequest>(
    request,
    "punks://contracts/desktop-auth.status@1",
  );
  if (command === null || !requestMessage(command)) {
    return problem(400, "invalid_input", "Desktop status is invalid");
  }
  const flow = await flowStub(env, command.flowId).status(
    command.verifierCommitment,
  );
  if (flow === null) {
    return problem(404, "not_found", "Desktop auth flow is unavailable");
  }
  const body: DesktopAuthStatusResponse = {
    contract: "desktop-auth.status@1",
    message: "response",
    flowId: flow.flowId,
    phase: flow.phase,
    terminal: ["confirmed", "cancelled", "expired"].includes(flow.phase),
    expiresAt: flow.expiresAt,
    result: flow.result,
    outcomeCode: flow.outcomeCode,
    decision: desktopAuthDecision(flow),
  };
  return validateResponse("punks://contracts/desktop-auth.status@1", body)
    ? json(body)
    : problem(500, "internal", "Desktop status response is invalid");
}

export async function claimDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await commandBody<DesktopAuthClaimRequest>(
    request,
    "punks://contracts/desktop-auth.claim@1",
  );
  if (command === null || !requestMessage(command)) {
    return problem(400, "invalid_input", "Desktop claim is invalid");
  }
  const claimed = await flowStub(env, command.flowId).claim(
    await pkceChallenge(command.verifier),
  );
  if (!claimed.ok) {
    return problem(
      claimed.code === "binding_mismatch" ? 403 : 409,
      claimed.code === "binding_mismatch"
        ? "forbidden"
        : "idempotency_conflict",
      `Desktop claim is ${claimed.code}`,
    );
  }
  if (!(await boundSessionIsActive(env, claimed.flow))) {
    await flowStub(env, command.flowId).cancel(claimed.flow.verifierCommitment);
    return problem(401, "unauthenticated", "Bound native Session expired");
  }
  if (claimed.kind === "reauthorization") {
    if (
      claimed.flow.currentSessionId === null ||
      claimed.flow.currentPunkId === null ||
      claimed.flow.purpose === null ||
      claimed.flow.authorizationExpiresAt === null
    ) {
      return problem(500, "internal", "Reauthorization binding is incomplete");
    }
    const body = {
      contract: "desktop-auth.claim@1",
      message: "response",
      flowId: claimed.flow.flowId,
      phase: "delivering",
      deliveryKind: "reauthorization",
      deliveryId: claimed.deliveryId,
      authorization: {
        authorizationId: claimed.authorizationId,
        sessionId: claimed.flow.currentSessionId,
        punkId: claimed.flow.currentPunkId,
        intent: "reauthenticate",
        targetMethod: claimed.flow.purpose,
        ...(claimed.flow.workspaceOwnershipTransfer === null ||
        claimed.flow.workspaceOwnershipTransfer === undefined
          ? {}
          : {
              workspaceOwnershipTransfer:
                claimed.flow.workspaceOwnershipTransfer,
            }),
        handoffId: claimed.flow.flowId,
        expiresAt: claimed.flow.authorizationExpiresAt,
      },
      deliveryExpiresAt: claimed.flow.expiresAt,
    } as const;
    return validateResponse("punks://contracts/desktop-auth.claim@1", body)
      ? json(body)
      : problem(500, "internal", "Desktop reauthorization response is invalid");
  }
  if (claimed.flow.punkId === null) {
    return problem(500, "internal", "Desktop claim has no Punk");
  }
  const punk = await resolveActivePunk(env, claimed.flow.punkId);
  if (punk === null) {
    return problem(401, "unauthenticated", "Desktop Punk is unavailable");
  }
  const prepared = await prepareDesktopSessionForToken(
    env,
    canonicalPunk(punk),
    claimed.sessionToken,
  );
  if (
    !(await flowStub(env, command.flowId).recordPreparedSession({
      deliveryId: claimed.deliveryId,
      sessionId: prepared.value.sessionId,
    })) ||
    !(await env.SESSION_REVOCATIONS.getByName(
      await aggregateName("session-revocation", claimed.revokeCapability),
    ).create({
      sessionId: prepared.value.sessionId,
      expiresAt: prepared.value.expiresAt,
    }))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Desktop delivery is incomplete",
    );
  }
  const body: DesktopAuthClaimResponse = {
    contract: "desktop-auth.claim@1",
    message: "response",
    flowId: claimed.flow.flowId,
    phase: "delivering",
    deliveryKind: "session",
    deliveryId: claimed.deliveryId,
    session: prepared.value,
    revokeCapability: {
      token: claimed.revokeCapability,
      expiresAt: prepared.value.expiresAt,
    },
    deliveryExpiresAt: claimed.flow.expiresAt,
  };
  return validateResponse("punks://contracts/desktop-auth.claim@1", body)
    ? json(body, 200, { "set-cookie": prepared.cookie })
    : problem(500, "internal", "Desktop claim response is invalid");
}

export async function confirmDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await commandBody<DesktopAuthConfirmRequest>(
    request,
    "punks://contracts/desktop-auth.confirm@1",
  );
  if (command === null || !requestMessage(command)) {
    return problem(400, "invalid_input", "Desktop confirmation is invalid");
  }
  const stub = flowStub(env, command.flowId);
  const confirmation = await stub.confirmation({
    verifierCommitment: await pkceChallenge(command.verifier),
    deliveryId: command.deliveryId,
  });
  if (!confirmation.ok) {
    return problem(
      409,
      "idempotency_conflict",
      "Desktop confirmation is unavailable",
    );
  }
  const sessionId =
    confirmation.flow.intent === "reauthenticate"
      ? confirmation.flow.currentSessionId
      : confirmation.flow.sessionId;
  if (sessionId === null) {
    return problem(500, "internal", "Desktop confirmation has no Session");
  }
  if (
    confirmation.flow.intent === "link_google" ||
    confirmation.flow.intent === "link_github" ||
    confirmation.flow.intent === "register_passkey"
  ) {
    const effect = await commitDesktopBrowserEffect(env, confirmation.flow);
    if (!effect.ok) {
      if (effect.code === "temporarily_unavailable") {
        return problem(
          503,
          "temporarily_unavailable",
          "Sensitive desktop effect is not committed",
        );
      }
      await stub.failDelivery({
        deliveryId: command.deliveryId,
        result: "security_failure",
        outcomeCode: effect.code,
      });
      return problem(
        409,
        "identity_conflict",
        `Sensitive desktop effect is ${effect.code}`,
      );
    }
    if (!(await stub.browserEffectCommitted(command.deliveryId))) {
      return problem(
        503,
        "temporarily_unavailable",
        "Sensitive desktop effect confirmation is incomplete",
      );
    }
  }
  if (
    confirmation.flow.intent !== "reauthenticate" &&
    !(await env.SESSIONS.getByName(sessionId).activatePrepared(sessionId))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Prepared Session is unavailable",
    );
  }
  if (confirmation.flow.intent === "reauthenticate") {
    if (
      confirmation.flow.authorizationId === null ||
      confirmation.flow.authorizationExpiresAt === null ||
      confirmation.flow.currentSessionId === null ||
      confirmation.flow.currentPunkId === null ||
      confirmation.flow.purpose === null
    ) {
      return problem(500, "internal", "Reauthentication grant is incomplete");
    }
    const expiresAt = confirmation.flow.authorizationExpiresAt;
    if (Date.parse(expiresAt) <= Date.now()) {
      await stub.cancel(confirmation.flow.verifierCommitment);
      return problem(
        409,
        "idempotency_conflict",
        "Reauthentication authorization expired before confirmation",
      );
    }
    if (
      !(await env.DESKTOP_REAUTH_GRANTS.getByName(
        confirmation.flow.authorizationId,
      ).create({
        authorizationId: confirmation.flow.authorizationId,
        sessionId: confirmation.flow.currentSessionId,
        punkId: confirmation.flow.currentPunkId,
        targetMethod: confirmation.flow.purpose,
        workspaceOwnershipTransfer:
          confirmation.flow.workspaceOwnershipTransfer ?? null,
        handoffId: confirmation.flow.flowId,
        expiresAt,
      }))
    ) {
      return problem(
        503,
        "temporarily_unavailable",
        "Reauthentication grant could not be sealed",
      );
    }
  }
  if (
    confirmation.flow.intent !== "reauthenticate" &&
    confirmation.flow.currentSessionId !== null &&
    confirmation.flow.currentSessionId !== sessionId
  ) {
    await env.SESSIONS.getByName(confirmation.flow.currentSessionId).revoke();
  }
  const confirmed = await stub.confirmed({
    deliveryId: command.deliveryId,
    sessionId,
  });
  if (confirmed === null || confirmed.confirmedAt === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Confirmation was not recorded",
    );
  }
  const body: DesktopAuthConfirmResponse = {
    contract: "desktop-auth.confirm@1",
    message: "response",
    flowId: confirmed.flowId,
    phase: "confirmed",
    sessionId,
    confirmedAt: confirmed.confirmedAt,
  };
  return validateResponse("punks://contracts/desktop-auth.confirm@1", body)
    ? json(body)
    : problem(500, "internal", "Desktop confirmation response is invalid");
}

export async function cancelDesktopAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await commandBody<DesktopAuthCancelRequest>(
    request,
    "punks://contracts/desktop-auth.cancel@1",
  );
  if (command === null || !requestMessage(command)) {
    return problem(400, "invalid_input", "Desktop cancellation is invalid");
  }
  const flow = await flowStub(env, command.flowId).cancel(
    await pkceChallenge(command.verifier),
  );
  if (flow === null || flow.cancelledAt === null) {
    return problem(
      409,
      "idempotency_conflict",
      "Desktop flow cannot be cancelled",
    );
  }
  const body: DesktopAuthCancelResponse = {
    contract: "desktop-auth.cancel@1",
    message: "response",
    flowId: flow.flowId,
    phase: "cancelled",
    cancelledAt: flow.cancelledAt,
  };
  return validateResponse("punks://contracts/desktop-auth.cancel@1", body)
    ? json(body)
    : problem(500, "internal", "Desktop cancellation response is invalid");
}
