import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { verifierSignatureRecu } from "../release-graph-lib.mjs";
import { validateGithubCadenceObservation } from "./github-cadence-observation.mjs";
import { operationalEvidenceDigests } from "./operational-release-evidence.mjs";

export { operationalEvidenceDigests } from "./operational-release-evidence.mjs";

const PHASES = Object.freeze({
  expansion: Object.freeze(["E0", "E1", "E2", "E3", "E4"]),
  active: Object.freeze(["A0", "A1", "A2", "A3", "A4"]),
});
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`operational release head rejected: ${message}`);
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

async function signedReceipt({ id, content, approbation }) {
  const approvers = approbation?.approbateurs?.map(({ id: value }) => value);
  if (!Array.isArray(approvers) || approvers.length !== 2) {
    fail("two anchored approvers are required");
  }
  const bound = {
    schema: "punks.release-receipt.v1",
    id,
    ...content,
    approbateurs: approvers,
  };
  const sha256 = canonicalSha256(bound);
  const signatures = await approbation.signerRecu({
    contenu: structuredClone(bound),
    sha256,
    approbateurs: approvers,
  });
  return {
    id,
    contenu: bound,
    sha256,
    signatures,
    publication: ["release", "r2"],
  };
}

async function buildExecution({
  phase,
  sourceSha,
  stagingDeploymentId,
  dossierSha256,
  evidence,
  approbation,
  observations,
  topology,
  budgets,
  artifactHashes,
  githubRun,
  predecessor,
}) {
  const releaseId = `tranche:1/${phase}/${sourceSha}`;
  const executionId = `execution-tranche-1-${phase}-${sourceSha}`;
  const start = await signedReceipt({
    id: `recu-demarrage-${executionId}`,
    approbation,
    content: {
      type: "execution-demarrage",
      "execution-id": executionId,
      sequence: 0,
      cible: "tranche:1",
      programme: phase,
      "release-id": releaseId,
      "sha-punks": sourceSha,
      deploiement: stagingDeploymentId,
      "dossier-preuve-sha256": dossierSha256,
      precedent: predecessor,
      instant: observations[PHASES[phase][0]].startedAt,
    },
  });
  let previousEvent = start.sha256;
  let previousStep = null;
  const steps = [];
  for (const [index, step] of PHASES[phase].entries()) {
    const observation = observations[step];
    const startedAt = observation.startedAt;
    const closedAt = observation.closedAt;
    const workerPercentage =
      phase === "expansion" ? [0, 1, 10, 50, 100][index] : 100;
    const workers = topology.workers.map((worker) => ({
      ...worker,
      pourcentage: workerPercentage,
    }));
    const hashesDesktop = phase === "active" ? artifactHashes : [];
    const receipt = await signedReceipt({
      id: `recu-etape-${executionId}-${step}`,
      approbation,
      content: {
        type: "etape",
        "execution-id": executionId,
        sequence: index + 1,
        phase,
        etape: step,
        "duree-minimale-heures": 0,
        "release-id": releaseId,
        "sha-punks": sourceSha,
        deploiement: stagingDeploymentId,
        "precedent-etape-sha256": previousStep,
        "preuve-sha256": evidence[step],
        observation,
        "github-run": githubRun,
        workers,
        workflows: topology.workflows,
        "generation-compatibilite": topology["generation-compatibilite"],
        "hashes-desktop": hashesDesktop,
        "topologie-sha256": canonicalSha256(topology),
        "verdicts-metriques": budgets.verdicts,
        "verdicts-metriques-sha256": canonicalSha256(budgets.verdicts),
        "budgets-observation-sha256": canonicalSha256(budgets),
        bookmarks: budgets.bookmarks,
        dlq: budgets.dlq,
        outboxes: budgets.outboxes,
        incidents: budgets.incidents,
        "actions-steps": observation.actionsSteps,
        echantillons: observation.sampleCount,
        heures: { debut: startedAt, fin: closedAt },
        resultat: "vert",
      },
    });
    const eventReceipt = await signedReceipt({
      id: `recu-evenement-${executionId}-${step}`,
      approbation,
      content: {
        type: "execution-evenement",
        "execution-id": executionId,
        sequence: index + 1,
        nature: "etape-fermee",
        cible: "tranche:1",
        programme: phase,
        "release-id": releaseId,
        "sha-punks": sourceSha,
        deploiement: stagingDeploymentId,
        "precedent-evenement-sha256": previousEvent,
        "recu-etape-id": receipt.id,
        "recu-etape-sha256": receipt.sha256,
        instant: closedAt,
      },
    });
    steps.push({
      step,
      startedAt,
      closedAt,
      evidenceSha256: evidence[step],
      receipt,
      eventReceipt,
    });
    previousStep = receipt.sha256;
    previousEvent = eventReceipt.sha256;
  }
  const phaseReceipt = await signedReceipt({
    id: `recu-fermeture-${executionId}`,
    approbation,
    content: {
      type: "execution-evenement",
      "execution-id": executionId,
      sequence: steps.length + 1,
      nature: "phase-fermee",
      cible: "tranche:1",
      programme: phase,
      "release-id": releaseId,
      "sha-punks": sourceSha,
      deploiement: stagingDeploymentId,
      "precedent-evenement-sha256": previousEvent,
      instant: observations[PHASES[phase].at(-1)].closedAt,
    },
  });
  const transitionReceipt = await signedReceipt({
    id: `recu-transition-tranche-1-${phase}-${sourceSha}`,
    approbation,
    content: {
      type: "transition",
      cible: "tranche:1",
      transition: phase,
      "execution-id": executionId,
      "release-id": releaseId,
      "sha-punks": sourceSha,
      deploiement: stagingDeploymentId,
      "dossier-preuve-sha256": dossierSha256,
      "recu-execution-precedent-sha256": phaseReceipt.sha256,
      precedent: predecessor,
      "github-run": githubRun,
      workers: topology.workers,
      workflows: topology.workflows,
      "generation-compatibilite": topology["generation-compatibilite"],
      "hashes-desktop": phase === "active" ? artifactHashes : [],
      "topologie-sha256": canonicalSha256(topology),
      "verdicts-metriques-sha256": canonicalSha256(budgets.verdicts),
      "budgets-observation-sha256": canonicalSha256(budgets),
      bookmarks: budgets.bookmarks,
      dlq: budgets.dlq,
      outboxes: budgets.outboxes,
      incidents: budgets.incidents,
      instant: observations[PHASES[phase].at(-1)].closedAt,
    },
  });
  return {
    schema: "punks.release-execution.v1",
    id: executionId,
    programme: phase,
    releaseId,
    predecessor,
    startReceipt: start,
    steps,
    phaseReceipt,
    transitionReceipt,
  };
}

