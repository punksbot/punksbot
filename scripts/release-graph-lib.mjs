/**
 * Socle de validation du graphe de release Punks (issue #51).
 *
 * Le graphe scellé expansion → activation → contraction et le modèle
 * d'attestation immuable sont décidés par les issues #13, #14, #16 et #47
 * (§13 « Retrait, promotion et récupération », §14 ADR obligatoires), et
 * documentés par l'ADR docs/adr/0060-graphe-de-release-expansion-activation-
 * contraction.md.
 *
 * Règles matérialisées ici :
 *   - chaque candidat relie explicitement registre des contrats, schémas,
 *     artefacts générés, profil, registre des goldens, manifeste de retrait,
 *     staging et artefacts distribués (versions ET hashes) ;
 *   - le registre peut préparer les lignes de retrait dans le candidat source,
 *     mais aucun candidat ne quitte l'état « preparation » sans les preuves
 *     obligatoires ET le retrait associé rattachés au même SHA ;
 *   - N et N−1 restent supportés au moins 90 jours ; la contraction exige
 *     moins de 1 % d'usage pendant 14 jours consécutifs ;
 *   - l'attestation contient le SHA, le checkpoint de baseline, les versions
 *     et hashes des registres, les identifiants de staging et les résultats
 *     des gates ;
 *   - attestations et Reçus sont immuables, publiés avec la release et dans
 *     le stockage R2 prévu (create-only, verrouillage d'objet, deux comptes) ;
 *   - le roll-forward est la récupération normale, un retour à une version
 *     Punks antérieure exige un certificat de compatibilité exact, et aucun
 *     retour vers Buzz n'existe dans le vocabulaire fermé du graphe.
 *
 * Utilisé par scripts/check-release-graph.mjs (gate) et ses tests.
 */
import {
  BASELINE_BUZZ,
  baseMatches,
  CHECKPOINT_RECUPERATION,
  parseChemin,
} from "./migration-manifest-lib.mjs";

export const ETATS = [
  "preparation",
  "expansion",
  "active",
  "contraction",
  "contractee",
];

/** Chaîne append-only des transitions au-delà de « preparation ». */
export const CHAINE_TRANSITIONS = [
  "expansion",
  "active",
  "contraction",
  "contractee",
];

export const FENETRE_SUPPORT_JOURS = 90;
export const SEUIL_USAGE_CONTRACTION = 1;
export const FENETRE_CONTRACTION_JOURS = 14;
export const JOUR_MS = 86400000;

export const PUBLICATION = ["release", "r2"];
export const ECRITURE_IMMUABLE = "create-only";
export const VERROUILLAGE_OBJET = "compliance";
export const COMPTES_R2 = 2;

export const RECUPERATION_NORMALE = "roll-forward";
export const RETOUR_PUNKS = "certificat-compatibilite-exige";
export const RETOUR_BUZZ = "interdit";
export const TYPES_RECUPERATION = ["roll-forward", "retour-punks"];

export const PREUVES_OBLIGATOIRES = [
  "corpus-conformite",
  "suites-workers",
  "cloudflare-check",
  "playwright-facade",
  "tauri-staging",
  "accessibilite",
  "fautes-injectees",
  "retrait-diff",
  "goldens-verdict",
  "scans-negatifs",
];

export const PLATEFORMES = [
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
];

export const MATERIAUX = [
  "registre-contrats",
  "schemas",
  "generes",
  "profil",
  "registre-goldens",
  "manifeste-retrait",
];

export const NOMS_REGISTRES_ATTESTATION = [
  "registre-contrats",
  "profil",
  "registre-goldens",
  "manifeste-retrait",
];

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRANCHE_ID_RE = /^tranche:([0-9]+)$/;

