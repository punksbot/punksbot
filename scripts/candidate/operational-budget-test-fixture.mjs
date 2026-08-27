import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Minimal structural bundle used only behind an injected test verifier. */
export function operationalBudgetSigstoreFixture() {
  return Buffer.from(
    `${JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      dsseEnvelope: {
        payload: Buffer.from("operational budget provenance").toString(
          "base64",
        ),
        signatures: [{ sig: Buffer.from("signature").toString("base64") }],
      },
      verificationMaterial: {},
    })}\n`,
  );
}

/** Writes the closed local descriptor consumed by budget validator tests. */
export function writeOperationalBudgetProvenanceFixture(
  candidateRoot,
  { sourceSha, stagingDeploymentId },
) {
  const bundle = operationalBudgetSigstoreFixture();
  const sha256 = createHash("sha256").update(bundle).digest("hex");
  const directory = join(candidateRoot, "operational-budget-provenance");
  mkdirSync(directory);
  writeFileSync(join(directory, `${sha256}.sigstore.json`), bundle);
  writeFileSync(
    join(candidateRoot, "operational-budget-provenance.json"),
    `${JSON.stringify({
      schema: "punks.operational-budget-provenance.v1",
      sourceSha,
      stagingDeploymentId,
      repository: "punksbot/punksbot",
      sourceRef: "refs/heads/staging",
      signerWorkflow:
        "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
      bundle: {
        path: `operational-budget-provenance/${sha256}.sigstore.json`,
        sha256,
      },
    })}\n`,
  );
  return { bundle, sha256 };
}
