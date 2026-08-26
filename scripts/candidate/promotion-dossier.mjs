#!/usr/bin/env node

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
} from "../migration-manifest-lib.mjs";
import {
  validateCandidateAggregateContent,
  validateInstalledReleaseNames,
  validatePromotionProfilesContent,
  validateStagingMaterialContent,
} from "../promotion-materials-lib.mjs";
import { validateSigstoreBundleContent } from "../github-attestation-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  SCANS_LEGACY,
  TYPES_FAUTE,
  VERIFICATIONS_ARTEFACT,
  validerDossier,
} from "../promotion-dossier-lib.mjs";
import {
  NOMS_REGISTRES_ATTESTATION,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
} from "../release-graph-lib.mjs";
import {
  cheminCanonique,
  dansRacine,
  lireFichierRegulierSansLien,
  parserJson,
  referenceFichierDansRacine,
} from "./promotion-evidence-io.mjs";
import { runPromotionDossierCli } from "./promotion-dossier-cli.mjs";
import { validateInstalledArtifactScan } from "./installed-artifact-scan.mjs";

const INDEX_SCHEMA = "punks.promotion-evidence-index.v1";
const PREUVE_SCHEMA = "punks.promotion-proof.v1";
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function refuser(message) {
  throw new Error(`dossier de promotion refusé : ${message}`);
}

