import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
  PLATEFORMES,
  SURFACES_TOPOLOGIE,
} from "../release-graph-lib.mjs";
import {
  buildOperationalReleaseHead,
  operationalEvidenceDigests,
  publishOperationalReleaseHead,
  validateOperationalReleaseHead,
} from "./operational-release-head.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const keys = ["ops:one", "ops:two"].map((id) => {
  const pair = generateKeyPairSync("ed25519");
  return {
    id,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
});
const approbation = {
  approbateurs: keys.map(({ id, publicKey }) => ({
    id,
    "cle-publique-spki": publicKey,
  })),
  async signerRecu({ contenu, approbateurs }) {
    return approbateurs.map((id) => {
      const key = keys.find((candidate) => candidate.id === id);
      return {
        approbateur: id,
        algorithme: "ed25519",
        "cle-publique-spki": key.publicKey,
        valeur: sign(
          null,
          Buffer.from(canonicalJson(contenu)),
          key.privateKey,
        ).toString("hex"),
      };
    });
  },
};

function dossier() {
  return {
    candidat: { sha: sourceSha },
    liaison: {
      staging: { deploiement: stagingDeploymentId },
      artefacts: [{ plateforme: "linux-x64", sha256: "01".repeat(32) }],
    },
    gates: { cloudflare: { resultat: "vert" } },
    parcours: {
      plateformes: ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"],
    },
    accessibilite: { resultat: "vert" },
    recuperation: { resultat: "vert" },
    retrait: { resultat: "vert" },
    fautes: { resultat: "vert" },
    scans: { resultat: "vert" },
    goldens: { resultat: "vert" },
  };
}

function topology() {
  return {
    workers: [
      { nom: "punks-api-staging", version: "version-api", pourcentage: 100 },
    ],
    workflows: [],
    "generation-compatibilite": 1,
    inventaire: Object.fromEntries(
      SURFACES_TOPOLOGIE.map((surface) => [
        surface,
        canonicalSha256({ surface }),
      ]),
    ),
    "migration-stateful": { mode: "aucune" },
    "moyens-connexion": ["google", "github", "passkey"],
    "versions-cloudflare": [
      { ressource: "punks-api-staging", id: "version-api" },
    ],
    "versions-etat-durable-objects": [
      { namespace: "api-conversation", version: 1 },
    ],
    "etat-r2": {
      formats: [{ nom: "promotion-evidence", version: 1 }],
      "generation-chaines": 1,
      "generation-tombstones": 1,
      "generation-effacement": 1,
      "registre-sha256": canonicalSha256({ registry: "r2" }),
    },
    "generations-securite": {
      secrets: [{ nom: "operator", generation: 1 }],
      "cles-attestation": [{ id: "approver", generation: 1 }],
      "generation-recuperation-sessions": 1,
      "generations-revoquees-sha256": canonicalSha256([]),
    },
  };
}

function budgetObservation() {
  const sampleCount = 1_000_000;
  const connectionMethods = ["google", "github", "passkey"];
  const statistic = (budget, suffix) => ({
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
    "export-sha256": canonicalSha256({ budget: budget.nom, suffix }),
  });
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
      ...statistic(budget, "aggregate"),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        ...statistic(budget, dimension),
      })),
    };
  });
  const content = {
    schema: "punks.operational-budget-observation.v1",
    sourceSha,
    stagingDeploymentId,
    connectionMethods,
    verdicts,
    bookmarks: [
      { autorite: "cloudflare-staging", valeur: stagingDeploymentId },
    ],
    dlq: { messages: 0, "export-sha256": canonicalSha256({ dlq: 0 }) },
    outboxes: {
      "en-attente": 0,
      "export-sha256": canonicalSha256({ outboxes: 0 }),
    },
    incidents: [],
    observedAt: "2026-08-26T20:19:59.000Z",
  };
  return { ...content, sha256: canonicalSha256(content) };
}

function cadenceObservation(input, publicationResult) {
  const evidence = operationalEvidenceDigests(input, publicationResult);
  const observedTopology = topology();
  const topologySha256 = canonicalSha256(observedTopology);
  const budgets = budgetObservation();
  const budgetsSha256 = canonicalSha256(budgets);
  const steps = {};
  for (const [index, step] of Object.keys(evidence).entries()) {
    const startedAt = `2026-08-26T20:${String(index * 2).padStart(2, "0")}:00.000Z`;
    const closedAt = `2026-08-26T20:${String(index * 2 + 1).padStart(2, "0")}:00.000Z`;
    steps[step] = {
      startedAt,
      closedAt,
      result: "vert",
      sampleCount: index + 1,
      actionsSteps: [
        {
          runId: 328000058,
          runAttempt: 1,
          jobId: 9000 + index,
          jobName: `job-${step}`,
          jobUrl: `https://github.com/punksbot/punksbot/actions/runs/328000058/job/${9000 + index}`,
          stepNumber: index + 1,
          stepName: `step-${step}`,
          conclusion: "success",
          startedAt,
          completedAt: closedAt,
        },
      ],
      evidenceSha256: evidence[step],
      topologySha256,
      budgetsSha256,
    };
  }
  return {
    schema: "punks.github-cadence-observation.v1",
    repository: "punksbot/punksbot",
    sourceSha,
    stagingDeploymentId,
    run: {
      id: 328000058,
      attempt: 1,
      event: "workflow_dispatch",
      workflow: ".github/workflows/punks-desktop-candidate.yml",
      headSha: sourceSha,
      url: "https://github.com/punksbot/punksbot/actions/runs/328000058",
    },
    proofDigests: evidence,
    topology: observedTopology,
    topologySha256,
    budgets,
    budgetsSha256,
    steps,
    observedAt: "2026-08-26T20:20:00.000Z",
  };
}

