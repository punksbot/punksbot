import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_DEPLOYMENT_PROOF_SCHEMA =
  "punks.staging-aggregate-deployment-proof.v2";

export const CANONICAL_STAGING_ACCOUNT_ID = "3a391620584c792dbbd8cfa148d7634a";

export const CANONICAL_STAGING_WORKER_NAMES = Object.freeze([
  "punks-auth-staging",
  "punks-attestation-staging",
  "punks-erasure-staging",
  "punks-projector-staging",
  "punks-search-staging",
  "punks-api-staging",
  "punks-bot-runtime-staging",
]);

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const REQUEST_KEYS = Object.freeze(["accountId", "environment", "sourceSha"]);
const PROOF_KEYS = Object.freeze([
  "accountId",
  "deploymentId",
  "environment",
  "observer",
  "schema",
  "sourceSha",
  "workers",
]);
const PROOF_WORKER_KEYS = Object.freeze([
  "deploymentId",
  "name",
  "sourceShaAnnotation",
  "versionId",
]);
const REMOTE_OBSERVATION_KEYS = Object.freeze([
  "accountId",
  "environment",
  "sourceSha",
  "workers",
]);
const REMOTE_WORKER_KEYS = Object.freeze(["deployment", "name", "versions"]);
const VERSION_KEYS = Object.freeze(["annotations", "id", "metadata", "number"]);
const VERSION_METADATA_KEYS = Object.freeze([
  "author_email",
  "author_id",
  "created_on",
  "hasPreview",
  "has_preview",
  "modified_on",
  "source",
]);
const VERSION_ANNOTATION_KEYS = Object.freeze([
  "workers/message",
  "workers/tag",
  "workers/triggered_by",
]);
const DEPLOYMENT_KEYS = Object.freeze([
  "annotations",
  "author_email",
  "created_on",
  "id",
  "source",
  "strategy",
  "versions",
]);
const DEPLOYMENT_ANNOTATION_KEYS = Object.freeze([
  "workers/message",
  "workers/triggered_by",
]);
const DEPLOYMENT_VERSION_KEYS = Object.freeze(["percentage", "version_id"]);
const API_ENVELOPE_KEYS = Object.freeze([
  "errors",
  "messages",
  "result",
  "result_info",
  "success",
]);
const API_RESULT_INFO_KEYS = Object.freeze([
  "count",
  "page",
  "per_page",
  "total_count",
  "total_pages",
]);
const CLOUDFLARE_VERSION_SOURCES = Object.freeze([
  "api",
  "cf_cli",
  "dash",
  "dash_template",
  "integration",
  "playground",
  "quick_editor",
  "terraform",
  "unknown",
  "workersci",
  "wrangler",
]);
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;
const CLOUDFLARE_UPLOAD_TRIGGERS = Object.freeze(["upload", "version_upload"]);
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const VALIDATED_REMOTE_OBSERVATIONS = new WeakSet();

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, location) {
  if (!isRecord(value)) {
    throw new Error(`${location} must be a JSON object`);
  }
}

function assertExactKeys(value, expectedKeys, location) {
  const actualKeys = Object.keys(value).sort(compareText);
  const canonicalExpectedKeys = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== canonicalExpectedKeys.length ||
    actualKeys.some((key, index) => key !== canonicalExpectedKeys[index])
  ) {
    throw new Error(
      `${location} must contain exactly: ${canonicalExpectedKeys.join(", ")}`,
    );
  }
}

function assertAllowedKeys(value, allowedKeys, location) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value).sort(compareText)) {
    if (!allowed.has(key)) {
      throw new Error(`${location} contains unknown key: ${key}`);
    }
  }
}

function assertString(value, location) {
  if (typeof value !== "string") {
    throw new Error(`${location} must be a string`);
  }
}

function assertUuid(value, location) {
  assertString(value, location);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${location} must be a lowercase RFC 4122 UUID`);
  }
}

function assertIsoInstant(value, location) {
  assertString(value, location);
  if (!ISO_INSTANT_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${location} must be a canonical UTC ISO-8601 instant`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("canonical JSON only supports finite JSON values");
}

export function sourceShaAnnotation(sourceSha) {
  if (!GIT_SHA_PATTERN.test(sourceSha)) {
    throw new Error(
      "sourceSha must be an exact 40-character lowercase Git SHA",
    );
  }
  return `punks-source-sha:${sourceSha}`;
}

