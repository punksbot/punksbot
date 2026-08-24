/**
 * Socle de validation du dossier de preuve d'une promotion Punks (issue #52).
 *
 * La couture d'acceptation unique décidée par l'issue #47 (« Couture
 * d'acceptation unique ») installe le candidat Tauri final et signé, le
 * connecte au déploiement Workers exact d'un staging isolé, exerce les récits
 * de la tranche par l'interface et les contrats publics, vérifie les autorités
 * et les échecs observables, puis produit l'attestation immuable scellée par
 * le graphe de release (issue #51).
 *
 * Ce socle matérialise le dossier attendu et ses règles de refus :
 *
 *   - la liaison relie sans ambiguïté le SHA du candidat, l'identité des
 *     artefacts Tauri signés et les identifiants du déploiement Workers testé ;
 *   - le parcours distribué passe par l'interface, l'IPC Rust et les contrats
 *     publics, sans serveur Vite ni façade de test ;
 *   - macOS arm64, macOS x64, Linux x64 et Windows x64 vérifient signature,
 *     identité d'application, protocol handlers, stockage sécurisé et updater ;
 *   - les scénarios injectent coupures, révocations et pertes d'autorité puis
 *     prouvent le roll-forward et le RPO logique nul ;
 *   - le dossier échoue si une plateforme, une preuve d'accessibilité, un
 *     verdict golden, un diff de retrait ou un scan legacy manque ;
 *   - chaque verdict est relié à une preuve locale content-addressée dont le
 *     hash est recalculé ; une URL HTTPS peut être citée comme provenance mais
 *     n'est jamais téléchargée et ne remplace pas sa copie locale vérifiable ;
 *   - l'attestation n'est produite que lorsque `pnpm cloudflare:check` et le
 *     graphe de release autorisent le candidat (vérifié par le CLI
 *     scripts/check-promotion-dossier.mjs).
 *
 * Utilisé par scripts/check-promotion-dossier.mjs et ses tests.
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
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import {
  NOMS_REGISTRES_ATTESTATION,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
} from "./release-graph-lib.mjs";

export const VERIFICATIONS_ARTEFACT = [
  "signature",
  "identite-application",
  "protocol-handlers",
  "stockage-securise",
  "updater",
];

export const TYPES_FAUTE = ["coupure", "revocation", "perte-autorite"];

export const PREUVES_RECUPERATION = ["roll-forward", "rpo-logique-nul"];

export const SCANS_LEGACY = ["sources", "dependances", "artefact", "reseau"];

export const MATRICE_ACCESSIBILITE = [
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
];

export const VIA_DISTRIBUE = ["ui", "ipc-rust", "contrats-publics"];

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const TRANCHE_RE = /^tranche:([0-9]+)$/;

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

function resultatVert(valeur) {
  return valeur === "vert";
}

/**
 * Valide un dossier de preuve de promotion.
 *
 * `contexte` (facultatif) relie le dossier au dépôt réel :
 *   - ledgerRetraits : lignes retraits-par-tranche du registre des goldens ;
 *   - hashes : hashes vivants des registres (dérive refusée) ;
 *   - stagingIds : { compte, zone } du matériau de staging réel.
 *   - racinePreuves : répertoire contenant les copies locales
 *     content-addressées citées par `dossier.preuves`.
 *   - autorisation : { cloudflareCheck: "vert", graphe: "vert" } — sans
 *     autorisation explicite des deux gates, aucune attestation ne peut être
 *     construite (validateur de l'émission via construireAttestation).
 *
 * Retourne un tableau de messages d'erreur (vide = valide).
 */
