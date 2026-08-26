import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_STAGING_ACCOUNT_ID,
  createCloudflareApiBoundary,
  createStagingDeploymentProof,
  observeStagingDeployment,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { canonicalSha256 } from "../migration-manifest-lib.mjs";

const API_BASE = "https://api.cloudflare.com/client/v4";
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,512}$/u;
const WORKFLOW_NAME = "punks-bot-wake-staging";
const WORKFLOW_SCRIPT = "punks-bot-runtime-staging";
const WORKFLOW_CLASS = "BotWakeWorkflow";

function fail(message) {
  throw new Error(`operational topology observation rejected: ${message}`);
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

function generation(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(`${label} generation is invalid`);
  }
  return number;
}

function validateSecurityGenerations(value) {
  exact(
    value,
    [
      "compatibility",
      "operatorProvisioning",
      "promotionSession",
      "releaseApprovers",
      "r2Primary",
      "r2Recovery",
      "attestationPrimary",
      "attestationSecondary",
      "sessionRecovery",
    ],
    "security generations",
  );
  return Object.fromEntries(
    Object.entries(value).map(([name, value]) => [
      name,
      generation(value, name),
    ]),
  );
}

function validateWorkflow(workflow) {
  if (
    workflow?.name !== WORKFLOW_NAME ||
    workflow.script_name !== WORKFLOW_SCRIPT ||
    workflow.class_name !== WORKFLOW_CLASS ||
    typeof workflow.id !== "string" ||
    workflow.id.length === 0 ||
    typeof workflow.created_on !== "string" ||
    !Number.isFinite(Date.parse(workflow.created_on)) ||
    typeof workflow.modified_on !== "string" ||
    !Number.isFinite(Date.parse(workflow.modified_on))
  ) {
    fail("exact remotely deployed staging Workflow is required");
  }
  return workflow;
}

function validateWorkflowVersion(version) {
  if (
    version === null ||
    typeof version !== "object" ||
    Array.isArray(version) ||
    typeof version.id !== "string" ||
    version.id.length === 0 ||
    typeof version.created_on !== "string" ||
    !Number.isFinite(Date.parse(version.created_on))
  ) {
    fail("exact remote Workflow version is required");
  }
  return version;
}

export function validateOperationalTopologyObservation(observation, expected) {
  exact(
    observation,
    [
      "schema",
      "accountId",
      "sourceSha",
      "stagingDeploymentId",
      "workers",
      "workflows",
      "securityGenerations",
      "observedAt",
      "sha256",
    ],
    "topology observation",
  );
  const { sha256, ...content } = observation;
  if (
    observation.schema !== "punks.operational-topology-observation.v1" ||
    observation.accountId !== CANONICAL_STAGING_ACCOUNT_ID ||
    observation.sourceSha !== expected.sourceSha ||
    observation.stagingDeploymentId !== expected.stagingDeploymentId ||
    !Array.isArray(observation.workers) ||
    observation.workers.length !== 7 ||
    !Array.isArray(observation.workflows) ||
    observation.workflows.length !== 1 ||
    !Number.isFinite(Date.parse(observation.observedAt ?? "")) ||
    canonicalSha256(content) !== sha256
  ) {
    fail("topology observation identity or digest diverges");
  }
  const workflow = observation.workflows[0];
  validateWorkflow({
    name: workflow.name,
    id: workflow.id,
    script_name: workflow.scriptName,
    class_name: workflow.className,
    created_on: workflow.createdOn,
    modified_on: workflow.modifiedOn,
  });
  validateWorkflowVersion({
    id: workflow.versionId,
    created_on: workflow.versionCreatedOn,
  });
  validateSecurityGenerations(observation.securityGenerations);
  return observation;
}

export function createCloudflareTopologyBoundary({
  token,
  fetchImpl = globalThis.fetch,
}) {
  if (!TOKEN_RE.test(token ?? "") || typeof fetchImpl !== "function") {
    fail("bounded Cloudflare credential is required");
  }
  const read = async (path) => {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response?.ok) {
      fail(`Cloudflare topology API returned HTTP ${response?.status}`);
    }
    const envelope = await response.json();
    if (
      envelope?.success !== true ||
      !Array.isArray(envelope.errors) ||
      envelope.errors.length !== 0 ||
      !("result" in envelope)
    ) {
      fail("Cloudflare topology API returned an invalid envelope");
    }
    return envelope.result;
  };
  const account = `/accounts/${CANONICAL_STAGING_ACCOUNT_ID}`;
  return {
    staging: createCloudflareApiBoundary({ apiToken: token, fetchImpl }),
    async listWorkflows() {
      const result = await read(`${account}/workflows?per_page=100&page=1`);
      if (!Array.isArray(result)) fail("Cloudflare Workflow list is invalid");
      return result;
    },
    async listWorkflowVersions(name) {
      const result = await read(
        `${account}/workflows/${encodeURIComponent(name)}/versions?per_page=100&page=1`,
      );
      if (!Array.isArray(result))
        fail("Cloudflare Workflow versions are invalid");
      return result;
    },
  };
}

export async function observeOperationalTopology(
  input,
  { cloudflare, now = () => new Date() },
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "")
  ) {
    fail("exact source and staging deployment are required");
  }
  const request = {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: input.sourceSha,
  };
  const staging = createStagingDeploymentProof(
    await observeStagingDeployment(request, cloudflare.staging),
  );
  if (staging.deploymentId !== input.stagingDeploymentId) {
    fail("remote Worker deployment diverges from the candidate");
  }
  const workflows = (await cloudflare.listWorkflows()).filter(
    ({ name }) => name === WORKFLOW_NAME,
  );
  if (workflows.length !== 1) {
    fail("staging Workflow is missing or ambiguous");
  }
  const workflow = validateWorkflow(workflows[0]);
  const versions = await cloudflare.listWorkflowVersions(WORKFLOW_NAME);
  if (versions.length < 1) fail("staging Workflow has no remote version");
  const latest = validateWorkflowVersion(versions[0]);
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("topology observation clock is invalid");
  }
  const content = {
    schema: "punks.operational-topology-observation.v1",
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    workers: staging.workers,
    workflows: [
      {
        name: workflow.name,
        id: workflow.id,
        scriptName: workflow.script_name,
        className: workflow.class_name,
        versionId: latest.id,
        createdOn: workflow.created_on,
        modifiedOn: workflow.modified_on,
        versionCreatedOn: latest.created_on,
      },
    ],
    securityGenerations: validateSecurityGenerations(input.securityGenerations),
    observedAt: observedAt.toISOString(),
  };
  return validateOperationalTopologyObservation(
    { ...content, sha256: canonicalSha256(content) },
    input,
  );
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--security-generations",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag)) {
      fail("exact CLI arguments are required");
    }
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (name) => values.get(name);
}

export async function run(argv = process.argv.slice(2), boundary) {
  const required = parseArgs(argv);
  const securityGenerations = JSON.parse(
    readFileSync(resolve(required("--security-generations")), "utf8"),
  );
  const observation = await observeOperationalTopology(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      securityGenerations,
    },
    {
      cloudflare:
        boundary ??
        createCloudflareTopologyBoundary({
          token: process.env.CLOUDFLARE_API_TOKEN,
        }),
    },
  );
  writeFileSync(
    resolve(required("--output")),
    `${JSON.stringify(observation, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return observation;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
