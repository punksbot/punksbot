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

function fail(message) {
  throw new Error(`live staging Auth proof rejected: ${message}`);
}

function args(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--flow-id",
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

export async function run(argv = process.argv.slice(2)) {
  const required = args(argv);
  const operatorToken = process.env.PUNKS_OPERATOR_TOKEN;
  const stagingProof = JSON.parse(
    readFileSync(resolve(required("--staging-proof")), "utf8"),
  );
  const proof = await proveLiveStagingAuth({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    flowId: required("--flow-id"),
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