test("materializes signed expansion and active executions before Latest", async () => {
  const input = dossier();
  const publicationResult = {
    objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
  };
  const head = await buildOperationalReleaseHead({
    dossier: input,
    publicationResult,
    cadenceObservation: cadenceObservation(input, publicationResult),
    approbation,
  });
  assert.deepEqual(
    head.transitions.map(({ programme }) => programme),
    ["expansion", "active"],
  );
  assert.deepEqual(
    head.transitions.flatMap(({ steps }) => steps.map(({ step }) => step)),
    ["E0", "E1", "E2", "E3", "E4", "A0", "A1", "A2", "A3", "A4"],
  );
  assert.equal(
    head.transitions
      .flatMap(({ steps }) => steps)
      .every(
        ({ receipt, eventReceipt }) =>
          receipt.signatures.length === 2 &&
          eventReceipt.signatures.length === 2,
      ),
    true,
  );
  assert.equal(
    validateOperationalReleaseHead(head, {
      sourceSha,
      stagingDeploymentId,
      dossierSha256: head.dossierSha256,
    }),
    head,
  );
});

test("refuses activation when one ordered operational step is absent", async () => {
  const input = dossier();
  const publicationResult = {
    objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
  };
  const head = await buildOperationalReleaseHead({
    dossier: input,
    publicationResult,
    cadenceObservation: cadenceObservation(input, publicationResult),
    approbation,
  });
  head.transitions[1].steps.pop();
  const { sha256: _prior, ...content } = head;
  head.sha256 = canonicalSha256(content);
  assert.throws(
    () =>
      validateOperationalReleaseHead(head, {
        sourceSha,
        stagingDeploymentId,
        dossierSha256: head.dossierSha256,
      }),
    /five ordered steps/i,
  );
});

test("refuses a cadence observation altered after the exact Actions read", async () => {
  const input = dossier();
  const publicationResult = {
    objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
  };
  const build = (cadenceObservation) =>
    buildOperationalReleaseHead({
      dossier: input,
      publicationResult,
      cadenceObservation,
      approbation,
    });

  const mismatchedTimestamp = cadenceObservation(input, publicationResult);
  mismatchedTimestamp.steps.E1.actionsSteps[0].startedAt =
    "2026-08-26T20:59:00.000Z";
  await assert.rejects(build(mismatchedTimestamp), /cadence observation E1/i);

  const wrongRun = cadenceObservation(input, publicationResult);
  wrongRun.run.headSha = "12".repeat(20);
  await assert.rejects(build(wrongRun), /GitHub cadence observation/i);

  const divergentProof = cadenceObservation(input, publicationResult);
  divergentProof.proofDigests.A2 = "34".repeat(32);
  await assert.rejects(build(divergentProof), /GitHub cadence observation/i);

  const openShape = cadenceObservation(input, publicationResult);
  openShape.generatedLocally = true;
  await assert.rejects(build(openShape), /GitHub cadence observation/i);
});

test("publishes the operational head create-only to the draft and both Punks buckets", async () => {
  const input = dossier();
  const publicationResult = {
    objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
  };
  const head = await buildOperationalReleaseHead({
    dossier: input,
    publicationResult,
    cadenceObservation: cadenceObservation(input, publicationResult),
    approbation,
  });
  const writes = [];
  const r2 = [
    {
      role: "primaire",
      compte: "3a391620584c792dbbd8cfa148d7634a",
      bucket: "punks-promotion-primary",
    },
    {
      role: "secondaire",
      compte: "3a391620584c792dbbd8cfa148d7634a",
      bucket: "punks-promotion-recovery",
    },
  ];
  const result = await publishOperationalReleaseHead({
    depot: "punksbot/punksbot",
    tag: `punks-staging-${sourceSha}`,
    sourceSha,
    document: head,
    r2,
    frontieres: {
      github: {
        async lireDraft() {
          return {
            id: 58,
            tag: `punks-staging-${sourceSha}`,
            sha: sourceSha,
            draft: true,
          };
        },
        async lireAsset() {
          return null;
        },
        async creerAsset(input) {
          writes.push(["github", input.nom]);
        },
      },
      cloudflare: {
        async lireVerrouillage() {
          return { mode: "compliance", actif: true };
        },
        async lireObjet() {
          return null;
        },
        async creerObjet(input) {
          writes.push([input.role, input.cle]);
        },
      },
    },
  });
  assert.match(result.asset, /^operational-release-head-[0-9a-f]{64}\.json$/);
  assert.deepEqual(
    writes.map(([role]) => role),
    ["github", "primaire", "secondaire"],
  );
});
