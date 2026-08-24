/**
 * Socle partagé de lecture, de hachage canonique et de correspondance des
 * chemins pour les manifestes de migration Punks :
 *
 *   - docs/migration/withdrawal-inventory.yaml  (inventaire de retrait) ;
 *   - docs/migration/goldens-ledger.yaml        (registre des goldens).
 *
 * Utilisé par scripts/check-migration-manifests.mjs (gate),
 * scripts/render-withdrawal-inventory.mjs (vue dérivée) et leurs tests.
 *
 * Syntaxe des chemins acceptée (voir l’en-tête du manifeste) :
 *   - base exacte : `a/b.ts` (fichier) ;
 *   - répertoire : `a/b/` (couvre tout le sous-arbre) ;
 *   - ensembles : `a/{b,c/}` développés en bases distinctes ;
 *   - joker : `*` au sein d’un segment, sans traverser les `/` ;
 *   - qualificatif : `base (partie)` désigne une PARTIE d’un fichier
 *     (cibles Justfile, blocs .env.example, arêtes Cargo.toml) ; il ne
 *     possède jamais un fichier en propre.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const TRANCHES = 31;
export const CHECKPOINT_RECUPERATION =
  "50e16de180dda4365f8001a8a73503f16977a175";
export const BASELINE_BUZZ = "da818eddc2f470c006a1073c8c5452f8a989f272";
export const VERDITS_CONSERVATION = [
  "atelier",
  "ui-neutre",
  "mecanisme-test",
  "golden-neutre",
  "actif-punks",
  "outillage",
  "attente-refonte-ui",
];
const CLIENTS_REQUIS = ["desktop", "web", "mobile", "admin-web"];
export const CLIENTS_GELES = ["web", "mobile", "admin-web"];
const ALLOWLIST_NOSTR = [
  {
    envelope: "Journal interne Punks",
    portee: "backend cloudflare/ uniquement, jamais un actif client",
  },
  {
    envelope: "Attestation Punks",
    portee: "backend cloudflare/ uniquement, jamais un actif client",
  },
];
/** Chemins canoniques des artefacts goldens référencés par le manifeste. */
export const CHEMINS_GOLDENS = {
  foyer: "goldens/",
  registre: "docs/migration/goldens-ledger.yaml",
  univers: "docs/migration/goldens-universe.yaml",
  "univers-tests": "docs/migration/buzz-tests-universe.yaml",
};
export const VERDITS_GOLDENS = [
  "preuve-punks",
  "difference-intentionnelle",
  "capacite-indisponible",
  "hors-perimetre",
];
export const GOLDEN_SOURCES_ADDITIONNELLES = [
  "cloudflare/BASELINE.json",
  "scripts/model-capabilities.json",
];
export const GOLDEN_SOURCE_SET_SHA256 =
  "53f8cc91f3cd17771f94ba6b51972fb4e277ce3615147c54a65d1d2100df6c80";
export const BUZZ_TEST_SOURCE_SET_SHA256 =
  "0a47804d8c40c74c08d619e059d1463fbfcb80bb6864264282c7622e47b52512";

/** Empreinte stable d'un ensemble de chemins, ordre et doublons neutralisés. */
export function goldenSourceSetSha256(sources) {
  return createHash("sha256")
    .update(JSON.stringify([...new Set(sources)].sort()))
    .digest("hex");
}

/**
 * Dérive l'univers historique depuis l'arbre de la baseline, sans lire le
 * registre ni son fichier d'univers. Les noms `fixture`, `golden`, `corpus`
 * et `baseline` sont les foyers figés par #49 ; deux sources associées sont
 * explicites parce que leur nom seul ne porte pas ce vocabulaire.
 */
export function discoverGoldenSources(baselineFiles) {
  return [
    ...baselineFiles.filter((path) =>
      /fixture|golden|corpus|baseline/i.test(path),
    ),
    ...GOLDEN_SOURCES_ADDITIONNELLES,
  ]
    .filter((path, index, sources) => sources.indexOf(path) === index)
    .sort();
}

