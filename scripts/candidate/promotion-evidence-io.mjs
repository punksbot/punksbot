/**
 * Lecture stable des matériaux d'une promotion, sans liens ni réouverture.
 *
 * Les fonctions de ce module retournent les octets lus depuis un descripteur
 * stable afin que validation, hash et attestation portent sur le même contenu.
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
import { isAbsolute, relative, resolve } from "node:path";

function refuser(message) {
  throw new Error(`dossier de promotion refusé : ${message}`);
}

/** Refuse tout chemin relatif ambigu, absolu ou traversant. */
export function cheminCanonique(chemin) {
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

/** Indique si un chemin résolu reste dans la racine résolue. */
export function dansRacine(racine, chemin) {
  const relatif = relative(racine, chemin);
  return relatif === "" || (!relatif.startsWith("..") && !isAbsolute(relatif));
}

/** Lit une seule fois un fichier régulier stable sans suivre de lien. */
export function lireFichierRegulierSansLien(chemin, racine, libelle) {
  let racineReelle;
  let cheminReel;
  try {
    racineReelle = realpathSync(racine);
    const statut = lstatSync(chemin);
    if (statut.isSymbolicLink()) refuser(`${libelle} est un lien symbolique`);
    if (!statut.isFile()) refuser(`${libelle} doit être un fichier régulier`);
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
    if (descripteur !== undefined) closeSync(descripteur);
  }
}

/** Parse les octets JSON d'une preuve en échouant fermé. */
export function parserJson(contenu, libelle) {
  try {
    return JSON.parse(contenu.toString("utf8"));
  } catch {
    refuser(`${libelle} n'est pas un JSON valide`);
  }
}

/** Référence les octets stables d'un fichier contenu dans la racine. */
export function referenceFichierDansRacine(racinePreuves, chemin, libelle) {
  const racine = realpathSync(racinePreuves);
  const cheminDeclare = resolve(chemin);
  const absolu = realpathSync(cheminDeclare);
  if (!dansRacine(racine, absolu)) {
    refuser(`${libelle} sort de la racine des preuves`);
  }
  const contenu = lireFichierRegulierSansLien(cheminDeclare, racine, libelle);
  return {
    chemin: relative(racine, absolu),
    sha256: createHash("sha256").update(contenu).digest("hex"),
  };
}
