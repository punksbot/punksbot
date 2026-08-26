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
import { bundleSigstoreFixture } from "../promotion-test-fixtures.mjs";
import { VERIFICATIONS_ARTEFACT } from "../promotion-installed-transcript-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "../promotion-resilience-lib.mjs";
import { PLATEFORMES } from "../release-graph-lib.mjs";
import { completePromotionEvidence } from "./complete-promotion-evidence.mjs";

const SOURCE_SHA = "8d".repeat(20);
const PROFILE_STORIES = ["connexion"];
const PROFILE_AUTHORITIES = ["workspace"];
const REQUIRED_GATES = ["cloudflare-check"];
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
const STAGING_PROOF = { ...PROOF_CORE, deploymentId: DEPLOYMENT_ID };

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-complete-evidence-"));
  const candidate = join(root, "candidate");
  const evidence = join(candidate, "promotion-evidence");
  const content = join(evidence, "sha256");
  mkdirSync(content, { recursive: true });
  const network = join(evidence, "network");
  mkdirSync(network);
  for (const platform of PLATEFORMES) {
    writeFileSync(
      join(network, `${platform}.json`),
      `${JSON.stringify({
        schema: "punks.installed-network-proof.v1",
        platform,
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        network: { requests: [{ transport: "https" }, { transport: "wss" }] },
      })}\n`,
    );
  }
  const aggregateContent = `${JSON.stringify({
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
  })}\n`;
  writeFileSync(join(candidate, "aggregate-manifest.json"), aggregateContent);
  const profileContent = `${JSON.stringify({
    schema: "punks.promotion-profiles.v1",
    profiles: [
      {
        tranche: 1,
        id: "desktop-social-loop@1",
        stories: PROFILE_STORIES,
        authorities: [
          { id: "workspace", kind: "service", worker: "punks-api-staging" },
        ],
      },
    ],
  })}\n`;
  const stagingMaterialContent = `${JSON.stringify({
    environment: "staging",
    account: { id: CANONICAL_STAGING_ACCOUNT_ID },
    zone: { id: "ab".repeat(16) },
    workers: Object.fromEntries(
      CANONICAL_STAGING_WORKER_NAMES.map((name) => [name, { name }]),
    ),
  })}\n`;
  const releaseGraphContent = `version: 1\npreuves-obligatoires:\n  - cloudflare-check\n`;
  const withdrawalContent = `version: 1\nactifs: []\n`;
  const goldensContent = `version: 1\nretraits-par-tranche:\n  lignes:\n    - test: ${GOLDEN_TEST}\n      tranche: tranche:1\n`;
  const provenanceContent = `${JSON.stringify(bundleSigstoreFixture())}\n`;
  const materials = {};
  for (const [name, value] of [
    ["promotion-profile", profileContent],
    ["staging-material", stagingMaterialContent],
    ["release-graph", releaseGraphContent],
    ["withdrawal-inventory", withdrawalContent],
    ["goldens", goldensContent],
    ["provenance-bundle", provenanceContent],
  ]) {
    const path = join(root, `${name}.json`);
    writeFileSync(path, value);
    materials[name] = path;
  }
  const stagingProofContent = `${JSON.stringify(STAGING_PROOF, null, 2)}\n`;
  writeFileSync(
    join(evidence, "staging-deployment-proof.json"),
    stagingProofContent,
  );
  return {
    root,
    candidate,
    evidence,
    content,
    output: join(evidence, "index.json"),
    materials,
    contents: {
      aggregate: aggregateContent,
      profile: profileContent,
      stagingMaterial: stagingMaterialContent,
      stagingProof: stagingProofContent,
      releaseGraph: releaseGraphContent,
      withdrawal: withdrawalContent,
      goldens: goldensContent,
      provenance: provenanceContent,
    },
  };
}

function requiredIdsByFragment() {
  const platform = [];
  const gates = [
    "candidat",
    "profil/promotion",
    "registres",
    "staging/materiau",
    "staging/deploiement",
    "production/bundle",
    "production/manifeste",
    "production/evidence/platform-index",
    "production/evidence/recovery-index",
    ...REQUIRED_GATES.map((gate) => `gate/${gate}`),
    "scan/sources",
    "scan/dependances",
    "scan/artefact",
    "scan/reseau",
  ];
  const recovery = ["recuperation/captures"];
  const withdrawal = [
    `golden/${GOLDEN_TEST}`,
    "retrait/diff",
    "retrait/verdicts",
  ];
  for (const target of PLATEFORMES) {
    gates.push(`production/evidence/network/${target}`);
    platform.push(
      `transcript/${target}`,
      `brut/${target}`,
      `staging/reobservation/${target}`,
      `artefact/${target}/bundle`,
      `artefact/${target}/signature`,
      `scan/artefact/${target}`,
      ...VERIFICATIONS_ARTEFACT.map(
        (verification) => `artefact/${target}/verification/${verification}`,
      ),
      ...PROFILE_STORIES.map((story) => `parcours/${target}/${story}`),
      ...MATRICE_ACCESSIBILITE.map(
        (criterion) => `accessibilite/${target}/${criterion}`,
      ),
      `accessibilite/${target}/resultat`,
    );
  }
  for (const type of TYPES_FAUTE) {
    for (const authority of PROFILE_AUTHORITIES) {
      recovery.push(
        `faute/${type}/${authority}`,
        ...PREUVES_RECUPERATION.map(
          (proof) => `recuperation/${proof}/${type}/${authority}`,
        ),
      );
    }
  }
  return { platform, gates, recovery, withdrawal };
}

