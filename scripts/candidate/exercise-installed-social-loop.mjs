#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
  REQUIRED_STORIES,
  VERIFICATIONS_ARTEFACT,
  validateInstalledTranscript,
} from "../promotion-installed-transcript-lib.mjs";

export { REQUIRED_STORIES };

export const FOLLOW_SCENARIO_OUTCOMES = Object.freeze({
  snapshot: "vert",
  "pagination-concurrente": "vert",
  "changements-avant-ready": "vert",
  "doublon-exact": "ignore",
  trou: "resync",
  divergence: "resync",
  "crash-avant-ack": "rejoue",
  "crash-apres-ack": "ne-rejoue-pas",
  resync: "vert",
  terminal: "vert",
});

const PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const REQUIRED_CAPABILITIES = Object.freeze([
  "account-session",
  "workspace-mount",
  "stream-directory",
  "message-history",
  "conversation-follow",
  "message-post",
  "unicode-reactions",
]);
const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`installed social loop rejected: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has an unexpected shape`);
  }
}

function stableFile(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile()) {
    fail(`${label} must be one real regular file`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail(`${label} changed while it was read`);
    }
    return { absolute, content };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stableDirectory(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  return absolute;
}

function parseJsonFile(path, label) {
  const file = stableFile(path, label);
  try {
    return { ...file, value: JSON.parse(file.content.toString("utf8")) };
  } catch {
    fail(`${label} is not JSON`);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function nonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    value.trim() === value
  );
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function assertion(label, value) {
  const encoded = JSON.stringify(value);
  if (encoded.length > 430) fail(`${label} observation is unbounded`);
  return `${label}: ${encoded}`;
}

function validateCompatibility(observed, platform, deployedWorkers) {
  exactKeys(
    observed,
    ["status", "workerVersionsHeader", "body"],
    "compatibility observation",
  );
  exactKeys(
    observed.body,
    [
      "contract",
      "compatible",
      "profile",
      "registryVersion",
      "minimumClientVersion",
      "environment",
      "origin",
      "capabilities",
    ],
    "compatibility response",
  );
  const expectedWorkers = deployedWorkers.map(({ name, versionId }) => ({
    name,
    versionId,
  }));
  let decodedWorkers;
  try {
    const bytes = Buffer.from(observed.workerVersionsHeader, "base64url");
    if (bytes.toString("base64url") !== observed.workerVersionsHeader) {
      fail("compatibility Worker header is not canonical base64url");
    }
    decodedWorkers = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("installed social loop rejected:")
    ) {
      throw error;
    }
    fail("compatibility Worker header is invalid");
  }
  if (
    observed.status !== 200 ||
    observed.body.contract !== "desktop.compatibility-response@1" ||
    observed.body.compatible !== true ||
    observed.body.profile !== "desktop-social-loop@1" ||
    !Number.isSafeInteger(observed.body.registryVersion) ||
    observed.body.registryVersion < 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(
      observed.body.minimumClientVersion ?? "",
    ) ||
    observed.body.environment !== "staging" ||
    observed.body.origin !== "https://staging.punks.bot" ||
    !Array.isArray(observed.body.capabilities) ||
    !REQUIRED_CAPABILITIES.every((capability) =>
      observed.body.capabilities.includes(capability),
    ) ||
    JSON.stringify(decodedWorkers) !== JSON.stringify(expectedWorkers)
  ) {
    fail(`compatibility response is not bound to ${platform} and staging`);
  }
  return expectedWorkers;
}

function validateDriverObservation(
  observation,
  { platform, candidateSha, artifactSha256 },
) {
  exactKeys(
    observation,
    [
      "schema",
      "platform",
      "candidateSha",
      "artifactSha256",
      "installed",
      "verifications",
      "stories",
      "accessibility",
      "follow",
    ],
    "installed driver observation",
  );
  if (
    observation.schema !== "punks.installed-driver-observation.v1" ||
    observation.platform !== platform ||
    observation.candidateSha !== candidateSha ||
    observation.artifactSha256 !== artifactSha256
  ) {
    fail("installed driver observation belongs to another candidate");
  }
  exactKeys(
    observation.installed,
    ["bundleId", "binarySha256", "launched", "executable"],
    "installed application observation",
  );
  if (
    observation.installed.bundleId !== "bot.punks.desktop.staging" ||
    !SHA256_RE.test(observation.installed.binarySha256 ?? "") ||
    observation.installed.launched !== true ||
    !nonEmptyString(observation.installed.executable)
  ) {
    fail("installed application observation is invalid");
  }

  exactKeys(
    observation.verifications,
    VERIFICATIONS_ARTEFACT,
    "installed native verifications",
  );
  const verifications = {};
  for (const id of VERIFICATIONS_ARTEFACT) {
    const value = observation.verifications[id];
    exactKeys(
      value,
      ["command", "exitCode", "observation"],
      `native verification ${id}`,
    );
    if (
      !nonEmptyString(value.command) ||
      value.exitCode !== 0 ||
      !nonEmptyString(value.observation)
    ) {
      fail(`native verification ${id} is not observed green`);
    }
    verifications[id] = "vert";
  }

  if (!Array.isArray(observation.stories)) fail("stories must be an array");
  const observedStories = new Map();
  for (const story of observation.stories) {
    exactKeys(story, ["id", "ui", "ipc", "contracts"], "story observation");
    if (
      !REQUIRED_STORIES.includes(story.id) ||
      observedStories.has(story.id) ||
      !nonEmptyArray(story.ui) ||
      !nonEmptyArray(story.ipc) ||
      !nonEmptyArray(story.contracts)
    ) {
      fail(
        `${String(story.id)} must have an observed UI, IPC and contract crossing`,
      );
    }
    observedStories.set(story.id, {
      id: story.id,
      result: "vert",
      via: ["ui", "ipc-rust", "contrats-publics"],
      assertions: [
        assertion(`${story.id} UI`, story.ui),
        assertion(`${story.id} IPC Rust`, story.ipc),
        assertion(`${story.id} contrats publics`, story.contracts),
      ],
    });
  }
  const stories = REQUIRED_STORIES.map((id) => {
    const story = observedStories.get(id);
    if (story === undefined) fail(`required story ${id} is missing`);
    return story;
  });

  exactKeys(
    observation.accessibility,
    MATRICE_ACCESSIBILITE,
    "installed accessibility observations",
  );
  const accessibility = {};
  for (const criterion of MATRICE_ACCESSIBILITE) {
    const value = observation.accessibility[criterion];
    const expected =
      criterion === "lecteur-ecran"
        ? ["automated", "manual", "technology"]
        : ["automated", "manual"];
    exactKeys(value, expected, `accessibility observation ${criterion}`);
    if (!nonEmptyArray(value.automated) || !nonEmptyArray(value.manual)) {
      fail(`accessibility observation ${criterion} lacks both methods`);
    }
    for (const automated of value.automated) {
      if (
        automated === null ||
        typeof automated !== "object" ||
        automated.exitCode !== 0 ||
        !nonEmptyString(automated.tool) ||
        !nonEmptyString(automated.observation)
      ) {
        fail(`accessibility observation ${criterion} is not automated green`);
      }
    }
    for (const manual of value.manual) {
      if (
        manual === null ||
        typeof manual !== "object" ||
        !nonEmptyString(manual.tool) ||
        !nonEmptyString(manual.observation)
      ) {
        fail(`accessibility observation ${criterion} lacks manual review`);
      }
    }
    accessibility[criterion] = {
      resultat: "vert",
      methodes: [...METHODES_ACCESSIBILITE],
      ...(criterion === "lecteur-ecran"
        ? { technologie: value.technology }
        : {}),
    };
  }

  exactKeys(
    observation.follow,
    ["request", "trace", "scenarios"],
    "installed FOLLOW observation",
  );
  exactKeys(
    observation.follow.scenarios,
    Object.keys(FOLLOW_SCENARIO_OUTCOMES),
    "installed FOLLOW scenario observations",
  );
  const scenarios = {};
  for (const [id, expectedOutcome] of Object.entries(
    FOLLOW_SCENARIO_OUTCOMES,
  )) {
    const value = observation.follow.scenarios[id];
    exactKeys(value, ["outcome", "observations"], `FOLLOW scenario ${id}`);
    if (
      value.outcome !== expectedOutcome ||
      !nonEmptyArray(value.observations) ||
      value.observations.some((item) => !nonEmptyString(item))
    ) {
      fail(`FOLLOW scenario ${id} is not observed with its expected outcome`);
    }
    scenarios[id] = value.outcome;
  }
  return { verifications, stories, accessibility, scenarios };
}

function readNetworkRequests(path) {
  const content = stableFile(path, "Rust promotion network log").content;
  if (content.length === 0 || content.length > 4_194_304) {
    fail("Rust promotion network log has an invalid size");
  }
  try {
    const lines = content
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    if (lines.length < 2) fail("Rust promotion network log is incomplete");
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("installed social loop rejected:")
    ) {
      throw error;
    }
    fail("Rust promotion network log is not canonical JSON Lines");
  }
}

