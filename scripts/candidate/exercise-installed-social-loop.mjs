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
import { validatePromotionProfilesContent } from "../promotion-materials-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
  VERIFICATIONS_ARTEFACT,
  validateInstalledTranscript,
} from "../promotion-installed-transcript-lib.mjs";
import { validateResilienceObservation } from "./resilience-observation.mjs";
import { validateInstalledRawEvidence } from "./raw-evidence.mjs";
import { exerciseReviewedInstalledCandidate } from "./reviewed-installed-driver.mjs";
import { validateLiveAuthProof } from "./live-staging-auth-proof.mjs";

export { REQUIRED_STORIES };

export { FOLLOW_SCENARIO_OUTCOMES };

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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKSPACE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/u;

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

function loadStagingFixture(path, candidateSha) {
  const document = parseJsonFile(path, "staging promotion fixture").value;
  exactKeys(
    document,
    [
      "schema",
      "sourceSha",
      "origin",
      "sessionId",
      "punkId",
      "workspaceId",
      "workspaceSlug",
      "conversationId",
      "topicRequired",
      "seedMessageIds",
      "replyMessageId",
    ],
    "staging promotion fixture",
  );
  if (
    document.schema !== "punks.staging-promotion-fixture.v1" ||
    document.sourceSha !== candidateSha ||
    document.origin !== "https://staging.punks.bot" ||
    !UUID_RE.test(document.sessionId ?? "") ||
    !UUID_RE.test(document.punkId ?? "") ||
    !UUID_RE.test(document.workspaceId ?? "") ||
    !WORKSPACE_SLUG_RE.test(document.workspaceSlug ?? "") ||
    !UUID_RE.test(document.conversationId ?? "") ||
    document.topicRequired !== true ||
    !Array.isArray(document.seedMessageIds) ||
    document.seedMessageIds.length < 51 ||
    document.seedMessageIds.length > 100 ||
    new Set(document.seedMessageIds).size !== document.seedMessageIds.length ||
    document.seedMessageIds.some((id) => !UUID_RE.test(id ?? "")) ||
    !UUID_RE.test(document.replyMessageId ?? "")
  ) {
    fail("staging promotion fixture is not the exact bounded T1 fixture");
  }
  return {
    origin: document.origin,
    sessionId: document.sessionId,
    punkId: document.punkId,
    workspaceId: document.workspaceId,
    workspaceSlug: document.workspaceSlug,
    conversationId: document.conversationId,
    topicRequired: true,
    seedMessageIds: [...document.seedMessageIds],
    replyMessageId: document.replyMessageId,
  };
}

function loadLiveFollowProof(
  path,
  { candidateSha, stagingDeploymentId, fixture },
) {
  const file = parseJsonFile(path, "live staging FOLLOW proof");
  const proof = file.value;
  exactKeys(
    proof,
    [
      "schema",
      "result",
      "sourceSha",
      "stagingDeploymentId",
      "staging",
      "workspaceId",
      "conversationId",
      "catchUpFrames",
      "initialCursor",
      "liveCursor",
      "crashBeforeAckCursor",
      "replayCursor",
      "scenarios",
      "observedAt",
    ],
    "live staging FOLLOW proof",
  );
  exactKeys(
    proof.scenarios,
    [
      "catchUpAckReady",
      "liveChangeAck",
      "crashBeforeAckReplay",
      "afterAckNoReplay",
      "revokedSessionRejected",
    ],
    "live staging FOLLOW scenarios",
  );
  if (
    proof.schema !== "punks.live-staging-follow-proof.v1" ||
    proof.result !== "PASS" ||
    proof.sourceSha !== candidateSha ||
    proof.stagingDeploymentId !== stagingDeploymentId ||
    proof.staging !== "https://staging.punks.bot" ||
    proof.workspaceId !== fixture.workspaceId ||
    proof.conversationId !== fixture.conversationId ||
    !Number.isSafeInteger(proof.catchUpFrames) ||
    proof.catchUpFrames < 1 ||
    !Number.isSafeInteger(proof.initialCursor) ||
    !Number.isSafeInteger(proof.liveCursor) ||
    !Number.isSafeInteger(proof.crashBeforeAckCursor) ||
    !Number.isSafeInteger(proof.replayCursor) ||
    proof.initialCursor >= proof.liveCursor ||
    proof.liveCursor >= proof.crashBeforeAckCursor ||
    proof.crashBeforeAckCursor !== proof.replayCursor ||
    Object.values(proof.scenarios).some((result) => result !== "vert") ||
    typeof proof.observedAt !== "string" ||
    !Number.isFinite(Date.parse(proof.observedAt))
  ) {
    fail("live staging FOLLOW proof is not exact and green");
  }
  return {
    proofSha256: sha256(file.content),
    observedAt: proof.observedAt,
    catchUpFrames: proof.catchUpFrames,
    cursors: {
      initial: proof.initialCursor,
      live: proof.liveCursor,
      crashBeforeAck: proof.crashBeforeAckCursor,
      replay: proof.replayCursor,
    },
    scenarios: { ...proof.scenarios },
  };
}