/** Date « YYYY-MM-DD » → millisecondes UTC, ou null si invalide. */
export function parseDate(valeur) {
  if (typeof valeur !== "string" || !DATE_RE.test(valeur)) {
    return null;
  }
  const ms = Date.parse(`${valeur}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function listeEgale(recue, attendue) {
  return (
    Array.isArray(recue) &&
    recue.length === attendue.length &&
    attendue.every((v, i) => recue[i] === v)
  );
}

function estSha256(valeur) {
  return typeof valeur === "string" && SHA256_RE.test(valeur);
}

function estCheminGitCanonique(chemin) {
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

function rangEtat(etat) {
  return ETATS.indexOf(etat);
}

/**
 * Valide le document docs/migration/release-graph.yaml.
 *
 * `contexte` (toutes les clés facultatives) relie le graphe au dépôt réel :
 *   - hashes : hashes vivants des matériaux (vérifiés sur les candidats en
 *     preparation ; les releases scellées restent figées) ;
 *   - stagingIds : { compte, zone } du matériau de staging réel ;
 *   - ledgerRetraits : lignes retraits-par-tranche du registre des goldens ;
 *   - manifestActifs : entrées { chemin, verdict } du manifeste de retrait ;
 *   - trackedFiles : fichiers suivis (preuve du retrait physique) ;
 *   - fileExists : résout les références d'ADR.
 *
 * Retourne un tableau de messages d'erreur (vide = valide).
 */
export function validateReleaseGraph(graph, contexte = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  const ledgerRetraits = Array.isArray(contexte.ledgerRetraits)
    ? contexte.ledgerRetraits
    : null;
  const manifestActifs = Array.isArray(contexte.manifestActifs)
    ? contexte.manifestActifs
    : null;
  const trackedFiles = Array.isArray(contexte.trackedFiles)
    ? new Set(contexte.trackedFiles)
    : null;
  const fileExists = contexte.fileExists ?? (() => false);

  if (!graph || typeof graph !== "object" || !Number.isInteger(graph.version)) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (graph.version !== 1) {
    push(`en-tête invalide : version non supportée ${graph.version}`);
  }
  if (graph["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (graph["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }

  validerPolitique(graph.politique, push);
  validerEtatEtTransitions(graph, push);
  validerReferences(graph.references, fileExists, push);
  validerPublication(graph.publication, push);

  const releases = validerReleases(graph, contexte, push);
  validerRecuperations(graph.recuperations, releases, push);
  validerLiaisonRegistre(releases, ledgerRetraits, push);
  validerLiaisonManifeste(releases, manifestActifs, trackedFiles, push);

  return errors;
}

function validerPolitique(politique, push) {
  if (!politique || typeof politique !== "object") {
    push("politique manquante");
    return;
  }
  if (politique["fenetre-support-jours"] !== FENETRE_SUPPORT_JOURS) {
    push(
      `politique : fenetre-support-jours doit être exactement ${FENETRE_SUPPORT_JOURS} jours (#47 §13.6)`,
    );
  }
  if (politique["seuil-usage-contraction"] !== SEUIL_USAGE_CONTRACTION) {
    push(
      `politique : seuil-usage-contraction doit être exactement ${SEUIL_USAGE_CONTRACTION} %`,
    );
  }
  if (
    politique["fenetre-mesure-contraction-jours"] !== FENETRE_CONTRACTION_JOURS
  ) {
    push(
      `politique : fenetre-mesure-contraction-jours doit être exactement ${FENETRE_CONTRACTION_JOURS} jours`,
    );
  }
  const recuperation = politique.recuperation;
  if (!recuperation || typeof recuperation !== "object") {
    push("politique : recuperation manquante");
  } else {
    if (recuperation.normale !== RECUPERATION_NORMALE) {
      push(
        "politique : recuperation.normale doit être roll-forward — le roll-forward est la récupération normale",
      );
    }
    if (recuperation["retour-punks-anterieur"] !== RETOUR_PUNKS) {
      push(
        "politique : recuperation.retour-punks-anterieur doit exiger un certificat de compatibilité",
      );
    }
    if (recuperation["retour-buzz"] !== RETOUR_BUZZ) {
      push(
        "politique : recuperation.retour-buzz doit être interdit — aucun retour vers Buzz n'est possible",
      );
    }
  }
  if (politique["rpo-logique-nul"] !== true) {
    push("politique : rpo-logique-nul doit être vrai");
  }
  const immuabilite = politique.immuabilite;
  if (!immuabilite || typeof immuabilite !== "object") {
    push("politique : immuabilite manquante");
    return;
  }
  for (const sorte of ["attestations", "recus"]) {
    const regles = immuabilite[sorte];
    if (!regles || typeof regles !== "object") {
      push(`politique : immuabilite.${sorte} manquante`);
      continue;
    }
    if (!listeEgale(regles.publication, PUBLICATION)) {
      push(
        `politique : immuabilite.${sorte}.publication doit être exactement [${PUBLICATION.join(", ")}] — publiés avec la release ET dans le stockage R2 prévu`,
      );
    }
    if (regles.ecriture !== ECRITURE_IMMUABLE) {
      push(
        `politique : immuabilite.${sorte}.ecriture doit être ${ECRITURE_IMMUABLE}`,
      );
    }
    if (regles["verrouillage-objet"] !== VERROUILLAGE_OBJET) {
      push(
        `politique : immuabilite.${sorte}.verrouillage-objet doit être ${VERROUILLAGE_OBJET}`,
      );
    }
    if (regles["comptes-r2"] !== COMPTES_R2) {
      push(
        `politique : immuabilite.${sorte}.comptes-r2 doit être ${COMPTES_R2} (contenus R2 critiques sur deux comptes)`,
      );
    }
  }
}