/** Dérive les fichiers de tests exécutables/helpers, hors données fixtures. */
export function discoverBuzzTestSources(baselineFiles) {
  return baselineFiles
    .filter((path) => {
      const directories = path.split("/").slice(0, -1);
      const tokens = (segment) => segment.toLowerCase().split(/[-_.]/);
      const filename = path.split("/").at(-1) ?? "";
      if (
        directories.some((segment) =>
          tokens(segment).some(
            (token) => token === "fixture" || token === "fixtures",
          ),
        )
      ) {
        return false;
      }
      const inTestDirectory = directories.some(
        (segment) =>
          segment.toLowerCase() === "e2e" ||
          segment.toLowerCase() === "androidtest" ||
          segment.toLowerCase() === "runnertests" ||
          tokens(segment).some(
            (token) =>
              token === "test" || token === "tests" || token === "testing",
          ),
      );
      return (
        inTestDirectory ||
        tokens(filename).some(
          (token) => token === "test" || token === "tests",
        ) ||
        /\.(test|spec)\.[^/]+$/i.test(path) ||
        /(^|\/)tests?(?:_[^/]+)?\.rs$/i.test(path) ||
        /(^|\/)[^/]+_tests?(?:_[^/]+)?\.rs$/i.test(path) ||
        /(^|\/)(test-[^/]+|[^/]+-tests?)[.][^/]+$/i.test(path) ||
        /(^|\/)[^/]+tests?\.(kt|java|swift|m|mm)$/i.test(path) ||
        /(^|\/)[^/]+_test\.go$/i.test(path) ||
        /(^|\/)test_[^/]+\.py$/i.test(path) ||
        /(^|\/)conftest\.py$/i.test(path) ||
        /test(harness|helpers?|support)/i.test(path)
      );
    })
    .sort();
}

/**
 * Modules dont la tranche du dernier consommateur est fixée par l'ordre
 * canonique de l'issue #14. Les garder ici rend la règle vérifiable même si
 * une famille ou un répertoire ancêtre est ajouté au manifeste.
 */
export const DERNIERS_CONSOMMATEURS_DESKTOP = new Map([
  ["desktop/src/main.tsx", "scellement"],
  ["desktop/src/app/App.tsx", "scellement"],
  ["desktop/src/app/AppShell.tsx", "scellement"],
  ["desktop/src/app/routes/root.tsx", "scellement"],
  ["desktop/src/app/routes/messages.new.tsx", "tranche:12"],
  ["desktop/src/app/routes/index.tsx", "tranche:17"],
  ["desktop/src/app/routes/ChannelRouteScreen.tsx", "tranche:11"],
  ["desktop/src/app/routes/channels.$channelId.tsx", "tranche:11"],
  [
    "desktop/src/app/routes/channels.$channelId.posts.$postId.tsx",
    "tranche:11",
  ],
  ["desktop/src/app/routes/WorkflowsRouteScreen.tsx", "tranche:23"],
  ["desktop/src/app/routes/workflows.tsx", "tranche:23"],
  ["desktop/src/app/routes/workflows.$workflowId.tsx", "tranche:23"],
  ["desktop/src/app/routes/projects.tsx", "tranche:24"],
  ["desktop/src/app/routes/projects.$projectId.tsx", "tranche:24"],
  ["desktop/src/app/routes/agents.tsx", "tranche:26"],
  ["desktop/src/app/routes/reminders.tsx", "tranche:27"],
  ["desktop/src/app/routes/pulse.tsx", "tranche:30"],
]);
export const DERNIERS_CONSOMMATEURS_DESKTOP_PAR_PREFIXE = new Map([
  ["desktop/src/features/channels/", "tranche:30"],
  ["desktop/src/features/messages/", "tranche:30"],
  ["desktop/src/features/settings/", "tranche:31"],
  ["desktop/src/features/sidebar/", "tranche:30"],
  ["desktop/src/testing/", "scellement"],
  ["desktop/tests/", "scellement"],
]);
export const SEPARATIONS_DESKTOP_OBLIGATOIRES = new Set([
  "desktop/src/main.tsx",
  "desktop/src/app/App.tsx",
  "desktop/src/app/AppShell.tsx",
  "desktop/src/app/routes/root.tsx",
  "desktop/src/app/routes/index.tsx",
  "desktop/src/app/routes/ChannelRouteScreen.tsx",
  "desktop/src/app/routes/channels.$channelId.tsx",
  "desktop/src/app/routes/channels.$channelId.posts.$postId.tsx",
  "desktop/src-tauri/src/lib.rs",
  "desktop/src-tauri/src/main.rs",
]);

const ACTIFS_PUNKS_DESKTOP = [
  /^desktop\/punks-product\//,
  /^desktop\/scripts\/(?:check-punks-|punks-product-entry)/,
  /^desktop\/src\/features\/punks\//,
  /^desktop\/src\/punks(?:-main\.tsx|\.css)$/,
  /^desktop\/src\/shared\/api\/punks[^/]*$/,
  /^desktop\/src\/shared\/capabilities\//,
  /^desktop\/src-tauri\/capabilities\/punks\.json$/,
  /^desktop\/src-tauri\/crates\/punks-[^/]+\//,
  /^desktop\/src-tauri\/signing\/punks-[^/]+$/,
  /^desktop\/src-tauri\/src\/(?:lib|main)\.rs$/,
  /^desktop\/src-tauri\/src\/punks[^/]*\.rs$/,
  /^desktop\/src-tauri\/tauri\.punks[^/]*\.json$/,
  /^desktop\/(?:tailwind|tsconfig)\.punks\./,
  /^desktop\/tests\/e2e\/capability-masking\.spec\.ts$/,
];

