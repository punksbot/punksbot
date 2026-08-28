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
import { join } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { BUDGETS_PRODUCTION, PLATEFORMES } from "../release-graph-lib.mjs";
import { operationalBudgetSigstoreFixture } from "./operational-budget-test-fixture.mjs";
import { collectOperationalMetricSources } from "./operational-source-collect.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(t, failures = 0) {
  const root = mkdtempSync(join(tmpdir(), "punks-operational-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = join(root, "candidate");
  const evidence = join(candidate, "promotion-evidence");
  const network = join(evidence, "network");
  mkdirSync(candidate);
  mkdirSync(evidence);
  mkdirSync(network);
  const aggregate = {
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha,
    stagingDeploymentId,
    repository: "punksbot/punksbot",
    platforms: PLATEFORMES.map((platform) => ({
      platform,
      target: `target-${platform}`,
      manifestSha256: sha256(platform),
      provenanceSha256: sha256(`provenance-${platform}`),
    })),
    promotionEvidence: {
      network: PLATEFORMES.map((platform) => ({
        platform,
        path: `promotion-evidence/network/${platform}.json`,
        sha256: sha256(`${platform}\n`),
      })),
      recoveryIndex: {
        path: "promotion-evidence/recovery-index.json",
        sha256: sha256("recovery\n"),
      },
    },
  };
  writeFileSync(
    join(candidate, "aggregate-manifest.json"),
    `${JSON.stringify(aggregate)}\n`,
  );
  for (const platform of PLATEFORMES) {
    writeFileSync(join(network, `${platform}.json`), `${platform}\n`);
  }
  writeFileSync(join(evidence, "recovery-index.json"), "recovery\n");
  writeFileSync(join(evidence, "platform-index.json"), "platforms\n");

  const backendContent = {
    schema: "punks.operational-backend-probe.v1",
    sourceSha,
    stagingDeploymentId,
    origin: "https://staging.punks.bot",
    endpoints: ["/api/health", "/api/auth/v1/session", "/api/v1/punk"].map(
      (path, index) => ({
        path,
        authority: ["api-public", "auth-session", "auth-punk"][index],
        total: 10_000,
        failures: index === 0 ? failures : 0,
        histogram: [{ value: index + 1, count: 10_000 }],
      }),
    ),
    observedAt: "2026-08-28T10:00:00.000Z",
  };
  const backend = {
    ...backendContent,
    sha256: canonicalSha256(backendContent),
  };
  const backendPath = join(root, "backend.json");
  const bundlePath = join(root, "backend.sigstore.json");
  writeFileSync(backendPath, `${JSON.stringify(backend)}\n`);
  writeFileSync(bundlePath, operationalBudgetSigstoreFixture());
  return {
    candidate,
    backendPath,
    bundlePath,
    output: join(root, "sources"),
  };
}

test("derives exactly 43 provider sources from remote probes and four attested legs", (t) => {
  const input = fixture(t);
  let verified = 0;
  const result = collectOperationalMetricSources(
    {
      sourceSha,
      stagingDeploymentId,
      candidateRoot: input.candidate,
      backendReport: input.backendPath,
      backendBundle: input.bundlePath,
      output: input.output,
    },
    {
      verifyProviderSubject(args) {
        verified += 1;
        assert.equal(args.sourceSha, sourceSha);
        return [{ verified: true }];
      },
      now: () => new Date("2026-08-28T10:00:01.000Z"),
    },
  );
  assert.equal(verified, 1);
  assert.equal(result.sources, 43);
  const documents = readdirSync(input.output).map((name) =>
    JSON.parse(readFileSync(join(input.output, name), "utf8")),
  );
  assert.equal(documents.length, 43);
  assert.deepEqual(
    [...new Set(documents.map(({ metric }) => metric))].sort(),
    [...BUDGETS_PRODUCTION.map(({ nom }) => nom), "outboxes-en-attente"].sort(),
  );
  assert.ok(
    documents.every(
      (document) =>
        document.sourceSha === sourceSha &&
        document.stagingDeploymentId === stagingDeploymentId &&
        document.observer === "github-attested-installed-candidate",
    ),
  );
  assert.deepEqual(
    documents
      .filter(
        ({ metric, dimension }) =>
          metric === "desktop-sessions-avec-crash-par-plateforme" &&
          dimension !== null,
      )
      .map(({ dimension }) => dimension)
      .sort(),
    [...PLATEFORMES].sort(),
  );
});

test("carries a real failed backend probe into every zero-tolerance source", (t) => {
  const input = fixture(t, 1);
  collectOperationalMetricSources(
    {
      sourceSha,
      stagingDeploymentId,
      candidateRoot: input.candidate,
      backendReport: input.backendPath,
      backendBundle: input.bundlePath,
      output: input.output,
    },
    {
      verifyProviderSubject: () => [{ verified: true }],
      now: () => new Date("2026-08-28T10:00:01.000Z"),
    },
  );
  const documents = readdirSync(input.output).map((name) =>
    JSON.parse(readFileSync(join(input.output, name), "utf8")),
  );
  assert.ok(
    documents
      .filter(({ unit }) => unit === "occurrences")
      .every(({ samples }) => samples.occurrences === 1),
  );
});
