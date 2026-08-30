/**
 * Tests du socle et du gate des manifestes de migration (issue #49).
 * Exécution : node --test scripts/check-migration-manifests.test.mjs
 * (aussi via `just migration-check` / `pnpm migration:test`).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  baseMatches,
  canonicalSha256,
  discoverPunksTestSources,
  discoverGoldenSources,
  goldenSourceSetSha256,
  loadYamlDocument,
  parseChemin,
  tranchesCitees,
  validateGoldenUniverse,
  validatePunksTestUniverse,
  validateLedger,
  validateManifest,
  verdictErreur,
} from "./migration-manifest-lib.mjs";

const T1_RETRAITS_ATTENDUS = [];

const T1_ACTIFS_HISTORIQUES = [
  "desktop/src/shared/{deep-link.ts,deep-link.test.mjs,useAppDeepLinks.ts,useEntityDeepLinks.ts,useMessageDeepLinks.ts}",
  "desktop/src/features/onboarding/",
  "desktop/tests/helpers/{seedRelay.ts,seed.ts,onboarding.ts}",
  "desktop/playwright.live.config.ts",
  "test-fixtures/entity-links.json",
  "desktop/src-tauri/src/{deep_link.rs,deep_link_tests.rs}",
  "Justfile (cibles desktop-e2e-integration, desktop-e2e-seed, desktop-e2e-pre-push)",
  "scripts/setup-desktop-test-data.sh",
  ".env.example (VITE_PUNKS_FORCE_FRESH_ONBOARDING)",
  "docs/punks-entity-links.md",
  "punks-desktop/",
].sort();

function manifestMinimal(actifs) {
  return {
    version: 1,
    "checkpoint-recuperation": "50e16de180dda4365f8001a8a73503f16977a175",
    "baseline-punks": "da818eddc2f470c006a1073c8c5452f8a989f272",
    "clients-requis": ["desktop", "web", "mobile", "admin-web"],
    "critere-retrait-global":
      "les quatre clients possèdent un verdict terminal",
    "allowlist-nostr": [
      {
        envelope: "Journal interne Punks",
        portee: "backend cloudflare/ uniquement, jamais un actif client",
      },
      {
        envelope: "Attestation Punks",
        portee: "backend cloudflare/ uniquement, jamais un actif client",
      },
    ],
    actifs,
    goldens: {
      foyer: "goldens/",
      registre: "docs/migration/goldens-ledger.yaml",
      univers: "docs/migration/goldens-universe.yaml",
      "univers-tests": "docs/migration/punks-tests-universe.yaml",
      politique: "une ligne par invariant et par test retiré",
    },
  };
}

function ledgerMinimal(entrees) {
  return {
    version: 1,
    "checkpoint-recuperation": "50e16de180dda4365f8001a8a73503f16977a175",
    "baseline-punks": "da818eddc2f470c006a1073c8c5452f8a989f272",
    "verdicts-fermes": [
      "preuve-punks",
      "difference-intentionnelle",
      "capacite-indisponible",
      "hors-perimetre",
    ],
    "sources-or": ["goldens/*.json"],
    entrees,
    "retraits-par-tranche": {
      politique: "une ligne par test retiré",
      lignes: [],
    },
  };
}

function universeMinimal(sources = ["goldens/g.json"]) {
  return {
    version: 1,
    "checkpoint-recuperation": "50e16de180dda4365f8001a8a73503f16977a175",
    "baseline-punks": "da818eddc2f470c006a1073c8c5452f8a989f272",
    sources,
  };
}

function testsUniverseMinimal(
  sources = ["desktop/tests/e2e/channels.spec.ts"],
) {
  return {
    version: 1,
    "checkpoint-recuperation": "50e16de180dda4365f8001a8a73503f16977a175",
    "baseline-punks": "da818eddc2f470c006a1073c8c5452f8a989f272",
    sources,
  };
}

// Jeux distincts : manifeste (fichiers d’inventaire) et registre (goldens).
const MANIFEST_FILES = ["a/b.ts", "a/c.ts", "web/x.ts"];
const LEDGER_FILES = ["goldens/g.json"];

test("parseChemin : bases exactes, répertoires, jokers, ensembles, qualificatifs", () => {
  assert.deepEqual(parseChemin("a/b.ts").bases, [
    { raw: "a/b.ts", kind: "exact" },
  ]);
  assert.deepEqual(parseChemin("a/b/").bases, [{ raw: "a/b/", kind: "dir" }]);
  assert.deepEqual(parseChemin("a/b*.ts").bases, [
    { raw: "a/b*.ts", kind: "glob" },
  ]);
  assert.deepEqual(parseChemin("a/{b.ts,c/}").bases, [
    { raw: "a/b.ts", kind: "exact" },
    { raw: "a/c/", kind: "dir" },
  ]);
  const qualifie = parseChemin("Justfile (cibles relay)");
  assert.equal(qualifie.qualifier, "cibles relay");
  assert.deepEqual(qualifie.bases, [{ raw: "Justfile", kind: "exact" }]);
  assert.throws(() => parseChemin("Justfile ()"), /qualificatif vide/);
  assert.throws(() => parseChemin("a/{b.ts"), /accolade/);
  assert.throws(() => parseChemin("a/{}/x"), /ensemble vide/);
  assert.throws(() => parseChemin(""), /manquant/);
  // Une parenthèse sans base devant reste un chemin (invalide au validateur),
  // pas un qualificatif.
  assert.deepEqual(parseChemin("(seul)").bases, [
    { raw: "(seul)", kind: "exact" },
  ]);
});

test("baseMatches : le joker ne traverse pas les segments", () => {
  const glob = parseChemin("a/*.ts").bases[0];
  assert.ok(baseMatches(glob, "a/b.ts"));
  assert.ok(!baseMatches(glob, "a/sous/b.ts"));
  const dir = parseChemin("a/").bases[0];
  assert.ok(baseMatches(dir, "a/sous/b.ts"));
  assert.ok(!baseMatches(dir, "ab/b.ts"));
  const exact = parseChemin("a/b.ts").bases[0];
  assert.ok(baseMatches(exact, "a/b.ts"));
  assert.ok(!baseMatches(exact, "a/b.tsx"));
});

test("hash canonique : indépendant de l’ordre des clés, sensible au contenu", () => {
  const a = { x: 1, y: { b: 2, a: [3, { z: 1, y: 2 }] } };
  const b = { y: { a: [3, { y: 2, z: 1 }], b: 2 }, x: 1 };
  assert.equal(canonicalSha256(a), canonicalSha256(b));
  assert.notEqual(canonicalSha256(a), canonicalSha256({ ...a, x: 2 }));
});

test("verdictErreur : vocabulaire fermé et bornes de tranches", () => {
  for (const v of [
    "conserve",
    "scellement",
    "retrait-global",
    "tranche:1",
    "tranche:31",
  ]) {
    assert.equal(verdictErreur(v), null, v);
  }
  for (const v of [
    "tranche:0",
    "tranche:32",
    "tranche:x",
    "peut-être",
    undefined,
  ]) {
    assert.notEqual(verdictErreur(v), null, String(v));
  }
});

test("tranchesCitees : références libres dans les séparations", () => {
  assert.deepEqual(tranchesCitees("a → tranche:12 ; b tranche:31"), [12, 31]);
  assert.deepEqual(tranchesCitees(undefined), []);
});

test("validateManifest : manifeste minimal valide", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  assert.deepEqual(validateManifest(doc, [...MANIFEST_FILES]), []);
});

test("validateManifest : seules les versions de format supportées sont admises", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  doc.version = 2;
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("version non supportée")));
});

test("validateManifest : le checkpoint de récupération ne peut pas remplacer la baseline Punks", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  doc["checkpoint-recuperation"] = "50e16de180dda4365f8001a8a73503f16977a175";
  doc["baseline-punks"] = "50e16de180dda4365f8001a8a73503f16977a175";
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("baseline Punks invalide")));
});

test("validateManifest : doublon de chemin refusé", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "a/", verdict: "scellement" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("doublon")));
});

test("validateManifest : doublon sémantique après expansion refusé", () => {
  const doc = manifestMinimal([
    { chemin: "a/{b.ts,c.ts}", verdict: "tranche:1" },
    { chemin: "a/{c.ts,b.ts}", verdict: "tranche:2" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(
    erreurs.some((e) => e.includes("couvert plusieurs fois en propre")),
  );
});

test("validateManifest : deux qualificatifs distincts sur un même fichier ne sont pas des doublons", () => {
  const doc = manifestMinimal([
    { chemin: "a/b.ts (partie x)", verdict: "tranche:1" },
    { chemin: "a/b.ts (partie y)", verdict: "tranche:2" },
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  assert.deepEqual(validateManifest(doc, [...MANIFEST_FILES]), []);
});

test("validateManifest : les qualificatifs ne possèdent jamais un fichier en propre", () => {
  const doc = manifestMinimal([
    { chemin: "a/b.ts (partie x)", verdict: "tranche:1" },
  ]);
  const erreurs = validateManifest(doc, ["a/b.ts"]);
  assert.ok(erreurs.some((e) => e.startsWith("a/b.ts : omission")));
});

test("validateManifest : un qualificatif vide ne redevient pas propriétaire", () => {
  const doc = manifestMinimal([{ chemin: "a/b.ts ()", verdict: "tranche:1" }]);
  const erreurs = validateManifest(doc, ["a/b.ts"]);
  assert.ok(erreurs.some((e) => e.includes("qualificatif vide")));
  assert.ok(erreurs.some((e) => e.startsWith("a/b.ts : omission")));
});

test("validateManifest : un qualificatif vise exactement un fichier", () => {
  for (const chemin of [
    "a/ (partie x)",
    "a/*.ts (partie x)",
    "a/{b.ts,c.ts} (partie x)",
  ]) {
    const doc = manifestMinimal([{ chemin, verdict: "tranche:1" }]);
    const erreurs = validateManifest(doc, ["a/b.ts", "a/c.ts"]);
    assert.ok(
      erreurs.some((e) =>
        e.includes("qualificatif réservé à un fichier exact"),
      ),
      chemin,
    );
  }
});

test("validateManifest : omission refusée", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  const erreurs = validateManifest(doc, ["a/b.ts", "web/x.ts", "isole.ts"]);
  assert.ok(erreurs.some((e) => e.startsWith("isole.ts : omission")));
});

test("validateManifest : référence invalide refusée", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "fantome/", verdict: "scellement" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("fantome/ : référence invalide")));
});

test("validateManifest : verdict incomplet refusé (conserve sans conservation, conservation orpheline)", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve" },
    { chemin: "web/", verdict: "retrait-global", conservation: "outillage" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("sans conservation typée")));
  assert.ok(erreurs.some((e) => e.includes("réservée au verdict")));
});

test("validateManifest : les références goldens restent dans le dépôt", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  doc.goldens.registre = "../registre-externe.yaml";
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("registre invalide")));
});

test("validateManifest : les invariants terminaux du format canonique sont obligatoires", () => {
  const actifs = [
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "retrait-global" },
  ];
  const mutations = [
    ["clients-requis", (doc) => delete doc["clients-requis"]],
    [
      "critère de retrait global",
      (doc) => {
        doc["critere-retrait-global"] = " ";
      },
    ],
    ["allowlist Nostr", (doc) => doc["allowlist-nostr"].pop()],
    [
      "univers indépendant",
      (doc) => {
        doc.goldens.univers = "docs/migration/autre-univers.yaml";
      },
    ],
    [
      "politique des goldens",
      (doc) => {
        doc.goldens.politique = "";
      },
    ],
  ];

  for (const [attendu, mutate] of mutations) {
    const doc = manifestMinimal(actifs);
    mutate(doc);
    const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
    assert.ok(
      erreurs.some((erreur) => erreur.includes(attendu)),
      `${attendu}: ${erreurs.join(" | ")}`,
    );
  }
});

test("validateManifest : client gelé jamais retiré par avance", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web/", verdict: "tranche:3" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("client gelé « web »")));
});

test("validateManifest : un glob ne contourne pas le gel d’un client", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "web*/*", verdict: "tranche:3" },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("client gelé « web »")));
});