function validerEtatEtTransitions(graph, push) {
  if (!listeEgale(graph.etats, ETATS)) {
    push(
      `etats doit être exactement [${ETATS.join(", ")}] (vocabulaire fermé)`,
    );
  }
  const attendues = CHAINE_TRANSITIONS.map((vers, index) => ({
    de: ETATS[index],
    vers,
  }));
  const transitions = Array.isArray(graph.transitions) ? graph.transitions : [];
  if (transitions.length !== attendues.length) {
    push("transitions : exactement quatre transitions scellées attendues");
    return;
  }
  transitions.forEach((t, i) => {
    if (!t || t.de !== attendues[i].de || t.vers !== attendues[i].vers) {
      push(
        `transitions #${i + 1} : attendue { de: ${attendues[i].de}, vers: ${attendues[i].vers} }`,
      );
    }
  });
  if (!listeEgale(graph["preuves-obligatoires"], PREUVES_OBLIGATOIRES)) {
    push(
      `preuves-obligatoires doit être exactement [${PREUVES_OBLIGATOIRES.join(", ")}]`,
    );
  }
  if (!listeEgale(graph.plateformes, PLATEFORMES)) {
    push(`plateformes doit être exactement [${PLATEFORMES.join(", ")}]`);
  }
}

function validerReferences(references, fileExists, push) {
  if (!references || typeof references !== "object") {
    push("references manquantes (spec, décisions, ADR du graphe de release)");
    return;
  }
  if (references.spec !== 47) {
    push("references : spec doit être 47 (programme de récupération)");
  }
  const decisions = references.decisions;
  if (!listeEgale(decisions, [13, 14, 16, 17])) {
    push("references : decisions doit être exactement [13, 14, 16, 17]");
  }
  const adr = references.adr;
  if (!Array.isArray(adr) || adr.length === 0) {
    push("references : l'ADR du graphe de release doit être citée");
    return;
  }
  for (const chemin of adr) {
    if (!estCheminGitCanonique(chemin) || !fileExists(chemin)) {
      push(`references : ADR introuvable — ${String(chemin)}`);
    }
  }
}

function validerPublication(publication, push) {
  const layout = publication?.r2?.layout;
  if (!layout || typeof layout !== "object") {
    push("publication : layout R2 manquant (attestations et Reçus)");
    return;
  }
  for (const sorte of ["attestations", "recus"]) {
    const motif = layout[sorte];
    if (
      typeof motif !== "string" ||
      !motif.includes("{canal}") ||
      !motif.includes("{id}") ||
      !motif.startsWith("releases/")
    ) {
      push(
        `publication : layout R2 de ${sorte} doit démarrer sous releases/ et citer {canal} et {id}`,
      );
    }
  }
}

function validerMateriaux(materiaux, release, hashes, push) {
  if (!materiaux || typeof materiaux !== "object") {
    push(`${release.id} : materiaux manquants`);
    return;
  }
  for (const nom of MATERIAUX) {
    const materiel = materiaux[nom];
    if (!materiel || typeof materiel !== "object") {
      push(`${release.id} : materiaux.${nom} manquant`);
      continue;
    }
    if (!Number.isInteger(materiel.version) || materiel.version < 1) {
      push(`${release.id} : materiaux.${nom}.version entière ≥ 1 attendue`);
    }
    if (!estSha256(materiel.sha256)) {
      push(`${release.id} : materiaux.${nom}.sha256 invalide`);
    } else if (
      release.etat === "preparation" &&
      hashes &&
      hashes[nom] !== undefined &&
      materiel.sha256 !== hashes[nom]
    ) {
      push(
        `${release.id} : materiaux.${nom}.sha256 ne correspond pas au dépôt courant — le candidat en préparation doit rester relié aux artefacts réels`,
      );
    }
  }
  if (
    typeof materiaux.profil?.id !== "string" ||
    materiaux.profil.id.trim() === ""
  ) {
    push(`${release.id} : materiaux.profil.id manquant`);
  }
}

function validerStaging(staging, release, hashes, stagingIds, push) {
  if (!staging || typeof staging !== "object") {
    push(`${release.id} : staging manquant`);
    return;
  }
  if (staging.environnement !== "staging") {
    push(`${release.id} : staging.environnement doit être staging`);
  }
  for (const cle of ["compte", "zone"]) {
    if (!/^[0-9a-f]{32}$/.test(staging[cle] ?? "")) {
      push(`${release.id} : staging.${cle} (identifiant hexadécimal) manquant`);
    }
  }
  if (
    staging.materiau !== "cloudflare/staging.resources.json" ||
    !estSha256(staging["materiau-sha256"])
  ) {
    push(
      `${release.id} : staging.materiau/-sha256 invalides ( matériau de staging isolé exigé)`,
    );
  } else if (
    release.etat === "preparation" &&
    hashes &&
    hashes.staging !== undefined &&
    staging["materiau-sha256"] !== hashes.staging
  ) {
    push(
      `${release.id} : staging.materiau-sha256 ne correspond pas au matériau de staging courant`,
    );
  }
  if (
    release.etat === "preparation" &&
    stagingIds &&
    (staging.compte !== stagingIds.compte || staging.zone !== stagingIds.zone)
  ) {
    push(
      `${release.id} : identifiants de staging (compte/zone) ne correspondent pas au matériau réel`,
    );
  }
  if (release.etat === "preparation" && staging.deploiement !== null) {
    push(
      `${release.id} : un candidat en preparation ne déclare pas de déploiement de staging`,
    );
  }
  if (
    release.etat !== "preparation" &&
    typeof staging.deploiement !== "string"
  ) {
    push(
      `${release.id} : déploiement de staging exact manquant (identifiant requis hors preparation)`,
    );
  }
}

