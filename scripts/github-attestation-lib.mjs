/**
 * Vérification commune des bundles Sigstore émis par GitHub Actions.
 *
 * Le contrôle structurel écarte les fichiers `{"verified": true}` auto-
 * déclarés. La vérification d'identité et de signature reste déléguée à
 * `gh attestation verify`, avec dépôt, workflow, SHA et ref exacts.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

function fail(message) {
  throw new Error(message);
}

/** Valide la forme minimale fermée des octets d'un bundle Sigstore DSSE. */
export function validateSigstoreBundleContent(content) {
  let bundle;
  try {
    bundle = JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    fail("The provenance file is not valid JSON");
  }
  if (
    typeof bundle.mediaType !== "string" ||
    !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle.") ||
    typeof bundle.dsseEnvelope?.payload !== "string" ||
    !Array.isArray(bundle.dsseEnvelope?.signatures) ||
    bundle.dsseEnvelope.signatures.length === 0 ||
    !bundle.verificationMaterial ||
    typeof bundle.verificationMaterial !== "object" ||
    Array.isArray(bundle.verificationMaterial)
  ) {
    fail("The provenance file is not a Sigstore bundle");
  }
  return bundle;
}

/** Charge puis valide un bundle Sigstore DSSE. */
export function validateSigstoreBundle(path) {
  return validateSigstoreBundleContent(readFileSync(path));
}

/**
 * Vérifie cryptographiquement un sujet contre l'identité GitHub Actions
 * exacte qui devait le produire.
 */
export function verifyGithubSubject({
  artifact,
  artifactContent,
  bundle,
  bundleContent,
  repository,
  sourceSha,
  sourceRef,
  signerWorkflow,
  ghBinary = "gh",
}) {
  if (!Buffer.isBuffer(artifactContent) || !Buffer.isBuffer(bundleContent)) {
    fail("Exact artifact and Sigstore bundle bytes are required");
  }
  validateSigstoreBundleContent(bundleContent);
  const snapshotRoot = mkdtempSync(join(tmpdir(), "punks-gh-attestation-"));
  chmodSync(snapshotRoot, 0o700);
  const artifactSnapshot = join(snapshotRoot, `artifact-${basename(artifact)}`);
  const bundleSnapshot = join(snapshotRoot, `bundle-${basename(bundle)}`);
  let result;
  try {
    writeFileSync(artifactSnapshot, artifactContent, {
      flag: "wx",
      mode: 0o600,
    });
    writeFileSync(bundleSnapshot, bundleContent, {
      flag: "wx",
      mode: 0o600,
    });
    result = spawnSync(
      ghBinary,
      [
        "attestation",
        "verify",
        artifactSnapshot,
        "--repo",
        repository,
        "--signer-workflow",
        signerWorkflow,
        "--source-digest",
        sourceSha,
        "--source-ref",
        sourceRef,
        "--deny-self-hosted-runners",
        "--bundle",
        bundleSnapshot,
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: process.env,
      },
    );
  } finally {
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      `GitHub attestation verification failed for ${basename(artifact)}: ${(result.stderr || "unknown gh failure").trim()}`,
    );
  }
  let verification;
  try {
    verification = JSON.parse(result.stdout);
  } catch {
    fail("GitHub attestation verification did not return JSON");
  }
  if (!Array.isArray(verification) || verification.length === 0) {
    fail("GitHub attestation verification returned no verified statement");
  }
  return verification;
}
