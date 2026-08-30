/** Fixtures content-addressed du validateur final de promotion. */
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as signerEd25519,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  canonicalJson as canonicalStagingJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  BASELINE_PUNKS,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import { PLATEFORMES, PREUVES_OBLIGATOIRES } from "./release-graph-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  SCANS_LEGACY,
  TYPES_FAUTE,
  VERIFICATIONS_ARTEFACT,
  construireAttestation,
} from "./promotion-dossier-lib.mjs";
import {
  contenuScanArtefactInstalleFixture,
  contenuTranscriptInstalleFixture,
} from "./promotion-test-fixtures.mjs";

export const SHA_CANDIDAT = "21".repeat(20);
const WORKERS = [...CANONICAL_STAGING_WORKER_NAMES];
const CHEMIN_PROFIL_PROMOTION = join(
  process.cwd(),
  "cloudflare/promotion-profiles.json",
);
const CONTENU_PROFIL_PROMOTION = readFileSync(CHEMIN_PROFIL_PROMOTION);
const PROFIL_PROMOTION = JSON.parse(CONTENU_PROFIL_PROMOTION).profiles.find(
  ({ tranche }) => tranche === 1,
);
export const AUTORITES = PROFIL_PROMOTION.authorities.map(({ id }) => id);
const RECITS = [...PROFIL_PROMOTION.stories];
const MATERIAU_PREUVE_STAGING = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SHA_CANDIDAT,
  observer: "cloudflare-remote",
  workers: WORKERS.map((name, index) => ({
    name,
    versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sourceShaAnnotation: sourceShaAnnotation(SHA_CANDIDAT),
    deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  })),
};
const WORKERS_DEPLOYES = MATERIAU_PREUVE_STAGING.workers.map(
  ({ name, versionId, deploymentId }) => ({ name, versionId, deploymentId }),
);
export const WORKERS_RUNTIME = WORKERS_DEPLOYES.map(({ name, versionId }) => ({
  name,
  versionId,
}));
const DEPLOIEMENT_STAGING = `sha256:${createHash("sha256")
  .update(canonicalStagingJson(MATERIAU_PREUVE_STAGING), "utf8")
  .digest("hex")}`;
const CONTENU_MATERIAU_STAGING = readFileSync(
  join(process.cwd(), "cloudflare/staging.resources.json"),
);
const HASH_REGISTRE = {
  "registre-contrats": "0a".repeat(32),
  profil: "0b".repeat(32),
  "registre-goldens": "0c".repeat(32),
  "manifeste-retrait": "0d".repeat(32),
  staging: createHash("sha256").update(CONTENU_MATERIAU_STAGING).digest("hex"),
};
export const STAGING = {
  compte: CANONICAL_STAGING_ACCOUNT_ID,
  zone: "b91146ce242a275de0b7e6e0cc3804c7",
  deploiement: DEPLOIEMENT_STAGING,
};
const METHODES_ACCESSIBILITE = ["automatique", "manuelle"];

function technologieLecteurEcran(plateforme) {
  if (plateforme.startsWith("macos-")) return "VoiceOver";
  if (plateforme === "windows-x64") return "NVDA";
  return "Orca";
}
export const LIGNES_REGISTRE = [
  {
    test: "crates/punks-agent/tests/golden.rs",
    tranche: "tranche:1",
    verdict: "preuve-punks",
  },
  {
    test: "crates/punks-db/tests/isolement.rs",
    tranche: "tranche:1",
    verdict: "difference-intentionnelle",
  },
];
export const RACINE_PREUVES = mkdtempSync(join(tmpdir(), "punks-preuves-"));

const CLES_APPROBATION = new Map(
  ["ops:alice", "ops:bob"].map((id) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return [
      id,
      {
        privateKey,
        publique: publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
      },
    ];
  }),
);
export const APPROBATION = {
  approbateurs: [...CLES_APPROBATION].map(([id, cle]) => ({
    id,
    "cle-publique-spki": cle.publique,
  })),
  async signerRecu({ contenu, approbateurs }) {
    return signaturesRecu(contenu, approbateurs);
  },
};
export const CONFIANCE_APPROBATION = {
  registreApprobateursRelease: APPROBATION.approbateurs.map((entree) => ({
    ...entree,
  })),
  ancrageApprobateursRelease: canonicalSha256(APPROBATION.approbateurs),
};

