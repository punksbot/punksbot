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
      schema: "punks.operational-metric-source.v1",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observer: "cloudflare-analytics",
      querySha256: canonicalSha256({ metric: budget.nom, dimension, query: 1 }),
      attestationSha256: canonicalSha256({
        metric: budget.nom,
        dimension,
        attestation: 1,
      }),
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
  const manifestContent = {
    schema: "punks.operational-budget-r2-manifest.v1",
    sourceSha,
    stagingDeploymentId,
    observation: observationReference,
    exports,
    sources,
    createdAt: "2026-08-26T20:20:00.000Z",
  };
  const manifest = {
    ...manifestContent,
    sha256: canonicalSha256(manifestContent),
  };
  const manifestBytes = bytes(manifest);
  const manifestKey = `${prefix}manifest.json`;
  objects.set(manifestKey, manifestBytes);
  return { objects, manifestBytes, observation };
}

test("downloads identical locked raw sources and recomputes every verdict", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-fetch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, "candidate");
  mkdirSync(candidateRoot);
  const output = join(candidateRoot, "operational-budget-observation.json");
  const exportsOutput = join(candidateRoot, "operational-budget-exports");
  const material = materials();
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
          async lireVerrouillage() {
            return { mode: "compliance", actif: true };
          },
          async lireObjet({ cle }) {
            return material.objects.get(cle) ?? null;
          },
        },
      },
    },
  );
  assert.deepEqual(
    JSON.parse(readFileSync(output, "utf8")),
    result.observation,
  );
  assert.equal(result.observation.verdicts.length, 36);
});
