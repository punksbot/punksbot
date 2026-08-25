/** Garde-fous CLI et écriture create-only de la promotion Punks. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  ecrireEmissionLocale,
  exigerCandidatStable,
  exigerCheckoutPropre,
} from "./check-promotion-dossier.mjs";
import {
  SHA_CANDIDAT,
  dossierValide,
} from "./promotion-dossier-validator-fixture.mjs";

const GIT_REEL = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

function creerShimGit(statutPorcelain) {
  const bin = mkdtempSync(join(tmpdir(), "punks-promotion-bin-"));
  const cheminGit = join(bin, "git");
  writeFileSync(
    cheminGit,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PROMOTION_GIT_APPELS"
if [ "$1" = "status" ] && [ "$2" = "--porcelain" ]; then
  printf '%s' "$PROMOTION_GIT_STATUT"
  exit 0
fi
exec "$PROMOTION_GIT_REEL" "$@"
`,
  );
  chmodSync(cheminGit, 0o755);
  return {
    bin,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PROMOTION_GIT_REEL: GIT_REEL,
      PROMOTION_GIT_STATUT: statutPorcelain,
    },
  };
}

function executerCli(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/check-promotion-dossier.mjs", ...args],
      { cwd: process.cwd(), ...options },
      (erreur, stdout, stderr) =>
        resolve({
          code: erreur?.code ?? 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

test("le garde-fou n'accepte qu'un porcelain strictement vide", () => {
  const appels = [];
  assert.doesNotThrow(() =>
    exigerCheckoutPropre({
      cwd: "/checkout-test",
      executer: (commande, args, options) => {
        appels.push({ commande, args, options });
        return "";
      },
    }),
  );
  assert.deepEqual(appels, [
    {
      commande: "git",
      args: ["status", "--porcelain"],
      options: {
        cwd: "/checkout-test",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
});

test("le garde-fou refuse toute sortie porcelain non vide", () => {
  for (const statut of [
    " M CONTEXT.md\n",
    "M  scripts/check-promotion-dossier.mjs\n",
    "?? docs/research/\n",
    "\n",
  ]) {
    assert.throws(
      () =>
        exigerCheckoutPropre({
          executer: () => statut,
        }),
      /checkout git non propre.*git status --porcelain doit être strictement vide.*SHA HEAD/s,
    );
  }
});

test("le garde-fou échoue fermé si git status ne peut pas être exécuté", () => {
  assert.throws(
    () =>
      exigerCheckoutPropre({
        executer: () => {
          const erreur = new Error("git indisponible");
          erreur.status = 128;
          throw erreur;
        },
      }),
    /impossible de vérifier la propreté.*code 128.*aucune gate/s,
  );
});

test("le candidat reste lié au même HEAD avant et après les gates", () => {
  assert.doesNotThrow(() =>
    exigerCandidatStable({
      shaAvant: SHA_CANDIDAT,
      shaApres: SHA_CANDIDAT,
      shaCandidat: SHA_CANDIDAT,
    }),
  );
  assert.throws(
    () =>
      exigerCandidatStable({
        shaAvant: SHA_CANDIDAT,
        shaApres: "31".repeat(20),
        shaCandidat: SHA_CANDIDAT,
      }),
    /HEAD a changé pendant les gates.*aucune attestation/s,
  );
  assert.throws(
    () =>
      exigerCandidatStable({
        shaAvant: SHA_CANDIDAT,
        shaApres: SHA_CANDIDAT,
        shaCandidat: "31".repeat(20),
      }),
    /SHA du candidat.*SHA testé/s,
  );
});

test("le CLI refuse un checkout sale avant de lire le dossier ou d'exécuter les gates", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-sale-"));
  const appelsGit = join(temp, "appels-git.txt");
  const appelsPnpm = join(temp, "appels-pnpm.txt");
  const shim = creerShimGit(" M CONTEXT.md\n?? docs/research/\n");
  const cheminPnpm = join(shim.bin, "pnpm");
  writeFileSync(
    cheminPnpm,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PROMOTION_PNPM_APPELS"
exit 97
`,
  );
  chmodSync(cheminPnpm, 0o755);

  const { code, stdout, stderr } = await executerCli(
    [join(temp, "dossier-inexistant.json"), "--sortie", temp],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
        PROMOTION_PNPM_APPELS: appelsPnpm,
      },
    },
  );

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /checkout git non propre/);
  assert.match(stderr, /git status --porcelain doit être strictement vide/);
  assert.deepEqual(readFileSync(appelsGit, "utf8").trim().split("\n"), [
    "status --porcelain",
  ]);
  assert.equal(existsSync(appelsPnpm), false, "pnpm ne doit pas être exécuté");
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("--sans-execution ne peut jamais valider, émettre ni écrire", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-sans-execution-"));
  const appelsGit = join(temp, "appels-git.txt");
  const shim = creerShimGit("");
  const { code, stdout, stderr } = await executerCli(
    [
      join(temp, "dossier-inexistant.json"),
      "--sans-execution",
      "--sortie",
      temp,
    ],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
      },
    },
  );

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--sans-execution.*interdit.*aucune émission locale/s);
  assert.equal(
    existsSync(appelsGit),
    false,
    "aucune gate ne doit être consultée",
  );
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("l'émission locale crée atomiquement deux fichiers sans déclarer de publication", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-locale-"));
  const drapeaux = [];
  const resultat = ecrireEmissionLocale(
    {
      sortie,
      tranche: 1,
      attestation: { sha: SHA_CANDIDAT, portee: "locale" },
      recu: { id: "recu-local", sha256: "ab".repeat(32) },
    },
    {
      ouvrir: (chemin, drapeau, mode) => {
        drapeaux.push(drapeau);
        return openSync(chemin, drapeau, mode);
      },
    },
  );

  assert.deepEqual(drapeaux, ["wx", "wx"]);
  const attestation = JSON.parse(readFileSync(resultat.cheminAttestation));
  const recu = JSON.parse(readFileSync(resultat.cheminRecu));
  assert.equal("publiee" in attestation, false);
  assert.equal("publication" in attestation, false);
  assert.equal("publication" in recu, false);
});

test("l'émission locale refuse une destination symbolique", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-symlink-"));
  const cible = join(sortie, "cible.json");
  const cheminAttestation = join(sortie, "attestation-tranche-1.json");
  writeFileSync(cible, "ne-pas-modifier\n");
  symlinkSync(cible, cheminAttestation);

  assert.throws(
    () =>
      ecrireEmissionLocale({
        sortie,
        tranche: 1,
        attestation: { sha: SHA_CANDIDAT },
        recu: { id: "recu-local", sha256: "ab".repeat(32) },
      }),
    /lien symbolique.*create-only/s,
  );
  assert.equal(readFileSync(cible, "utf8"), "ne-pas-modifier\n");
});

test("une course sur le second fichier annule le premier sans écraser le concurrent", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-course-"));
  const cheminAttestation = join(sortie, "attestation-tranche-1.json");
  const cheminRecu = join(sortie, "recu-promotion-1.json");
  let ouvertures = 0;

  assert.throws(
    () =>
      ecrireEmissionLocale(
        {
          sortie,
          tranche: 1,
          attestation: { sha: SHA_CANDIDAT },
          recu: { id: "recu-local", sha256: "ab".repeat(32) },
        },
        {
          ouvrir: (chemin, drapeau, mode) => {
            ouvertures += 1;
            if (ouvertures === 2) {
              writeFileSync(chemin, "contenu-concurrent\n", { flag: "wx" });
            }
            return openSync(chemin, drapeau, mode);
          },
        },
      ),
    /create-only.*EEXIST/s,
  );

  assert.equal(
    existsSync(cheminAttestation),
    false,
    "le premier fichier est annulé",
  );
  assert.equal(readFileSync(cheminRecu, "utf8"), "contenu-concurrent\n");
});

test("l'ancien bypass CLI reste refusé même avec un dossier complet", async () => {
  const dossierIncomplet = dossierValide();
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-"));
  const chemin = join(temp, "dossier.json");
  writeFileSync(chemin, JSON.stringify(dossierIncomplet));
  const appelsGit = join(temp, "appels-git.txt");
  const shim = creerShimGit("");
  const { code, stderr } = await executerCli(
    [chemin, "--sans-execution", "--sortie", temp],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
      },
    },
  );
  assert.equal(code, 1);
  assert.equal(existsSync(appelsGit), false);
  assert.match(stderr, /--sans-execution.*interdit/s);
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("le CLI exige un chemin de dossier", async () => {
  const { code, stderr } = await executerCli([]);
  assert.equal(code, 1);
  assert.match(stderr, /usage :/);
});

test("le CLI refuse les options inconnues et les valeurs manquantes avant toute gate", async () => {
  for (const args of [
    ["dossier.json", "--sortie"],
    ["dossier.json", "--inconnue"],
    ["un.json", "deux.json"],
  ]) {
    const temp = mkdtempSync(join(tmpdir(), "punks-promotion-arguments-"));
    const appelsGit = join(temp, "appels-git.txt");
    const shim = creerShimGit("");
    const { code, stderr } = await executerCli(args, {
      env: { ...shim.env, PROMOTION_GIT_APPELS: appelsGit },
    });

    assert.equal(code, 1);
    assert.match(stderr, /arguments invalides|usage :/);
    assert.equal(existsSync(appelsGit), false);
  }
});
