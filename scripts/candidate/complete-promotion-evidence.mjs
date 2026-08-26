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
import YAML from "yaml";

import { validateStagingDeploymentProof } from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { validateSigstoreBundleContent } from "../github-attestation-lib.mjs";
import {
  validatePromotionProfilesContent,
  validateStagingMaterialContent,
} from "../promotion-materials-lib.mjs";
import { VERIFICATIONS_ARTEFACT } from "../promotion-installed-transcript-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "../promotion-resilience-lib.mjs";
import { PLATEFORMES } from "../release-graph-lib.mjs";

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

function parseYaml(file, label) {
  try {
    return YAML.parse(file.content.toString("utf8"));
  } catch {
    fail(`${label} is not YAML`);
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
  { evidenceRoot, sourceSha, stagingDeploymentId, ids, proofs },
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
  proofs.set(reference.id, { proof, reference, subjectFile });
  return reference;
}

function readFragment(
  path,
  { evidenceRoot, sourceSha, stagingDeploymentId, ids, proofs },
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
      proofs,
    }),
  );
}

function requiredEvidenceIds(profile, releaseGraph, goldens) {
  const required = new Set([
    "candidat",
    "profil/promotion",
    "registres",
    "staging/materiau",
    "staging/deploiement",
    "production/bundle",
    "production/manifeste",
    "recuperation/captures",
    "retrait/diff",
    "retrait/verdicts",
    "scan/sources",
    "scan/dependances",
    "scan/artefact",
    "scan/reseau",
  ]);
  for (const gate of releaseGraph["preuves-obligatoires"]) {
    required.add(`gate/${gate}`);
  }
  for (const platform of PLATEFORMES) {
    required.add(`transcript/${platform}`);
    required.add(`staging/reobservation/${platform}`);
    required.add(`artefact/${platform}/bundle`);
    required.add(`artefact/${platform}/signature`);
    for (const verification of VERIFICATIONS_ARTEFACT) {
      required.add(`artefact/${platform}/verification/${verification}`);
    }
    for (const story of profile.stories) {
      required.add(`parcours/${platform}/${story}`);
    }
    for (const criterion of MATRICE_ACCESSIBILITE) {
      required.add(`accessibilite/${platform}/${criterion}`);
    }
    required.add(`accessibilite/${platform}/resultat`);
  }
  for (const type of TYPES_FAUTE) {
    for (const { id: authority } of profile.authorities) {
      required.add(`faute/${type}/${authority}`);
      for (const recovery of PREUVES_RECUPERATION) {
        required.add(`recuperation/${recovery}/${type}/${authority}`);
      }
    }
  }
  for (const line of goldens["retraits-par-tranche"].lignes) {
    if (line.tranche === "tranche:1") required.add(`golden/${line.test}`);
  }
  return required;
}