test("validateManifest : separation citant une tranche hors bornes refusée", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    {
      chemin: "web/",
      verdict: "retrait-global",
      separation: "divers → tranche:32",
    },
  ]);
  const erreurs = validateManifest(doc, [...MANIFEST_FILES]);
  assert.ok(erreurs.some((e) => e.includes("tranche:32 hors bornes")));
});

test("validateManifest : la surcharge la plus spécifique gagne sans conflit", () => {
  const doc = manifestMinimal([
    { chemin: "a/", verdict: "conserve", conservation: "outillage" },
    { chemin: "a/b*.ts", verdict: "tranche:1" },
    { chemin: "a/b.ts", verdict: "scellement" },
    { chemin: "web/", verdict: "retrait-global" },
  ]);
  assert.deepEqual(validateManifest(doc, [...MANIFEST_FILES]), []);
});

test("validateManifest : un catch-all desktop ne peut pas classer un module mixte comme UI neutre", () => {
  const doc = manifestMinimal([
    {
      chemin: "desktop/src/",
      verdict: "conserve",
      conservation: "ui-neutre",
    },
  ]);
  const erreurs = validateManifest(doc, ["desktop/src/app/AppShell.tsx"]);
  assert.ok(
    erreurs.some((e) =>
      e.includes("AppShell.tsx : dernier consommateur attendu scellement"),
    ),
  );
});

