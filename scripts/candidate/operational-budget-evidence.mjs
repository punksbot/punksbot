import { lstatSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import {
  validateSigstoreBundleContent,
  verifyGithubSubject,
} from "../github-attestation-lib.mjs";
import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
} from "../release-graph-lib.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/u;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MAX_PROVIDER_OBSERVATION_AGE_MS = 24 * 60 * 60 * 1_000;
const MIN_LATENCY_SAMPLE_COUNT = 10_000;
/** Exact GitHub OIDC identity allowed to authenticate operational samples. */
export const OPERATIONAL_BUDGET_PROVENANCE = Object.freeze({
  repository: "punksbot/punksbot",
  sourceRef: "refs/heads/staging",
  signerWorkflow:
    "github.com/punksbot/punksbot/.github/workflows/punks-operational-observation.yml",
});
const PROVENANCE_DESCRIPTOR = "operational-budget-provenance.json";
const PROVENANCE_DIRECTORY = "operational-budget-provenance";

function fail(message) {
  throw new Error(`operational budget evidence rejected: ${message}`);
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

function instant(value, label) {
  if (typeof value !== "string" || !INSTANT_RE.test(value)) {
    fail(`${label} is not a closed UTC instant`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    fail(`${label} is invalid`);
  }
  return milliseconds;
}

function stableJson(path, label) {
  try {
    return JSON.parse(
      readStableEvidenceFile(path, label, { minimum: 2 }).toString("utf8"),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("operational budget evidence rejected:")
    ) {
      throw error;
    }
    fail(`${label} is invalid JSON`);
  }
}

function stableBytes(path, label, maximum = 64 * 1024 * 1024) {
  return readStableEvidenceFile(path, label, { minimum: 2, maximum });
}

function providerProvenance(candidateRoot, expected) {
  const descriptor = stableJson(
    resolve(candidateRoot, PROVENANCE_DESCRIPTOR),
    "operational budget provenance descriptor",
  );
  exact(
    descriptor,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "repository",
      "sourceRef",
      "signerWorkflow",
      "bundle",
    ],
    "operational budget provenance descriptor",
  );
  exact(
    descriptor.bundle,
    ["path", "sha256"],
    "operational budget provenance bundle",
  );
  if (
    descriptor.schema !== "punks.operational-budget-provenance.v1" ||
    descriptor.sourceSha !== expected.sourceSha ||
    descriptor.stagingDeploymentId !== expected.stagingDeploymentId ||
    descriptor.repository !== OPERATIONAL_BUDGET_PROVENANCE.repository ||
    descriptor.sourceRef !== OPERATIONAL_BUDGET_PROVENANCE.sourceRef ||
    descriptor.signerWorkflow !==
      OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow ||
    !SHA256_RE.test(descriptor.bundle.sha256 ?? "") ||
    descriptor.bundle.path !==
      `${PROVENANCE_DIRECTORY}/${descriptor.bundle.sha256}.sigstore.json`
  ) {
    fail("operational budget provenance identity is invalid");
  }
  const bundlePath = resolve(candidateRoot, descriptor.bundle.path);
  const bundleContent = stableBytes(
    bundlePath,
    "operational budget Sigstore bundle",
  );
  if (
    createHash("sha256").update(bundleContent).digest("hex") !==
    descriptor.bundle.sha256
  ) {
    fail("operational budget Sigstore bundle digest diverges");
  }
  try {
    validateSigstoreBundleContent(bundleContent);
  } catch (error) {
    fail(
      `operational budget Sigstore bundle is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    ...descriptor,
    bundlePath,
    bundleContent,
    verifiedSourceFiles: new Set(),
  };
}

function verifiedProvenance(
  source,
  candidateRoot,
  expected,
  provider,
  verifyProviderSubject,
) {
  if (
    source.path.startsWith("/") ||
    source.path.includes("\\") ||
    source.path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`${expected.metric} provenance path is invalid`);
  }
  const root = resolve(candidateRoot);
  const path = resolve(root, source.path);
  const contained = relative(root, path);
  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`) ||
    isAbsolute(contained)
  ) {
    fail(`${expected.metric} provenance escapes the candidate`);
  }
  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isFile() || status.size < 1) {
    fail(`${expected.metric} provenance is not a regular candidate file`);
  }
  const content = stableBytes(path, `${expected.metric} provenance`);
  const digest = createHash("sha256").update(content).digest("hex");
  if (digest !== source.sha256) {
    fail(`${expected.metric} provenance digest diverges`);
  }
  if (
    !source.path.startsWith("operational-budget-sources/") ||
    basename(source.path) !== `${source.sha256}.json`
  ) {
    fail(`${expected.metric} provenance is not content-addressed`);
  }
  let document;
  try {
    document = JSON.parse(content.toString("utf8"));
  } catch {
    fail(`${expected.metric} provenance is invalid JSON`);
  }
  exact(
    document,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "metric",
      "dimension",
      "unit",
      "observer",
      "querySha256",
      "observedAt",
      "samples",
    ],
    `${expected.metric} provenance`,
  );
  if (
    document.schema !== "punks.operational-metric-source.v2" ||
    document.sourceSha !== expected.sourceSha ||
    document.stagingDeploymentId !== expected.stagingDeploymentId ||
    document.metric !== expected.metric ||
    document.dimension !== expected.dimension ||
    document.unit !== expected.unit ||
    !["cloudflare-analytics", "github-attested-installed-candidate"].includes(
      document.observer,
    ) ||
    !SHA256_RE.test(document.querySha256 ?? "") ||
    !Number.isFinite(
      instant(document.observedAt, `${expected.metric} observedAt`),
    )
  ) {
    fail(`${expected.metric} provenance identity is invalid`);
  }
  let verification;
  try {
    verification = verifyProviderSubject({
      artifact: path,
      artifactContent: content,
      bundle: provider.bundlePath,
      bundleContent: provider.bundleContent,
      repository: provider.repository,
      sourceSha: expected.sourceSha,
      sourceRef: provider.sourceRef,
      signerWorkflow: provider.signerWorkflow,
    });
  } catch (error) {
    fail(
      `${expected.metric} GitHub OIDC subject verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(verification) || verification.length === 0) {
    fail(`${expected.metric} GitHub OIDC subject verification is empty`);
  }
  provider.verifiedSourceFiles.add(basename(source.path));
  return document;
}

function quantile(histogram, percentile) {
  const total = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
  const rank = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (const bucket of histogram) {
    seen += bucket.count;
    if (seen >= rank) return bucket.value;
  }
  fail("latency histogram is empty");
}

function latencyPercentile(metric) {
  if (metric.endsWith("-p95")) return 0.95;
  if (metric.endsWith("-p99")) return 0.99;
  if (metric.endsWith("-max")) return 1;
  fail(`${metric} has no closed latency statistic`);
}

function validateExport(document, expected, provider, verifyProviderSubject) {
  exact(
    document,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "metric",
      "dimension",
      "unit",
      "observedAt",
      "provenance",
      "samples",
    ],
    `${expected.metric} export`,
  );
  if (
    document.schema !== "punks.operational-metric-export.v1" ||
    document.sourceSha !== expected.sourceSha ||
    document.stagingDeploymentId !== expected.stagingDeploymentId ||
    document.metric !== expected.metric ||
    document.dimension !== expected.dimension ||
    document.unit !== expected.unit ||
    !Number.isFinite(
      instant(document.observedAt, `${expected.metric} export observedAt`),
    ) ||
    !Array.isArray(document.provenance) ||
    document.provenance.length !== 1 ||
    document.provenance.some(
      (source) =>
        source === null ||
        typeof source !== "object" ||
        Array.isArray(source) ||
        JSON.stringify(Object.keys(source).sort()) !==
          JSON.stringify(["path", "sha256"]) ||
        typeof source.path !== "string" ||
        source.path.length === 0 ||
        !SHA256_RE.test(source.sha256 ?? ""),
    )
  ) {
    fail(`${expected.metric} export identity or provenance is invalid`);
  }
  const source = verifiedProvenance(
    document.provenance[0],
    expected.candidateRoot,
    expected,
    provider,
    verifyProviderSubject,
  );
  const sourceObservedAt = instant(
    source.observedAt,
    `${expected.metric} provider observedAt`,
  );
  const exportObservedAt = instant(
    document.observedAt,
    `${expected.metric} export observedAt`,
  );
  const observationObservedAt = instant(
    expected.observationObservedAt,
    "operational budget observation observedAt",
  );
  if (
    sourceObservedAt > exportObservedAt ||
    exportObservedAt > observationObservedAt ||
    observationObservedAt - sourceObservedAt > MAX_PROVIDER_OBSERVATION_AGE_MS
  ) {
    fail(
      `${expected.metric} provider observation is stale or temporally divergent`,
    );
  }
  if (canonicalSha256(source.samples) !== canonicalSha256(document.samples)) {
    fail(`${expected.metric} samples diverge from provider provenance`);
  }
  if (expected.unit === "pourcentage") {
    exact(
      document.samples,
      ["failures", "total"],
      `${expected.metric} samples`,
    );
    if (
      !Number.isSafeInteger(document.samples.total) ||
      document.samples.total < 1 ||
      !Number.isSafeInteger(document.samples.failures) ||
      document.samples.failures < 0 ||
      document.samples.failures > document.samples.total
    ) {
      fail(`${expected.metric} percentage samples are invalid`);
    }
    return {
      count: document.samples.total,
      numerator: document.samples.failures,
      denominator: document.samples.total,
      measure: (document.samples.failures / document.samples.total) * 100,
      upper: borneWilsonUnilaterale95(
        document.samples.failures,
        document.samples.total,
      ),
    };
  }
  if (expected.unit === "occurrences") {
    exact(
      document.samples,
      ["occurrences", "total"],
      `${expected.metric} samples`,
    );
    if (
      !Number.isSafeInteger(document.samples.total) ||
      document.samples.total < 1 ||
      !Number.isSafeInteger(document.samples.occurrences) ||
      document.samples.occurrences < 0
    ) {
      fail(`${expected.metric} occurrence samples are invalid`);
    }
    return {
      count: document.samples.total,
      numerator: document.samples.occurrences,
      denominator: null,
      measure: document.samples.occurrences,
      upper: document.samples.occurrences,
    };
  }
  exact(document.samples, ["histogram"], `${expected.metric} samples`);
  if (
    !Array.isArray(document.samples.histogram) ||
    document.samples.histogram.length < 1 ||
    document.samples.histogram.some(
      (bucket, index, values) =>
        bucket === null ||
        typeof bucket !== "object" ||
        Array.isArray(bucket) ||
        JSON.stringify(Object.keys(bucket).sort()) !==
          JSON.stringify(["count", "value"]) ||
        !Number.isFinite(bucket.value) ||
        bucket.value < 0 ||
        !Number.isSafeInteger(bucket.count) ||
        bucket.count < 1 ||
        (index > 0 && bucket.value <= values[index - 1].value),
    )
  ) {
    fail(`${expected.metric} latency histogram is invalid`);
  }
  const count = document.samples.histogram.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  if (!Number.isSafeInteger(count) || count < MIN_LATENCY_SAMPLE_COUNT) {
    fail(`${expected.metric} latency sample count is insufficient or unsafe`);
  }
  const measure = quantile(
    document.samples.histogram,
    latencyPercentile(expected.metric),
  );
  return {
    count,
    numerator: null,
    denominator: null,
    measure,
    upper: measure,
  };
}

function almostEqual(left, right) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= Math.max(1e-9, Math.abs(left) * 1e-9)
  );
}

function verifyStatistic(statistic, recalculated, label) {
  if (
    statistic.echantillons !== recalculated.count ||
    statistic.numerateur !== recalculated.numerator ||
    statistic.denominateur !== recalculated.denominator ||
    !almostEqual(statistic.mesure, recalculated.measure) ||
    !almostEqual(
      statistic["borne-superieure-unilaterale-95"],
      recalculated.upper,
    )
  ) {
    fail(`${label} differs from its rehashed raw export`);
  }
}

/**
 * Reopens and rehashes every raw aggregate used by the 36 signed verdicts.
 * The directory is closed: an omitted, extra, renamed or symlinked export is
 * rejected before the cadence can be copied into a Receipt.
 */
export function validateOperationalBudgetEvidence({
  observation,
  root: rootPath,
  candidateRoot,
  sourceSha,
  stagingDeploymentId,
  verifyProviderSubject = verifyGithubSubject,
}) {
  const root = resolve(rootPath);
  const status = lstatSync(root);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail("export root must be one real directory");
  }
  const candidate = resolve(candidateRoot);
  const candidateStatus = lstatSync(candidate);
  if (candidateStatus.isSymbolicLink() || !candidateStatus.isDirectory()) {
    fail("candidate root must be one real directory");
  }
  if (typeof verifyProviderSubject !== "function") {
    fail("GitHub OIDC subject verifier is unavailable");
  }
  const provider = providerProvenance(candidate, {
    sourceSha,
    stagingDeploymentId,
  });
  const observationObservedAt = observation?.observedAt;
  instant(observationObservedAt, "operational budget observation observedAt");
  const expectedFiles = new Set();
  for (const budget of BUDGETS_PRODUCTION) {
    const verdict = observation.verdicts.find(({ nom }) => nom === budget.nom);
    if (verdict === undefined) fail(`${budget.nom} verdict is missing`);
    for (const [dimension, statistic] of [
      [null, verdict],
      ...verdict.dimensions.map((value) => [value.dimension, value]),
    ]) {
      const digest = statistic["export-sha256"];
      if (!SHA256_RE.test(digest ?? "")) {
        fail(`${budget.nom} export digest is invalid`);
      }
      const fileName = `${digest}.json`;
      expectedFiles.add(fileName);
      const document = stableJson(resolve(root, fileName), budget.nom);
      if (canonicalSha256(document) !== digest) {
        fail(`${budget.nom} raw export digest diverges`);
      }
      verifyStatistic(
        statistic,
        validateExport(
          document,
          {
            sourceSha,
            stagingDeploymentId,
            metric: budget.nom,
            dimension,
            unit: budget.unite,
            candidateRoot: candidate,
            observationObservedAt,
          },
          provider,
          verifyProviderSubject,
        ),
        dimension === null ? budget.nom : `${budget.nom}/${dimension}`,
      );
    }
  }
  const dlqVerdict = observation.verdicts.find(
    ({ nom }) => nom === "queues-dlq",
  );
  if (
    dlqVerdict === undefined ||
    observation.dlq?.messages !== dlqVerdict.mesure ||
    observation.dlq?.["export-sha256"] !== dlqVerdict["export-sha256"]
  ) {
    fail("DLQ state diverges from its rehashed zero-tolerance export");
  }
  const outboxDigest = observation.outboxes?.["export-sha256"];
  if (!SHA256_RE.test(outboxDigest ?? "")) {
    fail("outbox state export digest is invalid");
  }
  expectedFiles.add(`${outboxDigest}.json`);
  const outboxDocument = stableJson(
    resolve(root, `${outboxDigest}.json`),
    "outbox state",
  );
  if (canonicalSha256(outboxDocument) !== outboxDigest) {
    fail("outbox state raw export digest diverges");
  }
  const outbox = validateExport(
    outboxDocument,
    {
      sourceSha,
      stagingDeploymentId,
      metric: "outboxes-en-attente",
      dimension: null,
      unit: "occurrences",
      candidateRoot: candidate,
      observationObservedAt,
    },
    provider,
    verifyProviderSubject,
  );
  if (
    outbox.measure !== observation.outboxes["en-attente"] ||
    outbox.measure !== 0
  ) {
    fail("outbox state is not empty in its rehashed provider export");
  }
  const actualFiles = readdirSync(root, { withFileTypes: true }).map(
    (entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail("export root contains a non-regular entry");
      }
      return basename(entry.name);
    },
  );
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((name) => !expectedFiles.has(name))
  ) {
    fail("export root is incomplete or contains unreferenced material");
  }
  const sourcesRoot = resolve(candidate, "operational-budget-sources");
  const sourcesStatus = lstatSync(sourcesRoot);
  if (sourcesStatus.isSymbolicLink() || !sourcesStatus.isDirectory()) {
    fail("provider source root must be one real directory");
  }
  const actualSourceFiles = readdirSync(sourcesRoot, {
    withFileTypes: true,
  }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("provider source root contains a non-regular entry");
    }
    return basename(entry.name);
  });
  if (
    actualSourceFiles.length !== provider.verifiedSourceFiles.size ||
    actualSourceFiles.some((name) => !provider.verifiedSourceFiles.has(name))
  ) {
    fail("provider source root contains unverified or unreferenced material");
  }
  return observation;
}
