import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
  PLATEFORMES,
  validateOperationalBudgetVerdicts,
} from "../release-graph-lib.mjs";
import { OPERATIONAL_BUDGET_PROVENANCE } from "./operational-budget-evidence.mjs";
import {
  operationalBudgetManifestPrefix,
  validateOperationalBudgetManifest,
} from "./operational-budget-fetch.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const OBSERVERS = new Set([
  "cloudflare-analytics",
  "github-attested-installed-candidate",
]);
const CONNECTION_METHODS = Object.freeze(["google", "github"]);

function fail(message) {
  throw new Error(`operational budget materialization rejected: ${message}`);
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

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(content, label) {
  try {
    return JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    fail(`${label} is invalid JSON`);
  }
}

function expectedDimensions(metric) {
  if (metric === "connexion-desktop-echecs-par-moyen") {
    return CONNECTION_METHODS;
  }
  if (metric === "desktop-sessions-avec-crash-par-plateforme") {
    return PLATEFORMES;
  }
  return [];
}

function coordinate(metric, dimension) {
  return `${metric}\u0000${dimension ?? ""}`;
}

function expectedSources() {
  const values = [];
  for (const budget of BUDGETS_PRODUCTION) {
    values.push({ metric: budget.nom, dimension: null, unit: budget.unite });
    for (const dimension of expectedDimensions(budget.nom)) {
      values.push({ metric: budget.nom, dimension, unit: budget.unite });
    }
  }
  values.push({
    metric: "outboxes-en-attente",
    dimension: null,
    unit: "occurrences",
  });
  return values;
}

function validateHistogram(samples, metric) {
  exact(samples, ["histogram"], `${metric} samples`);
  if (
    !Array.isArray(samples.histogram) ||
    samples.histogram.length === 0 ||
    samples.histogram.some(
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
    fail(`${metric} latency histogram is invalid`);
  }
  return samples.histogram;
}

function validateSamples(samples, unit, metric) {
  if (unit === "pourcentage") {
    exact(samples, ["failures", "total"], `${metric} samples`);
    if (
      !Number.isSafeInteger(samples.total) ||
      samples.total < 1 ||
      !Number.isSafeInteger(samples.failures) ||
      samples.failures < 0 ||
      samples.failures > samples.total
    ) {
      fail(`${metric} percentage samples are invalid`);
    }
    return;
  }
  if (unit === "occurrences") {
    exact(samples, ["occurrences", "total"], `${metric} samples`);
    if (
      !Number.isSafeInteger(samples.total) ||
      samples.total < 1 ||
      !Number.isSafeInteger(samples.occurrences) ||
      samples.occurrences < 0
    ) {
      fail(`${metric} occurrence samples are invalid`);
    }
    return;
  }
  if (unit !== "millisecondes") fail(`${metric} unit is unsupported`);
  validateHistogram(samples, metric);
}

function validateSource(document, expected, input) {
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
    `${expected.metric} provider source`,
  );
  if (
    document.schema !== "punks.operational-metric-source.v2" ||
    document.sourceSha !== input.sourceSha ||
    document.stagingDeploymentId !== input.stagingDeploymentId ||
    document.metric !== expected.metric ||
    document.dimension !== expected.dimension ||
    document.unit !== expected.unit ||
    !OBSERVERS.has(document.observer) ||
    !SHA256_RE.test(document.querySha256 ?? "") ||
    !Number.isFinite(Date.parse(document.observedAt ?? ""))
  ) {
    fail(`${expected.metric} provider source identity is invalid`);
  }
  validateSamples(document.samples, expected.unit, expected.metric);
  return document;
}

function readProviderSources(input) {
  const root = resolve(input.sources);
  const status = lstatSync(root);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail("provider source root must be one real directory");
  }
  const expected = expectedSources();
  const expectedByCoordinate = new Map(
    expected.map((entry) => [coordinate(entry.metric, entry.dimension), entry]),
  );
  const actual = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("provider source root contains a non-regular entry");
    }
    const path = resolve(root, entry.name);
    const content = readStableEvidenceFile(path, "operational provider source");
    const digest = sha256(content);
    if (entry.name !== `${digest}.json`) {
      fail("provider source is not byte-content-addressed");
    }
    const document = parseJson(content, "operational provider source");
    const key = coordinate(document?.metric, document?.dimension);
    const expectedSource = expectedByCoordinate.get(key);
    if (expectedSource === undefined || actual.has(key)) {
      fail(
        "provider source set contains an unexpected or duplicate coordinate",
      );
    }
    validateSource(document, expectedSource, input);
    actual.set(key, { content, digest, document });
  }
  if (
    actual.size !== expected.length ||
    expected.some(
      (entry) => !actual.has(coordinate(entry.metric, entry.dimension)),
    )
  ) {
    fail("provider source set is incomplete");
  }
  return { expected, actual };
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