test("validateManifest : les routes composées restent attribuées à leur dernier consommateur", () => {
  const assignments = [
    ["desktop/src/app/routes/messages.new.tsx", "tranche:12"],
    ["desktop/src/app/routes/index.tsx", "tranche:17"],
    [
      "desktop/src/app/routes/channels.$channelId.posts.$postId.tsx",
      "tranche:11",
    ],
    ["desktop/src/app/routes/workflows.tsx", "tranche:23"],
    ["desktop/src/app/routes/projects.tsx", "tranche:24"],
    ["desktop/src/app/routes/agents.tsx", "tranche:26"],
    ["desktop/src/app/routes/reminders.tsx", "tranche:27"],
    ["desktop/src/app/routes/pulse.tsx", "tranche:30"],
  ];
  const doc = manifestMinimal(
    assignments.map(([chemin, verdict]) => ({
      chemin,
      verdict,
      separation:
        "la partie partagée est scindée avant le dernier consommateur",
    })),
  );
  assert.deepEqual(
    validateManifest(
      doc,
      assignments.map(([chemin]) => chemin),
    ),
    [],
  );

  doc.actifs[2].verdict = "tranche:6";
  const erreurs = validateManifest(
    doc,
    assignments.map(([chemin]) => chemin),
  );
  assert.ok(
    erreurs.some((e) => e.includes("dernier consommateur attendu tranche:11")),
  );
});

