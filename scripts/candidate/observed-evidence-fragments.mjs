#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { validateStagingDeploymentProof } from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { validateSigstoreBundleContent } from "../github-attestation-lib.mjs";
import {
  validatePromotionProfilesContent,
  validateStagingMaterialContent,
} from "../promotion-materials-lib.mjs";
import { VERIFICATIONS_ARTEFACT } from "../promotion-installed-transcript-lib.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import {
  NOMS_REGISTRES_ATTESTATION,
  PLATEFORMES,
} from "../release-graph-lib.mjs";
import { GATE_IDS } from "./secretless-gates-report.mjs";
import { validateInstalledArtifactScan } from "./installed-artifact-scan.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const GATE_PROOFS = Object.freeze({
  "corpus-conformite": ["cloudflare-check"],
  "suites-workers": ["cloudflare-check"],
  "cloudflare-check": ["cloudflare-check"],
  "playwright-facade": ["playwright-capabilities"],
  "tauri-staging": ["candidate-config", "rust-graph", "cargo-check"],
  accessibilite: ["playwright-capabilities"],
  "scans-negatifs": ["frontend-source", "rust-graph"],
});

export const GATES_FRAGMENT_IDS = Object.freeze([
  "candidat",
  "profil/promotion",
  "registres",
  "staging/materiau",
  "staging/deploiement",
  "production/bundle",
  "production/manifeste",
  "production/evidence/platform-index",
  "production/evidence/recovery-index",
  ...PLATEFORMES.map((platform) => `production/evidence/network/${platform}`),
  "scan/sources",
  "scan/dependances",
  "scan/artefact",
  "scan/reseau",
  ...Object.keys(GATE_PROOFS).map((gate) => `gate/${gate}`),
]);