function validerArtefacts(artefacts, release, push) {
  if (!Array.isArray(artefacts)) {
    push(`${release.id} : artefacts attendus (éventuellement vides)`);
    return;
  }
  if (release.etat === "preparation") {
    if (artefacts.length > 0) {
      push(
        `${release.id} : un candidat en preparation ne distribue pas encore d'artefacts`,
      );
    }
    return;
  }
  const vues = new Set();
  for (const artefact of artefacts) {
    if (!artefact || typeof artefact !== "object") {
      push(`${release.id} : artefact malformé`);
      continue;
    }
    if (!PLATEFORMES.includes(artefact.plateforme)) {
      push(
        `${release.id} : plateforme inconnue « ${String(artefact.plateforme)} » (attendu ${PLATEFORMES.join(", ")})`,
      );
      continue;
    }
    if (vues.has(artefact.plateforme)) {
      push(
        `${release.id} : plateforme ${artefact.plateforme} distribuée deux fois`,
      );
    }
    vues.add(artefact.plateforme);
    if (typeof artefact.nom !== "string" || artefact.nom.trim() === "") {
      push(`${release.id} : artefact ${artefact.plateforme} sans nom`);
    }
    if (!estSha256(artefact.sha256)) {
      push(
        `${release.id} : artefact ${artefact.plateforme} sans sha256 valide`,
      );
    }
    if (!estSha256(artefact.signature)) {
      push(
        `${release.id} : artefact ${artefact.plateforme} sans signature valide`,
      );
    }
  }
  for (const plateforme of PLATEFORMES) {
    if (!vues.has(plateforme)) {
      push(
        `${release.id} : artefact distribué manquant pour ${plateforme} (matrice de distribution exigée)`,
      );
    }
  }
}

function validerPreuves(preuves, release, push) {
  const scellee = release.etat !== "preparation";
  if (!scellee) {
    if (preuves && Object.keys(preuves).length > 0) {
      push(
        `${release.id} : un candidat en preparation ne déclare pas de résultats de gates`,
      );
    }
    return;
  }
  if (!preuves || typeof preuves !== "object") {
    push(
      `${release.id} : preuves manquantes — l'activation est impossible sans dossier de preuve complet`,
    );
    return;
  }
  for (const cle of Object.keys(preuves)) {
    if (!PREUVES_OBLIGATOIRES.includes(cle)) {
      push(`${release.id} : preuve inconnue « ${cle} » (vocabulaire fermé)`);
    }
  }
  for (const cle of PREUVES_OBLIGATOIRES) {
    const preuve = preuves[cle];
    if (!preuve || typeof preuve !== "object") {
      push(
        `${release.id} : preuve obligatoire « ${cle} » manquante — l'activation est impossible`,
      );
      continue;
    }
    if (preuve.resultat !== "vert") {
      push(
        `${release.id} : preuve « ${cle} » non verte (résultat ${String(preuve.resultat)})`,
      );
    }
    if (preuve.sha !== release.sha) {
      push(
        `${release.id} : preuve « ${cle} » rattachée au SHA ${String(preuve.sha)} — les preuves obligatoires doivent être rattachées au même candidat (${String(release.sha)})`,
      );
    }
  }
}