export function validerDossier(dossier, contexte = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  const ledgerRetraits = Array.isArray(contexte.ledgerRetraits)
    ? contexte.ledgerRetraits
    : null;
  const hashes = contexte.hashes ?? null;
  const stagingIds = contexte.stagingIds ?? null;

  if (
    !dossier ||
    typeof dossier !== "object" ||
    !Number.isInteger(dossier.version)
  ) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (dossier.version !== 1) {
    push(`en-tête invalide : version non supportée ${dossier.version}`);
  }
  if (dossier["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (dossier["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }

  const candidat = dossier.candidat;
  if (
    !candidat ||
    typeof candidat.sha !== "string" ||
    !SHA1_RE.test(candidat.sha)
  ) {
    push("candidat : SHA exact (40 hexadécimaux) manquant");
  }
  if (!Number.isInteger(candidat?.tranche) || candidat?.tranche < 1) {
    push("candidat : tranche entière ≥ 1 attendue");
  }

  const { artefacts, staging, registres } = validerLiaison(
    dossier.liaison,
    stagingIds,
    push,
  );

  validerParcours(dossier.parcours, artefacts, staging, push);
  validerFautes(dossier.fautes, dossier.recuperation, push);
  validerAccessibilite(dossier.accessibilite, push);
  validerGoldens(dossier.goldens, candidat, ledgerRetraits, push);
  validerRetrait(dossier.retrait, candidat, ledgerRetraits, push);
  validerScans(dossier.scans, push);
  validerGates(dossier.gates, candidat, push);
  verifierRegistresCites(registres, hashes, push);
  validerPreuves(dossier, contexte, ledgerRetraits, push);

  return errors;
}

function ajouterPreuveAttendue(attendues, identifiant, sha256) {
  attendues.set(identifiant, sha256);
}

function preuvesAttendues(dossier, ledgerRetraits) {
  const attendues = new Map();
  const artefacts = Array.isArray(dossier.liaison?.artefacts)
    ? dossier.liaison.artefacts
    : [];
  for (const plateforme of PLATEFORMES) {
    const artefact = artefacts.find(
      (entree) => entree?.plateforme === plateforme,
    );
    ajouterPreuveAttendue(
      attendues,
      `artefact/${plateforme}/bundle`,
      artefact?.sha256,
    );
    ajouterPreuveAttendue(
      attendues,
      `artefact/${plateforme}/signature`,
      artefact?.signature,
    );
    for (const verification of VERIFICATIONS_ARTEFACT) {
      ajouterPreuveAttendue(
        attendues,
        `artefact/${plateforme}/verification/${verification}`,
      );
    }
  }

  ajouterPreuveAttendue(
    attendues,
    "staging/materiau",
    dossier.liaison?.staging?.["materiau-sha256"],
  );
  const recits = Array.isArray(dossier.parcours?.recits)
    ? dossier.parcours.recits.filter(
        (recit) => typeof recit === "string" && recit.trim() !== "",
      )
    : [];
  for (const plateforme of PLATEFORMES) {
    for (const recit of recits) {
      ajouterPreuveAttendue(attendues, `parcours/${plateforme}/${recit}`);
    }
  }
  for (const type of TYPES_FAUTE) {
    ajouterPreuveAttendue(attendues, `faute/${type}`);
  }
  for (const preuve of PREUVES_RECUPERATION) {
    ajouterPreuveAttendue(attendues, `recuperation/${preuve}`);
  }
  ajouterPreuveAttendue(
    attendues,
    "recuperation/captures",
    dossier.recuperation?.captures,
  );
  for (const plateforme of PLATEFORMES) {
    for (const critere of MATRICE_ACCESSIBILITE) {
      ajouterPreuveAttendue(
        attendues,
        `accessibilite/${plateforme}/${critere}`,
      );
    }
    ajouterPreuveAttendue(attendues, `accessibilite/${plateforme}/resultat`);
  }
  const testsGoldens =
    ledgerRetraits === null
      ? Array.isArray(dossier.goldens)
        ? dossier.goldens.map((golden) => golden?.test)
        : []
      : ledgerRetraits
          .filter(
            (ligne) =>
              ligne?.tranche === `tranche:${String(dossier.candidat?.tranche)}`,
          )
          .map((ligne) => ligne?.test);
  for (const test of testsGoldens.filter((nom) => typeof nom === "string")) {
    ajouterPreuveAttendue(attendues, `golden/${test}`);
  }
  ajouterPreuveAttendue(attendues, "retrait/diff", dossier.retrait?.diff);
  ajouterPreuveAttendue(attendues, "retrait/verdicts");
  for (const cible of SCANS_LEGACY) {
    ajouterPreuveAttendue(
      attendues,
      `scan/${cible}`,
      dossier.scans?.[cible]?.empreinte,
    );
  }
  for (const gate of PREUVES_OBLIGATOIRES) {
    ajouterPreuveAttendue(attendues, `gate/${gate}`);
  }
  return attendues;
}

function cheminEstDansRacine(racine, chemin) {
  const relatif = relative(racine, chemin);
  return relatif === "" || (!relatif.startsWith("..") && !isAbsolute(relatif));
}

function lirePreuveLocale(identifiant, preuve, racinePreuves, push) {
  if (!preuve || typeof preuve !== "object") {
    push(`preuves : preuve « ${identifiant} » manquante`);
    return null;
  }
  if (!estSha256(preuve.sha256)) {
    push(`preuves : preuve « ${identifiant} » sans sha256 valide`);
    return null;
  }
  if (!estCheminGitCanonique(preuve.chemin)) {
    push(
      `preuves : preuve « ${identifiant} » sans chemin local canonique — une copie locale content-addressée est exigée, même lorsqu'une URL est citée`,
    );
    return null;
  }
  if (preuve.url !== undefined) {
    try {
      const url = new URL(preuve.url);
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
        `preuves : preuve « ${identifiant} » avec URL invalide — HTTPS sans identifiants ni fragment exigé`,
      );
      return null;
    }
  }
  if (typeof racinePreuves !== "string" || racinePreuves.trim() === "") {
    push(
      `preuves : preuve « ${identifiant} » invérifiable — racine locale des preuves manquante`,
    );
    return null;
  }

  let racineReelle;
  let cheminReel;
  const cheminDeclare = resolve(racinePreuves, preuve.chemin);
  try {
    racineReelle = realpathSync(racinePreuves);
    const statutLien = lstatSync(cheminDeclare);
    if (statutLien.isSymbolicLink()) {
      push(`preuves : preuve « ${identifiant} » — lien symbolique interdit`);
      return null;
    }
    if (!statutLien.isFile()) {
      push(`preuves : preuve « ${identifiant} » — fichier régulier exigé`);
      return null;
    }
    cheminReel = realpathSync(cheminDeclare);
  } catch (erreur) {
    push(
      `preuves : preuve « ${identifiant} » illisible (${String(erreur?.code ?? "erreur")})`,
    );
    return null;
  }
  const cheminContentAdresse = resolve(racineReelle, preuve.chemin);
  if (
    !cheminEstDansRacine(racineReelle, cheminReel) ||
    cheminReel !== cheminContentAdresse
  ) {
    push(
      `preuves : preuve « ${identifiant} » sort de la racine ou traverse un lien symbolique`,
    );
    return null;
  }
  if (!basename(preuve.chemin).startsWith(preuve.sha256)) {
    push(
      `preuves : preuve « ${identifiant} » — chemin local non immuable : le nom doit être content-addressé par son sha256`,
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
      push(
        `preuves : preuve « ${identifiant} » modifiée pendant sa vérification`,
      );
      return null;
    }
    return createHash("sha256").update(contenu).digest("hex");
  } catch (erreur) {
    push(
      `preuves : preuve « ${identifiant} » impossible à relire sans suivre de lien (${String(erreur?.code ?? "erreur")})`,
    );
    return null;
  } finally {
    if (descripteur !== undefined) {
      closeSync(descripteur);
    }
  }
}