function proofMaterial(input, id) {
  const material = {
    candidat: input.contents.aggregate,
    "profil/promotion": input.contents.profile,
    "staging/materiau": input.contents.stagingMaterial,
    "staging/deploiement": input.contents.stagingProof,
    "production/bundle": input.contents.provenance,
    "production/manifeste": input.contents.aggregate,
  }[id];
  const data = {};
  if (id === "production/evidence/platform-index") {
    data.path = "promotion-evidence/platform-index.json";
    return {
      subject: readFileSync(join(input.evidence, "platform-index.json")),
      data,
    };
  }
  if (id === "production/evidence/recovery-index") {
    data.path = "promotion-evidence/recovery-index.json";
    return {
      subject: readFileSync(join(input.evidence, "recovery-index.json")),
      data,
    };
  }
  const network = /^production\/evidence\/network\/(.+)$/u.exec(id);
  if (network) {
    data.path = `promotion-evidence/network/${network[1]}.json`;
    return {
      subject: readFileSync(
        join(input.evidence, "network", `${network[1]}.json`),
      ),
      data,
    };
  }
  if (id === "registres") {
    data.materials = {
      releaseGraphSha256: sha256(input.contents.releaseGraph),
      withdrawalInventorySha256: sha256(input.contents.withdrawal),
      goldensSha256: sha256(input.contents.goldens),
    };
  }
  if (id === "retrait/diff") {
    data.withdrawalInventorySha256 = sha256(input.contents.withdrawal);
  }
  if (id === "retrait/verdicts") {
    data.goldensSha256 = sha256(input.contents.goldens);
  }
  return { subject: Buffer.from(material ?? `observed:${id}\n`), data };
}

function addFragment(input, fragment, ids) {
  const references = [];
  for (const id of ids) {
    const safeId = id.replaceAll(/[^a-z0-9.-]/giu, "-");
    const { subject, data } = proofMaterial(input, id);
    const subjectDigest = sha256(subject);
    const subjectPath = `sha256/${subjectDigest}-${safeId}-subject.bin`;
    writeFileSync(join(input.evidence, subjectPath), subject, { flag: "wx" });
    const proof = Buffer.from(
      `${JSON.stringify({
        schema: "punks.promotion-proof.v1",
        id,
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        result: "vert",
        data: { ...data, subjectSha256: subjectDigest },
      })}\n`,
    );
    const proofDigest = sha256(proof);
    const proofPath = `sha256/${proofDigest}-${safeId}.json`;
    writeFileSync(join(input.evidence, proofPath), proof, { flag: "wx" });
    references.push({
      id,
      chemin: proofPath,
      sha256: proofDigest,
      sujet: { chemin: subjectPath, sha256: subjectDigest },
    });
  }
  writeFileSync(
    join(input.evidence, `${fragment}-index.json`),
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: references,
    })}\n`,
  );
}

function addCompleteFragments(input, omitted = null) {
  const fragments = requiredIdsByFragment();
  for (const name of ["platform", "recovery", "gates", "withdrawal"]) {
    addFragment(input, name, fragments[name]);
  }
  if (omitted !== null) {
    rmSync(join(input.evidence, `${omitted}-index.json`));
  }
  return fragments;
}

function options(input) {
  return {
    candidate: input.candidate,
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    promotionProfile: input.materials["promotion-profile"],
    stagingMaterial: input.materials["staging-material"],
    releaseGraph: input.materials["release-graph"],
    withdrawalInventory: input.materials["withdrawal-inventory"],
    goldens: input.materials.goldens,
    provenanceBundle: input.materials["provenance-bundle"],
    output: input.output,
  };
}

test("merges only the four closed observed evidence fragments", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const fragments = addCompleteFragments(input);

  const index = completePromotionEvidence(options(input));

  assert.deepEqual(
    index.preuves.map(({ id }) => id),
    Object.values(fragments).flat().sort(),
  );
  assert.deepEqual(JSON.parse(readFileSync(input.output, "utf8")), index);
});

test("writes nothing when one observed evidence fragment is missing", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  addCompleteFragments(input, "recovery");

  assert.throws(
    () => completePromotionEvidence(options(input)),
    /recovery-index\.json.*missing/i,
  );
  assert.throws(() => readFileSync(input.output), /ENOENT/);
});

test("rejects four arbitrary green proofs instead of treating them as a dossier", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  addFragment(input, "platform", ["arbitrary/platform"]);
  addFragment(input, "gates", ["arbitrary/gate"]);
  addFragment(input, "recovery", ["arbitrary/recovery"]);
  addFragment(input, "withdrawal", ["arbitrary/withdrawal"]);

  assert.throws(
    () => completePromotionEvidence(options(input)),
    /required evidence set/i,
  );
  assert.throws(() => readFileSync(input.output), /ENOENT/);
});