test("validateManifest : les shells et routes partagés exigent une frontière de scission", () => {
  const fichiers = [
    ["desktop/src/app/AppShell.tsx", "scellement"],
    ["desktop/src/app/routes/index.tsx", "tranche:17"],
  ];
  const doc = manifestMinimal(
    fichiers.map(([chemin, verdict]) => ({ chemin, verdict })),
  );
  const erreurs = validateManifest(
    doc,
    fichiers.map(([chemin]) => chemin),
  );
  assert.equal(
    erreurs.filter((e) => e.includes("frontière de scission manquante")).length,
    2,
  );
});

test("validateManifest : les modules partagés restent au dernier consommateur et documentent leur scission", () => {
  const assignments = [
    ["desktop/src/features/channels/hooks.ts", "tranche:30"],
    ["desktop/src/features/messages/hooks.ts", "tranche:30"],
    ["desktop/src/features/settings/ui/SettingsPanels.tsx", "tranche:31"],
  ];
  const doc = manifestMinimal(
    assignments.map(([chemin, verdict]) => ({
      chemin,
      verdict,
      separation: "consommateurs antérieurs scindés avant le dernier",
    })),
  );
  assert.deepEqual(
    validateManifest(
      doc,
      assignments.map(([chemin]) => chemin),
    ),
    [],
  );

  doc.actifs[0].verdict = "tranche:12";
  doc.actifs[1].separation = "";
  const erreurs = validateManifest(
    doc,
    assignments.map(([chemin]) => chemin),
  );
  assert.ok(
    erreurs.some((e) => e.includes("dernier consommateur attendu tranche:30")),
  );
  assert.ok(erreurs.some((e) => e.includes("frontière de scission manquante")));
});

test("validateManifest : l’entrée React Punks reste un actif Punks après la scission", () => {
  const fichier = "desktop/src/main.tsx";
  const doc = manifestMinimal([
    {
      chemin: fichier,
      verdict: "conserve",
      conservation: "ui-neutre",
    },
  ]);

  let erreurs = validateManifest(doc, [fichier]);
  assert.ok(erreurs.some((erreur) => erreur.includes("actif Punks attendu")));

  doc.actifs[0] = {
    chemin: fichier,
    verdict: "conserve",
    conservation: "actif-punks",
    separation:
      "l’entrée Punks est extraite avant le retrait du produit précédent",
  };
  assert.deepEqual(validateManifest(doc, [fichier]), []);

  doc.actifs[0].separation = "";
  erreurs = validateManifest(doc, [fichier]);
  assert.ok(erreurs.some((erreur) => erreur.includes("frontière de scission")));
});

test("validateManifest : la sidebar mixte reste au dernier consommateur Pulse", () => {
  const fichiers = [
    "desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx",
    "desktop/src/features/sidebar/ui/SidebarProjectsSection.tsx",
  ];
  const doc = manifestMinimal([
    {
      chemin: "desktop/src/features/sidebar/",
      verdict: "tranche:6",
      separation: "les fragments sont retirés avec leurs consommateurs",
    },
  ]);

  let erreurs = validateManifest(doc, fichiers);
  assert.ok(
    erreurs.some((erreur) =>
      erreur.includes("dernier consommateur attendu tranche:30"),
    ),
  );

  doc.actifs[0].verdict = "tranche:30";
  assert.deepEqual(validateManifest(doc, fichiers), []);

  doc.actifs[0].separation = "";
  erreurs = validateManifest(doc, fichiers);
  assert.ok(erreurs.some((erreur) => erreur.includes("frontière de scission")));
});

test("validateManifest : les entrypoints Tauri mixtes conservent la branche Punks", () => {
  const fichiers = [
    "desktop/src-tauri/src/lib.rs",
    "desktop/src-tauri/src/main.rs",
  ];
  const doc = manifestMinimal([
    {
      chemin: "desktop/src-tauri/src/",
      verdict: "scellement",
      separation: "les branches Punks meurent au scellement",
    },
  ]);

  let erreurs = validateManifest(doc, fichiers);
  for (const fichier of fichiers) {
    assert.ok(
      erreurs.some(
        (erreur) =>
          erreur.startsWith(`${fichier} :`) && erreur.includes("actif Punks"),
      ),
      `${fichier}: ${erreurs.join(" | ")}`,
    );
  }

  doc.actifs.push({
    chemin: "desktop/src-tauri/src/{lib.rs,main.rs}",
    verdict: "conserve",
    conservation: "actif-punks",
    separation: "les branches Punks sont retirées, le dispatcher Punks survit",
  });
  assert.deepEqual(validateManifest(doc, fichiers), []);

  doc.actifs[1].separation = "";
  erreurs = validateManifest(doc, fichiers);
  assert.ok(erreurs.some((erreur) => erreur.includes("frontière de scission")));
});

