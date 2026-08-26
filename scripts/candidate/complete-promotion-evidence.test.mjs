import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completePromotionEvidence } from "./complete-promotion-evidence.mjs";

const SOURCE_SHA = "8d".repeat(20);
const DEPLOYMENT_ID = `sha256:${"7e".repeat(32)}`;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-complete-evidence-"));
  const candidate = join(root, "candidate");
  const evidence = join(candidate, "promotion-evidence");
  const content = join(evidence, "sha256");
  mkdirSync(content, { recursive: true });
  writeFileSync(
    join(candidate, "aggregate-manifest.json"),
    `${JSON.stringify({
      schema: "punks.desktop-candidate-aggregate.v1",
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
    })}\n`,
  );
  const materials = Object.fromEntries(
    [
      "promotion-profile",
      "staging-material",
      "release-graph",
      "withdrawal-inventory",
      "goldens",
      "provenance-bundle",
    ].map((name) => {
      const path = join(root, `${name}.json`);
      writeFileSync(path, `${JSON.stringify({ name })}\n`);
      return [name, path];
    }),
  );
  return {
    root,
    candidate,
    evidence,
    content,
    output: join(evidence, "index.json"),
    materials,
  };
}

function addFragment(input, fragment, id) {
  const safeId = id.replaceAll(/[^a-z0-9.-]/giu, "-");
  const subject = Buffer.from(`observed:${id}\n`);
  const subjectDigest = sha256(subject);
  const subjectPath = `sha256/${subjectDigest}-${safeId}-subject.bin`;
  writeFileSync(join(input.evidence, subjectPath), subject, { flag: "wx" });
  const proof = Buffer.from(
    `${JSON.stringify({
      schema: "punks.promotion-proof.v1",
      id,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      result: "vert",
      data: { subjectSha256: subjectDigest },
    })}\n`,
  );
  const proofDigest = sha256(proof);
  const proofPath = `sha256/${proofDigest}-${safeId}.json`;
  writeFileSync(join(input.evidence, proofPath), proof, { flag: "wx" });
  writeFileSync(
    join(input.evidence, `${fragment}-index.json`),
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: [
        {
          id,
          chemin: proofPath,
          sha256: proofDigest,
          sujet: { chemin: subjectPath, sha256: subjectDigest },
        },
      ],
    })}\n`,
  );
}

function options(input) {
  return {
    candidate: input.candidate,
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    promotionProfile: input.materials["promotion-profile"],
    stagingMaterial: input.materials["staging-material"],
    releaseGraph: input.materials["release-graph"],
    withdrawalInventory: input.materials["withdrawal-inventory"],
    goldens: input.materials.goldens,
    provenanceBundle: input.materials["provenance-bundle"],
    output: input.output,
  };
}

test("merges only the four closed observed evidence fragments", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  addFragment(input, "platform", "transcript/linux-x64");
  addFragment(input, "gates", "gate/cloudflare-check");
  addFragment(input, "recovery", "faute/coupure/workspace");
  addFragment(input, "withdrawal", "retrait/diff");

  const index = completePromotionEvidence(options(input));

  assert.deepEqual(
    index.preuves.map(({ id }) => id),
    [
      "faute/coupure/workspace",
      "gate/cloudflare-check",
      "retrait/diff",
      "transcript/linux-x64",
    ],
  );
  assert.deepEqual(JSON.parse(readFileSync(input.output, "utf8")), index);
});

test("writes nothing when one observed evidence fragment is missing", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  addFragment(input, "platform", "transcript/linux-x64");
  addFragment(input, "gates", "gate/cloudflare-check");
  addFragment(input, "withdrawal", "retrait/diff");

  assert.throws(
    () => completePromotionEvidence(options(input)),
    /recovery-index\.json.*missing/i,
  );
  assert.throws(() => readFileSync(input.output), /ENOENT/);
});
