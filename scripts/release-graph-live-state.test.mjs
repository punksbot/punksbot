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

test("la documentation R2 ne contredit pas le matériau staging versionné", () => {
  const staging = JSON.parse(
    readFileSync(join(repoRoot, "cloudflare/staging.resources.json"), "utf8"),
  );
  const documents = [
    readFileSync(join(repoRoot, "cloudflare/PARITY.md"), "utf8"),
    readFileSync(join(repoRoot, "cloudflare/README.md"), "utf8"),
    readFileSync(join(repoRoot, "cloudflare/ARCHITECTURE.md"), "utf8"),
    readFileSync(join(repoRoot, "cloudflare/OPERATIONS.md"), "utf8"),
  ];

  if (staging.r2?.accountStatus === "enabled") {
    for (const document of documents) {
      assert.doesNotMatch(
        document,
        /R2 is not enabled|R2 n['’]est pas activé/u,
      );
    }
  }
  if (
    [staging.r2?.erasure, staging.r2?.journal, staging.r2?.media].every(
      (bucket) => bucket?.status === "provisioned",
    )
  ) {
    for (const document of documents) {
      assert.doesNotMatch(document, /no bucket is provisioned/u);
    }
  }
});

test("les documents Bot pointent vers l’observation historique canonique", () => {
  const operations = readFileSync(
    join(repoRoot, "cloudflare/OPERATIONS.md"),
    "utf8",
  );
  const markers = [
    ...operations.matchAll(/<!-- punks-staging-observation (\{[^\n]+\}) -->/gu),
  ];
  assert.equal(markers.length, 1);
  const observation = JSON.parse(markers[0][1]);
  assert.deepEqual(Object.keys(observation).sort(), [
    "kind",
    "observedAt",
    "sourceSha",
  ]);
  assert.equal(observation.kind, "bot-runtime-history");
  assert.match(observation.observedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.match(observation.sourceSha, /^[0-9a-f]{40}$/u);
  assert.match(
    operations.replace(markers[0][0], ""),
    new RegExp(observation.sourceSha, "u"),
  );
  assert.match(operations, /does not prove the current candidate/u);
  assert.match(operations, /no Workers AI inference is claimed/u);
  for (const relativePath of [
    "cloudflare/PARITY.md",
    "cloudflare/README.md",
    "cloudflare/ARCHITECTURE.md",
    "docs/adr/0058-executer-un-tour-bot-par-wake-opaque.md",
  ]) {
    const document = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.match(document, /OPERATIONS\.md/u, relativePath);
    assert.doesNotMatch(
      document,
      new RegExp(observation.sourceSha, "u"),
      relativePath,
    );
  }
});