function validerPreuves(dossier, contexte, ledgerRetraits, push) {
  const preuves =
    dossier.preuves && typeof dossier.preuves === "object"
      ? dossier.preuves
      : {};
  const attendues = preuvesAttendues(dossier, ledgerRetraits);
  for (const [identifiant, shaAttendu] of attendues) {
    const preuve = preuves[identifiant];
    const shaRecalcule = lirePreuveLocale(
      identifiant,
      preuve,
      contexte.racinePreuves,
      push,
    );
    if (shaRecalcule === null || !preuve) {
      continue;
    }
    if (shaRecalcule !== preuve.sha256) {
      push(
        `preuves : preuve « ${identifiant} » — le hash recalculé ne correspond pas au sha256 déclaré`,
      );
    }
    if (
      preuve.subjectSha256 !== undefined &&
      !estSha256(preuve.subjectSha256)
    ) {
      push(
        `preuves : preuve « ${identifiant} » — subjectSha256 invalide`,
      );
    }
    const shaSujet = preuve.subjectSha256 ?? preuve.sha256;
    if (estSha256(shaAttendu) && shaSujet !== shaAttendu) {
      push(
        `preuves : preuve « ${identifiant} » divergente du hash sujet lié dans le dossier`,
      );
    }
  }
  for (const identifiant of Object.keys(preuves)) {
    if (!attendues.has(identifiant)) {
      push(`preuves : preuve inconnue « ${identifiant} » non consommée`);
    }
  }
}

