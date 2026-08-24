/**
 * Harnais d'acceptation d'une promotion Punks (issue #52).
 *
 * La couture d'acceptation unique de l'issue #47 : ce CLI consomme le dossier
 * de preuve assemblé par les exécutions de plateforme (artefact Tauri signé
 * installé, connecté au déploiement Workers exact du staging isolé), exécute
 * réellement les gates d'autorisation, puis — et seulement alors — émet
 * l'attestation immuable au format du graphe de release (issue #51) et son
 * Reçu, en écriture create-only.
 *
 * Usage :
 *   node scripts/check-promotion-dossier.mjs <dossier.json> [--sortie <dir>]
 *
 * `--sans-execution` est conservé uniquement comme garde de compatibilité :
 * il échoue toujours et ne peut ni valider, ni émettre, ni écrire.
 *
 * Règles :
 *   - le checkout Git doit être strictement propre avant toute lecture du
 *     dossier ou attribution d'une gate au SHA HEAD ;
 *   - dossier invalide (plateforme manquante, preuve d'accessibilité, verdict
 *     golden, diff de retrait ou scan legacy absent, parcours non distribué,
 *     liaison ambiguë) → échec, aucune attestation ;
 *   - `pnpm cloudflare:check` exécuté par ce CLI doit terminer vert, et le SHA
 *     du dépôt doit être le SHA exact du candidat du dossier ;
 *   - le graphe de release doit être vert et contenir la tranche du candidat,
 *     pas encore scellée ;
 *   - l'attestation et le Reçu ne sont jamais écrasés (create-only).
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalSha256,
  loadYamlDocument,
} from "./migration-manifest-lib.mjs";
import { repoRoot } from "./render-withdrawal-inventory.mjs";
import {
  computeLiveHashes,
  runValidation as runGraphValidation,
} from "./check-release-graph.mjs";
import {
  candidatDejaScelle,
  construireAttestation,
  tranchePresente,
  validerDossier,
} from "./promotion-dossier-lib.mjs";

const ledgerPath = join(repoRoot, "docs/migration/goldens-ledger.yaml");
const graphPath = join(repoRoot, "docs/migration/release-graph.yaml");

/**
 * Refuse en mode fail-closed tout checkout dont le porcelain Git n'est pas
 * vide. L'injection de l'exécuteur est réservée aux tests de non-régression.
 */