function loadLiveAuthProof(
  path,
  { candidateSha, stagingDeploymentId, fixture, stagingWorkers },
) {
  const proof = parseJsonFile(path, "live staging Auth proof").value;
  const authWorker = stagingWorkers.find(
    ({ name }) => name === "punks-auth-staging",
  );
  if (authWorker === undefined || !UUID_RE.test(proof?.flow?.flowId ?? "")) {
    fail("live staging Auth proof has no exact Auth Worker/flow");
  }
  try {
    validateLiveAuthProof(proof, {
      sourceSha: candidateSha,
      stagingDeploymentId,
      flowId: proof.flow.flowId,
      authWorkerVersionId: authWorker.versionId,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (
    proof.flow.sessionId !== fixture.sessionId ||
    proof.flow.punkId !== fixture.punkId
  ) {
    fail("live Auth proof does not own the installed promotion Session");
  }
  return proof;
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
      "resilience",
      "rawEvidence",
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
        Array.isArray(automated) ||
        JSON.stringify(Object.keys(automated).sort()) !==
          JSON.stringify(["exitCode", "observation", "tool"]) ||
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
        Array.isArray(manual) ||
        JSON.stringify(Object.keys(manual).sort()) !==
          JSON.stringify(["observation", "reviewer", "tool"]) ||
        !nonEmptyString(manual.tool) ||
        !nonEmptyString(manual.reviewer) ||
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
  exercise: exerciseReviewedInstalledCandidate,
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
    liveAuthProof,
    liveFollowProof,
    stagingFixture,
    bundle,
    installedRoot,
    installedArtifact,
    nativeBinary,
    nativeProof,
    faultObservation,
    operatorTokenFile,
    manualReviewFile,
    gateReport,
    gateLog,
    screenReaderBinary,
    networkLog,
    output,
    resilienceOutput,
    rawEvidenceOutput,
  },
  {
    installedDriver = reviewedInstalledDriver,
    observeCompatibility = observeCompatibilityWithFetch,
  } = {},
) {
  if (!PLATFORMS.includes(platform)) fail("unsupported platform");
  if (!SHA1_RE.test(candidateSha ?? "")) fail("exact source SHA required");
  const fixture = loadStagingFixture(stagingFixture, candidateSha);
  const promotionProfileFile = stableFile(
    fileURLToPath(
      new URL("../../cloudflare/promotion-profiles.json", import.meta.url),
    ),
    "promotion profile material",
  );
  let promotionProfile;
  try {
    promotionProfile = validatePromotionProfilesContent(
      promotionProfileFile.content,
      { tranche: 1 },
    );
  } catch (error) {
    fail(
      `promotion profile material is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const authorities = promotionProfile.authorities.map(({ id }) => id);
  stableDirectory(bundle, "signed bundle root");
  const artifact = stableFile(
    installedArtifact,
    "installed candidate artifact",
  );
  const artifactSha256 = sha256(artifact.content);
  const screenReader = stableFile(
    screenReaderBinary,
    "native screen reader executable",
  );
  const operatorToken = stableFile(operatorTokenFile, "operator token file")
    .content.toString("utf8")
    .trim();
  if (
    operatorToken.length < 32 ||
    operatorToken.length > 4096 ||
    /\s/u.test(operatorToken)
  ) {
    fail("operator token is malformed");
  }
  let manualReview = null;
  if (existsSync(resolve(manualReviewFile))) {
    manualReview = parseJsonFile(
      manualReviewFile,
      "manual accessibility review",
    ).value;
  }
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
  const distributedFollow = loadLiveFollowProof(liveFollowProof, {
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    fixture,
  });
  const distributedAuth = loadLiveAuthProof(liveAuthProof, {
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    fixture,
    stagingWorkers: staging.workers,
  });
  if (existsSync(resolve(networkLog))) {
    fail("Rust promotion network log must be created by this installed run");
  }
  if (existsSync(resolve(output))) {
    fail("installed transcript output already exists");
  }
  if (existsSync(resolve(resilienceOutput))) {
    fail("installed resilience output already exists");
  }
  if (existsSync(resolve(rawEvidenceOutput))) {
    fail("installed raw evidence output already exists");
  }

  const observation = await installedDriver.exercise({
    platform,
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    bundle: resolve(bundle),
    installedRoot: resolve(installedRoot),
    installedArtifact: artifact.absolute,
    artifactSha256,
    nativeBinary: resolve(nativeBinary),
    nativeProof: resolve(nativeProof),
    faultObservation: resolve(faultObservation),
    faultContext: {
      origin: "https://staging.punks.bot",
      operatorToken,
      output: resolve(faultObservation),
    },
    manualReview,
    gateReport: resolve(gateReport),
    gateLog: resolve(gateLog),
    screenReaderBinary: screenReader.absolute,
    networkLog: resolve(networkLog),
    rawEvidence: resolve(rawEvidenceOutput),
    fixture,
    authorities,
  });
  const normalized = validateDriverObservation(observation, {
    platform,
    candidateSha,
    artifactSha256,
  });
  validateResilienceObservation(observation.resilience, {
    platform,
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
    artifactSha256,
    authorities,
  });
  const rawEvidence = validateInstalledRawEvidence({
    reference: observation.rawEvidence,
    root: rawEvidenceOutput,
    platform,
    candidateSha,
    stagingDeploymentId: staging.deploymentId,
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
    authentication: {
      contour: "navigateur-systeme-provider-reel",
      proof: distributedAuth,
    },
    rawEvidence: {
      indexSha256: observation.rawEvidence.indexSha256,
      files: rawEvidence.index.files.length,
    },
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
        distributed: distributedFollow,
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
  writeFileSync(
    resolve(resilienceOutput),
    `${JSON.stringify(observation.resilience, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return transcript;
}

function parseOptions(argv) {
  const expected = new Set([
    "--platform",
    "--source-sha",
    "--staging-deployment-proof",
    "--live-auth-proof",
    "--live-follow-proof",
    "--staging-fixture",
    "--bundle",
    "--installed-root",
    "--installed-artifact",
    "--native-binary",
    "--native-proof",
    "--fault-observation",
    "--operator-token-file",
    "--manual-review-file",
    "--gate-report",
    "--gate-log",
    "--screen-reader-binary",
    "--network-log",
    "--output",
    "--resilience-output",
    "--raw-evidence-output",
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
    liveAuthProof: required("--live-auth-proof"),
    liveFollowProof: required("--live-follow-proof"),
    stagingFixture: required("--staging-fixture"),
    bundle: required("--bundle"),
    installedRoot: required("--installed-root"),
    installedArtifact: required("--installed-artifact"),
    nativeBinary: required("--native-binary"),
    nativeProof: required("--native-proof"),
    faultObservation: required("--fault-observation"),
    operatorTokenFile: required("--operator-token-file"),
    manualReviewFile: required("--manual-review-file"),
    gateReport: required("--gate-report"),
    gateLog: required("--gate-log"),
    screenReaderBinary: required("--screen-reader-binary"),
    networkLog: required("--network-log"),
    output: required("--output"),
    resilienceOutput: required("--resilience-output"),
    rawEvidenceOutput: required("--raw-evidence-output"),
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
