import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  bundleSigstoreFixture,
  contenuScanArtefactInstalleFixture,
} from "../promotion-test-fixtures.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { PLATEFORMES } from "../release-graph-lib.mjs";
import {
  buildObservedEvidenceFragments,
  GATES_FRAGMENT_IDS,
} from "./observed-evidence-fragments.mjs";
import {
  buildSecretlessGatesReport,
  GATE_IDS,
} from "./secretless-gates-report.mjs";

const SOURCE_SHA = "7e".repeat(20);
const GOLDEN_TEST = "legacy/social-loop.test.mjs";
const WORKERS = CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
  name,
  versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  sourceShaAnnotation: sourceShaAnnotation(SOURCE_SHA),
  deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
}));
const PROOF_CORE = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SOURCE_SHA,
  observer: "cloudflare-remote",
  workers: WORKERS,
};
const DEPLOYMENT_ID = `sha256:${sha256(canonicalJson(PROOF_CORE))}`;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function write(path, content) {
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  return path;
}

function addPlatformReference(
  input,
  id,
  subject = Buffer.from(`observed:${id}\n`),
  data = {},
) {
  const subjectSha256 = sha256(subject);
  const safe = id.replaceAll(/[^a-z0-9.-]/giu, "-");
  const subjectPath = `sha256/${subjectSha256}-${safe}-subject.bin`;
  write(join(input.evidence, subjectPath), subject);
  const proof = Buffer.from(
    `${JSON.stringify({
      schema: "punks.promotion-proof.v1",
      id,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      result: "vert",
      data: { ...data, subjectSha256 },
    })}\n`,
  );
  const proofSha256 = sha256(proof);
  const proofPath = `sha256/${proofSha256}-${safe}.json`;
  write(join(input.evidence, proofPath), proof);
  return {
    id,
    chemin: proofPath,
    sha256: proofSha256,
    sujet: { chemin: subjectPath, sha256: subjectSha256 },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-observed-fragments-"));
  const candidate = join(root, "candidate");
  const evidence = join(candidate, "promotion-evidence");
  const network = join(evidence, "network");
  const gateRoot = join(root, "gates");
  mkdirSync(join(evidence, "sha256"), { recursive: true });
  mkdirSync(network);
  mkdirSync(gateRoot);

  const aggregate = `${JSON.stringify({
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
  })}\n`;
  write(join(candidate, "aggregate-manifest.json"), aggregate);
  const stagingProof = `${JSON.stringify(
    { ...PROOF_CORE, deploymentId: DEPLOYMENT_ID },
    null,
    2,
  )}\n`;
  write(join(evidence, "staging-deployment-proof.json"), stagingProof);

  const platformReferences = [];
  for (const platform of PLATEFORMES) {
    let artifactSha256;
    let artifactSize;
    for (const id of [
      `transcript/${platform}`,
      `brut/${platform}`,
      `staging/reobservation/${platform}`,
      `artefact/${platform}/bundle`,
      `artefact/${platform}/signature`,
      `scan/artefact/${platform}`,
      ...[
        "signature",
        "identite-application",
        "protocol-handlers",
        "stockage-securise",
        "updater",
      ].map((name) => `artefact/${platform}/verification/${name}`),
      `parcours/${platform}/connexion`,
      ...MATRICE_ACCESSIBILITE.map(
        (criterion) => `accessibilite/${platform}/${criterion}`,
      ),
      `accessibilite/${platform}/resultat`,
    ]) {
      let subject;
      if (id === `scan/artefact/${platform}`) {
        const suffix = platform.startsWith("macos-")
          ? ".app.tar.gz"
          : platform === "linux-x64"
            ? ".AppImage"
            : ".exe";
        subject = Buffer.from(
          contenuScanArtefactInstalleFixture({
            plateforme: platform,
            candidateSha: SOURCE_SHA,
            nomArtefact: `punks-desktop-${platform}-${SOURCE_SHA}${suffix}`,
            tailleArtefact: artifactSize,
            sha256Artefact: artifactSha256,
            sha256Natif: "61".repeat(32),
            tailleNatif: 456,
          }),
        );
      }
      const reference = addPlatformReference({ evidence }, id, subject);
      if (id === `artefact/${platform}/bundle`) {
        artifactSha256 = reference.sujet.sha256;
        artifactSize = Buffer.byteLength(`observed:${id}\n`);
      }
      platformReferences.push(reference);
    }
    write(
      join(network, `${platform}.json`),
      `${JSON.stringify({
        schema: "punks.installed-network-proof.v1",
        platform,
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        transcriptSha256: "aa".repeat(32),
        network: {
          requests: [
            {
              transport: "https",
              method: "POST",
              origin: "https://staging.punks.bot",
              path: "/api/v1/desktop/compatibility",
              status: 200,
            },
            {
              transport: "wss",
              method: "FOLLOW",
              origin: "wss://staging.punks.bot",
              path: "/api/v1/workspaces/w/conversations/c/follow",
              status: 101,
            },
          ],
        },
      })}\n`,
    );
  }
  write(
    join(evidence, "platform-index.json"),
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: platformReferences,
    })}\n`,
  );
  write(
    join(evidence, "recovery-index.json"),
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: [platformReferences[0]],
    })}\n`,
  );

  const profile = write(
    join(root, "promotion-profiles.json"),
    `${JSON.stringify({
      schema: "punks.promotion-profiles.v1",
      profiles: [
        {
          tranche: 1,
          id: "desktop-social-loop@1",
          stories: ["connexion"],
          authorities: [
            { id: "workspace", kind: "service", worker: "punks-api-staging" },
          ],
        },
      ],
    })}\n`,
  );
  const stagingMaterial = write(
    join(root, "staging.resources.json"),
    `${JSON.stringify({
      environment: "staging",
      account: { id: CANONICAL_STAGING_ACCOUNT_ID },
      zone: { id: "ab".repeat(16) },
      workers: Object.fromEntries(
        CANONICAL_STAGING_WORKER_NAMES.map((name) => [name, { name }]),
      ),
    })}\n`,
  );
  const releaseGraph = write(
    join(root, "release-graph.yaml"),
    `version: 1
preuves-obligatoires:
  - corpus-conformite
  - suites-workers
  - cloudflare-check
  - playwright-facade
  - tauri-staging
  - accessibilite
  - fautes-injectees
  - retrait-diff
  - goldens-verdict
  - scans-negatifs
releases:
  - id: tranche:1
    tranche: 1
    etat: preparation
    materiaux:
      registre-contrats: {version: 1, sha256: "${"11".repeat(32)}"}
      profil: {version: 1, sha256: "${"22".repeat(32)}"}
      registre-goldens: {version: 1, sha256: "${"33".repeat(32)}"}
      manifeste-retrait: {version: 1, sha256: "${"44".repeat(32)}"}
`,
  );
  const withdrawal = write(
    join(root, "withdrawal-inventory.yaml"),
    "version: 1\nactifs: []\n",
  );
  const goldens = write(
    join(root, "goldens-ledger.yaml"),
    `version: 1
retraits-par-tranche:
  lignes:
    - test: ${GOLDEN_TEST}
      tranche: tranche:1
      verdict: difference-intentionnelle
      decision: "#47"
`,
  );
  const provenance = write(
    join(root, "provenance.sigstore.json"),
    `${JSON.stringify(bundleSigstoreFixture())}\n`,
  );

  const gateLog = write(
    join(gateRoot, "punks-secretless-gates.log"),
    `${GATE_IDS.flatMap((id) => [
      `::punks-gate::${id}::start`,
      `${id} observed output`,
      `::punks-gate::${id}::pass`,
    ]).join("\n")}\n`,
  );
  const gateReport = join(gateRoot, "punks-secretless-gates-report.json");
  buildSecretlessGatesReport({
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    log: gateLog,
    output: gateReport,
  });

  return {
    root,
    candidate,
    gateReport,
    gateLog,
    profile,
    stagingMaterial,
    releaseGraph,
    withdrawal,
    goldens,
    provenance,
  };
}

