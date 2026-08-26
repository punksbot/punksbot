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
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const FRAGMENTS = Object.freeze([
  "platform-index.json",
  "gates-index.json",
  "recovery-index.json",
  "withdrawal-index.json",
]);
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`promotion evidence rejected: ${message}`);
}

function stableDirectory(path, label) {
  const absolute = resolve(path);
  let status;
  try {
    status = lstatSync(absolute);
  } catch {
    fail(`${label} is missing`);
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  return realpathSync(absolute);
}

function stableFile(path, label, root = null) {
  const absolute = resolve(path);
  let status;
  try {
    status = lstatSync(absolute);
  } catch {
    fail(`${label} is missing`);
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    fail(`${label} must be one real regular file`);
  }
  const real = realpathSync(absolute);
  if (root !== null) {
    const contained = relative(root, real);
    if (
      contained.startsWith("..") ||
      isAbsolute(contained) ||
      contained === ""
    ) {
      fail(`${label} escapes the promotion evidence root`);
    }
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
    if (content.length === 0) fail(`${label} is empty`);
    return { absolute: real, content, sha256: sha256(content) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseJson(file, label) {
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch {
    fail(`${label} is not JSON`);
  }
}

function canonicalRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path === path.trim() &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
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

function validateReference(
  reference,
  { evidenceRoot, sourceSha, stagingDeploymentId, ids },
) {
  exactKeys(reference, ["id", "chemin", "sha256", "sujet"], "proof reference");
  exactKeys(reference.sujet, ["chemin", "sha256"], "proof subject reference");
  if (
    typeof reference.id !== "string" ||
    reference.id.length === 0 ||
    reference.id.length > 300 ||
    reference.id !== reference.id.trim() ||
    ids.has(reference.id) ||
    !canonicalRelativePath(reference.chemin) ||
    !canonicalRelativePath(reference.sujet.chemin) ||
    !reference.chemin.startsWith("sha256/") ||
    !reference.sujet.chemin.startsWith("sha256/") ||
    !SHA256_RE.test(reference.sha256 ?? "") ||
    !SHA256_RE.test(reference.sujet.sha256 ?? "")
  ) {
    fail(`invalid or duplicate proof reference ${String(reference.id)}`);
  }
  const proofFile = stableFile(
    join(evidenceRoot, reference.chemin),
    `proof ${reference.id}`,
    evidenceRoot,
  );
  const subjectFile = stableFile(
    join(evidenceRoot, reference.sujet.chemin),
    `proof subject ${reference.id}`,
    evidenceRoot,
  );
  if (
    proofFile.sha256 !== reference.sha256 ||
    subjectFile.sha256 !== reference.sujet.sha256
  ) {
    fail(`content address mismatch for proof ${reference.id}`);
  }
  const proof = parseJson(proofFile, `proof ${reference.id}`);
  const allowedKeys = new Set([
    "schema",
    "id",
    "candidateSha",
    "stagingDeploymentId",
    "result",
    "plateforme",
    "data",
  ]);
  if (
    proof === null ||
    typeof proof !== "object" ||
    Array.isArray(proof) ||
    Object.keys(proof).some((key) => !allowedKeys.has(key)) ||
    proof.schema !== "punks.promotion-proof.v1" ||
    proof.id !== reference.id ||
    proof.candidateSha !== sourceSha ||
    proof.stagingDeploymentId !== stagingDeploymentId ||
    proof.result !== "vert" ||
    proof.data === null ||
    typeof proof.data !== "object" ||
    Array.isArray(proof.data) ||
    proof.data.subjectSha256 !== subjectFile.sha256
  ) {
    fail(
      `proof ${reference.id} is not bound to the exact candidate and subject`,
    );
  }
  ids.add(reference.id);
  return reference;
}

function readFragment(
  path,
  { evidenceRoot, sourceSha, stagingDeploymentId, ids },
) {
  const label = `evidence fragment ${path.split("/").at(-1)}`;
  const file = stableFile(path, label, evidenceRoot);
  const index = parseJson(file, label);
  exactKeys(index, ["schema", "preuves"], label);
  if (
    index.schema !== "punks.promotion-evidence-index.v1" ||
    !Array.isArray(index.preuves) ||
    index.preuves.length === 0
  ) {
    fail(`${label} is empty or has an invalid schema`);
  }
  return index.preuves.map((reference) =>
    validateReference(reference, {
      evidenceRoot,
      sourceSha,
      stagingDeploymentId,
      ids,
    }),
  );
}

/**
 * Merges the four independently produced, content-addressed evidence
 * fragments. It never turns source material or a successful dependency into a
 * proof: missing gate, recovery or withdrawal observations keep promotion
 * unavailable and leave no output index behind.
 */
export function completePromotionEvidence({
  candidate,
  sourceSha,
  stagingDeploymentId,
  promotionProfile,
  stagingMaterial,
  releaseGraph,
  withdrawalInventory,
  goldens,
  provenanceBundle,
  output,
}) {
  if (!SHA1_RE.test(sourceSha ?? "")) fail("exact source SHA required");
  if (!DEPLOYMENT_RE.test(stagingDeploymentId ?? "")) {
    fail("exact staging deployment ID required");
  }
  const candidateRoot = stableDirectory(candidate, "candidate root");
  const evidenceRoot = stableDirectory(
    join(candidateRoot, "promotion-evidence"),
    "promotion evidence root",
  );
  const expectedOutput = join(evidenceRoot, "index.json");
  const outputPath = resolve(output);
  if (
    basename(outputPath) !== "index.json" ||
    realpathSync(dirname(outputPath)) !== evidenceRoot
  ) {
    fail("final evidence index must remain inside the candidate evidence root");
  }
  if (existsSync(expectedOutput)) fail("final evidence index already exists");

  const aggregateFile = stableFile(
    join(candidateRoot, "aggregate-manifest.json"),
    "candidate aggregate manifest",
    candidateRoot,
  );
  const aggregate = parseJson(aggregateFile, "candidate aggregate manifest");
  if (
    aggregate?.schema !== "punks.desktop-candidate-aggregate.v1" ||
    aggregate.sourceSha !== sourceSha ||
    aggregate.stagingDeploymentId !== stagingDeploymentId
  ) {
    fail("candidate aggregate identity is divergent");
  }

  for (const [path, label] of [
    [promotionProfile, "promotion profile material"],
    [stagingMaterial, "staging material"],
    [releaseGraph, "release graph material"],
    [withdrawalInventory, "withdrawal inventory material"],
    [goldens, "goldens material"],
    [provenanceBundle, "pre-dossier provenance bundle"],
  ]) {
    stableFile(path, label);
  }

  const ids = new Set();
  const references = FRAGMENTS.flatMap((name) =>
    readFragment(join(evidenceRoot, name), {
      evidenceRoot,
      sourceSha,
      stagingDeploymentId,
      ids,
    }),
  ).sort((left, right) => left.id.localeCompare(right.id));
  const index = {
    schema: "punks.promotion-evidence-index.v1",
    preuves: references,
  };
  writeFileSync(expectedOutput, `${JSON.stringify(index, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return index;
}

function parseOptions(argv) {
  const expected = new Set([
    "--candidate",
    "--source-sha",
    "--staging-deployment-id",
    "--promotion-profile",
    "--staging-material",
    "--release-graph",
    "--withdrawal-inventory",
    "--goldens",
    "--provenance-bundle",
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
    fail("exact promotion evidence CLI arguments are required");
  }
  const required = (flag) => {
    const value = values.get(flag);
    if (!value) fail(`${flag} is required`);
    return value;
  };
  return { required };
}

export function run(argv = process.argv.slice(2)) {
  const { required } = parseOptions(argv);
  return completePromotionEvidence({
    candidate: required("--candidate"),
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    promotionProfile: required("--promotion-profile"),
    stagingMaterial: required("--staging-material"),
    releaseGraph: required("--release-graph"),
    withdrawalInventory: required("--withdrawal-inventory"),
    goldens: required("--goldens"),
    provenanceBundle: required("--provenance-bundle"),
    output: required("--output"),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
