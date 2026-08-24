import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { validerDossier } from "../promotion-dossier-lib.mjs";
import { assemblerDossierPromotion } from "./promotion-dossier.mjs";

const SHA_CANDIDAT = "a".repeat(40);
const DEPLOIEMENT = `sha256:${"b".repeat(64)}`;
const DIGESTS_PRODUCTION = {
  bundle: "c".repeat(64),
  manifeste: "d".repeat(64),
};
const PLATEFORMES = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];
const VERIFICATIONS = [
  "signature",
  "identite-application",
  "protocol-handlers",
  "stockage-securise",
  "updater",
];
const ACCESSIBILITE = [
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
];
const GATES = [
  "corpus-conformite",
  "suites-workers",
  "cloudflare-check",
  "playwright-facade",
  "tauri-staging",
  "accessibilite",
  "fautes-injectees",
  "retrait-diff",
  "goldens-verdict",
  "scans-negatifs",
];

function sha256(contenu) {
  return createHash("sha256").update(contenu).digest("hex");
}

function creerJeuDePreuves() {
  const racine = mkdtempSync(join(tmpdir(), "punks-promotion-dossier-"));
  const references = [];
  const parId = new Map();

  const ajouter = (id, data = {}, surcharges = {}) => {
    const preuve = {
      schema: "punks.promotion-proof.v1",
      id,
      candidateSha: SHA_CANDIDAT,
      stagingDeploymentId: DEPLOIEMENT,
      result: "vert",
      data,
      ...surcharges,
    };
    const contenu = `${JSON.stringify(preuve)}\n`;
    const empreinte = sha256(contenu);
    const chemin = join(
      "sha256",
      `${empreinte}-${id.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`,
    );
    const absolu = join(racine, chemin);
    mkdirSync(dirname(absolu), { recursive: true });
    writeFileSync(absolu, contenu, { flag: "wx" });
    const reference = { id, chemin, sha256: empreinte };
    references.push(reference);
    parId.set(id, { absolu, preuve, reference });
    return reference;
  };

  ajouter("candidat", { tranche: 1 });
  ajouter("registres", {
    registres: [
      ["registre-contrats", "1"],
      ["profil", "2"],
      ["registre-goldens", "3"],
      ["manifeste-retrait", "4"],
    ].map(([nom, octet]) => ({
      nom,
      version: 1,
      sha256: octet.repeat(64),
    })),
  });
  ajouter("staging/materiau", {
    environnement: "staging",
    compte: "1".repeat(32),
    zone: "2".repeat(32),
    deploiement: DEPLOIEMENT,
    materiau: "cloudflare/staging.resources.json",
    subjectSha256: "5".repeat(64),
  });
  ajouter("production/bundle", {
    subjectSha256: DIGESTS_PRODUCTION.bundle,
  });
  ajouter("production/manifeste", {
    subjectSha256: DIGESTS_PRODUCTION.manifeste,
  });

  const bundles = new Map();
  for (const plateforme of PLATEFORMES) {
    ajouter(
      `artefact/${plateforme}/bundle`,
      {
        nom: `punks-${plateforme}`,
        bundleId: "bot.punks.desktop",
        subjectSha256: sha256(`bundle:${plateforme}`),
      },
      { plateforme },
    );
    bundles.set(plateforme, sha256(`bundle:${plateforme}`));
    ajouter(
      `artefact/${plateforme}/signature`,
      { subjectSha256: sha256(`signature:${plateforme}`) },
      { plateforme },
    );
    for (const verification of VERIFICATIONS) {
      ajouter(
        `artefact/${plateforme}/verification/${verification}`,
        {},
        { plateforme },
      );
    }
    ajouter(
      `parcours/${plateforme}/boucle-sociale`,
      {
        sha256Artefact: bundles.get(plateforme),
        via: ["ui", "ipc-rust", "contrats-publics"],
        contour: "distribue",
        serveurVite: false,
        facadeTest: false,
      },
      { plateforme },
    );
    for (const critere of ACCESSIBILITE) {
      ajouter(`accessibilite/${plateforme}/${critere}`, {}, { plateforme });
    }
    ajouter(`accessibilite/${plateforme}/resultat`, {}, { plateforme });
  }

  ["coupure", "revocation", "perte-autorite"].forEach((type, index) => {
    ajouter(
      `faute/${type}`,
      { autorite: "workers", plateforme: PLATEFORMES[index] },
      { plateforme: PLATEFORMES[index] },
    );
  });
  ajouter("recuperation/roll-forward");
  ajouter("recuperation/rpo-logique-nul");
  ajouter("recuperation/captures");

  const testGolden = "desktop/tests/e2e/social-loop.spec.ts";
  ajouter(`golden/${testGolden}`, {
    test: testGolden,
    verdict: "preuve-punks",
  });
  ajouter("retrait/diff", {
    lignes: [testGolden],
    verdictsExecutes: 1,
  });
  ajouter("retrait/verdicts");

  for (const cible of ["sources", "dependances", "artefact", "reseau"]) {
    ajouter(`scan/${cible}`);
  }
  for (const gate of GATES) {
    ajouter(`gate/${gate}`);
  }

  const index = join(racine, "index.json");
  writeFileSync(
    index,
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: references,
    })}\n`,
    { flag: "wx" },
  );
  return { racine, index, parId, references, bundles };
}

function assembler(fixture, surcharges = {}) {
  return assemblerDossierPromotion({
    racinePreuves: fixture.racine,
    indexPreuves: fixture.index,
    candidatSha: SHA_CANDIDAT,
    deploiementId: DEPLOIEMENT,
    ...surcharges,
  });
}

function reecrireIndex(fixture) {
  writeFileSync(
    fixture.index,
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: fixture.references,
    })}\n`,
  );
}

