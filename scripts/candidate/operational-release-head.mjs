import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { verifierSignatureRecu } from "../release-graph-lib.mjs";

const PHASES = Object.freeze({
  expansion: Object.freeze(["E0", "E1", "E2", "E3", "E4"]),
  active: Object.freeze(["A0", "A1", "A2", "A3", "A4"]),
});
const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
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

function instant(base, offset) {
  return new Date(base + offset).toISOString();
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

function evidenceDigests(dossier, publicationResult) {
  const receipt = publicationResult?.objets?.find(
    ({ sorte }) => sorte === "recu",
  );
  if (!SHA256_RE.test(receipt?.sha256 ?? "")) {
    fail("published promotion Receipt digest is missing");
  }
  const values = {
    E0: canonicalSha256(dossier.gates),
    E1: canonicalSha256(dossier.liaison?.staging),
    E2: canonicalSha256(dossier.parcours),
    E3: canonicalSha256(dossier.accessibilite),
    E4: canonicalSha256({
      recuperation: dossier.recuperation,
      retrait: dossier.retrait,
    }),
    A0: canonicalSha256(dossier.liaison?.artefacts),
    A1: canonicalSha256(dossier.parcours),
    A2: canonicalSha256(dossier.fautes),
    A3: canonicalSha256({ scans: dossier.scans, goldens: dossier.goldens }),
    A4: receipt.sha256,
  };
  if (Object.values(values).some((value) => !SHA256_RE.test(value))) {
    fail("one operational evidence digest is invalid");
  }
  return values;
}

async function buildExecution({
  phase,
  sourceSha,
  stagingDeploymentId,
  dossierSha256,
  evidence,
  approbation,
  baseTime,
  offset,
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
      instant: instant(baseTime, offset),
    },
  });
  let previousEvent = start.sha256;
  let previousStep = null;
  const steps = [];
  for (const [index, step] of PHASES[phase].entries()) {
    const startedAt = instant(baseTime, offset + index * 2 + 1);
    const closedAt = instant(baseTime, offset + index * 2 + 2);
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
      instant: instant(baseTime, offset + 12),
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
      instant: instant(baseTime, offset + 13),
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
  approbation,
  now = Date.now(),
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
  const evidence = evidenceDigests(dossier, publicationResult);
  const expansion = await buildExecution({
    phase: "expansion",
    sourceSha,
    stagingDeploymentId,
    dossierSha256,
    evidence,
    approbation,
    baseTime: now,
    offset: 0,
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
    baseTime: now,
    offset: 20,
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
    transitions: [expansion, active],
    createdAt: instant(now, 34),
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
    document.sha256 !== canonicalSha256(content) ||
    !Array.isArray(document.transitions) ||
    document.transitions.length !== 2 ||
    document.transitions[0]?.programme !== "expansion" ||
    document.transitions[1]?.programme !== "active"
  ) {
    fail("operational head identity or transition order is invalid");
  }
  let previous = null;
  for (const execution of document.transitions) {
    const expectedSteps = PHASES[execution.programme];
    if (!Array.isArray(execution.steps) || execution.steps.length !== 5) {
      fail("operational execution does not close five ordered steps");
    }
    validateReceipt(execution.startReceipt, "execution-demarrage");
    let eventChain = execution.startReceipt.sha256;
    let stepChain = null;
    for (const [index, step] of execution.steps.entries()) {
      if (
        step.step !== expectedSteps[index] ||
        step.receipt.contenu["precedent-etape-sha256"] !== stepChain ||
        step.receipt.contenu["duree-minimale-heures"] !== 0 ||
        step.receipt.contenu.resultat !== "vert" ||
        Date.parse(step.closedAt) <= Date.parse(step.startedAt) ||
        step.evidenceSha256 !== step.receipt.contenu["preuve-sha256"]
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
    if (
      execution.phaseReceipt.contenu["precedent-evenement-sha256"] !==
        eventChain ||
      execution.transitionReceipt.contenu["recu-execution-precedent-sha256"] !==
        execution.phaseReceipt.sha256 ||
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