function estActifPunksDesktop(file) {
  return ACTIFS_PUNKS_DESKTOP.some((pattern) => pattern.test(file));
}

function texteNonVide(value) {
  return typeof value === "string" && value.trim() !== "";
}

function listeExacte(value, attendu) {
  return (
    Array.isArray(value) &&
    value.length === attendu.length &&
    value.every((item, index) => item === attendu[index])
  );
}

function allowlistNostrValide(value) {
  return (
    Array.isArray(value) &&
    value.length === ALLOWLIST_NOSTR.length &&
    value.every(
      (item, index) =>
        item?.envelope === ALLOWLIST_NOSTR[index].envelope &&
        item?.portee === ALLOWLIST_NOSTR[index].portee,
    )
  );
}

export function loadYamlDocument(absolutePath) {
  return parse(readFileSync(absolutePath, "utf8"));
}

/** JSON canonique : clés d’objet triées récursivement, tableaux préservés. */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 reproductible du document, cité par les attestations. */
export function canonicalSha256(document) {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

/** Développe les ensembles `{a,b}` (une seule profondeur, membres sans `/`). */
function expandBraces(chemin) {
  const start = chemin.indexOf("{");
  if (start === -1) {
    return [chemin];
  }
  const end = chemin.indexOf("}", start);
  if (end === -1) {
    throw new Error(`accolade non fermée : ${chemin}`);
  }
  const members = chemin
    .slice(start + 1, end)
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (members.length === 0) {
    throw new Error(`ensemble vide : ${chemin}`);
  }
  const prefix = chemin.slice(0, start);
  const suffix = chemin.slice(end + 1);
  return members.flatMap((member) =>
    expandBraces(`${prefix}${member}${suffix}`),
  );
}

/**
 * Analyse un `chemin` d’inventaire en bases exploitables.
 * Retourne { bases: [{ raw, kind: "exact" | "dir" | "glob" }], qualifier? }.
 */
export function parseChemin(chemin) {
  if (typeof chemin !== "string" || chemin.trim() === "") {
    throw new Error("chemin manquant");
  }
  let base = chemin.trim();
  let qualifier;
  const open = base.indexOf(" (");
  if (open !== -1 && base.endsWith(")")) {
    qualifier = base.slice(open + 2, -1).trim();
    if (qualifier.length === 0) {
      throw new Error(`qualificatif vide : ${chemin}`);
    }
    base = base.slice(0, open).trim();
  }
  if (base.length === 0) {
    throw new Error(`chemin sans base : ${chemin}`);
  }
  const bases = expandBraces(base).map((raw) => {
    if (raw.includes("*")) {
      return { raw, kind: "glob" };
    }
    if (raw.endsWith("/")) {
      return { raw, kind: "dir" };
    }
    return { raw, kind: "exact" };
  });
  return { bases, qualifier };
}

function segmentRegex(segment) {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, (c) =>
    c === "*" ? "[^/]*" : `\\${c}`,
  );
}

/** Un fichier suivi est-il couvert par cette base ? */
export function baseMatches(base, file) {
  if (base.kind === "dir") {
    return file.startsWith(base.raw);
  }
  if (base.kind === "exact") {
    return file === base.raw;
  }
  const pattern = new RegExp(
    `^${base.raw.split("/").map(segmentRegex).join("/")}$`,
  );
  return pattern.test(file);
}

const TRANCHE_RE = /^tranche:([0-9]+)$/;

/** Une échéance de registre est toujours une tranche bornée `tranche:N`. */
function echeanceInvalide(echeance) {
  const m = TRANCHE_RE.exec(echeance ?? "");
  if (!m) {
    return true;
  }
  const n = Number.parseInt(m[1], 10);
  return n < 1 || n > TRANCHES;
}

export function verdictErreur(verdict) {
  if (
    verdict === "conserve" ||
    verdict === "scellement" ||
    verdict === "retrait-global"
  ) {
    return null;
  }
  const m = TRANCHE_RE.exec(verdict ?? "");
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= TRANCHES) {
      return null;
    }
    return `tranche hors bornes 1..${TRANCHES}`;
  }
  return "verdict inconnu (attendu tranche:N, scellement, retrait-global ou conserve)";
}

