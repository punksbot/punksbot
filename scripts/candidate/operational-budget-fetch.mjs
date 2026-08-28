import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { OPERATIONAL_BUDGET_PROVENANCE } from "./operational-budget-evidence.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`operational budget fetch rejected: ${message}`);
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

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseJson(content, label) {
  try {
    return JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    fail(`${label} is invalid JSON`);
  }
}

function destination(role, value) {
  const [compte, bucket, ...rest] = value.split("/");
  if (rest.length > 0 || !/^[0-9a-f]{32}$/u.test(compte ?? "") || !bucket) {
    fail(`${role} R2 destination is invalid`);
  }
  return { role, compte, bucket };
}

function manifestKey(sourceSha, stagingDeploymentId) {
  return `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/manifest.json`;
}

/** Closed R2 prefix shared by every byte of one operational observation. */
export function operationalBudgetManifestPrefix(
  sourceSha,
  stagingDeploymentId,
) {
  return `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/`;
}

/** Validates the content-addressed manifest before any provider byte is staged. */
export function validateOperationalBudgetManifest(value, expected) {
  exact(
    value,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "observation",
      "exports",
      "sources",
      "provenance",
      "createdAt",
      "sha256",
    ],
    "operational budget manifest",
  );
  const { sha256, ...content } = value;
  if (
    value.schema !== "punks.operational-budget-r2-manifest.v4" ||
    value.sourceSha !== expected.sourceSha ||
    value.stagingDeploymentId !== expected.stagingDeploymentId ||
    canonicalSha256(content) !== sha256 ||
    !Number.isFinite(Date.parse(value.createdAt ?? "")) ||
    !Array.isArray(value.exports) ||
    value.exports.length < 36 ||
    !Array.isArray(value.sources) ||
    value.sources.length < 36
  ) {
    fail("operational budget manifest identity or digest diverges");
  }
  const prefix = `operational-observations/tranche:1/${expected.sourceSha}/${expected.stagingDeploymentId.slice(7)}/`;
  exact(
    value.provenance,
    ["repository", "sourceRef", "signerWorkflow", "bundle"],
    "operational budget provenance",
  );
  exact(
    value.provenance.bundle,
    ["key", "sha256"],
    "operational budget provider bundle",
  );
  if (
    value.provenance.repository !== OPERATIONAL_BUDGET_PROVENANCE.repository ||
    value.provenance.sourceRef !== OPERATIONAL_BUDGET_PROVENANCE.sourceRef ||
    value.provenance.signerWorkflow !==
      OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow
  ) {
    fail("operational budget provenance identity is invalid");
  }
  const references = [
    value.observation,
    ...value.exports,
    ...value.sources,
    value.provenance.bundle,
  ];
  for (const [index, reference] of references.entries()) {
    exact(reference, ["key", "sha256"], `budget object ${index}`);
    if (
      typeof reference.key !== "string" ||
      !reference.key.startsWith(prefix) ||
      reference.key.includes("..") ||
      !SHA256_RE.test(reference.sha256 ?? "")
    ) {
      fail(`budget object ${index} is invalid`);
    }
  }
  const names = value.exports.map(({ key }) => basename(key));
  const sourceNames = value.sources.map(({ key }) => basename(key));
  if (
    new Set(references.map(({ key }) => key)).size !== references.length ||
    names.some((name) => !/^[0-9a-f]{64}\.json$/u.test(name)) ||
    sourceNames.some((name) => !/^[0-9a-f]{64}\.json$/u.test(name)) ||
    value.provenance.bundle.key !==
      `${prefix}provenance/${value.provenance.bundle.sha256}.sigstore.json`
  ) {
    fail("operational budget manifest repeats or renames an export");
  }
  return value;
}

async function readRedundant(frontieres, destinations, reference, label) {
  const values = await Promise.all(
    destinations.map((target) =>
      frontieres.cloudflare.lireObjet({ ...target, cle: reference.key }),
    ),
  );
  if (
    values.some((value) => value === null) ||
    values.some(
      (value) => !Buffer.from(value).equals(Buffer.from(values[0])),
    ) ||
    digest(values[0]) !== reference.sha256
  ) {
    fail(`${label} is absent, divergent or corrupt across locked R2 copies`);
  }
  return Buffer.from(values[0]);
}

/**
 * Stages redundant, locked provider bytes without trusting their metric claims.
 * The caller must subsequently seal them with `operational-budget-seal.mjs`;
 * no staged observation is eligible before that OIDC verification succeeds.
 */