test("validateManifest : les actifs Punks desktop ne peuvent pas être absorbés par un propriétaire legacy", () => {
  const fichiers = [
    "desktop/src/shared/api/punksFailure.ts",
    "desktop/src/shared/capabilities/availability.ts",
    "desktop/src/app/PunksFullApp.tsx",
    "desktop/src-tauri/src/punks_runtime.rs",
    "desktop/tests/e2e/capability-masking.spec.ts",
  ];
  const doc = manifestMinimal([
    { chemin: "desktop/src/", verdict: "scellement" },
    { chemin: "desktop/src-tauri/src/", verdict: "scellement" },
    {
      chemin: "desktop/tests/",
      verdict: "conserve",
      conservation: "mecanisme-test",
    },
  ]);

  const erreurs = validateManifest(doc, fichiers);
  for (const fichier of fichiers) {
    assert.ok(
      erreurs.some(
        (erreur) =>
          erreur.startsWith(`${fichier} :`) && erreur.includes("actif Punks"),
      ),
      `${fichier}: ${erreurs.join(" | ")}`,
    );
  }
});

test("validateManifest : les harnais Punks desktop restent au scellement après extraction du test Punks", () => {
  const fichiers = [
    "desktop/src/testing/e2eBridge.ts",
    "desktop/tests/e2e/channels.spec.ts",
    "desktop/tests/e2e/capability-masking.spec.ts",
  ];
  const doc = manifestMinimal([
    {
      chemin: "desktop/src/testing/",
      verdict: "scellement",
      separation: "la façade Punks est extraite du pont Punks",
    },
    {
      chemin: "desktop/tests/",
      verdict: "scellement",
      separation: "les scénarios Punks meurent avec leurs dernières capacités",
    },
    {
      chemin: "desktop/tests/e2e/capability-masking.spec.ts",
      verdict: "conserve",
      conservation: "actif-punks",
    },
  ]);

  assert.deepEqual(validateManifest(doc, fichiers), []);
  doc.actifs[1] = {
    chemin: "desktop/tests/",
    verdict: "conserve",
    conservation: "mecanisme-test",
  };
  const erreurs = validateManifest(doc, fichiers);
  assert.ok(
    erreurs.some(
      (erreur) =>
        erreur.includes("channels.spec.ts") &&
        erreur.includes("dernier consommateur attendu scellement"),
    ),
  );
});

test("validateGoldenUniverse : inventaire indépendant, fermé et suivi", () => {
  assert.deepEqual(
    validateGoldenUniverse(universeMinimal(), [...LEDGER_FILES], () => true),
    [],
  );

  const duplicate = universeMinimal(["goldens/g.json", "goldens/g.json"]);
  assert.ok(
    validateGoldenUniverse(duplicate, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("dupliquée"),
    ),
  );

  const absent = universeMinimal(["goldens/absent.json"]);
  assert.ok(
    validateGoldenUniverse(absent, [...LEDGER_FILES], () => false).some((e) =>
      e.includes("source absente"),
    ),
  );
});

test("discoverGoldenSources : la baseline figée définit l’univers indépendamment du registre", () => {
  assert.deepEqual(
    discoverGoldenSources([
      "ordinary/source.ts",
      "tests/fixtures/case.json",
      "tests/golden_transcripts.rs",
      "ui/modelCapabilitiesCorpus.test.mjs",
      "scripts/model-capabilities.json",
    ]),
    [
      "cloudflare/BASELINE.json",
      "scripts/model-capabilities.json",
      "tests/fixtures/case.json",
      "tests/golden_transcripts.rs",
      "ui/modelCapabilitiesCorpus.test.mjs",
    ],
  );
});

test("validateGoldenUniverse : supprimer une source ne réduit pas la sélection de la baseline", () => {
  const universe = universeMinimal(["goldens/g.json"]);
  const erreurs = validateGoldenUniverse(
    universe,
    ["goldens/g.json", "goldens/other.json"],
    () => true,
    ["goldens/g.json", "goldens/other.json"],
  );
  assert.ok(erreurs.some((e) => e.includes("source historique omise")));
});

test("validateGoldenUniverse : une source retirée reste dans l’univers historique", () => {
  assert.deepEqual(
    validateGoldenUniverse(
      universeMinimal(),
      [],
      () => false,
      universeMinimal().sources,
    ),
    [],
  );
});

test("validateGoldenUniverse : l’empreinte indépendante protège les clones sans objet baseline", () => {
  const attendu = goldenSourceSetSha256(["goldens/g.json"]);
  assert.deepEqual(
    validateGoldenUniverse(
      universeMinimal(),
      [],
      () => false,
      undefined,
      attendu,
    ),
    [],
  );
  const erreurs = validateGoldenUniverse(
    universeMinimal(["goldens/other.json"]),
    ["goldens/other.json"],
    () => true,
    undefined,
    attendu,
  );
  assert.ok(erreurs.some((e) => e.includes("empreinte indépendante")));
});

