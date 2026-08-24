#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publierPromotion } from "./promotion-publish-lib.mjs";

const OPTIONS_VALEUR = new Set([
  "--attestation",
  "--recu",
  "--depot",
  "--tag",
  "--canal",
  "--r2-primaire",
  "--r2-secondaire",
  "--frontieres",
]);

const OPTIONS_REQUISES = [
  "--attestation",
  "--recu",
  "--depot",
  "--tag",
  "--r2-primaire",
  "--r2-secondaire",
];

export const USAGE_PUBLICATION = [
  "usage : node scripts/promotion-publish.mjs",
  "  --attestation <attestation-tranche-N.json>",
  "  --recu <recu-promotion-N.json>",
  "  --depot <owner/repo>",
  "  --tag <punks-staging-SHA>",
  "  [--canal <punks-desktop>]",
  "  --r2-primaire <compte/bucket>",
  "  --r2-secondaire <compte/bucket>",
  "  --frontieres <module.mjs>",
].join(" ");

function lireArguments(argv) {
  if (argv.includes("--aide") || argv.includes("--help")) {
    return { aide: true };
  }
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
    if (valeurs.has(option)) {
      throw new Error(`option dupliquée : ${option}`);
    }
    valeurs.set(option, valeur);
  }
  for (const option of OPTIONS_REQUISES) {
    if (!valeurs.has(option)) {
      throw new Error(`option requise manquante : ${option}`);
    }
  }
  return {
    aide: false,
    attestation: valeurs.get("--attestation"),
    recu: valeurs.get("--recu"),
    depot: valeurs.get("--depot"),
    tag: valeurs.get("--tag"),
    canal: valeurs.get("--canal") ?? "punks-desktop",
    primaire: valeurs.get("--r2-primaire"),
    secondaire: valeurs.get("--r2-secondaire"),
    moduleFrontieres: valeurs.get("--frontieres") ?? null,
  };
}

function lireDestinationR2(role, valeur) {
  const segments = valeur.split("/");
  if (
    segments.length !== 2 ||
    segments[0].trim() !== segments[0] ||
    segments[1].trim() !== segments[1] ||
    segments.some((segment) => segment.length === 0)
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
  if (!frontieres?.github || !frontieres?.cloudflare) {
    throw new Error(
      "le module de frontières doit retourner { github, cloudflare }",
    );
  }
  return frontieres;
}

/**
 * Point d'entrée CLI injectable. Retourne un code de sortie et n'appelle
 * `process.exit` ni aucune frontière distante directement.
 */
export async function executerCliPublication(
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
      ecrireSortie(USAGE_PUBLICATION);
      return 0;
    }
    const r2 = [
      lireDestinationR2("primaire", argumentsCli.primaire),
      lireDestinationR2("secondaire", argumentsCli.secondaire),
    ];
    const configuration = {
      depot: argumentsCli.depot,
      tag: argumentsCli.tag,
      canal: argumentsCli.canal,
      r2,
    };
    const frontieres =
      frontieresInjectees ??
      (await chargerFrontieres(argumentsCli.moduleFrontieres, configuration));
    const [attestation, recu] = await Promise.all([
      readFile(resolve(argumentsCli.attestation)),
      readFile(resolve(argumentsCli.recu)),
    ]);
    const resultat = await publierPromotion(
      { ...configuration, attestation, recu },
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
  process.exitCode = await executerCliPublication();
}
