import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/u;
const METHODS = Object.freeze(["google", "github"]);

function fail(message) {
  throw new Error(`live staging Auth proof rejected: ${message}`);
}

function args(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--matrix",
    "--staging-proof",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag))
      fail("invalid CLI arguments");
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (name) => values.get(name);
}

function exact(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

export function validateLiveAuthProof(proof, expected) {
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
    proof.sourceSha !== expected.sourceSha ||
    proof.stagingDeploymentId !== expected.stagingDeploymentId ||
    proof.authWorkerVersionId !== expected.authWorkerVersionId ||
    proof.flow?.flowId !== expected.flowId ||
    proof.flow?.sourceSha !== expected.sourceSha ||
    proof.flow?.stagingDeploymentId !== expected.stagingDeploymentId ||
    !["github", "google"].includes(proof.flow?.method) ||
    proof.flow?.environment !== "staging" ||
    !UUID_RE.test(proof.flow?.punkId ?? "") ||
    !UUID_RE.test(proof.flow?.sessionId ?? "") ||
    proof.negative?.wrongOauthState !== "refused" ||
    proof.negative?.wrongBrowserBinding !== "refused" ||
    proof.negative?.wrongNativePkceVerifier !== "refused" ||
    !Number.isFinite(Date.parse(proof.observedAt ?? ""))
  ) {
    fail("proof does not bind one confirmed real provider flow");
  }
  return proof;
}

function validMatrixCoordinates(matrix) {
  if (
    !exact(matrix, METHODS) ||
    METHODS.some(
      (method) =>
        !exact(matrix[method], ["successFlowId", "cancellationFlowId"]) ||
        !UUID_RE.test(matrix[method].successFlowId ?? "") ||
        !UUID_RE.test(matrix[method].cancellationFlowId ?? "") ||
        matrix[method].successFlowId === matrix[method].cancellationFlowId,
    )
  ) {
    return false;
  }
  const ids = METHODS.flatMap((method) => Object.values(matrix[method]));
  return new Set(ids).size === ids.length;
}

function validCommonFlow(flow, method, expected) {
  return (
    flow?.method === method &&
    flow.intent === "sign_in" &&
    flow.environment === "staging" &&
    SHA256_RE.test(flow.browserBindingHash ?? "") &&
    VERIFIER_RE.test(flow.nativeVerifierCommitment ?? "") &&
    flow.sourceSha === expected.sourceSha &&
    flow.stagingDeploymentId === expected.stagingDeploymentId
  );
}

