/**
 * Matrices de résilience exigées par le dossier de promotion Punks.
 *
 * Ce module garde ensemble les coordonnées de fautes, les reçus de
 * récupération et les observations d'accessibilité distribuées.
 */
import { PLATEFORMES } from "./release-graph-lib.mjs";

/** Types de faute injectée exigés pour chaque autorité staging. */
export const TYPES_FAUTE = ["coupure", "revocation", "perte-autorite"];

/** Reçus de récupération obligatoires après injection des fautes. */
export const PREUVES_RECUPERATION = [
  "roll-forward",
  "rpo-logique-nul",
  "session-non-restauree",
  "recu-resistant-pitr",
];

/** Critères d'accessibilité exigés sur chaque plateforme distribuée. */
export const MATRICE_ACCESSIBILITE = [
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
];

/** Méthodes complémentaires exigées pour chaque observation d'accessibilité. */
export const METHODES_ACCESSIBILITE = Object.freeze([
  "automatique",
  "manuelle",
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const LECTEUR_ECRAN_PAR_PLATEFORME = {
  "macos-arm64": "VoiceOver",
  "macos-x64": "VoiceOver",
  "windows-x64": "NVDA",
};

function resultatVert(valeur) {
  return valeur === "vert";
}

function estSha256(valeur) {
  return typeof valeur === "string" && SHA256_RE.test(valeur);
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

function methodesAccessibiliteExactes(methodes) {
  return (
    Array.isArray(methodes) &&
    methodes.length === METHODES_ACCESSIBILITE.length &&
    new Set(methodes).size === METHODES_ACCESSIBILITE.length &&
    METHODES_ACCESSIBILITE.every((methode) => methodes.includes(methode))
  );
}

/**
 * Valide le produit exact types de faute × autorités et ses reçus de reprise.
 */
export function validerFautes(fautes, recuperation, autorites, push) {
  const scenarios = Array.isArray(fautes) ? fautes : [];
  if (scenarios.length === 0) {
    push("fautes : les scénarios de faute injectée sont exigés");
  }
  const autoritesAttendues = Array.isArray(autorites)
    ? autorites.filter(estCoordonnee)
    : [];
  const typesVus = new Set();
  const coordonneesVues = new Set();
  const fautesParCoordonnee = new Map();
  for (const scenario of scenarios) {
    if (!scenario || !TYPES_FAUTE.includes(scenario.type)) {
      push(
        `fautes : type inconnu « ${String(scenario?.type)} » (attendu ${TYPES_FAUTE.join(", ")})`,
      );
      continue;
    }
    typesVus.add(scenario.type);
    if (!estCoordonnee(scenario.autorite)) {
      push(`fautes : scénario ${scenario.type} sans autorité citée`);
      continue;
    }
    if (!autoritesAttendues.includes(scenario.autorite)) {
      push(
        `fautes : scénario ${scenario.type}/${scenario.autorite} hors des autorités staging`,
      );
    }
    const coordonnee = `${scenario.type}/${scenario.autorite}`;
    if (coordonneesVues.has(coordonnee)) {
      push(`fautes : scénario ${coordonnee} cité deux fois`);
    }
    coordonneesVues.add(coordonnee);
    if (!PLATEFORMES.includes(scenario.plateforme)) {
      push(`fautes : scénario ${scenario.type} sur plateforme inconnue`);
    }
    if (!resultatVert(scenario.resultat)) {
      push(`fautes : scénario ${scenario.type} non vert`);
    }
    if (
      typeof scenario.executionId !== "string" ||
      scenario.executionId.trim() === ""
    ) {
      push(`fautes : scénario ${coordonnee} sans identifiant d'exécution`);
    }
    for (const [champ, valeur] of [
      ["artefact", scenario.sha256Artefact],
      ["transcript", scenario.transcriptSha256],
      ["capture", scenario.captureSha256],
      ["preuve", scenario.preuveSha256],
    ]) {
      if (!estSha256(valeur)) {
        push(`fautes : scénario ${coordonnee} sans hash ${champ} exact`);
      }
    }
    fautesParCoordonnee.set(coordonnee, scenario);
  }
  for (const type of TYPES_FAUTE) {
    if (!typesVus.has(type)) {
      push(`fautes : aucun scénario de type « ${type} » injecté`);
    }
    for (const autorite of autoritesAttendues) {
      const coordonnee = `${type}/${autorite}`;
      if (!coordonneesVues.has(coordonnee)) {
        push(`fautes : scénario manquant pour ${coordonnee}`);
      }
    }
  }
  if (!recuperation || typeof recuperation !== "object") {
    push("recuperation : preuves de récupération manquantes");
    return;
  }
  const reprises = Array.isArray(recuperation.scenarios)
    ? recuperation.scenarios
    : [];
  const reprisesVues = new Set();
  for (const reprise of reprises) {
    const coordonnee = `${String(reprise?.type)}/${String(reprise?.autorite)}`;
    if (reprisesVues.has(coordonnee)) {
      push(`recuperation : scénario ${coordonnee} cité deux fois`);
    }
    reprisesVues.add(coordonnee);
    const faute = fautesParCoordonnee.get(coordonnee);
    if (!faute) {
      push(`recuperation : scénario ${coordonnee} sans faute correspondante`);
      continue;
    }
    if (
      reprise.plateforme !== faute.plateforme ||
      reprise.executionId !== faute.executionId ||
      reprise.fauteSha256 !== faute.preuveSha256 ||
      reprise.sha256Artefact !== faute.sha256Artefact ||
      reprise.captureSha256 !== faute.captureSha256
    ) {
      push(
        `recuperation : scénario ${coordonnee} sans lien causal vers la faute exacte`,
      );
    }
    for (const preuve of PREUVES_RECUPERATION) {
      const observation = reprise.preuves?.[preuve];
      if (
        !resultatVert(observation?.resultat) ||
        !estSha256(observation?.preuveSha256) ||
        !estSha256(observation?.subjectSha256)
      ) {
        push(
          `recuperation : « ${preuve} » doit être prouvé vert pour ${coordonnee} avec ses hashes exacts`,
        );
      }
    }
  }
  for (const coordonnee of fautesParCoordonnee.keys()) {
    if (!reprisesVues.has(coordonnee)) {
      push(`recuperation : scénario manquant pour ${coordonnee}`);
    }
  }
  if (!estSha256(recuperation.captures)) {
    push("recuperation : empreinte des captures de faute manquante");
  }
}

/** Valide la matrice d'accessibilité distribuée et ses méthodes observées. */
export function validerAccessibilite(accessibilite, push) {
  const entrees = Array.isArray(accessibilite) ? accessibilite : [];
  const plateformesVues = new Set();
  for (const entree of entrees) {
    if (!entree || !PLATEFORMES.includes(entree.plateforme)) {
      push(
        `accessibilite : plateforme inconnue « ${String(entree?.plateforme)} »`,
      );
      continue;
    }
    if (plateformesVues.has(entree.plateforme)) {
      push(`accessibilite : ${entree.plateforme} citée deux fois`);
    }
    plateformesVues.add(entree.plateforme);
    const matrice = entree.matrice ?? {};
    for (const critere of MATRICE_ACCESSIBILITE) {
      const observation = matrice[critere];
      if (!resultatVert(observation?.resultat)) {
        push(
          `accessibilite : ${entree.plateforme} — critère « ${critere} » manquant ou non vert`,
        );
      }
      if (!methodesAccessibiliteExactes(observation?.methodes)) {
        push(
          `accessibilite : ${entree.plateforme} — critère « ${critere} » doit citer les méthodes exactes ${METHODES_ACCESSIBILITE.join(" + ")}`,
        );
      }
      if (critere === "lecteur-ecran") {
        const technologie = observation?.technologie;
        const attendue = LECTEUR_ECRAN_PAR_PLATEFORME[entree.plateforme];
        if (typeof technologie !== "string" || technologie.trim() === "") {
          push(
            `accessibilite : ${entree.plateforme} — technologie de lecteur d'écran manquante`,
          );
        } else if (attendue !== undefined && technologie !== attendue) {
          push(
            `accessibilite : ${entree.plateforme} — lecteur d'écran ${attendue} exigé`,
          );
        }
      }
    }
    if (!resultatVert(entree.resultat?.resultat)) {
      push(`accessibilite : ${entree.plateforme} non vert`);
    }
    if (!methodesAccessibiliteExactes(entree.resultat?.methodes)) {
      push(
        `accessibilite : ${entree.plateforme} — résultat agrégé sans méthodes ${METHODES_ACCESSIBILITE.join(" + ")}`,
      );
    }
    const lecteurAttendu = LECTEUR_ECRAN_PAR_PLATEFORME[entree.plateforme];
    const lecteurObserve = entree.resultat?.technologieLecteurEcran;
    if (
      typeof lecteurObserve !== "string" ||
      lecteurObserve.trim() === "" ||
      (lecteurAttendu !== undefined && lecteurObserve !== lecteurAttendu)
    ) {
      push(
        `accessibilite : ${entree.plateforme} — résultat agrégé sans lecteur d'écran ${lecteurAttendu ?? "observé"}`,
      );
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
