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
 *     artefacts Tauri signés, leur transcript d'exécution installé, les digests
 *     du bundle et du manifeste production, et les identifiants du déploiement
 *     Workers testé ;
 *   - le parcours distribué passe par l'interface, l'IPC Rust et les contrats
 *     publics, sans serveur Vite ni façade de test ;
 *   - macOS arm64, macOS x64, Linux x64 et Windows x64 vérifient signature,
 *     identité d'application, protocol handlers, stockage sécurisé et updater ;
 *   - les scénarios injectent coupures, révocations et pertes de chaque
 *     autorité, puis prouvent le roll-forward, le RPO logique nul, la
 *     non-restauration des sessions et la résistance du reçu au PITR ;
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
import {
  BASELINE_PUNKS,
  CHECKPOINT_RECUPERATION,
} from "./migration-manifest-lib.mjs";
import { construireEmissionAttestation } from "./promotion-attestation-lib.mjs";
import {
  IDENTITE_APPLICATION_PUNKS,
  VERIFICATIONS_ARTEFACT,
} from "./promotion-installed-transcript-lib.mjs";
import {
  lirePreuveLocale,
  lireSujetLocal,
  validerProvenanceDossier,
  validerProjectionPreuve,
  validerSujetPreuve,
} from "./promotion-proof-lib.mjs";
import {
  validateDeployedWorkerDescriptors,
  validatePromotionProfileDescriptor,
} from "./promotion-materials-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
  validerAccessibilite,
  validerFautes,
} from "./promotion-resilience-lib.mjs";
import {
  NOMS_REGISTRES_ATTESTATION,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
} from "./release-graph-lib.mjs";

export { IDENTITE_APPLICATION_PUNKS, VERIFICATIONS_ARTEFACT };

export const SCANS_LEGACY = ["sources", "dependances", "artefact", "reseau"];