function validSuccessFlow(flow, method, flowId, expected) {
  if (
    !exact(flow, [
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
    !validCommonFlow(flow, method, expected) ||
    flow.flowId !== flowId ||
    flow.outcomeCode !== "authenticated" ||
    !UUID_RE.test(flow.punkId ?? "") ||
    !UUID_RE.test(flow.sessionId ?? "") ||
    !Number.isFinite(Date.parse(flow.browserCompletedAt ?? "")) ||
    !Number.isFinite(Date.parse(flow.confirmedAt ?? "")) ||
    Date.parse(flow.confirmedAt) < Date.parse(flow.browserCompletedAt)
  ) {
    return false;
  }
  return (
    exact(flow.methodEvidence, [
      "kind",
      "oauthStateHash",
      "providerPkceHash",
    ]) &&
    flow.methodEvidence.kind === "oauth" &&
    SHA256_RE.test(flow.methodEvidence.oauthStateHash ?? "") &&
    SHA256_RE.test(flow.methodEvidence.providerPkceHash ?? "")
  );
}

function validCancellationFlow(flow, method, flowId, expected) {
  return (
    exact(flow, [
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
    ]) &&
    validCommonFlow(flow, method, expected) &&
    flow.flowId === flowId &&
    flow.outcomeCode === "cancelled" &&
    Number.isFinite(Date.parse(flow.cancelledAt ?? ""))
  );
}

export function validateLiveAuthMatrixProof(proof, expected) {
  if (
    !validMatrixCoordinates(expected.matrix) ||
    !exact(proof, [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "authWorkerVersionId",
      "flows",
      "negative",
      "observedAt",
    ]) ||
    proof.schema !== "punks.live-staging-auth-matrix-proof.v3" ||
    proof.sourceSha !== expected.sourceSha ||
    proof.stagingDeploymentId !== expected.stagingDeploymentId ||
    proof.authWorkerVersionId !== expected.authWorkerVersionId ||
    !exact(proof.flows, METHODS) ||
    METHODS.some(
      (method) =>
        !exact(proof.flows[method], ["success", "cancellation"]) ||
        !validSuccessFlow(
          proof.flows[method].success,
          method,
          expected.matrix[method].successFlowId,
          expected,
        ) ||
        !validCancellationFlow(
          proof.flows[method].cancellation,
          method,
          expected.matrix[method].cancellationFlowId,
          expected,
        ),
    ) ||
    new Set(METHODS.map((method) => proof.flows[method].success.punkId))
      .size !== 1 ||
    new Set(METHODS.map((method) => proof.flows[method].success.sessionId))
      .size !== METHODS.length ||
    !exact(proof.negative, [
      "wrongOauthState",
      "wrongBrowserBinding",
      "wrongNativePkceVerifier",
      "retiredPasskeyMethod",
    ]) ||
    Object.values(proof.negative).some((value) => value !== "refused") ||
    !Number.isFinite(Date.parse(proof.observedAt ?? ""))
  ) {
    fail("proof does not bind the complete live provider matrix");
  }
  return proof;
}

export async function proveLiveStagingAuth(input, { fetchImpl = fetch } = {}) {
  if (
    !SHA1_RE.test(input.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input.stagingDeploymentId ?? "") ||
    !UUID_RE.test(input.flowId ?? "") ||
    typeof input.operatorToken !== "string" ||
    input.operatorToken.length < 32
  ) {
    fail("exact source, staging, flow and operator coordinates are required");
  }
  const staging = validateStagingDeploymentProof(input.stagingProof, {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: input.sourceSha,
  });
  if (staging.deploymentId !== input.stagingDeploymentId) {
    fail("staging proof belongs to another deployment");
  }
  const auth = staging.workers.find(
    ({ name }) => name === "punks-auth-staging",
  );
  if (auth === undefined) fail("Auth Worker is absent from staging proof");
  const response = await fetchImpl(
    "https://staging.punks.bot/api/internal/v1/promotion/auth-proof",
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${input.operatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "promotion.auth-proof@1",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        flowId: input.flowId,
      }),
    },
  );
  if (response.status !== 200)
    fail(`Auth proof endpoint returned HTTP ${response.status}`);
  const document = await response.json();
  return validateLiveAuthProof(document?.proof, {
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    flowId: input.flowId,
    authWorkerVersionId: auth.versionId,
  });
}

export async function proveLiveStagingAuthMatrix(
  input,
  { fetchImpl = fetch } = {},
) {
  if (
    !SHA1_RE.test(input.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input.stagingDeploymentId ?? "") ||
    !validMatrixCoordinates(input.matrix) ||
    typeof input.operatorToken !== "string" ||
    input.operatorToken.length < 32
  ) {
    fail("exact source, staging and four terminal OAuth flows are required");
  }
  const staging = validateStagingDeploymentProof(input.stagingProof, {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: input.sourceSha,
  });
  if (staging.deploymentId !== input.stagingDeploymentId) {
    fail("staging proof belongs to another deployment");
  }
  const auth = staging.workers.find(
    ({ name }) => name === "punks-auth-staging",
  );
  if (auth === undefined) fail("Auth Worker is absent from staging proof");
  const response = await fetchImpl(
    "https://staging.punks.bot/api/internal/v1/promotion/auth-proof",
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${input.operatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "promotion.auth-matrix-proof@3",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        flows: input.matrix,
      }),
    },
  );
  if (response.status !== 200) {
    fail(`Auth matrix proof endpoint returned HTTP ${response.status}`);
  }
  const document = await response.json();
  return validateLiveAuthMatrixProof(document?.proof, {
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    matrix: input.matrix,
    authWorkerVersionId: auth.versionId,
  });
}

export async function run(argv = process.argv.slice(2)) {
  const required = args(argv);
  const operatorToken = process.env.PUNKS_OPERATOR_TOKEN;
  const stagingProof = JSON.parse(
    readFileSync(resolve(required("--staging-proof")), "utf8"),
  );
  const matrix = JSON.parse(
    readFileSync(resolve(required("--matrix")), "utf8"),
  );
  const proof = await proveLiveStagingAuthMatrix({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    matrix,
    operatorToken,
    stagingProof,
  });
  writeFileSync(
    resolve(required("--output")),
    `${JSON.stringify(proof, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return proof;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
