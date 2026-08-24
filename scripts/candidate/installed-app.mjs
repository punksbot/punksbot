#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_STORIES = Object.freeze([
  "connexion",
  "workspace",
  "lecture-live",
  "pagination",
  "publication",
  "reponse",
  "sujet",
  "reactions",
]);

const PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const VERIFICATIONS = Object.freeze([
  "signature",
  "identite-application",
  "protocol-handlers",
  "stockage-securise",
  "updater",
]);
const ACCESSIBILITY = Object.freeze([
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
]);
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`installed candidate proof rejected: ${message}`);
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

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseTranscript(path) {
  const file = stableFile(path, "driver transcript");
  let transcript;
  try {
    transcript = JSON.parse(file.content.toString("utf8"));
  } catch {
    fail("driver transcript is not JSON");
  }
  return { ...file, transcript };
}

function validateTranscript({
  transcript,
  platform,
  candidateSha,
  stagingDeploymentId,
  artifactSha256,
}) {
  exactKeys(
    transcript,
    [
      "schema",
      "candidateSha",
      "stagingDeploymentId",
      "platform",
      "result",
      "driver",
      "contour",
      "serveurVite",
      "facadeTest",
      "installed",
      "verifications",
      "stories",
      "accessibility",
      "network",
    ],
    "driver transcript",
  );
  if (
    transcript.schema !== "punks.installed-social-loop-transcript.v1" ||
    transcript.candidateSha !== candidateSha ||
    transcript.stagingDeploymentId !== stagingDeploymentId ||
    transcript.platform !== platform ||
    transcript.result !== "vert"
  ) {
    fail("driver transcript identity or result does not match the candidate");
  }
  const expectedDriver = platform.startsWith("macos-")
    ? "xctest"
    : "tauri-driver";
  if (transcript.driver !== expectedDriver) {
    fail(`${platform} must use the reviewed ${expectedDriver} driver`);
  }
  if (
    transcript.contour !== "distribue" ||
    transcript.serveurVite !== false ||
    transcript.facadeTest !== false
  ) {
    fail("the exact distributed installation is required; no Vite or test facade");
  }

  exactKeys(
    transcript.installed,
    ["bundleId", "artifactSha256", "binarySha256", "launched"],
    "installed application",
  );
  if (
    transcript.installed.bundleId !== "bot.punks.desktop.staging" ||
    transcript.installed.artifactSha256 !== artifactSha256 ||
    !SHA256_RE.test(transcript.installed.binarySha256 ?? "") ||
    transcript.installed.launched !== true
  ) {
    fail("installed application identity or artifact digest is divergent");
  }

  exactKeys(transcript.verifications, VERIFICATIONS, "native verifications");
  for (const verification of VERIFICATIONS) {
    if (transcript.verifications[verification] !== "vert") {
      fail(`native verification ${verification} is not green`);
    }
  }

  if (!Array.isArray(transcript.stories)) fail("stories must be an array");
  const stories = new Map();
  for (const story of transcript.stories) {
    exactKeys(story, ["id", "result", "via", "assertions"], "story");
    if (!REQUIRED_STORIES.includes(story.id) || stories.has(story.id)) {
      fail(`unknown or duplicate story ${String(story.id)}`);
    }
    if (
      story.result !== "vert" ||
      !Array.isArray(story.via) ||
      !["ui", "ipc-rust", "contrats-publics"].every((layer) =>
        story.via.includes(layer),
      ) ||
      !Array.isArray(story.assertions) ||
      story.assertions.length === 0 ||
      story.assertions.some(
        (assertion) =>
          typeof assertion !== "string" ||
          assertion.length === 0 ||
          assertion.length > 500,
      )
    ) {
      fail(`story ${story.id} is not proven through UI + IPC + public contracts`);
    }
    stories.set(story.id, story);
  }
  for (const story of REQUIRED_STORIES) {
    if (!stories.has(story)) fail(`required story ${story} is missing`);
  }

  exactKeys(transcript.accessibility, ACCESSIBILITY, "accessibility matrix");
  for (const criterion of ACCESSIBILITY) {
    if (transcript.accessibility[criterion] !== "vert") {
      fail(`accessibility criterion ${criterion} is not green`);
    }
  }

  exactKeys(transcript.network, ["requests"], "network evidence");
  if (
    !Array.isArray(transcript.network.requests) ||
    transcript.network.requests.length < 2
  ) {
    fail("network evidence must include HTTPS and FOLLOW observations");
  }
  const transports = new Set();
  for (const request of transcript.network.requests) {
    exactKeys(
      request,
      ["transport", "method", "origin", "path", "status"],
      "network request",
    );
    const expectedOrigin =
      request.transport === "https"
        ? "https://staging.punks.bot"
        : request.transport === "wss"
          ? "wss://staging.punks.bot"
          : null;
    if (
      expectedOrigin === null ||
      request.origin !== expectedOrigin ||
      typeof request.method !== "string" ||
      !request.path.startsWith("/api/") ||
      !Number.isInteger(request.status) ||
      request.status < 100 ||
      request.status > 599 ||
      /buzz|nostr|relay|huddle/iu.test(
        `${request.origin}${request.path}`,
      )
    ) {
      fail("network evidence contains an unreviewed or legacy destination");
    }
    transports.add(request.transport);
  }
  if (!transports.has("https") || !transports.has("wss")) {
    fail("network evidence must cover HTTPS and WSS FOLLOW");
  }
  return { stories };
}

