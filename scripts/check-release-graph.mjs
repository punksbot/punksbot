/**
 * Gate du graphe de release Punks (issue #51).
 *
 * Valide docs/migration/release-graph.yaml contre le dépôt réel :
 *
 *   - les matériaux du candidat en preparation (registre des contrats,
 *     schémas, artefacts générés, profil, registre des goldens, manifeste de
 *     retrait, matériau de staging) portent les hashes réellement recalculés ;
 *   - les identifiants de staging cités sont ceux du matériau de staging ;
 *   - les lignes retraits-par-tranche du registre des goldens et les verdicts
 *     tranche:N du manifeste de retrait sont rattachés à un candidat scellé,
 *     et le retrait physique est prouvé absent des fichiers suivis ;
 *   - la politique (promotion immédiate fondée sur les preuves, 90 jours,
 *     < 1 % pendant 14 jours, roll-forward, certificat de compatibilité,
 *     interdiction de retour Buzz, immuabilité R2) ne peut pas dériver des
 *     décisions closes ;
 *   - chaque candidat scellé porte preuves, retrait, attestation complète et
 *     Reçus publiés avec la release et dans le stockage R2 prévu.
 *
 * `--hashes` imprime en sus le SHA-256 canonique du graphe.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  canonicalSha256,
  loadYamlDocument,
} from "./migration-manifest-lib.mjs";
import { repoRoot } from "./render-withdrawal-inventory.mjs";
import { validateParityReceiptIndex } from "./promotion-publish-lib.mjs";
import {
  validateReleaseGraph,
  validateReleaseGraphEvolution,
} from "./release-graph-lib.mjs";

export const graphPath = join(repoRoot, "docs/migration/release-graph.yaml");
const manifestPath = join(repoRoot, "docs/migration/withdrawal-inventory.yaml");
const ledgerPath = join(repoRoot, "docs/migration/goldens-ledger.yaml");
const registryPath = join(
  repoRoot,
  "cloudflare/packages/contracts/registry.json",
);
const profilePath = join(
  repoRoot,
  "cloudflare/packages/contracts/profiles/desktop-social-loop@1.json",
);
const stagingPath = join(repoRoot, "cloudflare/staging.resources.json");
const parityPath = join(repoRoot, "cloudflare/PARITY.md");
const graphRepoPath = relative(repoRoot, graphPath);

const CONTRACT_ROOTS = [
  "cloudflare/packages/contracts/schemas",
  "cloudflare/packages/contracts/generated",
  "cloudflare/packages/contracts/src/generated",
];

function repoFileExists(path) {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }
  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return false;
  }
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0);
}

/** Empreinte déterministe d'un sous-arbre suivi (chemins + hashes de contenu). */
function treeSha256(files, roots) {
  const entries = files
    .filter((f) => roots.some((root) => f.startsWith(`${root}/`)))
    .sort()
    .map((f) => [
      f,
      createHash("sha256")
        .update(readFileSync(join(repoRoot, f)))
        .digest("hex"),
    ]);
  if (entries.length === 0) {
    throw new Error(`aucun fichier suivi sous ${roots.join(", ")}`);
  }
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function loadJsonDocument(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

/**
 * Calcule les hashes vivants et charge les matériaux qui les ont produits.
 *
 * Retourne `{ hashes, ledger, manifest, registry, profile, staging }` afin que
 * les consommateurs valident les mêmes octets et les mêmes projections.
 */
export function computeLiveHashes(files) {
  const manifest = loadYamlDocument(manifestPath);
  const ledger = loadYamlDocument(ledgerPath);
  const registry = loadJsonDocument(registryPath);
  const profile = loadJsonDocument(profilePath);
  const staging = loadJsonDocument(stagingPath);
  return {
    hashes: {
      "registre-contrats": canonicalSha256(registry),
      schemas: treeSha256(files, [CONTRACT_ROOTS[0]]),
      generes: treeSha256(files, CONTRACT_ROOTS.slice(1)),
      profil: canonicalSha256(profile),
      "registre-goldens": canonicalSha256(ledger),
      "manifeste-retrait": canonicalSha256(manifest),
      staging: canonicalSha256(staging),
    },
    ledger,
    manifest,
    registry,
    profile,
    staging,
  };
}

function refDepuisEvenementGithub() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const evenement = JSON.parse(readFileSync(eventPath, "utf8"));
    for (const candidat of [
      evenement?.before,
      evenement?.pull_request?.base?.sha,
    ]) {
      if (/^[0-9a-f]{40}$/.test(candidat ?? "") && !/^0+$/.test(candidat)) {
        return candidat;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function grapheModifieDepuisHead() {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", graphRepoPath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return false;
  } catch (erreur) {
    if (erreur?.status === 1) return true;
    throw erreur;
  }
}

/** Résout la tête Git de référence utilisée pour le contrôle append-only. */
export function resolveEvolutionBaseRef() {
  const explicite = process.env.RELEASE_GRAPH_BASE_SHA;
  if (explicite) return explicite;
  const github = refDepuisEvenementGithub();
  if (github) return github;
  return grapheModifieDepuisHead() ? "HEAD" : "HEAD^";
}

function chargerGraphePrecedent() {
  const ref = resolveEvolutionBaseRef();
  try {
    const source = execFileSync("git", ["show", `${ref}:${graphRepoPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { graph: parse(source), ref };
  } catch (erreur) {
    return {
      graph: null,
      ref,
      erreur: `impossible de charger ${ref}:${graphRepoPath} (${String(erreur?.message ?? erreur)})`,
    };
  }
}

/**
 * Valide le graphe contre l'état vivant du dépôt.
 *
 * Retourne `{ graph, erreurs, live }`, où `live` contient les hashes et les
 * documents `ledger`, `manifest`, `registry`, `profile` et `staging` chargés
 * par `computeLiveHashes` pour cette validation précise.
 */
export function runValidation() {
  const graph = loadYamlDocument(graphPath);
  const files = trackedFiles();
  const { hashes, ledger, manifest, registry, profile, staging } =
    computeLiveHashes(files);
  const erreurs = validateReleaseGraph(graph, {
    hashes,
    stagingIds: {
      compte: staging?.account?.id,
      zone: staging?.zone?.id,
    },
    ledgerRetraits: ledger?.["retraits-par-tranche"]?.lignes ?? [],
    manifestActifs: Array.isArray(manifest?.actifs) ? manifest.actifs : [],
    trackedFiles: files,
    fileExists: repoFileExists,
  });
  erreurs.push(
    ...validateParityReceiptIndex(graph, readFileSync(parityPath, "utf8")),
  );
  const precedent = chargerGraphePrecedent();
  if (precedent.graph === null) {
    erreurs.push(`[évolution] ${precedent.erreur}`);
  } else {
    erreurs.push(
      ...validateReleaseGraphEvolution(precedent.graph, graph).map(
        (erreur) => `[${precedent.ref}] ${erreur}`,
      ),
    );
  }

  // Le profil cité par le candidat en preparation doit exister dans le registre.
  const preparation = (
    Array.isArray(graph?.releases) ? graph.releases : []
  ).find((r) => r?.etat === "preparation");
  if (preparation) {
    const profilId = preparation.materiaux?.profil?.id;
    if (profilId && profilId !== profile?.id) {
      erreurs.push(
        `[liaison] ${preparation.id} : le profil cité « ${profilId} » n'est pas le profil du dépôt (« ${String(profile?.id)} »)`,
      );
    }
    if (
      registry?.version !==
      preparation.materiaux?.["registre-contrats"]?.version
    ) {
      erreurs.push(
        `[liaison] ${preparation.id} : la version du registre des contrats citée ne correspond pas au registre du dépôt`,
      );
    }
  }

  return {
    graph,
    erreurs,
    live: { hashes, ledger, manifest, registry, profile, staging },
  };
}

export function main() {
  const { graph, erreurs } = runValidation();
  if (erreurs.length > 0) {
    console.error(`✗ graphe de release invalide (${erreurs.length}) :`);
    for (const erreur of erreurs) {
      console.error(`  - ${erreur}`);
    }
    process.exit(1);
  }
  const releases = graph.releases ?? [];
  const scellees = releases.filter((r) => r.etat !== "preparation").length;
  console.log(
    `✓ graphe de release : ${releases.length} candidat(s) relié(s), ${scellees} scellé(s), promotion immédiate par preuves, politique 90 j / < 1 % / 14 j et interdiction de retour Buzz vérifiées`,
  );
  if (process.argv.includes("--hashes")) {
    console.log(
      `release-graph.yaml version=${graph.version} sha256=${canonicalSha256(graph)}`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