export async function fetchOperationalBudgetEvidence(input, { frontieres }) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    !Array.isArray(input.destinations) ||
    input.destinations.length !== 2 ||
    input.destinations[0]?.role !== "primaire" ||
    input.destinations[1]?.role !== "secondaire"
  ) {
    fail("exact candidate and redundant Punks R2 destinations are required");
  }
  const key = manifestKey(input.sourceSha, input.stagingDeploymentId);
  const lockedPrefix = operationalBudgetManifestPrefix(
    input.sourceSha,
    input.stagingDeploymentId,
  );
  for (const target of input.destinations) {
    const lock = await frontieres.cloudflare.lireVerrouillage({
      ...target,
      cle: lockedPrefix,
    });
    if (lock?.mode !== "compliance" || lock.actif !== true) {
      fail(`${target.role} operational observation bucket is not locked`);
    }
  }
  const manifestBytes = await readRedundant(
    frontieres,
    input.destinations,
    { key, sha256: input.manifestSha256 },
    "operational budget manifest",
  );
  const manifest = validateOperationalBudgetManifest(
    parseJson(manifestBytes, "operational budget manifest"),
    input,
  );
  const observationBytes = await readRedundant(
    frontieres,
    input.destinations,
    manifest.observation,
    "operational budget observation",
  );
  const exportBytes = await Promise.all(
    manifest.exports.map((reference, index) =>
      readRedundant(
        frontieres,
        input.destinations,
        reference,
        `operational metric export ${index}`,
      ),
    ),
  );
  const sourceBytes = await Promise.all(
    manifest.sources.map((reference, index) =>
      readRedundant(
        frontieres,
        input.destinations,
        reference,
        `operational metric source ${index}`,
      ),
    ),
  );
  const providerBundleBytes = await readRedundant(
    frontieres,
    input.destinations,
    manifest.provenance.bundle,
    "operational provider Sigstore bundle",
  );
  for (const target of input.destinations) {
    const lock = await frontieres.cloudflare.lireVerrouillage({
      ...target,
      cle: lockedPrefix,
    });
    if (lock?.mode !== "compliance" || lock.actif !== true) {
      fail(`${target.role} operational observation lock changed during read`);
    }
  }
  const output = resolve(input.output);
  const exportsRoot = resolve(input.exportsOutput);
  const sourcesRoot = resolve(
    input.candidateRoot,
    "operational-budget-sources",
  );
  const manifestOutput = resolve(
    input.candidateRoot,
    "operational-budget-r2-manifest.json",
  );
  const providerBundleOutput = resolve(
    input.candidateRoot,
    "operational-budget-provider.sigstore.json",
  );
  let exportsRootCreated = false;
  let sourcesRootCreated = false;
  let manifestOutputCreated = false;
  let providerBundleOutputCreated = false;
  let outputCreated = false;
  try {
    mkdirSync(exportsRoot, { mode: 0o700 });
    exportsRootCreated = true;
    mkdirSync(sourcesRoot, { mode: 0o700 });
    sourcesRootCreated = true;
    for (const [index, reference] of manifest.exports.entries()) {
      writeFileSync(
        resolve(exportsRoot, basename(reference.key)),
        exportBytes[index],
        { flag: "wx", mode: 0o600 },
      );
    }
    for (const [index, reference] of manifest.sources.entries()) {
      writeFileSync(
        resolve(sourcesRoot, basename(reference.key)),
        sourceBytes[index],
        { flag: "wx", mode: 0o600 },
      );
    }
    writeFileSync(providerBundleOutput, providerBundleBytes, {
      flag: "wx",
      mode: 0o600,
    });
    providerBundleOutputCreated = true;
    writeFileSync(manifestOutput, manifestBytes, {
      flag: "wx",
      mode: 0o600,
    });
    manifestOutputCreated = true;
    writeFileSync(output, observationBytes, { flag: "wx", mode: 0o600 });
    outputCreated = true;
    const observation = parseJson(
      observationBytes,
      "operational budget observation",
    );
    return { manifest, observation };
  } catch (error) {
    if (exportsRootCreated) {
      rmSync(exportsRoot, { recursive: true, force: true });
    }
    if (sourcesRootCreated) {
      rmSync(sourcesRoot, { recursive: true, force: true });
    }
    if (manifestOutputCreated) rmSync(manifestOutput, { force: true });
    if (providerBundleOutputCreated) {
      rmSync(providerBundleOutput, { force: true });
    }
    if (outputCreated) rmSync(output, { force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--manifest-sha256",
    "--candidate-root",
    "--r2-primaire",
    "--r2-secondaire",
    "--frontieres",
    "--output",
    "--exports-output",
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
  return (name) => values.get(name);
}

export async function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  const r2 = [
    destination("primaire", required("--r2-primaire")),
    destination("secondaire", required("--r2-secondaire")),
  ];
  const module = await import(
    pathToFileURL(resolve(required("--frontieres"))).href
  );
  const create = module.creerFrontiereLectureR2;
  if (typeof create !== "function") {
    fail("read-only R2 frontier is unavailable");
  }
  const frontieres = create({ r2 });
  return fetchOperationalBudgetEvidence(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      manifestSha256: required("--manifest-sha256"),
      candidateRoot: resolve(required("--candidate-root")),
      destinations: r2,
      output: resolve(required("--output")),
      exportsOutput: resolve(required("--exports-output")),
    },
    { frontieres },
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