function fail(message) {
  throw new Error(`observed evidence fragments rejected: ${message}`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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

function stableDirectory(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  return realpathSync(absolute);
}

function stableFile(path, label, root = null) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size === 0) {
    fail(`${label} must be one non-empty real regular file`);
  }
  const real = realpathSync(absolute);
  if (root !== null) {
    const contained = relative(root, real);
    if (
      contained === "" ||
      contained.startsWith("..") ||
      isAbsolute(contained)
    ) {
      fail(`${label} escapes its evidence root`);
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
    return { absolute: real, content, sha256: sha256(content) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
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

function validateGateObservation(reportFile, logFile, sourceSha, deploymentId) {
  const report = parseJson(reportFile, "secretless gate report");
  exactKeys(
    report,
    ["schema", "sourceSha", "stagingDeploymentId", "logSha256", "gates"],
    "secretless gate report",
  );
  if (
    report.schema !== "punks.secretless-gates-report.v1" ||
    report.sourceSha !== sourceSha ||
    report.stagingDeploymentId !== deploymentId ||
    report.logSha256 !== logFile.sha256 ||
    !Array.isArray(report.gates) ||
    report.gates.length !== GATE_IDS.length ||
    report.gates.some(
      (gate, index) => gate?.id !== GATE_IDS[index] || gate.result !== "vert",
    )
  ) {
    fail("gate log hash or gate report is divergent from the successful run");
  }
  return report;
}

function validatePlatformEvidence(
  evidenceRoot,
  profile,
  sourceSha,
  deploymentId,
) {
  const indexFile = stableFile(
    join(evidenceRoot, "platform-index.json"),
    "platform evidence index",
    evidenceRoot,
  );
  const index = parseJson(indexFile, "platform evidence index");
  exactKeys(index, ["schema", "preuves"], "platform evidence index");
  if (
    index.schema !== "punks.promotion-evidence-index.v1" ||
    !Array.isArray(index.preuves)
  ) {
    fail("platform evidence index is invalid");
  }
  const byId = new Map(
    index.preuves.map((reference) => [reference?.id, reference]),
  );
  const artifactSubjects = [];
  const artifactScans = [];
  const artifactShaByPlatform = new Map();
  const artifactSizeByPlatform = new Map();
  for (const platform of PLATEFORMES) {
    const expected = [
      `transcript/${platform}`,
      `brut/${platform}`,
      `staging/reobservation/${platform}`,
      `artefact/${platform}/bundle`,
      `artefact/${platform}/signature`,
      `scan/artefact/${platform}`,
      ...VERIFICATIONS_ARTEFACT.map(
        (name) => `artefact/${platform}/verification/${name}`,
      ),
      ...profile.stories.map((story) => `parcours/${platform}/${story}`),
      ...MATRICE_ACCESSIBILITE.map(
        (criterion) => `accessibilite/${platform}/${criterion}`,
      ),
      `accessibilite/${platform}/resultat`,
    ];
    for (const id of expected) {
      const reference = byId.get(id);
      if (
        reference === undefined ||
        !SHA256_RE.test(reference.sha256 ?? "") ||
        !SHA256_RE.test(reference.sujet?.sha256 ?? "")
      ) {
        fail(`platform evidence is missing ${id}`);
      }
      const proof = stableFile(
        join(evidenceRoot, reference.chemin),
        `platform proof ${id}`,
        evidenceRoot,
      );
      const subject = stableFile(
        join(evidenceRoot, reference.sujet.chemin),
        `platform subject ${id}`,
        evidenceRoot,
      );
      if (
        proof.sha256 !== reference.sha256 ||
        subject.sha256 !== reference.sujet.sha256
      ) {
        fail(`platform evidence content address diverges for ${id}`);
      }
      const document = parseJson(proof, `platform proof ${id}`);
      if (
        document.candidateSha !== sourceSha ||
        document.stagingDeploymentId !== deploymentId ||
        document.result !== "vert" ||
        document.data?.subjectSha256 !== subject.sha256
      ) {
        fail(`platform proof ${id} is not an observed green subject`);
      }
      if (id === `artefact/${platform}/bundle`) {
        artifactShaByPlatform.set(platform, subject.sha256);
        artifactSizeByPlatform.set(platform, subject.content.length);
        artifactSubjects.push({
          platform,
          sha256: subject.sha256,
          size: subject.content.length,
        });
      } else if (id === `scan/artefact/${platform}`) {
        let scan;
        try {
          scan = validateInstalledArtifactScan(
            parseJson(subject, `installed artifact scan ${platform}`),
            {
              platform,
              candidateSha: sourceSha,
              artifactSha256: artifactShaByPlatform.get(platform),
            },
          );
        } catch (error) {
          fail(
            `platform artifact scan ${platform} is invalid: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (scan.artifact.size !== artifactSizeByPlatform.get(platform)) {
          fail(`platform artifact scan ${platform} has a divergent byte size`);
        }
        artifactScans.push({
          platform,
          sha256: subject.sha256,
          artifactSha256: scan.artifact.sha256,
          nativeSha256: scan.native.sha256,
          installationSha256: scan.installation.sha256,
          installationFiles: scan.installation.files.length,
          frontendSha256: scan.frontend.sha256,
          frontendFiles: scan.frontend.files.length,
        });
      }
    }
  }
  return { indexFile, artifactScans, artifactSubjects };
}

function validateNetworks(evidenceRoot, sourceSha, deploymentId) {
  const networkRoot = stableDirectory(
    join(evidenceRoot, "network"),
    "network evidence",
  );
  const expectedNames = PLATEFORMES.map(
    (platform) => `${platform}.json`,
  ).sort();
  if (
    JSON.stringify(readdirSync(networkRoot).sort()) !==
    JSON.stringify(expectedNames)
  ) {
    fail("network evidence must contain exactly four platform observations");
  }
  const files = new Map();
  const observations = PLATEFORMES.map((platform) => {
    const file = stableFile(
      join(networkRoot, `${platform}.json`),
      `${platform} network proof`,
      networkRoot,
    );
    const proof = parseJson(file, `${platform} network proof`);
    if (
      proof.schema !== "punks.installed-network-proof.v1" ||
      proof.platform !== platform ||
      proof.candidateSha !== sourceSha ||
      proof.stagingDeploymentId !== deploymentId ||
      !Array.isArray(proof.network?.requests) ||
      proof.network.requests.length < 2 ||
      /buzz|nostr|relay|huddle/iu.test(JSON.stringify(proof.network))
    ) {
      fail(
        `${platform} network evidence is divergent or contains legacy traffic`,
      );
    }
    files.set(platform, file);
    return {
      platform,
      sha256: file.sha256,
      requests: proof.network.requests.length,
    };
  });
  return { files, observations };
}

function safeId(id) {
  return id.replaceAll(/[^a-z0-9.-]/giu, "-");
}

function createEmitter(evidenceRoot, sourceSha, deploymentId) {
  const shaRoot = join(evidenceRoot, "sha256");
  mkdirSync(shaRoot, { recursive: true, mode: 0o700 });
  const snapshots = new Map();
  const snapshot = (content, label) => {
    const digest = sha256(content);
    const key = `${digest}-${label}`;
    const existing = snapshots.get(key);
    if (existing !== undefined) return existing;
    const relativePath = `sha256/${digest}-${safeId(label)}-subject.bin`;
    writeFileSync(join(evidenceRoot, relativePath), content, {
      flag: "wx",
      mode: 0o600,
    });
    const reference = { chemin: relativePath, sha256: digest };
    snapshots.set(key, reference);
    return reference;
  };
  const emit = (id, content, data = {}) => {
    const subject = snapshot(content, id);
    const proof = Buffer.from(
      `${JSON.stringify({
        schema: "punks.promotion-proof.v1",
        id,
        candidateSha: sourceSha,
        stagingDeploymentId: deploymentId,
        result: "vert",
        data: { ...data, subjectSha256: subject.sha256 },
      })}\n`,
    );
    const digest = sha256(proof);
    const path = `sha256/${digest}-${safeId(id)}.json`;
    writeFileSync(join(evidenceRoot, path), proof, { flag: "wx", mode: 0o600 });
    return { id, chemin: path, sha256: digest, sujet: subject };
  };
  return { emit, snapshot };
}

function writeIndex(evidenceRoot, name, references) {
  const path = join(evidenceRoot, name);
  if (existsSync(path)) fail(`${name} already exists`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema: "punks.promotion-evidence-index.v1",
        preuves: references.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return path;
}

export function buildObservedEvidenceFragments({
  candidate,
  sourceSha,
  stagingDeploymentId,
  gateReport,
  gateLog,
  promotionProfile,
  stagingMaterial,
  releaseGraph,
  withdrawalInventory,
  goldens,
  provenanceBundle,
}) {
  if (
    !SHA1_RE.test(sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "")
  ) {
    fail("exact candidate and staging identities are required");
  }
  const candidateRoot = stableDirectory(candidate, "candidate root");
  const evidenceRoot = stableDirectory(
    join(candidateRoot, "promotion-evidence"),
    "promotion evidence root",
  );
  for (const name of ["gates-index.json", "withdrawal-index.json"]) {
    if (existsSync(join(evidenceRoot, name))) fail(`${name} already exists`);
  }
  const aggregateFile = stableFile(
    join(candidateRoot, "aggregate-manifest.json"),
    "candidate aggregate",
    candidateRoot,
  );
  const aggregate = parseJson(aggregateFile, "candidate aggregate");
  if (
    aggregate.schema !== "punks.desktop-candidate-aggregate.v1" ||
    aggregate.sourceSha !== sourceSha ||
    aggregate.stagingDeploymentId !== stagingDeploymentId
  ) {
    fail("candidate aggregate identity is divergent");
  }
  const gateReportFile = stableFile(gateReport, "secretless gate report");
  const gateLogFile = stableFile(gateLog, "secretless gate log");
  const gateObservation = validateGateObservation(
    gateReportFile,
    gateLogFile,
    sourceSha,
    stagingDeploymentId,
  );
  const profileFile = stableFile(promotionProfile, "promotion profile");
  const stagingMaterialFile = stableFile(stagingMaterial, "staging material");
  const graphFile = stableFile(releaseGraph, "release graph");
  const withdrawalFile = stableFile(
    withdrawalInventory,
    "withdrawal inventory",
  );
  const goldensFile = stableFile(goldens, "goldens ledger");
  const provenanceFile = stableFile(provenanceBundle, "pre-dossier provenance");
  const stagingProofFile = stableFile(
    join(evidenceRoot, "staging-deployment-proof.json"),
    "staging deployment proof",
    evidenceRoot,
  );
  let profile;
  let stagingCoordinates;
  try {
    profile = validatePromotionProfilesContent(profileFile.content, {
      tranche: 1,
    });
    stagingCoordinates = validateStagingMaterialContent(
      stagingMaterialFile.content,
    );
    validateSigstoreBundleContent(provenanceFile.content);
  } catch (error) {
    fail(
      `versioned material is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const graph = parseYaml(graphFile, "release graph");
  const withdrawal = parseYaml(withdrawalFile, "withdrawal inventory");
  const ledger = parseYaml(goldensFile, "goldens ledger");
  const release = graph?.releases?.find((entry) => entry?.tranche === 1);
  if (
    graph?.version !== 1 ||
    release?.etat !== "preparation" ||
    withdrawal?.version !== 1 ||
    !Array.isArray(withdrawal.actifs) ||
    ledger?.version !== 1 ||
    !Array.isArray(ledger?.["retraits-par-tranche"]?.lignes)
  ) {
    fail("migration materials do not expose the tranche 1 preparation state");
  }
  let stagingProof;
  try {
    stagingProof = validateStagingDeploymentProof(
      parseJson(stagingProofFile, "staging deployment proof"),
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
  if (stagingProof.deploymentId !== stagingDeploymentId) {
    fail("staging deployment identity is divergent");
  }
  const platform = validatePlatformEvidence(
    evidenceRoot,
    profile,
    sourceSha,
    stagingDeploymentId,
  );
  const networks = validateNetworks(
    evidenceRoot,
    sourceSha,
    stagingDeploymentId,
  );
  const recoveryIndexFile = stableFile(
    join(evidenceRoot, "recovery-index.json"),
    "recovery evidence index",
    evidenceRoot,
  );
  const recoveryIndex = parseJson(recoveryIndexFile, "recovery evidence index");
  exactKeys(recoveryIndex, ["schema", "preuves"], "recovery evidence index");
  if (
    recoveryIndex.schema !== "punks.promotion-evidence-index.v1" ||
    !Array.isArray(recoveryIndex.preuves) ||
    recoveryIndex.preuves.length === 0
  ) {
    fail("recovery evidence index is invalid or empty");
  }

  const { emit } = createEmitter(evidenceRoot, sourceSha, stagingDeploymentId);
  const gates = [];
  gates.push(emit("candidat", aggregateFile.content, { tranche: 1 }));
  gates.push(
    emit("profil/promotion", profileFile.content, {
      materiau: "cloudflare/promotion-profiles.json",
      profil: profile.id,
      tranche: 1,
      recits: profile.stories,
      autorites: profile.authorities.map(({ id }) => id),
    }),
  );
  const registries = NOMS_REGISTRES_ATTESTATION.map((name) => {
    const material = release.materiaux?.[name];
    if (
      !Number.isSafeInteger(material?.version) ||
      !SHA256_RE.test(material?.sha256 ?? "")
    ) {
      fail(`release graph lacks registry ${name}`);
    }
    return { nom: name, version: material.version, sha256: material.sha256 };
  });
  gates.push(
    emit("registres", graphFile.content, {
      materials: {
        releaseGraphSha256: graphFile.sha256,
        withdrawalInventorySha256: withdrawalFile.sha256,
        goldensSha256: goldensFile.sha256,
      },
      registres: registries,
    }),
  );
  gates.push(
    emit("staging/materiau", stagingMaterialFile.content, {
      environnement: stagingCoordinates.environment,
      compte: stagingCoordinates.accountId,
      zone: stagingCoordinates.zoneId,
      deploiement: stagingDeploymentId,
      materiau: "cloudflare/staging.resources.json",
      workers: stagingCoordinates.workers,
    }),
  );
  gates.push(
    emit("staging/deploiement", stagingProofFile.content, {
      compte: stagingCoordinates.accountId,
      environnement: "staging",
      deploiement: stagingDeploymentId,
      workers: stagingProof.workers.map(({ name }) => name),
    }),
  );
  gates.push(emit("production/bundle", provenanceFile.content));
  gates.push(emit("production/manifeste", aggregateFile.content));
  gates.push(
    emit("production/evidence/platform-index", platform.indexFile.content, {
      path: "promotion-evidence/platform-index.json",
    }),
  );
  gates.push(
    emit("production/evidence/recovery-index", recoveryIndexFile.content, {
      path: "promotion-evidence/recovery-index.json",
    }),
  );
  for (const platformName of PLATEFORMES) {
    gates.push(
      emit(
        `production/evidence/network/${platformName}`,
        networks.files.get(platformName).content,
        { path: `promotion-evidence/network/${platformName}.json` },
      ),
    );
  }

  const artifactScan = Buffer.from(
    `${JSON.stringify({ schema: "punks.artifact-scan.v1", scans: platform.artifactScans }, null, 2)}\n`,
  );
  const networkScan = Buffer.from(
    `${JSON.stringify({ schema: "punks.network-scan.v1", observations: networks.observations }, null, 2)}\n`,
  );
  gates.push(
    emit("scan/sources", gateLogFile.content, { gateIds: ["frontend-source"] }),
  );
  gates.push(
    emit("scan/dependances", gateLogFile.content, { gateIds: ["rust-graph"] }),
  );
  gates.push(
    emit("scan/artefact", artifactScan, {
      scans: platform.artifactScans,
    }),
  );
  gates.push(
    emit("scan/reseau", networkScan, {
      observations: networks.observations,
    }),
  );
  const scanSummary = Buffer.from(
    `${JSON.stringify(
      {
        schema: "punks.negative-scan-summary.v1",
        gateLogSha256: gateLogFile.sha256,
        platformIndexSha256: platform.indexFile.sha256,
        networkObservations: networks.observations,
      },
      null,
      2,
    )}\n`,
  );
  for (const [gate, gateIds] of Object.entries(GATE_PROOFS)) {
    const subject =
      gate === "tauri-staging" || gate === "accessibilite"
        ? platform.indexFile.content
        : gate === "scans-negatifs"
          ? scanSummary
          : gateLogFile.content;
    gates.push(
      emit(`gate/${gate}`, subject, {
        gateIds,
        gateReportSha256: gateReportFile.sha256,
        logSha256: gateObservation.logSha256,
      }),
    );
  }

  const withdrawalReferences = [];
  const lines = ledger["retraits-par-tranche"].lignes.filter(
    (line) => line?.tranche === "tranche:1",
  );
  if (lines.length === 0)
    fail("goldens ledger has no tranche 1 withdrawal lines");
  for (const line of lines) {
    if (typeof line.test !== "string" || typeof line.verdict !== "string") {
      fail("goldens ledger contains an invalid tranche 1 verdict");
    }
    withdrawalReferences.push(
      emit(`golden/${line.test}`, goldensFile.content, {
        test: line.test,
        verdict: line.verdict,
      }),
    );
  }
  const lineNames = lines.map(({ test }) => test);
  withdrawalReferences.push(
    emit("retrait/diff", withdrawalFile.content, {
      withdrawalInventorySha256: withdrawalFile.sha256,
      lignes: lineNames,
      verdictsExecutes: lineNames.length,
    }),
  );
  withdrawalReferences.push(
    emit("retrait/verdicts", gateLogFile.content, {
      goldensSha256: goldensFile.sha256,
      gateIds: ["migration-check"],
    }),
  );
  for (const gate of ["retrait-diff", "goldens-verdict"]) {
    withdrawalReferences.push(
      emit(`gate/${gate}`, gateLogFile.content, {
        gateIds: ["migration-check"],
        logSha256: gateLogFile.sha256,
      }),
    );
  }

  return {
    gatesIndex: writeIndex(evidenceRoot, "gates-index.json", gates),
    withdrawalIndex: writeIndex(
      evidenceRoot,
      "withdrawal-index.json",
      withdrawalReferences,
    ),
  };
}

function parseOptions(argv) {
  const names = [
    "candidate",
    "source-sha",
    "staging-deployment-id",
    "gate-report",
    "gate-log",
    "promotion-profile",
    "staging-material",
    "release-graph",
    "withdrawal-inventory",
    "goldens",
    "provenance-bundle",
  ];
  const expected = new Set(names.map((name) => `--${name}`));
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
    fail("exact observed evidence fragment CLI arguments are required");
  }
  return Object.fromEntries(
    names.map((name) => {
      const value = values.get(`--${name}`);
      if (!value) fail(`--${name} is required`);
      return [
        name.replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()),
        value,
      ];
    }),
  );
}

export function run(argv = process.argv.slice(2)) {
  return buildObservedEvidenceFragments(parseOptions(argv));
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