test("validatePunksTestUniverse : sélectionne les tests, pas leurs fixtures", () => {
  const sources = discoverPunksTestSources([
    "desktop/tests/e2e/channels.spec.ts",
    "desktop/tests/helpers/seed.ts",
    "desktop/tests/fixtures/image.png",
    "desktop/src/lib/value.test.mjs",
    "desktop/src-tauri/src/runtime/tests.rs",
    "desktop/src-tauri/src/runtime/tests_follow.rs",
    "crates/example/src/unit_tests.rs",
    "scripts/test-mobile-release-contract.sh",
    "mobile/android/app/src/androidTest/kotlin/AndroidImageProcessorTest.kt",
    "mobile/ios/RunnerTests/RunnerTests.swift",
    "worker/handler_test.go",
    "docs/formal/mutation_test.py",
    "scripts/start-isolated-test-relay.sh",
    "ordinary/source.ts",
  ]);
  assert.deepEqual(sources, [
    "crates/example/src/unit_tests.rs",
    "desktop/src-tauri/src/runtime/tests.rs",
    "desktop/src-tauri/src/runtime/tests_follow.rs",
    "desktop/src/lib/value.test.mjs",
    "desktop/tests/e2e/channels.spec.ts",
    "desktop/tests/helpers/seed.ts",
    "docs/formal/mutation_test.py",
    "mobile/android/app/src/androidTest/kotlin/AndroidImageProcessorTest.kt",
    "mobile/ios/RunnerTests/RunnerTests.swift",
    "scripts/start-isolated-test-relay.sh",
    "scripts/test-mobile-release-contract.sh",
    "worker/handler_test.go",
  ]);
  assert.deepEqual(
    validatePunksTestUniverse(
      testsUniverseMinimal(),
      testsUniverseMinimal().sources,
      goldenSourceSetSha256(testsUniverseMinimal().sources),
    ),
    [],
  );
});

test("validateLedger : registre minimal valide", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "description",
      sources: ["goldens/g.json"],
      verdict: "preuve-punks",
      preuve: ["preuves/p.test.ts"],
    },
  ]);
  assert.deepEqual(
    validateLedger(
      doc,
      [...LEDGER_FILES],
      () => true,
      universeMinimal().sources,
    ),
    [],
  );
});

test("validateLedger : supprimer une source du registre ne réduit jamais l’univers attendu", () => {
  const doc = ledgerMinimal([]);
  const erreurs = validateLedger(
    doc,
    [...LEDGER_FILES],
    () => true,
    universeMinimal().sources,
  );
  assert.ok(erreurs.some((e) => e.includes("golden omis du registre")));
});

test("validateLedger : une ligne de retrait autorise l’absence courante sans perdre le verdict", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.retire",
      invariant: "la preuve historique reste qualifiée",
      sources: ["goldens/g.json"],
      verdict: "difference-intentionnelle",
      decision: "#47 — retrait décidé",
    },
  ]);
  doc["retraits-par-tranche"].lignes = [
    {
      test: "goldens/g.json",
      tranche: "tranche:1",
      verdict: "difference-intentionnelle",
      decision: "#47 — retrait décidé",
    },
  ];
  assert.deepEqual(
    validateLedger(doc, [], () => false, universeMinimal().sources),
    [],
  );
});

test("validateLedger : chaque test Punks retiré exige une ligne et refuse les fantômes", () => {
  const testHistorique = "desktop/tests/e2e/channels.spec.ts";
  const entree = {
    cle: "invariant.a",
    invariant: "description",
    sources: ["goldens/g.json"],
    verdict: "hors-perimetre",
    note: "gelé",
  };
  const sansRetrait = ledgerMinimal([entree]);
  assert.ok(
    validateLedger(
      sansRetrait,
      [...LEDGER_FILES],
      () => true,
      universeMinimal().sources,
      [testHistorique],
    ).some((e) => e.includes("test Punks retiré sans ligne")),
  );

  const avecRetrait = ledgerMinimal([entree]);
  avecRetrait["retraits-par-tranche"].lignes = [
    {
      test: testHistorique,
      tranche: "tranche:1",
      verdict: "hors-perimetre",
      note: "remplacé",
    },
  ];
  assert.deepEqual(
    validateLedger(
      avecRetrait,
      [...LEDGER_FILES],
      () => true,
      universeMinimal().sources,
      [testHistorique],
    ),
    [],
  );

  avecRetrait["retraits-par-tranche"].lignes[0].test =
    "fantome/tests/inexistant.spec.ts";
  const erreurs = validateLedger(
    avecRetrait,
    [...LEDGER_FILES, testHistorique],
    () => true,
    universeMinimal().sources,
    [testHistorique],
  );
  assert.ok(erreurs.some((e) => e.includes("absent des univers baseline")));
});

test("validateLedger : un retrait déclaré doit déjà être absent des fichiers suivis", () => {
  const testHistorique = "desktop/tests/e2e/channels.spec.ts";
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "description",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["retraits-par-tranche"].lignes = [
    {
      test: testHistorique,
      tranche: "tranche:1",
      verdict: "difference-intentionnelle",
      decision: "#47 — retrait décidé",
    },
  ];

  const erreurs = validateLedger(
    doc,
    [...LEDGER_FILES, testHistorique],
    () => true,
    universeMinimal().sources,
    [testHistorique],
  );
  assert.ok(
    erreurs.some(
      (erreur) =>
        erreur.includes(testHistorique) && erreur.includes("encore suivi"),
    ),
  );
});