/** Références `tranche:N` citées dans un texte libre (notes, séparations). */
export function tranchesCitees(text) {
  if (typeof text !== "string") {
    return [];
  }
  return [...text.matchAll(/tranche:([0-9]+)/g)].map((m) =>
    Number.parseInt(m[1], 10),
  );
}

function qualifierKey(normalise, qualifier) {
  return qualifier === undefined ? normalise : `${normalise} (${qualifier})`;
}

function cheminRelatifDepot(chemin) {
  return (
    typeof chemin === "string" &&
    chemin.length > 0 &&
    !/^(?:[\\/]|[A-Za-z]:[\\/])/.test(chemin) &&
    !chemin.split(/[\\/]/).includes("..")
  );
}

/** Chemin de fichier tel que Git le produit : relatif, POSIX et normalisé. */
function cheminGitCanonique(chemin) {
  if (
    typeof chemin !== "string" ||
    chemin.length === 0 ||
    chemin !== chemin.trim() ||
    chemin.includes("\\") ||
    chemin.startsWith("/") ||
    /^[A-Za-z]:/.test(chemin) ||
    chemin.endsWith("/")
  ) {
    return false;
  }
  return chemin
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Valide le manifeste de retrait contre la liste des fichiers suivis.
 * Retourne un tableau de messages d’erreur (vide = valide).
 */
export function validateManifest(manifest, trackedFiles) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Number.isInteger(manifest.version)
  ) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (manifest.version !== 1) {
    push(`en-tête invalide : version non supportée ${manifest.version}`);
  }
  if (manifest["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (manifest["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }
  if (!listeExacte(manifest["clients-requis"], CLIENTS_REQUIS)) {
    push(
      `en-tête invalide : clients-requis doit être exactement [${CLIENTS_REQUIS.join(", ")}]`,
    );
  }
  if (!texteNonVide(manifest["critere-retrait-global"])) {
    push("en-tête invalide : critère de retrait global manquant");
  }
  if (!allowlistNostrValide(manifest["allowlist-nostr"])) {
    push(
      "en-tête invalide : allowlist Nostr doit contenir uniquement le Journal interne Punks et l’Attestation Punks côté cloudflare/",
    );
  }
  if (!Array.isArray(manifest.actifs) || manifest.actifs.length === 0) {
    return [...errors, "aucun actif inventorié"];
  }

  const vus = new Map();
  const claims = [];

  manifest.actifs.forEach((entry, index) => {
    const id = `actif #${index + 1}`;
    if (!entry || typeof entry.chemin !== "string") {
      push(`${id} : champ « chemin » manquant`);
      return;
    }
    const verdict = entry.verdict;
    const verdictErr = verdictErreur(verdict);
    if (verdictErr) {
      push(`${entry.chemin} : ${verdictErr}`);
    }
    if (verdict === "conserve") {
      if (!VERDITS_CONSERVATION.includes(entry.conservation)) {
        push(
          `${entry.chemin} : verdict « conserve » sans conservation typée (${VERDITS_CONSERVATION.join(" | ")})`,
        );
      }
    } else if (entry.conservation !== undefined) {
      push(`${entry.chemin} : conservation réservée au verdict « conserve »`);
    }
    for (const n of tranchesCitees(entry.separation ?? "")) {
      if (n < 1 || n > TRANCHES) {
        push(`${entry.chemin} : separation cite tranche:${n} hors bornes`);
      }
    }

    let parsed;
    try {
      parsed = parseChemin(entry.chemin);
    } catch (e) {
      push(`${entry.chemin} : ${e.message}`);
      return;
    }
    if (
      parsed.qualifier !== undefined &&
      (parsed.bases.length !== 1 || parsed.bases[0].kind !== "exact")
    ) {
      push(`${entry.chemin} : qualificatif réservé à un fichier exact`);
    }
    const normalise = parsed.bases.map((b) => b.raw).join("|");
    const cle = qualifierKey(normalise, parsed.qualifier);
    if (vus.has(cle)) {
      push(`${entry.chemin} : doublon de ${vus.get(cle)}`);
    } else {
      vus.set(cle, entry.chemin);
    }

    const matched = new Set();
    for (const base of parsed.bases) {
      for (const file of trackedFiles) {
        if (baseMatches(base, file)) {
          matched.add(file);
        }
      }
    }
    if (matched.size === 0) {
      push(
        `${entry.chemin} : référence invalide — aucun fichier suivi ne correspond`,
      );
      return;
    }
    claims.push({ entry, parsed, matched });

    const clientGele = CLIENTS_GELES.find((client) =>
      [...matched].some((file) => file.startsWith(`${client}/`)),
    );
    if (clientGele && verdict !== "retrait-global") {
      push(
        `${entry.chemin} : client gelé « ${clientGele} » — seul le verdict retrait-global est admis (aucun retrait anticipé)`,
      );
    }
  });

  // Couverture : chaque fichier suivi doit être couvert, et son propriétaire
  // doit être unique. Spécificité : longueur littérale du préfixe (le joker ne
  // compte pas), puis base sans joker à égalité — ainsi une surcharge ciblée
  // (fichier exact ou famille joker) bat toujours le répertoire ancêtre.
  const proprietairesEffectifs = new Map();
  for (const file of trackedFiles) {
    const candidates = claims
      .filter((c) => c.parsed.qualifier === undefined && c.matched.has(file))
      .flatMap((c) =>
        c.parsed.bases
          .filter((b) => baseMatches(b, file))
          .map((b) => ({ base: b, claim: c })),
      );
    if (candidates.length === 0) {
      push(`${file} : omission — aucun actif ne couvre ce fichier`);
      continue;
    }
    const score = (c) => [
      c.base.raw.replace(/\*/g, "").length,
      c.base.kind === "glob" ? 0 : 1,
    ];
    const tupleMax = (a, b) =>
      a[0] !== b[0] ? (a[0] > b[0] ? a : b) : a[1] > b[1] ? a : b;
    const best = candidates.map((c) => score(c)).reduce(tupleMax);
    const owners = candidates.filter((c) => {
      const s = score(c);
      return s[0] === best[0] && s[1] === best[1];
    });
    if (owners.length > 1) {
      const chemins = new Set(owners.map((c) => c.claim.entry.chemin));
      push(
        `${file} : couvert plusieurs fois en propre par ${[...chemins].join(", ")}`,
      );
    } else if (owners.length === 1) {
      proprietairesEffectifs.set(file, owners[0].claim.entry);
    }
  }

  for (const [file, verdictAttendu] of DERNIERS_CONSOMMATEURS_DESKTOP) {
    if (!trackedFiles.includes(file)) {
      continue;
    }
    const proprietaire = proprietairesEffectifs.get(file);
    if (proprietaire?.verdict !== verdictAttendu) {
      push(
        `${file} : dernier consommateur attendu ${verdictAttendu}, reçu ${proprietaire?.verdict ?? "aucun verdict"}`,
      );
    }
  }
  for (const file of SEPARATIONS_DESKTOP_OBLIGATOIRES) {
    if (!trackedFiles.includes(file)) {
      continue;
    }
    const proprietaire = proprietairesEffectifs.get(file);
    if (proprietaire !== undefined && !texteNonVide(proprietaire.separation)) {
      push(
        `${proprietaire.chemin} : frontière de scission manquante pour un module partagé`,
      );
    }
  }
  const separationsVerifiees = new Set();
  for (const file of trackedFiles) {
    if (estActifPunksDesktop(file)) {
      continue;
    }
    const attendu = [...DERNIERS_CONSOMMATEURS_DESKTOP_PAR_PREFIXE].find(
      ([prefixe]) => file.startsWith(prefixe),
    );
    if (attendu === undefined) {
      continue;
    }
    const [, verdictAttendu] = attendu;
    const proprietaire = proprietairesEffectifs.get(file);
    if (proprietaire?.verdict !== verdictAttendu) {
      push(
        `${file} : dernier consommateur attendu ${verdictAttendu}, reçu ${proprietaire?.verdict ?? "aucun verdict"}`,
      );
    }
    if (
      proprietaire !== undefined &&
      !separationsVerifiees.has(proprietaire.chemin) &&
      (typeof proprietaire.separation !== "string" ||
        proprietaire.separation.trim() === "")
    ) {
      separationsVerifiees.add(proprietaire.chemin);
      push(
        `${proprietaire.chemin} : frontière de scission manquante pour un module partagé`,
      );
    }
  }

  for (const file of trackedFiles) {
    if (!estActifPunksDesktop(file)) {
      continue;
    }
    const proprietaire = proprietairesEffectifs.get(file);
    if (
      proprietaire?.verdict !== "conserve" ||
      proprietaire?.conservation !== "actif-punks"
    ) {
      push(
        `${file} : actif Punks attendu conserve/actif-punks, reçu ${proprietaire?.verdict ?? "aucun verdict"}${proprietaire?.conservation ? `/${proprietaire.conservation}` : ""}`,
      );
    }
  }

  if (manifest.goldens) {
    if (manifest.goldens.registre !== CHEMINS_GOLDENS.registre) {
      push("section goldens : registre invalide");
    }
    if (manifest.goldens.foyer !== CHEMINS_GOLDENS.foyer) {
      push("section goldens : foyer invalide");
    }
    if (manifest.goldens.univers !== CHEMINS_GOLDENS.univers) {
      push("section goldens : univers indépendant invalide");
    }
    if (
      manifest.goldens["univers-tests"] !== CHEMINS_GOLDENS["univers-tests"]
    ) {
      push("section goldens : univers des tests Buzz invalide");
    }
    if (!texteNonVide(manifest.goldens.politique)) {
      push("section goldens : politique des goldens manquante");
    }
  } else {
    push("section goldens manquante");
  }

  return errors;
}

