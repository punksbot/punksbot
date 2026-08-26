import type { ApiEnv } from "./env";
import { isOperator, json, problem, readJson } from "./http";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/u;
const METHODS = ["google", "github", "passkey"] as const;

function exact(
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

function validProof(
  proof: unknown,
  input: { sourceSha: string; stagingDeploymentId: string; flowId: string },
): boolean {
  if (
    !exact(proof, [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "authWorkerVersionId",
      "flow",
      "negative",
      "observedAt",
    ]) ||
    proof.schema !== "punks.live-staging-auth-proof.v1" ||
    proof.sourceSha !== input.sourceSha ||
    proof.stagingDeploymentId !== input.stagingDeploymentId ||
    typeof proof.authWorkerVersionId !== "string" ||
    !UUID_RE.test(proof.authWorkerVersionId) ||
    !exact(proof.flow, [
      "flowId",
      "method",
      "intent",
      "environment",
      "outcomeCode",
      "punkId",
      "sessionId",
      "browserCompletedAt",
      "confirmedAt",
      "browserBindingHash",
      "oauthStateHash",
      "providerPkceHash",
      "nativeVerifierCommitment",
      "sourceSha",
      "stagingDeploymentId",
    ]) ||
    proof.flow.flowId !== input.flowId ||
    proof.flow.sourceSha !== input.sourceSha ||
    proof.flow.stagingDeploymentId !== input.stagingDeploymentId ||
    !["google", "github"].includes(String(proof.flow.method)) ||
    proof.flow.environment !== "staging" ||
    !UUID_RE.test(String(proof.flow.punkId)) ||
    !UUID_RE.test(String(proof.flow.sessionId)) ||
    !exact(proof.negative, [
      "wrongOauthState",
      "wrongBrowserBinding",
      "wrongNativePkceVerifier",
    ]) ||
    Object.values(proof.negative).some((value) => value !== "refused") ||
    typeof proof.observedAt !== "string" ||
    !Number.isFinite(Date.parse(proof.observedAt))
  ) {
    return false;
  }
  return [
    proof.flow.browserBindingHash,
    proof.flow.oauthStateHash,
    proof.flow.providerPkceHash,
  ].every((value) => typeof value === "string" && SHA256_RE.test(value));
}

type MatrixCoordinates = Record<
  (typeof METHODS)[number],
  { successFlowId: string; cancellationFlowId: string }
>;

function validMatrixCoordinates(value: unknown): value is MatrixCoordinates {
  if (!exact(value, [...METHODS])) return false;
  const record = value as Record<string, unknown>;
  const ids: string[] = [];
  for (const method of METHODS) {
    const pair = record[method];
    if (
      !exact(pair, ["successFlowId", "cancellationFlowId"]) ||
      typeof pair.successFlowId !== "string" ||
      !UUID_RE.test(pair.successFlowId) ||
      typeof pair.cancellationFlowId !== "string" ||
      !UUID_RE.test(pair.cancellationFlowId) ||
      pair.successFlowId === pair.cancellationFlowId
    ) {
      return false;
    }
    ids.push(pair.successFlowId, pair.cancellationFlowId);
  }
  return new Set(ids).size === ids.length;
}

function validCommonMatrixFlow(
  flow: Record<string, unknown>,
  method: (typeof METHODS)[number],
  input: {
    sourceSha: string;
    stagingDeploymentId: string;
  },
): boolean {
  return (
    flow.method === method &&
    flow.intent === "sign_in" &&
    flow.environment === "staging" &&
    typeof flow.browserBindingHash === "string" &&
    SHA256_RE.test(flow.browserBindingHash) &&
    typeof flow.nativeVerifierCommitment === "string" &&
    VERIFIER_RE.test(flow.nativeVerifierCommitment) &&
    flow.sourceSha === input.sourceSha &&
    flow.stagingDeploymentId === input.stagingDeploymentId
  );
}

function validMatrixProof(
  proof: unknown,
  input: {
    sourceSha: string;
    stagingDeploymentId: string;
    flows: MatrixCoordinates;
  },
): boolean {
  if (
    !exact(proof, [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "authWorkerVersionId",
      "flows",
      "negative",
      "observedAt",
    ]) ||
    proof.schema !== "punks.live-staging-auth-matrix-proof.v2" ||
    proof.sourceSha !== input.sourceSha ||
    proof.stagingDeploymentId !== input.stagingDeploymentId ||
    typeof proof.authWorkerVersionId !== "string" ||
    !UUID_RE.test(proof.authWorkerVersionId) ||
    !exact(proof.flows, [...METHODS])
  ) {
    return false;
  }
  for (const method of METHODS) {
    const pair = proof.flows[method];
    if (!exact(pair, ["success", "cancellation"])) return false;
    const success = pair.success;
    const cancellation = pair.cancellation;
    if (
      !exact(success, [
        "flowId",
        "method",
        "intent",
        "environment",
        "outcomeCode",
        "punkId",
        "sessionId",
        "browserCompletedAt",
        "confirmedAt",
        "browserBindingHash",
        "nativeVerifierCommitment",
        "sourceSha",
        "stagingDeploymentId",
        "methodEvidence",
      ]) ||
      !validCommonMatrixFlow(success, method, input) ||
      success.flowId !== input.flows[method].successFlowId ||
      success.outcomeCode !==
        (method === "passkey" ? "passkey_authenticated" : "authenticated") ||
      typeof success.punkId !== "string" ||
      !UUID_RE.test(success.punkId) ||
      typeof success.sessionId !== "string" ||
      !UUID_RE.test(success.sessionId) ||
      typeof success.browserCompletedAt !== "string" ||
      !Number.isFinite(Date.parse(success.browserCompletedAt)) ||
      typeof success.confirmedAt !== "string" ||
      !Number.isFinite(Date.parse(success.confirmedAt)) ||
      Date.parse(success.confirmedAt) < Date.parse(success.browserCompletedAt)
    ) {
      return false;
    }
    const methodEvidence = success.methodEvidence;
    const methodEvidenceValid =
      method === "passkey"
        ? exact(methodEvidence, [
            "kind",
            "challengeHash",
            "credentialIdHash",
          ]) &&
          methodEvidence.kind === "passkey" &&
          typeof methodEvidence.challengeHash === "string" &&
          SHA256_RE.test(methodEvidence.challengeHash) &&
          typeof methodEvidence.credentialIdHash === "string" &&
          SHA256_RE.test(methodEvidence.credentialIdHash)
        : exact(methodEvidence, [
            "kind",
            "oauthStateHash",
            "providerPkceHash",
          ]) &&
          methodEvidence.kind === "oauth" &&
          typeof methodEvidence.oauthStateHash === "string" &&
          SHA256_RE.test(methodEvidence.oauthStateHash) &&
          typeof methodEvidence.providerPkceHash === "string" &&
          SHA256_RE.test(methodEvidence.providerPkceHash);
    if (!methodEvidenceValid) return false;
    if (
      !exact(cancellation, [
        "flowId",
        "method",
        "intent",
        "environment",
        "outcomeCode",
        "cancelledAt",
        "browserBindingHash",
        "nativeVerifierCommitment",
        "sourceSha",
        "stagingDeploymentId",
      ]) ||
      !validCommonMatrixFlow(cancellation, method, input) ||
      cancellation.flowId !== input.flows[method].cancellationFlowId ||
      cancellation.outcomeCode !== "cancelled" ||
      typeof cancellation.cancelledAt !== "string" ||
      !Number.isFinite(Date.parse(cancellation.cancelledAt))
    ) {
      return false;
    }
  }
  return (
    exact(proof.negative, [
      "wrongOauthState",
      "wrongBrowserBinding",
      "wrongNativePkceVerifier",
      "wrongPasskeyChallenge",
    ]) &&
    Object.values(proof.negative).every((value) => value === "refused") &&
    typeof proof.observedAt === "string" &&
    Number.isFinite(Date.parse(proof.observedAt))
  );
}

/** Operator read of one redacted, source-bound real staging OAuth proof. */
export async function routePromotionAuthProof(
  request: Request,
  env: ApiEnv,
  path: string,
): Promise<Response | null> {
  if (path !== "/api/internal/v1/promotion/auth-proof") return null;
  if (env.PROMOTION_SESSION_ISSUANCE_ENABLED !== "true") {
    return problem(404, "not_found", "Resource not found");
  }
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(403, "forbidden", "Operator Auth proof is forbidden");
  }
  if (request.method !== "POST") {
    return problem(405, "invalid_input", "POST is required");
  }
  let value: unknown;
  try {
    value = await readJson(request, 2_048);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Promotion Auth proof request is invalid",
    );
  }
  let input:
    | { sourceSha: string; stagingDeploymentId: string; flowId: string }
    | {
        sourceSha: string;
        stagingDeploymentId: string;
        flows: MatrixCoordinates;
      };
  if (
    exact(value, ["contract", "sourceSha", "stagingDeploymentId", "flowId"]) &&
    value.contract === "promotion.auth-proof@1" &&
    typeof value.sourceSha === "string" &&
    SHA1_RE.test(value.sourceSha) &&
    typeof value.stagingDeploymentId === "string" &&
    DEPLOYMENT_RE.test(value.stagingDeploymentId) &&
    typeof value.flowId === "string" &&
    UUID_RE.test(value.flowId)
  ) {
    input = {
      sourceSha: value.sourceSha,
      stagingDeploymentId: value.stagingDeploymentId,
      flowId: value.flowId,
    };
  } else if (
    exact(value, ["contract", "sourceSha", "stagingDeploymentId", "flows"]) &&
    value.contract === "promotion.auth-matrix-proof@2" &&
    typeof value.sourceSha === "string" &&
    SHA1_RE.test(value.sourceSha) &&
    typeof value.stagingDeploymentId === "string" &&
    DEPLOYMENT_RE.test(value.stagingDeploymentId) &&
    validMatrixCoordinates(value.flows)
  ) {
    input = {
      sourceSha: value.sourceSha,
      stagingDeploymentId: value.stagingDeploymentId,
      flows: value.flows,
    };
  } else {
    return problem(
      400,
      "invalid_input",
      "Promotion Auth proof request is invalid",
    );
  }
  let proof: unknown | null;
  try {
    proof = await env.AUTH_PROMOTION_PROOFS.attest(input);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Auth proof authority is unavailable",
    );
  }
  const valid =
    "flowId" in input
      ? validProof(proof, input)
      : validMatrixProof(proof, input);
  return valid
    ? json({ proof }, 200, { "cache-control": "no-store" })
    : problem(404, "not_found", "Confirmed Auth proof is unavailable");
}