function signaturesRecu(contenu, approbateurs = ["ops:alice", "ops:bob"]) {
  return approbateurs.map((approbateur) => {
    const cle = CLES_APPROBATION.get(approbateur);
    assert.ok(cle, `clé de test absente pour ${approbateur}`);
    return {
      approbateur,
      algorithme: "ed25519",
      "cle-publique-spki": cle.publique,
      valeur: signerEd25519(
        null,
        Buffer.from(canonicalJson(contenu), "utf8"),
        cle.privateKey,
      ).toString("hex"),
    };
  });
}

function sha256Octets(contenu) {
  return createHash("sha256").update(contenu).digest("hex");
}

function contenuArtefact(plateforme) {
  return `bundle:${plateforme}\n`;
}

function contenuSignature(plateforme) {
  return `signature:${plateforme}\n`;
}

export function contenuTranscript(
  plateforme,
  candidateSha = SHA_CANDIDAT,
  stagingDeploymentId = STAGING.deploiement,
) {
  return contenuTranscriptInstalleFixture({
    candidateSha,
    stagingDeploymentId,
    plateforme,
    workers: WORKERS_DEPLOYES,
    artifactSha256: sha256Octets(contenuArtefact(plateforme)),
  });
}

function bundleSigstore() {
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payload: Buffer.from("{}").toString("base64"),
      signatures: [{ keyid: "", sig: "ZmFrZQ==" }],
    },
    verificationMaterial: {
      certificate: { rawBytes: "ZmFrZQ==" },
      tlogEntries: [],
    },
  };
}

function contenuBundleProduction() {
  return `${JSON.stringify(bundleSigstore())}\n`;
}

function contenuManifesteProduction(dossier, stagingProofSha256) {
  return `${JSON.stringify({
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha: dossier.candidat.sha,
    stagingDeploymentId: dossier.liaison.staging.deploiement,
    version: "1.0.0",
    repository: "punksbot/punksbot",
    releaseTag: `punks-staging-${dossier.candidat.sha}`,
    stagingProof: {
      path: "staging-deployment-proof.json",
      sha256: stagingProofSha256,
    },
    promotionEvidence: {
      platformIndex: {
        path: "promotion-evidence/platform-index.json",
        sha256: dossier.liaison["digests-preuves-promotion"].platformIndex,
      },
      recoveryIndex: {
        path: "promotion-evidence/recovery-index.json",
        sha256: dossier.liaison["digests-preuves-promotion"].recoveryIndex,
      },
      stagingProof: {
        path: "promotion-evidence/staging-deployment-proof.json",
        sha256: stagingProofSha256,
      },
      network: PLATEFORMES.map((platform) => ({
        platform,
        path: `promotion-evidence/network/${platform}.json`,
        sha256: dossier.liaison["digests-preuves-promotion"].network[platform],
      })),
    },
    platforms: PLATEFORMES.map((platform, index) => ({
      platform,
      target: `target-${platform}`,
      manifestSha256: String(index + 1).repeat(64),
      provenanceSha256: String(index + 5).repeat(64),
    })),
    immutableLatest: {
      path: `release-assets/latest-${dossier.candidat.sha}.json`,
      sha256: "9".repeat(64),
    },
    releaseAssets: [
      ...dossier.liaison.artefacts.flatMap((artefact) => [
        {
          name: artefact.nom,
          sha256: artefact.sha256,
          size: artefact.taille,
        },
        {
          name: artefact.signatureNom,
          sha256: artefact.signature,
          size: artefact.signatureTaille,
        },
      ]),
      { name: "latest.json", sha256: "9".repeat(64), size: 12 },
      {
        name: `latest-${dossier.candidat.sha}.json`,
        sha256: "9".repeat(64),
        size: 12,
      },
    ],
  })}\n`;
}

function preuveStagingPour(candidateSha) {
  const materiau = {
    ...MATERIAU_PREUVE_STAGING,
    sourceSha: candidateSha,
    workers: MATERIAU_PREUVE_STAGING.workers.map((worker) => ({
      ...worker,
      sourceShaAnnotation: sourceShaAnnotation(candidateSha),
    })),
  };
  const deploiementId = `sha256:${createHash("sha256")
    .update(canonicalStagingJson(materiau), "utf8")
    .digest("hex")}`;
  return {
    deploiementId,
    contenu: `${JSON.stringify({ ...materiau, deploymentId: deploiementId })}\n`,
    workers: materiau.workers.map(({ name, versionId, deploymentId }) => ({
      name,
      versionId,
      deploymentId,
    })),
  };
}