/**
 * Valide l'univers figé des sources comportementales de la baseline. Cet
 * artefact est séparé du registre de verdicts afin qu'une suppression dans le
 * registre ne puisse jamais réduire l'ensemble qu'il doit couvrir.
 */
export function validateGoldenUniverse(
  universe,
  trackedFiles,
  fileExists,
  expectedSources,
  expectedSourceSetSha256,
) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  const exists = fileExists ?? (() => false);
  const tracked = new Set(trackedFiles);
  const attendues =
    expectedSources === undefined ? null : new Set(expectedSources);

  if (!universe || !Number.isInteger(universe.version)) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (universe.version !== 1) {
    push(`en-tête invalide : version non supportée ${universe.version}`);
  }
  if (universe["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (universe["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }
  if (!Array.isArray(universe.sources) || universe.sources.length === 0) {
    return [...errors, "sources manquantes dans l'univers des goldens"];
  }

  const vues = new Set();
  for (const source of universe.sources) {
    if (!cheminGitCanonique(source)) {
      push(`source non canonique dans l'univers : ${String(source)}`);
      continue;
    }
    if (vues.has(source)) {
      push(`source dupliquée dans l'univers : ${source}`);
      continue;
    }
    vues.add(source);
    if (
      attendues === null &&
      expectedSourceSetSha256 === undefined &&
      (!tracked.has(source) || !exists(source))
    ) {
      push(`source absente ou non suivie dans l'univers : ${source}`);
    }
  }
  if (attendues !== null) {
    for (const source of attendues) {
      if (!vues.has(source)) {
        push(`source historique omise de l'univers : ${source}`);
      }
    }
    for (const source of vues) {
      if (!attendues.has(source)) {
        push(`source hors sélection historique de la baseline : ${source}`);
      }
    }
  }
  if (
    expectedSourceSetSha256 !== undefined &&
    goldenSourceSetSha256([...vues]) !== expectedSourceSetSha256
  ) {
    push(
      "empreinte indépendante de l'univers historique invalide (baseline absente ou sélection altérée)",
    );
  }
  return errors;
}