export function exigerCheckoutPropre({
  executer = execFileSync,
  cwd = repoRoot,
} = {}) {
  let statut;
  try {
    statut = executer("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (erreur) {
    throw new Error(
      `[gate] impossible de vérifier la propreté du checkout avec git status --porcelain (code ${String(erreur?.status ?? "inconnu")}) — aucune gate ne peut être liée au SHA HEAD`,
      { cause: erreur },
    );
  }

  if (String(statut).length > 0) {
    throw new Error(
      "[gate] checkout git non propre : git status --porcelain doit être strictement vide avant de lier les gates au SHA HEAD — aucune attestation",
    );
  }
}

function exigerDestinationAbsente(chemin) {
  try {
    const statut = lstatSync(chemin);
    if (statut.isSymbolicLink()) {
      throw new Error(
        `${relative(repoRoot, chemin)} est un lien symbolique — écriture create-only refusée`,
      );
    }
    throw new Error(
      `${relative(repoRoot, chemin)} existe déjà — écriture create-only, jamais d'écrasement`,
    );
  } catch (erreur) {
    if (erreur?.code === "ENOENT") {
      return;
    }
    throw erreur;
  }
}

function annulerFichierCree(entree) {
  const identite =
    entree.identite ?? fstatSync(entree.descripteur, { bigint: true });
  const courant = lstatSync(entree.chemin, { bigint: true });
  if (
    courant.isSymbolicLink() ||
    courant.dev !== identite.dev ||
    courant.ino !== identite.ino
  ) {
    throw new Error(
      `${entree.chemin} a été remplacé pendant le rollback ; refus de supprimer le fichier concurrent`,
    );
  }
  unlinkSync(entree.chemin);
}

/**
 * Écrit la paire locale attestation/Reçu avec création atomique `wx`.
 *
 * Cette fonction ne publie rien. Elle garde les descripteurs ouverts jusqu'à
 * la synchronisation des deux fichiers et annule les créations déjà réalisées
 * si une course ou une erreur empêche de compléter la paire.
 */
export function ecrireEmissionLocale(
  { sortie, tranche, attestation, recu },
  { ouvrir = openSync } = {},
) {
  if (!Number.isInteger(tranche) || tranche < 1) {
    throw new Error("tranche entière ≥ 1 exigée pour l'émission locale");
  }
  const sortieAbsolue = resolve(sortie);
  mkdirSync(sortieAbsolue, { recursive: true });
  const statutSortie = lstatSync(sortieAbsolue);
  if (statutSortie.isSymbolicLink() || !statutSortie.isDirectory()) {
    throw new Error(
      `${sortieAbsolue} doit être un répertoire réel, jamais un lien symbolique`,
    );
  }

  const cheminAttestation = join(
    sortieAbsolue,
    `attestation-tranche-${tranche}.json`,
  );
  const cheminRecu = join(sortieAbsolue, `recu-promotion-${tranche}.json`);
  for (const chemin of [cheminAttestation, cheminRecu]) {
    exigerDestinationAbsente(chemin);
  }

  const contenus = [
    {
      chemin: cheminAttestation,
      contenu: Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`),
    },
    {
      chemin: cheminRecu,
      contenu: Buffer.from(`${JSON.stringify(recu, null, 2)}\n`),
    },
  ];
  const crees = [];
  try {
    for (const entree of contenus) {
      const descripteur = ouvrir(entree.chemin, "wx", 0o600);
      const cree = {
        ...entree,
        descripteur,
        identite: null,
        ferme: false,
      };
      crees.push(cree);
      cree.identite = fstatSync(descripteur, { bigint: true });
    }
    for (const entree of crees) {
      let position = 0;
      while (position < entree.contenu.length) {
        const ecrits = writeSync(
          entree.descripteur,
          entree.contenu,
          position,
          entree.contenu.length - position,
        );
        if (ecrits < 1) {
          throw new Error(
            "écriture locale interrompue avant la fin du fichier",
          );
        }
        position += ecrits;
      }
      fsyncSync(entree.descripteur);
    }
    for (const entree of crees) {
      closeSync(entree.descripteur);
      entree.ferme = true;
    }
  } catch (erreur) {
    const erreursRollback = [];
    for (const entree of [...crees].reverse()) {
      try {
        annulerFichierCree(entree);
      } catch (erreurRollback) {
        if (erreurRollback?.code !== "ENOENT") {
          erreursRollback.push(erreurRollback.message);
        }
      }
      if (!entree.ferme) {
        try {
          closeSync(entree.descripteur);
          entree.ferme = true;
        } catch (erreurFermeture) {
          erreursRollback.push(erreurFermeture.message);
        }
      }
    }
    const detailsRollback =
      erreursRollback.length === 0
        ? "rollback terminé"
        : `rollback incomplet : ${erreursRollback.join(" ; ")}`;
    throw new Error(
      `écriture create-only atomique refusée (${String(erreur?.code ?? "erreur")}) — ${detailsRollback}`,
      { cause: erreur },
    );
  }

  return { cheminAttestation, cheminRecu };
}

function headCourant() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function fichiersSuivis() {
  const sortie = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return sortie
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0);
}

/** Exécute réellement pnpm cloudflare:check ; retourne { resultat, code }. */
function executerCloudflareCheck() {
  try {
    execFileSync("pnpm", ["cloudflare:check"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { resultat: "vert", code: 0 };
  } catch (erreur) {
    return { resultat: "echec", code: erreur.status ?? 1 };
  }
}

export function main(argv = process.argv.slice(2)) {
  const sansExecution = argv.includes("--sans-execution");
  const cheminDossier = argv.find((a) => !a.startsWith("--"));
  const sortieIdx = argv.indexOf("--sortie");
  const sortie =
    sortieIdx !== -1
      ? resolve(repoRoot, argv[sortieIdx + 1])
      : join(repoRoot, "docs/migration/promotion");

  if (!cheminDossier || typeof cheminDossier !== "string") {
    console.error(
      "usage : node scripts/check-promotion-dossier.mjs <dossier.json> [--sortie <dir>] [--sans-execution]",
    );
    process.exit(1);
  }

  if (sansExecution) {
    console.error(
      "✗ --sans-execution est interdit pour la promotion : aucune validation, aucune attestation et aucune émission locale ne sont possibles sans exécuter les gates réelles",
    );
    process.exit(1);
  }

  // Précondition fail-closed : ce contrôle précède volontairement la lecture
  // du dossier, les validations et toute attribution au SHA HEAD. Le mode
  // --sans-execution a déjà été refusé avant cette étape.
  try {
    exigerCheckoutPropre();
  } catch (erreur) {
    console.error(`✗ ${erreur.message}`);
    process.exit(1);
  }

  const cheminDossierAbsolu = resolve(repoRoot, cheminDossier);
  const dossier = JSON.parse(readFileSync(cheminDossierAbsolu, "utf8"));
  const ledger = loadYamlDocument(ledgerPath);
  const graph = loadYamlDocument(graphPath);
  const { hashes, staging } = computeLiveHashes(fichiersSuivis());

  const contexteValidation = {
    ledgerRetraits: ledger?.["retraits-par-tranche"]?.lignes ?? [],
    hashes,
    stagingIds: { compte: staging?.account?.id, zone: staging?.zone?.id },
    racinePreuves: dirname(cheminDossierAbsolu),
  };
  const erreurs = validerDossier(dossier, contexteValidation);

  // Autorisation 1 : pnpm cloudflare:check réellement exécuté sur ce candidat.
  let cloudflareCheck = "echec";
  const resultat = executerCloudflareCheck();
  cloudflareCheck = resultat.resultat;
  if (resultat.code !== 0) {
    erreurs.push(
      `[gate] pnpm cloudflare:check a échoué (code ${resultat.code}) — aucune attestation`,
    );
  }
  // Le gate peut lui-même révéler ou produire un diff. Revalider la
  // précondition immédiatement avant de lire HEAD ferme cette fenêtre et
  // interdit d'attribuer le résultat à un checkout devenu sale.
  try {
    exigerCheckoutPropre();
    const shaHead = headCourant();
    if (dossier.candidat?.sha !== shaHead) {
      erreurs.push(
        `[gate] le SHA du candidat (${String(dossier.candidat?.sha)}) n'est pas le SHA testé (${shaHead}) — la preuve doit être produite sur l'état exact`,
      );
    }
  } catch (erreur) {
    erreurs.push(erreur.message);
  }

  // Autorisation 2 : le graphe de release doit être vert et autoriser la tranche.
  let autorisationGraphe = "echec";
  const validationGraphe = runGraphValidation();
  if (validationGraphe.erreurs.length > 0) {
    erreurs.push(
      `[gate] le graphe de release est invalide (${validationGraphe.erreurs.length} erreur(s)) — aucune attestation`,
    );
  } else if (!tranchePresente(graph, dossier.candidat?.tranche)) {
    erreurs.push(
      `[gate] la tranche ${String(dossier.candidat?.tranche)} n'est pas reliée dans le graphe de release`,
    );
  } else if (candidatDejaScelle(graph, dossier.candidat?.tranche)) {
    erreurs.push(
      "[gate] le candidat de cette tranche est déjà scellé — l'attestation est immuable, jamais réémise",
    );
  } else {
    autorisationGraphe = "vert";
  }

  if (erreurs.length > 0) {
    console.error(`✗ dossier de promotion invalide (${erreurs.length}) :`);
    for (const erreur of erreurs) {
      console.error(`  - ${erreur}`);
    }
    process.exit(1);
  }

  const emission = construireAttestation(dossier, {
    ...contexteValidation,
    autorisation: { cloudflareCheck, graphe: autorisationGraphe },
  });
  if (emission.erreur) {
    console.error(`✗ attestation refusée : ${emission.erreur}`);
    process.exit(1);
  }

  let chemins;
  try {
    chemins = ecrireEmissionLocale({
      sortie,
      tranche: dossier.candidat.tranche,
      attestation: emission.attestation,
      recu: emission.recu,
    });
  } catch (erreur) {
    console.error(`✗ émission locale refusée : ${erreur.message}`);
    process.exit(1);
  }
  console.log(
    `✓ attestation locale immuable émise : ${relative(repoRoot, chemins.cheminAttestation)}`,
  );
  console.log(
    `✓ Reçu local émis : ${relative(repoRoot, chemins.cheminRecu)} — aucune publication release/R2 n'est déclarée par ce CLI`,
  );
  console.log(
    `✓ dossier sha256=${canonicalSha256(dossier)} — cloudflare:check exécuté vert, graphe autorisant`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