test("validateLedger : seules les versions de format supportées sont admises", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "description",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc.version = 2;
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("version non supportée")));
});

test("validateLedger : le checkpoint de récupération ne peut pas remplacer la baseline Punks", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "description",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["checkpoint-recuperation"] = "50e16de180dda4365f8001a8a73503f16977a175";
  doc["baseline-punks"] = "50e16de180dda4365f8001a8a73503f16977a175";
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("baseline Punks invalide")));
});

test("validateLedger : doublon de cle refusé", () => {
  const base = {
    cle: "invariant.a",
    invariant: "d",
    sources: ["goldens/g.json"],
    verdict: "preuve-punks",
    preuve: ["preuves/p.test.ts"],
  };
  const doc = ledgerMinimal([base, { ...base, sources: [] }]);
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("doublon")));
});

test("validateLedger : verdict inconnu et verdicts-fermes altérés refusés", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "peut-etre",
    },
  ]);
  doc["verdicts-fermes"] = ["preuve-punks"];
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("verdicts-fermes")));
  assert.ok(erreurs.some((e) => e.includes("verdict inconnu")));
});

test("validateLedger : verdicts-fermes refuse un doublon qui masque une valeur", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["verdicts-fermes"] = [
    "preuve-punks",
    "preuve-punks",
    "difference-intentionnelle",
    "capacite-indisponible",
  ];
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("verdicts-fermes")));
});

test("validateLedger : source absente refusée", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "d",
      sources: ["goldens/absent.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("source non suivie")));
  assert.ok(erreurs.some((e) => e.includes("golden omis")));
});