export function validateStagingDeploymentRequest(request) {
  assertRecord(request, "staging deployment request");
  assertExactKeys(request, REQUEST_KEYS, "staging deployment request");

  if (!ACCOUNT_ID_PATTERN.test(request.accountId)) {
    throw new Error("accountId must be an exact 32-character lowercase ID");
  }
  if (request.accountId !== CANONICAL_STAGING_ACCOUNT_ID) {
    throw new Error(
      `accountId must be the canonical staging account ${CANONICAL_STAGING_ACCOUNT_ID}`,
    );
  }
  if (request.environment !== "staging") {
    throw new Error("environment must be exactly staging");
  }
  if (!GIT_SHA_PATTERN.test(request.sourceSha)) {
    throw new Error(
      "sourceSha must be an exact 40-character lowercase Git SHA",
    );
  }
}

export const validateStagingDeploymentInput = validateStagingDeploymentRequest;

function validateVersionMetadata(metadata, location) {
  assertRecord(metadata, location);
  assertAllowedKeys(metadata, VERSION_METADATA_KEYS, location);
  assertIsoInstant(metadata.created_on, `${location}.created_on`);
  assertString(metadata.source, `${location}.source`);
  if (!CLOUDFLARE_VERSION_SOURCES.includes(metadata.source)) {
    throw new Error(`${location}.source is not a canonical Cloudflare source`);
  }
  for (const key of ["author_email", "author_id"]) {
    if (key in metadata) assertString(metadata[key], `${location}.${key}`);
  }
  if ("hasPreview" in metadata && "has_preview" in metadata) {
    throw new Error(`${location} contains ambiguous preview metadata`);
  }
  for (const key of ["hasPreview", "has_preview"]) {
    if (key in metadata && typeof metadata[key] !== "boolean") {
      throw new Error(`${location}.${key} must be a boolean`);
    }
  }
  if ("modified_on" in metadata) {
    assertIsoInstant(metadata.modified_on, `${location}.modified_on`);
  }
}

function validateAnnotations(annotations, allowedKeys, location) {
  assertRecord(annotations, location);
  assertAllowedKeys(annotations, allowedKeys, location);
  for (const [key, value] of Object.entries(annotations)) {
    assertString(value, `${location}.${key}`);
  }
}

function validateRemoteVersion(version, location) {
  assertRecord(version, location);
  assertAllowedKeys(version, VERSION_KEYS, location);
  assertUuid(version.id, `${location}.id`);
  if (
    "number" in version &&
    (!Number.isSafeInteger(version.number) || version.number < 1)
  ) {
    throw new Error(`${location}.number must be a positive safe integer`);
  }
  validateVersionMetadata(version.metadata, `${location}.metadata`);
  validateAnnotations(
    version.annotations,
    VERSION_ANNOTATION_KEYS,
    `${location}.annotations`,
  );
}

function validateDeployment(deployment, location) {
  assertRecord(deployment, location);
  assertAllowedKeys(deployment, DEPLOYMENT_KEYS, location);
  assertUuid(deployment.id, `${location}.id`);
  assertIsoInstant(deployment.created_on, `${location}.created_on`);
  assertString(deployment.source, `${location}.source`);
  if (!CLOUDFLARE_VERSION_SOURCES.includes(deployment.source)) {
    throw new Error(`${location}.source is not a canonical Cloudflare source`);
  }
  if (deployment.strategy !== "percentage") {
    throw new Error(`${location}.strategy must be exactly percentage`);
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    throw new Error(`${location}.versions must be a non-empty array`);
  }
  for (const [index, activeVersion] of deployment.versions.entries()) {
    const activeLocation = `${location}.versions[${index}]`;
    assertRecord(activeVersion, activeLocation);
    assertExactKeys(activeVersion, DEPLOYMENT_VERSION_KEYS, activeLocation);
    assertUuid(activeVersion.version_id, `${activeLocation}.version_id`);
    if (
      typeof activeVersion.percentage !== "number" ||
      !Number.isFinite(activeVersion.percentage) ||
      activeVersion.percentage < 0 ||
      activeVersion.percentage > 100
    ) {
      throw new Error(
        `${activeLocation}.percentage must be a finite number from 0 to 100`,
      );
    }
  }
  if ("annotations" in deployment) {
    validateAnnotations(
      deployment.annotations,
      DEPLOYMENT_ANNOTATION_KEYS,
      `${location}.annotations`,
    );
  }
  if ("author_email" in deployment) {
    assertString(deployment.author_email, `${location}.author_email`);
  }
}

