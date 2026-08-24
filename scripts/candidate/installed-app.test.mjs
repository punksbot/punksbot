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

import {
  emitInstalledAppEvidence,
  REQUIRED_STORIES,
} from "./installed-app.mjs";

const SOURCE_SHA = "4a".repeat(20);
const DEPLOYMENT_ID = `sha256:${"5b".repeat(32)}`;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture(platform = "linux-x64") {
  const root = mkdtempSync(join(tmpdir(), "punks-installed-proof-"));
  const artifact = join(root, "punks-installer.bin");
  const signature = join(root, "punks-installer.bin.sig");
  writeFileSync(artifact, "exact signed installer\n");
  writeFileSync(signature, "exact updater signature\n");
  const transcript = {
    schema: "punks.installed-social-loop-transcript.v1",
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    platform,
    result: "vert",
    driver: platform.startsWith("macos-") ? "xctest" : "tauri-driver",
    contour: "distribue",
    serveurVite: false,
    facadeTest: false,
    installed: {
      bundleId: "bot.punks.desktop.staging",
      artifactSha256: sha256(artifact),
      binarySha256: "7c".repeat(32),
      launched: true,
    },
    verifications: {
      signature: "vert",
      "identite-application": "vert",
      "protocol-handlers": "vert",
      "stockage-securise": "vert",
      updater: "vert",
    },
    stories: REQUIRED_STORIES.map((id) => ({
      id,
      result: "vert",
      via: ["ui", "ipc-rust", "contrats-publics"],
      assertions: [`${id} observed through the installed application`],
    })),
    accessibility: {
      clavier: "vert",
      focus: "vert",
      "zoom-200": "vert",
      contraste: "vert",
      "mouvement-reduit": "vert",
      "lecteur-ecran": "vert",
    },
    network: {
      requests: [
        {
          transport: "https",
          method: "GET",
          origin: "https://staging.punks.bot",
          path: "/api/v1/compatibility",
          status: 200,
        },
        {
          transport: "wss",
          method: "FOLLOW",
          origin: "wss://staging.punks.bot",
          path: "/api/v1/workspaces/id/conversations/id/follow",
          status: 101,
        },
      ],
    },
  };
  const transcriptPath = join(root, "transcript.json");
  writeFileSync(transcriptPath, `${JSON.stringify(transcript)}\n`);
  return { root, artifact, signature, transcript, transcriptPath };
}

test("emits only content-addressed evidence tied to the installed artifact", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  const result = emitInstalledAppEvidence({
    platform: "linux-x64",
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    artifact: input.artifact,
    signature: input.signature,
    transcript: input.transcriptPath,
    output,
  });

  assert.equal(result.references.length, 2 + 5 + REQUIRED_STORIES.length + 7);
  const index = JSON.parse(readFileSync(join(output, "index.json"), "utf8"));
  assert.equal(index.schema, "punks.promotion-evidence-index.v1");
  for (const reference of index.preuves) {
    assert.match(reference.sha256, /^[0-9a-f]{64}$/);
    assert.ok(reference.chemin.startsWith("sha256/"));
    assert.equal(
      sha256(join(output, reference.chemin)),
      reference.sha256,
    );
  }
  const bundleReference = index.preuves.find(
    ({ id }) => id === "artefact/linux-x64/bundle",
  );
  const bundleProof = JSON.parse(
    readFileSync(join(output, bundleReference.chemin), "utf8"),
  );
  assert.equal(bundleProof.data.subjectSha256, sha256(input.artifact));
  assert.equal(bundleProof.data.bundleId, "bot.punks.desktop.staging");
});

test("rejects missing stories, false UI claims, legacy traffic and tampering", (t) => {
  for (const mutation of [
    (value) => value.stories.pop(),
    (value) => (value.stories[0].via = ["ui"]),
    (value) => (value.facadeTest = true),
    (value) =>
      value.network.requests.push({
        transport: "wss",
        method: "FOLLOW",
        origin: "wss://legacy.example",
        path: "/buzz/relay",
        status: 101,
      }),
    (value) => (value.accessibility.focus = "echec"),
  ]) {
    const input = fixture();
    t.after(() => rmSync(input.root, { recursive: true, force: true }));
    mutation(input.transcript);
    writeFileSync(
      input.transcriptPath,
      `${JSON.stringify(input.transcript)}\n`,
    );
    assert.throws(() =>
      emitInstalledAppEvidence({
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output: join(input.root, "evidence"),
      }),
    );
  }

  const tampered = fixture();
  t.after(() => rmSync(tampered.root, { recursive: true, force: true }));
  tampered.transcript.installed.artifactSha256 = "0".repeat(64);
  writeFileSync(
    tampered.transcriptPath,
    `${JSON.stringify(tampered.transcript)}\n`,
  );
  assert.throws(
    () =>
      emitInstalledAppEvidence({
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        artifact: tampered.artifact,
        signature: tampered.signature,
        transcript: tampered.transcriptPath,
        output: join(tampered.root, "evidence"),
      }),
    /artifact digest/,
  );
});

test("refuses to overwrite or merge an existing evidence directory", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  mkdirSync(output);
  writeFileSync(join(output, "foreign"), "do not overwrite\n");
  assert.throws(
    () =>
      emitInstalledAppEvidence({
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output,
      }),
    /already exists/,
  );
  assert.deepEqual(readdirSync(output), ["foreign"]);
});
