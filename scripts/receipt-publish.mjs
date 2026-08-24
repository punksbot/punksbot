#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publierRecuOperationnel } from "./promotion-publish-lib.mjs";

const OPTIONS_VALEUR = new Set([
  "--graphe",
  "--recu",
  "--parity",
  "--attestation",
  "--depot",
  "--tag",
  "--sha",
  "--release-id",
  "--etat-release",
  "--canal",
  "--r2-primaire",
  "--r2-secondaire",
  "--bootstrap-r2",
  "--frontieres",
]);

const OPTIONS_REQUISES = [
  "--graphe",
  "--recu",
  "--parity",
  "--depot",
  "--tag",
  "--sha",
  "--release-id",
  "--etat-release",
  "--r2-primaire",
  "--r2-secondaire",
];

export const USAGE_PUBLICATION_RECU = [
  "usage : node scripts/receipt-publish.mjs",
  "  --graphe <release-graph.yaml|json>",
  "  --recu <recu-signe.json>",
  "  --parity <cloudflare/PARITY.md>",
  "  [--attestation <attestation-transition.json>]",
  "  --depot <owner/repo>",
  "  --tag <punks-staging-SHA>",
  "  --sha <SHA-Punks-40-hex>",
  "  --release-id <id-canonique>",
  "  --etat-release <draft|published>",
  "  [--canal <punks-desktop>]",
  "  --r2-primaire <compte/bucket>",
  "  --r2-secondaire <compte/bucket>",
  "  [--bootstrap-r2 <true|false>]",
  "  --frontieres <module.mjs>",
].join(" ");

function lireArguments(argv) {
  if (argv.includes("--aide") || argv.includes("--help")) return { aide: true };
  const valeurs = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const valeur = argv[index + 1];
    if (!OPTIONS_VALEUR.has(option)) {
      throw new Error(`option inconnue : ${String(option)}`);
    }
    if (valeur === undefined || valeur.startsWith("--")) {
      throw new Error(`valeur manquante pour ${option}`);
    }
    if (valeurs.has(option)) throw new Error(`option dupliquée : ${option}`);
    valeurs.set(option, valeur);
  }
  for (const option of OPTIONS_REQUISES) {
    if (!valeurs.has(option)) {
      throw new Error(`option requise manquante : ${option}`);
    }
  }
  const etatRelease = valeurs.get("--etat-release");
  if (!new Set(["draft", "published"]).has(etatRelease)) {
    throw new Error("--etat-release doit valoir draft ou published");
  }
  const bootstrap = valeurs.get("--bootstrap-r2") ?? "false";
  if (!new Set(["true", "false"]).has(bootstrap)) {
    throw new Error("--bootstrap-r2 doit valoir true ou false");
  }
  return {
    aide: false,
    graphe: valeurs.get("--graphe"),
    recu: valeurs.get("--recu"),
    parity: valeurs.get("--parity"),
    attestation: valeurs.get("--attestation") ?? null,
    depot: valeurs.get("--depot"),
    tag: valeurs.get("--tag"),
    sha: valeurs.get("--sha"),
    releaseId: valeurs.get("--release-id"),
    draft: etatRelease === "draft",
    canal: valeurs.get("--canal") ?? "punks-desktop",
    primaire: valeurs.get("--r2-primaire"),
    secondaire: valeurs.get("--r2-secondaire"),
    bootstrapR2: bootstrap === "true",
    moduleFrontieres: valeurs.get("--frontieres") ?? null,
  };
}

function lireDestinationR2(role, valeur) {
  const segments = valeur.split("/");
  if (
    segments.length !== 2 ||
    segments.some((segment) => segment === "" || segment.trim() !== segment)
  ) {
    throw new Error(
      `${role} doit respecter le format canonique <compte>/<bucket>`,
    );
  }
  return { role, compte: segments[0], bucket: segments[1] };
}

async function chargerFrontieres(moduleFrontieres, configuration) {
  if (!moduleFrontieres) {
    throw new Error(
      "--frontieres est requis hors tests : aucun client GitHub/Cloudflare implicite",
    );
  }
  const module = await import(pathToFileURL(resolve(moduleFrontieres)).href);
  const creer = module.creerFrontieresPublication ?? module.default;
  if (typeof creer !== "function") {
    throw new Error(
      "le module de frontières doit exporter creerFrontieresPublication(configuration)",
    );
  }
  const frontieres = await creer(configuration);
  if (
    !frontieres?.github ||
    !frontieres?.cloudflare ||
    !frontieres?.confiance
  ) {
    throw new Error(
      "le module de frontières doit retourner { github, cloudflare, confiance }",
    );
  }
  return frontieres;
}

/** Exécute le CLI de publication d'un Reçu et retourne son code de sortie. */
export async function executerCliPublicationRecu(
  argv = process.argv.slice(2),
  {
    frontieres: frontieresInjectees = null,
    ecrireSortie = (ligne) => process.stdout.write(`${ligne}\n`),
    ecrireErreur = (ligne) => process.stderr.write(`${ligne}\n`),
  } = {},
) {
  try {
    const argumentsCli = lireArguments(argv);
    if (argumentsCli.aide) {
      ecrireSortie(USAGE_PUBLICATION_RECU);
      return 0;
    }
    const r2 = [
      lireDestinationR2("primaire", argumentsCli.primaire),
      lireDestinationR2("secondaire", argumentsCli.secondaire),
    ];
    const configuration = {
      depot: argumentsCli.depot,
      tag: argumentsCli.tag,
      sha: argumentsCli.sha,
      releaseId: argumentsCli.releaseId,
      draft: argumentsCli.draft,
      canal: argumentsCli.canal,
      bootstrapR2: argumentsCli.bootstrapR2,
      r2,
    };
    const frontieres =
      frontieresInjectees ??
      (await chargerFrontieres(argumentsCli.moduleFrontieres, configuration));
    const lectures = [
      readFile(resolve(argumentsCli.graphe)),
      readFile(resolve(argumentsCli.recu)),
      readFile(resolve(argumentsCli.parity)),
      argumentsCli.attestation === null
        ? Promise.resolve(undefined)
        : readFile(resolve(argumentsCli.attestation)),
    ];
    const [graphe, recu, parity, attestation] = await Promise.all(lectures);
    const resultat = await publierRecuOperationnel(
      { ...configuration, graphe, recu, parity, attestation },
      frontieres,
    );
    ecrireSortie(JSON.stringify(resultat));
    return 0;
  } catch (erreur) {
    ecrireErreur(
      JSON.stringify({
        ok: false,
        code: erreur?.code ?? "PUBLICATION_REFUSEE",
        message: erreur?.message ?? String(erreur),
        details: erreur?.details ?? {},
      }),
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await executerCliPublicationRecu();
}
