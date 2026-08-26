import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  OPERATIONAL_BUDGET_PROVENANCE,
  validateOperationalBudgetEvidence,
} from "./operational-budget-evidence.mjs";

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

function manifestPrefix(sourceSha, stagingDeploymentId) {
  return `operational-observations/tranche:1/${sourceSha}/${stagingDeploymentId.slice(7)}/`;
}

function validateManifest(value, expected) {
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
    value.schema !== "punks.operational-budget-r2-manifest.v2" ||
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
    ["key", "sha256", "repository", "sourceRef", "signerWorkflow"],
    "operational budget provenance",
  );
  if (
    value.provenance.repository !== OPERATIONAL_BUDGET_PROVENANCE.repository ||
    value.provenance.sourceRef !== OPERATIONAL_BUDGET_PROVENANCE.sourceRef ||
    value.provenance.signerWorkflow !==
      OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow ||
    value.provenance.key !==
      `${prefix}provenance/${value.provenance.sha256}.sigstore.json` ||
    !SHA256_RE.test(value.provenance.sha256 ?? "")
  ) {
    fail("operational budget provenance identity is invalid");
  }
  const references = [value.observation, ...value.exports, ...value.sources];
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
    sourceNames.some((name) => !/^[0-9a-f]{64}\.json$/u.test(name))
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

export async function fetchOperationalBudgetEvidence(
  input,
  { frontieres, verifyProviderSubject },
) {
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
  const lockedPrefix = manifestPrefix(
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
  const manifest = validateManifest(
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
  const provenanceBytes = await readRedundant(
    frontieres,
    input.destinations,
    manifest.provenance,
    "operational budget Sigstore provenance",
  );
  const output = resolve(input.output);
  const exportsRoot = resolve(input.exportsOutput);
  const sourcesRoot = resolve(
    input.candidateRoot,
    "operational-budget-sources",
  );
  const provenanceRoot = resolve(
    input.candidateRoot,
    "operational-budget-provenance",
  );
  const provenanceDescriptor = resolve(
    input.candidateRoot,
    "operational-budget-provenance.json",
  );
  mkdirSync(exportsRoot, { mode: 0o700 });
  mkdirSync(sourcesRoot, { mode: 0o700 });
  mkdirSync(provenanceRoot, { mode: 0o700 });
  try {
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
    const provenanceName = `${manifest.provenance.sha256}.sigstore.json`;
    writeFileSync(resolve(provenanceRoot, provenanceName), provenanceBytes, {
      flag: "wx",
      mode: 0o600,
    });
    writeFileSync(
      provenanceDescriptor,
      `${JSON.stringify({
        schema: "punks.operational-budget-provenance.v1",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        repository: manifest.provenance.repository,
        sourceRef: manifest.provenance.sourceRef,
        signerWorkflow: manifest.provenance.signerWorkflow,
        bundle: {
          path: `operational-budget-provenance/${provenanceName}`,
          sha256: manifest.provenance.sha256,
        },
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    writeFileSync(output, observationBytes, { flag: "wx", mode: 0o600 });
    const observation = parseJson(
      observationBytes,
      "operational budget observation",
    );
    validateOperationalBudgetEvidence({
      observation,
      root: exportsRoot,
      candidateRoot: input.candidateRoot,
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      verifyProviderSubject,
    });
    return { manifest, observation };
  } catch (error) {
    rmSync(exportsRoot, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(provenanceRoot, { recursive: true, force: true });
    rmSync(provenanceDescriptor, { force: true });
    rmSync(output, { force: true });
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