test("validateLedger : une racine sources-or sans fichier est invalide", () => {
  const doc = ledgerMinimal([
    {
      cle: "invariant.a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["sources-or"] = ["goldens/*.json", "absent/*.json"];
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("racine sans fichier suivi")));
});

test("validateLedger : exigences par verdict", () => {
  const sansPreuve = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "preuve-punks",
    },
  ]);
  assert.ok(
    validateLedger(sansPreuve, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("sans preuve existante"),
    ),
  );
  const preuveAbsente = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "preuve-punks",
      preuve: ["preuves/inconnu.ts"],
    },
  ]);
  assert.ok(
    validateLedger(preuveAbsente, [...LEDGER_FILES], () => false).some((e) =>
      e.includes("sans preuve existante"),
    ),
  );
  const sansDecision = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "difference-intentionnelle",
    },
  ]);
  assert.ok(
    validateLedger(sansDecision, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("sans décision citée"),
    ),
  );
  const sansEcheance = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "capacite-indisponible",
    },
  ]);
  assert.ok(
    validateLedger(sansEcheance, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("sans échéance"),
    ),
  );
  const echeanceHorsBornes = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "capacite-indisponible",
      echeance: "tranche:32",
    },
  ]);
  assert.ok(
    validateLedger(echeanceHorsBornes, [...LEDGER_FILES], () => true).some(
      (e) => e.includes("sans échéance"),
    ),
  );
  const sansNote = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
    },
  ]);
  assert.ok(
    validateLedger(sansNote, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("hors-perimetre sans note"),
    ),
  );
});

test("validateLedger : une preuve doit rester dans le dépôt", () => {
  const doc = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "preuve-punks",
      preuve: ["../preuve-externe.ts"],
    },
  ]);
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("sans preuve existante")));
});

test("validateLedger : double couverture d’un même golden refusée", () => {
  const entree = {
    invariant: "d",
    sources: ["goldens/g.json"],
    verdict: "hors-perimetre",
    note: "gelé",
  };
  const doc = ledgerMinimal([
    { ...entree, cle: "a" },
    { ...entree, cle: "b" },
  ]);
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("couvert par a et b")));
});

test("validateLedger : lignes de retrait par tranche", () => {
  const doc = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["retraits-par-tranche"].lignes = [
    {
      test: "crates/x/tests/a.rs",
      tranche: "tranche:1",
      verdict: "preuve-punks",
      preuve: ["p.ts"],
    },
  ];
  assert.deepEqual(
    validateLedger(doc, [...LEDGER_FILES], () => true),
    [],
  );
  doc["retraits-par-tranche"].lignes.push({
    test: "crates/x/tests/a.rs",
    tranche: "tranche:2",
    verdict: "hors-perimetre",
    note: "x",
  });
  assert.ok(
    validateLedger(doc, [...LEDGER_FILES], () => true).some((e) =>
      e.includes("dupliquée"),
    ),
  );
});

test("validateLedger : une ligne de retrait refuse une tranche hors bornes", () => {
  const doc = ledgerMinimal([
    {
      cle: "a",
      invariant: "d",
      sources: ["goldens/g.json"],
      verdict: "hors-perimetre",
      note: "gelé",
    },
  ]);
  doc["retraits-par-tranche"].lignes = [
    {
      test: "crates/x/tests/a.rs",
      tranche: "tranche:32",
      verdict: "hors-perimetre",
      note: "x",
    },
  ];
  const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
  assert.ok(erreurs.some((e) => e.includes("tranche hors bornes")));
});

test("validateLedger : le chemin d’un test retiré est relatif Git et canonique", () => {
  const entree = {
    cle: "a",
    invariant: "d",
    sources: ["goldens/g.json"],
    verdict: "hors-perimetre",
    note: "gelé",
  };
  for (const testPath of [
    " ",
    "/abs/test.rs",
    "../outside.rs",
    "C:\\outside.rs",
    "./crates/x/tests/a.rs",
    "crates//x/tests/a.rs",
    "crates/x/tests/a.rs/",
  ]) {
    const doc = ledgerMinimal([entree]);
    doc["retraits-par-tranche"].lignes = [
      {
        test: testPath,
        tranche: "tranche:1",
        verdict: "hors-perimetre",
        note: "x",
      },
    ];
    const erreurs = validateLedger(doc, [...LEDGER_FILES], () => true);
    assert.ok(
      erreurs.some((e) => e.includes("chemin de test invalide")),
      testPath,
    );
  }
});

test("validateLedger : les verdicts de retrait incomplets sont refusés", () => {
  const entree = {
    cle: "a",
    invariant: "d",
    sources: ["goldens/g.json"],
    verdict: "hors-perimetre",
    note: "gelé",
  };
  const cas = [
    { verdict: "preuve-punks", preuve: [] },
    { verdict: "difference-intentionnelle", decision: "" },
    { verdict: "capacite-indisponible" },
    { verdict: "hors-perimetre" },
  ];
  for (const [index, ligne] of cas.entries()) {
    const doc = ledgerMinimal([entree]);
    doc["retraits-par-tranche"].lignes = [
      {
        test: `crates/x/tests/${index}.rs`,
        tranche: "tranche:1",
        ...ligne,
      },
    ];
    const erreurs = validateLedger(doc, [...LEDGER_FILES], () => false);
    assert.ok(
      erreurs.some((e) => e.includes("verdict de retrait incomplet")),
      ligne.verdict,
    );
  }
});

test("intégration : la tranche 1 ne conserve aucun actif Punks et prépare ses retraits", () => {
  const manifest = loadYamlDocument(
    fileURLToPath(
      new URL("../docs/migration/withdrawal-inventory.yaml", import.meta.url),
    ),
  );
  const ledger = loadYamlDocument(
    fileURLToPath(
      new URL("../docs/migration/goldens-ledger.yaml", import.meta.url),
    ),
  );

  assert.deepEqual(
    manifest.actifs
      .filter(({ verdict }) => verdict === "tranche:1")
      .map(({ chemin }) => chemin)
      .sort(),
    [],
  );
  assert.deepEqual(
    manifest.actifs
      .filter(({ chemin }) => T1_ACTIFS_HISTORIQUES.includes(chemin))
      .map(({ chemin }) => chemin)
      .sort(),
    [],
  );
  assert.deepEqual(
    ledger["retraits-par-tranche"].lignes
      .filter(({ tranche }) => tranche === "tranche:1")
      .map(({ test: chemin }) => chemin)
      .sort(),
    T1_RETRAITS_ATTENDUS,
  );
  assert.equal(
    ledger.entrees.some(
      ({ verdict, echeance }) =>
        verdict === "capacite-indisponible" && echeance === "tranche:1",
    ),
    false,
  );
  assert.deepEqual(
    manifest.actifs.find(({ chemin }) => chemin === "cloudflare/scripts/"),
    {
      chemin: "cloudflare/scripts/",
      classe: "script",
      verdict: "conserve",
      conservation: "actif-punks",
      note: "gates, staging et preuves Workers gérés, dont l'expansion de la boucle sociale",
    },
  );
});

test("intégration : le gate passe sur le dépôt réel et expose les hash canoniques", () => {
  const script = fileURLToPath(
    new URL("./check-migration-manifests.mjs", import.meta.url),
  );
  const res = spawnSync(process.execPath, [script, "--hashes"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(res.stdout.includes("✓ manifeste de retrait"));
  assert.ok(res.stdout.includes("✓ registre des goldens"));
  assert.match(
    res.stdout,
    /withdrawal-inventory\.yaml version=1 sha256=[0-9a-f]{64}/,
  );
  assert.match(
    res.stdout,
    /goldens-ledger\.yaml version=1 sha256=[0-9a-f]{64}/,
  );
});

test("intégration : le hash canonique est reproductible d’un processus à l’autre", () => {
  const script = fileURLToPath(
    new URL("./check-migration-manifests.mjs", import.meta.url),
  );
  const a = execFileSync(process.execPath, [script, "--hashes"], {
    encoding: "utf8",
  });
  const b = execFileSync(process.execPath, [script, "--hashes"], {
    encoding: "utf8",
  });
  assert.equal(a, b);
});