function estObjet(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clesExactes(value, cles) {
  if (!estObjet(value)) return false;
  const actuelles = Object.keys(value).sort();
  const attendues = [...cles].sort();
  return (
    actuelles.length === attendues.length &&
    actuelles.every((cle, index) => cle === attendues[index])
  );
}

function exigerChaine(value, libelle) {
  if (typeof value !== "string" || value.trim() === "") {
    refuser(`${libelle} doit être une chaîne non vide`);
  }
  return value;
}

function exigerMethodesAccessibilite(values, libelle) {
  if (
    !Array.isArray(values) ||
    values.length !== METHODES_ACCESSIBILITE.length ||
    new Set(values).size !== METHODES_ACCESSIBILITE.length ||
    !METHODES_ACCESSIBILITE.every((methode) => values.includes(methode))
  ) {
    refuser(
      `${libelle} doit citer exactement ${METHODES_ACCESSIBILITE.join(" + ")}`,
    );
  }
  return [...values];
}

function exigerPlateforme(preuve, attendue, id) {
  if (preuve.plateforme !== attendue) {
    refuser(
      `preuve « ${id} » liée à la plateforme ${String(preuve.plateforme)} au lieu de ${attendue}`,
    );
  }
}

function chargerPreuves({
  racinePreuves,
  indexPreuves,
  candidatSha,
  deploiementId,
}) {
  const racineAbsolue = resolve(racinePreuves);
  const racineReelle = realpathSync(racinePreuves);
  const indexAbsolu = resolve(indexPreuves);
  if (!dansRacine(racineAbsolue, indexAbsolu)) {
    refuser("l'index sort de la racine des preuves");
  }
  const indexReel = realpathSync(indexAbsolu);
  const indexAttendu = resolve(
    racineReelle,
    relative(racineAbsolue, indexAbsolu),
  );
  if (indexReel !== indexAttendu) {
    refuser("l'index traverse un lien symbolique");
  }
  if (!dansRacine(racineReelle, indexReel)) {
    refuser("l'index sort de la racine des preuves");
  }
  const index = parserJson(
    lireFichierRegulierSansLien(indexAbsolu, racineReelle, "index de preuves"),
    "l'index de preuves",
  );
  if (index?.schema !== INDEX_SCHEMA || !Array.isArray(index.preuves)) {
    refuser(
      `index invalide : schéma ${INDEX_SCHEMA} et tableau preuves exigés`,
    );
  }

  const ids = new Set();
  const chemins = new Set();
  const hashes = new Set();
  const chargees = new Map();
  for (const reference of index.preuves) {
    if (!clesExactes(reference, ["id", "chemin", "sha256", "sujet"])) {
      refuser("référence de preuve malformée");
    }
    const { id, chemin, sha256, sujet } = reference;
    exigerChaine(id, "identifiant de preuve");
    if (!cheminCanonique(chemin)) {
      refuser(`preuve « ${id} » avec chemin non canonique ou hors racine`);
    }
    if (!SHA256_RE.test(sha256 ?? "")) {
      refuser(`preuve « ${id} » sans sha256 valide`);
    }
    if (
      !clesExactes(sujet, ["chemin", "sha256"]) ||
      !cheminCanonique(sujet.chemin) ||
      !SHA256_RE.test(sujet.sha256 ?? "")
    ) {
      refuser(`preuve « ${id} » sans sujet brut content-addressé valide`);
    }
    if (ids.has(id)) refuser(`identifiant de preuve dupliqué « ${id} »`);
    if (chemins.has(chemin)) refuser(`chemin de preuve dupliqué « ${chemin} »`);
    if (hashes.has(sha256)) refuser(`sha256 de preuve dupliqué « ${sha256} »`);
    ids.add(id);
    chemins.add(chemin);
    hashes.add(sha256);

    if (!basename(chemin).startsWith(sha256)) {
      refuser(`preuve « ${id} » dont le nom n'est pas content-addressé`);
    }
    const absolu = resolve(racineReelle, chemin);
    const reel = realpathSync(absolu);
    if (reel !== absolu || !dansRacine(racineReelle, reel)) {
      refuser(
        `preuve « ${id} » sort de la racine ou traverse un lien symbolique`,
      );
    }
    const contenu = lireFichierRegulierSansLien(
      absolu,
      racineReelle,
      `preuve « ${id} »`,
    );
    const recalcule = createHash("sha256").update(contenu).digest("hex");
    if (recalcule !== sha256) {
      refuser(`preuve « ${id} » altérée : hash recalculé divergent`);
    }
    const preuve = parserJson(contenu, `la preuve « ${id} »`);
    if (
      !estObjet(preuve) ||
      preuve.schema !== PREUVE_SCHEMA ||
      preuve.id !== id
    ) {
      refuser(`preuve « ${id} » avec identité ou schéma divergent`);
    }
    if (preuve.candidateSha !== candidatSha) {
      refuser(`preuve « ${id} » liée au mauvais SHA candidat`);
    }
    if (preuve.stagingDeploymentId !== deploiementId) {
      refuser(`preuve « ${id} » liée au mauvais déploiement staging`);
    }
    if (preuve.result !== "vert") {
      refuser(`preuve « ${id} » absente ou non verte`);
    }
    if (!estObjet(preuve.data)) {
      refuser(`preuve « ${id} » sans données réelles`);
    }
    const sujetAbsolu = resolve(racineReelle, sujet.chemin);
    const sujetReel = realpathSync(sujetAbsolu);
    if (sujetReel !== sujetAbsolu || !dansRacine(racineReelle, sujetReel)) {
      refuser(
        `sujet de la preuve « ${id} » sort de la racine ou traverse un lien symbolique`,
      );
    }
    if (!basename(sujet.chemin).startsWith(sujet.sha256)) {
      refuser(`sujet de la preuve « ${id} » non content-addressé`);
    }
    const contenuSujet = lireFichierRegulierSansLien(
      sujetAbsolu,
      racineReelle,
      `sujet de la preuve « ${id} »`,
    );
    const sujetRecalcule = createHash("sha256")
      .update(contenuSujet)
      .digest("hex");
    if (
      sujetRecalcule !== sujet.sha256 ||
      preuve.data.subjectSha256 !== sujet.sha256
    ) {
      refuser(`preuve « ${id} » avec sujet brut ou subjectSha256 divergent`);
    }
    chargees.set(id, {
      preuve,
      reference: {
        chemin,
        sha256,
        subjectSha256: sujet.sha256,
        sujet: { ...sujet },
      },
      sujet: {
        absolu: sujetAbsolu,
        contenu: contenuSujet,
        sha256: sujet.sha256,
      },
    });
  }
  return chargees;
}

function creerConsommateur(chargees) {
  const consommees = new Set();
  const prendre = (id) => {
    const entree = chargees.get(id);
    if (!entree) refuser(`preuve obligatoire absente « ${id} »`);
    consommees.add(id);
    return entree;
  };
  const finir = () => {
    const inconnues = [...chargees.keys()].filter((id) => !consommees.has(id));
    if (inconnues.length > 0) {
      refuser(`preuves inconnues ou non consommées : ${inconnues.join(", ")}`);
    }
  };
  return { prendre, finir };
}

function chargerPreuveDeploiementStaging({
  racinePreuves,
  chemin,
  candidatSha,
}) {
  const racine = realpathSync(racinePreuves);
  const cheminDeclare = resolve(chemin);
  const absolu = realpathSync(cheminDeclare);
  if (!dansRacine(racine, absolu)) {
    refuser("la preuve de déploiement staging sort de la racine des preuves");
  }
  const contenu = lireFichierRegulierSansLien(
    cheminDeclare,
    racine,
    "preuve de déploiement staging",
  );
  let preuve;
  try {
    preuve = validateStagingDeploymentProof(
      parserJson(contenu, "la preuve de déploiement staging"),
      {
        accountId: CANONICAL_STAGING_ACCOUNT_ID,
        environment: "staging",
        sourceSha: candidatSha,
      },
    );
  } catch (erreur) {
    refuser(
      `preuve de déploiement staging invalide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  return {
    preuve,
    absolu,
    contenu,
    sha256: createHash("sha256").update(contenu).digest("hex"),
  };
}

function chargerProfilPromotion(chemin, tranche) {
  const cheminDeclare = resolve(chemin);
  const racine = realpathSync(dirname(cheminDeclare));
  const contenu = lireFichierRegulierSansLien(
    cheminDeclare,
    racine,
    "matériau des profils de promotion",
  );
  let profil;
  try {
    profil = validatePromotionProfilesContent(contenu, { tranche });
  } catch (erreur) {
    refuser(
      `matériau des profils de promotion invalide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  return {
    absolu: realpathSync(cheminDeclare),
    contenu,
    profil,
    sha256: createHash("sha256").update(contenu).digest("hex"),
  };
}

function construireDossier({
  chargees,
  deploiementStaging,
  profilPromotion,
  repository,
}) {
  const deploiementId = deploiementStaging.preuve.deploymentId;
  const { prendre, finir } = creerConsommateur(chargees);
  const preuves = {};
  const citer = (id) => {
    const entree = prendre(id);
    const subjectSha256 = entree.preuve.data.subjectSha256;
    if (!SHA256_RE.test(subjectSha256 ?? "")) {
      refuser(`preuve « ${id} » avec subjectSha256 invalide`);
    }
    preuves[id] = { ...entree.reference };
    return entree;
  };

  const candidat = citer("candidat").preuve;
  if (!Number.isInteger(candidat.data.tranche) || candidat.data.tranche < 1) {
    refuser("preuve candidat sans tranche entière positive");
  }
  const profilEntree = citer("profil/promotion");
  if (
    profilEntree.sujet.sha256 !== profilPromotion.sha256 ||
    !profilEntree.sujet.contenu.equals(profilPromotion.contenu)
  ) {
    refuser("profil de promotion indexé divergent du matériau versionné exact");
  }
  const profil = profilPromotion.profil;
  if (
    profil.tranche !== candidat.data.tranche ||
    profilEntree.preuve.data.materiau !==
      "cloudflare/promotion-profiles.json" ||
    profilEntree.preuve.data.profil !== profil.id ||
    profilEntree.preuve.data.tranche !== profil.tranche ||
    JSON.stringify(profilEntree.preuve.data.recits) !==
      JSON.stringify(profil.stories) ||
    JSON.stringify(profilEntree.preuve.data.autorites) !==
      JSON.stringify(profil.authorities.map(({ id }) => id))
  ) {
    refuser("preuve du profil de promotion divergente de son matériau exact");
  }
  const registres = citer("registres").preuve.data.registres;
  if (!Array.isArray(registres)) refuser("preuve registres malformée");
  const nomsRegistres = registres.map((registre) => registre?.nom);
  if (
    nomsRegistres.length !== NOMS_REGISTRES_ATTESTATION.length ||
    !NOMS_REGISTRES_ATTESTATION.every((nom) => nomsRegistres.includes(nom))
  ) {
    refuser("preuve registres incomplète ou dupliquée");
  }

  const stagingDeploiement = citer("staging/deploiement");
  if (
    stagingDeploiement.sujet.absolu !== deploiementStaging.absolu ||
    stagingDeploiement.sujet.sha256 !== deploiementStaging.sha256
  ) {
    refuser(
      "preuve staging indexée divergente de la preuve de déploiement fournie",
    );
  }
  const donneesDeploiement = stagingDeploiement.preuve.data;
  const workersDeployes = deploiementStaging.preuve.workers.map(
    ({ name, versionId, deploymentId }) => ({
      name,
      versionId,
      deploymentId,
    }),
  );
  const nomsWorkersDeployes = workersDeployes.map(({ name }) => name);
  if (
    donneesDeploiement.compte !== deploiementStaging.preuve.accountId ||
    donneesDeploiement.environnement !==
      deploiementStaging.preuve.environment ||
    donneesDeploiement.deploiement !== deploiementId ||
    JSON.stringify(donneesDeploiement.workers) !==
      JSON.stringify(nomsWorkersDeployes)
  ) {
    refuser("preuve staging distante divergente de son enveloppe indexée");
  }

  const stagingEntree = citer("staging/materiau");
  const staging = stagingEntree.preuve.data;
  if (!SHA256_RE.test(staging.subjectSha256 ?? "")) {
    refuser(
      "matériau staging sans subjectSha256 du fichier staging.resources.json exact",
    );
  }
  if (staging.deploiement !== deploiementId) {
    refuser("matériau staging lié au mauvais déploiement");
  }
  let materiauStaging;
  try {
    materiauStaging = validateStagingMaterialContent(
      stagingEntree.sujet.contenu,
    );
  } catch (erreur) {
    refuser(
      `matériau staging invalide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  const autorites = profil.authorities.map(({ id }) => id);
  if (
    staging.compte !== deploiementStaging.preuve.accountId ||
    staging.environnement !== deploiementStaging.preuve.environment ||
    staging.compte !== materiauStaging.accountId ||
    staging.zone !== materiauStaging.zoneId ||
    JSON.stringify(staging.workers) !== JSON.stringify(nomsWorkersDeployes) ||
    JSON.stringify([...materiauStaging.workers].sort()) !==
      JSON.stringify([...nomsWorkersDeployes].sort()) ||
    profil.authorities.some(
      ({ worker }) => !nomsWorkersDeployes.includes(worker),
    )
  ) {
    refuser(
      "matériau staging divergent des Workers et autorités réellement observés",
    );
  }

  const digestsProduction = {};
  const production = {};
  for (const nom of ["bundle", "manifeste"]) {
    const id = `production/${nom}`;
    const entree = citer(id);
    const digest = entree.preuve.data.subjectSha256;
    if (!SHA256_RE.test(digest ?? "")) {
      refuser(`${id}.data.subjectSha256 doit lier le contenu exact`);
    }
    digestsProduction[nom] = digest;
    production[nom] = entree;
  }
  try {
    validateSigstoreBundleContent(production.bundle.sujet.contenu);
  } catch (erreur) {
    refuser(
      `production/bundle n'est pas un bundle Sigstore valide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  const citerEvidenceProduction = (id, path) => {
    const entree = citer(id);
    if (entree.preuve.data.path !== path) {
      refuser(`preuve « ${id} » liée au mauvais matériau de promotion`);
    }
    return entree.sujet.sha256;
  };
  const promotionEvidenceDigests = {
    platformIndex: citerEvidenceProduction(
      "production/evidence/platform-index",
      "promotion-evidence/platform-index.json",
    ),
    recoveryIndex: citerEvidenceProduction(
      "production/evidence/recovery-index",
      "promotion-evidence/recovery-index.json",
    ),
    network: Object.fromEntries(
      PLATEFORMES.map((plateforme) => [
        plateforme,
        citerEvidenceProduction(
          `production/evidence/network/${plateforme}`,
          `promotion-evidence/network/${plateforme}.json`,
        ),
      ]),
    ),
  };

  const artefacts = [];
  const bundles = new Map();
  for (const plateforme of PLATEFORMES) {
    const transcriptId = `transcript/${plateforme}`;
    const transcript = citer(transcriptId);
    exigerPlateforme(transcript.preuve, plateforme, transcriptId);
    if (
      transcript.preuve.data.schema !==
        "punks.installed-social-loop-transcript.v1" ||
      transcript.preuve.data.plateforme !== plateforme
    ) {
      refuser(`preuve « ${transcriptId} » avec transcript installé invalide`);
    }
    const reobservationId = `staging/reobservation/${plateforme}`;
    const reobservation = citer(reobservationId);
    exigerPlateforme(reobservation.preuve, plateforme, reobservationId);
    let preuvePostParcours;
    try {
      preuvePostParcours = validateStagingDeploymentProof(
        parserJson(
          reobservation.sujet.contenu,
          `la preuve « ${reobservationId} »`,
        ),
        {
          accountId: CANONICAL_STAGING_ACCOUNT_ID,
          environment: "staging",
          sourceSha: candidat.candidateSha,
        },
      );
    } catch (erreur) {
      refuser(
        `preuve « ${reobservationId} » avec réobservation Cloudflare invalide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
    const donneesReobservation = reobservation.preuve.data;
    if (
      !reobservation.sujet.contenu.equals(deploiementStaging.contenu) ||
      preuvePostParcours.deploymentId !== deploiementId ||
      donneesReobservation.transcriptSha256 !== transcript.sujet.sha256 ||
      donneesReobservation.initialStagingProofSha256 !==
        deploiementStaging.sha256 ||
      donneesReobservation.deploymentId !== deploiementId ||
      JSON.stringify(donneesReobservation.workers) !==
        JSON.stringify(workersDeployes) ||
      JSON.stringify(donneesReobservation.sequence) !==
        JSON.stringify(["transcript-installed", "cloudflare-reobserved"])
    ) {
      refuser(
        `preuve « ${reobservationId} » sans lien causal exact transcript → réobservation Cloudflare`,
      );
    }
    const bundleId = `artefact/${plateforme}/bundle`;
    const signatureId = `artefact/${plateforme}/signature`;
    const rawId = `brut/${plateforme}`;
    const bundle = citer(bundleId);
    const signature = citer(signatureId);
    const raw = citer(rawId);
    const scanId = `scan/artefact/${plateforme}`;
    const scan = citer(scanId);
    exigerPlateforme(bundle.preuve, plateforme, bundleId);
    exigerPlateforme(signature.preuve, plateforme, signatureId);
    exigerPlateforme(raw.preuve, plateforme, rawId);
    exigerPlateforme(scan.preuve, plateforme, scanId);
    const verifications = {};
    for (const verification of VERIFICATIONS_ARTEFACT) {
      const id = `artefact/${plateforme}/verification/${verification}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, plateforme, id);
      if (
        entree.preuve.data.transcriptSha256 !== transcript.sujet.sha256 ||
        entree.sujet.sha256 !== transcript.sujet.sha256
      ) {
        refuser(`preuve « ${id} » divergente du transcript installé`);
      }
      verifications[verification] = entree.preuve.result;
    }
    exigerChaine(bundle.preuve.data.nom, `${bundleId}.data.nom`);
    exigerChaine(bundle.preuve.data.bundleId, `${bundleId}.data.bundleId`);
    exigerChaine(signature.preuve.data.nom, `${signatureId}.data.nom`);
    try {
      validateInstalledReleaseNames({
        platform: plateforme,
        candidateSha: candidat.candidateSha,
        artifactName: bundle.preuve.data.nom,
        signatureName: signature.preuve.data.nom,
      });
    } catch (erreur) {
      refuser(
        `artefact installé ${plateforme} réattribué : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
    if (!SHA256_RE.test(bundle.preuve.data.subjectSha256 ?? "")) {
      refuser(
        `${bundleId}.data.subjectSha256 doit lier l'artefact signé exact`,
      );
    }
    if (bundle.preuve.data.taille !== bundle.sujet.contenu.length) {
      refuser(`${bundleId}.data.taille diverge de l'artefact exact`);
    }
    if (!SHA256_RE.test(bundle.preuve.data.transcriptSha256 ?? "")) {
      refuser(
        `${bundleId}.data.transcriptSha256 doit lier l'exécution installée exacte`,
      );
    }
    if (bundle.preuve.data.transcriptSha256 !== transcript.sujet.sha256) {
      refuser(`preuve « ${bundleId} » divergente du transcript brut installé`);
    }
    if (!SHA256_RE.test(signature.preuve.data.subjectSha256 ?? "")) {
      refuser(
        `${signatureId}.data.subjectSha256 doit lier la signature exacte`,
      );
    }
    if (signature.preuve.data.taille !== signature.sujet.contenu.length) {
      refuser(`${signatureId}.data.taille diverge de la signature exacte`);
    }
    if (signature.preuve.data.transcriptSha256 !== transcript.sujet.sha256) {
      refuser(`preuve « ${signatureId} » divergente du transcript installé`);
    }
    let scanValide;
    try {
      scanValide = validateInstalledArtifactScan(
        parserJson(scan.sujet.contenu, `la preuve « ${scanId} »`),
        {
          platform: plateforme,
          candidateSha: candidat.candidateSha,
          artifactSha256: bundle.preuve.data.subjectSha256,
        },
      );
    } catch (erreur) {
      refuser(
        `preuve « ${scanId} » avec scan installé invalide : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
    const transcriptInstalle = parserJson(
      transcript.sujet.contenu,
      `la preuve « ${transcriptId} »`,
    );
    const archiveBrute = parserJson(
      raw.sujet.contenu,
      `la preuve « ${rawId} »`,
    );
    if (
      archiveBrute?.schema !== "punks.installed-raw-evidence-archive.v1" ||
      archiveBrute.indexSha256 !==
        transcriptInstalle?.rawEvidence?.indexSha256 ||
      !Array.isArray(archiveBrute.files) ||
      archiveBrute.files.length !== transcriptInstalle?.rawEvidence?.files ||
      raw.preuve.data.indexSha256 !== archiveBrute.indexSha256 ||
      raw.preuve.data.files !== archiveBrute.files.length ||
      raw.preuve.data.transcriptSha256 !== transcript.sujet.sha256 ||
      raw.preuve.data.subjectSha256 !== raw.sujet.sha256
    ) {
      refuser(
        `preuve « ${rawId} » divergente des observations brutes installées`,
      );
    }
    if (
      scan.preuve.data.sha256Artefact !== bundle.preuve.data.subjectSha256 ||
      scan.preuve.data.subjectSha256 !== scan.sujet.sha256 ||
      scan.preuve.data.transcriptSha256 !== transcript.sujet.sha256 ||
      scanValide.native.sha256 !== transcriptInstalle?.installed?.binarySha256
    ) {
      refuser(`preuve « ${scanId} » divergente de l'artefact installé`);
    }
    bundles.set(plateforme, bundle.preuve.data.subjectSha256);
    artefacts.push({
      plateforme,
      nom: bundle.preuve.data.nom,
      sha256: bundle.preuve.data.subjectSha256,
      taille: bundle.sujet.contenu.length,
      signatureNom: signature.preuve.data.nom,
      signature: signature.preuve.data.subjectSha256,
      signatureTaille: signature.sujet.contenu.length,
      transcriptSha256: bundle.preuve.data.transcriptSha256,
      scanSha256: scan.sujet.sha256,
      identite: {
        bundleId: bundle.preuve.data.bundleId,
        verifications,
      },
    });
  }

  try {
    validateCandidateAggregateContent(production.manifeste.sujet.contenu, {
      candidateSha: candidat.candidateSha,
      stagingDeploymentId: deploiementId,
      stagingProofSha256: stagingDeploiement.sujet.sha256,
      promotionEvidenceDigests,
      repository,
      artifacts: artefacts,
    });
  } catch (erreur) {
    refuser(
      `production/manifeste divergent des artefacts installés : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }

  const recits = profil.stories;
  const executions = [];
  let contour;
  let serveurVite;
  let facadeTest;
  for (const plateforme of PLATEFORMES) {
    for (const recit of recits) {
      const id = `parcours/${plateforme}/${recit}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, plateforme, id);
      const data = entree.preuve.data;
      const transcriptSha256 = artefacts.find(
        (artefact) => artefact.plateforme === plateforme,
      )?.transcriptSha256;
      if (
        data.transcriptSha256 !== transcriptSha256 ||
        entree.sujet.sha256 !== transcriptSha256
      ) {
        refuser(`preuve « ${id} » divergente du transcript installé`);
      }
      if (data.sha256Artefact !== bundles.get(plateforme)) {
        refuser(`preuve « ${id} » liée au mauvais artefact signé`);
      }
      if (
        data.contour !== "distribue" ||
        data.serveurVite !== false ||
        data.facadeTest !== false
      ) {
        refuser(`preuve « ${id} » n'exerce pas le candidat distribué exact`);
      }
      if (
        !Array.isArray(data.via) ||
        !["ui", "ipc-rust", "contrats-publics"].every((via) =>
          data.via.includes(via),
        )
      ) {
        refuser(`preuve « ${id} » incomplète pour UI + IPC Rust + contrats`);
      }
      contour ??= data.contour;
      serveurVite ??= data.serveurVite;
      facadeTest ??= data.facadeTest;
      executions.push({
        plateforme,
        recit,
        sha256Artefact: data.sha256Artefact,
        deploiement: entree.preuve.stagingDeploymentId,
        via: data.via,
        resultat: entree.preuve.result,
      });
    }
  }

  const fautes = TYPES_FAUTE.flatMap((type) =>
    autorites.map((autorite) => {
      const id = `faute/${type}/${autorite}`;
      const entree = citer(id);
      const plateforme = entree.preuve.data.plateforme;
      exigerPlateforme(entree.preuve, plateforme, id);
      if (!PLATEFORMES.includes(plateforme)) {
        refuser(`preuve « ${id} » sur plateforme inconnue`);
      }
      if (entree.preuve.data.autorite !== autorite) {
        refuser(`preuve « ${id} » liée à une autre autorité`);
      }
      const data = entree.preuve.data;
      const artefact = artefacts.find(
        (candidate) => candidate.plateforme === plateforme,
      );
      const executionId = exigerChaine(
        data.executionId,
        `${id}.data.executionId`,
      );
      if (
        data.sha256Artefact !== artefact.sha256 ||
        data.transcriptSha256 !== artefact.transcriptSha256 ||
        data.captureSha256 !== entree.sujet.sha256
      ) {
        refuser(`preuve « ${id} » sans exécution/capture causale exacte`);
      }
      return {
        type,
        plateforme,
        autorite,
        executionId,
        sha256Artefact: data.sha256Artefact,
        transcriptSha256: data.transcriptSha256,
        captureSha256: data.captureSha256,
        preuveSha256: entree.reference.sha256,
        resultat: entree.preuve.result,
      };
    }),
  );

  const scenariosRecuperation = fautes.map((faute) => {
    const preuvesRecuperation = {};
    for (const nom of PREUVES_RECUPERATION) {
      const id = `recuperation/${nom}/${faute.type}/${faute.autorite}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, faute.plateforme, id);
      const data = entree.preuve.data;
      if (
        data.type !== faute.type ||
        data.autorite !== faute.autorite ||
        data.plateforme !== faute.plateforme ||
        data.executionId !== faute.executionId ||
        data.fauteSha256 !== faute.preuveSha256 ||
        data.sha256Artefact !== faute.sha256Artefact ||
        data.captureSha256 !== faute.captureSha256
      ) {
        refuser(
          `preuve de récupération « ${id} » sans lien causal vers la faute exacte`,
        );
      }
      preuvesRecuperation[nom] = {
        resultat: entree.preuve.result,
        preuveSha256: entree.reference.sha256,
        subjectSha256: entree.sujet.sha256,
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
  const capturesEntree = citer("recuperation/captures");
  const capturesAttendues = fautes.map(({ type, autorite, captureSha256 }) => ({
    type,
    autorite,
    captureSha256,
  }));
  if (
    JSON.stringify(capturesEntree.preuve.data.captures) !==
    JSON.stringify(capturesAttendues)
  ) {
    refuser("preuve de récupération des captures divergente des fautes");
  }
  const recuperation = {
    scenarios: scenariosRecuperation,
    captures: capturesEntree.sujet.sha256,
  };

  const accessibilite = PLATEFORMES.map((plateforme) => {
    const matrice = {};
    for (const critere of MATRICE_ACCESSIBILITE) {
      const id = `accessibilite/${plateforme}/${critere}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, plateforme, id);
      const transcriptSha256 = artefacts.find(
        (artefact) => artefact.plateforme === plateforme,
      )?.transcriptSha256;
      if (
        entree.preuve.data.transcriptSha256 !== transcriptSha256 ||
        entree.sujet.sha256 !== transcriptSha256
      ) {
        refuser(`preuve « ${id} » divergente du transcript installé`);
      }
      const observation = {
        resultat: entree.preuve.result,
        methodes: exigerMethodesAccessibilite(
          entree.preuve.data.methodes,
          `${id}.data.methodes`,
        ),
      };
      if (critere === "lecteur-ecran") {
        observation.technologie = exigerChaine(
          entree.preuve.data.technologie,
          `${id}.data.technologie`,
        );
      }
      matrice[critere] = observation;
    }
    const resultatId = `accessibilite/${plateforme}/resultat`;
    const resultat = citer(resultatId);
    exigerPlateforme(resultat.preuve, plateforme, resultatId);
    const transcriptSha256 = artefacts.find(
      (artefact) => artefact.plateforme === plateforme,
    )?.transcriptSha256;
    if (
      resultat.preuve.data.transcriptSha256 !== transcriptSha256 ||
      resultat.sujet.sha256 !== transcriptSha256
    ) {
      refuser(`preuve « ${resultatId} » divergente du transcript installé`);
    }
    return {
      plateforme,
      matrice,
      resultat: {
        resultat: resultat.preuve.result,
        methodes: exigerMethodesAccessibilite(
          resultat.preuve.data.methodes,
          `${resultatId}.data.methodes`,
        ),
        technologieLecteurEcran: exigerChaine(
          resultat.preuve.data.technologieLecteurEcran,
          `${resultatId}.data.technologieLecteurEcran`,
        ),
      },
    };
  });

  const goldens = [...chargees.keys()]
    .filter((id) => id.startsWith("golden/"))
    .sort()
    .map((id) => {
      const entree = citer(id);
      const test = exigerChaine(entree.preuve.data.test, `${id}.test`);
      if (id !== `golden/${test}`) {
        refuser(`preuve « ${id} » avec coordonnée golden divergente`);
      }
      return {
        test,
        verdict: exigerChaine(entree.preuve.data.verdict, `${id}.verdict`),
      };
    });
  if (goldens.length === 0) refuser("aucune preuve golden/retrait");

  const retraitDiff = citer("retrait/diff");
  const retraitVerdicts = citer("retrait/verdicts");
  const lignes = retraitDiff.preuve.data.lignes;
  if (!Array.isArray(lignes)) refuser("preuve retrait/diff sans lignes");
  const verdictsExecutes = retraitDiff.preuve.data.verdictsExecutes;
  if (!Number.isInteger(verdictsExecutes) || verdictsExecutes < 1) {
    refuser("preuve retrait/diff sans verdict réellement exécuté");
  }
  if (retraitVerdicts.preuve.result !== "vert") {
    refuser("preuve retrait/verdicts non verte");
  }

  const scans = Object.fromEntries(
    SCANS_LEGACY.map((cible) => {
      const entree = citer(`scan/${cible}`);
      return [
        cible,
        { resultat: entree.preuve.result, empreinte: entree.sujet.sha256 },
      ];
    }),
  );
  const gates = Object.fromEntries(
    PREUVES_OBLIGATOIRES.map((gate) => {
      const entree = citer(`gate/${gate}`);
      return [
        gate,
        { resultat: entree.preuve.result, sha: entree.preuve.candidateSha },
      ];
    }),
  );

  finir();
  return {
    version: 1,
    "checkpoint-recuperation": CHECKPOINT_RECUPERATION,
    "baseline-buzz": BASELINE_BUZZ,
    candidat: { sha: candidat.candidateSha, tranche: candidat.data.tranche },
    profil: {
      id: profil.id,
      materiau: "cloudflare/promotion-profiles.json",
      "materiau-sha256": profilEntree.sujet.sha256,
    },
    liaison: {
      canal: "punks-desktop",
      artefacts,
      staging: {
        environnement: staging.environnement,
        compte: staging.compte,
        zone: staging.zone,
        deploiement: staging.deploiement,
        "deploiement-preuve-sha256": stagingDeploiement.sujet.sha256,
        materiau: staging.materiau,
        "materiau-sha256": stagingEntree.preuve.data.subjectSha256,
        workers: workersDeployes,
        autorites,
      },
      "digests-production": digestsProduction,
      "digests-preuves-promotion": promotionEvidenceDigests,
      registres,
    },
    parcours: {
      contour,
      serveurVite,
      facadeTest,
      recits: [...recits],
      executions,
    },
    fautes,
    recuperation,
    accessibilite,
    goldens,
    retrait: {
      diff: retraitDiff.sujet.sha256,
      "verdicts-executes": verdictsExecutes,
      lignes,
    },
    scans,
    gates,
    preuves,
  };
}

/**
 * Assemble un dossier de promotion uniquement à partir de preuves locales,
 * content-addressées et vertes, produites pour le SHA et le staging attendus.
 */
export function assemblerDossierPromotion({
  racinePreuves,
  indexPreuves,
  candidatSha,
  promotionProfile,
  stagingDeploymentProof,
  provenanceBundle,
  repository,
  sourceRef,
  signerWorkflow,
  verifierProvenance,
  ghBinary = "gh",
}) {
  if (!SHA1_RE.test(candidatSha ?? "")) {
    refuser("SHA candidat exact de 40 hexadécimaux attendu");
  }
  exigerChaine(racinePreuves, "racine des preuves");
  exigerChaine(indexPreuves, "index des preuves");
  exigerChaine(promotionProfile, "matériau des profils de promotion");
  exigerChaine(stagingDeploymentProof, "preuve de déploiement staging");
  exigerChaine(provenanceBundle, "bundle de provenance Sigstore");
  exigerChaine(repository, "dépôt de provenance");
  exigerChaine(sourceRef, "ref source de provenance");
  exigerChaine(signerWorkflow, "workflow signataire de provenance");
  const deploiementStaging = chargerPreuveDeploiementStaging({
    racinePreuves,
    chemin: stagingDeploymentProof,
    candidatSha,
  });
  const deploiementId = deploiementStaging.preuve.deploymentId;
  const chargees = chargerPreuves({
    racinePreuves,
    indexPreuves,
    candidatSha,
    deploiementId,
  });
  const tranche = chargees.get("candidat")?.preuve?.data?.tranche;
  const profilPromotion = chargerProfilPromotion(promotionProfile, tranche);
  const dossier = construireDossier({
    chargees,
    deploiementStaging,
    profilPromotion,
    repository,
  });
  dossier.provenance = {
    schema: "punks.promotion-evidence-provenance.v1",
    repository,
    sourceRef,
    signerWorkflow,
    bundle: referenceFichierDansRacine(
      racinePreuves,
      provenanceBundle,
      "bundle de provenance Sigstore",
    ),
    index: referenceFichierDansRacine(
      racinePreuves,
      indexPreuves,
      "index de preuves",
    ),
  };
  const erreurs = validerDossier(dossier, {
    racinePreuves,
    verifierProvenance,
    ghBinary,
  });
  if (erreurs.length > 0) {
    refuser(
      `dossier incompatible avec validerDossier : ${erreurs.join(" ; ")}`,
    );
  }
  return dossier;
}

export function run(argv = process.argv.slice(2)) {
  return runPromotionDossierCli(argv, assemblerDossierPromotion);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    run();
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exitCode = 1;
  }
}