function validerRetrait(retrait, release, lignesAttendues, push) {
  if (release.etat === "preparation") {
    if (retrait !== null && retrait !== undefined) {
      push(
        `${release.id} : un candidat en preparation n'a pas encore retiré de chemin Buzz`,
      );
    }
    return;
  }
  if (!retrait || typeof retrait !== "object") {
    push(
      `${release.id} : retrait associé manquant — l'activation est impossible tant que le retrait n'est pas rattaché au même candidat`,
    );
    return;
  }
  if (
    !Array.isArray(retrait["lignes-registre"]) ||
    retrait["lignes-registre"].some((l) => !estCheminGitCanonique(l))
  ) {
    push(
      `${release.id} : retrait.lignes-registre doit citer les tests Buzz retirés par ce candidat (chemins canoniques)`,
    );
  }
  if (
    !Number.isInteger(retrait["verdicts-manifeste"]) ||
    retrait["verdicts-manifeste"] < 1
  ) {
    push(
      `${release.id} : retrait.verdicts-manifeste (nombre d'actifs retirés par ce candidat) manquant`,
    );
  }
  if (lignesAttendues !== null) {
    const attendues = lignesAttendues;
    const recues = Array.isArray(retrait["lignes-registre"])
      ? retrait["lignes-registre"]
      : [];
    const manquantes = attendues.filter((l) => !recues.includes(l));
    const inconnues = recues.filter((l) => !attendues.includes(l));
    if (manquantes.length > 0 || inconnues.length > 0) {
      push(
        `${release.id} : retrait.lignes-registre divergent du registre des goldens (${manquantes.length} omises, ${inconnues.length} inconnues) — le retrait doit être rattaché au même candidat`,
      );
    }
  }
}

function validerAttestation(attestation, release, push) {
  if (release.etat === "preparation") {
    if (attestation !== null && attestation !== undefined) {
      push(
        `${release.id} : un candidat en preparation ne porte pas d'attestation`,
      );
    }
    return;
  }
  if (!attestation || typeof attestation !== "object") {
    push(
      `${release.id} : attestation immuable manquante — chaque candidat scellé porte son attestation de promotion`,
    );
    return;
  }
  if (attestation.sha !== release.sha) {
    push(
      `${release.id} : attestation.sha (${String(attestation.sha)}) doit sceller le SHA exact du candidat (${String(release.sha)})`,
    );
  }
  if (attestation["checkpoint-baseline"] !== BASELINE_BUZZ) {
    push(`${release.id} : attestation.checkpoint-baseline invalide`);
  }
  const registres = Array.isArray(attestation.registres)
    ? attestation.registres
    : [];
  const noms = new Set(registres.map((r) => r?.nom));
  for (const nom of NOMS_REGISTRES_ATTESTATION) {
    if (!noms.has(nom)) {
      push(
        `${release.id} : attestation.registres manque « ${nom} » (versions et hashes des registres exigés)`,
      );
    }
  }
  for (const registre of registres) {
    if (!registre || !NOMS_REGISTRES_ATTESTATION.includes(registre.nom)) {
      push(
        `${release.id} : attestation.registres contient un nom inconnu « ${String(registre?.nom)} »`,
      );
      continue;
    }
    const materiel = release.materiaux?.[registre.nom];
    if (
      materiel &&
      (registre.version !== materiel.version ||
        registre.sha256 !== materiel.sha256)
    ) {
      push(
        `${release.id} : attestation.registres « ${registre.nom} » diverge des matériaux du candidat`,
      );
    }
  }
  const staging = attestation.staging;
  const releaseStaging = release.staging;
  if (!staging || typeof staging !== "object") {
    push(
      `${release.id} : attestation.staging manquant (identifiants de staging exigés)`,
    );
  } else if (releaseStaging) {
    for (const cle of ["environnement", "compte", "zone", "deploiement"]) {
      if (staging[cle] !== releaseStaging[cle]) {
        push(
          `${release.id} : attestation.staging.${cle} diverge du staging du candidat`,
        );
      }
    }
  }
  const gates = Array.isArray(attestation.gates) ? attestation.gates : [];
  const gatesVus = new Set();
  for (const gate of gates) {
    if (!gate || !PREUVES_OBLIGATOIRES.includes(gate.gate)) {
      push(
        `${release.id} : attestation.gates contient une gate inconnue « ${String(gate?.gate)} »`,
      );
      continue;
    }
    gatesVus.add(gate.gate);
    if (gate.resultat !== "vert" || gate.sha !== release.sha) {
      push(
        `${release.id} : attestation.gates « ${gate.gate} » doit être verte et liée au SHA du candidat`,
      );
    }
  }
  for (const cle of PREUVES_OBLIGATOIRES) {
    if (!gatesVus.has(cle)) {
      push(`${release.id} : attestation.gates manque le résultat « ${cle} »`);
    }
  }
  const artefacts = Array.isArray(attestation.artefacts)
    ? attestation.artefacts
    : [];
  const distribues = new Map(
    (Array.isArray(release.artefacts) ? release.artefacts : [])
      .filter((a) => a && typeof a === "object")
      .map((a) => [a.plateforme, a.sha256]),
  );
  for (const artefact of artefacts) {
    if (
      !artefact ||
      !distribues.has(artefact.plateforme) ||
      distribues.get(artefact.plateforme) !== artefact.sha256
    ) {
      push(
        `${release.id} : attestation.artefacts doit recenser les hashes des artefacts distribués du candidat`,
      );
    }
  }
  if (artefacts.length !== distribues.size) {
    push(
      `${release.id} : attestation.artefacts doit couvrir exactement les artefacts distribués`,
    );
  }
  if (!listeEgale(attestation.publiee, PUBLICATION)) {
    push(
      `${release.id} : attestation.publiee doit être exactement [${PUBLICATION.join(", ")}] — publiée avec la release ET dans le stockage R2 prévu`,
    );
  }
}