function options(input) {
  return {
    candidate: input.candidate,
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    gateReport: input.gateReport,
    gateLog: input.gateLog,
    promotionProfile: input.profile,
    stagingMaterial: input.stagingMaterial,
    releaseGraph: input.releaseGraph,
    withdrawalInventory: input.withdrawal,
    goldens: input.goldens,
    provenanceBundle: input.provenance,
  };
}

test("builds gate and withdrawal fragments only from observed subjects", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));

  const result = buildObservedEvidenceFragments(options(input));
  const gates = JSON.parse(readFileSync(result.gatesIndex, "utf8"));
  const withdrawal = JSON.parse(readFileSync(result.withdrawalIndex, "utf8"));

  assert.deepEqual(
    gates.preuves.map(({ id }) => id).sort(),
    [...GATES_FRAGMENT_IDS].sort(),
  );
  const artifactScanReference = gates.preuves.find(
    ({ id }) => id === "scan/artefact",
  );
  const artifactScans = JSON.parse(
    readFileSync(
      join(
        input.candidate,
        "promotion-evidence",
        artifactScanReference.sujet.chemin,
      ),
      "utf8",
    ),
  );
  assert.ok(
    artifactScans.scans.every(
      ({ installationSha256, installationFiles }) =>
        /^[0-9a-f]{64}$/.test(installationSha256) && installationFiles === 2,
    ),
  );
  assert.deepEqual(
    withdrawal.preuves.map(({ id }) => id).sort(),
    [
      `golden/${GOLDEN_TEST}`,
      "retrait/diff",
      "retrait/verdicts",
      "gate/retrait-diff",
      "gate/goldens-verdict",
    ].sort(),
  );
});

test("writes no fragment index when the observed gate log diverges", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  writeFileSync(input.gateLog, "replaced after report\n");

  assert.throws(
    () => buildObservedEvidenceFragments(options(input)),
    /gate log.*hash|divergent/i,
  );
  assert.throws(
    () =>
      readFileSync(
        join(input.candidate, "promotion-evidence", "gates-index.json"),
      ),
    /ENOENT/,
  );
});
