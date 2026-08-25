import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPromotionDossierCli } from "./promotion-dossier-cli.mjs";

function argumentsValides(racine) {
  return [
    "--racine-preuves",
    racine,
    "--index-preuves",
    join(racine, "index.json"),
    "--candidat-sha",
    "a".repeat(40),
    "--promotion-profile",
    join(racine, "promotion-profiles.json"),
    "--staging-deployment-proof",
    join(racine, "staging.json"),
    "--provenance-bundle",
    join(racine, "bundle.json"),
    "--repository",
    "punksbot/punksbot",
    "--source-ref",
    "refs/heads/staging",
    "--signer-workflow",
    "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
    "--sortie",
    join(racine, "dossier.json"),
  ];
}

function executerCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/candidate/promotion-dossier.mjs", ...args],
      { cwd: process.cwd() },
      (erreur, stdout, stderr) =>
        resolve({
          code: erreur?.code ?? 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

test("la CLI refuse tout vérificateur de provenance substituable", async (t) => {
  const racine = mkdtempSync(join(tmpdir(), "punks-dossier-cli-bypass-"));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  const args = [...argumentsValides(racine), "--gh-binary", "/tmp/faux-gh"];
  let assembleurAppelee = false;

  assert.throws(
    () =>
      runPromotionDossierCli(args, () => {
        assembleurAppelee = true;
        return { preuve: "forgee" };
      }),
    /option inconnue --gh-binary/,
  );
  assert.equal(assembleurAppelee, false);
  assert.equal(existsSync(join(racine, "dossier.json")), false);

  const processus = await executerCli(args);
  assert.equal(processus.code, 1);
  assert.equal(processus.stdout, "");
  assert.match(processus.stderr, /option inconnue --gh-binary/);
  assert.equal(existsSync(join(racine, "dossier.json")), false);
});

test("la CLI applique une allowlist exacte avant l'assembleur", (t) => {
  const racine = mkdtempSync(join(tmpdir(), "punks-dossier-cli-options-"));
  t.after(() => rmSync(racine, { recursive: true, force: true }));
  let assembleurAppelee = false;

  assert.throws(
    () =>
      runPromotionDossierCli(
        [...argumentsValides(racine), "--inconnue", "valeur"],
        () => {
          assembleurAppelee = true;
          return { preuve: "forgee" };
        },
      ),
    /option inconnue --inconnue/,
  );
  assert.equal(assembleurAppelee, false);
});