export async function buildOperationalReleaseHead({
  dossier,
  publicationResult,
  cadenceObservation,
  budgetExportRoot,
  candidateRoot,
  approbation,
}) {
  const sourceSha = dossier?.candidat?.sha;
  const stagingDeploymentId = dossier?.liaison?.staging?.deploiement;
  if (
    !SHA1_RE.test(sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "")
  ) {
    fail("exact candidate/staging identity is required");
  }
  const dossierSha256 = canonicalSha256(dossier);
  const evidence = operationalEvidenceDigests(dossier, publicationResult);
  try {
    validateGithubCadenceObservation(cadenceObservation, {
      sourceSha,
      stagingDeploymentId,
      proofDigests: evidence,
      budgetExportRoot,
      candidateRoot,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const expansion = await buildExecution({
    phase: "expansion",
    sourceSha,
    stagingDeploymentId,
    dossierSha256,
    evidence,
    approbation,
    observations: cadenceObservation.steps,
    topology: cadenceObservation.topology,
    budgets: cadenceObservation.budgets,
    artifactHashes: dossier.liaison.artefacts.map(({ plateforme, sha256 }) => ({
      plateforme,
      sha256,
    })),
    githubRun: cadenceObservation.run,
    predecessor: null,
  });
  const predecessor = {
    executionId: expansion.id,
    releaseId: expansion.releaseId,
    receiptSha256: expansion.transitionReceipt.sha256,
  };
  const active = await buildExecution({
    phase: "active",
    sourceSha,
    stagingDeploymentId,
    dossierSha256,
    evidence,
    approbation,
    observations: cadenceObservation.steps,
    topology: cadenceObservation.topology,
    budgets: cadenceObservation.budgets,
    artifactHashes: dossier.liaison.artefacts.map(({ plateforme, sha256 }) => ({
      plateforme,
      sha256,
    })),
    githubRun: cadenceObservation.run,
    predecessor,
  });
  const content = {
    schema: "punks.operational-release-head.v1",
    release: "tranche:1",
    state: "active",
    sourceSha,
    stagingDeploymentId,
    dossierSha256,
    promotionReceiptSha256: evidence.A4,
    topologySha256: cadenceObservation.topologySha256,
    budgetsSha256: cadenceObservation.budgetsSha256,
    githubRun: cadenceObservation.run,
    transitions: [expansion, active],
    createdAt: cadenceObservation.observedAt,
  };
  const document = { ...content, sha256: canonicalSha256(content) };
  validateOperationalReleaseHead(document, {
    sourceSha,
    stagingDeploymentId,
    dossierSha256,
  });
  return document;
}

function validateReceipt(receipt, expectedType) {
  exact(
    receipt,
    ["id", "contenu", "sha256", "signatures", "publication"],
    "Receipt",
  );
  if (
    receipt.contenu?.type !== expectedType ||
    receipt.contenu?.id !== receipt.id ||
    receipt.sha256 !== canonicalSha256(receipt.contenu) ||
    JSON.stringify(receipt.publication) !== JSON.stringify(["release", "r2"]) ||
    !Array.isArray(receipt.signatures) ||
    receipt.signatures.length !== 2 ||
    new Set(receipt.signatures.map(({ approbateur }) => approbateur)).size !==
      2 ||
    receipt.signatures.some(
      (signature) =>
        !verifierSignatureRecu(
          receipt.contenu,
          signature,
          signature?.["cle-publique-spki"],
        ),
    )
  ) {
    fail(`invalid signed ${expectedType} Receipt`);
  }
}

export function validateOperationalReleaseHead(document, expected) {
  exact(
    document,
    [
      "schema",
      "release",
      "state",
      "sourceSha",
      "stagingDeploymentId",
      "dossierSha256",
      "promotionReceiptSha256",
      "topologySha256",
      "budgetsSha256",
      "githubRun",
      "transitions",
      "createdAt",
      "sha256",
    ],
    "operational head",
  );
  const { sha256, ...content } = document;
  if (
    document.schema !== "punks.operational-release-head.v1" ||
    document.release !== "tranche:1" ||
    document.state !== "active" ||
    document.sourceSha !== expected.sourceSha ||
    document.stagingDeploymentId !== expected.stagingDeploymentId ||
    document.dossierSha256 !== expected.dossierSha256 ||
    !/^[0-9a-f]{64}$/u.test(document.topologySha256 ?? "") ||
    !/^[0-9a-f]{64}$/u.test(document.budgetsSha256 ?? "") ||
    document.githubRun?.headSha !== expected.sourceSha ||
    document.githubRun?.event !== "workflow_dispatch" ||
    document.sha256 !== canonicalSha256(content) ||
    !Array.isArray(document.transitions) ||
    document.transitions.length !== 2 ||
    document.transitions[0]?.programme !== "expansion" ||
    document.transitions[1]?.programme !== "active"
  ) {
    fail("operational head identity or transition order is invalid");
  }
  let previous = null;
  let operationalStateSha256 = null;
  for (const execution of document.transitions) {
    const expectedSteps = PHASES[execution.programme];
    if (!Array.isArray(execution.steps) || execution.steps.length !== 5) {
      fail("operational execution does not close five ordered steps");
    }
    validateReceipt(execution.startReceipt, "execution-demarrage");
    let eventChain = execution.startReceipt.sha256;
    let stepChain = null;
    for (const [index, step] of execution.steps.entries()) {
      const receiptContent = step.receipt.contenu;
      const expectedPercentage =
        execution.programme === "expansion" ? [0, 1, 10, 50, 100][index] : 100;
      const stateSha256 = canonicalSha256({
        githubRun: receiptContent["github-run"],
        workflows: receiptContent.workflows,
        generation: receiptContent["generation-compatibilite"],
        verdicts: receiptContent["verdicts-metriques"],
        bookmarks: receiptContent.bookmarks,
        dlq: receiptContent.dlq,
        outboxes: receiptContent.outboxes,
        incidents: receiptContent.incidents,
      });
      if (operationalStateSha256 === null) {
        operationalStateSha256 = stateSha256;
      }
      if (
        step.step !== expectedSteps[index] ||
        receiptContent["precedent-etape-sha256"] !== stepChain ||
        receiptContent["duree-minimale-heures"] !== 0 ||
        receiptContent.resultat !== "vert" ||
        Date.parse(step.closedAt) <= Date.parse(step.startedAt) ||
        step.evidenceSha256 !== receiptContent["preuve-sha256"] ||
        receiptContent["topologie-sha256"] !== document.topologySha256 ||
        receiptContent["budgets-observation-sha256"] !==
          document.budgetsSha256 ||
        receiptContent["verdicts-metriques-sha256"] !==
          canonicalSha256(receiptContent["verdicts-metriques"]) ||
        canonicalSha256(receiptContent["github-run"]) !==
          canonicalSha256(document.githubRun) ||
        canonicalSha256(receiptContent["actions-steps"]) !==
          canonicalSha256(receiptContent.observation?.actionsSteps) ||
        receiptContent.echantillons !==
          receiptContent.observation?.sampleCount ||
        receiptContent.observation?.topologySha256 !==
          document.topologySha256 ||
        receiptContent.observation?.budgetsSha256 !== document.budgetsSha256 ||
        !Array.isArray(receiptContent.workers) ||
        receiptContent.workers.length < 1 ||
        receiptContent.workers.some(
          (worker) => worker?.pourcentage !== expectedPercentage,
        ) ||
        !Array.isArray(receiptContent.workflows) ||
        !Number.isSafeInteger(receiptContent["generation-compatibilite"]) ||
        receiptContent["generation-compatibilite"] < 1 ||
        !Array.isArray(receiptContent["hashes-desktop"]) ||
        (execution.programme === "expansion"
          ? receiptContent["hashes-desktop"].length !== 0
          : receiptContent["hashes-desktop"].length < 1) ||
        !Array.isArray(receiptContent["verdicts-metriques"]) ||
        receiptContent["verdicts-metriques"].length !== 36 ||
        !Array.isArray(receiptContent.bookmarks) ||
        receiptContent.bookmarks.length < 1 ||
        receiptContent.dlq?.messages !== 0 ||
        receiptContent.outboxes?.["en-attente"] !== 0 ||
        !Array.isArray(receiptContent.incidents) ||
        receiptContent.incidents.length !== 0 ||
        stateSha256 !== operationalStateSha256
      ) {
        fail(`operational ${execution.programme} step ${index} is invalid`);
      }
      validateReceipt(step.receipt, "etape");
      validateReceipt(step.eventReceipt, "execution-evenement");
      if (
        step.eventReceipt.contenu.nature !== "etape-fermee" ||
        step.eventReceipt.contenu["precedent-evenement-sha256"] !==
          eventChain ||
        step.eventReceipt.contenu["recu-etape-sha256"] !== step.receipt.sha256
      ) {
        fail(`operational ${execution.programme} event ${index} is invalid`);
      }
      stepChain = step.receipt.sha256;
      eventChain = step.eventReceipt.sha256;
    }
    validateReceipt(execution.phaseReceipt, "execution-evenement");
    validateReceipt(execution.transitionReceipt, "transition");
    const transition = execution.transitionReceipt.contenu;
    if (
      execution.phaseReceipt.contenu["precedent-evenement-sha256"] !==
        eventChain ||
      execution.transitionReceipt.contenu["recu-execution-precedent-sha256"] !==
        execution.phaseReceipt.sha256 ||
      transition["topologie-sha256"] !== document.topologySha256 ||
      transition["budgets-observation-sha256"] !== document.budgetsSha256 ||
      transition["verdicts-metriques-sha256"] !==
        execution.steps.at(-1).receipt.contenu["verdicts-metriques-sha256"] ||
      canonicalSha256(transition["github-run"]) !==
        canonicalSha256(document.githubRun) ||
      transition.dlq?.messages !== 0 ||
      transition.outboxes?.["en-attente"] !== 0 ||
      !Array.isArray(transition.incidents) ||
      transition.incidents.length !== 0 ||
      JSON.stringify(execution.predecessor) !== JSON.stringify(previous)
    ) {
      fail("operational execution receipt chain is broken");
    }
    previous = {
      executionId: execution.id,
      releaseId: execution.releaseId,
      receiptSha256: execution.transitionReceipt.sha256,
    };
  }
  return document;
}

function parseArgs(argv) {
  const expected = new Set([
    "--dossier",
    "--publication-result",
    "--cadence-observation",
    "--budget-exports",
    "--candidate-root",
    "--depot",
    "--tag",
    "--r2-primaire",
    "--r2-secondaire",
    "--frontieres",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag))
      fail("invalid CLI arguments");
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (name) => values.get(name);
}

function destination(role, value) {
  const [compte, bucket, ...rest] = value.split("/");
  if (rest.length > 0 || !compte || !bucket)
    fail(`invalid ${role} R2 destination`);
  return { role, compte, bucket };
}

export async function publishOperationalReleaseHead({
  frontieres,
  depot,
  tag,
  sourceSha,
  document,
  r2,
}) {
  const content = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  const name = `operational-release-head-${document.sha256}.json`;
  const release = await frontieres.github.lireDraft({ depot, tag });
  if (release.sha !== sourceSha || release.draft !== true)
    fail("exact draft is unavailable");
  const existing = await frontieres.github.lireAsset({
    depot,
    releaseId: release.id,
    nom: name,
  });
  if (existing === null) {
    await frontieres.github.creerAsset({
      depot,
      releaseId: release.id,
      nom: name,
      contenu: content,
    });
  } else if (!Buffer.from(existing).equals(content)) {
    fail("existing operational head asset diverges");
  }
  for (const target of r2) {
    const lock = await frontieres.cloudflare.lireVerrouillage(target);
    if (lock?.mode !== "compliance" || lock?.actif !== true)
      fail("R2 compliance lock is absent");
    const key = `releases/punks-desktop/tranche:1/operational-heads/${document.sha256}.json`;
    const prior = await frontieres.cloudflare.lireObjet({
      ...target,
      cle: key,
    });
    if (prior === null) {
      await frontieres.cloudflare.creerObjet({
        ...target,
        cle: key,
        contenu: content,
        modeRequis: "compliance",
      });
    } else if (!Buffer.from(prior).equals(content)) {
      fail(`existing ${target.role} operational head diverges`);
    }
  }
  return { asset: name, sha256: document.sha256 };
}

export async function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  const dossier = JSON.parse(
    readFileSync(resolve(required("--dossier")), "utf8"),
  );
  const publicationResult = JSON.parse(
    readFileSync(resolve(required("--publication-result")), "utf8"),
  );
  const cadenceObservation = JSON.parse(
    readFileSync(resolve(required("--cadence-observation")), "utf8"),
  );
  const depot = required("--depot");
  const tag = required("--tag");
  const r2 = [
    destination("primaire", required("--r2-primaire")),
    destination("secondaire", required("--r2-secondaire")),
  ];
  const module = await import(
    pathToFileURL(resolve(required("--frontieres"))).href
  );
  const create = module.creerFrontieresPublication ?? module.default;
  const frontieres = await create({
    depot,
    tag,
    canal: "punks-desktop",
    r2,
    bootstrapR2: true,
  });
  const document = await buildOperationalReleaseHead({
    dossier,
    publicationResult,
    cadenceObservation,
    budgetExportRoot: resolve(required("--budget-exports")),
    candidateRoot: resolve(required("--candidate-root")),
    approbation: frontieres.approbation,
  });
  await publishOperationalReleaseHead({
    frontieres,
    depot,
    tag,
    sourceSha: dossier.candidat.sha,
    document,
    r2,
  });
  writeFileSync(
    resolve(required("--output")),
    `${JSON.stringify(document, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return document;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