function validateAndNormalizeRemoteObservation(raw, request) {
  assertRecord(raw, "remote observation");
  assertExactKeys(raw, REMOTE_OBSERVATION_KEYS, "remote observation");
  if (raw.accountId !== request.accountId) {
    throw new Error(
      "observed accountId does not match the requested accountId",
    );
  }
  if (raw.environment !== request.environment) {
    throw new Error(
      "observed environment does not match the requested environment",
    );
  }
  if (raw.sourceSha !== request.sourceSha) {
    throw new Error(
      "observed sourceSha does not match the requested sourceSha",
    );
  }
  if (!Array.isArray(raw.workers)) {
    throw new Error("remote observation workers must be an array");
  }
  if (raw.workers.length !== CANONICAL_STAGING_WORKER_NAMES.length) {
    throw new Error(
      `workers must contain exactly ${CANONICAL_STAGING_WORKER_NAMES.length} entries`,
    );
  }

  const selectedVersionIds = new Set();
  const selectedDeploymentIds = new Set();
  const annotation = sourceShaAnnotation(request.sourceSha);
  const workers = raw.workers.map((worker, index) => {
    const location = `workers[${index}]`;
    assertRecord(worker, location);
    assertExactKeys(worker, REMOTE_WORKER_KEYS, location);
    const expectedName = CANONICAL_STAGING_WORKER_NAMES[index];
    if (worker.name !== expectedName) {
      throw new Error(
        `workers must use canonical order: expected ${expectedName} at index ${index}, received ${String(worker.name)}`,
      );
    }
    if (!Array.isArray(worker.versions) || worker.versions.length === 0) {
      throw new Error(
        `${worker.name} has no remotely observed deployable versions`,
      );
    }

    const seenWorkerVersionIds = new Set();
    for (const [versionIndex, remoteVersion] of worker.versions.entries()) {
      const versionLocation = `${location}.versions[${versionIndex}]`;
      validateRemoteVersion(remoteVersion, versionLocation);
      if (seenWorkerVersionIds.has(remoteVersion.id)) {
        throw new Error(
          `${worker.name} repeats remote version UUID ${remoteVersion.id}`,
        );
      }
      seenWorkerVersionIds.add(remoteVersion.id);
    }

    const matchingVersions = worker.versions.filter(
      (remoteVersion) =>
        remoteVersion.annotations["workers/message"] === annotation,
    );
    if (matchingVersions.length === 0) {
      throw new Error(
        `${worker.name} has no version with exact source SHA annotation ${annotation}`,
      );
    }
    if (matchingVersions.length !== 1) {
      throw new Error(
        `${worker.name} has ${matchingVersions.length} versions with the exact source SHA annotation`,
      );
    }
    const selectedVersion = matchingVersions[0];
    const trigger = selectedVersion.annotations["workers/triggered_by"];
    if (!CLOUDFLARE_UPLOAD_TRIGGERS.includes(trigger)) {
      throw new Error(
        `${worker.name} version ${selectedVersion.id} was triggered by ${String(trigger)} and is not an upload`,
      );
    }
    if (selectedVersion.metadata.source !== "wrangler") {
      throw new Error(
        `${worker.name} version ${selectedVersion.id} source must be exactly wrangler`,
      );
    }
    if (selectedVersionIds.has(selectedVersion.id)) {
      throw new Error(
        `duplicate observed Worker version UUID: ${selectedVersion.id}`,
      );
    }
    selectedVersionIds.add(selectedVersion.id);

    validateDeployment(worker.deployment, `${location}.deployment`);
    if (selectedDeploymentIds.has(worker.deployment.id)) {
      throw new Error(
        `duplicate observed Worker deployment UUID: ${worker.deployment.id}`,
      );
    }
    selectedDeploymentIds.add(worker.deployment.id);
    if (
      worker.deployment.versions.length !== 1 ||
      worker.deployment.versions[0].version_id !== selectedVersion.id ||
      worker.deployment.versions[0].percentage !== 100
    ) {
      throw new Error(
        `${worker.name} latest deployment does not exclusively activate observed version ${selectedVersion.id} at 100 percent`,
      );
    }

    return {
      name: worker.name,
      versionId: selectedVersion.id,
      sourceShaAnnotation: annotation,
      deploymentId: worker.deployment.id,
    };
  });

  return {
    accountId: request.accountId,
    environment: request.environment,
    sourceSha: request.sourceSha,
    observer: "cloudflare-remote",
    workers,
  };
}