function validerRecus(recus, release, push) {
  if (!Array.isArray(recus)) {
    push(`${release.id} : recus attendus (éventuellement vides)`);
    return;
  }
  if (release.etat !== "preparation" && recus.length === 0) {
    push(
      `${release.id} : au moins un Reçu immuable (dont le reçu du retrait) doit accompagner un candidat scellé`,
    );
  }
  for (const recu of recus) {
    if (!recu || typeof recu !== "object") {
      push(`${release.id} : recu malformé`);
      continue;
    }
    if (typeof recu.id !== "string" || recu.id.trim() === "") {
      push(`${release.id} : recu sans identifiant`);
    }
    if (!estSha256(recu.sha256)) {
      push(`${release.id} : recu sans sha256 de contenu valide`);
    }
    if (!listeEgale(recu.publication, PUBLICATION)) {
      push(
        `${release.id} : recu.publication doit être exactement [${PUBLICATION.join(", ")}] — les Reçus sont publiés avec la release ET dans le stockage R2 prévu`,
      );
    }
  }
}

function validerJournal(journal, release, push) {
  const rang = rangEtat(release.etat);
  if (rang <= 0) {
    if (Array.isArray(journal) && journal.length > 0) {
      push(
        `${release.id} : un candidat en preparation n'a pas de journal de transitions`,
      );
    }
    return {
      expansion: null,
      active: null,
      contraction: null,
    };
  }
  if (!Array.isArray(journal) || journal.length !== rang) {
    push(
      `${release.id} : journal append-only incomplet — ${rang} transition(s) attendue(s) pour l'état ${release.etat}`,
    );
    return { expansion: null, active: null, contraction: null };
  }
  const dates = { expansion: null, active: null, contraction: null };
  journal.forEach((entree, index) => {
    const attendue = CHAINE_TRANSITIONS[index];
    if (!entree || entree.vers !== attendue) {
      push(
        `${release.id} : journal #${index + 1} doit être la transition « ${attendue} » (append-only, sans régression ni saut)`,
      );
      return;
    }
    const date = parseDate(entree.date);
    if (date === null) {
      push(
        `${release.id} : journal « ${attendue} » sans date YYYY-MM-DD valide`,
      );
      return;
    }
    if (index > 0) {
      const precedente = parseDate(journal[index - 1]?.date);
      if (precedente !== null && date < precedente) {
        push(
          `${release.id} : journal « ${attendue} » antérieure à la transition précédente (append-only)`,
        );
      }
    }
    if (dates[attendue] === null) {
      dates[attendue] = date;
    }
  });
  return dates;
}

function validerContraction(release, releases, dates, push) {
  if (release.etat !== "contraction" && release.etat !== "contractee") {
    return;
  }
  const successeur = releases.find((r) => r.id === release.successeur);
  if (!successeur) {
    push(
      `${release.id} : contraction sans successeur — la contraction retire N−1 au profit d'un successeur explicite`,
    );
    return;
  }
  const dateContraction = dates.contraction;
  const dateActiveSuccesseur = dateActivation(successeur);
  if (dateContraction === null || dateActiveSuccesseur === null) {
    return; // déjà signalé par le journal
  }
  const jours = Math.floor((dateContraction - dateActiveSuccesseur) / JOUR_MS);
  if (jours < FENETRE_SUPPORT_JOURS) {
    push(
      `${release.id} : contraction interdite — le successeur ${successeur.id} est actif depuis ${jours} jour(s), N et N−1 restent supportés au moins ${FENETRE_SUPPORT_JOURS} jours`,
    );
  }
  validerUsage(release, dateContraction, push);
}

function dateActivation(release) {
  const entree = Array.isArray(release.journal)
    ? release.journal.find((e) => e?.vers === "active")
    : undefined;
  return entree ? parseDate(entree.date) : null;
}