export {
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "./promotion-resilience-lib.mjs";

export const VIA_DISTRIBUE = ["ui", "ipc-rust", "contrats-publics"];

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const DEPLOIEMENT_RE = /^sha256:[0-9a-f]{64}$/;
const TRANCHE_RE = /^tranche:([0-9]+)$/;
const PREUVE_SCHEMA = "punks.promotion-proof.v1";

function estSha256(valeur) {
  return typeof valeur === "string" && SHA256_RE.test(valeur);
}

function clesObjetExactes(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
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

function estCoordonnee(valeur) {
  return (
    typeof valeur === "string" &&
    valeur !== "" &&
    valeur === valeur.trim() &&
    !valeur.includes("/") &&
    !valeur.includes("\\")
  );
}

/**
 * Valide un dossier de preuve de promotion.
 *
 * `contexte` (facultatif) relie le dossier au dépôt réel :
 *   - ledgerRetraits : lignes retraits-par-tranche du registre des goldens ;
 *   - hashes : hashes vivants des registres (dérive refusée) ;
 *   - registresAttendus : versions et hashes exacts du candidat dans le
 *     graphe de release ;
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
  const registresAttendus = contexte.registresAttendus ?? null;
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
  if (dossier["baseline-punks"] !== BASELINE_PUNKS) {
    push("en-tête invalide : baseline Punks invalide");
  }

  const candidat = dossier.candidat;
  if (
    !candidat ||
    typeof candidat.sha !== "string" ||
    !SHA1_RE.test(candidat.sha)
  ) {
    push("candidat : SHA exact (40 hexadécimaux) manquant");
  } else if (
    candidat.sha === BASELINE_PUNKS ||
    candidat.sha === CHECKPOINT_RECUPERATION
  ) {
    push(
      "candidat : un SHA Punks doit être distinct des checkpoints Punks interdits",
    );
  }
  if (!Number.isInteger(candidat?.tranche) || candidat?.tranche < 1) {
    push("candidat : tranche entière ≥ 1 attendue");
  }
  try {
    validatePromotionProfileDescriptor(dossier.profil, {
      expectedSha256: contexte.promotionProfileSha256,
    });
  } catch (erreur) {
    push(
      `profil : matériau de promotion fermé invalide (${erreur instanceof Error ? erreur.message : String(erreur)})`,
    );
  }

  const { artefacts, staging, registres } = validerLiaison(
    dossier.liaison,
    stagingIds,
    hashes?.staging,
    push,
  );

  validerParcours(dossier.parcours, artefacts, staging, push);
  validerFautes(dossier.fautes, dossier.recuperation, staging?.autorites, push);
  validerAccessibilite(dossier.accessibilite, push);
  validerGoldens(dossier.goldens, candidat, ledgerRetraits, push);
  validerRetrait(dossier.retrait, candidat, ledgerRetraits, push);
  validerScans(dossier.scans, push);
  validerGates(dossier.gates, candidat, push);
  verifierRegistresCites(registres, hashes, registresAttendus, push);
  validerPreuves(dossier, contexte, ledgerRetraits, push);
  validerProvenanceDossier(dossier, contexte, push);

  return errors;
}

function ajouterPreuveAttendue(attendues, identifiant, sha256) {
  attendues.set(identifiant, sha256);
}

function preuvesAttendues(dossier, ledgerRetraits) {
  const attendues = new Map();
  ajouterPreuveAttendue(attendues, "candidat");
  ajouterPreuveAttendue(
    attendues,
    "profil/promotion",
    dossier.profil?.["materiau-sha256"],
  );
  ajouterPreuveAttendue(attendues, "registres");
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
    ajouterPreuveAttendue(
      attendues,
      `scan/artefact/${plateforme}`,
      artefact?.scanSha256,
    );
    ajouterPreuveAttendue(
      attendues,
      `transcript/${plateforme}`,
      artefact?.transcriptSha256,
    );
    ajouterPreuveAttendue(attendues, `brut/${plateforme}`);
    ajouterPreuveAttendue(
      attendues,
      `staging/reobservation/${plateforme}`,
      dossier.liaison?.staging?.["deploiement-preuve-sha256"],
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
  ajouterPreuveAttendue(
    attendues,
    "staging/deploiement",
    dossier.liaison?.staging?.["deploiement-preuve-sha256"],
  );
  for (const nom of ["bundle", "manifeste"]) {
    ajouterPreuveAttendue(
      attendues,
      `production/${nom}`,
      dossier.liaison?.["digests-production"]?.[nom],
    );
  }
  const digestsPromotion = dossier.liaison?.["digests-preuves-promotion"];
  ajouterPreuveAttendue(
    attendues,
    "production/evidence/platform-index",
    digestsPromotion?.platformIndex,
  );
  ajouterPreuveAttendue(
    attendues,
    "production/evidence/recovery-index",
    digestsPromotion?.recoveryIndex,
  );
  for (const plateforme of PLATEFORMES) {
    ajouterPreuveAttendue(
      attendues,
      `production/evidence/network/${plateforme}`,
      digestsPromotion?.network?.[plateforme],
    );
  }
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
  const autorites = Array.isArray(dossier.liaison?.staging?.autorites)
    ? dossier.liaison.staging.autorites
    : [];
  for (const type of TYPES_FAUTE) {
    for (const autorite of autorites) {
      const faute = dossier.fautes?.find(
        (scenario) =>
          scenario?.type === type && scenario?.autorite === autorite,
      );
      ajouterPreuveAttendue(
        attendues,
        `faute/${type}/${autorite}`,
        faute?.captureSha256,
      );
      for (const preuve of PREUVES_RECUPERATION) {
        const recuperation = dossier.recuperation?.scenarios?.find(
          (scenario) =>
            scenario?.type === type && scenario?.autorite === autorite,
        );
        ajouterPreuveAttendue(
          attendues,
          `recuperation/${preuve}/${type}/${autorite}`,
          recuperation?.preuves?.[preuve]?.subjectSha256,
        );
      }
    }
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

function validerPreuves(dossier, contexte, ledgerRetraits, push) {
  const preuves =
    dossier.preuves && typeof dossier.preuves === "object"
      ? dossier.preuves
      : {};
  const attendues = preuvesAttendues(dossier, ledgerRetraits);
  for (const [identifiant, shaAttendu] of attendues) {
    const preuve = preuves[identifiant];
    const preuveLocale = lirePreuveLocale(
      identifiant,
      preuve,
      contexte.racinePreuves,
      push,
    );
    if (preuveLocale === null || !preuve) {
      continue;
    }
    const sujetLocal = lireSujetLocal(
      identifiant,
      preuve.sujet,
      contexte.racinePreuves,
      push,
    );
    if (preuveLocale.sha256 !== preuve.sha256) {
      push(
        `preuves : preuve « ${identifiant} » — le hash recalculé ne correspond pas au sha256 déclaré`,
      );
    }
    const document = preuveLocale.document;
    const clesReference = Object.keys(preuve).sort();
    if (
      clesReference.some(
        (cle) =>
          !["chemin", "sha256", "subjectSha256", "sujet", "url"].includes(cle),
      )
    ) {
      push(
        `preuves : preuve « ${identifiant} » — référence à schéma fermé exigée`,
      );
    }
    if (
      !document ||
      typeof document !== "object" ||
      Array.isArray(document) ||
      document.schema !== PREUVE_SCHEMA ||
      document.id !== identifiant
    ) {
      push(
        `preuves : preuve « ${identifiant} » — enveloppe ${PREUVE_SCHEMA} liée à son identifiant exigée`,
      );
    } else if (
      Object.keys(document).some(
        (cle) =>
          ![
            "candidateSha",
            "data",
            "id",
            "plateforme",
            "result",
            "schema",
            "stagingDeploymentId",
          ].includes(cle),
      )
    ) {
      push(
        `preuves : preuve « ${identifiant} » — enveloppe à schéma fermé exigée`,
      );
    } else if (document.candidateSha !== dossier.candidat?.sha) {
      push(`preuves : preuve « ${identifiant} » liée à un autre SHA candidat`);
    } else if (
      document.stagingDeploymentId !== dossier.liaison?.staging?.deploiement
    ) {
      push(
        `preuves : preuve « ${identifiant} » liée à un autre déploiement staging`,
      );
    } else if (
      document.result !== "vert" ||
      !document.data ||
      typeof document.data !== "object" ||
      Array.isArray(document.data)
    ) {
      push(
        `preuves : preuve « ${identifiant} » — résultat vert et données observées exigés`,
      );
    } else {
      if (
        preuve.subjectSha256 !== undefined &&
        document.data.subjectSha256 !== preuve.subjectSha256
      ) {
        push(
          `preuves : preuve « ${identifiant} » — sujet content-addressé divergent de son contenu`,
        );
      }
      if (
        sujetLocal === null ||
        sujetLocal.sha256 !== preuve.sujet?.sha256 ||
        sujetLocal.sha256 !== preuve.subjectSha256
      ) {
        push(
          `preuves : preuve « ${identifiant} » — octets du sujet brut divergents`,
        );
      } else {
        validerSujetPreuve(identifiant, sujetLocal, document, dossier, push);
      }
      validerProjectionPreuve(identifiant, document, dossier, push);
    }
    if (
      preuve.subjectSha256 !== undefined &&
      !estSha256(preuve.subjectSha256)
    ) {
      push(`preuves : preuve « ${identifiant} » — subjectSha256 invalide`);
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

function validerLiaison(liaison, stagingIds, stagingMateriauSha256, push) {
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
    if (
      typeof artefact.signatureNom !== "string" ||
      artefact.signatureNom.trim() === ""
    ) {
      push(`liaison : artefact ${artefact.plateforme} sans nom de signature`);
    }
    if (!estSha256(artefact.sha256)) {
      push(`liaison : artefact ${artefact.plateforme} sans sha256 valide`);
    }
    if (!estSha256(artefact.signature)) {
      push(`liaison : artefact ${artefact.plateforme} sans signature valide`);
    }
    if (!Number.isInteger(artefact.taille) || artefact.taille < 1) {
      push(`liaison : artefact ${artefact.plateforme} sans taille exacte`);
    }
    if (
      !Number.isInteger(artefact.signatureTaille) ||
      artefact.signatureTaille < 1
    ) {
      push(
        `liaison : artefact ${artefact.plateforme} sans taille de signature exacte`,
      );
    }
    if (!estSha256(artefact.transcriptSha256)) {
      push(
        `liaison : artefact ${artefact.plateforme} sans transcript installé content-addressé`,
      );
    }
    if (!estSha256(artefact.scanSha256)) {
      push(
        `liaison : artefact ${artefact.plateforme} sans scan installé content-addressé`,
      );
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
    } else if (identite.bundleId !== IDENTITE_APPLICATION_PUNKS) {
      push(
        `liaison : artefact ${artefact.plateforme} — identité d'application Punks staging exacte « ${IDENTITE_APPLICATION_PUNKS} » exigée`,
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
    if (staging.deploiement === "") {
      push("liaison : identifiant de déploiement Workers exact manquant");
    } else if (!DEPLOIEMENT_RE.test(staging.deploiement ?? "")) {
      push(
        "liaison : identifiant de déploiement Workers exact sha256 manquant ou invalide",
      );
    }
    if (!estSha256(staging["deploiement-preuve-sha256"])) {
      push(
        "liaison : preuve distante content-addressée du déploiement Workers manquante",
      );
    }
    try {
      validateDeployedWorkerDescriptors(staging.workers);
    } catch (erreur) {
      push(
        `liaison : versions des Workers staging invalides (${erreur instanceof Error ? erreur.message : String(erreur)})`,
      );
    }
    if (
      staging.materiau !== "cloudflare/staging.resources.json" ||
      !estSha256(staging["materiau-sha256"])
    ) {
      push("liaison : matériau de staging isolé manquant ou invalide");
    } else if (
      stagingMateriauSha256 !== undefined &&
      staging["materiau-sha256"] !== stagingMateriauSha256
    ) {
      push("liaison : matériau de staging divergent du dépôt courant");
    }
    if (
      stagingIds &&
      (staging.compte !== stagingIds.compte || staging.zone !== stagingIds.zone)
    ) {
      push(
        "liaison : identifiants de staging divergents du matériau réel du dépôt",
      );
    }
    const autorites = staging.autorites;
    if (!Array.isArray(autorites) || autorites.length === 0) {
      push("liaison : liste des autorités staging manquante");
    } else {
      const vues = new Set();
      for (const autorite of autorites) {
        if (!estCoordonnee(autorite)) {
          push(`liaison : autorité staging invalide « ${String(autorite)} »`);
          continue;
        }
        if (vues.has(autorite)) {
          push(`liaison : autorité staging « ${autorite} » citée deux fois`);
        }
        vues.add(autorite);
      }
    }
  }

  const digestsProduction = liaison["digests-production"];
  if (!digestsProduction || typeof digestsProduction !== "object") {
    push("liaison : digests du bundle et du manifeste production manquants");
  } else {
    for (const nom of ["bundle", "manifeste"]) {
      if (!estSha256(digestsProduction[nom])) {
        push(`liaison : digest production « ${nom} » invalide`);
      }
    }
  }

  const digestsPromotion = liaison["digests-preuves-promotion"];
  if (
    !clesObjetExactes(digestsPromotion, [
      "platformIndex",
      "recoveryIndex",
      "network",
    ]) ||
    !clesObjetExactes(digestsPromotion?.network, PLATEFORMES)
  ) {
    push("liaison : digests des preuves de promotion manquants ou élargis");
  } else {
    for (const [nom, digest] of [
      ["platformIndex", digestsPromotion.platformIndex],
      ["recoveryIndex", digestsPromotion.recoveryIndex],
      ...PLATEFORMES.map((plateforme) => [
        `network/${plateforme}`,
        digestsPromotion.network[plateforme],
      ]),
    ]) {
      if (!estSha256(digest)) {
        push(`liaison : digest de preuve promotion « ${nom} » invalide`);
      }
    }
  }

  const registres = Array.isArray(liaison.registres) ? liaison.registres : [];
  const occurrences = new Map();
  for (const registre of registres) {
    const nom = registre?.nom;
    occurrences.set(nom, (occurrences.get(nom) ?? 0) + 1);
  }
  for (const nom of NOMS_REGISTRES_ATTESTATION) {
    const nombre = occurrences.get(nom) ?? 0;
    if (nombre === 0) {
      push(`liaison : registre « ${nom} » non cité (version et hash exigés)`);
    } else if (nombre > 1) {
      push(`liaison : registre « ${nom} » cité deux fois`);
    }
  }

  return { artefacts, staging, registres };
}

function verifierRegistresCites(registres, hashes, registresAttendus, push) {
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
    const attendu = registresAttendus?.[registre.nom];
    if (attendu && registre.version !== attendu.version) {
      push(
        `liaison : registre « ${registre.nom} » — version divergente du graphe de release`,
      );
    }
    if (attendu && registre.sha256 !== attendu.sha256) {
      push(
        `liaison : registre « ${registre.nom} » — hash divergent du graphe de release`,
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
  const recitsVus = new Set();
  for (const recit of recits) {
    if (recitsVus.has(recit)) {
      push(`parcours : récit « ${recit} » cité deux fois`);
    }
    recitsVus.add(recit);
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
    if (
      via.length !== VIA_DISTRIBUE.length ||
      new Set(via).size !== VIA_DISTRIBUE.length ||
      !VIA_DISTRIBUE.every((couche) => via.includes(couche))
    ) {
      push(
        `parcours : ${cle} doit citer les couches exactes ${VIA_DISTRIBUE.join(" + ")} — interface, IPC Rust et contrats publics (UI), sans chemin parallèle`,
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

function validerGoldens(goldens, candidat, ledgerRetraits, push) {
  const verdicts = Array.isArray(goldens) ? goldens : [];
  const testsVus = new Set();
  for (const verdict of verdicts) {
    if (testsVus.has(verdict?.test)) {
      push(`goldens : verdict « ${String(verdict?.test)} » cité deux fois`);
    }
    testsVus.add(verdict?.test);
  }
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
  } else if (new Set(retrait.lignes).size !== retrait.lignes.length) {
    push("retrait : ligne du registre des goldens citée deux fois");
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
  return construireEmissionAttestation(dossier);
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
