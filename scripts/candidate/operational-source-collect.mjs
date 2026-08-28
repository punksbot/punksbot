import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateSigstoreBundleContent,
  verifyGithubSubject,
} from "../github-attestation-lib.mjs";
import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { BUDGETS_PRODUCTION, PLATEFORMES } from "../release-graph-lib.mjs";
import { OPERATIONAL_BUDGET_PROVENANCE } from "./operational-budget-evidence.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const BACKEND_PATHS = ["/api/health", "/api/auth/v1/session", "/api/v1/punk"];
const CONNECTION_METHODS = ["google", "github"];
const MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1_000;

function fail(message) {
  throw new Error(`operational source collection rejected: ${message}`);
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function json(path, label) {
  try {
    return JSON.parse(readStableEvidenceFile(path, label).toString("utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("operational source collection rejected:")
    ) {
      throw error;
    }
    fail(`${label} is invalid JSON`);
  }
}

function verifyReference(root, reference, label) {
  exact(reference, ["path", "sha256"], label);
  if (
    typeof reference.path !== "string" ||
    reference.path.startsWith("/") ||
    reference.path.includes("\\") ||
    reference.path.split("/").some((part) => ["", ".", ".."].includes(part)) ||
    !SHA256_RE.test(reference.sha256 ?? "")
  ) {
    fail(`${label} is invalid`);
  }
  const path = resolve(root, reference.path);
  const contained = relative(resolve(root), path);
  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`)
  ) {
    fail(`${label} escapes the candidate`);
  }
  const content = readStableEvidenceFile(path, label);
  if (sha256(content) !== reference.sha256) fail(`${label} digest diverges`);
  return content;
}

function validateCandidate(root, sourceSha, stagingDeploymentId) {
  const aggregate = json(
    join(root, "aggregate-manifest.json"),
    "candidate aggregate manifest",
  );
  if (
    aggregate.schema !== "punks.desktop-candidate-aggregate.v1" ||
    aggregate.sourceSha !== sourceSha ||
    aggregate.stagingDeploymentId !== stagingDeploymentId ||
    aggregate.repository !== "punksbot/punksbot" ||
    !Array.isArray(aggregate.platforms) ||
    JSON.stringify(aggregate.platforms.map(({ platform }) => platform)) !==
      JSON.stringify(PLATEFORMES) ||
    !Array.isArray(aggregate.promotionEvidence?.network) ||
    JSON.stringify(
      aggregate.promotionEvidence.network.map(({ platform }) => platform),
    ) !== JSON.stringify(PLATEFORMES) ||
    aggregate.promotionEvidence.recoveryIndex === undefined
  ) {
    fail("exact four-platform candidate aggregate is required");
  }
  for (const [
    index,
    reference,
  ] of aggregate.promotionEvidence.network.entries()) {
    verifyReference(
      root,
      { path: reference.path, sha256: reference.sha256 },
      `platform network evidence ${index}`,
    );
  }
  verifyReference(
    root,
    aggregate.promotionEvidence.recoveryIndex,
    "candidate recovery evidence",
  );
  const evidenceRoot = resolve(root, "promotion-evidence");
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      const status = lstatSync(path);
      if (status.isSymbolicLink())
        fail("candidate evidence contains a symlink");
      if (status.isDirectory()) {
        walk(path);
      } else if (status.isFile() && entry.name.endsWith(".json")) {
        const content = readStableEvidenceFile(path, "candidate JSON evidence");
        files.push({
          path: relative(root, path).split(sep).join("/"),
          sha256: sha256(content),
        });
      }
    }
  };
  walk(evidenceRoot);
  if (files.length < 6) fail("candidate evidence corpus is incomplete");
  return canonicalSha256({
    aggregateSha256: sha256(
      readStableEvidenceFile(
        join(root, "aggregate-manifest.json"),
        "candidate aggregate manifest",
      ),
    ),
    files,
  });
}

function validateBackendReport(report, expected) {
  exact(
    report,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "origin",
      "endpoints",
      "observedAt",
      "sha256",
    ],
    "backend probe report",
  );
  const { sha256: digest, ...content } = report;
  if (
    report.schema !== "punks.operational-backend-probe.v1" ||
    report.sourceSha !== expected.sourceSha ||
    report.stagingDeploymentId !== expected.stagingDeploymentId ||
    report.origin !== "https://staging.punks.bot" ||
    digest !== canonicalSha256(content) ||
    !Array.isArray(report.endpoints) ||
    JSON.stringify(report.endpoints.map(({ path }) => path)) !==
      JSON.stringify(BACKEND_PATHS) ||
    typeof report.observedAt !== "string" ||
    !Number.isFinite(Date.parse(report.observedAt))
  ) {
    fail("backend probe report identity is invalid");
  }
  for (const [index, endpoint] of report.endpoints.entries()) {
    exact(
      endpoint,
      ["path", "authority", "total", "failures", "histogram"],
      `backend endpoint ${index}`,
    );
    if (
      !Number.isSafeInteger(endpoint.total) ||
      endpoint.total < 10_000 ||
      !Number.isSafeInteger(endpoint.failures) ||
      endpoint.failures < 0 ||
      endpoint.failures > endpoint.total ||
      !Array.isArray(endpoint.histogram) ||
      endpoint.histogram.length === 0
    ) {
      fail(`backend endpoint ${index} samples are invalid`);
    }
    let count = 0;
    for (const [bucketIndex, bucket] of endpoint.histogram.entries()) {
      exact(bucket, ["value", "count"], `backend histogram ${index}`);
      if (
        !Number.isFinite(bucket.value) ||
        bucket.value < 0 ||
        !Number.isSafeInteger(bucket.count) ||
        bucket.count < 1 ||
        (bucketIndex > 0 &&
          bucket.value <= endpoint.histogram[bucketIndex - 1].value)
      ) {
        fail(`backend histogram ${index} is invalid`);
      }
      count += bucket.count;
      if (!Number.isSafeInteger(count))
        fail("backend histogram count is unsafe");
    }
    if (count !== endpoint.total)
      fail(`backend endpoint ${index} count diverges`);
  }
  return report;
}

function combinedHistogram(endpoints) {
  const values = new Map();
  for (const endpoint of endpoints) {
    for (const bucket of endpoint.histogram) {
      values.set(bucket.value, (values.get(bucket.value) ?? 0) + bucket.count);
    }
  }
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, count]) => ({ value, count }));
}

function dimensions(metric) {
  if (metric === "connexion-desktop-echecs-par-moyen") {
    return CONNECTION_METHODS;
  }
  if (metric === "desktop-sessions-avec-crash-par-plateforme") {
    return PLATEFORMES;
  }
  return [];
}

/** Builds sources only from a provider-attested live report and exact legs. */
export function collectOperationalMetricSources(
  input,
  { verifyProviderSubject = verifyGithubSubject, now = () => new Date() } = {},
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    typeof verifyProviderSubject !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and provider verification are required");
  }
  const candidateRoot = resolve(input.candidateRoot);
  const corpusSha256 = validateCandidate(
    candidateRoot,
    input.sourceSha,
    input.stagingDeploymentId,
  );
  const reportContent = readStableEvidenceFile(
    input.backendReport,
    "backend probe report",
  );
  const report = validateBackendReport(
    JSON.parse(reportContent.toString("utf8")),
    input,
  );
  const bundleContent = readStableEvidenceFile(
    input.backendBundle,
    "backend probe provider bundle",
  );
  validateSigstoreBundleContent(bundleContent);
  const verification = verifyProviderSubject({
    artifact: resolve(input.backendReport),
    artifactContent: reportContent,
    bundle: resolve(input.backendBundle),
    bundleContent,
    repository: OPERATIONAL_BUDGET_PROVENANCE.repository,
    sourceSha: input.sourceSha,
    sourceRef: OPERATIONAL_BUDGET_PROVENANCE.sourceRef,
    signerWorkflow: OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow,
  });
  if (!Array.isArray(verification) || verification.length === 0) {
    fail("backend probe provider verification is empty");
  }
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("provider observation clock is invalid");
  }
  const reportTime = Date.parse(report.observedAt);
  if (
    reportTime > observedAt.getTime() ||
    observedAt.getTime() - reportTime > MAX_REPORT_AGE_MS
  ) {
    fail("backend probe report is stale or future-dated");
  }
  const total = report.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.total,
    0,
  );
  const failures = report.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.failures,
    0,
  );
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(failures)) {
    fail("backend aggregate counts are unsafe");
  }
  const latencyHistogram = combinedHistogram(report.endpoints);
  const output = resolve(input.output);
  let outputCreated = false;
  try {
    mkdirSync(output, { mode: 0o700 });
    outputCreated = true;
    let count = 0;
    const writeSource = (metric, dimension, unit) => {
      const samples =
        unit === "pourcentage"
          ? { failures, total }
          : unit === "occurrences"
            ? { occurrences: failures, total }
            : { histogram: latencyHistogram };
      const document = {
        schema: "punks.operational-metric-source.v2",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        metric,
        dimension,
        unit,
        observer: "github-attested-installed-candidate",
        querySha256: canonicalSha256({
          schema: "punks.operational-provider-query.v1",
          corpusSha256,
          backendReportSha256: report.sha256,
          metric,
          dimension,
          endpoints: BACKEND_PATHS,
        }),
        observedAt: observedAt.toISOString(),
        samples,
      };
      const content = Buffer.from(`${JSON.stringify(document)}\n`);
      const digest = sha256(content);
      writeFileSync(join(output, `${digest}.json`), content, {
        flag: "wx",
        mode: 0o600,
      });
      count += 1;
    };
    for (const budget of BUDGETS_PRODUCTION) {
      writeSource(budget.nom, null, budget.unite);
      for (const dimension of dimensions(budget.nom)) {
        writeSource(budget.nom, dimension, budget.unite);
      }
    }
    writeSource("outboxes-en-attente", null, "occurrences");
    if (count !== 43) fail("provider source count diverges");
    return { sources: count, corpusSha256, backendReportSha256: report.sha256 };
  } catch (error) {
    if (outputCreated) rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--candidate-root",
    "--backend-report",
    "--backend-bundle",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag)) {
      fail("exact CLI arguments are required");
    }
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (flag) => values.get(flag);
}

export function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  return collectOperationalMetricSources({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    candidateRoot: required("--candidate-root"),
    backendReport: required("--backend-report"),
    backendBundle: required("--backend-bundle"),
    output: required("--output"),
  });
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${JSON.stringify(run())}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
