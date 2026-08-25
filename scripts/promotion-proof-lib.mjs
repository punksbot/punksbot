/**
 * Lecture sûre et comparaison sémantique des preuves de promotion.
 *
 * Une empreinte seule prouve des octets, pas leur attribution. Ce module relit
 * donc chaque enveloppe content-addressée et vérifie que le SHA candidat, le
 * déploiement staging et la projection portée par le dossier sont exactement
 * ceux observés par le producteur de preuve.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  validateSigstoreBundleContent,
  verifyGithubSubject,
} from "./github-attestation-lib.mjs";
import { canonicalSha256 } from "./migration-manifest-lib.mjs";
import { validateInstalledTranscript } from "./promotion-installed-transcript-lib.mjs";
import {
  validateCandidateAggregateContent,
  validateDeployedWorkerDescriptors,
  validatePromotionProfilesContent,
  validateStagingMaterialContent,
} from "./promotion-materials-lib.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const PROVENANCE_SCHEMA = "punks.promotion-evidence-provenance.v1";
const INDEX_SCHEMA = "punks.promotion-evidence-index.v1";
const CANONICAL_REPOSITORY = "punksbot/punksbot";
const CANONICAL_SIGNER_WORKFLOW =
  "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml";

function estCheminCanonique(chemin) {
  return (
    typeof chemin === "string" &&
    chemin.length > 0 &&
    !chemin.includes("\\") &&
    !chemin.startsWith("/") &&
    chemin === chemin.trim() &&
    chemin
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function cheminEstDansRacine(racine, chemin) {
  const relatif = relative(racine, chemin);
  return relatif === "" || (!relatif.startsWith("..") && !isAbsolute(relatif));
}

function lireFichierReference(
  libelle,
  reference,
  racinePreuves,
  push,
  { nomContentAdresse = true } = {},
) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    push(`preuves : ${libelle} manquant`);
    return null;
  }
  if (
    typeof reference.sha256 !== "string" ||
    !SHA256_RE.test(reference.sha256)
  ) {
    push(`preuves : ${libelle} sans sha256 valide`);
    return null;
  }
  if (!estCheminCanonique(reference.chemin)) {
    push(
      `preuves : ${libelle} sans chemin local canonique — une copie locale content-addressée est exigée`,
    );
    return null;
  }
  if (reference.url !== undefined) {
    try {
      const url = new URL(reference.url);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== ""
      ) {
        throw new Error("URL non immuable");
      }
    } catch {
      push(
        `preuves : ${libelle} avec URL invalide — HTTPS sans identifiants ni fragment exigé`,
      );
      return null;
    }
  }
  if (typeof racinePreuves !== "string" || racinePreuves.trim() === "") {
    push(
      `preuves : ${libelle} invérifiable — racine locale des preuves manquante`,
    );
    return null;
  }

  let racineReelle;
  let cheminReel;
  const cheminDeclare = resolve(racinePreuves, reference.chemin);
  try {
    racineReelle = realpathSync(racinePreuves);
    const statutLien = lstatSync(cheminDeclare);
    if (statutLien.isSymbolicLink()) {
      push(`preuves : ${libelle} — lien symbolique interdit`);
      return null;
    }
    if (!statutLien.isFile()) {
      push(`preuves : ${libelle} — fichier régulier exigé`);
      return null;
    }
    cheminReel = realpathSync(cheminDeclare);
  } catch (erreur) {
    push(
      `preuves : ${libelle} illisible (${String(erreur?.code ?? "erreur")})`,
    );
    return null;
  }
  const cheminContentAdresse = resolve(racineReelle, reference.chemin);
  if (
    !cheminEstDansRacine(racineReelle, cheminReel) ||
    cheminReel !== cheminContentAdresse
  ) {
    push(
      `preuves : ${libelle} sort de la racine ou traverse un lien symbolique`,
    );
    return null;
  }
  if (
    nomContentAdresse &&
    !basename(reference.chemin).startsWith(reference.sha256)
  ) {
    push(
      `preuves : ${libelle} — chemin local non immuable : le nom doit être content-addressé par son sha256`,
    );
    return null;
  }

  let descripteur;
  try {
    descripteur = openSync(
      cheminDeclare,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const avant = fstatSync(descripteur, { bigint: true });
    const contenu = readFileSync(descripteur);
    const apres = fstatSync(descripteur, { bigint: true });
    if (
      avant.dev !== apres.dev ||
      avant.ino !== apres.ino ||
      avant.size !== apres.size ||
      avant.mtimeNs !== apres.mtimeNs
    ) {
      push(`preuves : ${libelle} modifié pendant sa vérification`);
      return null;
    }
    const sha256 = createHash("sha256").update(contenu).digest("hex");
    return { sha256, contenu, chemin: cheminDeclare };
  } catch (erreur) {
    push(
      `preuves : ${libelle} impossible à relire sans suivre de lien (${String(erreur?.code ?? "erreur")})`,
    );
    return null;
  } finally {
    if (descripteur !== undefined) {
      closeSync(descripteur);
    }
  }
}

/**
 * Relit un sujet brut content-addressé sans suivre de lien et recalcule son
 * empreinte. Le contenu retourné correspond aux octets effectivement lus.
 */
