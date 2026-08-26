import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const provenanceBytes = bytes({
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payload: Buffer.from("operational budget provenance").toString("base64"),
      signatures: [{ sig: Buffer.from("signature").toString("base64") }],
    },
    verificationMaterial: {},
  });
  const provenanceDigest = sha256(provenanceBytes);
  const provenance = {
    key: `${prefix}provenance/${provenanceDigest}.sigstore.json`,
    sha256: provenanceDigest,
    repository: "punksbot/punksbot",
    sourceRef: "refs/heads/staging",
    signerWorkflow:
      "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
  };
  objects.set(provenance.key, provenanceBytes);
  const manifestContent = {
    schema: "punks.operational-budget-r2-manifest.v2",
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
  return { objects, manifest, manifestBytes, observation };
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
      frontieres: {
        cloudflare: {
          async lireVerrouillage({ cle }) {
            return {
              mode: "compliance",
              actif: cle === prefix,
            };
          },
          async lireObjet({ cle }) {
            return material.objects.get(cle) ?? null;
          },
        },
      },
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

  await assert.rejects(
    fetchOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: sha256(material.manifestBytes),
        candidateRoot,
        destinations,
        output: join(candidateRoot, "operational-budget-observation.json"),
        exportsOutput: join(candidateRoot, "operational-budget-exports"),
      },
      {
        frontieres: {
          cloudflare: {
            async lireVerrouillage({ cle }) {
              return {
                mode: "compliance",
                actif: cle === prefix,
              };
            },
            async lireObjet({ cle }) {
              return material.objects.get(cle) ?? null;
            },
          },
        },
        verifyProviderSubject() {
          throw new Error("GitHub OIDC subject rejected");
        },
      },
    ),
    /GitHub OIDC subject rejected/,
  );
});
