#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
} from "../migration-manifest-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
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

const INDEX_SCHEMA = "punks.promotion-evidence-index.v1";
const PREUVE_SCHEMA = "punks.promotion-proof.v1";
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DEPLOIEMENT_RE = /^sha256:[0-9a-f]{64}$/;

function refuser(message) {
  throw new Error(`dossier de promotion refusé : ${message}`);
}

function estObjet(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cheminCanonique(chemin) {
  return (
    typeof chemin === "string" &&
    chemin.length > 0 &&
    chemin === chemin.trim() &&
    !chemin.includes("\\") &&
    !chemin.startsWith("/") &&
    chemin
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function dansRacine(racine, chemin) {
  const relatif = relative(racine, chemin);
  return relatif === "" || (!relatif.startsWith("..") && !isAbsolute(relatif));
}

function lireFichierRegulierSansLien(chemin, racine, libelle) {
  let racineReelle;
  let cheminReel;
  try {
    racineReelle = realpathSync(racine);
    const statut = lstatSync(chemin);
    if (statut.isSymbolicLink()) {
      refuser(`${libelle} est un lien symbolique`);
    }
    if (!statut.isFile()) {
      refuser(`${libelle} doit être un fichier régulier`);
    }
    cheminReel = realpathSync(chemin);
  } catch (erreur) {
    if (
      String(erreur?.message ?? "").startsWith("dossier de promotion refusé")
    ) {
      throw erreur;
    }
    refuser(`${libelle} est illisible (${String(erreur?.code ?? "erreur")})`);
  }
  if (!dansRacine(racineReelle, cheminReel)) {
    refuser(`${libelle} sort de la racine des preuves`);
  }

  let descripteur;
  try {
    descripteur = openSync(
      chemin,
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
      refuser(`${libelle} a changé pendant sa lecture`);
    }
    return contenu;
  } catch (erreur) {
    if (
      String(erreur?.message ?? "").startsWith("dossier de promotion refusé")
    ) {
      throw erreur;
    }
    refuser(`${libelle} ne peut pas être lu sans suivre de lien`);
  } finally {
    if (descripteur !== undefined) {
      closeSync(descripteur);
    }
  }
}

function parserJson(contenu, libelle) {
  try {
    return JSON.parse(contenu.toString("utf8"));
  } catch {
    refuser(`${libelle} n'est pas un JSON valide`);
  }
}

function exigerChaine(value, libelle) {
  if (typeof value !== "string" || value.trim() === "") {
    refuser(`${libelle} doit être une chaîne non vide`);
  }
  return value;
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
    if (!estObjet(reference)) {
      refuser("référence de preuve malformée");
    }
    const { id, chemin, sha256 } = reference;
    exigerChaine(id, "identifiant de preuve");
    if (!cheminCanonique(chemin)) {
      refuser(`preuve « ${id} » avec chemin non canonique ou hors racine`);
    }
    if (!SHA256_RE.test(sha256 ?? "")) {
      refuser(`preuve « ${id} » sans sha256 valide`);
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
    chargees.set(id, { preuve, reference: { chemin, sha256 } });
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

function construireDossier({ chargees, deploiementId }) {
  const { prendre, finir } = creerConsommateur(chargees);
  const preuves = {};
  const citer = (id) => {
    const entree = prendre(id);
    const subjectSha256 = entree.preuve.data.subjectSha256;
    if (subjectSha256 !== undefined && !SHA256_RE.test(subjectSha256)) {
      refuser(`preuve « ${id} » avec subjectSha256 invalide`);
    }
    preuves[id] = {
      ...entree.reference,
      ...(subjectSha256 === undefined ? {} : { subjectSha256 }),
    };
    return entree;
  };

  const candidat = prendre("candidat").preuve;
  if (!Number.isInteger(candidat.data.tranche) || candidat.data.tranche < 1) {
    refuser("preuve candidat sans tranche entière positive");
  }
  const registres = prendre("registres").preuve.data.registres;
  if (!Array.isArray(registres)) refuser("preuve registres malformée");
  const nomsRegistres = registres.map((registre) => registre?.nom);
  if (
    nomsRegistres.length !== NOMS_REGISTRES_ATTESTATION.length ||
    !NOMS_REGISTRES_ATTESTATION.every((nom) => nomsRegistres.includes(nom))
  ) {
    refuser("preuve registres incomplète ou dupliquée");
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

  const artefacts = [];
  const bundles = new Map();
  for (const plateforme of PLATEFORMES) {
    const bundleId = `artefact/${plateforme}/bundle`;
    const signatureId = `artefact/${plateforme}/signature`;
    const bundle = citer(bundleId);
    const signature = citer(signatureId);
    exigerPlateforme(bundle.preuve, plateforme, bundleId);
    exigerPlateforme(signature.preuve, plateforme, signatureId);
    const verifications = {};
    for (const verification of VERIFICATIONS_ARTEFACT) {
      const id = `artefact/${plateforme}/verification/${verification}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, plateforme, id);
      verifications[verification] = entree.preuve.result;
    }
    exigerChaine(bundle.preuve.data.nom, `${bundleId}.data.nom`);
    exigerChaine(bundle.preuve.data.bundleId, `${bundleId}.data.bundleId`);
    if (!SHA256_RE.test(bundle.preuve.data.subjectSha256 ?? "")) {
      refuser(`${bundleId}.data.subjectSha256 doit lier l'artefact signé exact`);
    }
    if (!SHA256_RE.test(signature.preuve.data.subjectSha256 ?? "")) {
      refuser(
        `${signatureId}.data.subjectSha256 doit lier la signature exacte`,
      );
    }
    bundles.set(plateforme, bundle.preuve.data.subjectSha256);
    artefacts.push({
      plateforme,
      nom: bundle.preuve.data.nom,
      sha256: bundle.preuve.data.subjectSha256,
      signature: signature.preuve.data.subjectSha256,
      identite: {
        bundleId: bundle.preuve.data.bundleId,
        verifications,
      },
    });
  }

  const idsParcours = [...chargees.keys()].filter((id) =>
    id.startsWith("parcours/"),
  );
  const recits = new Set();
  for (const id of idsParcours) {
    const segments = id.split("/");
    if (segments.length !== 3 || !PLATEFORMES.includes(segments[1])) {
      refuser(`coordonnée de parcours invalide « ${id} »`);
    }
    exigerChaine(segments[2], `récit de ${id}`);
    recits.add(segments[2]);
  }
  if (recits.size === 0) refuser("aucune preuve de parcours UI+IPC+contrats");
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

  const fautes = TYPES_FAUTE.map((type) => {
    const id = `faute/${type}`;
    const entree = citer(id);
    const plateforme = entree.preuve.data.plateforme;
    exigerPlateforme(entree.preuve, plateforme, id);
    if (!PLATEFORMES.includes(plateforme)) {
      refuser(`preuve « ${id} » sur plateforme inconnue`);
    }
    return {
      type,
      plateforme,
      autorite: exigerChaine(entree.preuve.data.autorite, `${id}.autorite`),
      resultat: entree.preuve.result,
    };
  });

  const recuperation = {};
  for (const nom of PREUVES_RECUPERATION) {
    recuperation[nom] = citer(`recuperation/${nom}`).preuve.result;
  }
  recuperation.captures = citer("recuperation/captures").reference.sha256;

  const accessibilite = PLATEFORMES.map((plateforme) => {
    const matrice = {};
    for (const critere of MATRICE_ACCESSIBILITE) {
      const id = `accessibilite/${plateforme}/${critere}`;
      const entree = citer(id);
      exigerPlateforme(entree.preuve, plateforme, id);
      matrice[critere] = entree.preuve.result;
    }
    const resultatId = `accessibilite/${plateforme}/resultat`;
    const resultat = citer(resultatId);
    exigerPlateforme(resultat.preuve, plateforme, resultatId);
    return { plateforme, matrice, resultat: resultat.preuve.result };
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
        { resultat: entree.preuve.result, empreinte: entree.reference.sha256 },
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
    liaison: {
      canal: "punks-desktop",
      artefacts,
      staging: {
        environnement: staging.environnement,
        compte: staging.compte,
        zone: staging.zone,
        deploiement: staging.deploiement,
        materiau: staging.materiau,
        "materiau-sha256": stagingEntree.preuve.data.subjectSha256,
      },
      registres,
    },
    parcours: {
      contour,
      serveurVite,
      facadeTest,
      recits: [...recits].sort(),
      executions,
    },
    fautes,
    recuperation,
    accessibilite,
    goldens,
    retrait: {
      diff: retraitDiff.reference.sha256,
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
  deploiementId,
}) {
  if (!SHA1_RE.test(candidatSha ?? "")) {
    refuser("SHA candidat exact de 40 hexadécimaux attendu");
  }
  if (!DEPLOIEMENT_RE.test(deploiementId ?? "")) {
    refuser("identifiant de déploiement exact sha256 attendu");
  }
  exigerChaine(racinePreuves, "racine des preuves");
  exigerChaine(indexPreuves, "index des preuves");
  const chargees = chargerPreuves({
    racinePreuves,
    indexPreuves,
    candidatSha,
    deploiementId,
  });
  const dossier = construireDossier({ chargees, candidatSha, deploiementId });
  const erreurs = validerDossier(dossier, { racinePreuves });
  if (erreurs.length > 0) {
    refuser(
      `dossier incompatible avec validerDossier : ${erreurs.join(" ; ")}`,
    );
  }
  return dossier;
}

function lireOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const cle = argv[index];
    const valeur = argv[index + 1];
    if (!cle?.startsWith("--") || valeur === undefined) {
      refuser("options attendues par paires --nom valeur");
    }
    if (options.has(cle)) refuser(`option dupliquée ${cle}`);
    options.set(cle, valeur);
  }
  return options;
}

export function run(argv = process.argv.slice(2)) {
  const options = lireOptions(argv);
  const exiger = (nom) => {
    const valeur = options.get(nom);
    if (valeur === undefined) refuser(`option obligatoire manquante ${nom}`);
    return valeur;
  };
  const dossier = assemblerDossierPromotion({
    racinePreuves: resolve(exiger("--racine-preuves")),
    indexPreuves: resolve(exiger("--index-preuves")),
    candidatSha: exiger("--candidat-sha"),
    deploiementId: exiger("--deploiement-id"),
  });
  const sortie = resolve(exiger("--sortie"));
  writeFileSync(sortie, `${JSON.stringify(dossier, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return dossier;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    run();
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exitCode = 1;
  }
}