function proof({ id, platform, candidateSha, stagingDeploymentId, data }) {
  return {
    schema: "punks.promotion-proof.v1",
    id,
    candidateSha,
    stagingDeploymentId,
    result: "vert",
    plateforme: platform,
    data,
  };
}

function writeProof(output, value) {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const digest = sha256(content);
  const safeId = value.id.replaceAll(/[^a-z0-9.-]/giu, "-");
  const relative = `sha256/${digest}-${safeId}.json`;
  writeFileSync(join(output, relative), content, { flag: "wx", mode: 0o600 });
  return { id: value.id, chemin: relative, sha256: digest };
}

export function emitInstalledAppEvidence({
  platform,
  candidateSha,
  stagingDeploymentId,
  artifact,
  signature,
  transcript,
  output,
}) {
  if (!PLATFORMS.includes(platform)) fail("unsupported platform");
  if (!SHA1_RE.test(candidateSha ?? "")) fail("exact source SHA required");
  if (!DEPLOYMENT_RE.test(stagingDeploymentId ?? "")) {
    fail("exact staging deployment ID required");
  }
  const artifactFile = stableFile(artifact, "installed artifact");
  const signatureFile = stableFile(signature, "updater signature");
  const artifactDigest = sha256(artifactFile.content);
  const signatureDigest = sha256(signatureFile.content);
  const parsed = parseTranscript(transcript);
  const { stories } = validateTranscript({
    transcript: parsed.transcript,
    platform,
    candidateSha,
    stagingDeploymentId,
    artifactSha256: artifactDigest,
  });
  const outputPath = resolve(output);
  if (existsSync(outputPath)) fail("evidence output already exists");
  mkdirSync(join(outputPath, "sha256"), { recursive: true, mode: 0o700 });

  const common = { platform, candidateSha, stagingDeploymentId };
  const transcriptDigest = sha256(parsed.content);
  const values = [
    proof({
      ...common,
      id: `artefact/${platform}/bundle`,
      data: {
        nom: basename(artifactFile.absolute),
        bundleId: parsed.transcript.installed.bundleId,
        subjectSha256: artifactDigest,
        installedBinarySha256: parsed.transcript.installed.binarySha256,
        transcriptSha256: transcriptDigest,
      },
    }),
    proof({
      ...common,
      id: `artefact/${platform}/signature`,
      data: {
        nom: basename(signatureFile.absolute),
        subjectSha256: signatureDigest,
        transcriptSha256: transcriptDigest,
      },
    }),
  ];
  for (const verification of VERIFICATIONS) {
    values.push(
      proof({
        ...common,
        id: `artefact/${platform}/verification/${verification}`,
        data: { driver: parsed.transcript.driver, transcriptSha256: transcriptDigest },
      }),
    );
  }
  for (const story of REQUIRED_STORIES) {
    const observed = stories.get(story);
    values.push(
      proof({
        ...common,
        id: `parcours/${platform}/${story}`,
        data: {
          sha256Artefact: artifactDigest,
          via: observed.via,
          contour: parsed.transcript.contour,
          serveurVite: parsed.transcript.serveurVite,
          facadeTest: parsed.transcript.facadeTest,
          assertions: observed.assertions,
          transcriptSha256: transcriptDigest,
        },
      }),
    );
  }
  for (const criterion of ACCESSIBILITY) {
    values.push(
      proof({
        ...common,
        id: `accessibilite/${platform}/${criterion}`,
        data: { driver: parsed.transcript.driver, transcriptSha256: transcriptDigest },
      }),
    );
  }
  values.push(
    proof({
      ...common,
      id: `accessibilite/${platform}/resultat`,
      data: { driver: parsed.transcript.driver, transcriptSha256: transcriptDigest },
    }),
  );

  const references = values.map((value) => writeProof(outputPath, value));
  references.sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(
    join(outputPath, "index.json"),
    `${JSON.stringify({ schema: "punks.promotion-evidence-index.v1", preuves: references }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  copyFileSync(parsed.absolute, join(outputPath, "transcript.json"), constants.COPYFILE_EXCL);
  return { references, transcriptSha256: transcriptDigest };
}

function options(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || result.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    result.set(flag, value);
  }
  const required = (name) => {
    const value = result.get(name);
    if (!value) fail(`${name} is required`);
    return value;
  };
  return { required };
}

export function run(argv = process.argv.slice(2)) {
  const { required } = options(argv);
  return emitInstalledAppEvidence({
    platform: required("--platform"),
    candidateSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    artifact: required("--installed-artifact"),
    signature: required("--updater-signature"),
    transcript: required("--driver-transcript"),
    output: required("--proof-output"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
