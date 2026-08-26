import type { ApiEnv } from "./env";
import {
  authenticatedPunkSession,
  isOperator,
  json,
  problem,
  readJson,
} from "./http";
import {
  injectPromotionAuthorityFault,
  observePromotionAuthorityFault,
  probePromotionAuthorityFault,
  recoverPromotionAuthorityFault,
  type PromotionAuthorityBoundaryState,
} from "./promotion-authority-boundary";
import type {
  PromotionFaultIdentity,
  PromotionFaultRecoverInput,
} from "./promotion-fault-do";
import {
  isPromotionFaultExecutionId,
  isPromotionRecoveryProof,
  parsePromotionFaultIdentity,
} from "./promotion-fault-do";

function exactRecord(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

async function body(request: Request): Promise<unknown | null> {
  try {
    return await readJson(request, 8_192);
  } catch {
    return null;
  }
}

function injectedProblem(probe: PromotionFaultIdentity): Response {
  if (probe.type === "revocation") {
    return problem(401, "unauthenticated", "Injected Session revocation");
  }
  if (probe.type === "perte-autorite") {
    return problem(
      409,
      "revision_conflict",
      "Injected authority generation loss",
    );
  }
  return problem(503, "temporarily_unavailable", "Injected authority cut");
}

function sameAuthorityState(
  identity: PromotionFaultIdentity,
  state: PromotionAuthorityBoundaryState,
): boolean {
  return (
    state.executionId === identity.executionId &&
    state.candidateSha === identity.candidateSha &&
    state.stagingDeploymentId === identity.stagingDeploymentId &&
    state.type === identity.type &&
    state.authority === identity.authority &&
    state.target.kind === identity.target.kind &&
    state.target.id === identity.target.id
  );
}

function controllerFailure(
  operation: "inject" | "recover",
  error: unknown,
): Response {
  const message = error instanceof Error ? error.message : String(error);
  const conflicts = new Set([
    "promotion fault execution conflicts with durable state",
    "promotion fault recovery has no matching injection",
    "promotion fault recovery proof is out of order",
    "promotion authority already has another active fault",
    "promotion authority recovery has no matching fault",
    "promotion authority recovery proof is out of order",
    "recovered promotion authority fault cannot be reopened",
  ]);
  if (conflicts.has(message)) {
    return problem(
      409,
      "idempotency_conflict",
      `Fault ${operation} conflicts with durable state`,
    );
  }
  console.error(
    JSON.stringify({
      message: `promotion fault ${operation} failed`,
      error: message,
    }),
  );
  return problem(
    503,
    "temporarily_unavailable",
    "Promotion fault controller is unavailable",
  );
}

export async function routePromotionFault(
  request: Request,
  env: ApiEnv,
  path: string,
): Promise<Response | null> {
  const observePath = "/api/v1/promotion/faults/observe";
  const internalPath = path.startsWith("/api/internal/v1/promotion/faults/");
  if (!internalPath && path !== observePath) return null;
  if (env.PROMOTION_FAULTS_ENABLED !== "true") {
    return problem(404, "not_found", "Resource not found");
  }
  if (path === observePath) {
    if (request.method !== "POST") {
      return problem(405, "invalid_input", "POST is required");
    }
    if ((await authenticatedPunkSession(request, env)) === null) {
      return problem(401, "unauthenticated", "Active Punks Session required");
    }
    const value = await body(request);
    if (
      !exactRecord(value, [
        "contract",
        "executionId",
        "candidateSha",
        "stagingDeploymentId",
        "type",
        "authority",
        "target",
      ]) ||
      value.contract !== "promotion.fault-observe@1"
    ) {
      return problem(400, "invalid_input", "Fault observation is invalid");
    }
    const identity = parsePromotionFaultIdentity(value);
    if (identity === null) {
      return problem(
        400,
        "invalid_input",
        "Fault observation identity is invalid",
      );
    }
    const probe = await env.PROMOTION_FAULTS.getByName(
      identity.executionId,
    ).probe();
    if (probe.status === "missing") {
      return problem(404, "not_found", "Fault execution not found");
    }
    if (
      probe.executionId !== identity.executionId ||
      probe.candidateSha !== identity.candidateSha ||
      probe.stagingDeploymentId !== identity.stagingDeploymentId ||
      probe.type !== identity.type ||
      probe.authority !== identity.authority
    ) {
      return problem(
        409,
        "idempotency_conflict",
        "Fault observation conflicts with injected authority",
      );
    }
    let authorityState: PromotionAuthorityBoundaryState;
    try {
      authorityState = await observePromotionAuthorityFault(env, identity);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("promotion authority fault is active")) {
        return injectedProblem(identity);
      }
      return controllerFailure("inject", error);
    }
    if (!sameAuthorityState(identity, authorityState)) {
      return problem(
        503,
        "temporarily_unavailable",
        "Faulted authority state is unavailable",
      );
    }
    return json(
      {
        contract: "promotion.fault-observe@1",
        executionId: authorityState.executionId,
        authority: authorityState.authority,
        status: "recovered",
      },
      200,
      { "cache-control": "no-store" },
    );
  }
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(403, "forbidden", "Operator fault control is forbidden");
  }
  if (request.method !== "POST") {
    return problem(405, "invalid_input", "POST is required");
  }
  const value = await body(request);
  if (path.endsWith("/probe")) {
    if (
      !exactRecord(value, ["contract", "executionId"]) ||
      value.contract !== "promotion.fault-probe@1" ||
      typeof value.executionId !== "string" ||
      !isPromotionFaultExecutionId(value.executionId)
    ) {
      return problem(400, "invalid_input", "Fault probe is invalid");
    }
    const probe = await env.PROMOTION_FAULTS.getByName(
      value.executionId,
    ).probe();
    if (probe.status === "missing") {
      return problem(404, "not_found", "Fault execution not found");
    }
    const identity: PromotionFaultIdentity = {
      executionId: probe.executionId,
      candidateSha: probe.candidateSha,
      stagingDeploymentId: probe.stagingDeploymentId,
      type: probe.type,
      authority: probe.authority,
      target: probe.target,
    };
    let authorityState: PromotionAuthorityBoundaryState | null;
    try {
      authorityState = await probePromotionAuthorityFault(env, identity);
    } catch (error) {
      return controllerFailure("inject", error);
    }
    if (
      authorityState === null ||
      !sameAuthorityState(identity, authorityState)
    ) {
      return problem(
        503,
        "temporarily_unavailable",
        "Faulted authority state is unavailable",
      );
    }
    if (
      authorityState.phase === "injected" ||
      authorityState.phase === "recovering"
    ) {
      return injectedProblem(authorityState);
    }
    return json(
      {
        status: "recovered",
        executionId: authorityState.executionId,
        authorityState,
      },
      200,
      { "cache-control": "no-store" },
    );
  }
  if (path.endsWith("/inject")) {
    if (
      !exactRecord(value, [
        "contract",
        "executionId",
        "candidateSha",
        "stagingDeploymentId",
        "type",
        "authority",
        "target",
      ]) ||
      value.contract !== "promotion.fault-inject@1"
    ) {
      return problem(400, "invalid_input", "Fault injection is invalid");
    }
    const input = parsePromotionFaultIdentity(value);
    if (input === null)
      return problem(400, "invalid_input", "Fault identity is invalid");
    try {
      const receipt = await env.PROMOTION_FAULTS.getByName(
        input.executionId,
      ).inject(input);
      const authorityState = await injectPromotionAuthorityFault(env, input);
      if (
        !sameAuthorityState(input, authorityState) ||
        authorityState.phase !== "injected" ||
        authorityState.sequence !== 1
      ) {
        throw new Error("promotion authority rejected the injected fault");
      }
      return json({ receipt, authorityState }, receipt.replayed ? 200 : 201, {
        "cache-control": "no-store",
      });
    } catch (error) {
      return controllerFailure("inject", error);
    }
  }
  if (path.endsWith("/recover")) {
    if (
      !exactRecord(value, [
        "contract",
        "executionId",
        "candidateSha",
        "stagingDeploymentId",
        "type",
        "authority",
        "target",
        "proof",
      ]) ||
      value.contract !== "promotion.fault-recover@1"
    ) {
      return problem(400, "invalid_input", "Fault recovery is invalid");
    }
    const base = parsePromotionFaultIdentity(value);
    if (
      base === null ||
      typeof value.proof !== "string" ||
      !isPromotionRecoveryProof(value.proof)
    ) {
      return problem(
        400,
        "invalid_input",
        "Fault recovery identity is invalid",
      );
    }
    const input: PromotionFaultRecoverInput = {
      ...base,
      proof: value.proof,
    };
    try {
      const receipt = await env.PROMOTION_FAULTS.getByName(
        input.executionId,
      ).recover(input);
      const authorityState = await recoverPromotionAuthorityFault(env, input);
      if (
        !sameAuthorityState(input, authorityState) ||
        authorityState.proof !== input.proof ||
        authorityState.sequence !== receipt.sequence ||
        authorityState.phase !== receipt.phase
      ) {
        throw new Error("promotion authority rejected the recovery proof");
      }
      return json({ receipt, authorityState }, 200, {
        "cache-control": "no-store",
      });
    } catch (error) {
      return controllerFailure("recover", error);
    }
  }
  return problem(404, "not_found", "Resource not found");
}