function requireExactEvidenceSet(ids, required) {
  const actual = [...ids].sort();
  const expected = [...required].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((id) => !ids.has(id));
    const extra = actual.filter((id) => !required.has(id));
    fail(
      `required evidence set is incomplete or widened (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
    );
  }
}

function requireSubject(proofs, id, file) {
  const entry = proofs.get(id);
  if (entry?.subjectFile.sha256 !== file.sha256) {
    fail(`proof ${id} is not bound to its exact versioned material`);
  }
  return entry.proof;
}

function requireMaterialBindings(
  proofs,
  {
    aggregateFile,
    promotionProfileFile,
    stagingMaterialFile,
    stagingDeploymentFile,
    releaseGraphFile,
    withdrawalInventoryFile,
    goldensFile,
    provenanceFile,
  },
) {
  requireSubject(proofs, "candidat", aggregateFile);
  requireSubject(proofs, "profil/promotion", promotionProfileFile);
  requireSubject(proofs, "staging/materiau", stagingMaterialFile);
  requireSubject(proofs, "staging/deploiement", stagingDeploymentFile);
  requireSubject(proofs, "production/bundle", provenanceFile);
  requireSubject(proofs, "production/manifeste", aggregateFile);

  const registries = proofs.get("registres")?.proof.data.materials;
  exactKeys(
    registries,
    ["releaseGraphSha256", "withdrawalInventorySha256", "goldensSha256"],
    "registry material bindings",
  );
  if (
    registries.releaseGraphSha256 !== releaseGraphFile.sha256 ||
    registries.withdrawalInventorySha256 !== withdrawalInventoryFile.sha256 ||
    registries.goldensSha256 !== goldensFile.sha256
  ) {
    fail("registry proof is not bound to the exact migration materials");
  }
  if (
    proofs.get("retrait/diff")?.proof.data.withdrawalInventorySha256 !==
      withdrawalInventoryFile.sha256 ||
    proofs.get("retrait/verdicts")?.proof.data.goldensSha256 !==
      goldensFile.sha256
  ) {
    fail("withdrawal proofs are not bound to their exact versioned materials");
  }
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

  const promotionProfileFile = stableFile(
    promotionProfile,
    "promotion profile material",
  );
  const stagingMaterialFile = stableFile(stagingMaterial, "staging material");
  const releaseGraphFile = stableFile(releaseGraph, "release graph material");
  const withdrawalInventoryFile = stableFile(
    withdrawalInventory,
    "withdrawal inventory material",
  );
  const goldensFile = stableFile(goldens, "goldens material");
  const provenanceFile = stableFile(
    provenanceBundle,
    "pre-dossier provenance bundle",
  );
  const stagingDeploymentFile = stableFile(
    join(evidenceRoot, "staging-deployment-proof.json"),
    "staging deployment proof",
    evidenceRoot,
  );
  let profile;
  let stagingCoordinates;
  try {
    profile = validatePromotionProfilesContent(promotionProfileFile.content, {
      tranche: 1,
    });
    stagingCoordinates = validateStagingMaterialContent(
      stagingMaterialFile.content,
    );
    validateSigstoreBundleContent(provenanceFile.content);
  } catch (error) {
    fail(
      `versioned promotion material is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const releaseGraphValue = parseYaml(
    releaseGraphFile,
    "release graph material",
  );
  const withdrawalValue = parseYaml(
    withdrawalInventoryFile,
    "withdrawal inventory material",
  );
  const goldensValue = parseYaml(goldensFile, "goldens material");
  if (
    releaseGraphValue?.version !== 1 ||
    !Array.isArray(releaseGraphValue["preuves-obligatoires"]) ||
    releaseGraphValue["preuves-obligatoires"].length === 0 ||
    releaseGraphValue["preuves-obligatoires"].some(
      (gate) => typeof gate !== "string" || gate.length === 0,
    ) ||
    withdrawalValue?.version !== 1 ||
    !Array.isArray(withdrawalValue.actifs) ||
    goldensValue?.version !== 1 ||
    !Array.isArray(goldensValue?.["retraits-par-tranche"]?.lignes)
  ) {
    fail("migration materials do not expose the closed tranche 1 structure");
  }
  let stagingDeployment;
  try {
    stagingDeployment = validateStagingDeploymentProof(
      parseJson(stagingDeploymentFile, "staging deployment proof"),
      {
        accountId: stagingCoordinates.accountId,
        environment: "staging",
        sourceSha,
      },
    );
  } catch (error) {
    fail(
      `staging deployment proof is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stagingDeployment.deploymentId !== stagingDeploymentId) {
    fail("staging deployment proof differs from the candidate aggregate");
  }

  const ids = new Set();
  const proofs = new Map();
  const references = FRAGMENTS.flatMap((name) =>
    readFragment(join(evidenceRoot, name), {
      evidenceRoot,
      sourceSha,
      stagingDeploymentId,
      ids,
      proofs,
    }),
  ).sort((left, right) => left.id.localeCompare(right.id));
  requireExactEvidenceSet(
    ids,
    requiredEvidenceIds(profile, releaseGraphValue, goldensValue),
  );
  requireMaterialBindings(proofs, {
    aggregateFile,
    promotionProfileFile,
    stagingMaterialFile,
    stagingDeploymentFile,
    releaseGraphFile,
    withdrawalInventoryFile,
    goldensFile,
    provenanceFile,
  });
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