function validerUsage(release, dateContraction, push) {
  const usage = release.usage;
  if (!Array.isArray(usage) || usage.length < FENETRE_CONTRACTION_JOURS) {
    push(
      `${release.id} : contraction sans ${FENETRE_CONTRACTION_JOURS} jours d'usage mesuré — la contraction exige moins de ${SEUIL_USAGE_CONTRACTION} % d'usage pendant ${FENETRE_CONTRACTION_JOURS} jours`,
    );
    return;
  }
  let precedente = null;
  for (const point of usage) {
    const date = parseDate(point?.date);
    if (date === null) {
      push(`${release.id} : usage sans date YYYY-MM-DD valide`);
      precedente = null;
      continue;
    }
    if (precedente !== null && date !== precedente + JOUR_MS) {
      // jours consécutifs exigés : ni trou, ni doublon
      push(
        `${release.id} : usage non contigu — ${FENETRE_CONTRACTION_JOURS} jours consécutifs d'échantillons sont exigés`,
      );
    }
    precedente = date;
    const pourcentage = point.pourcentage;
    if (
      typeof pourcentage !== "number" ||
      !Number.isFinite(pourcentage) ||
      pourcentage < 0 ||
      pourcentage >= SEUIL_USAGE_CONTRACTION
    ) {
      push(
        `${release.id} : usage du ${point?.date} à ${String(pourcentage)} % — la contraction exige moins de ${SEUIL_USAGE_CONTRACTION} % chaque jour pendant ${FENETRE_CONTRACTION_JOURS} jours`,
      );
    }
    if (date > dateContraction) {
      push(
        `${release.id} : échantillon d'usage postérieur à la contraction — la mesure doit précéder la décision`,
      );
    }
  }
}

function validerReleases(graph, contexte, push) {
  const releases = Array.isArray(graph.releases) ? graph.releases : [];
  if (releases.length === 0) {
    push(
      "releases : au moins le candidat de la tranche courante doit être relié",
    );
  }
  const hashes = contexte.hashes ?? null;
  const stagingIds = contexte.stagingIds ?? null;
  const ledgerRetraits = contexte.ledgerRetraits ?? null;
  const vus = new Map();
  const tranchesVues = new Map();
  let actives = 0;
  let expansions = 0;
  const datesParRelease = new Map();

  for (const [index, release] of releases.entries()) {
    const id = `release #${index + 1}`;
    if (!release || typeof release.id !== "string" || release.id === "") {
      push(`${id} : id manquant`);
      continue;
    }
    if (vus.has(release.id)) {
      push(`${release.id} : doublon de ${vus.get(release.id)}`);
    } else {
      vus.set(release.id, id);
    }
    const m = TRANCHE_ID_RE.exec(release.id);
    if (!m) {
      push(`${release.id} : id doit suivre la forme tranche:N`);
    } else {
      if (release.tranche !== Number.parseInt(m[1], 10)) {
        push(
          `${release.id} : champ tranche (${String(release.tranche)}) incohérent avec l'id`,
        );
      }
      if (tranchesVues.has(release.tranche)) {
        push(
          `${release.id} : la tranche ${release.tranche} est déjà portée par ${tranchesVues.get(release.tranche)} — une release par tranche`,
        );
      } else {
        tranchesVues.set(release.tranche, release.id);
      }
    }
    if (!ETATS.includes(release.etat)) {
      push(
        `${release.id} : état inconnu « ${String(release.etat)} » (vocabulaire fermé ${ETATS.join(", ")})`,
      );
      continue;
    }
    const scellee = release.etat !== "preparation";
    if (release.sha === null || release.sha === undefined) {
      if (scellee) {
        push(
          `${release.id} : SHA du candidat exact manquant (requis hors preparation)`,
        );
      }
    } else if (typeof release.sha !== "string" || !SHA1_RE.test(release.sha)) {
      push(`${release.id} : sha invalide (40 hexadécimaux attendus)`);
    }

    const lignesTranche =
      ledgerRetraits === null
        ? null
        : ledgerRetraits
            .filter(
              (ligne) =>
                typeof ligne?.test === "string" &&
                ligne?.tranche === `tranche:${release.tranche}`,
            )
            .map((ligne) => ligne.test);

    validerMateriaux(release.materiaux, release, hashes, push);
    validerStaging(release.staging, release, hashes, stagingIds, push);
    validerArtefacts(release.artefacts, release, push);
    validerPreuves(release.preuves, release, push);
    validerRetrait(release.retrait, release, lignesTranche, push);
    validerAttestation(release.attestation, release, push);
    validerRecus(release.recus, release, push);
    const dates = validerJournal(release.journal, release, push);
    datesParRelease.set(release.id, dates);
    if (release.etat === "active") {
      actives += 1;
    }
    if (release.etat === "expansion") {
      expansions += 1;
    }
  }

  if (actives > 1) {
    push(
      "releases : au plus une release active (défaut) à la fois — le graphe est linéaire",
    );
  }
  if (expansions > 1) {
    push(
      "releases : au plus une release en expansion (candidat promu) à la fois",
    );
  }

  for (const release of releases) {
    if (
      !release ||
      typeof release.id !== "string" ||
      !ETATS.includes(release.etat)
    ) {
      continue;
    }
    validerContraction(
      release,
      releases,
      datesParRelease.get(release.id) ?? {
        expansion: null,
        active: null,
        contraction: null,
      },
      push,
    );
  }

  return releases;
}

