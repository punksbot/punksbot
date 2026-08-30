/**
 * Gate des manifestes de migration Punks (issue #49).
 *
 * Valide docs/migration/withdrawal-inventory.yaml et
 * docs/migration/goldens-ledger.yaml :
 *
 *   - doublons : deux actifs ne portent pas le même chemin (qualificatif inclus) ;
 *   - omissions : tout fichier suivi ou nouveau non ignoré est couvert par un actif,
 *     et tout golden dérivé de la baseline Punks figée a sa ligne au registre ;
 *   - références invalides : chaque chemin d’actif et chaque source/preuve
 *     résout un fichier réel du dépôt ;
 *   - verdicts incomplets : vocabulaire fermé, conservation typée exigée,
 *     échéances et décisions présentes, clients gelés non retirés par avance ;
 *   - destinations : les actifs Punks desktop ne peuvent pas être absorbés par
 *     un catch-all legacy et un retrait déclaré doit déjà être absent de Git ;
 *   - dérive de la vue : withdrawal-inventory.md doit être la sortie exacte
 *     du générateur.
 *
 * `--hashes` imprime en sus les SHA-256 canoniques cités par les attestations.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_PUNKS,
  PUNKS_TEST_SOURCE_SET_SHA256,
  canonicalSha256,
  CHEMINS_GOLDENS,
  discoverPunksTestSources,
  discoverGoldenSources,
  GOLDEN_SOURCE_SET_SHA256,
  loadYamlDocument,
  validatePunksTestUniverse,
  validateGoldenUniverse,
  validateLedger,
  validateManifest,
} from "./migration-manifest-lib.mjs";
import {
  manifestPath,
  renderMarkdown,
  repoRoot,
  viewPath,
} from "./render-withdrawal-inventory.mjs";

const ledgerPath = join(repoRoot, CHEMINS_GOLDENS.registre);
const universePath = join(repoRoot, CHEMINS_GOLDENS.univers);
const testsUniversePath = join(repoRoot, CHEMINS_GOLDENS["univers-tests"]);

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

function trackedFiles(treeish) {
  const args =
    treeish === undefined
      ? ["ls-files", "-z"]
      : ["ls-tree", "-r", "--name-only", "-z", treeish];
  const out = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0);
}

function workingFiles() {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: repoRoot,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return [...new Set(out.toString("utf8").split("\0").filter(Boolean))].sort();
}

function baselineTrackedFiles() {
  try {
    return trackedFiles(BASELINE_PUNKS);
  } catch {
    // Les clones shallow ne possèdent pas toujours l'objet baseline. Dans ce
    // cas l'empreinte indépendante figée ci-dessus reste le garde-fou opposable.
    return null;
  }
}

export function runValidation() {
  const manifest = loadYamlDocument(manifestPath);
  const ledger = loadYamlDocument(ledgerPath);
  const universe = loadYamlDocument(universePath);
  const testsUniverse = loadYamlDocument(testsUniversePath);
  const files = workingFiles();
  const baselineFiles = baselineTrackedFiles();
  const historicalGoldenSources =
    baselineFiles === null ? undefined : discoverGoldenSources(baselineFiles);
  const historicalTestSources =
    baselineFiles === null ? undefined : discoverPunksTestSources(baselineFiles);

  const erreursManifeste = validateManifest(manifest, files);
  const erreursUnivers = validateGoldenUniverse(
    universe,
    files,
    repoFileExists,
    historicalGoldenSources,
    GOLDEN_SOURCE_SET_SHA256,
  );
  const erreursRegistre = validateLedger(
    ledger,
    files,
    repoFileExists,
    universe.sources,
    testsUniverse.sources,
  );
  const erreursUniversTests = validatePunksTestUniverse(
    testsUniverse,
    historicalTestSources,
    PUNKS_TEST_SOURCE_SET_SHA256,
  );

  const erreurs = [
    ...erreursManifeste.map((e) => `[manifeste] ${e}`),
    ...erreursUnivers.map((e) => `[univers] ${e}`),
    ...erreursUniversTests.map((e) => `[univers-tests] ${e}`),
    ...erreursRegistre.map((e) => `[registre] ${e}`),
  ];

  if (
    manifest.goldens?.registre &&
    !repoFileExists(manifest.goldens.registre)
  ) {
    erreurs.push(
      `[manifeste] section goldens : registre introuvable (${manifest.goldens.registre})`,
    );
  }
  if (manifest.goldens?.univers !== CHEMINS_GOLDENS.univers) {
    erreurs.push(
      "[manifeste] section goldens : univers indépendant manquant ou invalide",
    );
  } else if (!repoFileExists(manifest.goldens.univers)) {
    erreurs.push(
      `[manifeste] section goldens : univers introuvable (${manifest.goldens.univers})`,
    );
  }
  if (
    manifest.goldens?.["univers-tests"] !== CHEMINS_GOLDENS["univers-tests"]
  ) {
    erreurs.push(
      "[manifeste] section goldens : univers des tests Punks manquant ou invalide",
    );
  } else if (!repoFileExists(manifest.goldens["univers-tests"])) {
    erreurs.push(
      `[manifeste] section goldens : univers des tests introuvable (${manifest.goldens["univers-tests"]})`,
    );
  }

  if (existsSync(viewPath)) {
    const vue = readFileSync(viewPath, "utf8");
    if (vue !== renderMarkdown(manifest)) {
      erreurs.push(
        "[vue] docs/migration/withdrawal-inventory.md diffère de la sortie du générateur — lancez pnpm migration:render",
      );
    }
  } else {
    erreurs.push("[vue] docs/migration/withdrawal-inventory.md manquant");
  }

  return { manifest, ledger, universe, testsUniverse, files, erreurs };
}

export function main() {
  const { manifest, ledger, universe, testsUniverse, files, erreurs } =
    runValidation();
  if (erreurs.length > 0) {
    console.error(`✗ manifestes de migration invalides (${erreurs.length}) :`);
    for (const erreur of erreurs) {
      console.error(`  - ${erreur}`);
    }
    process.exit(1);
  }
  console.log(
    `✓ manifeste de retrait : ${manifest.actifs.length} actifs couvrent ${files.length} fichiers suivis`,
  );
  console.log(
    `✓ registre des goldens : ${ledger.entrees.length} invariants couvrent ${universe.sources.length} sources indépendantes`,
  );
  console.log(
    `✓ retraits des tests : ${testsUniverse.sources.length} fichiers Punks figés`,
  );
  if (process.argv.includes("--hashes")) {
    console.log(
      `withdrawal-inventory.yaml version=${manifest.version} sha256=${canonicalSha256(manifest)}`,
    );
    console.log(
      `goldens-ledger.yaml version=${ledger.version} sha256=${canonicalSha256(ledger)}`,
    );
    console.log(
      `goldens-universe.yaml version=${universe.version} sha256=${canonicalSha256(universe)}`,
    );
    console.log(
      `punks-tests-universe.yaml version=${testsUniverse.version} sha256=${canonicalSha256(testsUniverse)}`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