function preuvePour(
  identifiant,
  {
    candidateSha = SHA_CANDIDAT,
    stagingDeploymentId = STAGING.deploiement,
    plateforme,
    data = {},
    contenuSujet = `observation:${identifiant}\n`,
  } = {},
) {
  const octetsSujet = Buffer.from(contenuSujet);
  const subjectSha256 = sha256Octets(octetsSujet);
  const sujetChemin = join(
    "sha256",
    `${subjectSha256}-${identifiant.replaceAll(/[^a-z0-9.-]/gi, "-")}-subject.bin`,
  );
  const sujetAbsolu = join(RACINE_PREUVES, sujetChemin);
  mkdirSync(dirname(sujetAbsolu), { recursive: true });
  if (!existsSync(sujetAbsolu)) {
    writeFileSync(sujetAbsolu, octetsSujet, { flag: "wx" });
  }
  const document = {
    schema: "punks.promotion-proof.v1",
    id: identifiant,
    candidateSha,
    stagingDeploymentId,
    result: "vert",
    data: { ...data, subjectSha256 },
    ...(plateforme === undefined ? {} : { plateforme }),
  };
  const contenu = `${JSON.stringify(document)}\n`;
  const sha256 = createHash("sha256").update(contenu).digest("hex");
  const nom = `${sha256}-${identifiant.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`;
  const chemin = join("sha256", nom);
  const absolu = join(RACINE_PREUVES, chemin);
  mkdirSync(dirname(absolu), { recursive: true });
  if (!existsSync(absolu)) {
    writeFileSync(absolu, contenu, { flag: "wx" });
  }
  return {
    chemin,
    sha256,
    subjectSha256,
    sujet: { chemin: sujetChemin, sha256: subjectSha256 },
  };
}

