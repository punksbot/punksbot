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
  const shaRoot = join(evidence, "sha256");
  mkdirSync(candidate);
  mkdirSync(evidence);
  mkdirSync(network);
  mkdirSync(shaRoot);
  const reference = (id) => {
    const subjectDocument = id.startsWith("transcript/")
      ? {
          id,
          authentication: {
            proof: {
              schema: "punks.live-staging-auth-matrix-proof.v3",
              sourceSha,
              stagingDeploymentId,
              flows: Object.fromEntries(
                ["google", "github"].map((method) => [
                  method,
                  {
                    success: { method, environment: "staging" },
                    cancellation: { method, outcomeCode: "cancelled" },
                  },
                ]),
              ),
            },
          },
        }
      : { id, observed: true };
    const subject = Buffer.from(`${JSON.stringify(subjectDocument)}\n`);
    const subjectSha256 = sha256(subject);
    const proof = Buffer.from(
      `${JSON.stringify({
        schema: "punks.promotion-proof.v1",
        id,
        candidateSha: sourceSha,
        stagingDeploymentId,
        result: "vert",
        data: { subjectSha256 },
      })}\n`,
    );
    const proofSha256 = sha256(proof);
    writeFileSync(join(shaRoot, `${subjectSha256}.json`), subject);
    writeFileSync(join(shaRoot, `${proofSha256}.json`), proof);
    return {
      id,
      chemin: `sha256/${proofSha256}.json`,
      sha256: proofSha256,
      sujet: {
        chemin: `sha256/${subjectSha256}.json`,
        sha256: subjectSha256,
      },
    };
  };
  const stories = [
    "connexion",
    "workspace",
    "lecture-live",
    "pagination",
    "publication",
    "reponse",
    "sujet",
    "reactions",
  ];
  const platformIndex = {
    schema: "punks.promotion-evidence-index.v1",
    preuves: PLATEFORMES.flatMap((platform) => [
      reference(`transcript/${platform}`),
      reference(`scan/artefact/${platform}`),
      ...stories.map((story) => reference(`parcours/${platform}/${story}`)),
    ]),
  };
  const recoveryIndex = {
    schema: "punks.promotion-evidence-index.v1",
    preuves: [
      "auth-session",
      "api-workspace",
      "api-conversation",
      "api-message-content",
      "erasure-registry",
    ].map((authority) => reference(`faute/coupure/${authority}`)),
  };
  const platformBytes = Buffer.from(`${JSON.stringify(platformIndex)}\n`);
  const recoveryBytes = Buffer.from(`${JSON.stringify(recoveryIndex)}\n`);
  const stagingBytes = Buffer.from(
    `${JSON.stringify({ sourceSha, stagingDeploymentId })}\n`,
  );
  writeFileSync(join(evidence, "platform-index.json"), platformBytes);
  writeFileSync(join(evidence, "recovery-index.json"), recoveryBytes);
  writeFileSync(join(evidence, "staging-deployment-proof.json"), stagingBytes);
  writeFileSync(join(candidate, "staging-deployment-proof.json"), stagingBytes);
  const networkDigests = new Map();
  for (const platform of PLATEFORMES) {
    const content = Buffer.from(
      `${JSON.stringify({ platform, result: "vert" })}\n`,
    );
    writeFileSync(join(network, `${platform}.json`), content);
    networkDigests.set(platform, sha256(content));
  }
  const aggregate = {
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha,
    stagingDeploymentId,
    repository: "punksbot/punksbot",
    stagingProof: {
      path: "staging-deployment-proof.json",
      sha256: sha256(stagingBytes),
    },
    platforms: PLATEFORMES.map((platform) => ({
      platform,
      target: `target-${platform}`,
      manifestSha256: sha256(platform),
      provenanceSha256: sha256(`provenance-${platform}`),
    })),
    promotionEvidence: {
      platformIndex: {
        path: "promotion-evidence/platform-index.json",
        sha256: sha256(platformBytes),
      },
      stagingProof: {
        path: "promotion-evidence/staging-deployment-proof.json",
        sha256: sha256(stagingBytes),
      },
      network: PLATEFORMES.map((platform) => ({
        platform,
        path: `promotion-evidence/network/${platform}.json`,
        sha256: networkDigests.get(platform),
      })),
      recoveryIndex: {
        path: "promotion-evidence/recovery-index.json",
        sha256: sha256(recoveryBytes),
      },
    },
  };
  writeFileSync(
    join(candidate, "aggregate-manifest.json"),
    `${JSON.stringify(aggregate)}\n`,
  );
  const backendContent = {
    schema: "punks.operational-backend-proof.v2",
    sourceSha,
    stagingDeploymentId,
    origin: "https://staging.punks.bot",
    endpoints: ["/api/health", "/api/auth/v1/session", "/api/v1/punk"].map(
      (path, index) => ({
        path,
        authority: ["api-public", "auth-session", "auth-punk"][index],
        status: index === 0 && failures > 0 ? 503 : 200,
        result: index === 0 && failures > 0 ? "rouge" : "vert",
        responseSha256: sha256(`response-${index}`),
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
  const infrastructureContent = {
    schema: "punks.operational-infrastructure-proof.v1",
    sourceSha,
    stagingDeploymentId,
    accountId: "3a391620584c792dbbd8cfa148d7634a",
    origin: "https://staging.punks.bot",
    queues: [
      "punks-projection-staging",
      "punks-projection-staging-dlq",
      "punks-bot-wake-staging",
      "punks-bot-wake-staging-dlq",
    ].map((name, index) => ({
      name,
      queueId: `queue-${index}`,
      backlogCount: 0,
      backlogBytes: 0,
      oldestMessageTimestampMs: 0,
      result: "vert",
    })),
    authorities: ["api-workspace", "api-conversation"].map((authority) => ({
      authority,
      outboxesPending: 0,
      pendingArchives: 0,
      archiveSegments: 1,
      archiveHeadValid: true,
      result: "vert",
    })),
    locks: ["primaire", "secondaire"].map((role) => ({
      role,
      bucket: role === "primaire" ? "primary" : "recovery",
      prefix: `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/`,
      result: "vert",
    })),
    observedAt: "2026-08-28T10:00:00.500Z",
  };
  const infrastructure = {
    ...infrastructureContent,
    sha256: canonicalSha256(infrastructureContent),
  };
  const infrastructurePath = join(root, "infrastructure.json");
  writeFileSync(backendPath, `${JSON.stringify(backend)}\n`);
  writeFileSync(bundlePath, operationalBudgetSigstoreFixture());
  writeFileSync(infrastructurePath, `${JSON.stringify(infrastructure)}\n`);
  return {
    candidate,
    backendPath,
    bundlePath,
    infrastructurePath,
    output: join(root, "sources"),
  };
}

test("derives exactly 43 provider sources from closed proofs and four attested legs", (t) => {
  const input = fixture(t);
  let verified = 0;
  const result = collectOperationalMetricSources(
    {
      sourceSha,
      stagingDeploymentId,
      candidateRoot: input.candidate,
      backendReport: input.backendPath,
      backendBundle: input.bundlePath,
      infrastructureReport: input.infrastructurePath,
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
  assert.ok(
    documents.every(
      ({ schema, samples }) =>
        schema === "punks.operational-metric-source.v3" &&
        Array.isArray(samples.checks) &&
        samples.checks.length > 0 &&
        samples.failures === undefined &&
        samples.histogram === undefined,
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
  const authDimensions = Object.fromEntries(
    documents
      .filter(
        ({ metric, dimension }) =>
          metric === "connexion-desktop-echecs-par-moyen" && dimension !== null,
      )
      .map((document) => [document.dimension, document.samples.checks]),
  );
  assert.deepEqual(Object.keys(authDimensions).sort(), ["github", "google"]);
  assert.notDeepEqual(
    authDimensions.google.map(({ evidenceSha256 }) => evidenceSha256),
    authDimensions.github.map(({ evidenceSha256 }) => evidenceSha256),
  );
});

test("rejects an impossible provider observation instant", (t) => {
  const input = fixture(t);
  const report = JSON.parse(readFileSync(input.backendPath, "utf8"));
  report.observedAt = "2026-02-30T10:00:00.000Z";
  const { sha256: ignored, ...content } = report;
  assert.match(ignored, /^[0-9a-f]{64}$/u);
  report.sha256 = canonicalSha256(content);
  writeFileSync(input.backendPath, `${JSON.stringify(report)}\n`);
  assert.throws(
    () =>
      collectOperationalMetricSources(
        {
          sourceSha,
          stagingDeploymentId,
          candidateRoot: input.candidate,
          backendReport: input.backendPath,
          backendBundle: input.bundlePath,
          infrastructureReport: input.infrastructurePath,
          output: input.output,
        },
        {
          verifyProviderSubject: () => [{ verified: true }],
          now: () => new Date("2026-08-28T10:00:01.000Z"),
        },
      ),
    /observedAt is invalid|instant is invalid/i,
  );
});

test("scopes a failed backend proof only to related deterministic obligations", (t) => {
  const input = fixture(t, 1);
  collectOperationalMetricSources(
    {
      sourceSha,
      stagingDeploymentId,
      candidateRoot: input.candidate,
      backendReport: input.backendPath,
      backendBundle: input.bundlePath,
      infrastructureReport: input.infrastructurePath,
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
  const durableObjects = documents.find(
    ({ metric, dimension }) =>
      metric === "durable-objects-erreurs-internes" && dimension === null,
  );
  const queues = documents.find(
    ({ metric, dimension }) => metric === "queues-dlq" && dimension === null,
  );
  assert.equal(
    durableObjects.samples.checks.find(({ id }) => id === "backend/api/health")
      .result,
    "rouge",
  );
  assert.ok(queues.samples.checks.every(({ result }) => result === "vert"));
});

test("binds DLQ and outbox coordinates to their dedicated live state", (t) => {
  const input = fixture(t);
  const infrastructure = JSON.parse(
    readFileSync(input.infrastructurePath, "utf8"),
  );
  const dlq = infrastructure.queues.find(
    ({ name }) => name === "punks-bot-wake-staging-dlq",
  );
  dlq.backlogCount = 1;
  dlq.backlogBytes = 64;
  dlq.oldestMessageTimestampMs = 1_787_910_000_000;
  dlq.result = "rouge";
  const { sha256: ignored, ...content } = infrastructure;
  assert.match(ignored, /^[0-9a-f]{64}$/u);
  infrastructure.sha256 = canonicalSha256(content);
  writeFileSync(
    input.infrastructurePath,
    `${JSON.stringify(infrastructure)}\n`,
  );
  collectOperationalMetricSources(
    {
      sourceSha,
      stagingDeploymentId,
      candidateRoot: input.candidate,
      backendReport: input.backendPath,
      backendBundle: input.bundlePath,
      infrastructureReport: input.infrastructurePath,
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
  const queueSource = documents.find(
    ({ metric, dimension }) => metric === "queues-dlq" && dimension === null,
  );
  const outboxSource = documents.find(
    ({ metric, dimension }) =>
      metric === "outboxes-en-attente" && dimension === null,
  );
  assert.equal(
    queueSource.samples.checks.find(({ id }) =>
      id.endsWith("punks-bot-wake-staging-dlq"),
    ).result,
    "rouge",
  );
  assert.ok(
    outboxSource.samples.checks.every(({ result }) => result === "vert"),
  );
});
