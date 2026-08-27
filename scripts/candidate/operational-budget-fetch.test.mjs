import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
  PLATEFORMES,
} from "../release-graph-lib.mjs";
import { fetchOperationalBudgetEvidence } from "./operational-budget-fetch.mjs";
import { sealOperationalBudgetEvidence } from "./operational-budget-seal.mjs";
import { operationalBudgetSigstoreFixture } from "./operational-budget-test-fixture.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const sampleCount = 1_000_000;
const prefix = `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/`;

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function materials() {
  const objects = new Map();
  const published = new Map();
  const sources = [];
  const exports = [];
  const statistic = (budget, dimension) => {
    const samples =
      budget.unite === "pourcentage"
        ? { failures: 0, total: sampleCount }
        : budget.unite === "occurrences"
          ? { occurrences: 0, total: sampleCount }
          : { histogram: [{ value: 0, count: sampleCount }] };
    const source = {
      schema: "punks.operational-metric-source.v2",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observer: "cloudflare-analytics",
      querySha256: canonicalSha256({ metric: budget.nom, dimension, query: 1 }),
      observedAt: "2026-08-26T20:19:57.000Z",
      samples,
    };
    const sourceBytes = bytes(source);
    const sourceDigest = sha256(sourceBytes);
    const sourceKey = `${prefix}sources/${sourceDigest}.json`;
    sources.push({ key: sourceKey, sha256: sourceDigest });
    objects.set(sourceKey, sourceBytes);
    const raw = {
      schema: "punks.operational-metric-export.v1",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observedAt: "2026-08-26T20:19:58.000Z",
      provenance: [
        {
          path: `operational-budget-sources/${sourceDigest}.json`,
          sha256: sourceDigest,
        },
      ],
      samples,
    };
    const exportDigest = canonicalSha256(raw);
    const exportBytes = bytes(raw);
    const exportKey = `${prefix}exports/${exportDigest}.json`;
    exports.push({ key: exportKey, sha256: sha256(exportBytes) });
    objects.set(exportKey, exportBytes);
    return {
      mesure: 0,
      "borne-superieure-unilaterale-95":
        budget.unite === "pourcentage"
          ? borneWilsonUnilaterale95(0, sampleCount)
          : 0,
      echantillons: sampleCount,
      numerateur: budget.unite === "millisecondes" ? null : 0,
      denominateur: budget.unite === "pourcentage" ? sampleCount : null,
      methode:
        budget.unite === "pourcentage"
          ? "wilson-unilaterale-95"
          : budget.unite === "occurrences"
            ? "tolerance-zero"
            : "quantile-export-verifie",
      "baseline-n-1": {
        disponible: false,
        "mesure-n-1": null,
        "export-n-1-sha256": null,
        "regression-pourcentage": null,
        "justification-acceptee": false,
        "justification-sha256": null,
      },
      resultat: "vert",
      "export-sha256": exportDigest,
    };
  };
  const connectionMethods = ["google", "github", "passkey"];
  const verdicts = BUDGETS_PRODUCTION.map((budget) => {
    const dimensions =
      budget.nom === "connexion-desktop-echecs-par-moyen"
        ? connectionMethods
        : budget.nom === "desktop-sessions-avec-crash-par-plateforme"
          ? PLATEFORMES
          : [];
    return {
      nom: budget.nom,
      unite: budget.unite,
      "budget-max": budget.maximum,
      ...statistic(budget, null),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        ...statistic(budget, dimension),
      })),
    };
  });
  const outbox = statistic(
    { nom: "outboxes-en-attente", unite: "occurrences" },
    null,
  );
  const dlq = verdicts.find(({ nom }) => nom === "queues-dlq");
  const observationContent = {
    schema: "punks.operational-budget-observation.v1",
    sourceSha,
    stagingDeploymentId,
    connectionMethods,
    verdicts,
    bookmarks: [{ autorite: "staging", valeur: stagingDeploymentId }],
    dlq: { messages: 0, "export-sha256": dlq["export-sha256"] },
    outboxes: {
      "en-attente": 0,
      "export-sha256": outbox["export-sha256"],
    },
    incidents: [],
    observedAt: "2026-08-26T20:19:59.000Z",
  };
  const observation = {
    ...observationContent,
    sha256: canonicalSha256(observationContent),
  };
  const observationBytes = bytes(observation);
  const observationKey = `${prefix}observation.json`;
  const observationReference = {
    key: observationKey,
    sha256: sha256(observationBytes),
  };
  objects.set(observationKey, observationBytes);
  const provenanceBytes = operationalBudgetSigstoreFixture();
  const provenance = {
    repository: "punksbot/punksbot",
    sourceRef: "refs/heads/staging",
    signerWorkflow:
      "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
  };
  const manifestContent = {
    schema: "punks.operational-budget-r2-manifest.v3",
    sourceSha,
    stagingDeploymentId,
    observation: observationReference,
    exports,
    sources,
    provenance,
    createdAt: "2026-08-26T20:20:00.000Z",
  };
  const manifest = {
    ...manifestContent,
    sha256: canonicalSha256(manifestContent),
  };
  const manifestBytes = bytes(manifest);
  const manifestKey = `${prefix}manifest.json`;
  objects.set(manifestKey, manifestBytes);
  return {
    objects,
    published,
    manifest,
    manifestBytes,
    observation,
    provenanceBytes,
  };
}

