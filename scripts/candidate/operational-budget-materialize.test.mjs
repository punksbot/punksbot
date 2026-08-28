import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { BUDGETS_PRODUCTION, PLATEFORMES } from "../release-graph-lib.mjs";
import {
  materializeOperationalBudgetEvidence,
  publishOperationalBudgetEvidence,
} from "./operational-budget-materialize.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const observedAt = "2026-08-28T08:00:00.000Z";
const prefix = `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/`;

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dimensions(metric) {
  if (metric === "connexion-desktop-echecs-par-moyen") {
    return ["google", "github"];
  }
  if (metric === "desktop-sessions-avec-crash-par-plateforme") {
    return PLATEFORMES;
  }
  return [];
}

function samples(unit, count = 1_000_000) {
  if (unit === "pourcentage") return { failures: 0, total: count };
  if (unit === "occurrences") return { occurrences: 0, total: count };
  return { histogram: [{ value: 1, count }] };
}

function writeSources(root, { count = 1_000_000 } = {}) {
  mkdirSync(root);
  const writeSource = (metric, dimension, unit, observer) => {
    const source = {
      schema: "punks.operational-metric-source.v2",
      sourceSha,
      stagingDeploymentId,
      metric,
      dimension,
      unit,
      observer,
      querySha256: canonicalSha256({ metric, dimension, observedAt }),
      observedAt,
      samples: samples(unit, count),
    };
    const content = bytes(source);
    writeFileSync(join(root, `${sha256(content)}.json`), content, {
      flag: "wx",
    });
  };
  for (const budget of BUDGETS_PRODUCTION) {
    writeSource(budget.nom, null, budget.unite, "cloudflare-analytics");
    for (const dimension of dimensions(budget.nom)) {
      writeSource(
        budget.nom,
        dimension,
        budget.unite,
        "github-attested-installed-candidate",
      );
    }
  }
  writeSource(
    "outboxes-en-attente",
    null,
    "occurrences",
    "cloudflare-analytics",
  );
}

function fixture(t, options) {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sources = join(root, "sources");
  const output = join(root, "output");
  writeSources(sources, options);
  return { root, sources, output };
}

test("materializes the closed provider set into recomputed green evidence", (t) => {
  const input = fixture(t);
  const result = materializeOperationalBudgetEvidence({
    sourceSha,
    stagingDeploymentId,
    sources: input.sources,
    output: input.output,
  });

  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
  const manifestBytes = readFileSync(join(input.output, "manifest.json"));
  assert.equal(sha256(manifestBytes), result.manifestSha256);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, "punks.operational-budget-r2-manifest.v3");
  assert.equal(manifest.sources.length, 43);
  assert.equal(manifest.exports.length, 43);
  assert.equal(
    readdirSync(join(input.output, "sources")).length,
    manifest.sources.length,
  );
  assert.equal(
    readdirSync(join(input.output, "exports")).length,
    manifest.exports.length,
  );
  const observation = JSON.parse(
    readFileSync(join(input.output, "observation.json")),
  );
  assert.equal(observation.verdicts.length, BUDGETS_PRODUCTION.length);
  assert.ok(observation.verdicts.every(({ resultat }) => resultat === "vert"));
  assert.deepEqual(observation.connectionMethods, ["google", "github"]);
});

test("refuses statistically insufficient percentage sources without output", (t) => {
  const input = fixture(t, { count: 1 });
  assert.throws(
    () =>
      materializeOperationalBudgetEvidence({
        sourceSha,
        stagingDeploymentId,
        sources: input.sources,
        output: input.output,
      }),
    /not green|insufficient|budget/i,
  );
  assert.throws(() => readFileSync(join(input.output, "manifest.json")));
});

test("refuses an extra or non-content-addressed provider source", (t) => {
  const extra = fixture(t);
  writeFileSync(join(extra.sources, "extra.json"), "{}\n");
  assert.throws(
    () =>
      materializeOperationalBudgetEvidence({
        sourceSha,
        stagingDeploymentId,
        sources: extra.sources,
        output: extra.output,
      }),
    /content-addressed|unexpected|provider/i,
  );

  const renamed = fixture(t);
  const first = readdirSync(renamed.sources)[0];
  const content = readFileSync(join(renamed.sources, first));
  rmSync(join(renamed.sources, first));
  const wrongPrefix = first.startsWith("0") ? "1" : "0";
  writeFileSync(
    join(renamed.sources, `${wrongPrefix}${first.slice(1)}`),
    content,
  );
  assert.throws(
    () =>
      materializeOperationalBudgetEvidence({
        sourceSha,
        stagingDeploymentId,
        sources: renamed.sources,
        output: renamed.output,
      }),
    /content-addressed/i,
  );
});

test("publishes every byte redundantly under lock and makes the manifest visible last", async (t) => {
  const input = fixture(t);
  const materialized = materializeOperationalBudgetEvidence({
    sourceSha,
    stagingDeploymentId,
    sources: input.sources,
    output: input.output,
  });
  const objects = new Map();
  const writes = [];
  const frontieres = {
    cloudflare: {
      async lireVerrouillage({ cle }) {
        return { mode: "compliance", actif: cle === prefix };
      },
      async lireObjet({ role, cle }) {
        return objects.get(`${role}:${cle}`) ?? null;
      },
      async creerObjet({ role, cle, contenu }) {
        const coordinate = `${role}:${cle}`;
        if (objects.has(coordinate)) {
          const error = new Error("exists");
          error.code = "ALREADY_EXISTS";
          throw error;
        }
        writes.push({ role, key: cle });
        objects.set(coordinate, Buffer.from(contenu));
      },
    },
  };
  const destinations = [
    { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
    { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
  ];

  const published = await publishOperationalBudgetEvidence(
    {
      sourceSha,
      stagingDeploymentId,
      manifestSha256: materialized.manifestSha256,
      root: input.output,
      destinations,
    },
    { frontieres },
  );

  assert.equal(published.manifestSha256, materialized.manifestSha256);
  for (const role of ["primaire", "secondaire"]) {
    const roleWrites = writes.filter((write) => write.role === role);
    assert.equal(basename(roleWrites.at(-1).key), "manifest.json");
    assert.equal(roleWrites.length, 88);
  }
  assert.equal(
    writes.findIndex(({ key }) => basename(key) === "manifest.json"),
    writes.length - 2,
  );
});

test("refuses a divergent existing object before publishing any missing byte", async (t) => {
  const input = fixture(t);
  const materialized = materializeOperationalBudgetEvidence({
    sourceSha,
    stagingDeploymentId,
    sources: input.sources,
    output: input.output,
  });
  const manifest = JSON.parse(
    readFileSync(join(input.output, "manifest.json")),
  );
  const existing = new Map([
    [`primaire:${manifest.sources[0].key}`, Buffer.from("divergent\n")],
  ]);
  let writes = 0;
  const frontieres = {
    cloudflare: {
      async lireVerrouillage() {
        return { mode: "compliance", actif: true };
      },
      async lireObjet({ role, cle }) {
        return existing.get(`${role}:${cle}`) ?? null;
      },
      async creerObjet() {
        writes += 1;
      },
    },
  };

  await assert.rejects(
    publishOperationalBudgetEvidence(
      {
        sourceSha,
        stagingDeploymentId,
        manifestSha256: materialized.manifestSha256,
        root: input.output,
        destinations: [
          { role: "primaire", compte: "1".repeat(32), bucket: "primary" },
          { role: "secondaire", compte: "2".repeat(32), bucket: "recovery" },
        ],
      },
      { frontieres },
    ),
    /diverges/i,
  );
  assert.equal(writes, 0);
});