export function preuvesPourDossier(dossier) {
  const preuves = {};
  const stagingObserve = preuveStagingPour(dossier.candidat.sha);
  dossier.liaison.staging.deploiement = stagingObserve.deploiementId;
  dossier.liaison.staging.workers = stagingObserve.workers;
  for (const execution of dossier.parcours.executions) {
    execution.deploiement = stagingObserve.deploiementId;
  }
  const transcriptPour = (plateforme) =>
    contenuTranscript(
      plateforme,
      dossier.candidat.sha,
      dossier.liaison.staging.deploiement,
    );
  for (const artefact of dossier.liaison.artefacts) {
    artefact.transcriptSha256 = sha256Octets(
      transcriptPour(artefact.plateforme),
    );
  }
  const ajouter = (identifiant, options) => {
    const preuve = preuvePour(identifiant, {
      candidateSha: dossier.candidat.sha,
      stagingDeploymentId: dossier.liaison.staging.deploiement,
      ...options,
    });
    preuves[identifiant] = preuve;
    return preuve;
  };

  ajouter("candidat", { data: { tranche: dossier.candidat.tranche } });
  ajouter("profil/promotion", {
    contenuSujet: CONTENU_PROFIL_PROMOTION,
    data: {
      materiau: "cloudflare/promotion-profiles.json",
      profil: PROFIL_PROMOTION.id,
      tranche: 1,
      recits: RECITS,
      autorites: AUTORITES,
    },
  });
  ajouter("registres", {
    data: { registres: dossier.liaison.registres },
  });

  for (const artefact of dossier.liaison.artefacts) {
    const transcriptContenu = transcriptPour(artefact.plateforme);
    ajouter(`transcript/${artefact.plateforme}`, {
      plateforme: artefact.plateforme,
      contenuSujet: transcriptContenu,
      data: {
        schema: "punks.installed-social-loop-transcript.v1",
        plateforme: artefact.plateforme,
      },
    });
    const rawEvidence = JSON.parse(transcriptContenu).rawEvidence;
    ajouter(`brut/${artefact.plateforme}`, {
      plateforme: artefact.plateforme,
      contenuSujet: `${JSON.stringify({
        schema: "punks.installed-raw-evidence-archive.v1",
        indexSha256: rawEvidence.indexSha256,
        files: Array.from({ length: rawEvidence.files }, (_, index) => ({
          path: `observed-${index}.json`,
          size: 2,
          sha256: String(index + 1).repeat(64),
          contentBase64: "e30=",
        })),
      })}\n`,
      data: {
        indexSha256: rawEvidence.indexSha256,
        files: rawEvidence.files,
        transcriptSha256: artefact.transcriptSha256,
      },
    });
    ajouter(`artefact/${artefact.plateforme}/bundle`, {
      plateforme: artefact.plateforme,
      contenuSujet: contenuArtefact(artefact.plateforme),
      data: {
        nom: artefact.nom,
        bundleId: artefact.identite.bundleId,
        taille: artefact.taille,
        transcriptSha256: artefact.transcriptSha256,
      },
    });
    const scanContenu = contenuScanArtefactInstalleFixture({
      plateforme: artefact.plateforme,
      candidateSha: dossier.candidat.sha,
      nomArtefact: artefact.nom,
      tailleArtefact: artefact.taille,
      sha256Artefact: artefact.sha256,
    });
    const scanDocument = JSON.parse(scanContenu);
    const scan = ajouter(`scan/artefact/${artefact.plateforme}`, {
      plateforme: artefact.plateforme,
      contenuSujet: scanContenu,
      data: {
        sha256Artefact: artefact.sha256,
        nativeSha256: "b".repeat(64),
        frontendSha256: scanDocument.frontend.sha256,
        fichiersFrontend: scanDocument.frontend.files.length,
        marqueursInterdits: [
          "punks-media",
          "native_websocket",
          "punks",
          "nostr",
          "relay",
          "huddle",
        ],
        transcriptSha256: artefact.transcriptSha256,
      },
    });
    artefact.scanSha256 = scan.subjectSha256;
    ajouter(`artefact/${artefact.plateforme}/signature`, {
      plateforme: artefact.plateforme,
      contenuSujet: contenuSignature(artefact.plateforme),
      data: {
        nom: artefact.signatureNom,
        taille: artefact.signatureTaille,
        transcriptSha256: artefact.transcriptSha256,
      },
    });
    for (const verification of VERIFICATIONS_ARTEFACT) {
      ajouter(`artefact/${artefact.plateforme}/verification/${verification}`, {
        plateforme: artefact.plateforme,
        contenuSujet: transcriptPour(artefact.plateforme),
        data: { transcriptSha256: artefact.transcriptSha256 },
      });
    }
  }
  const shaParPlateforme = new Map(
    dossier.liaison.artefacts.map((artefact) => [
      artefact.plateforme,
      artefact.sha256,
    ]),
  );
  for (const execution of dossier.parcours.executions) {
    execution.sha256Artefact = shaParPlateforme.get(execution.plateforme);
    ajouter(`parcours/${execution.plateforme}/${execution.recit}`, {
      plateforme: execution.plateforme,
      contenuSujet: transcriptPour(execution.plateforme),
      data: {
        sha256Artefact: execution.sha256Artefact,
        via: execution.via,
        contour: dossier.parcours.contour,
        serveurVite: dossier.parcours.serveurVite,
        facadeTest: dossier.parcours.facadeTest,
        transcriptSha256: dossier.liaison.artefacts.find(
          (artefact) => artefact.plateforme === execution.plateforme,
        ).transcriptSha256,
      },
    });
  }

  ajouter("staging/materiau", {
    contenuSujet: CONTENU_MATERIAU_STAGING,
    data: {
      environnement: dossier.liaison.staging.environnement,
      compte: dossier.liaison.staging.compte,
      zone: dossier.liaison.staging.zone,
      deploiement: dossier.liaison.staging.deploiement,
      materiau: dossier.liaison.staging.materiau,
      workers: dossier.liaison.staging.workers.map(({ name }) => name),
    },
  });
  const preuveDeploiement = ajouter("staging/deploiement", {
    contenuSujet: stagingObserve.contenu,
    data: {
      compte: dossier.liaison.staging.compte,
      environnement: dossier.liaison.staging.environnement,
      deploiement: dossier.liaison.staging.deploiement,
      workers: dossier.liaison.staging.workers.map(({ name }) => name),
    },
  });
  dossier.liaison.staging["deploiement-preuve-sha256"] =
    preuveDeploiement.subjectSha256;
  for (const artefact of dossier.liaison.artefacts) {
    ajouter(`staging/reobservation/${artefact.plateforme}`, {
      plateforme: artefact.plateforme,
      contenuSujet: stagingObserve.contenu,
      data: {
        transcriptSha256: artefact.transcriptSha256,
        initialStagingProofSha256: preuveDeploiement.subjectSha256,
        deploymentId: dossier.liaison.staging.deploiement,
        workers: dossier.liaison.staging.workers,
        sequence: ["transcript-installed", "cloudflare-reobserved"],
      },
    });
  }
  const indexPlateforme = `${JSON.stringify({
    schema: "punks.promotion-evidence-index.v1",
    preuves: [{ id: "transcript/macos-arm64" }],
  })}\n`;
  const indexRecuperation = `${JSON.stringify({
    schema: "punks.promotion-evidence-index.v1",
    preuves: [{ id: "faute/coupure/auth-punk" }],
  })}\n`;
  const reseaux = Object.fromEntries(
    PLATEFORMES.map((plateforme) => [
      plateforme,
      `${JSON.stringify({
        schema: "punks.installed-network-proof.v1",
        platform: plateforme,
        candidateSha: dossier.candidat.sha,
        stagingDeploymentId: dossier.liaison.staging.deploiement,
        network: { requests: [{ transport: "https" }, { transport: "wss" }] },
      })}\n`,
    ]),
  );
  dossier.liaison["digests-preuves-promotion"] = {
    platformIndex: sha256Octets(indexPlateforme),
    recoveryIndex: sha256Octets(indexRecuperation),
    network: Object.fromEntries(
      PLATEFORMES.map((plateforme) => [
        plateforme,
        sha256Octets(reseaux[plateforme]),
      ]),
    ),
  };
  const bundleProduction = contenuBundleProduction();
  const manifesteProduction = contenuManifesteProduction(
    dossier,
    preuveDeploiement.subjectSha256,
  );
  const production = {
    bundle: bundleProduction,
    manifeste: manifesteProduction,
  };
  dossier.liaison["digests-production"] = Object.fromEntries(
    Object.entries(production).map(([nom, contenu]) => [
      nom,
      sha256Octets(contenu),
    ]),
  );
  for (const [nom, contenuSujet] of Object.entries(production)) {
    ajouter(`production/${nom}`, { contenuSujet });
  }
  ajouter("production/evidence/platform-index", {
    contenuSujet: indexPlateforme,
    data: { path: "promotion-evidence/platform-index.json" },
  });
  ajouter("production/evidence/recovery-index", {
    contenuSujet: indexRecuperation,
    data: { path: "promotion-evidence/recovery-index.json" },
  });
  for (const plateforme of PLATEFORMES) {
    ajouter(`production/evidence/network/${plateforme}`, {
      contenuSujet: reseaux[plateforme],
      data: { path: `promotion-evidence/network/${plateforme}.json` },
    });
  }
  for (const scenario of dossier.fautes) {
    const artefactLie = dossier.liaison.artefacts.find(
      (artefact) => artefact.plateforme === scenario.plateforme,
    );
    scenario.sha256Artefact = artefactLie.sha256;
    scenario.transcriptSha256 = artefactLie.transcriptSha256;
    const faute = ajouter(`faute/${scenario.type}/${scenario.autorite}`, {
      plateforme: scenario.plateforme,
      contenuSujet: `capture:${scenario.type}:${scenario.autorite}\n`,
      data: {
        plateforme: scenario.plateforme,
        autorite: scenario.autorite,
        executionId: scenario.executionId,
        sha256Artefact: scenario.sha256Artefact,
        transcriptSha256: scenario.transcriptSha256,
        captureSha256: scenario.captureSha256,
      },
    });
    scenario.preuveSha256 = faute.sha256;
  }
  const scenariosRecuperation = dossier.fautes.map((faute) => {
    const preuvesRecuperation = {};
    for (const nom of PREUVES_RECUPERATION) {
      const reference = ajouter(
        `recuperation/${nom}/${faute.type}/${faute.autorite}`,
        {
          plateforme: faute.plateforme,
          contenuSujet: `recovery:${nom}:${faute.type}:${faute.autorite}\n`,
          data: {
            type: faute.type,
            autorite: faute.autorite,
            plateforme: faute.plateforme,
            executionId: faute.executionId,
            fauteSha256: faute.preuveSha256,
            sha256Artefact: faute.sha256Artefact,
            captureSha256: faute.captureSha256,
          },
        },
      );
      preuvesRecuperation[nom] = {
        resultat: "vert",
        preuveSha256: reference.sha256,
        subjectSha256: reference.subjectSha256,
      };
    }
    return {
      type: faute.type,
      autorite: faute.autorite,
      plateforme: faute.plateforme,
      executionId: faute.executionId,
      fauteSha256: faute.preuveSha256,
      sha256Artefact: faute.sha256Artefact,
      captureSha256: faute.captureSha256,
      preuves: preuvesRecuperation,
    };
  });
  const captures = dossier.fautes.map(({ type, autorite, captureSha256 }) => ({
    type,
    autorite,
    captureSha256,
  }));
  const preuveCaptures = ajouter("recuperation/captures", {
    contenuSujet: `${JSON.stringify(captures)}\n`,
    data: { captures },
  });
  dossier.recuperation = {
    scenarios: scenariosRecuperation,
    captures: preuveCaptures.subjectSha256,
  };
  for (const entree of dossier.accessibilite) {
    for (const critere of MATRICE_ACCESSIBILITE) {
      const observation = entree.matrice[critere];
      ajouter(`accessibilite/${entree.plateforme}/${critere}`, {
        plateforme: entree.plateforme,
        contenuSujet: transcriptPour(entree.plateforme),
        data: {
          transcriptSha256: dossier.liaison.artefacts.find(
            (artefact) => artefact.plateforme === entree.plateforme,
          ).transcriptSha256,
          methodes: observation.methodes,
          ...(observation.technologie === undefined
            ? {}
            : { technologie: observation.technologie }),
        },
      });
    }
    ajouter(`accessibilite/${entree.plateforme}/resultat`, {
      plateforme: entree.plateforme,
      contenuSujet: transcriptPour(entree.plateforme),
      data: {
        transcriptSha256: dossier.liaison.artefacts.find(
          (artefact) => artefact.plateforme === entree.plateforme,
        ).transcriptSha256,
        methodes: entree.resultat.methodes,
        technologieLecteurEcran: entree.resultat.technologieLecteurEcran,
      },
    });
  }
  for (const golden of dossier.goldens) {
    ajouter(`golden/${golden.test}`, { data: { ...golden } });
  }
  const retraitDiff = ajouter("retrait/diff", {
    data: {
      lignes: dossier.retrait.lignes,
      verdictsExecutes: dossier.retrait["verdicts-executes"],
    },
  });
  dossier.retrait.diff = retraitDiff.subjectSha256;
  ajouter("retrait/verdicts");
  for (const cible of SCANS_LEGACY) {
    dossier.scans[cible].empreinte = ajouter(`scan/${cible}`).subjectSha256;
  }
  for (const gate of PREUVES_OBLIGATOIRES) {
    ajouter(`gate/${gate}`);
  }

  const referencesIndex = Object.entries(preuves)
    .map(([id, { chemin, sha256, sujet }]) => ({
      id,
      chemin,
      sha256,
      sujet,
    }))
    .sort((gauche, droite) => gauche.id.localeCompare(droite.id));
  const contenuIndex = `${JSON.stringify({
    schema: "punks.promotion-evidence-index.v1",
    preuves: referencesIndex,
  })}\n`;
  const indexSha256 = sha256Octets(contenuIndex);
  const indexChemin = join("sha256", `${indexSha256}-index.json`);
  const indexAbsolu = join(RACINE_PREUVES, indexChemin);
  if (!existsSync(indexAbsolu)) {
    writeFileSync(indexAbsolu, contenuIndex, { flag: "wx" });
  }
  const contenuBundle = `${JSON.stringify(bundleSigstore())}\n`;
  const bundleSha256 = sha256Octets(contenuBundle);
  const bundleChemin = join(
    "sha256",
    `${bundleSha256}-provenance.sigstore.json`,
  );
  const bundleAbsolu = join(RACINE_PREUVES, bundleChemin);
  if (!existsSync(bundleAbsolu)) {
    writeFileSync(bundleAbsolu, contenuBundle, { flag: "wx" });
  }
  dossier.provenance = {
    schema: "punks.promotion-evidence-provenance.v1",
    repository: "punksbot/punksbot",
    sourceRef: "refs/heads/staging",
    signerWorkflow:
      "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
    bundle: { chemin: bundleChemin, sha256: bundleSha256 },
    index: { chemin: indexChemin, sha256: indexSha256 },
  };
  return preuves;
}