export function lireSujetLocal(identifiant, sujet, racinePreuves, push) {
  return lireFichierReference(
    `sujet de la preuve « ${identifiant} »`,
    sujet,
    racinePreuves,
    push,
  );
}

/**
 * Relit une preuve locale sans suivre de lien et recalcule son empreinte.
 *
 * Retourne `{ sha256, document }`, ou `null` après avoir transmis une erreur à
 * `push` lorsque la référence ne peut pas être vérifiée en sécurité.
 */
export function lirePreuveLocale(identifiant, preuve, racinePreuves, push) {
  const lue = lireFichierReference(
    `preuve « ${identifiant} »`,
    preuve,
    racinePreuves,
    push,
  );
  if (lue === null) return null;
  let document;
  try {
    document = JSON.parse(lue.contenu.toString("utf8"));
  } catch {
    push(`preuves : preuve « ${identifiant} » — JSON valide exigé`);
    return {
      sha256: lue.sha256,
      document: null,
      contenu: lue.contenu,
      chemin: lue.chemin,
    };
  }
  return {
    sha256: lue.sha256,
    document,
    contenu: lue.contenu,
    chemin: lue.chemin,
  };
}

function clesExactes(value, attendues) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actuelles = Object.keys(value).sort();
  const triees = [...attendues].sort();
  return (
    actuelles.length === triees.length &&
    actuelles.every((cle, index) => cle === triees[index])
  );
}

function referenceIndexDepuisDossier(identifiant, reference) {
  return {
    id: identifiant,
    chemin: reference.chemin,
    sha256: reference.sha256,
    sujet: reference.sujet,
  };
}

function estReferencePreuveFermee(reference) {
  if (
    reference === null ||
    typeof reference !== "object" ||
    Array.isArray(reference)
  ) {
    return false;
  }
  const cles = Object.keys(reference);
  return (
    ["chemin", "sha256", "subjectSha256", "sujet"].every((cle) =>
      cles.includes(cle),
    ) &&
    cles.every((cle) =>
      ["chemin", "sha256", "subjectSha256", "sujet", "url"].includes(cle),
    ) &&
    clesExactes(reference.sujet, ["chemin", "sha256"])
  );
}

/**
 * Vérifie que l'index, toutes les enveloppes et tous leurs sujets bruts ont
 * été attestés par le workflow canonique du dépôt pour le SHA exact.
 */