function validerLiaison(liaison, stagingIds, push) {
  if (!liaison || typeof liaison !== "object") {
    push("liaison manquante — le dossier doit lier SHA, artefacts et staging");
    return { artefacts: [], staging: null, registres: [] };
  }
  if (liaison.canal !== "punks-desktop") {
    push("liaison : canal punks-desktop attendu");
  }
  const artefacts = Array.isArray(liaison.artefacts) ? liaison.artefacts : [];
  if (artefacts.length === 0) {
    push("liaison : aucun artefact Tauri signé relié");
  }
  const plateformesVues = new Map();
  for (const artefact of artefacts) {
    if (!artefact || !PLATEFORMES.includes(artefact.plateforme)) {
      push(
        `liaison : plateforme inconnue « ${String(artefact?.plateforme)} » (attendu ${PLATEFORMES.join(", ")})`,
      );
      continue;
    }
    if (plateformesVues.has(artefact.plateforme)) {
      push(`liaison : plateforme ${artefact.plateforme} reliée deux fois`);
    }
    plateformesVues.set(artefact.plateforme, artefact);
    if (typeof artefact.nom !== "string" || artefact.nom.trim() === "") {
      push(`liaison : artefact ${artefact.plateforme} sans nom`);
    }
    if (!estSha256(artefact.sha256)) {
      push(`liaison : artefact ${artefact.plateforme} sans sha256 valide`);
    }
    if (!estSha256(artefact.signature)) {
      push(`liaison : artefact ${artefact.plateforme} sans signature valide`);
    }
    const identite = artefact.identite;
    if (
      !identite ||
      typeof identite.bundleId !== "string" ||
      identite.bundleId.trim() === ""
    ) {
      push(
        `liaison : artefact ${artefact.plateforme} sans identité d'application (bundleId)`,
      );
    }
    const verifications = identite?.verifications ?? {};
    for (const verification of VERIFICATIONS_ARTEFACT) {
      if (!resultatVert(verifications[verification])) {
        push(
          `liaison : artefact ${artefact.plateforme} — vérification « ${verification} » manquante ou non verte`,
        );
      }
    }
  }
  for (const plateforme of PLATEFORMES) {
    if (!plateformesVues.has(plateforme)) {
      push(
        `liaison : artefact manquant pour ${plateforme} — la matrice de distribution est exigée`,
      );
    }
  }

  const staging = liaison.staging;
  if (!staging || typeof staging !== "object") {
    push("liaison : identifiants du déploiement Workers de staging manquants");
  } else {
    if (staging.environnement !== "staging") {
      push("liaison : staging.environnement doit être staging");
    }
    for (const cle of ["compte", "zone"]) {
      if (!/^[0-9a-f]{32}$/.test(staging[cle] ?? "")) {
        push(`liaison : staging.${cle} (identifiant hexadécimal) manquant`);
      }
    }
    if (
      typeof staging.deploiement !== "string" ||
      staging.deploiement.trim() === ""
    ) {
      push("liaison : identifiant de déploiement Workers exact manquant");
    }
    if (
      staging.materiau !== "cloudflare/staging.resources.json" ||
      !estSha256(staging["materiau-sha256"])
    ) {
      push("liaison : matériau de staging isolé manquant ou invalide");
    }
    if (
      stagingIds &&
      (staging.compte !== stagingIds.compte || staging.zone !== stagingIds.zone)
    ) {
      push(
        "liaison : identifiants de staging divergents du matériau réel du dépôt",
      );
    }
  }

  const registres = Array.isArray(liaison.registres) ? liaison.registres : [];
  const noms = new Set(registres.map((r) => r?.nom));
  for (const nom of NOMS_REGISTRES_ATTESTATION) {
    if (!noms.has(nom)) {
      push(`liaison : registre « ${nom} » non cité (version et hash exigés)`);
    }
  }

  return { artefacts, staging, registres };
}