export function nomsArtefactInstalle(plateforme, candidateSha = SHA_CANDIDAT) {
  const prefixe = `punks-desktop-${plateforme}-${candidateSha}`;
  const [suffixe, suffixeSignature] = plateforme.startsWith("macos-")
    ? [".app.tar.gz", ".app.tar.gz.sig"]
    : plateforme === "linux-x64"
      ? [".AppImage", ".AppImage.sig"]
      : [".exe", ".exe.sig"];
  return [`${prefixe}${suffixe}`, `${prefixe}${suffixeSignature}`];
}

export function artefact(plateforme) {
  const contenu = contenuArtefact(plateforme);
  const signature = contenuSignature(plateforme);
  const [nom, signatureNom] = nomsArtefactInstalle(plateforme);
  return {
    plateforme,
    nom,
    sha256: sha256Octets(contenu),
    taille: Buffer.byteLength(contenu),
    signatureNom,
    signature: sha256Octets(signature),
    signatureTaille: Buffer.byteLength(signature),
    transcriptSha256: sha256Octets(contenuTranscript(plateforme)),
    identite: {
      bundleId: "bot.punks.desktop.staging",
      verifications: Object.fromEntries(
        VERIFICATIONS_ARTEFACT.map((v) => [v, "vert"]),
      ),
    },
  };
}