function remplacerPreuve(fixture, id, modifier) {
  const entree = fixture.parId.get(id);
  const preuve = JSON.parse(readFileSync(entree.absolu, "utf8"));
  modifier(preuve);
  const contenu = `${JSON.stringify(preuve)}\n`;
  const empreinte = sha256(contenu);
  const chemin = join(
    "sha256",
    `${empreinte}-${id.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`,
  );
  const absolu = join(fixture.racine, chemin);
  writeFileSync(absolu, contenu, { flag: "wx" });
  unlinkSync(entree.absolu);
  Object.assign(entree.reference, { chemin, sha256: empreinte });
  Object.assign(entree, { absolu, preuve });
  reecrireIndex(fixture);
}

test("assemble un dossier complet uniquement depuis les preuves réelles", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));

  const dossier = assembler(fixture);

  assert.equal(dossier.candidat.sha, SHA_CANDIDAT);
  assert.equal(dossier.liaison.staging.deploiement, DEPLOIEMENT);
  assert.deepEqual(dossier.liaison["digests-production"], DIGESTS_PRODUCTION);
  assert.deepEqual(
    dossier.liaison.artefacts.map(({ plateforme }) => plateforme),
    PLATEFORMES,
  );
  assert.deepEqual(
    validerDossier(dossier, { racinePreuves: fixture.racine }),
    [],
  );
  assert.equal(
    dossier.gates["cloudflare-check"].resultat,
    JSON.parse(
      readFileSync(fixture.parId.get("gate/cloudflare-check").absolu, "utf8"),
    ).result,
  );
});

test("refuse une preuve obligatoire omise", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  fixture.references.splice(
    fixture.references.findIndex(({ id }) => id === "gate/cloudflare-check"),
    1,
  );
  reecrireIndex(fixture);

  assert.throws(
    () => assembler(fixture),
    /preuve obligatoire absente.*cloudflare-check/,
  );
});

test("refuse le contenu altéré après son adressage", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  writeFileSync(
    fixture.parId.get("scan/reseau").absolu,
    '{"result":"vert","tampered":true}\n',
  );

  assert.throws(
    () => assembler(fixture),
    /scan\/reseau.*altérée.*hash recalculé/,
  );
});

test("refuse une preuve proprement re-hashée mais liée au mauvais SHA", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  remplacerPreuve(fixture, "parcours/windows-x64/boucle-sociale", (preuve) => {
    preuve.candidateSha = "c".repeat(40);
  });

  assert.throws(() => assembler(fixture), /mauvais SHA candidat/);
});

test("refuse une preuve liée à un autre déploiement staging", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  remplacerPreuve(fixture, "staging/materiau", (preuve) => {
    preuve.stagingDeploymentId = `sha256:${"d".repeat(64)}`;
  });

  assert.throws(() => assembler(fixture), /mauvais déploiement staging/);
});

test("refuse les identifiants, chemins et contenus dupliqués", (t) => {
  for (const doublon of ["id", "chemin", "sha256"]) {
    const fixture = creerJeuDePreuves();
    t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
    const premiere = fixture.references[0];
    const seconde = fixture.references[1];
    if (doublon === "id") seconde.id = premiere.id;
    if (doublon === "chemin") seconde.chemin = premiere.chemin;
    if (doublon === "sha256") seconde.sha256 = premiere.sha256;
    reecrireIndex(fixture);

    assert.throws(() => assembler(fixture), /dupliqué/, doublon);
  }
});

test("refuse les liens symboliques et les chemins hors racine", (t) => {
  const fixtureLien = creerJeuDePreuves();
  t.after(() => rmSync(fixtureLien.racine, { recursive: true, force: true }));
  const entree = fixtureLien.parId.get("gate/tauri-staging");
  const cible = `${entree.absolu}.cible`;
  renameSync(entree.absolu, cible);
  symlinkSync(cible, entree.absolu);
  assert.throws(() => assembler(fixtureLien), /lien symbolique/);

  const fixtureSortie = creerJeuDePreuves();
  t.after(() => rmSync(fixtureSortie.racine, { recursive: true, force: true }));
  fixtureSortie.references[0].chemin = "../preuve-externe.json";
  reecrireIndex(fixtureSortie);
  assert.throws(() => assembler(fixtureSortie), /hors racine/);
});

test("refuse un index qui traverse un répertoire symbolique", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const repertoireReel = join(fixture.racine, "index-reel");
  const repertoireLien = join(fixture.racine, "index-lien");
  mkdirSync(repertoireReel);
  const indexReel = join(repertoireReel, "index.json");
  renameSync(fixture.index, indexReel);
  symlinkSync(repertoireReel, repertoireLien);

  assert.throws(
    () =>
      assembler(fixture, {
        indexPreuves: join(repertoireLien, "index.json"),
      }),
    /index.*lien symbolique/,
  );
});

test("refuse toute valeur non verte et toute plateforme divergente", (t) => {
  const fixtureRouge = creerJeuDePreuves();
  t.after(() => rmSync(fixtureRouge.racine, { recursive: true, force: true }));
  remplacerPreuve(fixtureRouge, "accessibilite/linux-x64/focus", (preuve) => {
    preuve.result = "rouge";
  });
  assert.throws(() => assembler(fixtureRouge), /absente ou non verte/);

  const fixturePlateforme = creerJeuDePreuves();
  t.after(() =>
    rmSync(fixturePlateforme.racine, { recursive: true, force: true }),
  );
  remplacerPreuve(
    fixturePlateforme,
    "artefact/macos-arm64/signature",
    (preuve) => {
      preuve.plateforme = "macos-x64";
    },
  );
  assert.throws(
    () => assembler(fixturePlateforme),
    /plateforme macos-x64.*macos-arm64/,
  );
});