function percentile(metric) {
  if (metric.endsWith("-p95")) return 0.95;
  if (metric.endsWith("-p99")) return 0.99;
  if (metric.endsWith("-max")) return 1;
  fail(`${metric} has no closed latency statistic`);
}

function statistic(source, maximum, exportSha256) {
  const baseline = {
    disponible: false,
    "mesure-n-1": null,
    "export-n-1-sha256": null,
    "regression-pourcentage": null,
    "justification-acceptee": false,
    "justification-sha256": null,
  };
  if (source.unit === "pourcentage") {
    const upper = borneWilsonUnilaterale95(
      source.samples.failures,
      source.samples.total,
    );
    const measure = (source.samples.failures / source.samples.total) * 100;
    return {
      mesure: measure,
      "borne-superieure-unilaterale-95": upper,
      echantillons: source.samples.total,
      numerateur: source.samples.failures,
      denominateur: source.samples.total,
      methode: "wilson-unilaterale-95",
      "baseline-n-1": baseline,
      resultat: upper !== null && upper <= maximum ? "vert" : "insuffisant",
      "export-sha256": exportSha256,
    };
  }
  if (source.unit === "occurrences") {
    return {
      mesure: source.samples.occurrences,
      "borne-superieure-unilaterale-95": source.samples.occurrences,
      echantillons: source.samples.total,
      numerateur: source.samples.occurrences,
      denominateur: null,
      methode: "tolerance-zero",
      "baseline-n-1": baseline,
      resultat: source.samples.occurrences <= maximum ? "vert" : "rouge",
      "export-sha256": exportSha256,
    };
  }
  const histogram = validateHistogram(source.samples, source.metric);
  const count = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
  const measure = quantile(histogram, percentile(source.metric));
  return {
    mesure: measure,
    "borne-superieure-unilaterale-95": measure,
    echantillons: count,
    numerateur: null,
    denominateur: null,
    methode: "quantile-export-verifie",
    "baseline-n-1": baseline,
    resultat: measure <= maximum ? "vert" : "rouge",
    "export-sha256": exportSha256,
  };
}

function writeExclusive(path, value) {
  writeFileSync(path, value, { flag: "wx", mode: 0o600 });
}

/**
 * Converts exactly 43 provider observations into the closed 36-budget bundle.
 * No count, rate, percentile or verdict is accepted from the caller.
 */