/** Valide l'univers exact des fichiers de tests Buzz de la baseline. */
export function validateBuzzTestUniverse(
  universe,
  expectedSources,
  expectedSourceSetSha256,
) {
  const errors = [];
  const push = (message) => errors.push(message);
  if (!universe || !Number.isInteger(universe.version)) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (universe.version !== 1) {
    push(`en-tête invalide : version non supportée ${universe.version}`);
  }
  if (universe["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (universe["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }
  if (!Array.isArray(universe.sources) || universe.sources.length === 0) {
    return [...errors, "sources manquantes dans l'univers des tests Buzz"];
  }
  const sources = new Set();
  for (const source of universe.sources) {
    if (!cheminGitCanonique(source)) {
      push(`source non canonique dans l'univers des tests : ${String(source)}`);
      continue;
    }
    if (sources.has(source)) {
      push(`source dupliquée dans l'univers des tests : ${source}`);
      continue;
    }
    sources.add(source);
  }
  if (expectedSources !== undefined) {
    const attendues = new Set(expectedSources);
    for (const source of attendues) {
      if (!sources.has(source)) {
        push(`test historique omis de l'univers : ${source}`);
      }
    }
    for (const source of sources) {
      if (!attendues.has(source)) {
        push(`test hors sélection historique de la baseline : ${source}`);
      }
    }
  }
  if (
    expectedSourceSetSha256 !== undefined &&
    goldenSourceSetSha256([...sources]) !== expectedSourceSetSha256
  ) {
    push("empreinte indépendante de l'univers des tests Buzz invalide");
  }
  return errors;
}

/**
 * Valide le registre des goldens contre les fichiers suivis.
 * `fileExists` résout les preuves Punks sur disque (chemins hors git admis).
 * Retourne un tableau de messages d’erreur (vide = valide).
 */
export function validateLedger(
  ledger,
  trackedFiles,
  fileExists,
  expectedSources,
  expectedTestSources,
) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  const exists = fileExists ?? (() => false);
  const tracked = new Set(trackedFiles);
  const retraits = ledger?.["retraits-par-tranche"];
  const sourcesRetirees = new Set(
    Array.isArray(retraits?.lignes)
      ? retraits.lignes
          .map((ligne) => ligne?.test)
          .filter((test) => typeof test === "string")
      : [],
  );

  if (!ledger || !Number.isInteger(ledger.version)) {
    return ["en-tête invalide : version entière attendue"];
  }
  if (ledger.version !== 1) {
    push(`en-tête invalide : version non supportée ${ledger.version}`);
  }
  if (ledger["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION) {
    push("en-tête invalide : checkpoint de récupération invalide");
  }
  if (ledger["baseline-buzz"] !== BASELINE_BUZZ) {
    push("en-tête invalide : baseline Buzz invalide");
  }
  const fermes = ledger["verdicts-fermes"];
  const fermesUniques = Array.isArray(fermes) ? new Set(fermes) : new Set();
  if (
    !Array.isArray(fermes) ||
    fermes.length !== VERDITS_GOLDENS.length ||
    fermesUniques.size !== VERDITS_GOLDENS.length ||
    !VERDITS_GOLDENS.every((v) => fermesUniques.has(v))
  ) {
    push(
      `verdicts-fermes doit être exactement [${VERDITS_GOLDENS.join(", ")}]`,
    );
  }
  const racinesSources = [];
  const legacyPatterns = ledger["sources-or"];
  if (
    expectedSources === undefined &&
    (!Array.isArray(legacyPatterns) || legacyPatterns.length === 0)
  ) {
    return [...errors, "sources-or manquant"];
  }
  for (const pattern of expectedSources === undefined
    ? (legacyPatterns ?? [])
    : []) {
    let bases;
    try {
      ({ bases } = parseChemin(pattern));
    } catch (e) {
      push(`sources-or « ${String(pattern)} » invalide : ${e.message}`);
      continue;
    }
    if (!trackedFiles.some((file) => bases.some((b) => baseMatches(b, file)))) {
      push(`sources-or « ${pattern} » : racine sans fichier suivi`);
    }
    racinesSources.push({ pattern, bases });
  }
  const universAttendu =
    expectedSources === undefined ? null : new Set(expectedSources);
  const testsAttendus =
    expectedTestSources === undefined ? null : new Set(expectedTestSources);

  const cles = new Map();
  const couverture = new Map();
  const entrees = Array.isArray(ledger.entrees) ? ledger.entrees : [];
  if (entrees.length === 0) {
    push("aucune entrée : chaque golden historique doit recevoir un verdict");
  }
  for (const [index, entree] of entrees.entries()) {
    const id = `entrée #${index + 1}`;
    if (!entree || typeof entree.cle !== "string" || entree.cle === "") {
      push(`${id} : cle manquante`);
      continue;
    }
    if (cles.has(entree.cle)) {
      push(`${entree.cle} : doublon de ${cles.get(entree.cle)}`);
    } else {
      cles.set(entree.cle, id);
    }
    if (
      typeof entree.invariant !== "string" ||
      entree.invariant.trim() === ""
    ) {
      push(`${entree.cle} : invariant manquant`);
    }
    if (
      !Array.isArray(entree.sources) ||
      entree.sources.length === 0 ||
      entree.sources.some((s) => typeof s !== "string")
    ) {
      push(`${entree.cle} : sources manquantes`);
      continue;
    }
    for (const source of entree.sources) {
      if (!tracked.has(source) && !sourcesRetirees.has(source)) {
        push(`${entree.cle} : source non suivie ou absente : ${source}`);
        continue;
      }
      if (universAttendu && !universAttendu.has(source)) {
        push(`${entree.cle} : source hors univers figé : ${source}`);
        continue;
      }
      const precedent = couverture.get(source);
      if (precedent) {
        push(`${source} : golden couvert par ${precedent} et ${entree.cle}`);
      } else {
        couverture.set(source, entree.cle);
      }
    }
    const verdict = entree.verdict;
    if (!VERDITS_GOLDENS.includes(verdict)) {
      push(
        `${entree.cle} : verdict inconnu « ${verdict} » (attendu ${VERDITS_GOLDENS.join(" | ")})`,
      );
      continue;
    }
    if (verdict === "preuve-punks") {
      if (
        !Array.isArray(entree.preuve) ||
        entree.preuve.length === 0 ||
        entree.preuve.some((p) => !cheminRelatifDepot(p) || !exists(p))
      ) {
        push(`${entree.cle} : verdict preuve-punks sans preuve existante`);
      }
    }
    if (
      verdict === "difference-intentionnelle" &&
      (typeof entree.decision !== "string" || entree.decision.trim() === "")
    ) {
      push(
        `${entree.cle} : verdict difference-intentionnelle sans décision citée`,
      );
    }
    if (verdict === "capacite-indisponible") {
      if (echeanceInvalide(entree.echeance)) {
        push(
          `${entree.cle} : verdict capacite-indisponible sans échéance tranche:N`,
        );
      }
    }
    if (
      verdict === "hors-perimetre" &&
      (typeof entree.note !== "string" || entree.note.trim() === "")
    ) {
      push(`${entree.cle} : verdict hors-perimetre sans note`);
    }
  }

  if (universAttendu) {
    for (const source of universAttendu) {
      if (!couverture.has(source)) {
        push(`${source} : golden omis du registre (univers figé indépendant)`);
      }
    }
  }

  // Omissions : chaque fichier suivi couvert par sources-or doit avoir une ligne.
  for (const { pattern, bases } of racinesSources) {
    for (const file of trackedFiles) {
      if (bases.some((b) => baseMatches(b, file)) && !couverture.has(file)) {
        push(`${file} : golden omis du registre (racine ${pattern})`);
      }
    }
  }

  if (testsAttendus !== null) {
    for (const test of testsAttendus) {
      if (!tracked.has(test) && !sourcesRetirees.has(test)) {
        push(`${test} : test Buzz retiré sans ligne retraits-par-tranche`);
      }
    }
  }

  if (!retraits || typeof retraits.politique !== "string") {
    push("retraits-par-tranche : politique manquante");
  } else if (!Array.isArray(retraits.lignes)) {
    push("retraits-par-tranche : lignes attendues (éventuellement vides)");
  } else {
    const vusRetraits = new Set();
    for (const [index, ligne] of retraits.lignes.entries()) {
      const id = `retrait #${index + 1}`;
      if (!ligne || typeof ligne.test !== "string" || ligne.test === "") {
        push(`${id} : test manquant`);
        continue;
      }
      if (!cheminGitCanonique(ligne.test)) {
        push(`${id} : chemin de test invalide « ${ligne.test} »`);
        continue;
      }
      if (tracked.has(ligne.test)) {
        push(`${ligne.test} : retrait déclaré mais fichier encore suivi`);
      }
      if (
        testsAttendus !== null &&
        !testsAttendus.has(ligne.test) &&
        !(universAttendu?.has(ligne.test) ?? false)
      ) {
        push(`${ligne.test} : retrait absent des univers baseline`);
      }
      if (echeanceInvalide(ligne.tranche)) {
        push(`${ligne.test} : tranche hors bornes (attendu tranche:1..31)`);
        continue;
      }
      if (vusRetraits.has(ligne.test)) {
        push(
          `${ligne.test} : ligne de retrait dupliquée (une seule tranche admise)`,
        );
      }
      vusRetraits.add(ligne.test);
      if (!VERDITS_GOLDENS.includes(ligne.verdict)) {
        push(`${ligne.test} : verdict de retrait inconnu`);
      }
      if (
        ligne.verdict === "preuve-punks" &&
        (!Array.isArray(ligne.preuve) ||
          ligne.preuve.length === 0 ||
          ligne.preuve.some(
            (preuve) => !cheminRelatifDepot(preuve) || !exists(preuve),
          ))
      ) {
        push(
          `${ligne.test} : verdict de retrait incomplet — preuve-punks exige des preuves existantes`,
        );
      }
      if (
        ligne.verdict === "difference-intentionnelle" &&
        (typeof ligne.decision !== "string" || ligne.decision.trim() === "")
      ) {
        push(
          `${ligne.test} : verdict de retrait incomplet — difference-intentionnelle exige une décision`,
        );
      }
      if (
        ligne.verdict === "capacite-indisponible" &&
        echeanceInvalide(ligne.echeance)
      ) {
        push(
          `${ligne.test} : verdict de retrait incomplet — capacite-indisponible exige une échéance tranche:N`,
        );
      }
      if (
        ligne.verdict === "hors-perimetre" &&
        (typeof ligne.note !== "string" || ligne.note.trim() === "")
      ) {
        push(
          `${ligne.test} : verdict de retrait incomplet — hors-perimetre exige une note`,
        );
      }
    }
  }

  return errors;
}