export function validerProvenanceDossier(dossier, contexte, push) {
  const provenance = dossier?.provenance;
  if (
    !clesExactes(provenance, [
      "schema",
      "repository",
      "sourceRef",
      "signerWorkflow",
      "bundle",
      "index",
    ])
  ) {
    push("provenance : déclaration GitHub/Sigstore complète exigée");
    return;
  }
  if (
    provenance.schema !== PROVENANCE_SCHEMA ||
    provenance.repository !== CANONICAL_REPOSITORY ||
    provenance.signerWorkflow !== CANONICAL_SIGNER_WORKFLOW ||
    !/^refs\/(heads|tags)\/[^\s]+$/.test(provenance.sourceRef ?? "") ||
    !SHA1_RE.test(dossier?.candidat?.sha ?? "")
  ) {
    push(
      "provenance : dépôt, workflow, ref et SHA GitHub Actions canoniques exigés",
    );
    return;
  }
  if (
    !clesExactes(provenance.bundle, ["chemin", "sha256"]) ||
    !clesExactes(provenance.index, ["chemin", "sha256"])
  ) {
    push("provenance : références fermées du bundle et de l'index exigées");
    return;
  }

  const racine = contexte?.racinePreuves;
  const bundle = lireFichierReference(
    "bundle Sigstore de provenance",
    provenance.bundle,
    racine,
    push,
    { nomContentAdresse: false },
  );
  const indexLu = lireFichierReference(
    "index attesté de preuves",
    provenance.index,
    racine,
    push,
    { nomContentAdresse: false },
  );
  if (bundle === null || indexLu === null) return;
  if (bundle.sha256 !== provenance.bundle.sha256) {
    push("provenance : hash du bundle Sigstore divergent");
    return;
  }
  if (indexLu.sha256 !== provenance.index.sha256) {
    push("provenance : hash de l'index attesté divergent");
    return;
  }
  try {
    validateSigstoreBundleContent(bundle.contenu);
  } catch (erreur) {
    push(
      `provenance : bundle Sigstore invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
    );
    return;
  }

  let index;
  try {
    index = JSON.parse(indexLu.contenu.toString("utf8"));
  } catch {
    push("provenance : index attesté non JSON");
    return;
  }
  if (
    !clesExactes(index, ["schema", "preuves"]) ||
    index.schema !== INDEX_SCHEMA ||
    !Array.isArray(index.preuves)
  ) {
    push("provenance : index attesté à schéma fermé invalide");
    return;
  }
  const preuves =
    dossier.preuves &&
    typeof dossier.preuves === "object" &&
    !Array.isArray(dossier.preuves)
      ? dossier.preuves
      : {};
  for (const [identifiant, reference] of Object.entries(preuves)) {
    if (!estReferencePreuveFermee(reference)) {
      push(
        `provenance : preuve « ${identifiant} » sans enveloppe et sujet fermés`,
      );
      return;
    }
  }
  const referencesAttendues = Object.entries(preuves)
    .map(([identifiant, reference]) =>
      referenceIndexDepuisDossier(identifiant, reference),
    )
    .sort((gauche, droite) => gauche.id.localeCompare(droite.id));
  const referencesIndex = [...index.preuves].sort((gauche, droite) =>
    String(gauche?.id).localeCompare(String(droite?.id)),
  );
  if (
    canonicalSha256(referencesIndex) !== canonicalSha256(referencesAttendues)
  ) {
    push(
      "provenance : l'index attesté ne correspond pas exactement aux preuves et sujets du dossier",
    );
    return;
  }

  const sujets = new Map([[indexLu.chemin, indexLu.contenu]]);
  const sujetsParId = new Map();
  for (const [identifiant, reference] of Object.entries(preuves)) {
    const enveloppe = lireFichierReference(
      `preuve « ${identifiant} »`,
      reference,
      racine,
      push,
    );
    const sujet = lireSujetLocal(identifiant, reference.sujet, racine, push);
    if (enveloppe === null || sujet === null) return;
    if (
      enveloppe.sha256 !== reference.sha256 ||
      sujet.sha256 !== reference.sujet.sha256 ||
      sujet.sha256 !== reference.subjectSha256
    ) {
      push(`provenance : preuve « ${identifiant} » ou sujet altéré`);
      return;
    }
    sujets.set(enveloppe.chemin, enveloppe.contenu);
    sujets.set(sujet.chemin, sujet.contenu);
    sujetsParId.set(identifiant, sujet);
  }

  const verifier = contexte?.verifierProvenance ?? verifyGithubSubject;
  if (typeof verifier !== "function") {
    push("provenance : vérificateur GitHub indisponible");
    return;
  }
  for (const [artifact, artifactContent] of [...sujets].sort(
    ([cheminGauche], [cheminDroite]) =>
      cheminGauche.localeCompare(cheminDroite),
  )) {
    try {
      verifier({
        artifact,
        artifactContent,
        bundle: bundle.chemin,
        bundleContent: bundle.contenu,
        repository: provenance.repository,
        sourceSha: dossier.candidat.sha,
        sourceRef: provenance.sourceRef,
        signerWorkflow: provenance.signerWorkflow,
        ghBinary: contexte?.ghBinary ?? "gh",
      });
    } catch (erreur) {
      push(
        `provenance : vérification GitHub refusée pour ${basename(artifact)} (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
      return;
    }
  }

  const bundleProduction = sujetsParId.get("production/bundle");
  if (bundleProduction === undefined) {
    push("provenance : bundle Sigstore original de production manquant");
    return;
  }
  try {
    validateSigstoreBundleContent(bundleProduction.contenu);
  } catch (erreur) {
    push(
      `provenance : bundle Sigstore original de production invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
    );
    return;
  }
  const sujetsProduction = [
    "production/manifeste",
    ...Object.keys(preuves).filter((identifiant) =>
      /^artefact\/[^/]+\/(bundle|signature)$/.test(identifiant),
    ),
  ];
  for (const identifiant of sujetsProduction.sort()) {
    const sujet = sujetsParId.get(identifiant);
    if (sujet === undefined) {
      push(
        `provenance : sujet original de production « ${identifiant} » manquant`,
      );
      return;
    }
    try {
      verifier({
        artifact: sujet.chemin,
        artifactContent: sujet.contenu,
        bundle: bundleProduction.chemin,
        bundleContent: bundleProduction.contenu,
        repository: provenance.repository,
        sourceSha: dossier.candidat.sha,
        sourceRef: provenance.sourceRef,
        signerWorkflow: provenance.signerWorkflow,
        ghBinary: contexte?.ghBinary ?? "gh",
      });
    } catch (erreur) {
      push(
        `provenance : attestation originale de production refusée pour « ${identifiant} » (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
      return;
    }
  }
}

/** Valide les octets bruts des sujets dont la sémantique est fermée. */
export function validerSujetPreuve(
  identifiant,
  sujetLocal,
  document,
  dossier,
  push,
) {
  if (!sujetLocal?.contenu || sujetLocal.contenu.length === 0) {
    push(`preuves : preuve « ${identifiant} » — sujet brut vide`);
    return;
  }
  if (identifiant === "profil/promotion") {
    try {
      const profil = validatePromotionProfilesContent(sujetLocal.contenu, {
        tranche: dossier.candidat?.tranche,
      });
      const autorites = profil.authorities.map(({ id }) => id);
      const workers = validateDeployedWorkerDescriptors(
        dossier.liaison?.staging?.workers,
      );
      const nomsWorkers = workers.map(({ name }) => name);
      if (
        profil.id !== dossier.profil?.id ||
        sujetLocal.sha256 !== dossier.profil?.["materiau-sha256"] ||
        !memesDonneesJson(profil.stories, dossier.parcours?.recits) ||
        !memesDonneesJson(autorites, dossier.liaison?.staging?.autorites) ||
        profil.authorities.some(({ worker }) => !nomsWorkers.includes(worker))
      ) {
        throw new Error("profil, récits ou autorités divergents");
      }
    } catch (erreur) {
      push(
        `preuves : preuve « profil/promotion » — matériau invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    return;
  }
  if (identifiant === "staging/materiau") {
    try {
      const materiau = validateStagingMaterialContent(sujetLocal.contenu);
      const staging = dossier.liaison?.staging;
      const workers = validateDeployedWorkerDescriptors(staging?.workers);
      if (
        materiau.environment !== staging?.environnement ||
        materiau.accountId !== staging?.compte ||
        materiau.zoneId !== staging?.zone ||
        !memesDonneesJson(
          [...materiau.workers].sort(),
          workers.map(({ name }) => name).sort(),
        )
      ) {
        throw new Error("identifiants ou Workers divergents");
      }
    } catch (erreur) {
      push(
        `preuves : preuve « staging/materiau » — matériau brut invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    return;
  }
  if (identifiant === "staging/deploiement") {
    try {
      const preuve = validateStagingDeploymentProof(
        JSON.parse(sujetLocal.contenu.toString("utf8")),
        {
          accountId: CANONICAL_STAGING_ACCOUNT_ID,
          environment: "staging",
          sourceSha: dossier.candidat.sha,
        },
      );
      if (
        preuve.deploymentId !== dossier.liaison?.staging?.deploiement ||
        sujetLocal.sha256 !==
          dossier.liaison?.staging?.["deploiement-preuve-sha256"] ||
        !memesDonneesJson(
          preuve.workers.map(({ name, versionId, deploymentId }) => ({
            name,
            versionId,
            deploymentId,
          })),
          dossier.liaison?.staging?.workers,
        )
      ) {
        push(
          "preuves : preuve « staging/deploiement » divergente du déploiement distant exact",
        );
      }
    } catch (erreur) {
      push(
        `preuves : preuve « staging/deploiement » distante invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    return;
  }
  if (identifiant === "production/bundle") {
    try {
      validateSigstoreBundleContent(sujetLocal.contenu);
    } catch (erreur) {
      push(
        `preuves : preuve « production/bundle » — bundle Sigstore original invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    return;
  }
  if (identifiant === "production/manifeste") {
    try {
      validateCandidateAggregateContent(sujetLocal.contenu, {
        candidateSha: dossier.candidat?.sha,
        stagingDeploymentId: dossier.liaison?.staging?.deploiement,
        stagingProofSha256:
          dossier.liaison?.staging?.["deploiement-preuve-sha256"],
        repository: dossier.provenance?.repository,
        artifacts: dossier.liaison?.artefacts,
      });
    } catch (erreur) {
      push(
        `preuves : preuve « production/manifeste » — agrégat original divergent (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    return;
  }
  const reobservation = /^staging\/reobservation\/([^/]+)$/.exec(identifiant);
  if (reobservation) {
    try {
      const plateforme = reobservation[1];
      const staging = dossier.liaison?.staging;
      const workers = validateDeployedWorkerDescriptors(staging?.workers);
      const preuve = validateStagingDeploymentProof(
        JSON.parse(sujetLocal.contenu.toString("utf8")),
        {
          accountId: CANONICAL_STAGING_ACCOUNT_ID,
          environment: "staging",
          sourceSha: dossier.candidat.sha,
        },
      );
      const transcriptSha256 = dossier.liaison?.artefacts?.find(
        (artefact) => artefact?.plateforme === plateforme,
      )?.transcriptSha256;
      if (
        document.plateforme !== plateforme ||
        sujetLocal.sha256 !== staging?.["deploiement-preuve-sha256"] ||
        preuve.deploymentId !== staging?.deploiement ||
        document.data.transcriptSha256 !== transcriptSha256 ||
        document.data.initialStagingProofSha256 !==
          staging?.["deploiement-preuve-sha256"] ||
        document.data.deploymentId !== staging?.deploiement ||
        !memesDonneesJson(document.data.workers, workers) ||
        !memesDonneesJson(document.data.sequence, [
          "transcript-installed",
          "cloudflare-reobserved",
        ])
      ) {
        throw new Error("réobservation post-parcours divergente");
      }
    } catch (erreur) {
      push(
        `preuves : preuve « ${identifiant} » — réobservation Cloudflare post-parcours invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
  }
  const transcript = /^transcript\/([^/]+)$/.exec(identifiant);
  if (transcript) {
    try {
      const observation = JSON.parse(sujetLocal.contenu.toString("utf8"));
      const workers = validateDeployedWorkerDescriptors(
        dossier.liaison?.staging?.workers,
      );
      const artefact = dossier.liaison?.artefacts?.find(
        (entree) => entree?.plateforme === transcript[1],
      );
      validateInstalledTranscript(observation, {
        platform: transcript[1],
        candidateSha: dossier.candidat.sha,
        stagingDeploymentId: dossier.liaison?.staging?.deploiement,
        deployedWorkers: workers,
        artifactSha256: artefact?.sha256,
      });
    } catch (erreur) {
      push(
        `preuves : preuve « ${identifiant} » — transcript brut installé invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
  }
  if (document.data.subjectSha256 !== sujetLocal.sha256) {
    push(`preuves : preuve « ${identifiant} » — sujet brut non attribué`);
  }
}

function memesDonneesJson(gauche, droite) {
  if (gauche === undefined || droite === undefined) {
    return false;
  }
  try {
    return canonicalSha256(gauche) === canonicalSha256(droite);
  } catch {
    return false;
  }
}

/**
 * Compare les observations d'une enveloppe de preuve à leur projection exacte
 * dans le dossier final et transmet toute divergence à `push`.
 */
export function validerProjectionPreuve(identifiant, document, dossier, push) {
  const data = document.data;
  const diverge = (libelle) =>
    push(`preuves : preuve « ${identifiant} » divergente de ${libelle}`);

  if (identifiant === "candidat") {
    if (data.tranche !== dossier.candidat?.tranche) {
      diverge("l'identité du candidat");
    }
    return;
  }
  if (identifiant === "profil/promotion") {
    if (
      data.materiau !== dossier.profil?.materiau ||
      data.profil !== dossier.profil?.id ||
      data.tranche !== dossier.candidat?.tranche ||
      data.subjectSha256 !== dossier.profil?.["materiau-sha256"] ||
      !memesDonneesJson(data.recits, dossier.parcours?.recits) ||
      !memesDonneesJson(data.autorites, dossier.liaison?.staging?.autorites)
    ) {
      diverge("du profil de promotion fermé");
    }
    return;
  }
  if (identifiant === "registres") {
    if (!memesDonneesJson(data.registres, dossier.liaison?.registres)) {
      diverge("la liste des registres");
    }
    return;
  }
  if (identifiant === "staging/materiau") {
    const staging = dossier.liaison?.staging;
    if (
      data.environnement !== staging?.environnement ||
      data.compte !== staging?.compte ||
      data.zone !== staging?.zone ||
      data.deploiement !== staging?.deploiement ||
      data.materiau !== staging?.materiau ||
      data.subjectSha256 !== staging?.["materiau-sha256"] ||
      !memesDonneesJson(
        data.workers,
        staging?.workers?.map(({ name }) => name),
      )
    ) {
      diverge("l'identité du staging exact");
    }
    return;
  }
  if (identifiant === "staging/deploiement") {
    const staging = dossier.liaison?.staging;
    if (
      data.compte !== staging?.compte ||
      data.environnement !== staging?.environnement ||
      data.deploiement !== staging?.deploiement ||
      data.subjectSha256 !== staging?.["deploiement-preuve-sha256"] ||
      !memesDonneesJson(
        data.workers,
        staging?.workers?.map(({ name }) => name),
      )
    ) {
      diverge("la preuve du déploiement staging distant exact");
    }
    return;
  }

  const transcript = /^transcript\/([^/]+)$/.exec(identifiant);
  if (transcript) {
    const artefactAttendu = dossier.liaison?.artefacts?.find(
      (entree) => entree?.plateforme === transcript[1],
    );
    if (
      document.plateforme !== transcript[1] ||
      data.plateforme !== transcript[1] ||
      data.schema !== "punks.installed-social-loop-transcript.v1" ||
      data.subjectSha256 !== artefactAttendu?.transcriptSha256
    ) {
      diverge("du transcript installé exact");
    }
    return;
  }

  const production = /^production\/(bundle|manifeste)$/.exec(identifiant);
  if (production) {
    if (
      data.subjectSha256 !==
      dossier.liaison?.["digests-production"]?.[production[1]]
    ) {
      diverge(`du digest production ${production[1]}`);
    }
    return;
  }

  const artefact =
    /^artefact\/([^/]+)\/(bundle|signature|verification\/([^/]+))$/.exec(
      identifiant,
    );
  if (artefact) {
    const [, plateforme, sorte] = artefact;
    const attendu = dossier.liaison?.artefacts?.find(
      (entree) => entree?.plateforme === plateforme,
    );
    if (document.plateforme !== plateforme) {
      diverge("la plateforme de l'artefact");
    } else if (data.transcriptSha256 !== attendu?.transcriptSha256) {
      diverge("son transcript installé content-addressé");
    } else if (
      sorte === "bundle" &&
      (data.nom !== attendu?.nom ||
        data.bundleId !== attendu?.identite?.bundleId ||
        data.subjectSha256 !== attendu?.sha256 ||
        data.taille !== attendu?.taille)
    ) {
      diverge("l'identité d'application et de l'artefact installés");
    } else if (
      sorte === "signature" &&
      (data.nom !== attendu?.signatureNom ||
        data.subjectSha256 !== attendu?.signature ||
        data.taille !== attendu?.signatureTaille)
    ) {
      diverge("la signature de l'artefact installé");
    } else if (
      sorte.startsWith("verification/") &&
      data.subjectSha256 !== attendu?.transcriptSha256
    ) {
      diverge("des octets du transcript installé");
    }
    return;
  }

  const parcours = /^parcours\/([^/]+)\/([^/]+)$/.exec(identifiant);
  if (parcours) {
    const [, plateforme, recit] = parcours;
    const artefactAttendu = dossier.liaison?.artefacts?.find(
      (entree) => entree?.plateforme === plateforme,
    );
    const execution = dossier.parcours?.executions?.find(
      (entree) => entree?.plateforme === plateforme && entree?.recit === recit,
    );
    if (document.plateforme !== plateforme) {
      diverge("la plateforme de l'exécution distribuée");
    } else if (data.transcriptSha256 !== artefactAttendu?.transcriptSha256) {
      diverge("son transcript installé content-addressé");
    } else if (data.subjectSha256 !== artefactAttendu?.transcriptSha256) {
      diverge("des octets du transcript installé");
    } else if (
      data.sha256Artefact !== execution?.sha256Artefact ||
      !memesDonneesJson(data.via, execution?.via) ||
      data.contour !== dossier.parcours?.contour ||
      data.serveurVite !== dossier.parcours?.serveurVite ||
      data.facadeTest !== dossier.parcours?.facadeTest
    ) {
      diverge("l'exécution distribuée du récit");
    }
    return;
  }

  const faute = /^faute\/([^/]+)\/([^/]+)$/.exec(identifiant);
  if (faute) {
    const scenario = dossier.fautes?.find(
      (entree) => entree?.type === faute[1] && entree?.autorite === faute[2],
    );
    const reference = dossier.preuves?.[identifiant];
    const artefact = dossier.liaison?.artefacts?.find(
      (entree) => entree?.plateforme === scenario?.plateforme,
    );
    if (
      scenario?.preuveSha256 !== reference?.sha256 ||
      document.plateforme !== scenario?.plateforme ||
      data.plateforme !== scenario?.plateforme ||
      data.autorite !== scenario?.autorite ||
      data.executionId !== scenario?.executionId ||
      data.sha256Artefact !== scenario?.sha256Artefact ||
      data.transcriptSha256 !== scenario?.transcriptSha256 ||
      data.captureSha256 !== scenario?.captureSha256 ||
      data.captureSha256 !== reference?.subjectSha256 ||
      data.sha256Artefact !== artefact?.sha256 ||
      data.transcriptSha256 !== artefact?.transcriptSha256
    ) {
      diverge("la faute injectée et de son autorité");
    }
    return;
  }

  const recuperation = /^recuperation\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    identifiant,
  );
  if (recuperation) {
    const [, nom, type, autorite] = recuperation;
    const scenario = dossier.recuperation?.scenarios?.find(
      (entree) => entree?.type === type && entree?.autorite === autorite,
    );
    const preuve = scenario?.preuves?.[nom];
    const reference = dossier.preuves?.[identifiant];
    if (
      preuve?.preuveSha256 !== reference?.sha256 ||
      document.plateforme !== scenario?.plateforme ||
      data.type !== scenario?.type ||
      data.autorite !== scenario?.autorite ||
      data.plateforme !== scenario?.plateforme ||
      data.executionId !== scenario?.executionId ||
      data.fauteSha256 !== scenario?.fauteSha256 ||
      data.sha256Artefact !== scenario?.sha256Artefact ||
      data.captureSha256 !== scenario?.captureSha256 ||
      document.result !== preuve?.resultat ||
      data.subjectSha256 !== preuve?.subjectSha256 ||
      data.subjectSha256 !== reference?.subjectSha256
    ) {
      diverge("du lien causal faute → récupération");
    }
    return;
  }

  if (identifiant === "recuperation/captures") {
    const captures = dossier.recuperation?.scenarios?.map(
      ({ type, autorite, captureSha256 }) => ({
        type,
        autorite,
        captureSha256,
      }),
    );
    if (
      !memesDonneesJson(data.captures, captures) ||
      data.subjectSha256 !== dossier.recuperation?.captures
    ) {
      diverge("des captures causales de faute");
    }
    return;
  }

  const accessibilite = /^accessibilite\/([^/]+)\/([^/]+)$/.exec(identifiant);
  if (accessibilite) {
    const [, plateforme, critere] = accessibilite;
    const artefactAttendu = dossier.liaison?.artefacts?.find(
      (entree) => entree?.plateforme === plateforme,
    );
    const entree = dossier.accessibilite?.find(
      (candidate) => candidate?.plateforme === plateforme,
    );
    const observation =
      critere === "resultat" ? entree?.resultat : entree?.matrice?.[critere];
    if (document.plateforme !== plateforme) {
      diverge("la plateforme d'accessibilité");
    } else if (data.transcriptSha256 !== artefactAttendu?.transcriptSha256) {
      diverge("son transcript installé content-addressé");
    } else if (data.subjectSha256 !== artefactAttendu?.transcriptSha256) {
      diverge("des octets du transcript installé");
    } else if (
      !memesDonneesJson(data.methodes, observation?.methodes) ||
      (critere === "lecteur-ecran" &&
        data.technologie !== observation?.technologie) ||
      (critere === "resultat" &&
        data.technologieLecteurEcran !== observation?.technologieLecteurEcran)
    ) {
      diverge("les méthodes d'accessibilité");
    }
    return;
  }

  if (identifiant.startsWith("golden/")) {
    const test = identifiant.slice("golden/".length);
    const golden = dossier.goldens?.find((entree) => entree?.test === test);
    if (data.test !== golden?.test || data.verdict !== golden?.verdict) {
      diverge("du verdict golden");
    }
    return;
  }

  if (
    identifiant === "retrait/diff" &&
    (!memesDonneesJson(data.lignes, dossier.retrait?.lignes) ||
      data.verdictsExecutes !== dossier.retrait?.["verdicts-executes"])
  ) {
    diverge("du diff de retrait");
  }
}