function boundaries(material, publishedRoles = []) {
  return {
    cloudflare: {
      async lireVerrouillage({ cle }) {
        return { mode: "compliance", actif: cle === prefix };
      },
      async lireObjet({ role, cle }) {
        return (
          material.published.get(`${role}:${cle}`) ??
          material.objects.get(cle) ??
          null
        );
      },
      async creerObjet({ role, cle, contenu }) {
        publishedRoles.push(role);
        const coordinate = `${role}:${cle}`;
        if (material.published.has(coordinate)) {
          const error = new Error("already exists");
          error.code = "ALREADY_EXISTS";
          throw error;
        }
        material.published.set(coordinate, Buffer.from(contenu));
      },
    },
  };
}

async function stagedFixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), label));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  const material = materials();
  const destinations = [
    { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
    { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
  ];
  await fetchOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(material.manifestBytes),
      candidateRoot,
      destinations,
      output: join(candidateRoot, "operational-budget-observation.json"),
      exportsOutput: join(candidateRoot, "operational-budget-exports"),
    },
    { frontieres: boundaries(material) },
  );
  const bundle = join(root, "actions-attestation.sigstore.json");
  writeFileSync(bundle, material.provenanceBytes);
  return { root, candidateRoot, material, destinations, bundle };
}

test("downloads identical locked raw sources and recomputes every verdict", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-fetch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  const output = join(candidateRoot, "operational-budget-observation.json");
  const exportsOutput = join(candidateRoot, "operational-budget-exports");
  const material = materials();
  let verifiedSubjects = 0;
  const publishedRoles = [];
  const destinations = [
    { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
    { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
  ];
  const result = await fetchOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(material.manifestBytes),
      candidateRoot,
      destinations,
      output,
      exportsOutput,
    },
    {
      frontieres: boundaries(material, publishedRoles),
    },
  );
  const bundle = join(root, "actions-attestation.sigstore.json");
  writeFileSync(bundle, material.provenanceBytes);
  const sealed = await sealOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(material.manifestBytes),
      candidateRoot,
      destinations,
      bundle,
    },
    {
      frontieres: boundaries(material, publishedRoles),
      verifyProviderSubject({
        artifactContent,
        repository,
        sourceSha: verifiedSourceSha,
        sourceRef,
        signerWorkflow,
      }) {
        verifiedSubjects += 1;
        assert.equal(JSON.parse(artifactContent).sourceSha, sourceSha);
        assert.equal(repository, "punksbot/punksbot");
        assert.equal(verifiedSourceSha, sourceSha);
        assert.equal(sourceRef, "refs/heads/staging");
        assert.equal(
          signerWorkflow,
          "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
        );
        return [{ verified: true }];
      },
    },
  );
  assert.deepEqual(
    JSON.parse(readFileSync(output, "utf8")),
    result.observation,
  );
  assert.equal(result.observation.verdicts.length, 36);
  assert.equal(verifiedSubjects, material.manifest.sources.length);
  assert.deepEqual(publishedRoles.sort(), ["primaire", "secondaire"]);
  assert.equal(sealed.bundle.sha256, sha256(material.provenanceBytes));
});

test("rejects every metric source when its GitHub OIDC subject cannot be verified", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-unverified-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  const material = materials();
  const destinations = [
    { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
    { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
  ];

  await fetchOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(material.manifestBytes),
      candidateRoot,
      destinations,
      output: join(candidateRoot, "operational-budget-observation.json"),
      exportsOutput: join(candidateRoot, "operational-budget-exports"),
    },
    { frontieres: boundaries(material) },
  );
  const bundle = join(root, "actions-attestation.sigstore.json");
  writeFileSync(bundle, material.provenanceBytes);
  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(material.manifestBytes),
        candidateRoot,
        destinations,
        bundle,
      },
      {
        frontieres: boundaries(material),
        verifyProviderSubject() {
          throw new Error("GitHub OIDC subject rejected");
        },
      },
    ),
    /GitHub OIDC subject rejected/,
  );
});