export function materializeOperationalBudgetEvidence(input) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    typeof input.sources !== "string" ||
    typeof input.output !== "string"
  ) {
    fail("exact candidate, staging and filesystem roots are required");
  }
  const provider = readProviderSources(input);
  const output = resolve(input.output);
  let outputCreated = false;
  try {
    mkdirSync(output, { mode: 0o700 });
    outputCreated = true;
    const sourceOutput = join(output, "sources");
    const exportOutput = join(output, "exports");
    mkdirSync(sourceOutput, { mode: 0o700 });
    mkdirSync(exportOutput, { mode: 0o700 });
    const prefix = operationalBudgetManifestPrefix(
      input.sourceSha,
      input.stagingDeploymentId,
    );
    const sourceReferences = [];
    const exportReferences = [];
    const statistics = new Map();
    let latestObservedAt = null;
    for (const expected of provider.expected) {
      const source = provider.actual.get(
        coordinate(expected.metric, expected.dimension),
      );
      writeExclusive(
        join(sourceOutput, `${source.digest}.json`),
        source.content,
      );
      sourceReferences.push({
        key: `${prefix}sources/${source.digest}.json`,
        sha256: source.digest,
      });
      const rawExport = {
        schema: "punks.operational-metric-export.v1",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        metric: expected.metric,
        dimension: expected.dimension,
        unit: expected.unit,
        observedAt: source.document.observedAt,
        provenance: [
          {
            path: `operational-budget-sources/${source.digest}.json`,
            sha256: source.digest,
          },
        ],
        samples: source.document.samples,
      };
      const exportName = canonicalSha256(rawExport);
      const exportBytes = bytes(rawExport);
      writeExclusive(join(exportOutput, `${exportName}.json`), exportBytes);
      exportReferences.push({
        key: `${prefix}exports/${exportName}.json`,
        sha256: sha256(exportBytes),
      });
      const maximum =
        expected.metric === "outboxes-en-attente"
          ? 0
          : BUDGETS_PRODUCTION.find(({ nom }) => nom === expected.metric)
              ?.maximum;
      statistics.set(
        coordinate(expected.metric, expected.dimension),
        statistic(source.document, maximum, exportName),
      );
      if (
        latestObservedAt === null ||
        Date.parse(source.document.observedAt) > Date.parse(latestObservedAt)
      ) {
        latestObservedAt = source.document.observedAt;
      }
    }
    const verdicts = BUDGETS_PRODUCTION.map((budget) => ({
      nom: budget.nom,
      unite: budget.unite,
      "budget-max": budget.maximum,
      ...statistics.get(coordinate(budget.nom, null)),
      dimensions: expectedDimensions(budget.nom).map((dimension) => ({
        dimension,
        ...statistics.get(coordinate(budget.nom, dimension)),
      })),
    }));
    const verdictErrors = validateOperationalBudgetVerdicts(verdicts, {
      connectionMethods: CONNECTION_METHODS,
      baselineRequired: false,
    });
    if (
      verdictErrors.length > 0 ||
      verdicts.some(({ resultat, dimensions }) =>
        [resultat, ...dimensions.map((entry) => entry.resultat)].some(
          (value) => value !== "vert",
        ),
      )
    ) {
      fail(
        `one or more operational budgets are not green or sufficiently sampled${verdictErrors.length > 0 ? `: ${verdictErrors.join("; ")}` : ""}`,
      );
    }
    const dlq = verdicts.find(({ nom }) => nom === "queues-dlq");
    const outbox = statistics.get(coordinate("outboxes-en-attente", null));
    const observationContent = {
      schema: "punks.operational-budget-observation.v1",
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      connectionMethods: [...CONNECTION_METHODS],
      verdicts,
      bookmarks: [{ autorite: "staging", valeur: input.stagingDeploymentId }],
      dlq: {
        messages: dlq.mesure,
        "export-sha256": dlq["export-sha256"],
      },
      outboxes: {
        "en-attente": outbox.mesure,
        "export-sha256": outbox["export-sha256"],
      },
      incidents: [],
      observedAt: latestObservedAt,
    };
    const observation = {
      ...observationContent,
      sha256: canonicalSha256(observationContent),
    };
    const observationBytes = bytes(observation);
    writeExclusive(join(output, "observation.json"), observationBytes);
    const manifestContent = {
      schema: "punks.operational-budget-r2-manifest.v3",
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      observation: {
        key: `${prefix}observation.json`,
        sha256: sha256(observationBytes),
      },
      exports: exportReferences,
      sources: sourceReferences,
      provenance: { ...OPERATIONAL_BUDGET_PROVENANCE },
      createdAt: latestObservedAt,
    };
    const manifest = {
      ...manifestContent,
      sha256: canonicalSha256(manifestContent),
    };
    validateOperationalBudgetManifest(manifest, input);
    const manifestBytes = bytes(manifest);
    writeExclusive(join(output, "manifest.json"), manifestBytes);
    return {
      manifest,
      observation,
      manifestSha256: sha256(manifestBytes),
    };
  } catch (error) {
    if (outputCreated) rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function localObjects(input, manifest, manifestBytes) {
  const values = [];
  for (const reference of manifest.sources) {
    values.push({
      key: reference.key,
      content: readStableEvidenceFile(
        join(input.root, "sources", basename(reference.key)),
        "operational source publication",
      ),
      expectedSha256: reference.sha256,
    });
  }
  for (const reference of manifest.exports) {
    values.push({
      key: reference.key,
      content: readStableEvidenceFile(
        join(input.root, "exports", basename(reference.key)),
        "operational export publication",
      ),
      expectedSha256: reference.sha256,
    });
  }
  values.push({
    key: manifest.observation.key,
    content: readStableEvidenceFile(
      join(input.root, "observation.json"),
      "operational observation publication",
    ),
    expectedSha256: manifest.observation.sha256,
  });
  values.push({
    key: `${operationalBudgetManifestPrefix(input.sourceSha, input.stagingDeploymentId)}manifest.json`,
    content: manifestBytes,
    expectedSha256: input.manifestSha256,
  });
  for (const value of values) {
    if (sha256(value.content) !== value.expectedSha256) {
      fail(`local operational object ${value.key} digest diverges`);
    }
  }
  return values;
}

async function requireLock(frontieres, destinations, prefix) {
  for (const destination of destinations) {
    const lock = await frontieres.cloudflare.lireVerrouillage({
      ...destination,
      cle: prefix,
    });
    if (lock?.mode !== "compliance" || lock.actif !== true) {
      fail(`${destination.role} operational observation prefix is not locked`);
    }
  }
}

/**
 * Publishes all content-addressed leaves to both buckets before making the
 * manifest visible. A divergent pre-existing byte aborts before any write.
 */
export async function publishOperationalBudgetEvidence(input, { frontieres }) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    !SHA256_RE.test(input?.manifestSha256 ?? "") ||
    !Array.isArray(input?.destinations) ||
    input.destinations.length !== 2 ||
    input.destinations[0]?.role !== "primaire" ||
    input.destinations[1]?.role !== "secondaire"
  ) {
    fail("exact candidate and two ordered R2 destinations are required");
  }
  const root = resolve(input.root);
  const manifestBytes = readStableEvidenceFile(
    join(root, "manifest.json"),
    "operational manifest publication",
  );
  if (sha256(manifestBytes) !== input.manifestSha256) {
    fail("operational manifest anchor diverges");
  }
  const manifest = validateOperationalBudgetManifest(
    parseJson(manifestBytes, "operational manifest publication"),
    input,
  );
  const objects = localObjects(input, manifest, manifestBytes);
  const prefix = operationalBudgetManifestPrefix(
    input.sourceSha,
    input.stagingDeploymentId,
  );
  await requireLock(frontieres, input.destinations, prefix);
  const existing = new Map();
  for (const destination of input.destinations) {
    for (const object of objects) {
      const value = await frontieres.cloudflare.lireObjet({
        ...destination,
        cle: object.key,
      });
      if (value !== null && !Buffer.from(value).equals(object.content)) {
        fail(`${destination.role} operational object ${object.key} diverges`);
      }
      existing.set(`${destination.role}\u0000${object.key}`, value !== null);
    }
  }
  const publishObject = async (destination, object) => {
    const key = `${destination.role}\u0000${object.key}`;
    if (!existing.get(key)) {
      try {
        await frontieres.cloudflare.creerObjet({
          ...destination,
          cle: object.key,
          contenu: object.content,
        });
      } catch (error) {
        if (error?.code !== "ALREADY_EXISTS") throw error;
      }
    }
    const final = await frontieres.cloudflare.lireObjet({
      ...destination,
      cle: object.key,
    });
    if (final === null || !Buffer.from(final).equals(object.content)) {
      fail(
        `${destination.role} operational object ${object.key} diverges after publish`,
      );
    }
  };
  const manifestObject = objects.at(-1);
  const leaves = objects.slice(0, -1);
  for (const destination of input.destinations) {
    for (const object of leaves) {
      await publishObject(destination, object);
    }
  }
  await requireLock(frontieres, input.destinations, prefix);
  for (const destination of input.destinations) {
    await publishObject(destination, manifestObject);
  }
  await requireLock(frontieres, input.destinations, prefix);
  return {
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    manifestKey: `${prefix}manifest.json`,
    manifestSha256: input.manifestSha256,
  };
}