async function observeCompatibilityWithFetch(request) {
  const response = await fetch(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.body),
    redirect: "error",
  });
  let body;
  try {
    body = await response.json();
  } catch {
    fail("staging compatibility response is not JSON");
  }
  return {
    status: response.status,
    workerVersionsHeader: response.headers.get("x-punks-worker-versions"),
    body,
  };
}

const reviewedInstalledDriver = Object.freeze({
  async exercise({ platform }) {
    const driver = platform.startsWith("macos-") ? "xctest" : "tauri-driver";
    fail(
      `reviewed ${driver} installed driver did not provide an observation; promotion remains unavailable`,
    );
  },
});

/**
 * Exercises one installed candidate and writes a transcript only after every
 * UI, IPC, public-contract and network observation has been cross-validated.
 * Test boundaries can replace the two external observers, but the CLI cannot.
 */
export async function exerciseInstalledSocialLoop(
  {
    platform,
    candidateSha,
    stagingDeploymentProof,
    bundle,
    installedArtifact,
    networkLog,
    output,
  },
  {
    installedDriver = reviewedInstalledDriver,
    observeCompatibility = observeCompatibilityWithFetch,
  } = {},
) {
  if (!PLATFORMS.includes(platform)) fail("unsupported platform");
  if (!SHA1_RE.test(candidateSha ?? "")) fail("exact source SHA required");
  stableDirectory(bundle, "signed bundle root");
  const artifact = stableFile(
    installedArtifact,
    "installed candidate artifact",
  );
  const artifactSha256 = sha256(artifact.content);
  const stagingFile = parseJsonFile(
    stagingDeploymentProof,
    "staging deployment proof",
  );
  let staging;
  try {
    staging = validateStagingDeploymentProof(stagingFile.value, {
      accountId: CANONICAL_STAGING_ACCOUNT_ID,
      environment: "staging",
      sourceSha: candidateSha,
    });
  } catch (error) {
    fail(
      `staging deployment proof is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (existsSync(resolve(networkLog))) {
    fail("Rust promotion network log must be created by this installed run");
  }
  if (existsSync(resolve(output))) {
    fail("installed transcript output already exists");
  }

  const observation = await installedDriver.exercise({
    platform,
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    bundle: resolve(bundle),
    installedArtifact: artifact.absolute,
    artifactSha256,
    networkLog: resolve(networkLog),
  });
  const normalized = validateDriverObservation(observation, {
    platform,
    candidateSha,
    artifactSha256,
  });
  const compatibility = await observeCompatibility({
    url: "https://staging.punks.bot/api/v1/desktop/compatibility",
    body: {
      profile: "desktop-social-loop@1",
      distribution: "staging",
      platform,
    },
  });
  const runtimeWorkers = validateCompatibility(
    compatibility,
    platform,
    staging.workers,
  );
  const requests = readNetworkRequests(networkLog);
  const transcript = {
    schema: "punks.installed-social-loop-transcript.v1",
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    platform,
    result: "vert",
    driver: platform.startsWith("macos-") ? "xctest" : "tauri-driver",
    contour: "distribue",
    serveurVite: false,
    facadeTest: false,
    installed: {
      bundleId: observation.installed.bundleId,
      artifactSha256,
      binarySha256: observation.installed.binarySha256,
      launched: true,
    },
    verifications: normalized.verifications,
    stories: normalized.stories,
    accessibility: normalized.accessibility,
    network: {
      deployment: {
        transport: "https",
        method: "POST",
        origin: "https://staging.punks.bot",
        path: "/api/v1/desktop/compatibility",
        status: compatibility.status,
        responseHeader: "x-punks-worker-versions",
        responseHeaderValue: compatibility.workerVersionsHeader,
        workers: runtimeWorkers,
      },
      requests,
      follow: {
        protocol: "punks.follow.v1",
        request: observation.follow.request,
        trace: observation.follow.trace,
        scenarios: normalized.scenarios,
      },
    },
  };
  validateInstalledTranscript(transcript, {
    platform,
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    deployedWorkers: staging.workers.map(
      ({ name, versionId, deploymentId }) => ({
        name,
        versionId,
        deploymentId,
      }),
    ),
    artifactSha256,
  });
  writeFileSync(resolve(output), `${JSON.stringify(transcript, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return transcript;
}

function parseOptions(argv) {
  const expected = new Set([
    "--platform",
    "--source-sha",
    "--staging-deployment-proof",
    "--bundle",
    "--installed-artifact",
    "--network-log",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    values.set(flag, value);
  }
  if (
    values.size !== expected.size ||
    [...values.keys()].some((flag) => !expected.has(flag))
  ) {
    fail("exact installed exercise CLI arguments are required");
  }
  const required = (flag) => {
    const value = values.get(flag);
    if (!value) fail(`${flag} is required`);
    return value;
  };
  return { required };
}

export async function run(argv = process.argv.slice(2)) {
  const { required } = parseOptions(argv);
  return await exerciseInstalledSocialLoop({
    platform: required("--platform"),
    candidateSha: required("--source-sha"),
    stagingDeploymentProof: required("--staging-deployment-proof"),
    bundle: required("--bundle"),
    installedArtifact: required("--installed-artifact"),
    networkLog: required("--network-log"),
    output: required("--output"),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
