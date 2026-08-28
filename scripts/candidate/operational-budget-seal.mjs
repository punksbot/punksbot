import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OPERATIONAL_BUDGET_PROVENANCE,
  validateOperationalBudgetEvidence,
} from "./operational-budget-evidence.mjs";
import {
  operationalBudgetManifestPrefix,
  validateOperationalBudgetManifest,
} from "./operational-budget-fetch.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`operational budget seal rejected: ${message}`);
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

async function verifyLockedProviderBundle(
  frontieres,
  destinations,
  key,
  content,
  prefix,
) {
  for (const target of destinations) {
    const lock = await frontieres.cloudflare.lireVerrouillage({
      ...target,
      cle: prefix,
    });
    if (lock?.mode !== "compliance" || lock.actif !== true) {
      fail(`${target.role} operational observation prefix is not locked`);
    }
    const existing = await frontieres.cloudflare.lireObjet({
      ...target,
      cle: key,
    });
    if (existing === null || !Buffer.from(existing).equals(content)) {
      fail(`${target.role} operational provider bundle is absent or diverges`);
    }
    const finalLock = await frontieres.cloudflare.lireVerrouillage({
      ...target,
      cle: prefix,
    });
    if (finalLock?.mode !== "compliance" || finalLock.actif !== true) {
      fail(
        `${target.role} operational observation lock changed during verification`,
      );
    }
  }
}

/**
 * Authenticates every staged metric source against a provider-owned GitHub OIDC
 * bundle that was already published create-only in both locked Punks buckets.
 */
export async function sealOperationalBudgetEvidence(
  input,
  { frontieres, verifyProviderSubject },
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    !SHA256_RE.test(input?.manifestSha256 ?? "") ||
    !Array.isArray(input.destinations) ||
    input.destinations.length !== 2 ||
    input.destinations[0]?.role !== "primaire" ||
    input.destinations[1]?.role !== "secondaire"
  ) {
    fail("exact candidate and redundant Punks R2 destinations are required");
  }
  const candidateRoot = resolve(input.candidateRoot);
  const manifestPath = resolve(
    candidateRoot,
    "operational-budget-r2-manifest.json",
  );
  const manifestBytes = readStableEvidenceFile(
    manifestPath,
    "operational budget manifest",
  );
  if (digest(manifestBytes) !== input.manifestSha256) {
    fail("operational budget manifest bytes diverge from the protected anchor");
  }
  const manifest = validateOperationalBudgetManifest(
    parseJson(manifestBytes, "operational budget manifest"),
    input,
  );
  if (
    manifest.provenance.repository !==
      OPERATIONAL_BUDGET_PROVENANCE.repository ||
    manifest.provenance.sourceRef !== OPERATIONAL_BUDGET_PROVENANCE.sourceRef ||
    manifest.provenance.signerWorkflow !==
      OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow
  ) {
    fail("operational budget provenance identity diverges");
  }
  const bundleContent = readStableEvidenceFile(
    input.bundle,
    "operational budget Sigstore bundle",
    { minimum: 2 },
  );
  const bundleSha256 = digest(bundleContent);
  if (bundleSha256 !== manifest.provenance.bundle.sha256) {
    fail("operational provider bundle diverges from the locked manifest");
  }
  const provenanceRoot = resolve(
    candidateRoot,
    "operational-budget-provenance",
  );
  const provenanceDescriptor = resolve(
    candidateRoot,
    "operational-budget-provenance.json",
  );
  const provenanceName = `${bundleSha256}.sigstore.json`;
  let provenanceRootCreated = false;
  let provenanceDescriptorCreated = false;
  try {
    mkdirSync(provenanceRoot, { mode: 0o700 });
    provenanceRootCreated = true;
    writeFileSync(resolve(provenanceRoot, provenanceName), bundleContent, {
      flag: "wx",
      mode: 0o600,
    });
    writeFileSync(
      provenanceDescriptor,
      `${JSON.stringify({
        schema: "punks.operational-budget-provenance.v1",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        ...manifest.provenance,
        bundle: {
          path: `operational-budget-provenance/${provenanceName}`,
          sha256: bundleSha256,
        },
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    provenanceDescriptorCreated = true;
    const observation = parseJson(
      readStableEvidenceFile(
        resolve(candidateRoot, "operational-budget-observation.json"),
        "operational budget observation",
      ),
      "operational budget observation",
    );
    validateOperationalBudgetEvidence({
      observation,
      root: resolve(candidateRoot, "operational-budget-exports"),
      candidateRoot,
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      verifyProviderSubject,
    });
    const prefix = operationalBudgetManifestPrefix(
      input.sourceSha,
      input.stagingDeploymentId,
    );
    const key = `${prefix}provenance/${provenanceName}`;
    if (key !== manifest.provenance.bundle.key) {
      fail("operational provider bundle key diverges from the locked manifest");
    }
    await verifyLockedProviderBundle(
      frontieres,
      input.destinations,
      key,
      bundleContent,
      prefix,
    );
    return { manifest, observation, bundle: { key, sha256: bundleSha256 } };
  } catch (error) {
    if (provenanceRootCreated) {
      rmSync(provenanceRoot, { recursive: true, force: true });
    }
    if (provenanceDescriptorCreated) {
      rmSync(provenanceDescriptor, { force: true });
    }
    throw error;
  }
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--manifest-sha256",
    "--candidate-root",
    "--bundle",
    "--r2-primaire",
    "--r2-secondaire",
    "--frontieres",
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

/** Executes the closed protected-run CLI; no verifier or boundary is selectable. */
export async function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  const r2 = [
    destination("primaire", required("--r2-primaire")),
    destination("secondaire", required("--r2-secondaire")),
  ];
  const module = await import(
    pathToFileURL(resolve(required("--frontieres"))).href
  );
  const create = module.creerFrontiereR2Operationnelle;
  if (typeof create !== "function") {
    fail("operational R2 frontier is unavailable");
  }
  const frontieres = create({ r2 });
  return sealOperationalBudgetEvidence(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      manifestSha256: required("--manifest-sha256"),
      candidateRoot: resolve(required("--candidate-root")),
      bundle: resolve(required("--bundle")),
      destinations: r2,
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
