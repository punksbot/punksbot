import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { computeLiveHashes } from "./check-release-graph.mjs";
import {
  canonicalSha256,
  loadYamlDocument,
} from "./migration-manifest-lib.mjs";
import { repoRoot } from "./render-withdrawal-inventory.mjs";

function fichiersSuivis() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

test("les hashes live couvrent les deux registres documentaires du graphe", () => {
  const { hashes } = computeLiveHashes(fichiersSuivis());
  const registreGoldens = loadYamlDocument(
    join(repoRoot, "docs/migration/goldens-ledger.yaml"),
  );
  const manifesteRetrait = loadYamlDocument(
    join(repoRoot, "docs/migration/withdrawal-inventory.yaml"),
  );
  const staging = JSON.parse(
    readFileSync(join(repoRoot, "cloudflare/staging.resources.json"), "utf8"),
  );

  assert.equal(hashes["registre-goldens"], canonicalSha256(registreGoldens));
  assert.equal(hashes["manifeste-retrait"], canonicalSha256(manifesteRetrait));
  assert.equal(hashes.staging, canonicalSha256(staging));
});