function verifierRegistresCites(registres, hashes, push) {
  for (const registre of registres) {
    if (
      !registre ||
      !NOMS_REGISTRES_ATTESTATION.includes(registre.nom) ||
      !Number.isInteger(registre.version) ||
      registre.version < 1 ||
      !estSha256(registre.sha256)
    ) {
      push(
        `liaison : registre « ${String(registre?.nom)} » malformé (version entière et sha256 exigés)`,
      );
      continue;
    }
    if (
      hashes &&
      hashes[registre.nom] !== undefined &&
      registre.sha256 !== hashes[registre.nom]
    ) {
      push(
        `liaison : registre « ${registre.nom} » ne correspond pas au dépôt courant — le dossier doit citer les artefacts réellement testés`,
      );
    }
  }
}

function validerParcours(parcours, artefacts, staging, push) {
  if (!parcours || typeof parcours !== "object") {
    push(
      "parcours manquant — le parcours distribué est la couture d'acceptation",
    );
    return;
  }
  if (parcours.contour !== "distribue") {
    push(
      "parcours : contour distribué exigé — l'artefact signé est testé, pas un serveur de développement",
    );
  }
  if (parcours.serveurVite !== false) {
    push(
      "parcours : aucun serveur Vite n'est admissible dans le parcours distribué",
    );
  }
  if (parcours.facadeTest !== false) {
    push(
      "parcours : aucune façade de test n'est admissible dans le parcours distribué",
    );
  }
  const recits = parcours.recits;
  if (
    !Array.isArray(recits) ||
    recits.length === 0 ||
    recits.some((r) => typeof r !== "string" || r.trim() === "")
  ) {
    push("parcours : les récits de la tranche doivent être cités");
    return;
  }
  const executions = Array.isArray(parcours.executions)
    ? parcours.executions
    : [];
  if (executions.length === 0) {
    push("parcours : aucune exécution enregistrée");
  }
  const artefactsParPlateforme = new Map(
    artefacts
      .filter((a) => a && typeof a === "object" && a.sha256)
      .map((a) => [a.plateforme, a.sha256]),
  );
  const deploiement = staging?.deploiement;
  const attendus = new Set(
    PLATEFORMES.flatMap((plateforme) =>
      recits.map((recit) => `${plateforme}::${recit}`),
    ),
  );
  const vus = new Set();
  for (const execution of executions) {
    if (!execution || typeof execution !== "object") {
      push("parcours : exécution malformée");
      continue;
    }
    if (!PLATEFORMES.includes(execution.plateforme)) {
      push(
        `parcours : exécution sur plateforme inconnue « ${String(execution.plateforme)} »`,
      );
      continue;
    }
    if (!recits.includes(execution.recit)) {
      push(`parcours : récit inconnu « ${String(execution.recit)} »`);
      continue;
    }
    const cle = `${execution.plateforme}::${execution.recit}`;
    if (vus.has(cle)) {
      push(`parcours : ${cle} exécuté deux fois`);
    }
    vus.add(cle);
    const shaAttendu = artefactsParPlateforme.get(execution.plateforme);
    if (
      !estSha256(execution.sha256Artefact) ||
      (shaAttendu !== undefined && execution.sha256Artefact !== shaAttendu)
    ) {
      push(
        `parcours : ${cle} n'est pas rattaché au sha256 de l'artefact ${execution.plateforme} — la liaison artefact/parcours doit être sans ambiguïté`,
      );
    }
    if (deploiement !== undefined && execution.deploiement !== deploiement) {
      push(
        `parcours : ${cle} ne cite pas le déploiement Workers exact (${String(deploiement)})`,
      );
    }
    if (!resultatVert(execution.resultat)) {
      push(
        `parcours : ${cle} non vert (résultat ${String(execution.resultat)})`,
      );
    }
    const via = Array.isArray(execution.via) ? execution.via : [];
    if (!VIA_DISTRIBUE.every((couche) => via.includes(couche))) {
      push(
        `parcours : ${cle} doit passer par ${VIA_DISTRIBUE.join(" + ")} — interface, IPC Rust et contrats publics`,
      );
    }
  }
  for (const attendu of attendus) {
    if (!vus.has(attendu)) {
      push(
        `parcours : exécution manquante pour ${attendu} — chaque récit s'exécute sur chaque plateforme`,
      );
    }
  }
}