export async function observeStagingDeployment(request, remoteBoundary) {
  validateStagingDeploymentRequest(request);
  assertRecord(remoteBoundary, "remote boundary");
  assertExactKeys(remoteBoundary, ["observe"], "remote boundary");
  if (typeof remoteBoundary.observe !== "function") {
    throw new Error("remote boundary.observe must be a function");
  }

  const normalizedRequest = deepFreeze({
    accountId: request.accountId,
    environment: request.environment,
    sourceSha: request.sourceSha,
  });
  const rawObservation = await remoteBoundary.observe(normalizedRequest);
  const validatedObservation = deepFreeze(
    validateAndNormalizeRemoteObservation(rawObservation, normalizedRequest),
  );
  VALIDATED_REMOTE_OBSERVATIONS.add(validatedObservation);
  return validatedObservation;
}

export function createStagingDeploymentProof(validatedObservation) {
  if (
    !isRecord(validatedObservation) ||
    !VALIDATED_REMOTE_OBSERVATIONS.has(validatedObservation)
  ) {
    throw new Error(
      "a validated remote observation returned by observeStagingDeployment is required",
    );
  }

  const material = {
    schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
    accountId: validatedObservation.accountId,
    environment: validatedObservation.environment,
    sourceSha: validatedObservation.sourceSha,
    observer: validatedObservation.observer,
    workers: validatedObservation.workers.map((worker) => ({ ...worker })),
  };
  const digest = createHash("sha256")
    .update(canonicalJson(material), "utf8")
    .digest("hex");

  return {
    ...material,
    deploymentId: `sha256:${digest}`,
  };
}

/**
 * Validates a serialized proof after its trusted remote-observation step.
 *
 * This checks integrity and exact identity only; callers must also establish
 * provenance for the bytes (for example, a protected Actions job artifact).
 */
export function validateStagingDeploymentProof(proof, request) {
  validateStagingDeploymentRequest(request);
  assertRecord(proof, "staging deployment proof");
  assertExactKeys(proof, PROOF_KEYS, "staging deployment proof");
  if (proof.schema !== STAGING_DEPLOYMENT_PROOF_SCHEMA) {
    throw new Error("staging deployment proof schema is not supported");
  }
  if (
    proof.accountId !== request.accountId ||
    proof.environment !== request.environment ||
    proof.sourceSha !== request.sourceSha
  ) {
    throw new Error("staging deployment proof identity does not match request");
  }
  if (proof.observer !== "cloudflare-remote") {
    throw new Error("staging deployment proof observer is not remote");
  }
  if (
    !Array.isArray(proof.workers) ||
    proof.workers.length !== CANONICAL_STAGING_WORKER_NAMES.length
  ) {
    throw new Error("staging deployment proof must contain seven Workers");
  }
  const annotation = sourceShaAnnotation(request.sourceSha);
  for (const [index, worker] of proof.workers.entries()) {
    assertRecord(worker, `staging deployment proof worker ${index}`);
    assertExactKeys(
      worker,
      PROOF_WORKER_KEYS,
      `staging deployment proof worker ${index}`,
    );
    if (worker.name !== CANONICAL_STAGING_WORKER_NAMES[index]) {
      throw new Error("staging deployment proof Worker order is not canonical");
    }
    assertUuid(worker.versionId, `proof worker ${worker.name} versionId`);
    assertUuid(worker.deploymentId, `proof worker ${worker.name} deploymentId`);
    if (worker.sourceShaAnnotation !== annotation) {
      throw new Error(
        `proof worker ${worker.name} source SHA annotation does not match`,
      );
    }
  }
  const material = {
    schema: proof.schema,
    accountId: proof.accountId,
    environment: proof.environment,
    sourceSha: proof.sourceSha,
    observer: proof.observer,
    workers: proof.workers.map((worker) => ({ ...worker })),
  };
  const expectedDeploymentId = `sha256:${createHash("sha256")
    .update(canonicalJson(material), "utf8")
    .digest("hex")}`;
  if (proof.deploymentId !== expectedDeploymentId) {
    throw new Error("staging deployment proof digest does not match material");
  }
  return deepFreeze({ ...material, deploymentId: expectedDeploymentId });
}

export async function createStagingDeploymentProofFromFile() {
  throw new Error(
    "file input is disabled because it is forgeable; a validated remote observation is required",
  );
}