function validerRecuperations(recuperations, releases, push) {
  const entries = Array.isArray(recuperations) ? recuperations : [];
  if (recuperations !== undefined && !Array.isArray(recuperations)) {
    push("recuperations : liste attendue");
    return;
  }
  for (const [index, recuperation] of entries.entries()) {
    const id = `recuperation #${index + 1}`;
    if (!recuperation || typeof recuperation !== "object") {
      push(`${id} : entrée malformée`);
      continue;
    }
    if (parseDate(recuperation.date) === null) {
      push(`${id} : date YYYY-MM-DD manquante`);
    }
    if (!TYPES_RECUPERATION.includes(recuperation.type)) {
      push(
        `${id} : type inconnu « ${String(recuperation.type)} » — le vocabulaire fermé (${TYPES_RECUPERATION.join(", ")}) exclut structurellement tout retour vers Buzz`,
      );
      continue;
    }
    const cible = releases.find((r) => r?.id === recuperation.cible);
    if (!cible) {
      push(
        `${id} : cible « ${String(recuperation.cible)} » inconnue — une récupération ne peut viser que le graphe Punks, jamais Buzz`,
      );
      continue;
    }
    if (cible.etat === "preparation") {
      push(
        `${id} : cible ${cible.id} non scellée — une récupération ne peut promouvoir un candidat sans dossier de preuve`,
      );
    }
    if (recuperation.type === "retour-punks") {
      validerCertificat(recuperation, cible, releases, push);
    }
  }
}

function validerCertificat(recuperation, cible, releases, push) {
  const certificat = recuperation.certificat;
  if (!certificat || typeof certificat !== "object") {
    push(
      `${recuperation.cible} : retour Punks antérieur sans certificat de compatibilité exact — interdit`,
    );
    return;
  }
  const registre = cible.materiaux?.["registre-contrats"];
  const profil = cible.materiaux?.profil;
  if (
    !Number.isInteger(certificat.contrats) ||
    (registre && certificat.contrats !== registre.version)
  ) {
    push(
      `${recuperation.cible} : certificat.contrats doit citer la version exacte du registre des contrats de la cible`,
    );
  }
  if (
    !profil ||
    certificat.profil !== profil.id ||
    certificat["profil-version"] !== profil.version
  ) {
    push(
      `${recuperation.cible} : certificat.profil/-version doivent citer le profil exact de la cible`,
    );
  }
  if (certificat["compatibilite-donnees"] !== true) {
    push(
      `${recuperation.cible} : certificat.compatibilite-donnees doit être prouvé vrai (RPO logique nul)`,
    );
  }
  const verifie = releases.find((r) => r?.id === certificat["verifie-contre"]);
  if (!verifie || dateActivation(verifie) === null) {
    push(
      `${recuperation.cible} : certificat.verifie-contre doit citer la release active de référence lors du retour`,
    );
  }
}

function validerLiaisonRegistre(releases, ledgerRetraits, push) {
  if (ledgerRetraits === null) {
    return;
  }
  const parTranche = new Map();
  for (const ligne of ledgerRetraits) {
    if (typeof ligne?.test !== "string" || typeof ligne?.tranche !== "string") {
      continue;
    }
    const m = TRANCHE_ID_RE.exec(ligne.tranche);
    if (!m) {
      continue;
    }
    const n = Number.parseInt(m[1], 10);
    if (!parTranche.has(n)) {
      parTranche.set(n, []);
    }
    parTranche.get(n).push(ligne.test);
  }
  for (const [tranche, tests] of parTranche) {
    const candidate = releases.some((r) => r?.tranche === tranche);
    if (!candidate) {
      push(
        `registre des goldens : ${tests.length} retrait(s) de tranche:${tranche} sans candidat dans le graphe`,
      );
    }
  }
}

function validerLiaisonManifeste(releases, manifestActifs, trackedFiles, push) {
  if (manifestActifs === null || trackedFiles === null) {
    return;
  }
  for (const release of releases) {
    if (
      !release ||
      typeof release.tranche !== "number" ||
      release.etat === "preparation"
    ) {
      continue;
    }
    const verdict = `tranche:${release.tranche}`;
    for (const actif of manifestActifs) {
      if (actif?.verdict !== verdict || typeof actif.chemin !== "string") {
        continue;
      }
      let parsed;
      try {
        parsed = parseChemin(actif.chemin);
      } catch {
        continue; // le gate du manifeste signale les chemins invalides
      }
      if (parsed.qualifier !== undefined) {
        continue; // une partie de fichier survit au retrait du reste
      }
      const restants = [...trackedFiles].filter((file) =>
        parsed.bases.some((b) => baseMatches(b, file)),
      );
      if (restants.length > 0) {
        push(
          `${release.id} : retrait incomplet — « ${actif.chemin} » (verdict ${verdict}) laisse encore ${restants.length} fichier(s) suivi(s) dans le candidat`,
        );
      }
    }
  }
}