function argumentsMap(argv, command) {
  const allowed =
    command === "materialize"
      ? new Set([
          "--source-sha",
          "--staging-deployment-id",
          "--sources",
          "--output",
        ])
      : new Set([
          "--source-sha",
          "--staging-deployment-id",
          "--manifest-sha256",
          "--root",
          "--r2-primaire",
          "--r2-secondaire",
          "--frontieres",
        ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || values.has(flag)) {
      fail(`exact ${command} CLI arguments are required`);
    }
    values.set(flag, value);
  }
  if (values.size !== allowed.size) {
    fail(`exact ${command} CLI arguments are required`);
  }
  return (flag) => values.get(flag);
}

function destination(role, value) {
  const [compte, bucket, ...rest] = value.split("/");
  if (rest.length > 0 || !/^[0-9a-f]{32}$/u.test(compte ?? "") || !bucket) {
    fail(`${role} R2 destination is invalid`);
  }
  return { role, compte, bucket };
}

export async function run(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === "materialize") {
    const required = argumentsMap(rest, command);
    const result = materializeOperationalBudgetEvidence({
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      sources: resolve(required("--sources")),
      output: resolve(required("--output")),
    });
    return {
      sourceSha: result.manifest.sourceSha,
      stagingDeploymentId: result.manifest.stagingDeploymentId,
      manifestSha256: result.manifestSha256,
    };
  }
  if (command !== "publish") fail("materialize or publish command is required");
  const required = argumentsMap(rest, command);
  const destinations = [
    destination("primaire", required("--r2-primaire")),
    destination("secondaire", required("--r2-secondaire")),
  ];
  const module = await import(
    pathToFileURL(resolve(required("--frontieres"))).href
  );
  if (typeof module.creerFrontiereR2Operationnelle !== "function") {
    fail("operational R2 frontier is unavailable");
  }
  return publishOperationalBudgetEvidence(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      manifestSha256: required("--manifest-sha256"),
      root: resolve(required("--root")),
      destinations,
    },
    { frontieres: module.creerFrontiereR2Operationnelle({ r2: destinations }) },
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