export function dossierValide(surcharges = {}) {
  const recits = [...RECITS];
  const artefacts = PLATEFORMES.map((p) => artefact(p));
  const dossier = {
    version: 1,
    "checkpoint-recuperation": CHECKPOINT_RECUPERATION,
    "baseline-punks": BASELINE_PUNKS,
    candidat: { sha: SHA_CANDIDAT, tranche: 1 },
    profil: {
      id: PROFIL_PROMOTION.id,
      materiau: "cloudflare/promotion-profiles.json",
      "materiau-sha256": sha256Octets(CONTENU_PROFIL_PROMOTION),
    },
    liaison: {
      canal: "punks-desktop",
      artefacts,
      staging: {
        environnement: "staging",
        compte: STAGING.compte,
        zone: STAGING.zone,
        deploiement: STAGING.deploiement,
        materiau: "cloudflare/staging.resources.json",
        "materiau-sha256": HASH_REGISTRE.staging,
        workers: WORKERS_DEPLOYES,
        autorites: AUTORITES,
      },
      "digests-production": {
        bundle: "0".repeat(64),
        manifeste: "0".repeat(64),
      },
      registres: [
        {
          nom: "registre-contrats",
          version: 1,
          sha256: HASH_REGISTRE["registre-contrats"],
        },
        { nom: "profil", version: 1, sha256: HASH_REGISTRE.profil },
        {
          nom: "registre-goldens",
          version: 1,
          sha256: HASH_REGISTRE["registre-goldens"],
        },
        {
          nom: "manifeste-retrait",
          version: 1,
          sha256: HASH_REGISTRE["manifeste-retrait"],
        },
      ],
    },
    parcours: {
      contour: "distribue",
      serveurVite: false,
      facadeTest: false,
      recits,
      executions: PLATEFORMES.flatMap((p) =>
        recits.map((recit) => ({
          plateforme: p,
          sha256Artefact: artefacts.find(
            (artefact) => artefact.plateforme === p,
          ).sha256,
          deploiement: STAGING.deploiement,
          recit,
          via: ["ui", "ipc-rust", "contrats-publics"],
          resultat: "vert",
        })),
      ),
    },
    fautes: TYPES_FAUTE.flatMap((type, typeIndex) =>
      AUTORITES.map((autorite, autoriteIndex) => {
        const plateforme =
          PLATEFORMES[(typeIndex + autoriteIndex) % PLATEFORMES.length];
        const artefactLie = artefacts.find(
          (artefact) => artefact.plateforme === plateforme,
        );
        return {
          type,
          plateforme,
          autorite,
          executionId: `fault-${type}-${autorite}`,
          sha256Artefact: artefactLie.sha256,
          transcriptSha256: artefactLie.transcriptSha256,
          captureSha256: sha256Octets(`capture:${type}:${autorite}\n`),
          preuveSha256: "0".repeat(64),
          resultat: "vert",
        };
      }),
    ),
    recuperation: { scenarios: [], captures: "0".repeat(64) },
    accessibilite: PLATEFORMES.map((p) => ({
      plateforme: p,
      matrice: Object.fromEntries(
        MATRICE_ACCESSIBILITE.map((c) => [
          c,
          {
            resultat: "vert",
            methodes: METHODES_ACCESSIBILITE,
            ...(c === "lecteur-ecran"
              ? { technologie: technologieLecteurEcran(p) }
              : {}),
          },
        ]),
      ),
      resultat: {
        resultat: "vert",
        methodes: METHODES_ACCESSIBILITE,
        technologieLecteurEcran: technologieLecteurEcran(p),
      },
    })),
    goldens: LIGNES_REGISTRE.map((l) => ({ test: l.test, verdict: l.verdict })),
    retrait: {
      diff: "8b".repeat(32),
      "verdicts-executes": 4,
      lignes: LIGNES_REGISTRE.map((l) => l.test),
    },
    scans: Object.fromEntries(
      SCANS_LEGACY.map((c, i) => [
        c,
        { resultat: "vert", empreinte: `${i}${"7".repeat(63)}` },
      ]),
    ),
    gates: Object.fromEntries(
      PREUVES_OBLIGATOIRES.map((preuve) => [
        preuve,
        { resultat: "vert", sha: SHA_CANDIDAT },
      ]),
    ),
    ...surcharges,
  };
  dossier.preuves = surcharges.preuves ?? preuvesPourDossier(dossier);
  return dossier;
}