test("resumes when the primary bundle already exists and the secondary is absent", async (t) => {
  const fixture = await stagedFixture(t, "punks-budget-partial-");
  const bundleSha256 = sha256(fixture.material.provenanceBytes);
  const key = `${prefix}provenance/${bundleSha256}.sigstore.json`;
  fixture.material.published.set(
    `primaire:${key}`,
    fixture.material.provenanceBytes,
  );
  const publishedRoles = [];

  await sealOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(fixture.material.manifestBytes),
      candidateRoot: fixture.candidateRoot,
      destinations: fixture.destinations,
      bundle: fixture.bundle,
    },
    {
      frontieres: boundaries(fixture.material, publishedRoles),
      verifyProviderSubject: () => [{ verified: true }],
    },
  );
  assert.deepEqual(publishedRoles, ["secondaire"]);
});

test("recovers an ALREADY_EXISTS race only when the concurrent bytes are exact", async (t) => {
  const fixture = await stagedFixture(t, "punks-budget-race-");
  const publishedRoles = [];
  const frontieres = boundaries(fixture.material, publishedRoles);
  frontieres.cloudflare.creerObjet = async ({ role, cle, contenu }) => {
    publishedRoles.push(role);
    fixture.material.published.set(`${role}:${cle}`, Buffer.from(contenu));
    const error = new Error("concurrent create");
    error.code = "ALREADY_EXISTS";
    throw error;
  };

  await sealOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: sha256(fixture.material.manifestBytes),
      candidateRoot: fixture.candidateRoot,
      destinations: fixture.destinations,
      bundle: fixture.bundle,
    },
    {
      frontieres,
      verifyProviderSubject: () => [{ verified: true }],
    },
  );
  assert.deepEqual(publishedRoles.sort(), ["primaire", "secondaire"]);
});

test("rejects a divergent pre-existing bundle before publishing the other copy", async (t) => {
  const fixture = await stagedFixture(t, "punks-budget-divergent-");
  const bundleSha256 = sha256(fixture.material.provenanceBytes);
  const key = `${prefix}provenance/${bundleSha256}.sigstore.json`;
  fixture.material.published.set(`primaire:${key}`, Buffer.from("divergent"));
  const publishedRoles = [];

  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(fixture.material.manifestBytes),
        candidateRoot: fixture.candidateRoot,
        destinations: fixture.destinations,
        bundle: fixture.bundle,
      },
      {
        frontieres: boundaries(fixture.material, publishedRoles),
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /primary operational Sigstore bundle diverges|primaire operational Sigstore bundle diverges/i,
  );
  assert.deepEqual(publishedRoles, []);
});

test("rejects when a prefix lock disappears during bundle publication", async (t) => {
  const fixture = await stagedFixture(t, "punks-budget-lock-race-");
  const frontieres = boundaries(fixture.material);
  const lockReads = new Map();
  frontieres.cloudflare.lireVerrouillage = async ({ role, cle }) => {
    assert.equal(cle, prefix);
    const count = (lockReads.get(role) ?? 0) + 1;
    lockReads.set(role, count);
    return {
      mode: "compliance",
      actif: !(role === "primaire" && count === 2),
    };
  };

  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(fixture.material.manifestBytes),
        candidateRoot: fixture.candidateRoot,
        destinations: fixture.destinations,
        bundle: fixture.bundle,
      },
      {
        frontieres,
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /lock changed during publish/i,
  );
});

test("cleans the first local directory when the second directory cannot be created", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-local-retry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  writeFileSync(join(candidateRoot, "operational-budget-sources"), "blocked\n");
  const material = materials();
  const exportsOutput = join(candidateRoot, "operational-budget-exports");

  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(material.manifestBytes),
        candidateRoot,
        destinations: [
          { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
          { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
        ],
        output: join(candidateRoot, "operational-budget-observation.json"),
        exportsOutput,
      },
      { frontieres: boundaries(material) },
    ),
    /EEXIST|directory|file/i,
  );
  assert.equal(existsSync(exportsOutput), false);
  assert.equal(
    readFileSync(join(candidateRoot, "operational-budget-sources"), "utf8"),
    "blocked\n",
  );
});

test("preserves a pre-existing provenance directory when local sealing conflicts", async (t) => {
  const fixture = await stagedFixture(t, "punks-budget-seal-conflict-");
  const provenanceRoot = join(
    fixture.candidateRoot,
    "operational-budget-provenance",
  );
  mkdirSync(provenanceRoot);
  const sentinel = join(provenanceRoot, "concurrent-proof");
  writeFileSync(sentinel, "preserve me\n");

  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(fixture.material.manifestBytes),
        candidateRoot: fixture.candidateRoot,
        destinations: fixture.destinations,
        bundle: fixture.bundle,
      },
      {
        frontieres: boundaries(fixture.material),
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /EEXIST|exist/i,
  );
  assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");
});