function validerFautes(fautes, recuperation, push) {
  const scenarios = Array.isArray(fautes) ? fautes : [];
  if (scenarios.length === 0) {
    push("fautes : les scénarios de faute injectée sont exigés");
  }
  const typesVus = new Set();
  for (const scenario of scenarios) {
    if (!scenario || !TYPES_FAUTE.includes(scenario.type)) {
      push(
        `fautes : type inconnu « ${String(scenario?.type)} » (attendu ${TYPES_FAUTE.join(", ")})`,
      );
      continue;
    }
    typesVus.add(scenario.type);
    if (
      typeof scenario.autorite !== "string" ||
      scenario.autorite.trim() === ""
    ) {
      push(`fautes : scénario ${scenario.type} sans autorité citée`);
    }
    if (!PLATEFORMES.includes(scenario.plateforme)) {
      push(`fautes : scénario ${scenario.type} sur plateforme inconnue`);
    }
    if (!resultatVert(scenario.resultat)) {
      push(`fautes : scénario ${scenario.type} non vert`);
    }
  }
  for (const type of TYPES_FAUTE) {
    if (!typesVus.has(type)) {
      push(`fautes : aucun scénario de type « ${type} » injecté`);
    }
  }
  if (!recuperation || typeof recuperation !== "object") {
    push("recuperation : preuves de récupération manquantes");
    return;
  }
  for (const preuve of PREUVES_RECUPERATION) {
    if (!resultatVert(recuperation[preuve])) {
      push(
        `recuperation : « ${preuve} » doit être prouvé vert par les scénarios`,
      );
    }
  }
  if (!estSha256(recuperation.captures)) {
    push("recuperation : empreinte des captures de faute manquante");
  }
}