export function contexteValide(surcharges = {}) {
  return {
    ledgerRetraits: LIGNES_REGISTRE,
    hashes: { ...HASH_REGISTRE },
    stagingIds: { ...STAGING },
    promotionProfileSha256: sha256Octets(CONTENU_PROFIL_PROMOTION),
    racinePreuves: RACINE_PREUVES,
    verifierProvenance: () => {},
    autorisation: { cloudflareCheck: "vert", graphe: "vert" },
    ...surcharges,
  };
}

export function emissionValidePourSha(sha = SHA_CANDIDAT) {
  const dossier = dossierValide();
  if (dossier.candidat.sha !== sha) {
    dossier.candidat.sha = sha;
    for (const gate of Object.values(dossier.gates)) gate.sha = sha;
    for (const artefact of dossier.liaison.artefacts) {
      [artefact.nom, artefact.signatureNom] = nomsArtefactInstalle(
        artefact.plateforme,
        sha,
      );
    }
    dossier.preuves = preuvesPourDossier(dossier);
  }
  const contexte = contexteValide();
  const emission = construireAttestation(dossier, contexte);
  assert.equal(emission.erreur, undefined);
  return { dossier, contexte, ...emission };
}

export function attendu(errors, extrait) {
  assert.ok(
    errors.some((e) => e.includes(extrait)),
    `attendu un message contenant « ${extrait} », reçu : ${JSON.stringify(errors)}`,
  );
}

export function remplacerPreuveSujet(
  dossier,
  identifiant,
  { contenuSujet, data },
) {
  const originale = dossier.preuves[identifiant];
  const documentOriginal = JSON.parse(
    readFileSync(join(RACINE_PREUVES, originale.chemin), "utf8"),
  );
  const sujetOriginal = readFileSync(
    join(RACINE_PREUVES, originale.sujet.chemin),
  );
  const reference = preuvePour(identifiant, {
    candidateSha: dossier.candidat.sha,
    stagingDeploymentId: dossier.liaison.staging.deploiement,
    plateforme: documentOriginal.plateforme,
    data: data ?? documentOriginal.data,
    contenuSujet: contenuSujet ?? sujetOriginal,
  });
  dossier.preuves[identifiant] = reference;
  return reference;
}
