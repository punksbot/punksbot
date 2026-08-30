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
 *   - les étapes E/P/A restent ordonnées et signées mais portent zéro heure
 *     d'attente minimale : les preuves peuvent fermer la promotion dans le
 *     même run ;
 *   - deux tranches actives consécutives matérialisent N/N−1 pendant au moins
 *     90 jours ; la contraction exige moins de 1 % d'usage pendant 14 jours ;
 *   - l'attestation contient le SHA, le checkpoint de baseline, les versions
 *     et hashes des registres, les identifiants de staging et les résultats
 *     des gates ;
 *   - attestations et Reçus sont immuables, publiés avec la release et dans
 *     deux buckets R2 du compte Punks (create-only, verrouillage d'objet) ;
 *   - le roll-forward scelle un nouveau graphe et repart à E0 ; un retour à
 *     une version Punks antérieure recalcule les treize contrôles exacts et un
 *     nouveau Reçu à l'instant du retour ; Punks reste hors vocabulaire.
 *
 * Utilisé par scripts/check-release-graph.mjs (gate) et ses tests.
 */
import {
  createHash,
  createPublicKey,
  verify as verifierEd25519,
} from "node:crypto";
import {
  BASELINE_PUNKS,
  baseMatches,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
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
export const HEURE_MS = 3600000;
export const MODE_CADENCE_PROMOTION = "preuves-immediates";
export const DUREE_MINIMALE_PROMOTION_HEURES = 0;

/**
 * Étapes fermées de la décision #16, dans leur ordre obligatoire.
 *
 * Leur durée minimale est nulle : la promotion est gouvernée par les preuves
 * et peut être fermée dans le même run. Les segments restent strictement
 * positifs et les événements strictement ordonnés afin de conserver une chaîne
 * observable sans réintroduire une attente calendaire.
 */
export const CADENCES_OPERATIONNELLES = Object.freeze({
  expansion: Object.freeze([
    Object.freeze({ etape: "E0", exposition: "workers:0%", heures: 0 }),
    Object.freeze({ etape: "E1", exposition: "workers:1%", heures: 0 }),
    Object.freeze({ etape: "E2", exposition: "workers:10%", heures: 0 }),
    Object.freeze({ etape: "E3", exposition: "workers:50%", heures: 0 }),
    Object.freeze({ etape: "E4", exposition: "workers:100%", heures: 0 }),
  ]),
  "expansion-stateful": Object.freeze([
    Object.freeze({
      etape: "P0",
      exposition: "stateful:preparation-lecture",
      heures: 0,
    }),
    Object.freeze({
      etape: "E4",
      exposition: "workers:100%-stateful",
      heures: 0,
    }),
  ]),
  active: Object.freeze([
    Object.freeze({
      etape: "A0",
      exposition: "desktop:pilote-signe",
      heures: 0,
    }),
    Object.freeze({
      etape: "A1",
      exposition: "desktop:canal-prerelease",
      heures: 0,
    }),
    Object.freeze({
      etape: "A2",
      exposition: "desktop:stable-10%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A3",
      exposition: "desktop:stable-50%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A4",
      exposition: "desktop:stable-100%",
      heures: 0,
    }),
  ]),
  contraction: Object.freeze([
    Object.freeze({
      etape: "E4",
      exposition: "workers:100%-contraction",
      heures: 0,
    }),
  ]),
  "roll-forward": Object.freeze([
    Object.freeze({ etape: "E0", exposition: "workers:0%", heures: 0 }),
    Object.freeze({ etape: "E1", exposition: "workers:1%", heures: 0 }),
    Object.freeze({ etape: "E2", exposition: "workers:10%", heures: 0 }),
    Object.freeze({ etape: "E3", exposition: "workers:50%", heures: 0 }),
    Object.freeze({ etape: "E4", exposition: "workers:100%", heures: 0 }),
    Object.freeze({
      etape: "A0",
      exposition: "desktop:pilote-signe",
      heures: 0,
    }),
    Object.freeze({
      etape: "A1",
      exposition: "desktop:canal-prerelease",
      heures: 0,
    }),
    Object.freeze({
      etape: "A2",
      exposition: "desktop:stable-10%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A3",
      exposition: "desktop:stable-50%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A4",
      exposition: "desktop:stable-100%",
      heures: 0,
    }),
  ]),
  "roll-forward-stateful": Object.freeze([
    Object.freeze({
      etape: "P0",
      exposition: "stateful:preparation-lecture",
      heures: 0,
    }),
    Object.freeze({
      etape: "E4",
      exposition: "workers:100%-stateful",
      heures: 0,
    }),
    Object.freeze({
      etape: "A0",
      exposition: "desktop:pilote-signe",
      heures: 0,
    }),
    Object.freeze({
      etape: "A1",
      exposition: "desktop:canal-prerelease",
      heures: 0,
    }),
    Object.freeze({
      etape: "A2",
      exposition: "desktop:stable-10%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A3",
      exposition: "desktop:stable-50%",
      heures: 0,
    }),
    Object.freeze({
      etape: "A4",
      exposition: "desktop:stable-100%",
      heures: 0,
    }),
  ]),
});

export const PUBLICATION = ["release", "r2"];
export const ECRITURE_IMMUABLE = "create-only";
export const VERROUILLAGE_OBJET = "compliance";
export const BUCKETS_R2 = 2;
export const PUNKS_CLOUDFLARE_ACCOUNT_ID = "3a391620584c792dbbd8cfa148d7634a";

/**
 * Racine de confiance du registre opérateur. Toute rotation ajoute les clés au
 * graphe et met à jour cet ancrage dans une modification de code distinctement
 * revue ; le document de release ne peut donc pas s'auto-approuver.
 */
export const ANCRAGE_APPROBATEURS_RELEASE =
  "b4dbbbdcf4074cd95063e1296afb2883de01a01fbf3e3ca5fe1c9b4f7a45805e";

export const RECUPERATION_NORMALE = "roll-forward";
export const RETOUR_VERSION_ANTERIEURE = "certificat-compatibilite-exige";
export const RETOUR_PUNKS = "interdit";
export const TYPES_RECUPERATION = ["roll-forward", "retour-punks"];

/** Les treize contrôles fermés du certificat d'éligibilité décidé en #16. */
export const CONTROLES_CERTIFICAT = [
  "bundle-manifeste-originaux",
  "attestation-valide-non-revoquee",
  "securite-isolation-effacement-sans-punks",
  "profils-desktop-actifs",
  "versions-etat-durable-objects",
  "migrations-durable-objects-franchissables",
  "migrations-d1-expand-compatibles",
  "formats-r2-tombstones-generations",
  "topologie-cloudflare",
  "generations-secrets-attestation-sessions",
  "workflows-compatibles-ou-neutralises",
  "smoke-handshake-probes",
  "recu-cloudflare-digests-approbateurs",
];

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

/**
 * Inventaire fermé des surfaces qui rendent un graphe Cloudflare exécutable.
 * Une modification de l'une d'elles change le hash du snapshot et remet donc
 * à zéro toute durée acquise par les Reçus d'étape.
 */
export const SURFACES_TOPOLOGIE = [
  "manifest-staging-sha256",
  "manifest-production-sha256",
  "migrations-durable-objects-sha256",
  "migrations-d1-sha256",
  "bindings-sha256",
  "routes-sha256",
  "triggers-sha256",
  "ressources-sha256",
  "secrets-sha256",
  "configuration-trafic-sha256",
];

/** Budgets absolus et tolérances zéro fermés de la décision #16. */
export const BUDGETS_PRODUCTION = Object.freeze(
  [
    ["connexion-desktop-echecs-par-moyen", "pourcentage", 1],
    ["activation-unconfirmed-terminal", "pourcentage", 0.1],
    ["renouvellement-session-echecs", "pourcentage", 0.1],
    ["mutations-ambiguous", "pourcentage", 0.1],
    ["mutations-ambiguous-apres-5m", "pourcentage", 0.01],
    ["replay-automatique", "occurrences", 0],
    ["desktop-sessions-avec-crash-par-plateforme", "pourcentage", 0.1],
    ["desktop-demarrage-sans-frontiere-session", "pourcentage", 0.5],
    ["follow-live-p95", "millisecondes", 3_000],
    ["follow-live-p99", "millisecondes", 10_000],
    ["renderer-confirmation-p95", "millisecondes", 1_000],
    ["renderer-confirmation-p99", "millisecondes", 5_000],
    ["history-required-hors-exercice", "pourcentage", 0.5],
    ["durable-objects-erreurs-internes", "pourcentage", 0.1],
    ["durable-objects-p99", "millisecondes", 1_000],
    ["d1-retard-p95", "millisecondes", 5_000],
    ["d1-retard-p99", "millisecondes", 30_000],
    ["d1-retard-actif-max", "millisecondes", 300_000],
    ["alarmes-outboxes-age-p99", "millisecondes", 60_000],
    ["alarmes-outboxes-age-max", "millisecondes", 900_000],
    ["queues-age-p95", "millisecondes", 60_000],
    ["queues-age-p99", "millisecondes", 300_000],
    ["queues-dlq", "occurrences", 0],
    ["r2-archivage-p99", "millisecondes", 300_000],
    ["r2-element-chaud-bloque-max", "millisecondes", 900_000],
    ["workspace-profil-absent-ou-incompatible", "occurrences", 0],
    ["contract-violation", "occurrences", 0],
    ["follow-trou-ou-chevauchement-divergent", "occurrences", 0],
    ["ack-avant-publication-renderer", "occurrences", 0],
    ["fuite-inter-workspace-ou-acces-non-autorise", "occurrences", 0],
    ["resurrection-session-revoquee", "occurrences", 0],
    ["contradiction-marqueur-effacement", "occurrences", 0],
    ["plaintext-lisible-apres-effacement", "occurrences", 0],
    ["r2-double-ecriture-hash-lock-ou-chaine-invalide", "occurrences", 0],
    ["discordance-artefact-ou-attestation", "occurrences", 0],
    ["tentative-punks-ou-nostr-public", "occurrences", 0],
  ].map(([nom, unite, maximum]) => Object.freeze({ nom, unite, maximum })),
);

export const NOMS_REGISTRES_ATTESTATION = [
  "registre-contrats",
  "profil",
  "registre-goldens",
  "manifeste-retrait",
];

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SIGNATURE_ED25519_RE = /^[0-9a-f]{128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TRANCHE_ID_RE = /^tranche:([0-9]+)$/;
const MARQUEUR_PRODUIT_PRECEDENT = String.fromCharCode(98, 117, 122, 122);
const IDENTITE_HISTORIQUE_INTERDITE_RE = new RegExp(
  `(?:^|[-_.:/])(?:${MARQUEUR_PRODUIT_PRECEDENT}|nostr(?:-public)?|relay)(?:$|[-_.:/])`,
  "iu",
);
export const CANAL_RELEASE = "punks-desktop";
const ADR_RELEASE =
  "docs/adr/0060-graphe-de-release-expansion-activation-contraction.md";

/** Date « YYYY-MM-DD » → millisecondes UTC, ou null si invalide. */
export function parseDate(valeur) {
  if (typeof valeur !== "string" || !DATE_RE.test(valeur)) {
    return null;
  }
  const ms = Date.parse(`${valeur}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10) === valeur ? ms : null;
}

/** Instant UTC canonique à la seconde, ou null si invalide. */
function parseInstant(valeur) {
  if (typeof valeur !== "string" || !INSTANT_RE.test(valeur)) {
    return null;
  }
  const ms = Date.parse(valeur);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString().replace(".000Z", "Z") === valeur
    ? ms
    : null;
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

function estShaCandidat(valeur) {
  return typeof valeur === "string" && SHA1_RE.test(valeur);
}

function shaReserve(valeur) {
  return valeur === BASELINE_PUNKS || valeur === CHECKPOINT_RECUPERATION;
}

function shaCanoniqueOptionnel(valeur) {
  if (valeur === undefined) return null;
  try {
    return canonicalSha256(valeur);
  } catch {
    return null;
  }
}

function chargerCleEd25519(clePublique) {
  if (typeof clePublique !== "string" || clePublique.length === 0) {
    return null;
  }
  try {
    const der = Buffer.from(clePublique, "base64");
    if (der.length === 0 || der.toString("base64") !== clePublique) return null;
    const cle = createPublicKey({ key: der, format: "der", type: "spki" });
    if (cle.asymmetricKeyType !== "ed25519") return null;
    const derCanonique = cle.export({ format: "der", type: "spki" });
    if (!Buffer.isBuffer(derCanonique) || !der.equals(derCanonique)) {
      return null;
    }
    return {
      cle,
      empreinte: createHash("sha256").update(derCanonique).digest("hex"),
    };
  } catch {
    return null;
  }
}

/**
 * Retourne l'empreinte du DER SPKI Ed25519 strictement canonique, ou null.
 * Cette identité normalisée empêche de compter deux encodages de la même clé
 * comme deux approbateurs cryptographiques distincts.
 */
export function empreinteClePubliqueEd25519(clePublique) {
  return chargerCleEd25519(clePublique)?.empreinte ?? null;
}

/** Vérifie une signature ed25519 du JSON canonique d'un contenu de Reçu. */
export function verifierSignatureRecu(contenu, signature, clePublique) {
  const cleChargee = chargerCleEd25519(clePublique);
  if (
    cleChargee === null ||
    signature?.algorithme !== "ed25519" ||
    !SIGNATURE_ED25519_RE.test(signature?.valeur ?? "")
  ) {
    return false;
  }
  try {
    return verifierEd25519(
      null,
      Buffer.from(canonicalJson(contenu), "utf8"),
      cleChargee.cle,
      Buffer.from(signature.valeur, "hex"),
    );
  } catch {
    return false;
  }
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
  if (
    !listeEgale(Object.keys(graph).sort(), [
      "approbateurs-release",
      "baseline-punks",
      "canal",
      "checkpoint-recuperation",
      "controles-certificat-retour-punks",
      "etats",
      "executions",
      "invalidations-attestations",
      "plateformes",
      "politique",
      "preuves-obligatoires",
      "profils-supportes",
      "publication",
      "recuperations",
      "references",
      "releases",
      "transitions",
      "version",
    ])
  ) {
    push(
      "graphe : schéma racine fermé exigé — aucune politique ou arête implicite n'est admise",
    );
  }
  if (graph.version !== 1) {
    push(`en-tête invalide : version non supportée ${graph.version}`);
  }
  if (graph["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (graph["baseline-punks"] !== BASELINE_PUNKS) {
    push("en-tête invalide : baseline Punks invalide");
  }
  if (graph.canal !== CANAL_RELEASE) {
    push(`canal doit être ${CANAL_RELEASE}`);
  }

  validerPolitique(graph.politique, push);
  validerEtatEtTransitions(graph, push);
  validerReferences(graph.references, fileExists, push);
  validerPublication(graph.publication, graph.releases, push);
  const clesApprobateurs = validerApprobateursRelease(
    graph["approbateurs-release"],
    contexte.ancrageApprobateursRelease ?? ANCRAGE_APPROBATEURS_RELEASE,
    push,
  );

  const registre = {
    recuIds: new Set(),
    recuHashes: new Set(),
    releaseIdsTransitions: new Set(),
    recusTransitions: new Set(),
    deploiementsTransitions: new Set(),
    attestationsTransitions: new Set(),
    shasRecuperations: new Set(),
    executions: new Set(),
    clesApprobateurs,
  };
  const releases = validerReleases(graph, contexte, registre, push);
  const invalidationsAttestations = validerInvalidationsAttestations(
    graph["invalidations-attestations"],
    graph,
    registre,
    push,
  );
  const executions = validerExecutions(
    graph.executions,
    releases,
    graph.recuperations,
    registre,
    push,
  );
  validerRevendicationsExecutions(releases, executions, push);
  validerProgressionAttestations(
    releases,
    graph.executions,
    invalidationsAttestations,
    push,
  );
  const profilsSupportes = validerProfilsSupportes(
    graph["profils-supportes"],
    releases,
    push,
  );
  validerRecuperations(
    graph.recuperations,
    releases,
    profilsSupportes,
    executions,
    invalidationsAttestations,
    registre,
    push,
  );
  validerLiaisonRegistre(releases, ledgerRetraits, push);
  validerLiaisonManifeste(releases, manifestActifs, trackedFiles, push);

  return errors;
}

function collecterRecusSignes(valeur, recus, vus = new Set()) {
  if (!valeur || typeof valeur !== "object" || vus.has(valeur)) return;
  vus.add(valeur);
  if (
    valeur?.contenu?.schema === "punks.release-receipt.v1" &&
    typeof valeur.id === "string" &&
    estSha256(valeur.sha256)
  ) {
    const existant = recus.get(valeur.id);
    const empreinte = canonicalSha256(valeur);
    if (existant === undefined) recus.set(valeur.id, empreinte);
    else if (existant !== empreinte) recus.set(valeur.id, null);
  }
  for (const enfant of Array.isArray(valeur) ? valeur : Object.values(valeur)) {
    collecterRecusSignes(enfant, recus, vus);
  }
}

function prefixeCanonique(avant, apres) {
  return (
    Array.isArray(avant) &&
    Array.isArray(apres) &&
    apres.length >= avant.length &&
    avant.every(
      (element, index) =>
        canonicalSha256(element) === canonicalSha256(apres[index]),
    )
  );
}

function evolutionProfilsSupportesValide(avant, apres) {
  if (
    !Array.isArray(avant) ||
    !Array.isArray(apres) ||
    apres.length < avant.length
  ) {
    return false;
  }
  for (const [index, profilAvant] of avant.entries()) {
    const profilApres = apres[index];
    if (!profilApres || typeof profilApres !== "object") return false;
    for (const cle of ["id", "version", "sha256", "accepte-depuis"]) {
      if (profilApres[cle] !== profilAvant?.[cle]) return false;
    }
    const finAvant = profilAvant?.["accepte-jusqua"];
    const finApres = profilApres?.["accepte-jusqua"];
    if (finAvant === null) {
      if (
        finApres !== null &&
        (parseInstant(finApres) === null ||
          parseInstant(finApres) <= parseInstant(profilAvant["accepte-depuis"]))
      ) {
        return false;
      }
    } else if (finApres !== finAvant) {
      return false;
    }
  }
  return true;
}

/**
 * Vérifie l'évolution append-only entre deux têtes déjà versionnées du
 * graphe. La validation intrinsèque d'une tête ne suffit pas : sans ce
 * contrôle, un suffixe historique valide pourrait être supprimé ou réécrit.
 */
export function validateReleaseGraphEvolution(avant, apres) {
  const erreurs = [];
  const push = (message) => erreurs.push(`évolution append-only : ${message}`);
  if (
    !avant ||
    typeof avant !== "object" ||
    !apres ||
    typeof apres !== "object"
  ) {
    return ["évolution append-only : deux graphes valides sont exigés"];
  }

  const releasesAvant = Array.isArray(avant.releases) ? avant.releases : [];
  const releasesApres = Array.isArray(apres.releases) ? apres.releases : [];
  if (
    releasesApres.length < releasesAvant.length ||
    releasesAvant.some(
      (release, index) => releasesApres[index]?.id !== release?.id,
    )
  ) {
    push("les releases ne peuvent être tronquées, déplacées ni remplacées");
  }
  for (const [index, releaseAvant] of releasesAvant.entries()) {
    const releaseApres = releasesApres[index];
    if (!releaseApres || releaseApres.id !== releaseAvant?.id) continue;
    const journalAvant = Array.isArray(releaseAvant.journal)
      ? releaseAvant.journal
      : [];
    const journalApres = Array.isArray(releaseApres.journal)
      ? releaseApres.journal
      : [];
    if (!prefixeCanonique(journalAvant, journalApres)) {
      push(
        `${releaseAvant.id} : le journal historique a été tronqué ou réécrit`,
      );
    }
    if (
      releaseAvant.etat !== "preparation" &&
      rangEtat(releaseApres.etat) < rangEtat(releaseAvant.etat)
    ) {
      push(`${releaseAvant.id} : l'état scellé ne peut pas régresser`);
    }
  }

  const executionsAvant = Array.isArray(avant.executions)
    ? avant.executions
    : [];
  const executionsApres = Array.isArray(apres.executions)
    ? apres.executions
    : [];
  if (
    executionsApres.length < executionsAvant.length ||
    executionsAvant.some(
      (execution, index) => executionsApres[index]?.id !== execution?.id,
    )
  ) {
    push("le registre d'exécutions ne peut être tronqué, déplacé ni remplacé");
  }
  for (const [index, executionAvant] of executionsAvant.entries()) {
    const executionApres = executionsApres[index];
    if (!executionApres || executionApres.id !== executionAvant?.id) continue;
    const baseAvant = { ...executionAvant, evenements: [] };
    const baseApres = { ...executionApres, evenements: [] };
    if (canonicalSha256(baseAvant) !== canonicalSha256(baseApres)) {
      push(`${executionAvant.id} : l'identité scellée de l'exécution a changé`);
    }
    if (
      !prefixeCanonique(
        executionAvant.evenements ?? [],
        executionApres.evenements ?? [],
      )
    ) {
      push(
        `${executionAvant.id} : la séquence d'événements a été tronquée ou réécrite`,
      );
    }
  }

  for (const [champ, libelle] of [
    ["recuperations", "le journal des récupérations"],
    [
      "invalidations-attestations",
      "le journal des invalidations d'attestation",
    ],
    ["approbateurs-release", "le registre des approbateurs"],
  ]) {
    if (!prefixeCanonique(avant[champ] ?? [], apres[champ] ?? [])) {
      push(`${libelle} ne peut être tronqué ni réécrit`);
    }
  }
  if (
    !evolutionProfilsSupportesValide(
      avant["profils-supportes"] ?? [],
      apres["profils-supportes"] ?? [],
    )
  ) {
    push(
      "la chronologie des profils supportés ne peut évoluer que par ajout ou fermeture monotone null→instant",
    );
  }

  const recusAvant = new Map();
  const recusApres = new Map();
  collecterRecusSignes(avant, recusAvant);
  collecterRecusSignes(apres, recusApres);
  for (const [id, empreinte] of recusAvant) {
    if (empreinte === null || recusApres.get(id) !== empreinte) {
      push(`le Reçu signé « ${id} » a disparu ou a été réécrit`);
    }
  }
  if (
    recusAvant.size > 0 &&
    canonicalSha256(avant?.publication?.r2?.destinations ?? null) !==
      canonicalSha256(apres?.publication?.r2?.destinations ?? null)
  ) {
    push("les destinations R2 d'un historique déjà signé sont immuables");
  }
  return erreurs;
}

function validerApprobateursRelease(approbateurs, ancrage, push) {
  if (!Array.isArray(approbateurs)) {
    push("approbateurs-release : registre de clés publiques ed25519 attendu");
    return new Map();
  }
  if (!estSha256(ancrage) || canonicalSha256(approbateurs) !== ancrage) {
    push(
      "approbateurs-release : le registre doit correspondre à l'ancrage de confiance opérateur indépendant du graphe",
    );
  }
  const cles = new Map();
  const empreintes = new Set();
  for (const [index, approbateur] of approbateurs.entries()) {
    const libelle = `approbateurs-release #${index + 1}`;
    const id = approbateur?.id;
    const clePublique = approbateur?.["cle-publique-spki"];
    if (typeof id !== "string" || id.trim() === "") {
      push(`${libelle} : identifiant canonique manquant`);
      continue;
    }
    if (cles.has(id)) {
      push(`${libelle} : approbateur dupliqué « ${id} »`);
      continue;
    }
    const empreinte = empreinteClePubliqueEd25519(clePublique);
    if (empreinte === null) {
      push(`${libelle} : clé publique SPKI ed25519 base64 invalide`);
      continue;
    }
    if (empreintes.has(empreinte)) {
      push(`${libelle} : clé publique réutilisée par plusieurs approbateurs`);
      continue;
    }
    cles.set(id, clePublique);
    empreintes.add(empreinte);
  }
  return cles;
}

function validerPolitique(politique, push) {
  if (!politique || typeof politique !== "object") {
    push("politique manquante");
    return;
  }
  if (
    !listeEgale(Object.keys(politique).sort(), [
      "cadence-promotion",
      "fenetre-mesure-contraction-jours",
      "fenetre-support-jours",
      "immuabilite",
      "recuperation",
      "rpo-logique-nul",
      "seuil-usage-contraction",
    ])
  ) {
    push("politique : schéma fermé exigé");
  }
  const cadencePromotion = politique["cadence-promotion"];
  if (
    !cadencePromotion ||
    typeof cadencePromotion !== "object" ||
    Array.isArray(cadencePromotion) ||
    !listeEgale(Object.keys(cadencePromotion).sort(), [
      "duree-minimale-heures-par-etape",
      "mode",
    ]) ||
    cadencePromotion.mode !== MODE_CADENCE_PROMOTION ||
    cadencePromotion["duree-minimale-heures-par-etape"] !==
      DUREE_MINIMALE_PROMOTION_HEURES
  ) {
    push(
      "politique : cadence-promotion doit imposer les preuves immédiates et zéro heure d'attente minimale par étape",
    );
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
    if (
      !listeEgale(Object.keys(recuperation).sort(), [
        "normale",
        "retour-punks",
        "retour-punks-anterieur",
      ])
    ) {
      push("politique : recuperation possède une arête implicite interdite");
    }
    if (recuperation.normale !== RECUPERATION_NORMALE) {
      push(
        "politique : recuperation.normale doit être roll-forward — le roll-forward est la récupération normale",
      );
    }
    if (recuperation["retour-punks-anterieur"] !== RETOUR_VERSION_ANTERIEURE) {
      push(
        "politique : recuperation.retour-punks-anterieur doit exiger un certificat de compatibilité",
      );
    }
    if (recuperation["retour-punks"] !== RETOUR_PUNKS) {
      push(
        "politique : recuperation.retour-punks doit être interdit — aucun retour vers Punks n'est possible",
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
  if (
    !listeEgale(Object.keys(immuabilite).sort(), [
      "attestations",
      "bootstrap-r2",
      "recus",
    ])
  ) {
    push("politique : schéma fermé d'immuabilité exigé");
  }
  if (
    !immuabilite["bootstrap-r2"] ||
    !listeEgale(Object.keys(immuabilite["bootstrap-r2"]).sort(), [
      "premiere-activation",
      "reference",
    ])
  ) {
    push("politique : schéma fermé du bootstrap R2 exigé");
  }
  if (
    immuabilite["bootstrap-r2"]?.["premiere-activation"] !== "github-puis-r2" ||
    immuabilite["bootstrap-r2"]?.reference !==
      "bootstrap-github-attestation-sha256"
  ) {
    push(
      "politique : immuabilite.bootstrap-r2 doit imposer GitHub puis R2 avec la référence content-addressée exacte",
    );
  }
  for (const sorte of ["attestations", "recus"]) {
    const regles = immuabilite[sorte];
    if (!regles || typeof regles !== "object") {
      push(`politique : immuabilite.${sorte} manquante`);
      continue;
    }
    if (
      !listeEgale(Object.keys(regles).sort(), [
        "buckets-r2",
        "ecriture",
        "publication",
        "verrouillage-objet",
      ])
    ) {
      push(`politique : schéma fermé de immuabilite.${sorte} exigé`);
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
    if (regles["buckets-r2"] !== BUCKETS_R2) {
      push(
        `politique : immuabilite.${sorte}.buckets-r2 doit être ${BUCKETS_R2} (contenus critiques dans deux buckets R2 Punks distincts)`,
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
  if (
    !listeEgale(
      graph["controles-certificat-retour-punks"],
      CONTROLES_CERTIFICAT,
    )
  ) {
    push(
      `controles-certificat-retour-punks doit être exactement [${CONTROLES_CERTIFICAT.join(", ")}]`,
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
  if (
    !listeEgale(Object.keys(references).sort(), ["adr", "decisions", "spec"])
  ) {
    push("references : schéma fermé exigé");
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
  if (!adr.includes(ADR_RELEASE)) {
    push(`references : adr doit citer l'ADR 0060 (${ADR_RELEASE})`);
  }
  for (const chemin of adr) {
    if (!estCheminGitCanonique(chemin) || !fileExists(chemin)) {
      push(`references : ADR introuvable — ${String(chemin)}`);
    }
  }
}

function validerPublication(publication, releases, push) {
  if (
    !publication ||
    typeof publication !== "object" ||
    Array.isArray(publication) ||
    !listeEgale(Object.keys(publication).sort(), ["r2"]) ||
    !publication.r2 ||
    typeof publication.r2 !== "object" ||
    Array.isArray(publication.r2) ||
    !listeEgale(Object.keys(publication.r2).sort(), ["destinations", "layout"])
  ) {
    push("publication : schéma fermé release/R2 exigé");
  }
  const r2 = publication?.r2;
  const layout = r2?.layout;
  if (!layout || typeof layout !== "object") {
    push("publication : layout R2 manquant (attestations et Reçus)");
    return;
  }
  const attendus = {
    attestations:
      "releases/{canal}/{id}/attestations/{attestation-sha256}.json",
    recus: "releases/{canal}/{id}/recus/{recu-sha256}.json",
  };
  if (!listeEgale(Object.keys(layout).sort(), Object.keys(attendus).sort())) {
    push("publication : schéma fermé du layout R2 exigé");
  }
  for (const [sorte, attendu] of Object.entries(attendus)) {
    if (layout[sorte] !== attendu) {
      push(
        `publication : layout R2 de ${sorte} doit être exactement ${attendu}`,
      );
    }
  }
  const destinations = r2?.destinations;
  const scellee = Array.isArray(releases)
    ? releases.some((release) => release?.etat !== "preparation")
    : false;
  if (
    !Array.isArray(destinations) ||
    (scellee && destinations.length !== BUCKETS_R2) ||
    (!scellee && ![0, BUCKETS_R2].includes(destinations.length))
  ) {
    push(
      `publication : exactement ${BUCKETS_R2} destinations R2 ancrées sont exigées avant tout scellement`,
    );
    return;
  }
  const buckets = new Set();
  for (const [index, destination] of destinations.entries()) {
    const role = index === 0 ? "primaire" : "secondaire";
    if (
      !destination ||
      typeof destination !== "object" ||
      Array.isArray(destination) ||
      !listeEgale(Object.keys(destination).sort(), [
        "bucket",
        "compte",
        "role",
        "verrouillage-objet",
      ]) ||
      destination.role !== role ||
      destination.compte !== PUNKS_CLOUDFLARE_ACCOUNT_ID ||
      typeof destination.bucket !== "string" ||
      destination.bucket.trim() !== destination.bucket ||
      destination.bucket === "" ||
      destination.bucket.includes("/") ||
      destination["verrouillage-objet"] !== VERROUILLAGE_OBJET ||
      buckets.has(destination.bucket)
    ) {
      push(
        `publication : destination R2 ${role} canonique dans le compte Cloudflare Punks, distincte et verrouillée compliance exigée`,
      );
    }
    buckets.add(destination?.bucket);
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
    (typeof staging.deploiement !== "string" ||
      staging.deploiement.trim() === "")
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
    if (
      release["attestation-sha256"] !== null &&
      release["attestation-sha256"] !== undefined
    ) {
      push(
        `${release.id} : un candidat en preparation ne porte pas de hash d'attestation`,
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

function validerDigestsProduction(digests, release, push) {
  if (release.etat === "preparation") {
    if (digests !== null && digests !== undefined) {
      push(
        `${release.id} : un candidat en preparation ne possède pas encore de bundle ni de manifeste production scellés`,
      );
    }
    return;
  }
  if (!digests || typeof digests !== "object") {
    push(
      `${release.id} : digests-production manquants (bundle scellé et manifeste production exigés)`,
    );
    return;
  }
  for (const nom of ["bundle", "manifeste"]) {
    if (!estSha256(digests[nom])) {
      push(`${release.id} : digests-production.${nom} doit être un sha256`);
    }
  }
}

function validerPreuves(preuves, release, push) {
  const scellee = release.etat !== "preparation";
  if (!scellee) {
    if (
      release["dossier-preuve-sha256"] !== null &&
      release["dossier-preuve-sha256"] !== undefined
    ) {
      push(
        `${release.id} : un candidat en preparation ne porte pas encore de dossier de preuve scellé`,
      );
    }
    if (preuves && Object.keys(preuves).length > 0) {
      push(
        `${release.id} : un candidat en preparation ne déclare pas de résultats de gates`,
      );
    }
    return;
  }
  if (!estSha256(release["dossier-preuve-sha256"])) {
    push(
      `${release.id} : dossier-preuve-sha256 content-addressé exigé pour tout candidat scellé`,
    );
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
    if (
      Array.isArray(preuve) ||
      !listeEgale(Object.keys(preuve).sort(), ["resultat", "sha"])
    ) {
      push(`${release.id} : preuve « ${cle} » à schéma fermé exigée`);
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
        `${release.id} : un candidat en preparation n'a pas encore retiré de chemin Punks`,
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
  if (retrait.sha !== release.sha) {
    push(
      `${release.id} : retrait.sha doit être rattaché au SHA exact du candidat (${String(release.sha)})`,
    );
  }
  if (
    !Array.isArray(retrait["lignes-registre"]) ||
    retrait["lignes-registre"].some((l) => !estCheminGitCanonique(l))
  ) {
    push(
      `${release.id} : retrait.lignes-registre doit citer les tests Punks retirés par ce candidat (chemins canoniques)`,
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
  if (attestation["checkpoint-baseline"] !== BASELINE_PUNKS) {
    push(`${release.id} : attestation.checkpoint-baseline invalide`);
  }
  if (
    !attestation.dossier ||
    typeof attestation.dossier !== "object" ||
    Array.isArray(attestation.dossier) ||
    !listeEgale(Object.keys(attestation.dossier).sort(), ["sha256"]) ||
    !estSha256(attestation.dossier.sha256) ||
    attestation.dossier.sha256 !== release["dossier-preuve-sha256"]
  ) {
    push(
      `${release.id} : attestation.dossier.sha256 doit lier le dossier de preuve content-addressé exact du candidat`,
    );
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
  const registresVus = new Set();
  for (const registre of registres) {
    if (!registre || !NOMS_REGISTRES_ATTESTATION.includes(registre.nom)) {
      push(
        `${release.id} : attestation.registres contient un nom inconnu « ${String(registre?.nom)} »`,
      );
      continue;
    }
    if (registresVus.has(registre.nom)) {
      push(
        `${release.id} : attestation.registres duplique le registre « ${registre.nom} »`,
      );
    } else {
      registresVus.add(registre.nom);
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
    if (gatesVus.has(gate.gate)) {
      push(
        `${release.id} : attestation.gates duplique la gate « ${gate.gate} »`,
      );
    } else {
      gatesVus.add(gate.gate);
    }
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
  const plateformesAttestees = new Set();
  for (const artefact of artefacts) {
    if (artefact && distribues.has(artefact.plateforme)) {
      if (plateformesAttestees.has(artefact.plateforme)) {
        push(
          `${release.id} : attestation.artefacts duplique la plateforme ${artefact.plateforme}`,
        );
      } else {
        plateformesAttestees.add(artefact.plateforme);
      }
    }
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
  if (plateformesAttestees.size !== distribues.size) {
    push(
      `${release.id} : attestation.artefacts doit couvrir exactement les artefacts distribués`,
    );
  }
  const digests = attestation["digests-production"];
  const digestsRelease = release["digests-production"];
  if (
    !digests ||
    !digestsRelease ||
    digests.bundle !== digestsRelease.bundle ||
    digests.manifeste !== digestsRelease.manifeste
  ) {
    push(
      `${release.id} : attestation.digests-production doit sceller les digests originaux du bundle et du manifeste production`,
    );
  }
  if (!listeEgale(attestation.publiee, PUBLICATION)) {
    push(
      `${release.id} : attestation.publiee doit être exactement [${PUBLICATION.join(", ")}] — publiée avec la release ET dans le stockage R2 prévu`,
    );
  }
  if (
    !estSha256(release["attestation-sha256"]) ||
    canonicalSha256(attestation) !== release["attestation-sha256"]
  ) {
    push(
      `${release.id} : attestation-sha256 doit être le hash canonique du contenu de l'attestation immuable`,
    );
  }
}

function validerRecuSigne(
  recu,
  libelle,
  registre,
  push,
  { approbateursAttendus = null, doublon = null } = {},
) {
  if (!recu || typeof recu !== "object" || Array.isArray(recu)) {
    push(`${libelle} malformé`);
    return null;
  }
  if (
    !listeEgale(Object.keys(recu).sort(), [
      "contenu",
      "id",
      "publication",
      "sha256",
      "signatures",
    ])
  ) {
    push(`${libelle} : enveloppe de Reçu à schéma fermé exigée`);
  }

  const idValide = typeof recu.id === "string" && recu.id.trim() !== "";
  if (!idValide) {
    push(`${libelle} sans identifiant`);
  }
  const contenu = recu.contenu;
  if (
    !contenu ||
    typeof contenu !== "object" ||
    Array.isArray(contenu) ||
    contenu.schema !== "punks.release-receipt.v1" ||
    contenu.id !== recu.id
  ) {
    push(
      `${libelle} : contenu signé doit porter le schéma punks.release-receipt.v1 et le même identifiant`,
    );
  }
  if (!estSha256(recu.sha256)) {
    push(`${libelle} sans sha256 de contenu valide`);
  } else if (
    !contenu ||
    typeof contenu !== "object" ||
    canonicalSha256(contenu) !== recu.sha256
  ) {
    push(`${libelle} : hash canonique du contenu divergent`);
  }

  if (idValide && estSha256(recu.sha256)) {
    const idDuplique = registre.recuIds.has(recu.id);
    const hashDuplique = registre.recuHashes.has(recu.sha256);
    if (idDuplique || hashDuplique) {
      if (doublon !== null) {
        push(doublon);
      } else {
        if (idDuplique) {
          push(`${libelle} : identifiant de Reçu dupliqué « ${recu.id} »`);
        }
        if (hashDuplique) {
          push(`${libelle} : sha256 de Reçu dupliqué « ${recu.sha256} »`);
        }
      }
    }
    if (!idDuplique) {
      registre.recuIds.add(recu.id);
    }
    if (!hashDuplique) {
      registre.recuHashes.add(recu.sha256);
    }
  }

  const signaturesRecues = Array.isArray(recu.signatures)
    ? recu.signatures
    : [];
  const approbateurs = new Set();
  let signaturesValides =
    Array.isArray(recu.signatures) && signaturesRecues.length === 2;
  for (const signature of signaturesRecues) {
    const clePublique = registre.clesApprobateurs.get(signature?.approbateur);
    if (
      !signature ||
      typeof signature !== "object" ||
      Array.isArray(signature) ||
      !listeEgale(Object.keys(signature).sort(), [
        "algorithme",
        "approbateur",
        "cle-publique-spki",
        "valeur",
      ]) ||
      typeof signature.approbateur !== "string" ||
      signature.approbateur.trim() === "" ||
      signature.algorithme !== "ed25519" ||
      !SIGNATURE_ED25519_RE.test(signature.valeur ?? "") ||
      approbateurs.has(signature.approbateur) ||
      clePublique === undefined ||
      signature["cle-publique-spki"] !== clePublique ||
      !verifierSignatureRecu(contenu, signature, clePublique)
    ) {
      signaturesValides = false;
      continue;
    }
    approbateurs.add(signature.approbateur);
  }
  if (!signaturesValides || approbateurs.size !== 2) {
    push(
      `${libelle} : deux signatures ed25519 cryptographiquement valides de clés approuvées distinctes sont exigées`,
    );
  }
  const approbateursLies =
    approbateursAttendus ?? contenu?.approbateurs ?? null;
  if (
    approbateursLies !== null &&
    (!listeUniqueNonVide(approbateursLies) ||
      approbateurs.size !== approbateursLies.length ||
      approbateursLies.some((approbateur) => !approbateurs.has(approbateur)))
  ) {
    push(
      `${libelle} : les signatures doivent correspondre exactement aux approbateurs du contenu`,
    );
  }
  if (!listeEgale(recu.publication, PUBLICATION)) {
    push(
      `${libelle}.publication doit être exactement [${PUBLICATION.join(", ")}] — les Reçus sont publiés avec la release ET dans le stockage R2 prévu`,
    );
  }
  return contenu && typeof contenu === "object" ? contenu : null;
}

function validerRecus(recus, release, registre, push) {
  if (!Array.isArray(recus)) {
    push(`${release.id} : recus attendus (éventuellement vides)`);
    return new Map();
  }
  if (release.etat === "preparation" && recus.length > 0) {
    push(`${release.id} : un candidat en preparation ne porte pas de Reçu`);
  }
  if (release.etat !== "preparation" && recus.length === 0) {
    push(
      `${release.id} : au moins un Reçu immuable (dont le reçu du retrait) doit accompagner un candidat scellé`,
    );
  }
  const parId = new Map();
  for (const recu of recus) {
    const contenu = validerRecuSigne(
      recu,
      `${release.id} : recu`,
      registre,
      push,
    );
    if (typeof recu?.id === "string" && !parId.has(recu.id)) {
      parId.set(recu.id, { recu, contenu });
    }
    if (
      contenu &&
      !["promotion", "retrait", "transition"].includes(contenu.type)
    ) {
      push(
        `${release.id} : type de Reçu orphelin ou inconnu « ${String(contenu.type)} »`,
      );
    }
    if (contenu?.type === "promotion") {
      const clesPromotion = [
        "attestation-sha256",
        ...(release.tranche === 1 && release.etat === "expansion"
          ? ["bootstrap-github-attestation-sha256"]
          : []),
        "id",
        "schema",
        "type",
      ].sort();
      if (!listeEgale(Object.keys(contenu).sort(), clesPromotion)) {
        push(`${release.id} : Reçu de promotion à schéma fermé exigé`);
      }
    }
    if (
      contenu?.type === "retrait" &&
      !listeEgale(Object.keys(contenu).sort(), [
        "cible",
        "id",
        "schema",
        "sha",
        "type",
      ])
    ) {
      push(`${release.id} : Reçu de retrait à schéma fermé exigé`);
    }
  }

  if (release.etat !== "preparation") {
    const recusRetrait = [...parId.values()].filter(
      ({ contenu }) =>
        contenu?.type === "retrait" &&
        contenu.cible === release.id &&
        contenu.sha === release.sha,
    );
    if (recusRetrait.length !== 1) {
      push(
        `${release.id} : exactement un Reçu signé du retrait doit lier la release et le SHA exact du candidat`,
      );
    }
    const recusPromotion = [...parId.values()].filter(
      ({ contenu, recu }) =>
        contenu?.type === "promotion" &&
        contenu["attestation-sha256"] === release["attestation-sha256"] &&
        recu?.id === `recu-promotion-${release.tranche}-${String(release.sha)}`,
    );
    if (recusPromotion.length !== 1) {
      push(
        `${release.id} : exactement un Reçu de promotion signé doit lier l'attestation immuable et le SHA exact du candidat`,
      );
    } else {
      const contenuPromotion = recusPromotion[0].contenu;
      const bootstrapAttendu =
        release.tranche === 1 && release.etat === "expansion";
      if (
        bootstrapAttendu &&
        contenuPromotion["bootstrap-github-attestation-sha256"] !==
          release["attestation-sha256"]
      ) {
        push(
          `${release.id} : la première activation R2 doit référencer l'attestation GitHub immuable exacte avant toute copie R2`,
        );
      }
      if (
        !bootstrapAttendu &&
        "bootstrap-github-attestation-sha256" in contenuPromotion
      ) {
        push(
          `${release.id} : la référence de bootstrap GitHub est réservée à la toute première expansion`,
        );
      }
    }
  }
  return parId;
}

function validerTopologieInstantane(topologie, libelle, push) {
  if (!topologie || typeof topologie !== "object" || Array.isArray(topologie)) {
    push(`${libelle} : topologie opérationnelle manquante`);
    return null;
  }
  if (
    !listeEgale(Object.keys(topologie).sort(), [
      "etat-r2",
      "generation-compatibilite",
      "generations-securite",
      "inventaire",
      "migration-stateful",
      "moyens-connexion",
      "versions-cloudflare",
      "versions-etat-durable-objects",
      "workers",
      "workflows",
    ])
  ) {
    push(`${libelle} : schéma fermé de topologie opérationnelle exigé`);
  }
  const workers = Array.isArray(topologie.workers) ? topologie.workers : [];
  const nomsWorkers = new Set();
  if (workers.length === 0) {
    push(
      `${libelle} : au moins une version Worker et son pourcentage sont exigés`,
    );
  }
  for (const worker of workers) {
    if (
      !listeEgale(Object.keys(worker ?? {}).sort(), [
        "nom",
        "pourcentage",
        "version",
      ]) ||
      typeof worker?.nom !== "string" ||
      worker.nom.trim() === "" ||
      IDENTITE_HISTORIQUE_INTERDITE_RE.test(worker.nom) ||
      typeof worker?.version !== "string" ||
      worker.version.trim() === "" ||
      IDENTITE_HISTORIQUE_INTERDITE_RE.test(worker.version) ||
      typeof worker?.pourcentage !== "number" ||
      !Number.isFinite(worker.pourcentage) ||
      worker.pourcentage < 0 ||
      worker.pourcentage > 100 ||
      nomsWorkers.has(worker.nom)
    ) {
      push(`${libelle} : versions/pourcentages Workers invalides ou dupliqués`);
      break;
    }
    nomsWorkers.add(worker.nom);
  }
  const workflows = Array.isArray(topologie.workflows)
    ? topologie.workflows
    : null;
  const nomsWorkflows = new Set();
  if (workflows === null) {
    push(`${libelle} : liste des versions Workflows exigée`);
  } else {
    for (const workflow of workflows) {
      if (
        !listeEgale(Object.keys(workflow ?? {}).sort(), ["nom", "version"]) ||
        typeof workflow?.nom !== "string" ||
        workflow.nom.trim() === "" ||
        IDENTITE_HISTORIQUE_INTERDITE_RE.test(workflow.nom) ||
        typeof workflow?.version !== "string" ||
        workflow.version.trim() === "" ||
        IDENTITE_HISTORIQUE_INTERDITE_RE.test(workflow.version) ||
        nomsWorkflows.has(workflow.nom)
      ) {
        push(`${libelle} : versions Workflows invalides ou dupliquées`);
        break;
      }
      nomsWorkflows.add(workflow.nom);
    }
  }
  if (
    !Number.isInteger(topologie["generation-compatibilite"]) ||
    topologie["generation-compatibilite"] < 1
  ) {
    push(`${libelle} : génération de compatibilité entière ≥ 1 exigée`);
  }
  const inventaire = topologie.inventaire;
  if (
    !inventaire ||
    typeof inventaire !== "object" ||
    Array.isArray(inventaire) ||
    !listeEgale(
      Object.keys(inventaire).sort(),
      [...SURFACES_TOPOLOGIE].sort(),
    ) ||
    SURFACES_TOPOLOGIE.some((surface) => !estSha256(inventaire[surface]))
  ) {
    push(
      `${libelle} : inventaire content-addressé complet des manifests, migrations, bindings, routes, triggers, ressources, secrets et du trafic exigé`,
    );
  }
  const migrationStateful = topologie["migration-stateful"];
  const migrationStatefulValide =
    migrationStateful?.mode === "aucune"
      ? listeEgale(Object.keys(migrationStateful).sort(), ["mode"])
      : migrationStateful?.mode === "non-splittable" &&
        listeEgale(Object.keys(migrationStateful).sort(), [
          "mode",
          "plan-preparation-sha256",
        ]) &&
        estSha256(migrationStateful["plan-preparation-sha256"]);
  if (!migrationStatefulValide) {
    push(
      `${libelle} : migration-stateful doit être « aucune » ou « non-splittable » avec plan de préparation content-addressé`,
    );
  }
  if (
    !listeUniqueNonVide(topologie["moyens-connexion"]) ||
    topologie["moyens-connexion"].some(
      (moyen) =>
        typeof moyen !== "string" ||
        moyen.trim() === "" ||
        IDENTITE_HISTORIQUE_INTERDITE_RE.test(moyen),
    )
  ) {
    push(
      `${libelle} : liste fermée non vide des Moyens de connexion Punks exigée, sans Punks/Nostr public`,
    );
  }
  validerListeObjetsUniques(
    topologie["versions-cloudflare"],
    libelle,
    "versions Cloudflare",
    (version) =>
      version &&
      typeof version === "object" &&
      !Array.isArray(version) &&
      listeEgale(Object.keys(version).sort(), ["id", "ressource"]) &&
      typeof version.ressource === "string" &&
      version.ressource.trim() !== "" &&
      typeof version.id === "string" &&
      version.id.trim() !== ""
        ? version.ressource
        : null,
    push,
  );
  validerListeObjetsUniques(
    topologie["versions-etat-durable-objects"],
    libelle,
    "versions d'état Durable Objects",
    (version) =>
      version &&
      typeof version === "object" &&
      !Array.isArray(version) &&
      listeEgale(Object.keys(version).sort(), ["namespace", "version"]) &&
      typeof version.namespace === "string" &&
      version.namespace.trim() !== "" &&
      Number.isInteger(version.version) &&
      version.version >= 1
        ? version.namespace
        : null,
    push,
  );
  const etatR2 = topologie["etat-r2"];
  validerListeObjetsUniques(
    etatR2?.formats,
    libelle,
    "formats R2",
    (format) =>
      format &&
      typeof format === "object" &&
      !Array.isArray(format) &&
      listeEgale(Object.keys(format).sort(), ["nom", "version"]) &&
      typeof format.nom === "string" &&
      format.nom.trim() !== "" &&
      Number.isInteger(format.version) &&
      format.version >= 1
        ? format.nom
        : null,
    push,
  );
  if (
    !etatR2 ||
    typeof etatR2 !== "object" ||
    Array.isArray(etatR2) ||
    !listeEgale(Object.keys(etatR2).sort(), [
      "formats",
      "generation-chaines",
      "generation-effacement",
      "generation-tombstones",
      "registre-sha256",
    ]) ||
    !Number.isInteger(etatR2["generation-chaines"]) ||
    etatR2["generation-chaines"] < 1 ||
    !Number.isInteger(etatR2["generation-tombstones"]) ||
    etatR2["generation-tombstones"] < 1 ||
    !Number.isInteger(etatR2["generation-effacement"]) ||
    etatR2["generation-effacement"] < 1 ||
    !estSha256(etatR2["registre-sha256"])
  ) {
    push(
      `${libelle} : état R2 exact (formats, chaînes, tombstones et générations d'effacement) exigé`,
    );
  }
  const generations = topologie["generations-securite"];
  validerListeObjetsUniques(
    generations?.secrets,
    libelle,
    "générations de secrets",
    (secret) =>
      secret &&
      typeof secret === "object" &&
      !Array.isArray(secret) &&
      listeEgale(Object.keys(secret).sort(), ["generation", "nom"]) &&
      typeof secret.nom === "string" &&
      secret.nom.trim() !== "" &&
      Number.isInteger(secret.generation) &&
      secret.generation >= 1
        ? secret.nom
        : null,
    push,
  );
  validerListeObjetsUniques(
    generations?.["cles-attestation"],
    libelle,
    "générations de clés d'attestation",
    (cle) =>
      cle &&
      typeof cle === "object" &&
      !Array.isArray(cle) &&
      listeEgale(Object.keys(cle).sort(), ["generation", "id"]) &&
      typeof cle.id === "string" &&
      cle.id.trim() !== "" &&
      Number.isInteger(cle.generation) &&
      cle.generation >= 1
        ? cle.id
        : null,
    push,
  );
  if (
    !generations ||
    typeof generations !== "object" ||
    Array.isArray(generations) ||
    !listeEgale(Object.keys(generations).sort(), [
      "cles-attestation",
      "generation-recuperation-sessions",
      "generations-revoquees-sha256",
      "secrets",
    ]) ||
    !Number.isInteger(generations["generation-recuperation-sessions"]) ||
    generations["generation-recuperation-sessions"] < 1 ||
    !estSha256(generations["generations-revoquees-sha256"])
  ) {
    push(
      `${libelle} : générations exactes des secrets, attestations et sessions exigées`,
    );
  }
  return topologie;
}

function registreLocal(registre) {
  return {
    recuIds: new Set(),
    recuHashes: new Set(),
    releaseIdsTransitions: new Set(),
    recusTransitions: new Set(),
    deploiementsTransitions: new Set(),
    attestationsTransitions: new Set(),
    clesApprobateurs: registre.clesApprobateurs,
  };
}

/**
 * Valide un instantané exécutable de release. Contrairement à un résumé, il
 * Le Reçu de transition reste hors de l'instantané afin d'éviter un cycle : il
 * signe ensuite le hash de cet instantané.
 */
function validerInstantaneRelease(
  adresse,
  {
    tranche,
    phase,
    instant,
    releaseId,
    redemarrage = null,
    precedent = undefined,
  },
  registre,
  push,
  libelle,
) {
  const contenu = validerContenuAdresse(adresse, libelle, push);
  const clesInstantane = [
    "contraction-punks",
    "deploiement",
    "instant",
    "phase",
    "precedent",
    "release",
    "release-id",
    "schema",
    "topologie",
    "tranche",
    ...(redemarrage === null ? [] : ["redemarrage"]),
  ];
  if (
    !contenu ||
    !listeEgale(Object.keys(contenu).sort(), clesInstantane.sort())
  ) {
    push(`${libelle} : schéma fermé d'instantané exécutable exigé`);
  }
  if (
    contenu?.schema !== "punks.release-graph-snapshot.v1" ||
    contenu.tranche !== tranche ||
    contenu.phase !== phase ||
    contenu.instant !== instant ||
    contenu["release-id"] !== releaseId
  ) {
    push(`${libelle} : identité complète de l'instantané divergente`);
    return null;
  }
  if (phase !== "contraction" && contenu["contraction-punks"] !== null) {
    push(
      `${libelle} : le diff de contraction Punks est réservé à la release de contraction séparée`,
    );
  }
  if (
    precedent !== undefined &&
    shaCanoniqueOptionnel(contenu.precedent) !==
      shaCanoniqueOptionnel(precedent)
  ) {
    push(
      `${libelle} : lien append-only vers le graphe et le Reçu précédents divergent`,
    );
  }
  if (
    redemarrage !== null &&
    (contenu.redemarrage !== redemarrage || redemarrage !== "E0")
  ) {
    push(`${libelle} : le nouvel instantané doit redémarrer à E0`);
  }
  const release = contenu.release;
  if (
    !release ||
    typeof release !== "object" ||
    Array.isArray(release) ||
    release.id !== `tranche:${tranche}` ||
    release.tranche !== tranche ||
    release.etat !== phase
  ) {
    push(`${libelle} : nœud de release complet de la phase ${phase} exigé`);
    return null;
  }
  if (!estShaCandidat(release.sha) || shaReserve(release.sha)) {
    push(
      `${libelle} : SHA Punks exact exigé, distinct des checkpoints Punks interdits`,
    );
  }
  if (
    release.staging?.deploiement !== contenu.deploiement ||
    typeof contenu.deploiement !== "string" ||
    contenu.deploiement.trim() === ""
  ) {
    push(`${libelle} : déploiement exact du candidat divergent`);
  }
  validerTopologieInstantane(contenu.topologie, libelle, push);
  if (
    redemarrage === null &&
    ["expansion", "active", "contraction"].includes(phase) &&
    (!Array.isArray(contenu.topologie?.workers) ||
      contenu.topologie.workers.length === 0 ||
      contenu.topologie.workers.some((worker) => worker?.pourcentage !== 100))
  ) {
    push(
      `${libelle} : les snapshots de phase achevée exigent tous les Workers à 100 %`,
    );
  }
  validerMateriaux(release.materiaux, release, null, push);
  validerStaging(release.staging, release, null, null, push);
  validerArtefacts(release.artefacts, release, push);
  validerDigestsProduction(release["digests-production"], release, push);
  validerPreuves(release.preuves, release, push);
  validerRetrait(release.retrait, release, null, push);
  validerAttestation(release.attestation, release, push);
  if (!Array.isArray(release.recus) || release.recus.length !== 2) {
    push(
      `${libelle} : l'instantané doit contenir exactement les Reçus signés de promotion et de retrait`,
    );
  }
  validerRecus(release.recus, release, registreLocal(registre), push);
  return { contenu, release, sha256: adresse?.sha256 };
}

function projectionCandidat(release) {
  return {
    id: release?.id,
    tranche: release?.tranche,
    sha: release?.sha,
    materiaux: release?.materiaux,
    staging: release?.staging,
    artefacts: release?.artefacts,
    "digests-production": release?.["digests-production"],
    "dossier-preuve-sha256": release?.["dossier-preuve-sha256"],
    preuves: release?.preuves,
    retrait: release?.retrait,
    attestation: release?.attestation,
    "attestation-sha256": release?.["attestation-sha256"],
    usage: release?.usage,
  };
}

function instantaneCorrespondAuSommet(instantane, release, recus, push) {
  if (!instantane) return;
  if (
    canonicalSha256(projectionCandidat(instantane.release)) !==
    canonicalSha256(projectionCandidat(release))
  ) {
    push(
      `${release.id} : le sommet logique doit refléter exactement le dernier candidat scellé du journal`,
    );
  }
  for (const recuInstantane of instantane.release.recus ?? []) {
    const recuSommet = recus.get(recuInstantane.id)?.recu;
    if (
      !recuSommet ||
      canonicalSha256(recuSommet) !== canonicalSha256(recuInstantane)
    ) {
      push(
        `${release.id} : les Reçus de promotion et de retrait du dernier instantané doivent être repris sans modification au sommet`,
      );
    }
  }
}

function validerListeObjetsUniques(
  valeur,
  libelle,
  identite,
  predicate,
  push,
  { videAutorise = false } = {},
) {
  if (!Array.isArray(valeur) || (!videAutorise && valeur.length === 0)) {
    push(`${libelle} : liste ${identite} exigée`);
    return false;
  }
  const vus = new Set();
  let valide = true;
  for (const entree of valeur) {
    const cle = predicate(entree);
    if (cle === null || vus.has(cle)) {
      valide = false;
      break;
    }
    vus.add(cle);
  }
  if (!valide) push(`${libelle} : ${identite} invalides ou dupliqués`);
  return valide;
}

const Z_UNILATERAL_95 = 1.6448536269514722;

/** Calcule la borne supérieure unilatérale de Wilson à 95 %. */
export function borneWilsonUnilaterale95(numerateur, denominateur) {
  if (
    !Number.isInteger(numerateur) ||
    !Number.isInteger(denominateur) ||
    denominateur <= 0 ||
    numerateur < 0 ||
    numerateur > denominateur
  ) {
    return null;
  }
  const proportion = numerateur / denominateur;
  const z2 = Z_UNILATERAL_95 ** 2;
  const diviseur = 1 + z2 / denominateur;
  const centre = proportion + z2 / (2 * denominateur);
  const marge =
    Z_UNILATERAL_95 *
    Math.sqrt(
      (proportion * (1 - proportion)) / denominateur +
        z2 / (4 * denominateur ** 2),
    );
  return ((centre + marge) / diviseur) * 100;
}

function presqueEgal(gauche, droite) {
  return (
    Number.isFinite(gauche) &&
    Number.isFinite(droite) &&
    Math.abs(gauche - droite) <= 1e-9 * Math.max(1, Math.abs(droite))
  );
}

function regressionPourcentage(mesure, mesureReference) {
  if (mesureReference === 0) return mesure === 0 ? 0 : null;
  return Math.max(0, ((mesure - mesureReference) / mesureReference) * 100);
}

function evaluerBaselineMetrique(baseline, mesure, baselineExigee) {
  if (
    !baseline ||
    typeof baseline !== "object" ||
    Array.isArray(baseline) ||
    !listeEgale(Object.keys(baseline).sort(), [
      "disponible",
      "export-n-1-sha256",
      "justification-acceptee",
      "justification-sha256",
      "mesure-n-1",
      "regression-pourcentage",
    ])
  ) {
    return { valide: false, respecte: false };
  }
  if (baseline.disponible === false) {
    const formeVideValide =
      baseline["mesure-n-1"] === null &&
      baseline["export-n-1-sha256"] === null &&
      baseline["regression-pourcentage"] === null &&
      baseline["justification-acceptee"] === false &&
      baseline["justification-sha256"] === null;
    return {
      valide: formeVideValide,
      respecte: formeVideValide && !baselineExigee,
    };
  }
  if (
    baseline.disponible !== true ||
    !Number.isFinite(baseline["mesure-n-1"]) ||
    baseline["mesure-n-1"] < 0 ||
    !estSha256(baseline["export-n-1-sha256"])
  ) {
    return { valide: false, respecte: false };
  }
  const regression = regressionPourcentage(mesure, baseline["mesure-n-1"]);
  const regressionExacte =
    regression === null
      ? baseline["regression-pourcentage"] === null
      : presqueEgal(baseline["regression-pourcentage"], regression);
  const justificationValide =
    baseline["justification-acceptee"] === true
      ? estSha256(baseline["justification-sha256"])
      : baseline["justification-acceptee"] === false &&
        baseline["justification-sha256"] === null;
  const valide = regressionExacte && justificationValide;
  return {
    valide,
    respecte:
      valide &&
      ((regression !== null && regression <= 20) ||
        baseline["justification-acceptee"] === true),
  };
}

function evaluerMesureStatistique(
  mesure,
  unite,
  maximum,
  { baselineExigee, resultatsAutorises, preuveDeterministeAutorisee },
) {
  if (
    !mesure ||
    typeof mesure !== "object" ||
    !Number.isFinite(mesure.mesure) ||
    mesure.mesure < 0 ||
    !Number.isFinite(mesure["borne-superieure-unilaterale-95"]) ||
    !Number.isInteger(mesure.echantillons) ||
    mesure.echantillons <= 0 ||
    !resultatsAutorises.includes(mesure.resultat) ||
    !estSha256(mesure["export-sha256"]) ||
    !["vert", "rouge", "insuffisant"].includes(mesure.resultat)
  ) {
    return { valide: false, violationRouge: false };
  }
  const baseline = evaluerBaselineMetrique(
    mesure["baseline-n-1"],
    mesure.mesure,
    baselineExigee,
  );
  if (!baseline.valide) {
    return { valide: false, violationRouge: false };
  }
  let calculValide = false;
  let respecteBudget = false;
  if (mesure.methode === "preuve-deterministe-exhaustive") {
    calculValide =
      preuveDeterministeAutorisee === true &&
      baselineExigee === false &&
      Number.isSafeInteger(mesure.numerateur) &&
      mesure.numerateur >= 0 &&
      mesure.numerateur === mesure.mesure &&
      mesure.denominateur === null &&
      mesure["borne-superieure-unilaterale-95"] === mesure.mesure;
    respecteBudget = calculValide && mesure.mesure === 0;
  } else if (unite === "pourcentage") {
    const borne = borneWilsonUnilaterale95(
      mesure.numerateur,
      mesure.denominateur,
    );
    calculValide =
      mesure.methode === "wilson-unilaterale-95" &&
      mesure.denominateur === mesure.echantillons &&
      presqueEgal(
        mesure.mesure,
        (mesure.numerateur / mesure.denominateur) * 100,
      ) &&
      borne !== null &&
      presqueEgal(mesure["borne-superieure-unilaterale-95"], borne);
    respecteBudget = calculValide && borne <= maximum;
  } else if (unite === "occurrences") {
    calculValide =
      mesure.methode === "tolerance-zero" &&
      Number.isInteger(mesure.numerateur) &&
      mesure.numerateur === mesure.mesure &&
      mesure.denominateur === null &&
      mesure["borne-superieure-unilaterale-95"] === mesure.mesure;
    respecteBudget = calculValide && mesure.mesure <= maximum;
  } else if (unite === "millisecondes") {
    calculValide =
      mesure.methode === "quantile-export-verifie" &&
      mesure.numerateur === null &&
      mesure.denominateur === null &&
      mesure["borne-superieure-unilaterale-95"] >= mesure.mesure;
    respecteBudget =
      calculValide && mesure["borne-superieure-unilaterale-95"] <= maximum;
  }
  const respecte = calculValide && respecteBudget && baseline.respecte;
  const resultatCoherent =
    mesure.resultat === "insuffisant" ||
    (mesure.resultat === "vert" && respecte) ||
    (mesure.resultat === "rouge" && !respecte);
  return {
    valide: calculValide && resultatCoherent,
    violationRouge: mesure.resultat === "rouge" && !respecte,
  };
}

function dimensionsAttenduesPourBudget(budget, moyensConnexion) {
  if (budget.nom === "connexion-desktop-echecs-par-moyen") {
    return Array.isArray(moyensConnexion) ? moyensConnexion : [];
  }
  if (budget.nom === "desktop-sessions-avec-crash-par-plateforme") {
    return PLATEFORMES;
  }
  return [];
}

function validerVerdictsMetriques(
  verdicts,
  libelle,
  push,
  {
    baselineExigee = false,
    moyensConnexion = [],
    resultatsAutorises = ["vert"],
    exigerViolationRouge = false,
    preuveDeterministeAutorisee = false,
  } = {},
) {
  if (
    !Array.isArray(verdicts) ||
    verdicts.length !== BUDGETS_PRODUCTION.length
  ) {
    push(
      `${libelle} : verdicts métriques incomplets — les ${BUDGETS_PRODUCTION.length} budgets de production et tolérances zéro sont exigés`,
    );
    return false;
  }
  let valide = true;
  let violationRouge = false;
  for (const [index, budget] of BUDGETS_PRODUCTION.entries()) {
    const verdict = verdicts[index];
    const statistique = evaluerMesureStatistique(
      verdict,
      budget.unite,
      budget.maximum,
      {
        baselineExigee,
        resultatsAutorises,
        preuveDeterministeAutorisee,
      },
    );
    const schemaValide =
      verdict &&
      typeof verdict === "object" &&
      !Array.isArray(verdict) &&
      listeEgale(Object.keys(verdict).sort(), [
        "baseline-n-1",
        "borne-superieure-unilaterale-95",
        "budget-max",
        "denominateur",
        "dimensions",
        "echantillons",
        "export-sha256",
        "mesure",
        "methode",
        "nom",
        "numerateur",
        "resultat",
        "unite",
      ]) &&
      verdict.nom === budget.nom &&
      verdict.unite === budget.unite &&
      verdict["budget-max"] === budget.maximum &&
      statistique.valide;
    const dimensionsAttendues = dimensionsAttenduesPourBudget(
      budget,
      moyensConnexion,
    );
    const dimensions = Array.isArray(verdict?.dimensions)
      ? verdict.dimensions
      : [];
    const evaluationsDimensions = dimensions.map((dimension) =>
      evaluerMesureStatistique(dimension, budget.unite, budget.maximum, {
        baselineExigee,
        resultatsAutorises,
        preuveDeterministeAutorisee,
      }),
    );
    const dimensionsValides =
      Array.isArray(verdict?.dimensions) &&
      dimensions.length === dimensionsAttendues.length &&
      dimensions.every(
        (dimension, dimensionIndex) =>
          dimension?.dimension === dimensionsAttendues[dimensionIndex] &&
          listeEgale(Object.keys(dimension).sort(), [
            "baseline-n-1",
            "borne-superieure-unilaterale-95",
            "denominateur",
            "dimension",
            "echantillons",
            "export-sha256",
            "mesure",
            "methode",
            "numerateur",
            "resultat",
          ]) &&
          evaluationsDimensions[dimensionIndex]?.valide,
      );
    violationRouge ||=
      statistique.violationRouge ||
      evaluationsDimensions.some((evaluation) => evaluation.violationRouge);
    if (!schemaValide || !dimensionsValides) {
      push(
        `${libelle} : budget « ${budget.nom} » doit prouver soit les comptes statistiques historiques et la borne unilatérale 95 % recalculée, soit les contrôles déterministes exhaustifs, avec les dimensions exactes et la comparaison N−1 recalculée ≤ 20 % ou justifiée${baselineExigee ? " (baseline Punks obligatoire)" : ""}`,
      );
      valide = false;
    }
  }
  if (exigerViolationRouge && !violationRouge) {
    push(
      `${libelle} : un échec ou une quarantaine exige au moins un verdict rouge dont la violation est recalculée`,
    );
    valide = false;
  }
  return valide;
}

/** Public bootstrap validator backed by the canonical topology rules. */
export function validateOperationalTopology(topology) {
  const errors = [];
  validerTopologieInstantane(topology, "operational topology", (error) => {
    errors.push(error);
  });
  return errors;
}

/** Public bootstrap validator backed by the canonical 36-budget rules. */
export function validateOperationalBudgetVerdicts(
  verdicts,
  {
    connectionMethods = [],
    baselineRequired = false,
    deterministicBootstrapAllowed = false,
  } = {},
) {
  const errors = [];
  validerVerdictsMetriques(
    verdicts,
    "operational budgets",
    (error) => errors.push(error),
    {
      baselineExigee: baselineRequired,
      moyensConnexion: connectionMethods,
      preuveDeterministeAutorisee: deterministicBootstrapAllowed,
    },
  );
  return errors;
}

function validerChargeOperationnelle(
  contenu,
  instantane,
  entree,
  signatures,
  registre,
  instantPhasePrecedente,
  push,
  libelle,
  { avecEngagement = false } = {},
) {
  const clesCommunes = [
    "approbateurs",
    "bookmarks",
    "cadence",
    "dlq",
    "execution-id",
    "generation-compatibilite",
    "graphe-sha256",
    "hashes-desktop",
    "heures",
    "id",
    "incidents",
    "instant",
    "outboxes",
    "precedent",
    "recu-execution-precedent-sha256",
    "release-id",
    "schema",
    "sha-punks",
    "type",
    "verdicts-metriques",
    "workers",
    "workflows",
  ];
  const clesAttendues =
    contenu?.type === "transition"
      ? [
          ...clesCommunes,
          "attestation-sha256",
          "transition",
          ...(contenu?.transition === "contraction"
            ? ["contraction-punks-sha256", "usage-sha256"]
            : []),
        ].sort()
      : contenu?.type === "roll-forward"
        ? [
            ...clesCommunes,
            "cible",
            ...(avecEngagement ? ["engagement-recuperation-sha256"] : []),
            "execution-precedente",
          ].sort()
        : null;
  if (
    clesAttendues !== null &&
    !listeEgale(Object.keys(contenu ?? {}).sort(), clesAttendues)
  ) {
    push(`${libelle} : Reçu opérationnel à schéma fermé exigé`);
  }
  const topologie = instantane?.contenu?.topologie;
  if (contenu?.["sha-punks"] !== instantane?.release?.sha) {
    push(`${libelle} : le SHA Punks du Reçu doit être celui du graphe scellé`);
  }
  if (
    shaCanoniqueOptionnel(contenu?.workers) !==
      shaCanoniqueOptionnel(topologie?.workers) ||
    shaCanoniqueOptionnel(contenu?.workflows) !==
      shaCanoniqueOptionnel(topologie?.workflows) ||
    contenu?.["generation-compatibilite"] !==
      topologie?.["generation-compatibilite"]
  ) {
    push(
      `${libelle} : versions/pourcentages Workers, Workflows et génération doivent correspondre au graphe scellé`,
    );
  }

  const phaseOperationnelle =
    contenu?.type === "roll-forward" ? "roll-forward" : contenu?.transition;
  const attendusDesktop = ["active", "contraction", "roll-forward"].includes(
    phaseOperationnelle,
  )
    ? (instantane?.release?.artefacts ?? []).map(({ plateforme, sha256 }) => ({
        plateforme,
        sha256,
      }))
    : [];
  if (
    shaCanoniqueOptionnel(contenu?.["hashes-desktop"]) !==
    canonicalSha256(attendusDesktop)
  ) {
    push(`${libelle} : hashes desktop distribués divergents du graphe scellé`);
  }

  const debut = parseInstant(contenu?.heures?.debut);
  const fin = parseInstant(contenu?.heures?.fin);
  const grapheScelleA = parseInstant(instantane?.contenu?.instant);
  if (
    debut === null ||
    fin === null ||
    debut > fin ||
    contenu.heures.fin !== entree?.instant
  ) {
    push(`${libelle} : heures de début/fin canoniques et cohérentes exigées`);
  }
  if (grapheScelleA === null || debut === null || grapheScelleA > debut) {
    push(
      `${libelle} : le graphe doit être scellé avant le premier segment acquis et indépendamment de l'instant terminal`,
    );
  }

  validerCadenceOperationnelle(
    contenu,
    instantane,
    entree,
    registre,
    instantPhasePrecedente,
    push,
    libelle,
  );

  const approbateursSignatures = Array.isArray(signatures)
    ? signatures.map((signature) => signature?.approbateur)
    : [];
  if (
    !listeUniqueNonVide(contenu?.approbateurs) ||
    canonicalSha256([...contenu.approbateurs].sort()) !==
      canonicalSha256([...approbateursSignatures].sort())
  ) {
    push(`${libelle} : approbateurs du contenu divergents des signatures`);
  }

  const baselineExigee =
    contenu?.type === "roll-forward" ||
    (Number.isInteger(instantane?.contenu?.tranche) &&
      instantane.contenu.tranche > 1);
  validerVerdictsMetriques(contenu?.["verdicts-metriques"], libelle, push, {
    baselineExigee,
    moyensConnexion: topologie?.["moyens-connexion"],
    preuveDeterministeAutorisee:
      baselineExigee === false &&
      instantane?.contenu?.tranche === 1 &&
      ["expansion", "active"].includes(phaseOperationnelle),
  });
  validerListeObjetsUniques(
    contenu?.bookmarks,
    libelle,
    "bookmarks",
    (bookmark) =>
      typeof bookmark?.autorite === "string" &&
      bookmark.autorite.trim() !== "" &&
      typeof bookmark?.valeur === "string" &&
      bookmark.valeur.trim() !== ""
        ? bookmark.autorite
        : null,
    push,
  );
  for (const [nom, valeur] of [
    ["DLQ", contenu?.dlq],
    ["outboxes", contenu?.outboxes],
  ]) {
    const compteur = nom === "DLQ" ? valeur?.messages : valeur?.["en-attente"];
    if (
      !Number.isInteger(compteur) ||
      compteur < 0 ||
      (nom === "DLQ" && compteur !== 0) ||
      !estSha256(valeur?.["export-sha256"])
    ) {
      push(`${libelle} : état ${nom} et export sha256 exigés`);
    }
  }
  validerListeObjetsUniques(
    contenu?.incidents,
    libelle,
    "incidents",
    (incident) =>
      typeof incident?.id === "string" &&
      incident.id.trim() !== "" &&
      ["critique", "non-critique"].includes(incident?.criticite) &&
      ["ouvert", "resolu"].includes(incident?.statut)
        ? incident.id
        : null,
    push,
    { videAutorise: true },
  );
  if (
    Array.isArray(contenu?.incidents) &&
    contenu.incidents.some(
      (incident) =>
        incident?.criticite === "critique" && incident?.statut !== "resolu",
    )
  ) {
    push(
      `${libelle} : aucun incident critique non résolu ne peut clore une phase verte`,
    );
  }
}

const PREUVE_CONDITIONNELLE_PAR_ETAPE = Object.freeze({
  E0: "parcours-cibles-et-gates-synthetiques",
  E2: "operations-profil-observees",
  E3: "representativite-clients",
  E4: "equilibre-projections-asynchrones",
  A1: "gates-plateformes-fournisseurs",
  A2: "absence-incidents-herites",
});

function seriePreuvesValide(liste, cles, identite, predicate) {
  if (!Array.isArray(liste) || liste.length === 0) return false;
  const vus = new Set();
  return liste.every((element) => {
    const cle = element?.[identite];
    const valide =
      element &&
      typeof element === "object" &&
      !Array.isArray(element) &&
      listeEgale(Object.keys(element).sort(), [...cles].sort()) &&
      typeof cle === "string" &&
      cle.trim() !== "" &&
      !vus.has(cle) &&
      predicate(element);
    if (valide) vus.add(cle);
    return valide;
  });
}

function validerPreuvesConditionnellesEtape(
  preuves,
  attendu,
  instantane,
  push,
  libelle,
) {
  const typeAttendu = PREUVE_CONDITIONNELLE_PAR_ETAPE[attendu?.etape] ?? null;
  if (typeAttendu === null) {
    if (!Array.isArray(preuves) || preuves.length !== 0) {
      push(
        `${libelle} : aucune preuve conditionnelle supplémentaire n'est admise`,
      );
    }
    return;
  }
  if (
    !Array.isArray(preuves) ||
    preuves.length !== 1 ||
    preuves[0]?.type !== typeAttendu
  ) {
    push(
      `${libelle} : preuve conditionnelle « ${typeAttendu} » unique et signée exigée`,
    );
    return;
  }
  const preuve = preuves[0];
  const moyensConnexion =
    instantane?.contenu?.topologie?.["moyens-connexion"] ?? [];
  let valide = false;
  if (attendu.etape === "E0") {
    valide =
      listeEgale(Object.keys(preuve).sort(), [
        "gates-synthetiques",
        "parcours-cibles",
        "type",
      ]) &&
      seriePreuvesValide(
        preuve["parcours-cibles"],
        ["export-sha256", "nom", "resultat"],
        "nom",
        (element) =>
          element.resultat === "vert" && estSha256(element["export-sha256"]),
      ) &&
      seriePreuvesValide(
        preuve["gates-synthetiques"],
        ["export-sha256", "nom", "resultat"],
        "nom",
        (element) =>
          element.resultat === "vert" && estSha256(element["export-sha256"]),
      );
  } else if (attendu.etape === "E2") {
    const profil = instantane?.release?.materiaux?.profil;
    valide =
      listeEgale(Object.keys(preuve).sort(), [
        "couverture",
        "operations",
        "profil",
        "type",
      ]) &&
      preuve.couverture === "complete" &&
      shaCanoniqueOptionnel(preuve.profil) ===
        shaCanoniqueOptionnel({
          id: profil?.id,
          version: profil?.version,
          sha256: profil?.sha256,
        }) &&
      seriePreuvesValide(
        preuve.operations,
        ["export-sha256", "nom", "observations"],
        "nom",
        (element) =>
          Number.isInteger(element.observations) &&
          element.observations > 0 &&
          estSha256(element["export-sha256"]),
      );
  } else if (attendu.etape === "E3") {
    const plateformes = Array.isArray(preuve.plateformes)
      ? preuve.plateformes
      : [];
    const moyens = Array.isArray(preuve["moyens-connexion"])
      ? preuve["moyens-connexion"]
      : [];
    valide =
      listeEgale(Object.keys(preuve).sort(), [
        "moyens-connexion",
        "plateformes",
        "type",
      ]) &&
      plateformes.length === PLATEFORMES.length &&
      plateformes.every(
        (element, index) =>
          listeEgale(Object.keys(element ?? {}).sort(), [
            "echantillons",
            "export-sha256",
            "plateforme",
          ]) &&
          element.plateforme === PLATEFORMES[index] &&
          Number.isInteger(element.echantillons) &&
          element.echantillons > 0 &&
          estSha256(element["export-sha256"]),
      ) &&
      moyens.length === moyensConnexion.length &&
      moyens.every(
        (element, index) =>
          listeEgale(Object.keys(element ?? {}).sort(), [
            "echantillons",
            "export-sha256",
            "moyen",
          ]) &&
          element.moyen === moyensConnexion[index] &&
          Number.isInteger(element.echantillons) &&
          element.echantillons > 0 &&
          estSha256(element["export-sha256"]),
      );
  } else if (attendu.etape === "E4") {
    valide =
      listeEgale(Object.keys(preuve).sort(), [
        "projections",
        "resultat",
        "travaux-asynchrones",
        "type",
      ]) &&
      preuve.resultat === "equilibre" &&
      seriePreuvesValide(
        preuve.projections,
        ["export-sha256", "nom", "retard-ms"],
        "nom",
        (element) =>
          element["retard-ms"] === 0 && estSha256(element["export-sha256"]),
      ) &&
      seriePreuvesValide(
        preuve["travaux-asynchrones"],
        ["age-max-ms", "en-attente", "export-sha256", "nom"],
        "nom",
        (element) =>
          element["age-max-ms"] === 0 &&
          element["en-attente"] === 0 &&
          estSha256(element["export-sha256"]),
      );
  } else if (attendu.etape === "A1") {
    const gatesAttendues = PLATEFORMES.flatMap((plateforme) =>
      moyensConnexion.map((fournisseur) => ({ plateforme, fournisseur })),
    );
    const gates = Array.isArray(preuve.gates) ? preuve.gates : [];
    valide =
      listeEgale(Object.keys(preuve).sort(), ["gates", "type"]) &&
      gates.length === gatesAttendues.length &&
      gates.every(
        (gate, index) =>
          listeEgale(Object.keys(gate ?? {}).sort(), [
            "export-sha256",
            "fournisseur",
            "plateforme",
            "resultat",
          ]) &&
          gate.plateforme === gatesAttendues[index].plateforme &&
          gate.fournisseur === gatesAttendues[index].fournisseur &&
          gate.resultat === "vert" &&
          estSha256(gate["export-sha256"]),
      );
  } else if (attendu.etape === "A2") {
    valide =
      listeEgale(Object.keys(preuve).sort(), [
        "incidents-herites",
        "registre-sha256",
        "type",
      ]) &&
      Array.isArray(preuve["incidents-herites"]) &&
      preuve["incidents-herites"].length === 0 &&
      estSha256(preuve["registre-sha256"]);
  }
  if (!valide) {
    push(
      `${libelle} : la preuve conditionnelle « ${typeAttendu} » doit être complète, exacte et verte`,
    );
  }
}

function validerCadenceOperationnelle(
  contenu,
  instantane,
  entree,
  registre,
  instantPhasePrecedente,
  push,
  libelle,
  { prefixeAutorise = false } = {},
) {
  const phase =
    contenu?.type === "roll-forward" ? "roll-forward" : contenu?.transition;
  const statefulNonSplittable =
    instantane?.contenu?.topologie?.["migration-stateful"]?.mode ===
    "non-splittable";
  const clePolitique = statefulNonSplittable
    ? phase === "expansion"
      ? "expansion-stateful"
      : phase === "roll-forward"
        ? "roll-forward-stateful"
        : phase
    : phase;
  const politique = CADENCES_OPERATIONNELLES[clePolitique];
  const cadence = contenu?.cadence;
  const longueurValide =
    Array.isArray(cadence) &&
    (prefixeAutorise
      ? cadence.length <= (politique?.length ?? -1)
      : cadence.length === politique?.length);
  if (!politique || !longueurValide) {
    push(
      prefixeAutorise
        ? `${libelle} : la progression doit être un préfixe ordonné et sans saut de la cadence fermée ${String(phase)}`
        : `${libelle} : cadence fermée ${String(phase)} complète, ordonnée et sans saut exigée`,
    );
    return;
  }

  if (prefixeAutorise && cadence.length === 0) return;

  let finPrecedente = null;
  let premierDebut = null;
  let derniereFin = null;
  let precedentEtapeSha256 = null;
  const bornePrecedente = parseInstant(instantPhasePrecedente);
  cadence.forEach((recuEtape, index) => {
    const attendu = politique[index];
    const etape = validerRecuSigne(
      recuEtape,
      `${libelle} : cadence ${attendu.etape}`,
      registre,
      push,
      { approbateursAttendus: contenu?.approbateurs },
    );
    const identifiantAttendu = `recu-etape-${phase}-${attendu.etape}-${contenu?.["graphe-sha256"]}`;
    const clesAttendues = [
      "approbateurs",
      "bookmarks",
      "couverture-pilote",
      "dlq",
      "duree-minimale-heures",
      "etape",
      "exposition",
      "generation-compatibilite",
      "graphe-sha256",
      "hashes-desktop",
      "heures",
      "id",
      "incidents",
      "outboxes",
      "phase",
      "precedent-etape-sha256",
      "preuve-preparation-stateful-sha256",
      "preuves-etape",
      "release-id",
      "schema",
      "segments",
      "sha-punks",
      "type",
      "verdicts-metriques",
      "verdicts-metriques-sha256",
      "workers",
      "workflows",
    ];
    if (!etape) return;
    if (!listeEgale(Object.keys(etape).sort(), clesAttendues)) {
      push(
        `${libelle} : cadence ${attendu.etape} contient un schéma ouvert ou incomplet`,
      );
    }
    if (
      etape.schema !== "punks.release-receipt.v1" ||
      etape.id !== identifiantAttendu ||
      etape.type !== "etape" ||
      etape.phase !== phase ||
      etape["release-id"] !== contenu?.["release-id"] ||
      etape["sha-punks"] !== contenu?.["sha-punks"] ||
      etape.etape !== attendu.etape ||
      etape.exposition !== attendu.exposition ||
      etape["duree-minimale-heures"] !== attendu.heures ||
      etape["graphe-sha256"] !== contenu?.["graphe-sha256"] ||
      etape["precedent-etape-sha256"] !== precedentEtapeSha256 ||
      etape["verdicts-metriques-sha256"] !==
        shaCanoniqueOptionnel(etape["verdicts-metriques"])
    ) {
      const divergences = Object.entries({
        schema: etape.schema === "punks.release-receipt.v1",
        id: etape.id === identifiantAttendu,
        type: etape.type === "etape",
        phase: etape.phase === phase,
        release: etape["release-id"] === contenu?.["release-id"],
        sha: etape["sha-punks"] === contenu?.["sha-punks"],
        etape: etape.etape === attendu.etape,
        exposition: etape.exposition === attendu.exposition,
        duree: etape["duree-minimale-heures"] === attendu.heures,
        graphe: etape["graphe-sha256"] === contenu?.["graphe-sha256"],
        precedent: etape["precedent-etape-sha256"] === precedentEtapeSha256,
        metriques:
          etape["verdicts-metriques-sha256"] ===
          shaCanoniqueOptionnel(etape["verdicts-metriques"]),
      })
        .filter(([, valide]) => !valide)
        .map(([nom]) => nom)
        .join(", ");
      push(
        `${libelle} : cadence ${attendu.etape} doit lier l'exposition, le graphe et les métriques exacts (divergences : ${divergences})`,
      );
    }
    const couverturePilote = etape["couverture-pilote"];
    if (
      (phase === "active" || phase === "roll-forward") &&
      attendu.etape === "A0"
    ) {
      const plateformes = couverturePilote?.plateformes;
      const plateformesValides =
        Array.isArray(plateformes) &&
        plateformes.length === PLATEFORMES.length &&
        plateformes.every(
          (plateforme, plateformeIndex) =>
            plateforme?.plateforme === PLATEFORMES[plateformeIndex] &&
            Number.isInteger(plateforme?.["sessions-humaines"]) &&
            plateforme["sessions-humaines"] >= 30 &&
            listeEgale(Object.keys(plateforme).sort(), [
              "plateforme",
              "sessions-humaines",
            ]),
        );
      if (
        !couverturePilote ||
        typeof couverturePilote !== "object" ||
        Array.isArray(couverturePilote) ||
        !listeEgale(Object.keys(couverturePilote).sort(), [
          "artefacts-finaux-signes",
          "comptes-punks-reels",
          "moyens-connexion",
          "plateformes",
          "workspaces",
        ]) ||
        couverturePilote["artefacts-finaux-signes"] !== true ||
        couverturePilote["comptes-punks-reels"] !== true ||
        !Number.isInteger(couverturePilote.workspaces) ||
        couverturePilote.workspaces < 2 ||
        !Array.isArray(couverturePilote["moyens-connexion"]) ||
        !Array.isArray(instantane?.contenu?.topologie?.["moyens-connexion"]) ||
        !listeEgale(
          couverturePilote["moyens-connexion"],
          instantane?.contenu?.topologie?.["moyens-connexion"],
        ) ||
        !plateformesValides
      ) {
        push(
          `${libelle} : cadence A0 exige 30 sessions humaines par plateforme, tous les Moyens de connexion, deux Workspaces et les artefacts finaux signés en production`,
        );
      }
    } else if (couverturePilote !== null) {
      push(
        `${libelle} : la couverture pilote humaine est réservée à l'étape A0`,
      );
    }
    const preuvePreparationStateful =
      etape["preuve-preparation-stateful-sha256"];
    if (clePolitique.endsWith("-stateful") && attendu.etape === "P0") {
      if (!estSha256(preuvePreparationStateful)) {
        push(
          `${libelle} : cadence P0 exige le digest signé du résultat de préparation/backfill acquis pendant 24 h`,
        );
      }
    } else if (preuvePreparationStateful !== null) {
      push(`${libelle} : la preuve de préparation stateful est réservée à P0`);
    }
    validerPreuvesConditionnellesEtape(
      etape["preuves-etape"],
      attendu,
      instantane,
      push,
      `${libelle} : cadence ${attendu.etape}`,
    );

    const pourcentage =
      attendu.etape === "P0"
        ? "0"
        : /^workers:(\d+)%/.exec(attendu.exposition)?.[1];
    const workersAttendus = structuredClone(
      instantane?.contenu?.topologie?.workers ?? [],
    );
    if (pourcentage !== undefined) {
      for (const worker of workersAttendus) {
        worker.pourcentage = Number(pourcentage);
      }
    }
    const desktopAttendu =
      ["active", "contraction"].includes(phase) ||
      (phase === "roll-forward" && attendu.etape.startsWith("A"))
        ? (instantane?.release?.artefacts ?? []).map(
            ({ plateforme, sha256 }) => ({
              plateforme,
              sha256,
            }),
          )
        : [];
    const verdictEtapeValide = validerVerdictsMetriques(
      etape["verdicts-metriques"],
      `${libelle} : cadence ${attendu.etape}`,
      push,
      {
        baselineExigee:
          phase === "roll-forward" ||
          (Number.isInteger(instantane?.contenu?.tranche) &&
            instantane.contenu.tranche > 1),
        moyensConnexion: instantane?.contenu?.topologie?.["moyens-connexion"],
        preuveDeterministeAutorisee:
          ["expansion", "active"].includes(phase) &&
          instantane?.contenu?.tranche === 1,
      },
    );
    if (
      shaCanoniqueOptionnel(etape.workers) !==
        canonicalSha256(workersAttendus) ||
      shaCanoniqueOptionnel(etape.workflows) !==
        shaCanoniqueOptionnel(instantane?.contenu?.topologie?.workflows) ||
      etape["generation-compatibilite"] !==
        instantane?.contenu?.topologie?.["generation-compatibilite"] ||
      shaCanoniqueOptionnel(etape["hashes-desktop"]) !==
        canonicalSha256(desktopAttendu) ||
      !verdictEtapeValide
    ) {
      push(
        `${libelle} : cadence ${attendu.etape} doit embarquer la topologie, la distribution desktop et les métriques exactes de cette étape`,
      );
    }
    validerListeObjetsUniques(
      etape.bookmarks,
      `${libelle} : cadence ${attendu.etape}`,
      "bookmarks",
      (bookmark) =>
        typeof bookmark?.autorite === "string" &&
        bookmark.autorite.trim() !== "" &&
        typeof bookmark?.valeur === "string" &&
        bookmark.valeur.trim() !== ""
          ? bookmark.autorite
          : null,
      push,
    );
    if (
      etape.dlq?.messages !== 0 ||
      !estSha256(etape.dlq?.["export-sha256"]) ||
      !Number.isInteger(etape.outboxes?.["en-attente"]) ||
      etape.outboxes["en-attente"] < 0 ||
      !estSha256(etape.outboxes?.["export-sha256"])
    ) {
      push(
        `${libelle} : cadence ${attendu.etape} exige les états DLQ/outboxes exportés et admissibles`,
      );
    }
    validerListeObjetsUniques(
      etape.incidents,
      `${libelle} : cadence ${attendu.etape}`,
      "incidents",
      (incident) =>
        typeof incident?.id === "string" &&
        incident.id.trim() !== "" &&
        ["critique", "non-critique"].includes(incident?.criticite) &&
        ["ouvert", "resolu"].includes(incident?.statut)
          ? incident.id
          : null,
      push,
      { videAutorise: true },
    );
    if (
      etape?.incidents?.some(
        (incident) =>
          incident?.criticite === "critique" && incident?.statut !== "resolu",
      )
    ) {
      push(
        `${libelle} : cadence ${attendu.etape} refuse tout incident critique non résolu`,
      );
    }

    const segments = Array.isArray(etape.segments) ? etape.segments : [];
    if (segments.length === 0) {
      push(
        `${libelle} : cadence ${attendu.etape} doit contenir au moins un segment acquis`,
      );
    }
    let dureeAcquise = 0;
    let finSegmentPrecedent = null;
    let debutEtape = null;
    let finEtape = null;
    for (const [segmentIndex, segment] of segments.entries()) {
      if (
        !segment ||
        typeof segment !== "object" ||
        Array.isArray(segment) ||
        !listeEgale(Object.keys(segment).sort(), [
          "debut",
          "echantillons-suffisants",
          "fin",
          "graphe-sha256",
          "resultat",
          "verdicts-metriques-sha256",
        ])
      ) {
        push(
          `${libelle} : cadence ${attendu.etape} segment #${segmentIndex + 1} invalide`,
        );
        continue;
      }
      const debutSegment = parseInstant(segment.debut);
      const finSegment = parseInstant(segment.fin);
      if (
        debutSegment === null ||
        finSegment === null ||
        debutSegment >= finSegment ||
        (finSegmentPrecedent !== null && debutSegment < finSegmentPrecedent) ||
        segment["graphe-sha256"] !== contenu?.["graphe-sha256"] ||
        segment["verdicts-metriques-sha256"] !==
          shaCanoniqueOptionnel(etape["verdicts-metriques"]) ||
        segment.resultat !== "vert" ||
        segment["echantillons-suffisants"] !== true
      ) {
        push(
          `${libelle} : cadence ${attendu.etape} exige des segments UTC verts, non chevauchants, avec graphe et échantillons inchangés`,
        );
      }
      if (debutSegment !== null && finSegment !== null) {
        dureeAcquise += Math.max(0, finSegment - debutSegment);
        if (debutEtape === null) debutEtape = debutSegment;
        finEtape = finSegment;
        finSegmentPrecedent = finSegment;
        if (index === 0 && segmentIndex === 0) {
          premierDebut = segment.debut;
        }
        derniereFin = segment.fin;
      }
    }
    if (dureeAcquise < attendu.heures * HEURE_MS) {
      push(
        `${libelle} : cadence ${attendu.etape} doit cumuler au moins ${attendu.heures} heure(s) acquises`,
      );
    }
    if (
      etape.heures?.debut !== etape.segments?.[0]?.debut ||
      etape.heures?.fin !== etape.segments?.at(-1)?.fin
    ) {
      push(
        `${libelle} : cadence ${attendu.etape} doit borner exactement ses segments cumulés`,
      );
    }
    if (
      debutEtape !== null &&
      ((finPrecedente !== null && debutEtape < finPrecedente) ||
        (index === 0 &&
          bornePrecedente !== null &&
          debutEtape < bornePrecedente))
    ) {
      push(
        `${libelle} : cadence ${attendu.etape} ne peut commencer avant la fin de la phase précédente ni chevaucher une étape`,
      );
    }
    if (finEtape !== null) finPrecedente = finEtape;
    if (estSha256(recuEtape?.sha256)) precedentEtapeSha256 = recuEtape.sha256;
  });

  if (
    contenu?.heures?.debut !== premierDebut ||
    contenu?.heures?.fin !== derniereFin ||
    derniereFin !== entree?.instant
  ) {
    push(
      `${libelle} : les heures doivent borner exactement toute la cadence jusqu'à l'instant scellé`,
    );
  }
}

function validerContractionPunks(
  contraction,
  instantane,
  instantaneSource,
  libelle,
  push,
) {
  if (
    !contraction ||
    typeof contraction !== "object" ||
    Array.isArray(contraction) ||
    !listeEgale(Object.keys(contraction).sort(), [
      "graphe-source-sha256",
      "materiaux-resultat-sha256",
      "materiaux-source-sha256",
      "retraits",
    ])
  ) {
    push(`${libelle} : diff fermé de contraction Punks exigé`);
    return null;
  }
  const materiauxSource = instantaneSource?.release?.materiaux;
  const materiauxResultat = instantane?.release?.materiaux;
  if (
    contraction["graphe-source-sha256"] !== instantaneSource?.sha256 ||
    contraction["materiaux-source-sha256"] !==
      shaCanoniqueOptionnel(materiauxSource) ||
    contraction["materiaux-resultat-sha256"] !==
      shaCanoniqueOptionnel(materiauxResultat) ||
    shaCanoniqueOptionnel(materiauxSource) ===
      shaCanoniqueOptionnel(materiauxResultat)
  ) {
    push(
      `${libelle} : la contraction doit lier le snapshot actif source et des matériaux Punks réellement modifiés`,
    );
  }
  const categories = new Set();
  const identifiants = new Set();
  const retraitsValides =
    Array.isArray(contraction.retraits) &&
    contraction.retraits.length === 3 &&
    contraction.retraits.every((retrait) => {
      const identite = `${String(retrait?.categorie)}\u0000${String(retrait?.identifiant)}`;
      const valide =
        retrait &&
        typeof retrait === "object" &&
        !Array.isArray(retrait) &&
        listeEgale(Object.keys(retrait).sort(), [
          "categorie",
          "identifiant",
          "preuve-sha256",
        ]) &&
        ["contrat", "format", "chemin"].includes(retrait.categorie) &&
        typeof retrait.identifiant === "string" &&
        retrait.identifiant.trim() !== "" &&
        estSha256(retrait["preuve-sha256"]) &&
        !categories.has(retrait.categorie) &&
        !identifiants.has(identite);
      if (valide) {
        categories.add(retrait.categorie);
        identifiants.add(identite);
      }
      return valide;
    }) &&
    ["contrat", "format", "chemin"].every((categorie) =>
      categories.has(categorie),
    );
  if (!retraitsValides) {
    push(
      `${libelle} : contrats, formats et chemins Punks N−1 retirés doivent être énumérés séparément avec leurs preuves`,
    );
  }
  return canonicalSha256(contraction);
}

function validerJournal(journal, release, recus, registre, push) {
  const rang = rangEtat(release.etat);
  const vide = {
    expansion: null,
    active: null,
    contraction: null,
    instants: { expansion: null, active: null, contraction: null },
    debutsCadence: { expansion: null, active: null, contraction: null },
    instantanes: {},
  };
  if (rang <= 0) {
    if (Array.isArray(journal) && journal.length > 0) {
      push(
        `${release.id} : un candidat en preparation n'a pas de journal de transitions`,
      );
    }
    return vide;
  }
  if (!Array.isArray(journal) || journal.length !== rang) {
    push(
      `${release.id} : journal append-only incomplet — ${rang} transition(s) attendue(s) pour l'état ${release.etat}`,
    );
    return vide;
  }

  const dates = { expansion: null, active: null, contraction: null };
  const instants = { expansion: null, active: null, contraction: null };
  const debutsCadence = { expansion: null, active: null, contraction: null };
  const instantanes = {};
  let instantPrecedent = null;
  let dernierInstantane = null;
  let lienPrecedent = null;

  journal.forEach((entree, index) => {
    const attendue = CHAINE_TRANSITIONS[index];
    if (!entree || entree.vers !== attendue) {
      push(
        `${release.id} : journal #${index + 1} doit être la transition « ${attendue} » (append-only, sans régression ni saut)`,
      );
    }
    const date = parseDate(entree?.date);
    if (date === null) {
      push(
        `${release.id} : journal « ${attendue} » sans date YYYY-MM-DD valide`,
      );
    }
    const instant = parseInstant(entree?.instant);
    const grapheScelleA = parseInstant(entree?.["graphe-scelle-a"]);
    if (
      instant === null ||
      (typeof entree?.date === "string" &&
        entree.instant?.slice(0, 10) !== entree.date)
    ) {
      push(
        `${release.id} : journal « ${attendue} » sans instant UTC canonique cohérent avec sa date`,
      );
    } else {
      if (instantPrecedent !== null && instant <= instantPrecedent) {
        push(
          `${release.id} : journal « ${attendue} » doit être strictement postérieur à la transition précédente (append-only)`,
        );
      }
      instantPrecedent = instant;
    }
    if (
      attendue !== "contractee" &&
      (grapheScelleA === null || instant === null || grapheScelleA > instant)
    ) {
      push(
        `${release.id} : journal « ${attendue} » doit distinguer un instant de scellement du graphe antérieur à sa clôture`,
      );
    }
    if (dates[attendue] === null) dates[attendue] = date;
    if (attendue in instants && instants[attendue] === null) {
      instants[attendue] = instant;
    }

    if (attendue === "contractee") {
      const cles = Object.keys(entree ?? {}).sort();
      if (!listeEgale(cles, ["date", "instant", "vers"])) {
        push(
          `${release.id} : contractee est l'état terminal de la release de contraction, jamais une quatrième release distincte`,
        );
      }
      return;
    }

    const releaseId = entree?.["release-id"];
    if (typeof releaseId !== "string" || releaseId.trim() === "") {
      push(
        `${release.id} : journal « ${attendue} » décrit une release distincte sans identifiant`,
      );
    } else if (registre.releaseIdsTransitions.has(releaseId)) {
      push(
        `${release.id} : identifiant de release de transition dupliqué « ${releaseId} »`,
      );
    } else {
      registre.releaseIdsTransitions.add(releaseId);
    }

    const recuLie = recus.get(entree?.recu);
    const contenuRecu = recuLie?.contenu;
    if (typeof entree?.recu !== "string" || !recuLie) {
      push(
        `${release.id} : journal « ${attendue} » doit citer le Reçu immuable de sa release distincte`,
      );
    } else if (registre.recusTransitions.has(entree.recu)) {
      push(
        `${release.id} : le Reçu « ${entree.recu} » est rejoué sur plusieurs transitions`,
      );
    } else {
      registre.recusTransitions.add(entree.recu);
    }

    const instantanePrecedent = dernierInstantane;
    const instantane = validerInstantaneRelease(
      entree?.graphe,
      {
        tranche: release.tranche,
        phase: attendue,
        instant: entree?.["graphe-scelle-a"],
        releaseId,
        precedent: lienPrecedent,
      },
      registre,
      push,
      `${release.id} : graphe de « ${attendue} »`,
    );
    if (instantane) {
      instantanes[attendue] = instantane;
      dernierInstantane = instantane;
    }
    const shaInstantane = instantane?.release?.sha;
    const artefactsSha256 = canonicalSha256(
      Array.isArray(instantane?.release?.artefacts)
        ? instantane.release.artefacts
        : [],
    );
    const usageSha256 =
      attendue === "contraction" && Array.isArray(instantane?.release?.usage)
        ? canonicalSha256(instantane.release.usage)
        : null;
    const contractionPunksSha256 =
      attendue === "contraction"
        ? validerContractionPunks(
            instantane?.contenu?.["contraction-punks"],
            instantane,
            instantanePrecedent,
            `${release.id} : contraction Punks`,
            push,
          )
        : null;
    const debutCadence = parseInstant(
      contenuRecu?.cadence?.[0]?.contenu?.segments?.[0]?.debut,
    );
    const dateDebutCadence =
      typeof contenuRecu?.cadence?.[0]?.contenu?.segments?.[0]?.debut ===
      "string"
        ? parseDate(
            contenuRecu.cadence[0].contenu.segments[0].debut.slice(0, 10),
          )
        : null;
    if (attendue in debutsCadence) {
      debutsCadence[attendue] = debutCadence;
    }
    if (entree?.sha !== shaInstantane) {
      push(
        `${release.id} : journal « ${attendue} » doit sceller le SHA exact de son candidat distinct`,
      );
    }
    const deploiementValide =
      typeof entree?.deploiement === "string" &&
      entree.deploiement.trim() !== "";
    if (
      !deploiementValide ||
      entree.deploiement !== instantane?.contenu?.deploiement
    ) {
      push(
        `${release.id} : journal « ${attendue} » doit sceller le déploiement exact de son graphe`,
      );
    }
    if (
      deploiementValide &&
      registre.deploiementsTransitions.has(entree.deploiement)
    ) {
      push(
        `${release.id} : déploiement de transition rejoué « ${entree.deploiement} »`,
      );
    } else if (deploiementValide) {
      registre.deploiementsTransitions.add(entree.deploiement);
    }
    if (entree?.["artefacts-sha256"] !== artefactsSha256) {
      push(
        `${release.id} : journal « ${attendue} » doit sceller le hash canonique des artefacts distribués de son graphe`,
      );
    }
    if (attendue === "contraction") {
      if (!estSha256(usageSha256) || entree?.["usage-sha256"] !== usageSha256) {
        push(
          `${release.id} : journal « contraction » doit sceller la fenêtre exacte des 14 jours d'usage`,
        );
      }
      validerUsage(instantane?.release ?? {}, dateDebutCadence, push);
    }

    const grapheSha = entree?.graphe?.sha256;
    const attestation = entree?.attestation;
    const attestationValide =
      attestation &&
      typeof attestation === "object" &&
      !Array.isArray(attestation) &&
      attestation.schema === "punks.transition-attestation.v1" &&
      attestation["release-id"] === releaseId &&
      attestation.transition === attendue &&
      attestation.instant === entree?.instant &&
      attestation["graphe-scelle-a"] === entree?.["graphe-scelle-a"] &&
      shaCanoniqueOptionnel(attestation.precedent) ===
        shaCanoniqueOptionnel(lienPrecedent) &&
      attestation.sha === shaInstantane &&
      attestation.deploiement === entree?.deploiement &&
      attestation["artefacts-sha256"] === artefactsSha256 &&
      (attendue !== "contraction" ||
        (attestation["usage-sha256"] === usageSha256 &&
          attestation["contraction-punks-sha256"] ===
            contractionPunksSha256)) &&
      attestation["graphe-sha256"] === grapheSha;
    const publicationAttestationValide = listeEgale(
      attestation?.publiee,
      PUBLICATION,
    );
    if (!attestationValide || !publicationAttestationValide) {
      push(
        `${release.id} : journal « ${attendue} » doit porter l'attestation exacte de sa release et de son graphe distincts`,
      );
    }
    const attestationSha = entree?.["attestation-sha256"];
    if (
      !estSha256(attestationSha) ||
      !attestation ||
      canonicalSha256(attestation) !== attestationSha
    ) {
      push(
        `${release.id} : journal « ${attendue} » a un hash canonique du contenu d'attestation divergent`,
      );
    } else if (registre.attestationsTransitions.has(attestationSha)) {
      push(
        `${release.id} : attestation de transition rejouée « ${attestationSha} »`,
      );
    } else {
      registre.attestationsTransitions.add(attestationSha);
    }

    if (
      contenuRecu?.type !== "transition" ||
      contenuRecu["release-id"] !== releaseId ||
      contenuRecu.transition !== attendue ||
      contenuRecu.instant !== entree?.instant ||
      contenuRecu["attestation-sha256"] !== attestationSha ||
      shaCanoniqueOptionnel(contenuRecu.precedent) !==
        shaCanoniqueOptionnel(lienPrecedent) ||
      (attendue === "contraction" &&
        (contenuRecu["usage-sha256"] !== usageSha256 ||
          contenuRecu["contraction-punks-sha256"] !==
            contractionPunksSha256)) ||
      contenuRecu["graphe-sha256"] !== grapheSha
    ) {
      push(
        `${release.id} : le Reçu de « ${attendue} » doit lier la release, l'instant, l'attestation et le graphe exacts`,
      );
    }
    validerChargeOperationnelle(
      contenuRecu,
      instantane,
      entree,
      recuLie?.recu?.signatures,
      registre,
      index > 0 ? journal[index - 1]?.instant : null,
      push,
      `${release.id} : Reçu de « ${attendue} »`,
    );
    if (estSha256(grapheSha) && estSha256(recuLie?.recu?.sha256)) {
      lienPrecedent = {
        "graphe-sha256": grapheSha,
        "recu-sha256": recuLie.recu.sha256,
      };
    }
  });

  instantaneCorrespondAuSommet(dernierInstantane, release, recus, push);
  const recusConsommes = new Set(
    (Array.isArray(journal) ? journal : [])
      .filter((entree) => entree?.vers !== "contractee")
      .map((entree) => entree?.recu),
  );
  for (const [recuId, { contenu }] of recus) {
    if (["promotion", "retrait"].includes(contenu?.type)) continue;
    if (!recusConsommes.has(recuId)) {
      push(
        `${release.id} : le Reçu « ${recuId} » est orphelin — chaque Reçu de transition doit être consommé exactement une fois par le journal`,
      );
    }
  }
  if (recus.size !== 2 + recusConsommes.size) {
    push(
      `${release.id} : exactement deux Reçus candidat et un Reçu par transition non terminale sont exigés`,
    );
  }
  return { ...dates, instants, debutsCadence, instantanes };
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
  if (successeur.tranche !== release.tranche + 1) {
    push(
      `${release.id} : le successeur doit être la tranche immédiatement suivante (attendu tranche:${release.tranche + 1}, reçu ${successeur.id})`,
    );
  }
  if (release.etat === "contraction" && successeur.etat !== "active") {
    push(
      `${release.id} : le successeur ${successeur.id} doit être la release actuellement active pendant la contraction de N−1`,
    );
    return;
  }
  const instantContraction = dates.debutsCadence?.contraction ?? null;
  const instantActiveSuccesseur = instantTransition(successeur, "active");
  if (instantContraction === null) {
    return; // déjà signalé par le journal de la release contractée
  }
  if (instantActiveSuccesseur === null) {
    push(
      `${release.id} : le successeur ${successeur.id} n'a jamais atteint l'état active`,
    );
    return;
  }
  const jours = Math.floor(
    (instantContraction - instantActiveSuccesseur) / JOUR_MS,
  );
  if (jours < FENETRE_SUPPORT_JOURS) {
    push(
      `${release.id} : contraction interdite — le successeur ${successeur.id} est actif depuis ${jours} jour(s), N et N−1 restent supportés au moins ${FENETRE_SUPPORT_JOURS} jours`,
    );
  }
  validerUsage(
    release,
    parseDate(new Date(instantContraction).toISOString().slice(0, 10)),
    push,
  );
}

function instantTransition(release, transition) {
  const entree = Array.isArray(release?.journal)
    ? release.journal.find((e) => e?.vers === transition)
    : undefined;
  return entree ? parseInstant(entree.instant) : null;
}

function estActiveA(release, instant) {
  const activation = instantTransition(release, "active");
  if (activation === null || activation > instant) {
    return false;
  }
  const contraction = instantTransition(release, "contraction");
  return contraction === null || instant < contraction;
}

function estEnExpansionA(release, instant) {
  const expansion = instantTransition(release, "expansion");
  if (expansion === null || expansion > instant) {
    return false;
  }
  const activation = instantTransition(release, "active");
  return activation === null || instant < activation;
}

function validerChevauchementsHistoriques(releases, push) {
  const instants = new Set();
  for (const release of releases) {
    for (const transition of ["expansion", "active", "contraction"]) {
      const instant = instantTransition(release, transition);
      if (instant !== null) instants.add(instant);
    }
  }
  for (const instant of [...instants].sort((a, b) => a - b)) {
    const expansions = releases.filter((release) =>
      estEnExpansionA(release, instant),
    );
    if (expansions.length > 1) {
      push(
        `releases : au plus une release en expansion (candidat promu) à la fois dans tout l'historique — chevauchement à ${new Date(instant).toISOString()}`,
      );
    }

    const actives = releases.filter((release) => estActiveA(release, instant));
    if (actives.length > 2) {
      push(
        `releases : au plus deux releases actives sont admises pour le support N/N−1 dans tout l'historique — chevauchement à ${new Date(instant).toISOString()}`,
      );
      continue;
    }
    if (actives.length === 2) {
      const tranches = actives
        .map((release) => release.tranche)
        .sort((a, b) => a - b);
      if (
        !tranches.every(Number.isInteger) ||
        tranches[1] !== tranches[0] + 1
      ) {
        push(
          `releases : les deux releases actives doivent être les tranches consécutives N et N−1 dans tout l'historique — divergence à ${new Date(instant).toISOString()}`,
        );
      }
    }
  }
}

function releaseReferenceA(releases, instant) {
  return releases
    .filter(
      (release) =>
        Number.isInteger(release?.tranche) && estActiveA(release, instant),
    )
    .sort((a, b) => b.tranche - a.tranche)[0];
}

function releasePromotionnelleReferenceA(releases, instant) {
  const enExpansion = releases
    .map((release) => ({
      release,
      instantane: instantaneReleaseA(release, instant),
    }))
    .filter(
      ({ release, instantane }) =>
        Number.isInteger(release?.tranche) &&
        instantane?.entree?.vers === "expansion",
    )
    .sort(
      (a, b) =>
        b.instantane.instant - a.instantane.instant ||
        b.release.tranche - a.release.tranche,
    )[0]?.release;
  return enExpansion ?? releaseReferenceA(releases, instant);
}

function instantaneReleaseA(release, instant) {
  let selection = null;
  for (const entree of Array.isArray(release?.journal) ? release.journal : []) {
    if (!CHAINE_TRANSITIONS.slice(0, -1).includes(entree?.vers)) continue;
    const instantEntree = parseInstant(entree?.instant);
    if (
      instantEntree === null ||
      instantEntree > instant ||
      (selection !== null && instantEntree <= selection.instant)
    ) {
      continue;
    }
    const contenu = entree?.graphe?.contenu;
    if (
      !contenu ||
      typeof contenu !== "object" ||
      !contenu.release ||
      typeof contenu.release !== "object"
    ) {
      continue;
    }
    selection = {
      instant: instantEntree,
      entree,
      graphe: entree.graphe,
      contenu,
      release: contenu.release,
    };
  }
  return selection;
}

function validerUsage(release, dateContraction, push) {
  if (!Number.isFinite(dateContraction)) {
    push(
      `${release.id} : instant de décision de contraction issu de la cadence E4 exigé`,
    );
    return;
  }
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
  if (precedente !== null && precedente !== dateContraction - JOUR_MS) {
    push(
      `${release.id} : la fenêtre d'usage doit se terminer la veille de la contraction afin de prouver ${FENETRE_CONTRACTION_JOURS} jours consécutifs sous le seuil au moment de la décision`,
    );
  }
}

function validerReleases(graph, contexte, registre, push) {
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
    } else if (!estShaCandidat(release.sha)) {
      push(`${release.id} : sha invalide (40 hexadécimaux attendus)`);
    } else if (shaReserve(release.sha)) {
      push(
        `${release.id} : le SHA d'une release Punks doit être distinct des checkpoints Punks interdits`,
      );
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
    validerDigestsProduction(release["digests-production"], release, push);
    validerPreuves(release.preuves, release, push);
    validerRetrait(release.retrait, release, lignesTranche, push);
    validerAttestation(release.attestation, release, push);
    const recus = validerRecus(release.recus, release, registre, push);
    const dates = validerJournal(
      release.journal,
      release,
      recus,
      registre,
      push,
    );
    datesParRelease.set(release.id, dates);
  }

  if (releases.some((release, index) => release?.tranche !== index + 1)) {
    push(
      "releases : l'historique des tranches doit commencer à 1 et rester contigu dans l'ordre append-only",
    );
  }
  for (const release of releases.slice(0, -1)) {
    if (release?.etat === "preparation") {
      push(
        `${release.id} : toute tranche antérieure à la tranche courante doit déjà être scellée`,
      );
    }
  }

  validerChevauchementsHistoriques(releases, push);

  let activationPrecedente = null;
  let releasePrecedente = null;
  for (const release of releases) {
    const activation = instantTransition(release, "active");
    if (activation === null) continue;
    if (activationPrecedente !== null && activation <= activationPrecedente) {
      push(
        `${release.id} : l'activation doit être strictement postérieure à celle de ${releasePrecedente.id} dans la séquence canonique des tranches`,
      );
    }
    activationPrecedente = activation;
    releasePrecedente = release;
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
        instants: { expansion: null, active: null, contraction: null },
      },
      push,
    );
  }

  return releases;
}

function profilDePhase(release, phase) {
  const entree = Array.isArray(release?.journal)
    ? release.journal.find((transition) => transition?.vers === phase)
    : null;
  return entree?.graphe?.contenu?.release?.materiaux?.profil ?? null;
}

function validerProfilsSupportes(profils, releases, push) {
  if (!Array.isArray(profils)) {
    push(
      "profils-supportes : chronologie indépendante des profils desktop attendue",
    );
    return [];
  }
  const profilsDuGraphe = new Set();
  for (const release of releases) {
    const profilsRelease = [
      release?.materiaux?.profil,
      ...(Array.isArray(release?.journal)
        ? release.journal.map(
            (entree) => entree?.graphe?.contenu?.release?.materiaux?.profil,
          )
        : []),
    ];
    for (const profil of profilsRelease) {
      const cle = cleProfil(profil);
      if (cle !== null) profilsDuGraphe.add(cle);
    }
  }
  const vus = new Set();
  const intervalles = [];
  for (const [index, profil] of profils.entries()) {
    const libelle = `profils-supportes #${index + 1}`;
    const cle = cleProfil(profil);
    const depuis = parseInstant(profil?.["accepte-depuis"]);
    const jusqueValeur = profil?.["accepte-jusqua"];
    const jusque = jusqueValeur === null ? null : parseInstant(jusqueValeur);
    if (cle === null) {
      push(`${libelle} : id, version et sha256 de profil invalides`);
      continue;
    }
    if (!profilsDuGraphe.has(cle)) {
      push(`${libelle} : profil absent des matériaux du graphe de release`);
    }
    if (depuis === null) {
      push(`${libelle} : accepte-depuis doit être un instant UTC canonique`);
    }
    if (jusqueValeur !== null && jusque === null) {
      push(
        `${libelle} : accepte-jusqua doit être null ou un instant UTC canonique`,
      );
    }
    if (depuis !== null && jusque !== null && jusque <= depuis) {
      push(`${libelle} : la fin d'acceptation doit suivre son début`);
    }
    const identite = `${cle}\u0000${profil?.["accepte-depuis"]}`;
    if (vus.has(identite)) {
      push(`${libelle} : intervalle de profil dupliqué`);
    } else {
      vus.add(identite);
    }
    intervalles.push({ profil, cle, depuis, jusque });
  }

  const parProfil = new Map();
  for (const intervalle of intervalles) {
    if (intervalle.depuis === null) continue;
    if (!parProfil.has(intervalle.cle)) parProfil.set(intervalle.cle, []);
    parProfil.get(intervalle.cle).push(intervalle);
  }
  for (const [cle, valeurs] of parProfil) {
    valeurs.sort((a, b) => a.depuis - b.depuis);
    for (let index = 1; index < valeurs.length; index += 1) {
      const precedente = valeurs[index - 1];
      if (
        precedente.jusque === null ||
        valeurs[index].depuis < precedente.jusque
      ) {
        push(
          `profils-supportes : intervalles d'acceptation qui se chevauchent pour ${cle.split("\u0000")[0]}`,
        );
      }
    }
  }

  for (const release of releases) {
    if (!release || typeof release !== "object") continue;
    const cle = cleProfil(profilDePhase(release, "active"));
    const activation = instantTransition(release, "active");
    const contraction = instantTransition(release, "contraction");
    if (
      cle !== null &&
      activation !== null &&
      !intervalles.some(
        (intervalle) =>
          intervalle.cle === cle &&
          intervalle.depuis !== null &&
          intervalle.depuis <= activation &&
          (intervalle.jusque === null ||
            (contraction === null
              ? activation < intervalle.jusque
              : contraction <= intervalle.jusque)),
      )
    ) {
      push(
        `${release.id} : le profil réellement activé doit couvrir sans trou toute sa durée backend historique`,
      );
    }
    if (
      release?.etat === "active" &&
      cle !== null &&
      activation !== null &&
      !intervalles.some(
        (intervalle) =>
          intervalle.cle === cle &&
          intervalle.depuis !== null &&
          intervalle.depuis <= activation &&
          intervalle.jusque === null,
      )
    ) {
      push(
        `${release.id} : le profil d'une release backend active doit rester accepté dans la chronologie desktop indépendante`,
      );
    }
  }
  return intervalles;
}

function profilsSupportesA(intervalles, instant) {
  const profils = new Map();
  for (const intervalle of intervalles) {
    if (
      intervalle.depuis === null ||
      intervalle.depuis > instant ||
      (intervalle.jusque !== null && instant >= intervalle.jusque)
    ) {
      continue;
    }
    if (!profils.has(intervalle.cle)) {
      profils.set(intervalle.cle, {
        id: intervalle.profil.id,
        version: intervalle.profil.version,
        sha256: intervalle.profil.sha256,
      });
    }
  }
  return profils;
}

function teteDeReleaseA(release, instant) {
  const instantane = release ? instantaneReleaseA(release, instant) : null;
  if (!instantane) return null;
  const recu = release.recus?.find(
    (element) => element?.id === instantane.entree?.recu,
  );
  return {
    cible: release,
    release: instantane.release,
    snapshot: instantane.graphe,
    lien: {
      "graphe-sha256": instantane.graphe?.sha256,
      "recu-sha256": recu?.sha256,
    },
    termineA: instantane.entree?.instant,
  };
}

function teteBaseA(releases, instant, { promotionnelle }) {
  const release = promotionnelle
    ? releasePromotionnelleReferenceA(releases, instant)
    : releaseReferenceA(releases, instant);
  return teteDeReleaseA(release, instant);
}

function teteLaPlusRecente(base, recuperee) {
  if (!base) return recuperee;
  if (!recuperee) return base;
  const instantBase = parseInstant(base.actualiseA ?? base.termineA);
  const instantRecuperee = parseInstant(
    recuperee.actualiseA ?? recuperee.termineA,
  );
  return instantRecuperee !== null &&
    (instantBase === null || instantRecuperee >= instantBase)
    ? recuperee
    : base;
}

const PROGRAMMES_EXECUTION = Object.freeze([
  "expansion",
  "active",
  "contraction",
  "roll-forward",
]);
const NATURES_EVENEMENT_EXECUTION = Object.freeze([
  "etape-fermee",
  "phase-fermee",
  "pause",
  "reprise",
  "echec",
  "quarantaine",
]);
const NATURES_INVALIDATION_ATTESTATION = Object.freeze([
  "supersession-documentaire",
  "revocation-materielle-non-critique",
  "revocation-critique",
]);

function collecterAttestationsAdressees(valeur, attestations, vus = new Set()) {
  if (!valeur || typeof valeur !== "object" || vus.has(valeur)) return;
  vus.add(valeur);
  const instant = parseInstant(valeur.attestation?.instant);
  if (
    valeur.attestation &&
    typeof valeur.attestation === "object" &&
    estSha256(valeur["attestation-sha256"]) &&
    canonicalSha256(valeur.attestation) === valeur["attestation-sha256"] &&
    instant !== null
  ) {
    attestations.set(valeur["attestation-sha256"], {
      instant,
      releaseId: valeur.attestation["release-id"] ?? null,
      sha: valeur.attestation.sha ?? null,
    });
  }
  for (const enfant of Array.isArray(valeur) ? valeur : Object.values(valeur)) {
    collecterAttestationsAdressees(enfant, attestations, vus);
  }
}

function validerInvalidationsAttestations(
  invalidations,
  graph,
  registre,
  push,
) {
  const entrees = Array.isArray(invalidations) ? invalidations : [];
  if (!Array.isArray(invalidations)) {
    push("invalidations-attestations : journal append-only attendu");
  }
  const attestationsConnues = new Map();
  collecterAttestationsAdressees(graph.releases, attestationsConnues);
  collecterAttestationsAdressees(graph.executions, attestationsConnues);
  collecterAttestationsAdressees(graph.recuperations, attestationsConnues);
  const invalidationsParHash = new Map();
  const ids = new Set();
  let instantPrecedent = null;
  for (const [index, invalidation] of entrees.entries()) {
    const libelle = `invalidation-attestation #${index + 1}`;
    const instant = parseInstant(invalidation?.instant);
    if (
      !invalidation ||
      typeof invalidation !== "object" ||
      Array.isArray(invalidation) ||
      !listeEgale(Object.keys(invalidation).sort(), [
        "attestation-sha256",
        "attestation-supersedante",
        "attestation-supersedante-sha256",
        "cause",
        "execution-id",
        "fencing-preuve-sha256",
        "id",
        "instant",
        "nature",
        "profil-bloque-sha256",
        "recu",
        "recu-pause-sha256",
        "recu-quarantaine-sha256",
        "release-id",
        "schema",
        "sha-punks",
      ]) ||
      invalidation.schema !== "punks.attestation-invalidation.v1" ||
      typeof invalidation.id !== "string" ||
      invalidation.id.trim() === "" ||
      ids.has(invalidation.id) ||
      !NATURES_INVALIDATION_ATTESTATION.includes(invalidation.nature) ||
      typeof invalidation.cause !== "string" ||
      invalidation.cause.trim() === "" ||
      instant === null ||
      (instantPrecedent !== null && instant <= instantPrecedent)
    ) {
      push(`${libelle} : schéma fermé, identité et chronologie invalides`);
      continue;
    }
    ids.add(invalidation.id);
    instantPrecedent = instant;
    const cible = invalidation["attestation-sha256"];
    if (
      !estSha256(cible) ||
      !attestationsConnues.has(cible) ||
      invalidationsParHash.has(cible)
    ) {
      push(
        `${libelle} : l'attestation originale doit être connue et invalidée une seule fois`,
      );
    }
    const attestationCible = attestationsConnues.get(cible) ?? null;
    if (
      attestationCible === null ||
      instant <= attestationCible.instant ||
      invalidation["release-id"] !== attestationCible.releaseId ||
      invalidation["sha-punks"] !== attestationCible.sha
    ) {
      push(
        `${libelle} : l'invalidation doit lier la release et le SHA exacts puis être strictement postérieure à l'attestation visée`,
      );
    }
    const supersession = invalidation.nature === "supersession-documentaire";
    const critique = invalidation.nature === "revocation-critique";
    const attestationSupersedante = invalidation["attestation-supersedante"];
    const hashSupersedante = invalidation["attestation-supersedante-sha256"];
    const supersessionValide =
      supersession &&
      attestationSupersedante &&
      typeof attestationSupersedante === "object" &&
      !Array.isArray(attestationSupersedante) &&
      listeEgale(Object.keys(attestationSupersedante).sort(), [
        "attestation-originale-sha256",
        "cause",
        "dossier-correctif-sha256",
        "instant",
        "publiee",
        "schema",
      ]) &&
      attestationSupersedante.schema === "punks.attestation-supersedante.v1" &&
      attestationSupersedante["attestation-originale-sha256"] === cible &&
      attestationSupersedante.instant === invalidation.instant &&
      attestationSupersedante.cause === invalidation.cause &&
      estSha256(attestationSupersedante["dossier-correctif-sha256"]) &&
      listeEgale(attestationSupersedante.publiee, PUBLICATION) &&
      estSha256(hashSupersedante) &&
      canonicalSha256(attestationSupersedante) === hashSupersedante;
    if (
      supersession
        ? !supersessionValide ||
          invalidation["profil-bloque-sha256"] !== null ||
          invalidation["fencing-preuve-sha256"] !== null
        : attestationSupersedante !== null ||
          hashSupersedante !== null ||
          (critique
            ? !estSha256(invalidation["profil-bloque-sha256"]) ||
              !estSha256(invalidation["fencing-preuve-sha256"])
            : invalidation["profil-bloque-sha256"] !== null ||
              invalidation["fencing-preuve-sha256"] !== null)
    ) {
      push(`${libelle} : supersession ou révocation matérielle exacte exigée`);
    }
    const executionId = invalidation["execution-id"];
    const recuPauseSha256 = invalidation["recu-pause-sha256"];
    const recuQuarantaineSha256 = invalidation["recu-quarantaine-sha256"];
    const executionCritique = (
      Array.isArray(graph.executions) ? graph.executions : []
    ).find((execution) => execution?.id === executionId);
    const pauseCritique = executionCritique?.evenements?.find(
      (evenement) =>
        evenement?.contenu?.nature === "pause" &&
        evenement?.sha256 === recuPauseSha256,
    );
    const quarantaineCritique = executionCritique?.evenements?.find(
      (evenement) =>
        evenement?.contenu?.nature === "quarantaine" &&
        evenement?.sha256 === recuQuarantaineSha256,
    );
    const instantPauseCritique = parseInstant(pauseCritique?.contenu?.instant);
    const instantQuarantaineCritique = parseInstant(
      quarantaineCritique?.contenu?.instant,
    );
    if (
      critique
        ? typeof executionId !== "string" ||
          executionId.trim() === "" ||
          !pauseCritique ||
          !quarantaineCritique ||
          quarantaineCritique.contenu?.fencing?.["preuve-sha256"] !==
            invalidation["fencing-preuve-sha256"] ||
          instantPauseCritique === null ||
          instantQuarantaineCritique === null ||
          instantPauseCritique > instantQuarantaineCritique ||
          instantQuarantaineCritique > instant
        : executionId !== null ||
          recuPauseSha256 !== null ||
          recuQuarantaineSha256 !== null
    ) {
      push(
        `${libelle} : une révocation critique doit prolonger une pause et une quarantaine signées avec le fencing exact`,
      );
    }
    const contenuRecu = validerRecuSigne(
      invalidation.recu,
      `${libelle} : Reçu durable`,
      registre,
      push,
      { approbateursAttendus: invalidation.recu?.contenu?.approbateurs },
    );
    if (
      !contenuRecu ||
      !listeEgale(Object.keys(contenuRecu).sort(), [
        "approbateurs",
        "attestation-sha256",
        "attestation-supersedante-sha256",
        "cause",
        "execution-id",
        "fencing-preuve-sha256",
        "id",
        "instant",
        "invalidation-id",
        "nature",
        "profil-bloque-sha256",
        "recu-pause-sha256",
        "recu-quarantaine-sha256",
        "release-id",
        "schema",
        "sha-punks",
        "type",
      ]) ||
      contenuRecu.id !== `recu-invalidation-attestation-${invalidation.id}` ||
      contenuRecu.type !== "invalidation-attestation" ||
      contenuRecu["invalidation-id"] !== invalidation.id ||
      contenuRecu.nature !== invalidation.nature ||
      contenuRecu["attestation-sha256"] !== cible ||
      contenuRecu["attestation-supersedante-sha256"] !== hashSupersedante ||
      contenuRecu["profil-bloque-sha256"] !==
        invalidation["profil-bloque-sha256"] ||
      contenuRecu["execution-id"] !== executionId ||
      contenuRecu["recu-pause-sha256"] !== recuPauseSha256 ||
      contenuRecu["recu-quarantaine-sha256"] !== recuQuarantaineSha256 ||
      contenuRecu["release-id"] !== invalidation["release-id"] ||
      contenuRecu["sha-punks"] !== invalidation["sha-punks"] ||
      contenuRecu["fencing-preuve-sha256"] !==
        invalidation["fencing-preuve-sha256"] ||
      contenuRecu.cause !== invalidation.cause ||
      contenuRecu.instant !== invalidation.instant
    ) {
      push(`${libelle} : Reçu durable exact de l'invalidation exigé`);
    }
    if (estSha256(cible)) {
      invalidationsParHash.set(cible, {
        instant,
        nature: invalidation.nature,
        remplacement: supersession ? hashSupersedante : null,
      });
    }
    if (supersessionValide) {
      attestationsConnues.set(hashSupersedante, {
        instant,
        releaseId: invalidation["release-id"],
        sha: invalidation["sha-punks"],
      });
    }
  }
  return invalidationsParHash;
}

function attestationEligible(hash, invalidations, instantReference) {
  if (!estSha256(hash)) return null;
  const borne = parseInstant(instantReference);
  if (borne === null) return null;
  const vus = new Set();
  let courante = hash;
  while (
    invalidations.has(courante) &&
    invalidations.get(courante).instant <= borne
  ) {
    if (vus.has(courante)) return null;
    vus.add(courante);
    courante = invalidations.get(courante).remplacement;
    if (courante === null) return null;
  }
  return courante;
}

function validerProgressionAttestations(
  releases,
  executions,
  invalidations,
  push,
) {
  const attestationsParGraphe = new Map();
  for (const release of releases) {
    let precedente = null;
    for (const entree of Array.isArray(release?.journal)
      ? release.journal
      : []) {
      if (entree?.vers === "contractee") continue;
      if (
        estSha256(entree?.graphe?.sha256) &&
        estSha256(entree?.["attestation-sha256"])
      ) {
        attestationsParGraphe.set(
          entree.graphe.sha256,
          entree["attestation-sha256"],
        );
      }
      if (
        precedente &&
        attestationEligible(
          precedente["attestation-sha256"],
          invalidations,
          entree?.graphe?.contenu?.instant,
        ) === null
      ) {
        push(
          `${release.id} : la transition « ${entree.vers} » ne peut progresser depuis une attestation matériellement révoquée`,
        );
      }
      precedente = entree;
    }
  }
  for (const execution of Array.isArray(executions) ? executions : []) {
    if (execution?.programme === "roll-forward") continue;
    const graphePrecedent = execution?.precedent?.["graphe-sha256"];
    const attestationPrecedente = attestationsParGraphe.get(graphePrecedent);
    if (
      attestationPrecedente &&
      attestationEligible(
        attestationPrecedente,
        invalidations,
        execution?.["recu-demarrage"]?.contenu?.instant,
      ) === null
    ) {
      push(
        `${execution.id} : une exécution ordinaire ne peut consommer une attestation matériellement révoquée ; roll-forward ou retour Punks exigé`,
      );
    }
  }
}

function descripteurTeteOperationnelle(tete) {
  if (!tete) return null;
  return {
    "execution-id": tete.executionId ?? null,
    "release-id": tete.snapshot?.contenu?.["release-id"],
    "sha-punks": tete.release?.sha,
    "graphe-sha256": tete.snapshot?.sha256,
    "recu-tete-sha256": tete.lien?.["recu-sha256"],
  };
}

function lienDepuisDescripteur(descripteur) {
  return descripteur === null
    ? null
    : {
        "graphe-sha256": descripteur?.["graphe-sha256"],
        "recu-sha256": descripteur?.["recu-tete-sha256"],
      };
}

function politiquePourExecution(programme, instantane) {
  const stateful =
    instantane?.contenu?.topologie?.["migration-stateful"]?.mode ===
    "non-splittable";
  const cle = stateful
    ? programme === "expansion"
      ? "expansion-stateful"
      : programme === "roll-forward"
        ? "roll-forward-stateful"
        : programme
    : programme;
  return CADENCES_OPERATIONNELLES[cle] ?? null;
}

function workersPourEtape(instantane, attendu) {
  const workers = structuredClone(
    instantane?.contenu?.topologie?.workers ?? [],
  );
  const pourcentage =
    attendu?.etape === "P0"
      ? "0"
      : /^workers:(\d+)%/.exec(attendu?.exposition ?? "")?.[1];
  if (pourcentage !== undefined) {
    for (const worker of workers) worker.pourcentage = Number(pourcentage);
  }
  return workers;
}

function hashesDesktopPourEtape(programme, attendu, instantane) {
  const distribues =
    ["active", "contraction"].includes(programme) ||
    (programme === "roll-forward" && attendu?.etape?.startsWith("A"));
  return distribues
    ? (instantane?.release?.artefacts ?? []).map(({ plateforme, sha256 }) => ({
        plateforme,
        sha256,
      }))
    : [];
}

const CATEGORIES_INCIDENT_EXECUTION = Object.freeze([
  "violation-critique",
  "regression-fonctionnelle",
  "degradation-non-destructive",
]);
const FENETRE_OBSERVATION_MS = 15 * 60 * 1_000;
const DETECTION_CRITIQUE_MAX_MS = 5 * 60 * 1_000;
const FENCING_CRITIQUE_MAX_MS = 15 * 60 * 1_000;
const QUALIFICATION_PERIMETRE_MAX_MS = 30 * 60 * 1_000;
const RECUPERATION_CIBLE_MAX_MS = 4 * HEURE_MS;

function validerFenetresObservation(
  contenu,
  nature,
  incident,
  etatPrecedent,
  push,
  libelle,
) {
  const fenetres = Array.isArray(contenu?.["fenetres-observation"])
    ? contenu["fenetres-observation"]
    : [];
  const critique = incident?.categorie === "violation-critique";
  let valide = critique ? fenetres.length === 0 : fenetres.length > 0;
  let finPrecedente = null;
  for (const [index, fenetre] of fenetres.entries()) {
    const debut = parseInstant(fenetre?.debut);
    const fin = parseInstant(fenetre?.fin);
    const formeValide =
      fenetre &&
      typeof fenetre === "object" &&
      !Array.isArray(fenetre) &&
      listeEgale(Object.keys(fenetre).sort(), [
        "debut",
        "export-sha256",
        "fin",
        "resultat",
      ]) &&
      ["vert", "rouge", "insuffisant"].includes(fenetre.resultat) &&
      estSha256(fenetre["export-sha256"]) &&
      debut !== null &&
      fin !== null &&
      fin - debut === FENETRE_OBSERVATION_MS &&
      (index === 0 || debut === finPrecedente);
    if (!formeValide) valide = false;
    finPrecedente = fin;
  }
  const instant = parseInstant(contenu?.instant);
  if (!valide || instant === null || (!critique && finPrecedente !== instant)) {
    push(
      `${libelle} : fenêtres d'observation content-addressées, consécutives et longues de 15 minutes exigées`,
    );
    valide = false;
  }

  const resultats = fenetres.map((fenetre) => fenetre?.resultat);
  const deuxDernieres = resultats.slice(-2);
  if (
    nature === "reprise" &&
    (deuxDernieres.length !== 2 ||
      deuxDernieres.some((resultat) => resultat !== "vert"))
  ) {
    push(`${libelle} : une reprise exige deux fenêtres vertes consécutives`);
    valide = false;
  }
  const detecteA = parseInstant(incident?.["detecte-a"]);
  const nonQualifieDepuisQuatreHeures =
    nature === "echec" &&
    incident?.["qualifie-a"] === null &&
    instant !== null &&
    detecteA !== null &&
    instant - detecteA >= RECUPERATION_CIBLE_MAX_MS;
  if (
    nature === "echec" &&
    !nonQualifieDepuisQuatreHeures &&
    (deuxDernieres.length !== 2 ||
      deuxDernieres.some((resultat) => resultat !== "rouge"))
  ) {
    push(
      `${libelle} : l'arrêt fonctionnel exige deux fenêtres rouges consécutives ou quatre heures sans qualification`,
    );
    valide = false;
  }
  if (nature === "pause") {
    const minimum =
      incident?.categorie === "regression-fonctionnelle"
        ? 1
        : incident?.categorie === "degradation-non-destructive"
          ? 2
          : 0;
    if (
      resultats.length < minimum ||
      resultats.slice(-minimum).some((resultat) => resultat !== "rouge")
    ) {
      push(
        `${libelle} : la pause doit prouver les fenêtres rouges exigées par la catégorie d'incident`,
      );
      valide = false;
    }
  }
  if (
    nature === "reprise" &&
    parseInstant(fenetres[0]?.debut) !==
      parseInstant(etatPrecedent?.contenu?.instant)
  ) {
    push(
      `${libelle} : les deux fenêtres vertes de reprise doivent commencer après la pause signée`,
    );
    valide = false;
  }
  const fenetrePause = etatPrecedent?.contenu?.["fenetres-observation"]?.at(-1);
  if (
    nature === "echec" &&
    !nonQualifieDepuisQuatreHeures &&
    (!fenetrePause ||
      canonicalSha256(fenetres[0]) !== canonicalSha256(fenetrePause))
  ) {
    push(
      `${libelle} : l'arrêt doit prolonger la dernière fenêtre rouge de la pause précédente`,
    );
    valide = false;
  }

  const verdicts = Array.isArray(contenu?.["verdicts-metriques"])
    ? contenu["verdicts-metriques"]
    : [];
  const resultatFinal = resultats.at(-1);
  const verdictRouge = verdicts.some(
    (verdict) =>
      verdict?.resultat === "rouge" ||
      verdict?.dimensions?.some((dimension) => dimension?.resultat === "rouge"),
  );
  const tousVerts = verdicts.every(
    (verdict) =>
      verdict?.resultat === "vert" &&
      verdict?.dimensions?.every((dimension) => dimension?.resultat === "vert"),
  );
  if (
    (resultatFinal === "rouge" && !verdictRouge) ||
    (resultatFinal === "vert" && !tousVerts) ||
    (critique && !verdictRouge)
  ) {
    push(
      `${libelle} : la fenêtre terminale doit correspondre aux verdicts métriques recalculés`,
    );
    valide = false;
  }
  return valide;
}

function validerFencing(contenu, nature, incident, push, libelle) {
  const fencing = contenu?.fencing;
  const formeValide =
    fencing &&
    typeof fencing === "object" &&
    !Array.isArray(fencing) &&
    listeEgale(Object.keys(fencing).sort(), [
      "applique",
      "applique-a",
      "perimetre",
      "preuve-sha256",
      "requis",
    ]);
  const requis =
    incident?.criticite === "critique" &&
    incident?.["donnees-exposees"] === true;
  const detecteA = parseInstant(incident?.["detecte-a"]);
  const appliqueA = parseInstant(fencing?.["applique-a"]);
  const instant = parseInstant(contenu?.instant);
  const fencingEnAttente =
    nature === "pause" &&
    fencing?.requis === true &&
    fencing?.applique === false &&
    fencing?.["applique-a"] === null &&
    fencing?.perimetre === contenu?.perimetre &&
    fencing?.["preuve-sha256"] === null;
  const fencingApplique =
    fencing?.requis === true &&
    fencing?.applique === true &&
    fencing?.perimetre === contenu?.perimetre &&
    estSha256(fencing?.["preuve-sha256"]) &&
    detecteA !== null &&
    appliqueA !== null &&
    instant !== null &&
    appliqueA >= detecteA &&
    appliqueA <= instant &&
    appliqueA - detecteA <= FENCING_CRITIQUE_MAX_MS;
  const coherent = requis
    ? fencingEnAttente || fencingApplique
    : fencing?.requis === false &&
      fencing?.applique === false &&
      fencing?.["applique-a"] === null &&
      fencing?.perimetre === null &&
      fencing?.["preuve-sha256"] === null;
  if (!formeValide || !coherent) {
    push(
      `${libelle} : fencing exact, content-addressé et appliqué sous quinze minutes exigé lorsque des données critiques restent exposées`,
    );
    return false;
  }
  return true;
}

function validerEtatExecution(
  contenu,
  nature,
  attendu,
  programme,
  instantane,
  etatPrecedent,
  push,
  libelle,
) {
  const estEchec = ["echec", "quarantaine"].includes(nature);
  if (
    typeof contenu?.cause !== "string" ||
    contenu.cause.trim() === "" ||
    typeof contenu?.perimetre !== "string" ||
    contenu.perimetre.trim() === "" ||
    !estSha256(contenu?.["incident-sha256"]) ||
    contenu?.etape !== attendu?.etape
  ) {
    push(
      `${libelle} : cause, périmètre, incident content-addressé et étape courante exacts sont exigés`,
    );
  }
  if (
    shaCanoniqueOptionnel(contenu?.workers) !==
      canonicalSha256(workersPourEtape(instantane, attendu)) ||
    shaCanoniqueOptionnel(contenu?.workflows) !==
      shaCanoniqueOptionnel(instantane?.contenu?.topologie?.workflows) ||
    contenu?.["generation-compatibilite"] !==
      instantane?.contenu?.topologie?.["generation-compatibilite"] ||
    shaCanoniqueOptionnel(contenu?.["hashes-desktop"]) !==
      canonicalSha256(hashesDesktopPourEtape(programme, attendu, instantane))
  ) {
    push(
      `${libelle} : l'état d'exécution doit lier l'exposition, les Workflows, la génération et les artefacts exacts du graphe`,
    );
  }
  validerVerdictsMetriques(contenu?.["verdicts-metriques"], libelle, push, {
    baselineExigee:
      programme === "roll-forward" ||
      (Number.isInteger(instantane?.contenu?.tranche) &&
        instantane.contenu.tranche > 1),
    moyensConnexion: instantane?.contenu?.topologie?.["moyens-connexion"],
    preuveDeterministeAutorisee:
      ["expansion", "active"].includes(programme) &&
      instantane?.contenu?.tranche === 1,
    resultatsAutorises:
      nature === "reprise" ? ["vert"] : ["vert", "rouge", "insuffisant"],
    exigerViolationRouge: estEchec,
  });
  validerListeObjetsUniques(
    contenu?.bookmarks,
    libelle,
    "bookmarks",
    (bookmark) =>
      typeof bookmark?.autorite === "string" &&
      bookmark.autorite.trim() !== "" &&
      typeof bookmark?.valeur === "string" &&
      bookmark.valeur.trim() !== ""
        ? bookmark.autorite
        : null,
    push,
  );
  if (
    !Number.isInteger(contenu?.dlq?.messages) ||
    contenu.dlq.messages < 0 ||
    !estSha256(contenu?.dlq?.["export-sha256"]) ||
    !Number.isInteger(contenu?.outboxes?.["en-attente"]) ||
    contenu.outboxes["en-attente"] < 0 ||
    !estSha256(contenu?.outboxes?.["export-sha256"])
  ) {
    push(`${libelle} : états DLQ et outboxes exportés exigés`);
  }
  validerListeObjetsUniques(
    contenu?.incidents,
    libelle,
    "incidents",
    (incident) =>
      typeof incident?.id === "string" &&
      incident.id.trim() !== "" &&
      CATEGORIES_INCIDENT_EXECUTION.includes(incident?.categorie) &&
      ["critique", "non-critique"].includes(incident?.criticite) &&
      ["ouvert", "resolu"].includes(incident?.statut) &&
      typeof incident?.["donnees-exposees"] === "boolean" &&
      parseInstant(incident?.["survenu-a"]) !== null &&
      parseInstant(incident?.["detecte-a"]) !== null &&
      (incident?.["qualifie-a"] === null ||
        parseInstant(incident?.["qualifie-a"]) !== null) &&
      (incident?.["escalade-a"] === null ||
        parseInstant(incident?.["escalade-a"]) !== null) &&
      listeEgale(Object.keys(incident).sort(), [
        "categorie",
        "criticite",
        "detecte-a",
        "donnees-exposees",
        "escalade-a",
        "id",
        "qualifie-a",
        "statut",
        "survenu-a",
      ])
        ? incident.id
        : null,
    push,
    { videAutorise: false },
  );
  const incidents = Array.isArray(contenu?.incidents) ? contenu.incidents : [];
  const incidentsLies = incidents.filter(
    (incident) => canonicalSha256(incident) === contenu?.["incident-sha256"],
  );
  if (incidentsLies.length !== 1) {
    push(
      `${libelle} : incident-sha256 doit désigner exactement un incident embarqué`,
    );
  }
  const critiquesOuverts = incidents.filter(
    (incident) =>
      incident?.criticite === "critique" && incident?.statut === "ouvert",
  );
  const incident = incidentsLies[0];
  const survenuA = parseInstant(incident?.["survenu-a"]);
  const detecteA = parseInstant(incident?.["detecte-a"]);
  const qualifieA = parseInstant(incident?.["qualifie-a"]);
  const escaladeA = parseInstant(incident?.["escalade-a"]);
  const instant = parseInstant(contenu?.instant);
  const echeanceQualification =
    detecteA === null ? null : detecteA + QUALIFICATION_PERIMETRE_MAX_MS;
  const qualificationDansDelai =
    detecteA !== null &&
    qualifieA !== null &&
    qualifieA >= detecteA &&
    qualifieA <= echeanceQualification;
  const qualificationDepassee =
    detecteA !== null &&
    ((qualifieA !== null && qualifieA > echeanceQualification) ||
      (qualifieA === null &&
        instant !== null &&
        instant > echeanceQualification));
  if (
    survenuA === null ||
    detecteA === null ||
    instant === null ||
    detecteA < survenuA ||
    detecteA > instant ||
    (incident?.criticite === "critique" &&
      detecteA - survenuA > DETECTION_CRITIQUE_MAX_MS) ||
    (incident?.["qualifie-a"] !== null &&
      (qualifieA === null || qualifieA < detecteA || qualifieA > instant)) ||
    (qualificationDepassee
      ? escaladeA !== echeanceQualification
      : incident?.["escalade-a"] !== null) ||
    (qualificationDansDelai && incident?.["escalade-a"] !== null)
  ) {
    push(
      `${libelle} : détection critique sous cinq minutes, qualification du périmètre sous trente minutes et escalade exacte en cas de dépassement exigées`,
    );
  }
  if (
    nature === "echec" &&
    incident?.["qualifie-a"] === null &&
    (detecteA === null ||
      instant === null ||
      instant - detecteA < RECUPERATION_CIBLE_MAX_MS)
  ) {
    push(
      `${libelle} : un échec sans qualification ne peut imposer le roll-forward qu'après quatre heures`,
    );
  }
  if (
    nature === "echec" &&
    (incident?.categorie !== "regression-fonctionnelle" ||
      incident?.criticite !== "non-critique" ||
      incident?.statut !== "ouvert")
  ) {
    push(
      `${libelle} : un échec doit sceller la régression fonctionnelle ouverte qui impose le roll-forward`,
    );
  }
  if (
    nature === "quarantaine" &&
    (critiquesOuverts.length !== 1 ||
      incident !== critiquesOuverts[0] ||
      incident?.categorie !== "violation-critique")
  ) {
    push(
      `${libelle} : une quarantaine doit sceller son unique violation critique ouverte causale`,
    );
  }
  if (
    nature === "pause" &&
    (incidentsLies.length !== 1 || incidentsLies[0]?.statut !== "ouvert")
  ) {
    push(`${libelle} : une pause doit lier exactement son incident ouvert`);
  }
  if (
    nature === "pause" &&
    incident?.categorie === "violation-critique" &&
    contenu?.instant !== incident?.["detecte-a"]
  ) {
    push(
      `${libelle} : une violation critique confirmée doit provoquer une pause immédiate`,
    );
  }
  if (
    nature === "reprise" &&
    (critiquesOuverts.length > 0 ||
      incidentsLies.length !== 1 ||
      incident?.statut !== "resolu" ||
      etatPrecedent?.incident?.id !== incident?.id ||
      etatPrecedent?.incident?.categorie === "violation-critique")
  ) {
    push(
      `${libelle} : une reprise doit lier l'incident résolu et ne conserver aucun incident critique ouvert`,
    );
  }
  if (
    ["echec", "quarantaine"].includes(nature) &&
    (etatPrecedent?.incident?.id !== incident?.id ||
      canonicalSha256({
        categorie: etatPrecedent?.incident?.categorie,
        criticite: etatPrecedent?.incident?.criticite,
        "detecte-a": etatPrecedent?.incident?.["detecte-a"],
        "donnees-exposees": etatPrecedent?.incident?.["donnees-exposees"],
        id: etatPrecedent?.incident?.id,
        statut: etatPrecedent?.incident?.statut,
        "survenu-a": etatPrecedent?.incident?.["survenu-a"],
      }) !==
        canonicalSha256({
          categorie: incident?.categorie,
          criticite: incident?.criticite,
          "detecte-a": incident?.["detecte-a"],
          "donnees-exposees": incident?.["donnees-exposees"],
          id: incident?.id,
          statut: incident?.statut,
          "survenu-a": incident?.["survenu-a"],
        }) ||
      etatPrecedent?.contenu?.cause !== contenu?.cause ||
      etatPrecedent?.contenu?.perimetre !== contenu?.perimetre)
  ) {
    push(
      `${libelle} : l'arrêt doit prolonger exactement l'incident causal, la cause et le périmètre de la pause signée`,
    );
  }
  if (
    nature === "quarantaine" &&
    etatPrecedent?.nature === "pause" &&
    (detecteA === null ||
      instant === null ||
      instant < parseInstant(etatPrecedent?.contenu?.instant) ||
      instant - detecteA > FENCING_CRITIQUE_MAX_MS)
  ) {
    push(
      `${libelle} : une violation critique doit être quarantainée immédiatement et au plus tard sous quinze minutes`,
    );
  }
  validerFenetresObservation(
    contenu,
    nature,
    incident,
    etatPrecedent,
    push,
    libelle,
  );
  validerFencing(contenu, nature, incident, push, libelle);
  return { contenu, nature, incident };
}

function trouverClotureExecution(execution, cible, recuperations) {
  const grapheSha256 = execution?.graphe?.sha256;
  const releaseId = execution?.graphe?.contenu?.["release-id"];
  if (execution?.programme === "roll-forward") {
    const correspondances = (Array.isArray(recuperations) ? recuperations : [])
      .filter(
        (recuperation) =>
          recuperation?.type === "roll-forward" &&
          recuperation?.cible === execution.cible &&
          recuperation?.graphes?.nouveau?.sha256 === grapheSha256 &&
          recuperation?.recu?.contenu?.["release-id"] === releaseId,
      )
      .map((recuperation) => ({
        instant: recuperation.instant,
        recu: recuperation.recu,
        type: "recuperation",
      }));
    return correspondances.length === 1 ? correspondances[0] : null;
  }
  const correspondances = (Array.isArray(cible?.journal) ? cible.journal : [])
    .filter(
      (entree) =>
        entree?.vers === execution?.programme &&
        entree?.["release-id"] === releaseId &&
        entree?.graphe?.sha256 === grapheSha256,
    )
    .map((entree) => ({
      entree,
      instant: entree.instant,
      recu: (Array.isArray(cible?.recus) ? cible.recus : []).find(
        (recu) => recu?.id === entree.recu,
      ),
      type: "transition",
    }));
  return correspondances.length === 1 ? correspondances[0] : null;
}

function validerRevendicationsExecutions(releases, executions, push) {
  const terminees = new Map(
    executions
      .filter((execution) => execution?.statut === "reussie")
      .map((execution) => [execution.executionId, execution]),
  );
  for (const release of releases) {
    for (const recu of Array.isArray(release?.recus) ? release.recus : []) {
      const contenu = recu?.contenu;
      if (contenu?.type !== "transition") continue;
      const revendiqueExecution = "execution-id" in contenu;
      const revendiqueTete = "recu-execution-precedent-sha256" in contenu;
      if (revendiqueExecution !== revendiqueTete) {
        push(
          `${release.id} : un Reçu terminal doit lier ensemble l'exécution et sa tête signée précédente`,
        );
        continue;
      }
      if (!revendiqueExecution) {
        push(
          `${release.id} : toute transition scellée exige une exécution réussie et sa chaîne signée démarrage→étapes→clôture`,
        );
        continue;
      }
      const execution = terminees.get(contenu["execution-id"]);
      if (
        !execution ||
        execution.recuTransitionSha256 !== recu.sha256 ||
        execution.recuExecutionPrecedentSha256 !==
          contenu["recu-execution-precedent-sha256"]
      ) {
        push(
          `${release.id} : le Reçu terminal revendique une exécution réussie absente ou divergente`,
        );
      }
    }
  }
}

function teteRecuperationDeclareeA(
  recuperations,
  releases,
  instant,
  { cibleId = null } = {},
) {
  let tete = null;
  for (const recuperation of Array.isArray(recuperations)
    ? recuperations
    : []) {
    const termineA = parseInstant(recuperation?.instant);
    if (termineA === null || termineA > instant) continue;
    if (cibleId !== null && recuperation?.cible !== cibleId) continue;
    const cible = releases.find(
      (release) => release?.id === recuperation?.cible,
    );
    if (!cible) continue;
    let snapshot = null;
    let release = null;
    let recu = null;
    if (recuperation?.type === "roll-forward") {
      snapshot = recuperation?.graphes?.nouveau;
      release = snapshot?.contenu?.release;
      recu = recuperation?.recu;
    } else if (recuperation?.type === "retour-punks") {
      const instantane = instantaneReleaseA(cible, termineA);
      snapshot = instantane?.graphe;
      release = instantane?.release;
      recu = recuperation?.certificat?.recu;
    }
    if (
      !snapshot ||
      !release ||
      !estSha256(snapshot?.sha256) ||
      !estSha256(recu?.sha256)
    ) {
      continue;
    }
    tete = teteLaPlusRecente(tete, {
      cible,
      release,
      snapshot,
      lien: {
        "graphe-sha256": snapshot.sha256,
        "recu-sha256": recu.sha256,
      },
      termineA: recuperation.instant,
    });
  }
  return tete;
}

function validerExecutions(
  executions,
  releases,
  recuperations,
  registre,
  push,
) {
  if (!Array.isArray(executions)) {
    push(
      "executions : registre append-only des exécutions promotionnelles attendu (éventuellement vide)",
    );
    return [];
  }
  const normalisees = [];
  const shasHistoriques = new Set();
  for (const release of releases) {
    if (estShaCandidat(release?.sha)) shasHistoriques.add(release.sha);
    for (const entree of Array.isArray(release?.journal)
      ? release.journal
      : []) {
      const sha = entree?.graphe?.contenu?.release?.sha;
      if (estShaCandidat(sha)) shasHistoriques.add(sha);
    }
  }
  let commencementPrecedent = null;

  for (const [index, execution] of executions.entries()) {
    const libelle = `execution #${index + 1}`;
    if (
      !execution ||
      typeof execution !== "object" ||
      Array.isArray(execution) ||
      !listeEgale(Object.keys(execution).sort(), [
        "cible",
        "evenements",
        "graphe",
        "id",
        "precedent",
        "programme",
        "recu-demarrage",
        "schema",
        "tranche",
      ]) ||
      execution.schema !== "punks.release-execution.v1" ||
      typeof execution.id !== "string" ||
      execution.id.trim() === "" ||
      !PROGRAMMES_EXECUTION.includes(execution.programme)
    ) {
      push(`${libelle} : schéma fermé d'exécution promotionnelle invalide`);
      continue;
    }
    if (registre.executions.has(execution.id)) {
      push(`${libelle} : identifiant d'exécution dupliqué « ${execution.id} »`);
    } else {
      registre.executions.add(execution.id);
    }
    const cible = releases.find((release) => release?.id === execution.cible);
    if (
      !cible ||
      execution.tranche !== cible.tranche ||
      execution.tranche !== execution.graphe?.contenu?.tranche
    ) {
      push(`${libelle} : cible et tranche Punks exactes exigées`);
    }
    const phase =
      execution.programme === "roll-forward" ? "active" : execution.programme;
    const clotureDeclaree = execution.evenements?.some(
      (evenement) => evenement?.contenu?.nature === "phase-fermee",
    );
    const clotureLiee = clotureDeclaree
      ? trouverClotureExecution(execution, cible, recuperations)
      : null;
    const redemarrage = execution.programme === "roll-forward" ? "E0" : null;
    const releaseId = execution.graphe?.contenu?.["release-id"];
    const instantane = validerInstantaneRelease(
      execution.graphe,
      {
        tranche: execution.tranche,
        phase,
        instant: execution.graphe?.contenu?.instant,
        releaseId,
        redemarrage,
        precedent: lienDepuisDescripteur(execution.precedent),
      },
      registre,
      push,
      `${libelle} : graphe scellé`,
    );
    if (instantane?.release?.id !== execution.cible) {
      push(`${libelle} : le snapshot doit embarquer la release cible exacte`);
    }
    const sha = instantane?.release?.sha;
    if (
      !estShaCandidat(sha) ||
      shaReserve(sha) ||
      (shasHistoriques.has(sha) && clotureLiee === null) ||
      registre.shasRecuperations.has(sha)
    ) {
      push(
        `${libelle} : l'exécution doit sceller un SHA Punks neuf, jamais Punks ni un candidat historique`,
      );
    } else if (!shasHistoriques.has(sha)) {
      shasHistoriques.add(sha);
      registre.shasRecuperations.add(sha);
    }
    const deploiement = instantane?.contenu?.deploiement;
    if (
      typeof deploiement !== "string" ||
      deploiement.trim() === "" ||
      (registre.deploiementsTransitions.has(deploiement) &&
        clotureLiee === null)
    ) {
      push(`${libelle} : déploiement Cloudflare neuf et non rejoué exigé`);
    } else if (!registre.deploiementsTransitions.has(deploiement)) {
      registre.deploiementsTransitions.add(deploiement);
    }
    if (
      typeof releaseId !== "string" ||
      releaseId.trim() === "" ||
      (registre.releaseIdsTransitions.has(releaseId) && clotureLiee === null)
    ) {
      push(`${libelle} : release-id d'exécution neuf et non rejoué exigé`);
    } else if (!registre.releaseIdsTransitions.has(releaseId)) {
      registre.releaseIdsTransitions.add(releaseId);
    }

    const contenuDemarrage = validerRecuSigne(
      execution["recu-demarrage"],
      `${libelle} : Reçu de démarrage`,
      registre,
      push,
      {
        approbateursAttendus:
          execution["recu-demarrage"]?.contenu?.approbateurs,
      },
    );
    const instantDemarrage = parseInstant(contenuDemarrage?.instant);
    const idDemarrage = `recu-demarrage-${execution.id}-${execution.graphe?.sha256}`;
    const clesDemarrage = [
      "approbateurs",
      "cible",
      "deploiement",
      "execution-id",
      "graphe-sha256",
      "id",
      "instant",
      "precedent",
      "programme",
      "release-id",
      "schema",
      "sequence",
      "sha-punks",
      "type",
    ];
    if (
      !contenuDemarrage ||
      !listeEgale(Object.keys(contenuDemarrage).sort(), clesDemarrage) ||
      contenuDemarrage.id !== idDemarrage ||
      contenuDemarrage.type !== "execution-demarrage" ||
      contenuDemarrage["execution-id"] !== execution.id ||
      contenuDemarrage.sequence !== 0 ||
      contenuDemarrage.cible !== execution.cible ||
      contenuDemarrage.programme !== execution.programme ||
      contenuDemarrage["release-id"] !== releaseId ||
      contenuDemarrage["sha-punks"] !== sha ||
      contenuDemarrage["graphe-sha256"] !== execution.graphe?.sha256 ||
      contenuDemarrage.deploiement !== deploiement ||
      shaCanoniqueOptionnel(contenuDemarrage.precedent) !==
        shaCanoniqueOptionnel(execution.precedent) ||
      instantDemarrage === null
    ) {
      push(
        `${libelle} : le Reçu de démarrage doit sceller l'identité, le prédécesseur et le graphe exacts avec sequence=0`,
      );
    }
    const instantGraphe = parseInstant(instantane?.contenu?.instant);
    if (
      instantGraphe === null ||
      instantDemarrage === null ||
      instantGraphe > instantDemarrage
    ) {
      push(`${libelle} : le graphe doit être scellé avant le démarrage`);
    }
    if (
      instantDemarrage !== null &&
      commencementPrecedent !== null &&
      instantDemarrage < commencementPrecedent
    ) {
      push(
        `${libelle} : les exécutions doivent être strictement chronologiques et append-only`,
      );
    }
    if (instantDemarrage !== null) commencementPrecedent = instantDemarrage;

    const executionsDansLeFutur = normalisees.filter((executionPrecedente) => {
      const debut = parseInstant(executionPrecedente?.termineA);
      const actualiseA = parseInstant(executionPrecedente?.actualiseA);
      return (
        executionPrecedente?.cible?.id === execution.cible &&
        instantDemarrage !== null &&
        debut !== null &&
        actualiseA !== null &&
        debut < instantDemarrage &&
        actualiseA > instantDemarrage
      );
    });
    if (executionsDansLeFutur.length > 0) {
      push(
        `${libelle} : une nouvelle exécution ne peut chevaucher un événement signé ultérieur d'une exécution précédente`,
      );
    }
    const teteBaseStatique =
      execution.programme === "roll-forward"
        ? teteBaseA(releases, instantDemarrage, { promotionnelle: true })
        : teteDeReleaseA(cible, instantDemarrage);
    const teteBase =
      instantDemarrage === null
        ? null
        : teteLaPlusRecente(
            teteLaPlusRecente(
              teteBaseStatique,
              teteExecutionA(normalisees, instantDemarrage, {
                cibleId:
                  execution.programme === "roll-forward"
                    ? null
                    : execution.cible,
              }),
            ),
            teteRecuperationDeclareeA(
              recuperations,
              releases,
              instantDemarrage,
              {
                cibleId:
                  execution.programme === "roll-forward"
                    ? null
                    : execution.cible,
              },
            ),
          );
    if (
      teteBase?.executionId &&
      (teteBase.statut === "en-cours" ||
        (["pause", "echec", "quarantaine"].includes(teteBase.statut) &&
          execution.programme !== "roll-forward"))
    ) {
      push(
        `${libelle} : une tête en cours, pausée, échouée ou quarantainée ne peut être consommée que par sa reprise locale ou un roll-forward à E0`,
      );
    }
    const precedentAttendu = descripteurTeteOperationnelle(teteBase);
    if (
      shaCanoniqueOptionnel(execution.precedent) !==
      shaCanoniqueOptionnel(precedentAttendu)
    ) {
      push(
        `${libelle} : le prédécesseur doit être la tête opérationnelle exacte au démarrage`,
      );
    }

    const politique = politiquePourExecution(execution.programme, instantane);
    if (!politique) {
      push(`${libelle} : programme sans cadence fermée`);
      continue;
    }
    const evenements = Array.isArray(execution.evenements)
      ? execution.evenements
      : [];
    if (!Array.isArray(execution.evenements)) {
      push(`${libelle} : liste append-only d'événements signés attendue`);
    }
    const recusEtapes = [];
    let sequence = 1;
    let precedentEvenementSha256 = execution["recu-demarrage"]?.sha256;
    let instantEvenementPrecedent = instantDemarrage;
    let statut = "en-cours";
    let terminal = false;
    let expansionTermineeA = null;
    let recuTransitionSha256 = null;
    let recuExecutionPrecedentSha256 = null;
    let etatOperationnelPrecedent = null;
    for (const evenement of evenements) {
      const contenu = validerRecuSigne(
        evenement,
        `${libelle} : événement #${sequence}`,
        registre,
        push,
        { approbateursAttendus: evenement?.contenu?.approbateurs },
      );
      const nature = contenu?.nature;
      const commun = [
        "approbateurs",
        "cible",
        "execution-id",
        "graphe-sha256",
        "id",
        "instant",
        "nature",
        "precedent-evenement-sha256",
        "programme",
        "release-id",
        "schema",
        "sequence",
        "sha-punks",
        "type",
      ];
      const clesAttendues =
        nature === "etape-fermee"
          ? [...commun, "recu-etape"].sort()
          : nature === "phase-fermee"
            ? [...commun, "recu-transition-id", "recu-transition-sha256"].sort()
            : [
                ...commun,
                "bookmarks",
                "cause",
                "dlq",
                "etape",
                "fenetres-observation",
                "fencing",
                "generation-compatibilite",
                "hashes-desktop",
                "incident-sha256",
                "incidents",
                "outboxes",
                "perimetre",
                "verdicts-metriques",
                "workers",
                "workflows",
              ].sort();
      const instantEvenement = parseInstant(contenu?.instant);
      const quarantaineCritiqueImmediate =
        nature === "quarantaine" &&
        etatOperationnelPrecedent?.incident?.categorie === "violation-critique";
      if (
        !contenu ||
        !NATURES_EVENEMENT_EXECUTION.includes(nature) ||
        !listeEgale(Object.keys(contenu).sort(), clesAttendues) ||
        contenu.id !== `recu-execution-${execution.id}-${sequence}-${nature}` ||
        contenu.type !== "execution-evenement" ||
        contenu["execution-id"] !== execution.id ||
        contenu.sequence !== sequence ||
        contenu["precedent-evenement-sha256"] !== precedentEvenementSha256 ||
        contenu.cible !== execution.cible ||
        contenu.programme !== execution.programme ||
        contenu["release-id"] !== releaseId ||
        contenu["sha-punks"] !== sha ||
        contenu["graphe-sha256"] !== execution.graphe?.sha256 ||
        instantEvenement === null ||
        (instantEvenementPrecedent !== null &&
          (nature === "phase-fermee"
            ? instantEvenement < instantEvenementPrecedent
            : quarantaineCritiqueImmediate
              ? instantEvenement < instantEvenementPrecedent
              : instantEvenement <= instantEvenementPrecedent)) ||
        terminal
      ) {
        push(
          `${libelle} : événement #${sequence} doit prolonger sans fork la séquence signée de l'exécution`,
        );
      }
      if (nature === "etape-fermee") {
        if (statut !== "en-cours") {
          push(
            `${libelle} : une étape ne peut être fermée pendant une pause ou après un état terminal`,
          );
        }
        const recuEtape = contenu?.["recu-etape"];
        const attendu = politique[recusEtapes.length];
        if (!attendu || recuEtape?.contenu?.etape !== attendu.etape) {
          push(
            `${libelle} : les étapes fermées doivent former un préfixe exact sans saut`,
          );
        }
        if (contenu?.instant !== recuEtape?.contenu?.heures?.fin) {
          push(
            `${libelle} : l'événement de fermeture doit coïncider avec la fin du Reçu d'étape`,
          );
        }
        recusEtapes.push(recuEtape);
        if (attendu?.etape === "E4") {
          expansionTermineeA = instantEvenement;
        }
      } else if (nature === "phase-fermee") {
        const recuTransition = clotureLiee?.recu;
        const contenuTransition = recuTransition?.contenu;
        const cadenceTransition = contenuTransition?.cadence;
        const cadenceIdentique =
          Array.isArray(cadenceTransition) &&
          cadenceTransition.length === recusEtapes.length &&
          cadenceTransition.every(
            (recuEtape, index) =>
              recuEtape?.sha256 === recusEtapes[index]?.sha256,
          );
        if (
          statut !== "en-cours" ||
          recusEtapes.length !== politique.length ||
          clotureLiee === null ||
          contenu?.instant !== clotureLiee.instant ||
          contenu?.["recu-transition-id"] !== recuTransition?.id ||
          contenu?.["recu-transition-sha256"] !== recuTransition?.sha256 ||
          contenuTransition?.["execution-id"] !== execution.id ||
          contenuTransition?.["recu-execution-precedent-sha256"] !==
            precedentEvenementSha256 ||
          !cadenceIdentique
        ) {
          push(
            `${libelle} : la clôture réussie doit relier exactement la cadence complète, sa tête d'exécution et le Reçu terminal du journal`,
          );
        }
        recuTransitionSha256 = recuTransition?.sha256 ?? null;
        recuExecutionPrecedentSha256 = precedentEvenementSha256;
        statut = "reussie";
        terminal = true;
      } else if (nature === "pause") {
        if (statut !== "en-cours") {
          push(
            `${libelle} : une pause ne peut partir que d'une exécution en cours`,
          );
        }
        statut = "pause";
      } else if (nature === "reprise") {
        if (statut !== "pause") {
          push(
            `${libelle} : une reprise exige une pause immédiatement antérieure`,
          );
        }
        statut = "en-cours";
      } else if (["echec", "quarantaine"].includes(nature)) {
        if (
          statut !== "pause" &&
          !(nature === "quarantaine" && statut === "quarantaine")
        ) {
          push(
            `${libelle} : un échec doit prolonger une pause signée et une quarantaine seulement une pause ou sa propre preuve append-only`,
          );
        }
        statut = nature;
        const incidentCourant = Array.isArray(contenu?.incidents)
          ? contenu.incidents.find(
              (incident) =>
                canonicalSha256(incident) === contenu?.["incident-sha256"],
            )
          : null;
        const detecteA = parseInstant(incidentCourant?.["detecte-a"]);
        const qualifieA = parseInstant(incidentCourant?.["qualifie-a"]);
        const escaladeA = parseInstant(incidentCourant?.["escalade-a"]);
        const instantEtat = parseInstant(contenu?.instant);
        const qualificationScellee =
          qualifieA !== null ||
          (detecteA !== null &&
            instantEtat !== null &&
            instantEtat > detecteA + QUALIFICATION_PERIMETRE_MAX_MS &&
            escaladeA === detecteA + QUALIFICATION_PERIMETRE_MAX_MS);
        terminal = nature === "echec" || qualificationScellee;
      }
      if (!["etape-fermee", "phase-fermee"].includes(nature)) {
        etatOperationnelPrecedent = validerEtatExecution(
          contenu,
          nature,
          politique[Math.min(recusEtapes.length, politique.length - 1)],
          execution.programme,
          instantane,
          etatOperationnelPrecedent,
          push,
          `${libelle} : ${String(nature)}`,
        );
      }
      if (estSha256(evenement?.sha256)) {
        precedentEvenementSha256 = evenement.sha256;
      }
      if (instantEvenement !== null) {
        instantEvenementPrecedent = instantEvenement;
      }
      sequence += 1;
    }

    if (recusEtapes.length === politique.length && statut !== "reussie") {
      push(
        `${libelle} : une cadence complète doit être close par un événement lié au Reçu terminal du journal`,
      );
    }
    if (recusEtapes.length > 0) {
      const debut = recusEtapes[0]?.contenu?.heures?.debut;
      const fin = recusEtapes.at(-1)?.contenu?.heures?.fin;
      const contenuPrefixe = {
        type:
          execution.programme === "roll-forward"
            ? "roll-forward"
            : "transition",
        transition: execution.programme,
        "release-id": releaseId,
        "sha-punks": sha,
        "graphe-sha256": execution.graphe?.sha256,
        approbateurs: contenuDemarrage?.approbateurs,
        cadence: recusEtapes,
        heures: { debut, fin },
      };
      validerCadenceOperationnelle(
        contenuPrefixe,
        instantane,
        { instant: fin },
        clotureLiee === null ? registre : registreLocal(registre),
        contenuDemarrage?.instant,
        push,
        `${libelle} : progression`,
        { prefixeAutorise: true },
      );
    }

    const recuTete =
      statut === "reussie" && clotureLiee?.recu
        ? clotureLiee.recu
        : (evenements.at(-1) ?? execution["recu-demarrage"]);
    const tete =
      instantane && estSha256(recuTete?.sha256)
        ? {
            cible,
            release: instantane.release,
            snapshot: execution.graphe,
            lien: {
              "graphe-sha256": execution.graphe.sha256,
              "recu-sha256": recuTete.sha256,
            },
            termineA: contenuDemarrage?.instant,
            actualiseA: recuTete?.contenu?.instant,
            executionId: execution.id,
            programme: execution.programme,
            statut,
            expansionTermineeA,
            recuTransitionSha256,
            recuExecutionPrecedentSha256,
            precedent: structuredClone(execution.precedent),
            incident: structuredClone(
              etatOperationnelPrecedent?.incident ?? null,
            ),
            perimetre: etatOperationnelPrecedent?.contenu?.perimetre ?? null,
          }
        : null;
    if (tete) {
      normalisees.push(tete);
    }
  }
  return normalisees;
}

function teteExecutionA(
  executions,
  instant,
  { exclureRecu = null, cibleId = null, statuts = null } = {},
) {
  return executions
    .filter((execution) => {
      const commence = parseInstant(execution?.termineA);
      const actualise = parseInstant(execution?.actualiseA);
      return (
        (cibleId === null || execution?.cible?.id === cibleId) &&
        (statuts === null || statuts.includes(execution?.statut)) &&
        (exclureRecu === null ||
          execution?.recuTransitionSha256 !== exclureRecu) &&
        commence !== null &&
        commence <= instant &&
        actualise !== null &&
        actualise <= instant
      );
    })
    .sort((a, b) => parseInstant(b.termineA) - parseInstant(a.termineA))[0];
}

function validerSchemaRecuperation(
  recuperation,
  avecEngagement,
  push,
  libelle,
) {
  const cles =
    recuperation.type === "roll-forward"
      ? [
          "cible",
          "date",
          "depuis",
          ...(avecEngagement ? ["engagement-recuperation"] : []),
          "execution-precedente",
          "graphes",
          "instant",
          "recu",
          "redemarrage",
          "type",
        ].sort()
      : [
          "certificat",
          "cible",
          "date",
          ...(avecEngagement ? ["engagement-recuperation"] : []),
          "execution-precedente",
          "instant",
          "type",
        ].sort();
  if (!listeEgale(Object.keys(recuperation).sort(), cles)) {
    push(
      `${libelle} : récupération à schéma fermé exigée, sans arête ni politique implicite`,
    );
  }
}

function validerEngagementRecuperation(
  recuperation,
  tete,
  contenuRecu,
  push,
  libelle,
) {
  if (!tete?.incident) return;
  const engagement = recuperation["engagement-recuperation"];
  const detecteA = parseInstant(tete.incident["detecte-a"]);
  const qualifieA = parseInstant(tete.incident["qualifie-a"]);
  const escaladeQualificationA = parseInstant(tete.incident["escalade-a"]);
  const engageA = parseInstant(engagement?.["engage-a"]);
  const echeanceA = parseInstant(engagement?.["echeance-a"]);
  const instantRecuperation = parseInstant(recuperation.instant);
  const echeanceAttendue =
    detecteA === null
      ? null
      : new Date(detecteA + RECUPERATION_CIBLE_MAX_MS)
          .toISOString()
          .replace(".000Z", "Z");
  const depassement =
    instantRecuperation !== null &&
    echeanceA !== null &&
    instantRecuperation > echeanceA;
  const echeanceQualification =
    detecteA === null ? null : detecteA + QUALIFICATION_PERIMETRE_MAX_MS;
  const incidentCritiqueScelle =
    tete.incident.categorie !== "violation-critique" ||
    (qualifieA !== null &&
      instantRecuperation !== null &&
      qualifieA <= instantRecuperation) ||
    (echeanceQualification !== null &&
      instantRecuperation !== null &&
      instantRecuperation > echeanceQualification &&
      escaladeQualificationA === echeanceQualification);
  const valide =
    engagement &&
    typeof engagement === "object" &&
    !Array.isArray(engagement) &&
    listeEgale(Object.keys(engagement).sort(), [
      "detecte-a",
      "echeance-a",
      "engage-a",
      "escalade-depassement-sha256",
      "incident-sha256",
      "perimetre",
      "perimetre-ferme",
      "schema",
    ]) &&
    engagement.schema === "punks.recovery-commitment.v1" &&
    engagement["incident-sha256"] === canonicalSha256(tete.incident) &&
    engagement["detecte-a"] === tete.incident["detecte-a"] &&
    engagement["echeance-a"] === echeanceAttendue &&
    detecteA !== null &&
    engageA !== null &&
    engageA >= detecteA &&
    engageA <= detecteA + RECUPERATION_CIBLE_MAX_MS &&
    instantRecuperation !== null &&
    engageA <= instantRecuperation &&
    engagement.perimetre === tete.perimetre &&
    engagement["perimetre-ferme"] === true &&
    incidentCritiqueScelle &&
    (depassement
      ? estSha256(engagement["escalade-depassement-sha256"])
      : engagement["escalade-depassement-sha256"] === null);
  if (!valide) {
    push(
      `${libelle} : l'incident doit porter un engagement ciblé signé sous quatre heures, périmètre fermé et dépassement escaladé`,
    );
  }
  if (
    !engagement ||
    contenuRecu?.["engagement-recuperation-sha256"] !==
      canonicalSha256(engagement)
  ) {
    push(
      `${libelle} : le Reçu terminal doit lier le hash exact de l'engagement de récupération`,
    );
  }
}

function validerRecuperations(
  recuperations,
  releases,
  profilsSupportes,
  executions,
  invalidationsAttestations,
  registre,
  push,
) {
  const entries = Array.isArray(recuperations) ? recuperations : [];
  if (recuperations !== undefined && !Array.isArray(recuperations)) {
    push("recuperations : liste attendue");
    return;
  }
  let instantPrecedent = null;
  let teteRecuperee = null;
  for (const [index, recuperation] of entries.entries()) {
    const id = `recuperation #${index + 1}`;
    if (!recuperation || typeof recuperation !== "object") {
      push(`${id} : entrée malformée`);
      continue;
    }
    const dateRecuperation = parseDate(recuperation.date);
    if (dateRecuperation === null) {
      push(`${id} : date YYYY-MM-DD manquante`);
    }
    const instantRecuperation = parseInstant(recuperation.instant);
    if (
      instantRecuperation === null ||
      recuperation.instant?.slice(0, 10) !== recuperation.date
    ) {
      push(
        `${id} : instant UTC canonique cohérent avec la date de récupération exigé`,
      );
    } else if (
      instantPrecedent !== null &&
      instantRecuperation <= instantPrecedent
    ) {
      push(
        `${id} : les récupérations forment un journal strictement chronologique et append-only`,
      );
    } else {
      instantPrecedent = instantRecuperation;
    }
    if (!TYPES_RECUPERATION.includes(recuperation.type)) {
      push(
        `${id} : type inconnu « ${String(recuperation.type)} » — le vocabulaire fermé (${TYPES_RECUPERATION.join(", ")}) exclut structurellement tout retour vers le produit précédent`,
      );
      continue;
    }
    const cible = releases.find((r) => r?.id === recuperation.cible);
    if (!cible) {
      push(
        `${id} : cible « ${String(recuperation.cible)} » inconnue — une récupération ne peut viser que le graphe Punks, jamais le produit précédent`,
      );
      continue;
    }
    if (
      cible.etat === "preparation" &&
      !executions.some((execution) => execution?.cible?.id === cible.id)
    ) {
      push(
        `${id} : cible ${cible.id} non scellée — une récupération ne peut promouvoir un candidat sans dossier de preuve`,
      );
    }
    if (dateRecuperation === null || instantRecuperation === null) {
      continue;
    }
    if (recuperation.type === "roll-forward") {
      const executionTerminee = executions.find(
        (execution) =>
          execution?.statut === "reussie" &&
          execution?.recuTransitionSha256 === recuperation?.recu?.sha256,
      );
      const tete = teteLaPlusRecente(
        teteLaPlusRecente(
          teteBaseA(releases, instantRecuperation, { promotionnelle: true }),
          teteExecutionA(executions, instantRecuperation, {
            exclureRecu: recuperation?.recu?.sha256,
          }),
        ),
        teteRecuperee,
      );
      if (cible.etat === "preparation" && !tete?.executionId) {
        push(
          `${id} : cible ${cible.id} non scellée — une récupération ne peut promouvoir un candidat sans dossier de preuve`,
        );
      }
      validerSchemaRecuperation(
        recuperation,
        Boolean(tete?.incident),
        push,
        id,
      );
      const nouvelleTete = validerRollForward(
        recuperation,
        cible,
        releases,
        instantRecuperation,
        tete,
        executionTerminee,
        registre,
        push,
      );
      if (nouvelleTete !== null) {
        teteRecuperee = nouvelleTete;
      }
    } else if (recuperation.type === "retour-punks") {
      if (cible.etat === "preparation") {
        push(
          `${id} : cible ${cible.id} non scellée — une récupération ne peut promouvoir un candidat sans dossier de preuve`,
        );
      }
      const activationCible = instantTransition(cible, "active");
      if (activationCible === null || activationCible > instantRecuperation) {
        push(
          `${id} : un retour Punks ne peut viser qu'une release déjà activée avant l'instant de récupération`,
        );
        continue;
      }
      const teteReference = teteLaPlusRecente(
        teteLaPlusRecente(
          teteBaseA(releases, instantRecuperation, {
            promotionnelle: false,
          }),
          teteExecutionA(executions, instantRecuperation, {
            statuts: ["en-cours", "pause", "echec", "quarantaine"],
          }),
        ),
        teteRecuperee,
      );
      const executionPrecedenteAttendue = teteReference?.executionId
        ? descripteurTeteOperationnelle(teteReference)
        : null;
      if (
        canonicalSha256(recuperation?.["execution-precedente"] ?? null) !==
        canonicalSha256(executionPrecedenteAttendue)
      ) {
        push(
          `${id} : le retour Punks doit citer l'identité complète de l'exécution partielle qu'il consomme`,
        );
      }
      if (
        teteReference?.executionId &&
        !["reussie", "pause", "echec", "quarantaine"].includes(
          teteReference.statut,
        )
      ) {
        push(
          `${id} : une exécution en cours doit être pausée, échouée ou mise en quarantaine avant un retour Punks`,
        );
      }
      validerSchemaRecuperation(
        recuperation,
        Boolean(teteReference?.incident),
        push,
        id,
      );
      const nouvelleTete = validerCertificat(
        recuperation,
        cible,
        releases,
        profilsSupportes,
        instantRecuperation,
        teteReference,
        invalidationsAttestations,
        registre,
        push,
      );
      if (nouvelleTete !== null) teteRecuperee = nouvelleTete;
    }
  }
  validerChevauchementsRecuperations(releases, entries, executions, push);
}

function validerChevauchementsRecuperations(
  releases,
  recuperations,
  executions,
  push,
) {
  const intervalles = [];
  for (const release of releases) {
    const entreeExpansion = release?.journal?.find(
      (entree) => entree?.vers === "expansion",
    );
    const recuExpansion = release?.recus?.find(
      (recu) => recu?.id === entreeExpansion?.recu,
    );
    const debut = parseInstant(recuExpansion?.contenu?.heures?.debut);
    const fin = parseInstant(recuExpansion?.contenu?.heures?.fin);
    if (debut !== null && fin !== null) {
      intervalles.push({
        id: `${release.id}/expansion`,
        debut,
        fin,
      });
    }
  }
  for (const [index, recuperation] of recuperations.entries()) {
    if (recuperation?.type !== "roll-forward") continue;
    const cadence = recuperation.recu?.contenu?.cadence;
    const debut = parseInstant(cadence?.[0]?.contenu?.heures?.debut);
    const fin = parseInstant(
      cadence?.find((recuEtape) => recuEtape?.contenu?.etape === "E4")?.contenu
        ?.heures?.fin,
    );
    if (debut !== null && fin !== null) {
      intervalles.push({
        id: `recuperation #${index + 1}/roll-forward`,
        debut,
        fin,
      });
    }
  }
  for (const execution of executions) {
    if (!["expansion", "roll-forward"].includes(execution?.programme)) {
      continue;
    }
    if (
      execution?.statut === "reussie" &&
      estSha256(execution?.recuTransitionSha256)
    ) {
      // Le même intervalle est déjà porté par le journal ou la récupération
      // terminale liée dans les deux sens à cette exécution.
      continue;
    }
    const debut = parseInstant(execution?.termineA);
    const finExpansion = parseInstant(execution?.expansionTermineeA);
    const consommation = recuperations.find(
      (recuperation) =>
        recuperation?.type === "roll-forward" &&
        recuperation?.["execution-precedente"]?.["execution-id"] ===
          execution.executionId,
    );
    const finConsommee = parseInstant(
      consommation?.recu?.contenu?.cadence?.[0]?.contenu?.heures?.debut,
    );
    const terminale = ["reussie", "echec", "quarantaine"].includes(
      execution?.statut,
    );
    const fin =
      finExpansion ??
      finConsommee ??
      (terminale
        ? parseInstant(execution?.actualiseA)
        : Number.POSITIVE_INFINITY);
    if (debut !== null && fin !== null && fin > debut) {
      intervalles.push({
        id: `${execution.executionId}/execution-partielle`,
        debut,
        fin,
      });
    }
  }
  intervalles.sort((a, b) => a.debut - b.debut);
  for (let index = 0; index < intervalles.length; index += 1) {
    for (let autre = index + 1; autre < intervalles.length; autre += 1) {
      const gauche = intervalles[index];
      const droite = intervalles[autre];
      if (droite.debut >= gauche.fin) break;
      if (gauche.debut < droite.fin) {
        push(
          `expansions : ${gauche.id} chevauche ${droite.id} — au plus une expansion E0→E4, normale ou de récupération, est admise à tout instant`,
        );
      }
    }
  }
}

function validerRollForward(
  recuperation,
  cible,
  releases,
  instantRecuperation,
  tete,
  executionTerminee,
  registre,
  push,
) {
  if (!executionTerminee) {
    push(
      `${cible.id} : un roll-forward terminal exige une exécution réussie liée dans les deux sens à sa chaîne signée E0→E4 puis A0→A4`,
    );
  }
  if (
    executionTerminee &&
    (canonicalSha256(executionTerminee.precedent ?? null) !==
      canonicalSha256(recuperation?.["execution-precedente"] ?? null) ||
      executionTerminee.snapshot?.sha256 !==
        recuperation?.graphes?.nouveau?.sha256)
  ) {
    push(
      `${cible.id} : l'exécution réussie du roll-forward doit prolonger le même prédécesseur et le même nouveau graphe`,
    );
  }
  const executionPrecedenteAttendue = tete?.executionId
    ? descripteurTeteOperationnelle(tete)
    : null;
  if (
    canonicalSha256(recuperation?.["execution-precedente"] ?? null) !==
    canonicalSha256(executionPrecedenteAttendue)
  ) {
    push(
      `${cible.id} : le roll-forward doit citer l'identité complète de l'exécution partielle qu'il consomme`,
    );
  }
  if (
    tete?.executionId &&
    !["reussie", "pause", "echec", "quarantaine"].includes(tete.statut)
  ) {
    push(
      `${cible.id} : une exécution en cours doit être pausée, échouée ou mise en quarantaine avant roll-forward`,
    );
  }
  const source = releases.find(
    (release) => release?.id === recuperation.depuis,
  );
  if (
    !source ||
    !tete?.cible ||
    source.id !== tete.cible.id ||
    cible.id !== tete.cible.id
  ) {
    push(
      `${cible.id} : roll-forward.depuis et cible doivent citer la tête opérationnelle Punks effectivement déployée à l'instant de la correction`,
    );
  }

  const graphes = recuperation.graphes;
  const precedentContenu = graphes?.precedent?.contenu;
  validerInstantaneRelease(
    graphes?.precedent,
    {
      tranche: precedentContenu?.tranche,
      phase: precedentContenu?.phase,
      instant: precedentContenu?.instant,
      releaseId: precedentContenu?.["release-id"],
      precedent: precedentContenu?.precedent,
      redemarrage: precedentContenu?.redemarrage ?? null,
    },
    registre,
    push,
    `${cible.id} : graphe précédent du roll-forward`,
  );
  const graphePrecedentAttendu = tete?.snapshot;
  if (
    !graphePrecedentAttendu ||
    !graphes?.precedent ||
    canonicalSha256(graphes?.precedent) !==
      canonicalSha256(graphePrecedentAttendu)
  ) {
    push(
      `${cible.id} : le graphe précédent doit sceller la tête opérationnelle exacte`,
    );
  }

  const nouveauReleaseId = graphes?.nouveau?.contenu?.["release-id"];
  const nouveau = validerInstantaneRelease(
    graphes?.nouveau,
    {
      tranche: source?.tranche,
      phase: "active",
      instant: graphes?.nouveau?.contenu?.instant,
      releaseId: nouveauReleaseId,
      redemarrage: "E0",
      precedent: tete?.lien,
    },
    registre,
    push,
    `${cible.id} : nouveau graphe du roll-forward`,
  );
  if (
    !estSha256(graphes?.precedent?.sha256) ||
    !estSha256(graphes?.nouveau?.sha256) ||
    graphes.precedent.sha256 === graphes.nouveau.sha256
  ) {
    push(
      `${cible.id} : le roll-forward doit produire un nouveau graphe scellé distinct`,
    );
  }
  const grapheScelleA = parseInstant(graphes?.nouveau?.contenu?.instant);
  if (grapheScelleA === null || grapheScelleA > instantRecuperation) {
    push(
      `${cible.id} : le graphe de roll-forward doit être scellé avant son Reçu terminal A4`,
    );
  }

  const historiques = new Set();
  for (const release of releases) {
    if (estShaCandidat(release?.sha)) historiques.add(release.sha);
    for (const entree of Array.isArray(release?.journal)
      ? release.journal
      : []) {
      const sha = entree?.graphe?.contenu?.release?.sha;
      if (estShaCandidat(sha)) historiques.add(sha);
    }
  }
  const nouveauSha = nouveau?.release?.sha;
  const reserveParExecution =
    executionTerminee?.release?.sha === nouveauSha &&
    executionTerminee?.snapshot?.sha256 === graphes?.nouveau?.sha256;
  if (
    !estShaCandidat(nouveauSha) ||
    shaReserve(nouveauSha) ||
    historiques.has(nouveauSha) ||
    (registre.shasRecuperations.has(nouveauSha) && !reserveParExecution)
  ) {
    push(
      `${cible.id} : un roll-forward doit sceller un nouveau SHA Punks, jamais Punks ni un candidat historique`,
    );
  } else if (!registre.shasRecuperations.has(nouveauSha)) {
    registre.shasRecuperations.add(nouveauSha);
  }
  const nouveauDeploiement = nouveau?.contenu?.deploiement;
  if (
    typeof nouveauDeploiement !== "string" ||
    nouveauDeploiement.trim() === "" ||
    (registre.deploiementsTransitions.has(nouveauDeploiement) &&
      !reserveParExecution)
  ) {
    push(
      `${cible.id} : le roll-forward doit porter un déploiement Cloudflare neuf et non rejoué`,
    );
  } else if (!registre.deploiementsTransitions.has(nouveauDeploiement)) {
    registre.deploiementsTransitions.add(nouveauDeploiement);
  }
  if (
    typeof nouveauReleaseId !== "string" ||
    nouveauReleaseId.trim() === "" ||
    nouveauReleaseId === precedentContenu?.["release-id"] ||
    (registre.releaseIdsTransitions.has(nouveauReleaseId) &&
      !reserveParExecution)
  ) {
    push(
      `${cible.id} : le nouveau graphe doit porter un release-id de roll-forward distinct`,
    );
  } else if (!registre.releaseIdsTransitions.has(nouveauReleaseId)) {
    registre.releaseIdsTransitions.add(nouveauReleaseId);
  }
  if (
    recuperation.redemarrage !== "E0" ||
    nouveau?.contenu?.redemarrage !== "E0"
  ) {
    push(`${cible.id} : le roll-forward doit redémarrer à E0`);
  }
  const workersTerminaux = nouveau?.contenu?.topologie?.workers;
  if (
    !Array.isArray(workersTerminaux) ||
    workersTerminaux.length === 0 ||
    workersTerminaux.some((worker) => worker?.pourcentage !== 100)
  ) {
    push(
      `${cible.id} : le graphe terminal du roll-forward doit avoir rejoué E0→E4 puis A0→A4 et exposer tous les Workers à 100 %`,
    );
  }

  const contenuRecu = validerRecuSigne(
    recuperation.recu,
    `${cible.id} : Reçu du roll-forward`,
    registre,
    push,
    { approbateursAttendus: recuperation.recu?.contenu?.approbateurs },
  );
  validerEngagementRecuperation(
    recuperation,
    tete,
    contenuRecu,
    push,
    `${cible.id} : roll-forward`,
  );
  if (
    contenuRecu?.type !== "roll-forward" ||
    contenuRecu.cible !== cible.id ||
    contenuRecu.instant !== recuperation.instant ||
    contenuRecu["release-id"] !== nouveauReleaseId ||
    shaCanoniqueOptionnel(contenuRecu.precedent) !==
      shaCanoniqueOptionnel(tete?.lien) ||
    canonicalSha256(contenuRecu?.["execution-precedente"] ?? null) !==
      canonicalSha256(executionPrecedenteAttendue) ||
    contenuRecu["graphe-sha256"] !== graphes?.nouveau?.sha256
  ) {
    push(
      `${cible.id} : le Reçu du roll-forward doit lier la cible, l'instant, la release et le nouveau graphe exacts`,
    );
  }
  validerChargeOperationnelle(
    contenuRecu,
    nouveau,
    { instant: recuperation.instant },
    recuperation.recu?.signatures,
    registre,
    tete?.termineA,
    push,
    `${cible.id} : Reçu du roll-forward`,
    { avecEngagement: Boolean(tete?.incident) },
  );
  return nouveau !== null &&
    estSha256(graphes?.nouveau?.sha256) &&
    estSha256(recuperation.recu?.sha256)
    ? {
        cible,
        release: nouveau?.release,
        snapshot: graphes.nouveau,
        lien: {
          "graphe-sha256": graphes.nouveau.sha256,
          "recu-sha256": recuperation.recu.sha256,
        },
        termineA: recuperation.instant,
      }
    : null;
}

function validerContenuAdresse(adresse, libelle, push) {
  if (
    !adresse ||
    typeof adresse !== "object" ||
    Array.isArray(adresse) ||
    !adresse.contenu ||
    typeof adresse.contenu !== "object" ||
    Array.isArray(adresse.contenu) ||
    !estSha256(adresse.sha256)
  ) {
    push(`${libelle} : contenu et sha256 valides exigés`);
    return null;
  }
  if (canonicalSha256(adresse.contenu) !== adresse.sha256) {
    push(`${libelle} : hash canonique du contenu divergent`);
  }
  return adresse.contenu;
}

function cleProfil(profil) {
  if (
    !profil ||
    typeof profil.id !== "string" ||
    !Number.isInteger(profil.version) ||
    !estSha256(profil.sha256)
  ) {
    return null;
  }
  return `${profil.id}\u0000${profil.version}\u0000${profil.sha256}`;
}

function validerProfilsCertificat(
  certificat,
  profilsSupportes,
  instant,
  cible,
  push,
) {
  const attendus = profilsSupportesA(profilsSupportes, instant);
  const recus = Array.isArray(certificat["profils-actifs"])
    ? certificat["profils-actifs"]
    : [];
  const clesRecues = new Set();
  let malforme = !Array.isArray(certificat["profils-actifs"]);
  for (const profil of recus) {
    const cle = cleProfil(profil);
    if (cle === null || clesRecues.has(cle)) {
      malforme = true;
    } else {
      clesRecues.add(cle);
    }
  }
  if (
    malforme ||
    clesRecues.size !== attendus.size ||
    [...attendus.keys()].some((cle) => !clesRecues.has(cle))
  ) {
    push(
      `${cible.id} : certificat.profils-actifs doit citer tous les profils desktop actifs à l'instant du retour selon la chronologie client indépendante`,
    );
  }
  return attendus;
}

function profilsEgaux(recus, attendus) {
  if (!Array.isArray(recus)) return false;
  const cles = recus.map(cleProfil);
  return (
    cles.every((cle) => cle !== null) &&
    new Set(cles).size === cles.length &&
    cles.length === attendus.size &&
    cles.every((cle) => attendus.has(cle))
  );
}

function proprietesEgales(objet, attendues) {
  return (
    objet &&
    typeof objet === "object" &&
    !Array.isArray(objet) &&
    listeEgale(Object.keys(objet).sort(), Object.keys(attendues).sort()) &&
    Object.entries(attendues).every(([cle, valeur]) => objet[cle] === valeur)
  );
}

function detailsControleValides(
  nom,
  details,
  cible,
  profilsAttendus,
  recuSha,
  instantaneReference,
  attestationEligibleSha256,
) {
  switch (nom) {
    case "bundle-manifeste-originaux":
      return digestsEgaux(details, cible["digests-production"]);
    case "attestation-valide-non-revoquee":
      return proprietesEgales(details, {
        "attestation-eligible-sha256": attestationEligibleSha256,
        invalidee: false,
        revoquee: false,
      });
    case "securite-isolation-effacement-sans-punks":
      return proprietesEgales(details, {
        vulnerabilite: false,
        "violation-isolation": false,
        "violation-effacement": false,
        "chemin-punks-nostr-public": false,
      });
    case "profils-desktop-actifs":
      return (
        proprietesEgales(details, { profils: details?.profils }) &&
        profilsEgaux(details.profils, profilsAttendus)
      );
    case "versions-etat-durable-objects": {
      return (
        proprietesEgales(details, { versions: details?.versions }) &&
        shaCanoniqueOptionnel(details?.versions) ===
          shaCanoniqueOptionnel(
            instantaneReference?.contenu?.topologie?.[
              "versions-etat-durable-objects"
            ],
          )
      );
    }
    case "migrations-durable-objects-franchissables":
      return proprietesEgales(details, { infranchissable: false });
    case "migrations-d1-expand-compatibles":
      return proprietesEgales(details, { "expand-compatible": true });
    case "formats-r2-tombstones-generations":
      return (
        shaCanoniqueOptionnel(details) ===
        shaCanoniqueOptionnel(
          instantaneReference?.contenu?.topologie?.["etat-r2"],
        )
      );
    case "topologie-cloudflare":
      if (!instantaneReference?.contenu?.topologie) return false;
      return proprietesEgales(details, {
        "inventaire-sha256": canonicalSha256(
          instantaneReference?.contenu?.topologie?.inventaire,
        ),
        "versions-cloudflare-sha256": canonicalSha256(
          instantaneReference?.contenu?.topologie?.["versions-cloudflare"],
        ),
        "workflows-sha256": canonicalSha256(
          instantaneReference?.contenu?.topologie?.workflows,
        ),
        "generation-compatibilite":
          instantaneReference?.contenu?.topologie?.["generation-compatibilite"],
        "moyens-connexion-sha256": canonicalSha256(
          instantaneReference?.contenu?.topologie?.["moyens-connexion"],
        ),
      });
    case "generations-secrets-attestation-sessions":
      return (
        proprietesEgales(details, {
          "cles-attestation": details?.["cles-attestation"],
          "generation-recuperation-sessions":
            details?.["generation-recuperation-sessions"],
          "generation-revoquee-reactivee": false,
          "generations-revoquees-sha256":
            details?.["generations-revoquees-sha256"],
          secrets: details?.secrets,
        }) &&
        details?.["generation-revoquee-reactivee"] === false &&
        shaCanoniqueOptionnel({
          secrets: details?.secrets,
          "cles-attestation": details?.["cles-attestation"],
          "generation-recuperation-sessions":
            details?.["generation-recuperation-sessions"],
          "generations-revoquees-sha256":
            details?.["generations-revoquees-sha256"],
        }) ===
          shaCanoniqueOptionnel(
            instantaneReference?.contenu?.topologie?.["generations-securite"],
          )
      );
    case "workflows-compatibles-ou-neutralises":
      return (
        proprietesEgales(details, {
          "preuve-staging-sha256": details?.["preuve-staging-sha256"],
          statut: details?.statut,
        }) &&
        (details?.statut === "compatible" ||
          details?.statut === "neutralise") &&
        estSha256(details?.["preuve-staging-sha256"])
      );
    case "smoke-handshake-probes":
      return proprietesEgales(details, {
        "smoke-production": "vert",
        handshake: "vert",
        "probes-critiques": "vert",
      });
    case "recu-cloudflare-digests-approbateurs":
      return (
        proprietesEgales(details, { "recu-sha256": recuSha }) &&
        details["recu-sha256"] === recuSha
      );
    default:
      return false;
  }
}

function validerControlesCertificat(
  certificat,
  cible,
  cibleHistorique,
  instantaneCible,
  instantaneReference,
  instant,
  profilsAttendus,
  recuSha,
  attestationEligibleSha256,
  push,
) {
  const controles = Array.isArray(certificat.controles)
    ? certificat.controles
    : [];
  const vus = new Map();
  if (!Array.isArray(certificat.controles)) {
    push(`${cible.id} : certificat.controles doit être une liste fermée`);
  }
  for (const controle of controles) {
    if (!controle || !CONTROLES_CERTIFICAT.includes(controle.controle)) {
      push(
        `${cible.id} : certificat contient un contrôle inconnu « ${String(controle?.controle)} »`,
      );
      continue;
    }
    if (vus.has(controle.controle)) {
      push(
        `${cible.id} : certificat duplique le contrôle obligatoire « ${controle.controle} »`,
      );
      continue;
    }
    vus.set(controle.controle, controle);
    const preuve = controle.preuve;
    if (
      !listeEgale(Object.keys(controle).sort(), [
        "controle",
        "preuve",
        "preuve-sha256",
      ]) ||
      !preuve ||
      typeof preuve !== "object" ||
      Array.isArray(preuve) ||
      !listeEgale(Object.keys(preuve).sort(), [
        "cible",
        "controle",
        "details",
        "graphe-cible-sha256",
        "graphe-reference-sha256",
        "instant",
        "release-id-cible",
        "release-id-reference",
        "resultat",
        "schema",
        "sha-cible",
        "topologie-reference-sha256",
      ]) ||
      preuve.schema !== "punks.compatibility-control.v1" ||
      preuve.controle !== controle.controle ||
      preuve.cible !== cible.id ||
      preuve["release-id-cible"] !== instantaneCible.entree["release-id"] ||
      preuve["graphe-cible-sha256"] !== instantaneCible.graphe.sha256 ||
      preuve["release-id-reference"] !==
        instantaneReference?.entree?.["release-id"] ||
      preuve["graphe-reference-sha256"] !==
        instantaneReference?.graphe?.sha256 ||
      preuve["topologie-reference-sha256"] !==
        shaCanoniqueOptionnel(instantaneReference?.contenu?.topologie) ||
      preuve["sha-cible"] !== cibleHistorique.sha ||
      preuve.instant !== instant ||
      preuve.resultat !== "vert"
    ) {
      push(
        `${cible.id} : contrôle « ${controle.controle} » doit porter la preuve verte exacte de la cible et de l'instant`,
      );
    }
    if (
      !estSha256(controle["preuve-sha256"]) ||
      !preuve ||
      canonicalSha256(preuve) !== controle["preuve-sha256"]
    ) {
      push(
        `${cible.id} : contrôle « ${controle.controle} » a un hash canonique du contenu de preuve divergent`,
      );
    }
    if (
      !detailsControleValides(
        controle.controle,
        preuve?.details,
        cibleHistorique,
        profilsAttendus,
        recuSha,
        instantaneReference,
        attestationEligibleSha256,
      )
    ) {
      push(
        `${cible.id} : contrôle « ${controle.controle} » ne prouve pas son invariant exact`,
      );
    }
  }
  for (const nom of CONTROLES_CERTIFICAT) {
    if (!vus.has(nom)) {
      push(`${cible.id} : contrôle obligatoire « ${nom} » manquant`);
    }
  }
  return vus;
}

function listeUniqueNonVide(valeur) {
  return (
    Array.isArray(valeur) &&
    valeur.length > 0 &&
    valeur.every(
      (item) => typeof item === "string" && item !== "" && item === item.trim(),
    ) &&
    new Set(valeur).size === valeur.length
  );
}

function digestsEgaux(recus, attendus) {
  return (
    recus &&
    attendus &&
    recus.bundle === attendus.bundle &&
    recus.manifeste === attendus.manifeste
  );
}

/**
 * Empreinte acyclique du certificat : le Reçu signe ce noyau et le treizième
 * contrôle lie ensuite le sha256 du Reçu. Le contrôle du Reçu est donc exclu
 * du noyau pour éviter une dépendance circulaire.
 */
export function empreinteDossierCompatibilite(certificat) {
  const controles = new Map(
    (Array.isArray(certificat?.controles) ? certificat.controles : []).map(
      (controle) => [controle?.controle, controle?.["preuve-sha256"]],
    ),
  );
  return canonicalSha256({
    schema: "punks.compatibility-dossier.v1",
    cible: certificat?.cible,
    "release-id-cible": certificat?.["release-id-cible"],
    "graphe-cible-sha256": certificat?.["graphe-cible-sha256"],
    "release-id-reference": certificat?.["release-id-reference"],
    "graphe-reference-sha256": certificat?.["graphe-reference-sha256"],
    "topologie-reference-sha256": certificat?.["topologie-reference-sha256"],
    "sha-cible": certificat?.["sha-cible"],
    "attestation-eligible-sha256": certificat?.["attestation-eligible-sha256"],
    "calcule-a": certificat?.["calcule-a"],
    contrats: certificat?.contrats,
    profil: certificat?.profil,
    "profil-version": certificat?.["profil-version"],
    "compatibilite-donnees": certificat?.["compatibilite-donnees"],
    "verifie-contre": certificat?.["verifie-contre"],
    "digests-production": certificat?.["digests-production"],
    "profils-actifs": certificat?.["profils-actifs"],
    controles: CONTROLES_CERTIFICAT.slice(0, -1).map((controle) => ({
      controle,
      "preuve-sha256": controles.get(controle),
    })),
  });
}

function validerRecuCertificat(
  certificat,
  cible,
  cibleHistorique,
  instantaneCible,
  instantaneReference,
  instantRecuperation,
  attestationEligibleSha256,
  avecEngagement,
  registre,
  push,
) {
  const recu = certificat.recu;
  if (!recu || typeof recu !== "object" || Array.isArray(recu)) {
    push(`${cible.id} : certificat.recu d'éligibilité manquant`);
    return null;
  }
  const contenu = validerRecuSigne(
    recu,
    `${cible.id} : nouveau Reçu d'éligibilité`,
    registre,
    push,
    {
      approbateursAttendus: recu.contenu?.approbateurs,
      doublon: `${cible.id} : Reçu d'éligibilité de récupération dupliqué — chaque recalcul produit un nouveau Reçu`,
    },
  );
  const clesContenu = [
    "approbateurs",
    "attestation-eligible-sha256",
    "cible",
    "digests-historiques",
    "dossier-compatibilite-sha256",
    ...(avecEngagement ? ["engagement-recuperation-sha256"] : []),
    "graphe-cible-sha256",
    "graphe-reference-sha256",
    "id",
    "identifiants-cloudflare",
    "instant",
    "release-id-cible",
    "release-id-reference",
    "schema",
    "sha-cible",
    "topologie-reference-sha256",
    "type",
  ].sort();
  if (!listeEgale(Object.keys(contenu ?? {}).sort(), clesContenu)) {
    push(`${cible.id} : nouveau Reçu d'éligibilité à schéma fermé exigé`);
  }
  if (contenu?.type !== "retour-punks" || contenu.cible !== cible.id) {
    push(
      `${cible.id} : le nouveau Reçu doit lier le retour Punks et la cible exacte`,
    );
  }
  if (contenu?.["attestation-eligible-sha256"] !== attestationEligibleSha256) {
    push(
      `${cible.id} : le nouveau Reçu doit citer l'attestation courante non révoquée ou sa supersession exacte`,
    );
  }
  if (
    contenu?.["release-id-cible"] !== instantaneCible.entree["release-id"] ||
    contenu?.["graphe-cible-sha256"] !== instantaneCible.graphe.sha256 ||
    contenu?.["sha-cible"] !== cibleHistorique.sha
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit lier le snapshot historique exact réellement déployé à l'instant du retour`,
    );
  }
  if (
    contenu?.["release-id-reference"] !==
      instantaneReference?.entree?.["release-id"] ||
    contenu?.["graphe-reference-sha256"] !==
      instantaneReference?.graphe?.sha256 ||
    contenu?.["topologie-reference-sha256"] !==
      shaCanoniqueOptionnel(instantaneReference?.contenu?.topologie)
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit lier le snapshot et la topologie exacts de la référence courante`,
    );
  }
  if (
    parseInstant(contenu?.instant) === null ||
    contenu.instant !== instantRecuperation
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit être émis à l'instant exact du retour`,
    );
  }
  if (
    shaCanoniqueOptionnel(contenu?.["identifiants-cloudflare"]) !==
    shaCanoniqueOptionnel(
      instantaneReference?.contenu?.topologie?.["versions-cloudflare"],
    )
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit citer exactement tous les identifiants Cloudflare actuels du snapshot de référence`,
    );
  }
  if (
    !digestsEgaux(
      contenu?.["digests-historiques"],
      cibleHistorique["digests-production"],
    )
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit lier les digests historiques de la cible`,
    );
  }
  if (
    contenu?.["dossier-compatibilite-sha256"] !==
    empreinteDossierCompatibilite(certificat)
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit signer le noyau canonique des douze preuves et du certificat`,
    );
  }
  if (
    !listeUniqueNonVide(contenu?.approbateurs) ||
    contenu.approbateurs.length < 2
  ) {
    push(
      `${cible.id} : le nouveau Reçu doit citer deux approbateurs distincts`,
    );
  }
  return recu;
}

function validerCertificat(
  recuperation,
  cible,
  releases,
  profilsSupportes,
  instantRecuperation,
  teteReference,
  invalidationsAttestations,
  registre,
  push,
) {
  const certificat = recuperation.certificat;
  if (!certificat || typeof certificat !== "object") {
    push(
      `${recuperation.cible} : retour Punks antérieur sans certificat de compatibilité exact — interdit`,
    );
    return null;
  }
  if (certificat.cible !== cible.id) {
    push(`${cible.id} : certificat.cible doit citer la cible exacte du retour`);
  }
  const instantaneCible = instantaneReleaseA(cible, instantRecuperation);
  if (instantaneCible === null) {
    push(
      `${cible.id} : aucun snapshot candidat déployé n'existe à l'instant du retour`,
    );
    return null;
  }
  const cibleHistorique = instantaneCible.release;
  const attestationEligibleSha256 = attestationEligible(
    instantaneCible.entree?.["attestation-sha256"],
    invalidationsAttestations,
    recuperation.instant,
  );
  if (attestationEligibleSha256 === null) {
    push(
      `${cible.id} : l'attestation du snapshot historique est révoquée sans supersession éligible`,
    );
  }
  if (certificat["attestation-eligible-sha256"] !== attestationEligibleSha256) {
    push(
      `${cible.id} : le certificat doit citer l'attestation courante non révoquée ou sa supersession exacte`,
    );
  }
  if (
    !listeEgale(Object.keys(certificat).sort(), [
      "attestation-eligible-sha256",
      "calcule-a",
      "cible",
      "compatibilite-donnees",
      "contrats",
      "controles",
      "digests-production",
      "graphe-cible-sha256",
      "graphe-reference-sha256",
      "profil",
      "profil-version",
      "profils-actifs",
      "recu",
      "release-id-cible",
      "release-id-reference",
      "sha-cible",
      "topologie-reference-sha256",
      "verifie-contre",
    ])
  ) {
    push(`${cible.id} : certificat de compatibilité à schéma fermé exigé`);
  }
  const reference = teteReference?.cible;
  const instantaneReference = teteReference?.snapshot
    ? {
        entree: {
          "release-id": teteReference.snapshot.contenu?.["release-id"],
        },
        graphe: teteReference.snapshot,
        contenu: teteReference.snapshot.contenu,
        release: teteReference.release,
      }
    : null;
  if (!reference || instantaneReference === null) {
    push(
      `${cible.id} : aucune release active de référence scellée à l'instant du retour`,
    );
    return null;
  }
  if (
    certificat["release-id-cible"] !== instantaneCible.entree["release-id"] ||
    certificat["graphe-cible-sha256"] !== instantaneCible.graphe.sha256 ||
    certificat["sha-cible"] !== cibleHistorique.sha
  ) {
    push(
      `${cible.id} : le certificat doit lier le snapshot candidat exact réellement déployé à l'instant du retour`,
    );
  }
  if (
    certificat["release-id-reference"] !==
      instantaneReference.entree["release-id"] ||
    certificat["graphe-reference-sha256"] !==
      instantaneReference.graphe.sha256 ||
    certificat["topologie-reference-sha256"] !==
      canonicalSha256(instantaneReference.contenu.topologie)
  ) {
    push(
      `${cible.id} : le certificat doit lier le snapshot et la topologie exacts de la release courante de référence`,
    );
  }
  if (
    parseInstant(certificat["calcule-a"]) === null ||
    certificat["calcule-a"] !== recuperation.instant
  ) {
    push(
      `${cible.id} : le certificat doit être recalculé à l'instant exact du retour`,
    );
  }
  const registreContrats = cibleHistorique.materiaux?.["registre-contrats"];
  const profil = cibleHistorique.materiaux?.profil;
  if (
    !Number.isInteger(certificat.contrats) ||
    (registreContrats && certificat.contrats !== registreContrats.version)
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
  if (
    !digestsEgaux(
      certificat["digests-production"],
      cibleHistorique["digests-production"],
    )
  ) {
    push(
      `${cible.id} : certificat.digests-production doit citer les digests production originaux de la cible`,
    );
  }
  const profilsAttendus = validerProfilsCertificat(
    certificat,
    profilsSupportes,
    instantRecuperation,
    cible,
    push,
  );
  const recu = validerRecuCertificat(
    certificat,
    cible,
    cibleHistorique,
    instantaneCible,
    instantaneReference,
    recuperation.instant,
    attestationEligibleSha256,
    Boolean(teteReference?.incident),
    registre,
    push,
  );
  validerEngagementRecuperation(
    recuperation,
    teteReference,
    recu?.contenu,
    push,
    `${cible.id} : retour Punks`,
  );
  validerControlesCertificat(
    certificat,
    cible,
    cibleHistorique,
    instantaneCible,
    instantaneReference,
    recuperation.instant,
    profilsAttendus,
    recu?.sha256,
    attestationEligibleSha256,
    push,
  );
  const verifie = releases.find((r) => r?.id === certificat["verifie-contre"]);
  if (!reference || verifie?.id !== reference.id) {
    push(
      `${recuperation.cible} : certificat.verifie-contre doit citer la release active de référence à l'instant du retour`,
    );
    return null;
  }
  if (
    !Number.isInteger(cible.tranche) ||
    !Number.isInteger(verifie.tranche) ||
    cible.tranche >= verifie.tranche
  ) {
    push(
      `${recuperation.cible} : un retour Punks doit viser une version Punks antérieure à ${verifie.id}`,
    );
  }
  return estSha256(instantaneCible.graphe?.sha256) && estSha256(recu?.sha256)
    ? {
        cible,
        release: cibleHistorique,
        snapshot: instantaneCible.graphe,
        lien: {
          "graphe-sha256": instantaneCible.graphe.sha256,
          "recu-sha256": recu.sha256,
        },
        termineA: recuperation.instant,
      }
    : null;
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