function validerAccessibilite(accessibilite, push) {
  const entrees = Array.isArray(accessibilite) ? accessibilite : [];
  const plateformesVues = new Set();
  for (const entree of entrees) {
    if (!entree || !PLATEFORMES.includes(entree.plateforme)) {
      push(
        `accessibilite : plateforme inconnue « ${String(entree?.plateforme)} »`,
      );
      continue;
    }
    plateformesVues.add(entree.plateforme);
    const matrice = entree.matrice ?? {};
    for (const critere of MATRICE_ACCESSIBILITE) {
      if (!resultatVert(matrice[critere])) {
        push(
          `accessibilite : ${entree.plateforme} — critère « ${critere} » manquant ou non vert`,
        );
      }
    }
    if (!resultatVert(entree.resultat)) {
      push(`accessibilite : ${entree.plateforme} non vert`);
    }
  }
  for (const plateforme of PLATEFORMES) {
    if (!plateformesVues.has(plateforme)) {
      push(
        `accessibilite : preuve manquante pour ${plateforme} — le dossier échoue sans matrice complète`,
      );
    }
  }
}

function validerGoldens(goldens, candidat, ledgerRetraits, push) {
  const verdicts = Array.isArray(goldens) ? goldens : [];
  const lignesAttendues =
    ledgerRetraits === null
      ? null
      : ledgerRetraits
          .filter(
            (ligne) =>
              typeof ligne?.test === "string" &&
              ligne?.tranche === `tranche:${candidat?.tranche}`,
          )
          .map((ligne) => ({ test: ligne.test, verdict: ligne.verdict }));
  if (lignesAttendues !== null && lignesAttendues.length === 0) {
    push(
      `goldens : le registre n'enregistre aucun retrait pour tranche:${String(candidat?.tranche)} — le retrait doit précéder la promotion`,
    );
    return;
  }
  if (lignesAttendues !== null) {
    const recues = new Map(verdicts.map((v) => [v?.test, v?.verdict]));
    for (const attendue of lignesAttendues) {
      if (recues.get(attendue.test) !== attendue.verdict) {
        push(
          `goldens : verdict manquant ou divergent pour « ${attendue.test} » (attendu ${attendue.verdict})`,
        );
      }
    }
    for (const recue of verdicts) {
      if (!lignesAttendues.some((l) => l.test === recue?.test)) {
        push(
          `goldens : verdict inconnu « ${String(recue?.test)} » hors registre`,
        );
      }
    }
  } else if (verdicts.length === 0) {
    push("goldens : les verdicts golden de la tranche sont exigés");
  }
}

function validerRetrait(retrait, candidat, ledgerRetraits, push) {
  if (!retrait || typeof retrait !== "object") {
    push("retrait : le diff de retrait associé au candidat est exigé");
    return;
  }
  if (!estSha256(retrait.diff)) {
    push("retrait : empreinte du diff d'inventaire de retrait manquante");
  }
  if (
    !Number.isInteger(retrait["verdicts-executes"]) ||
    retrait["verdicts-executes"] < 1
  ) {
    push(
      "retrait : au moins un verdict du manifeste doit être exécuté par le candidat",
    );
  }
  if (
    !Array.isArray(retrait.lignes) ||
    retrait.lignes.some((l) => !estCheminGitCanonique(l))
  ) {
    push(
      "retrait : lignes du registre des goldens retirées par ce candidat exigées",
    );
  }
  if (ledgerRetraits !== null) {
    const attendues = ledgerRetraits
      .filter(
        (ligne) =>
          typeof ligne?.test === "string" &&
          ligne?.tranche === `tranche:${candidat?.tranche}`,
      )
      .map((ligne) => ligne.test);
    const recues = Array.isArray(retrait.lignes) ? retrait.lignes : [];
    const manquantes = attendues.filter((l) => !recues.includes(l));
    const inconnues = recues.filter((l) => !attendues.includes(l));
    if (manquantes.length > 0 || inconnues.length > 0) {
      push(
        `retrait : lignes divergentes du registre des goldens (${manquantes.length} omises, ${inconnues.length} inconnues)`,
      );
    }
  }
}