function validateApiEnvelope(payload) {
  assertRecord(payload, "Cloudflare API envelope");
  assertAllowedKeys(payload, API_ENVELOPE_KEYS, "Cloudflare API envelope");
  const errors = payload.errors === null ? [] : payload.errors;
  const messages = payload.messages === null ? [] : payload.messages;
  if (
    payload.success !== true ||
    !("result" in payload) ||
    !("errors" in payload) ||
    !Array.isArray(errors) ||
    errors.length !== 0 ||
    !("messages" in payload) ||
    !Array.isArray(messages) ||
    messages.length !== 0
  ) {
    throw new Error("invalid API envelope returned by Cloudflare");
  }
  if ("result_info" in payload) {
    assertRecord(payload.result_info, "Cloudflare API result_info");
    assertAllowedKeys(
      payload.result_info,
      API_RESULT_INFO_KEYS,
      "Cloudflare API result_info",
    );
    for (const [key, value] of Object.entries(payload.result_info)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Cloudflare API result_info.${key} must be an integer`);
      }
    }
  }
  return payload.result;
}

async function readCloudflareApiResult(fetchImpl, apiToken, path, workerName) {
  const response = await fetchImpl(`${CLOUDFLARE_API_BASE_URL}${path}`, {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response?.ok) {
    throw new Error(
      `Cloudflare API request failed for ${workerName}: HTTP ${String(response?.status ?? "unknown")}`,
    );
  }
  const contentType = response.headers?.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error(
      `Cloudflare API response for ${workerName} must return application/json`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `Cloudflare API returned invalid JSON for ${workerName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateApiEnvelope(payload);
}

export function createCloudflareApiBoundary({
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (
    typeof apiToken !== "string" ||
    apiToken.trim() !== apiToken ||
    !API_TOKEN_PATTERN.test(apiToken)
  ) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is required and must be a non-whitespace API token",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("a Fetch-compatible remote implementation is required");
  }

  return {
    async observe(request) {
      validateStagingDeploymentRequest(request);
      const accountPath = `/accounts/${request.accountId}/workers/scripts`;
      const workers = await Promise.all(
        CANONICAL_STAGING_WORKER_NAMES.map(async (name) => {
          const encodedName = encodeURIComponent(name);
          const [versionResult, deploymentResult] = await Promise.all([
            readCloudflareApiResult(
              fetchImpl,
              apiToken,
              `${accountPath}/${encodedName}/versions?deployable=true&per_page=100`,
              name,
            ),
            readCloudflareApiResult(
              fetchImpl,
              apiToken,
              `${accountPath}/${encodedName}/deployments`,
              name,
            ),
          ]);
          assertRecord(versionResult, `Cloudflare versions result for ${name}`);
          assertExactKeys(
            versionResult,
            ["items"],
            `Cloudflare versions result for ${name}`,
          );
          if (!Array.isArray(versionResult.items)) {
            throw new Error(
              `Cloudflare versions result for ${name}.items must be an array`,
            );
          }
          assertRecord(
            deploymentResult,
            `Cloudflare deployments result for ${name}`,
          );
          assertExactKeys(
            deploymentResult,
            ["deployments"],
            `Cloudflare deployments result for ${name}`,
          );
          if (
            !Array.isArray(deploymentResult.deployments) ||
            deploymentResult.deployments.length === 0
          ) {
            throw new Error(`${name} has no remotely observed deployment`);
          }
          return {
            name,
            versions: versionResult.items,
            deployment: deploymentResult.deployments[0],
          };
        }),
      );

      return {
        accountId: request.accountId,
        environment: request.environment,
        sourceSha: request.sourceSha,
        workers,
      };
    },
  };
}

const CLI_USAGE =
  "usage: staging-deployment-proof.mjs --account-id <id> --environment staging --source-sha <sha>";

function parseCliArgs(args) {
  if (!Array.isArray(args) || args.length !== 6) {
    throw new Error(CLI_USAGE);
  }
  const values = {};
  const allowed = new Map([
    ["--account-id", "accountId"],
    ["--environment", "environment"],
    ["--source-sha", "sourceSha"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = allowed.get(flag);
    const value = args[index + 1];
    if (
      key === undefined ||
      key in values ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error(CLI_USAGE);
    }
    values[key] = value;
  }
  assertExactKeys(values, REQUEST_KEYS, "CLI request");
  validateStagingDeploymentRequest(values);
  return values;
}

export async function runCli(args, { boundary } = {}) {
  const request = parseCliArgs(args);
  const requiredBoundary = boundary ?? createCloudflareApiBoundary();
  const observation = await observeStagingDeployment(request, requiredBoundary);
  return createStagingDeploymentProof(observation);
}

const modulePath = fileURLToPath(import.meta.url);

async function main(args) {
  const proof = await runCli(args);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
