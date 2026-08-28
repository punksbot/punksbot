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
import { OPERATIONAL_BUDGET_PROVENANCE } from "./operational-budget-evidence.mjs";
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

function materials({
  latencySampleCount = sampleCount,
  sourceObservedAt = "2026-08-26T20:19:57.000Z",
  exportObservedAt = "2026-08-26T20:19:58.000Z",
  observationObservedAt = "2026-08-26T20:19:59.000Z",
} = {}) {
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
          : { histogram: [{ value: 0, count: latencySampleCount }] };
    const source = {
      schema: "punks.operational-metric-source.v2",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observer: "cloudflare-analytics",
      querySha256: canonicalSha256({ metric: budget.nom, dimension, query: 1 }),
      observedAt: sourceObservedAt,
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
      observedAt: exportObservedAt,
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
      echantillons:
        budget.unite === "millisecondes" ? latencySampleCount : sampleCount,
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
  const connectionMethods = ["google", "github"];
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
    observedAt: observationObservedAt,
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
  const provenanceSha256 = sha256(provenanceBytes);
  const provenanceKey = `${prefix}provenance/${provenanceSha256}.sigstore.json`;
  objects.set(provenanceKey, provenanceBytes);
  const provenance = {
    ...OPERATIONAL_BUDGET_PROVENANCE,
    bundle: { key: provenanceKey, sha256: provenanceSha256 },
  };
  const manifestContent = {
    schema: "punks.operational-budget-r2-manifest.v4",
    sourceSha,
    stagingDeploymentId,
    observation: observationReference,
    exports,
    sources,
    provenance,
    createdAt: observationObservedAt,
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

async function stagedFixture(t, label, materialOptions) {
  const root = mkdtempSync(join(tmpdir(), label));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  const material = materials(materialOptions);
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
  const bundle = join(
    candidateRoot,
    "operational-budget-provider.sigstore.json",
  );
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
  const bundle = join(
    candidateRoot,
    "operational-budget-provider.sigstore.json",
  );
  assert.equal(sha256(readFileSync(bundle)), sha256(material.provenanceBytes));
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
          OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow,
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
  assert.deepEqual(publishedRoles, []);
  assert.equal(sealed.bundle.sha256, sha256(material.provenanceBytes));
});

test("rejects legacy self-declared provenance and an absent provider bundle", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-provider-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destinations = [
    { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
    { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
  ];

  const legacy = materials();
  legacy.manifest.schema = "punks.operational-budget-r2-manifest.v3";
  const { sha256: ignored, ...legacyContent } = legacy.manifest;
  assert.match(ignored, /^[0-9a-f]{64}$/u);
  legacy.manifest.sha256 = canonicalSha256(legacyContent);
  legacy.manifestBytes = bytes(legacy.manifest);
  legacy.objects.set(`${prefix}manifest.json`, legacy.manifestBytes);
  const legacyRoot = join(root, "legacy");
  mkdirSync(legacyRoot);
  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(legacy.manifestBytes),
        candidateRoot: legacyRoot,
        destinations,
        output: join(legacyRoot, "observation.json"),
        exportsOutput: join(legacyRoot, "exports"),
      },
      { frontieres: boundaries(legacy) },
    ),
    /manifest identity|schema|provenance/i,
  );

  const selfAttested = materials();
  selfAttested.manifest.provenance.signerWorkflow =
    "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml";
  const { sha256: selfDigest, ...selfContent } = selfAttested.manifest;
  assert.match(selfDigest, /^[0-9a-f]{64}$/u);
  selfAttested.manifest.sha256 = canonicalSha256(selfContent);
  selfAttested.manifestBytes = bytes(selfAttested.manifest);
  selfAttested.objects.set(
    `${prefix}manifest.json`,
    selfAttested.manifestBytes,
  );
  const selfRoot = join(root, "self-attested");
  mkdirSync(selfRoot);
  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(selfAttested.manifestBytes),
        candidateRoot: selfRoot,
        destinations,
        output: join(selfRoot, "observation.json"),
        exportsOutput: join(selfRoot, "exports"),
      },
      { frontieres: boundaries(selfAttested) },
    ),
    /provenance identity/i,
  );

  const missing = materials();
  missing.objects.delete(missing.manifest.provenance.bundle.key);
  const missingRoot = join(root, "missing");
  mkdirSync(missingRoot);
  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(missing.manifestBytes),
        candidateRoot: missingRoot,
        destinations,
        output: join(missingRoot, "observation.json"),
        exportsOutput: join(missingRoot, "exports"),
      },
      { frontieres: boundaries(missing) },
    ),
    /provider.*bundle|absent|divergent/i,
  );
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
  const bundle = join(
    candidateRoot,
    "operational-budget-provider.sigstore.json",
  );
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

test("writes no local evidence when a bucket lock changes during the remote read", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-fetch-lock-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const material = materials();
  const frontieres = boundaries(material);
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
  const output = join(root, "observation.json");
  const exportsOutput = join(root, "exports");
  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(material.manifestBytes),
        candidateRoot: root,
        destinations: [
          { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
          { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
        ],
        output,
        exportsOutput,
      },
      { frontieres },
    ),
    /lock changed during read/i,
  );
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(exportsOutput), false);
  assert.equal(
    existsSync(join(root, "operational-budget-provider.sigstore.json")),
    false,
  );
});

test("rejects insufficient latency samples and stale provider windows", async (t) => {
  const insufficient = await stagedFixture(t, "punks-budget-latency-samples-", {
    latencySampleCount: 9_999,
  });
  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(insufficient.material.manifestBytes),
        candidateRoot: insufficient.candidateRoot,
        destinations: insufficient.destinations,
        bundle: insufficient.bundle,
      },
      {
        frontieres: boundaries(insufficient.material),
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /latency sample count is insufficient/i,
  );

  const stale = await stagedFixture(t, "punks-budget-stale-provider-", {
    sourceObservedAt: "2026-08-24T20:19:57.000Z",
    exportObservedAt: "2026-08-24T20:19:58.000Z",
  });
  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(stale.material.manifestBytes),
        candidateRoot: stale.candidateRoot,
        destinations: stale.destinations,
        bundle: stale.bundle,
      },
      {
        frontieres: boundaries(stale.material),
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /stale or temporally divergent/i,
  );

  const nonCanonical = await stagedFixture(
    t,
    "punks-budget-noncanonical-time-",
    { sourceObservedAt: 1_787_906_400_000 },
  );
  await assert.rejects(
    sealOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(nonCanonical.material.manifestBytes),
        candidateRoot: nonCanonical.candidateRoot,
        destinations: nonCanonical.destinations,
        bundle: nonCanonical.bundle,
      },
      {
        frontieres: boundaries(nonCanonical.material),
        verifyProviderSubject: () => [{ verified: true }],
      },
    ),
    /closed UTC instant/i,
  );
});

test("rejects a divergent provider bundle from either locked copy", async (t) => {
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
    /primaire operational provider bundle is absent or diverges/i,
  );
  assert.deepEqual(publishedRoles, []);
});

test("rejects when a prefix lock disappears during provider verification", async (t) => {
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
    /lock changed during verification/i,
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