function validerScans(scans, push) {
  if (!scans || typeof scans !== "object") {
    push(
      "scans : le scan legacy (sources, dépendances, artefact, réseau) est exigé",
    );
    return;
  }
  for (const cible of SCANS_LEGACY) {
    const scan = scans[cible];
    if (!scan || !resultatVert(scan.resultat) || !estSha256(scan.empreinte)) {
      push(
        `scans : « ${cible} » doit être vert avec empreinte — le dossier échoue sans scan legacy complet`,
      );
    }
  }
}

function validerGates(gates, candidat, push) {
  if (!gates || typeof gates !== "object") {
    push("gates : résultats des gates manquants");
    return;
  }
  for (const cle of Object.keys(gates)) {
    if (!PREUVES_OBLIGATOIRES.includes(cle)) {
      push(
        `gates : gate inconnue « ${cle} » (vocabulaire fermé du graphe de release)`,
      );
    }
  }
  for (const preuve of PREUVES_OBLIGATOIRES) {
    const gate = gates[preuve];
    if (!gate || !resultatVert(gate.resultat) || gate.sha !== candidat?.sha) {
      push(
        `gates : « ${preuve} » doit être verte et liée au SHA exact du candidat — l'attestation scellée exige les ${PREUVES_OBLIGATOIRES.length} preuves obligatoires`,
      );
    }
  }
}

/**
 * Construit l'attestation immuable au format du graphe de release (issue #51)
 * à partir d'un dossier complet. Retourne { attestation, recu } ou
 * { erreur } — aucune attestation n'est produite si le dossier est invalide ou
 * si `pnpm cloudflare:check` et le graphe de release n'autorisent pas le
 * candidat (résultats des gates exigés dans le dossier).
 */
export function construireAttestation(dossier, contexte = {}) {
  const errors = validerDossier(dossier, contexte);
  if (errors.length > 0) {
    return { erreur: `dossier invalide (${errors.length}) : ${errors[0]}` };
  }
  const autorisation = contexte.autorisation ?? {};
  if (autorisation.cloudflareCheck !== "vert") {
    return {
      erreur:
        "attestation refusée : pnpm cloudflare:check doit réellement terminer vert sur le candidat",
    };
  }
  if (autorisation.graphe !== "vert") {
    return {
      erreur:
        "attestation refusée : le graphe de release doit autoriser le candidat (gate vert, tranche présente, candidat non déjà scellé)",
    };
  }
  const liaison = dossier.liaison;
  const attestation = {
    sha: dossier.candidat.sha,
    dossier: { sha256: canonicalSha256(dossier) },
    "checkpoint-baseline": dossier["baseline-buzz"],
    registres: liaison.registres.map((r) => ({
      nom: r.nom,
      version: r.version,
      sha256: r.sha256,
    })),
    staging: {
      environnement: liaison.staging.environnement,
      compte: liaison.staging.compte,
      zone: liaison.staging.zone,
      deploiement: liaison.staging.deploiement,
    },
    gates: PREUVES_OBLIGATOIRES.map((preuve) => ({
      gate: preuve,
      resultat: dossier.gates[preuve].resultat,
      sha: dossier.candidat.sha,
    })),
    artefacts: liaison.artefacts.map((a) => ({
      plateforme: a.plateforme,
      sha256: a.sha256,
    })),
  };
  const recu = {
    id: `recu-promotion-${dossier.candidat.tranche}-${dossier.candidat.sha.slice(0, 12)}`,
    sha256: canonicalSha256(attestation),
  };
  return { attestation, recu };
}

/** Un candidat est-il déjà scellé dans le graphe de release ? */
export function candidatDejaScelle(graph, tranche) {
  const releases = Array.isArray(graph?.releases) ? graph.releases : [];
  const release = releases.find((r) => r?.tranche === tranche);
  return release !== undefined && release.etat !== "preparation";
}

/** La tranche du candidat existe-elle dans le graphe ? */
export function tranchePresente(graph, tranche) {
  const releases = Array.isArray(graph?.releases) ? graph.releases : [];
  return releases.some(
    (r) => r?.tranche === tranche && TRANCHE_RE.test(String(r?.id ?? "")),
  );
}
