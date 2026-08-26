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
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";

import {
  emitInstalledAppEvidence,
  REQUIRED_STORIES,
  run,
} from "./installed-app.mjs";
import { preuveFollowFixture } from "../promotion-test-fixtures.mjs";

const SOURCE_SHA = "4a".repeat(20);
const STAGING_PROOF_MATERIAL = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SOURCE_SHA,
  observer: "cloudflare-remote",
  workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
    name,
    versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sourceShaAnnotation: sourceShaAnnotation(SOURCE_SHA),
    deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  })),
};
const DEPLOYMENT_ID = `sha256:${createHash("sha256")
  .update(canonicalJson(STAGING_PROOF_MATERIAL), "utf8")
  .digest("hex")}`;
const RUNTIME_WORKERS = STAGING_PROOF_MATERIAL.workers.map(
  ({ name, versionId }) => ({ name, versionId }),
);
const RUNTIME_HEADER = Buffer.from(JSON.stringify(RUNTIME_WORKERS)).toString(
  "base64url",
);
const ACCESSIBILITY_CRITERIA = [
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
];
const ACCESSIBILITY_METHODS = ["automatique", "manuelle"];

function screenReader(platform) {
  if (platform.startsWith("macos-")) return "VoiceOver";
  if (platform === "windows-x64") return "NVDA";
  return "Orca";
}

function sha256(pathOrContent) {
  const content = Buffer.isBuffer(pathOrContent)
    ? pathOrContent
    : readFileSync(pathOrContent);
  return createHash("sha256").update(content).digest("hex");
}

function remoteBoundary(mutate = () => {}) {
  const observation = {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: SOURCE_SHA,
    workers: STAGING_PROOF_MATERIAL.workers.map((worker, index) => ({
      name: worker.name,
      versions: [
        {
          id: worker.versionId,
          number: index + 1,
          metadata: {
            author_email: "release@punks.bot",
            author_id: "release-operator",
            created_on: `2026-08-25T00:00:0${index}Z`,
            has_preview: true,
            modified_on: `2026-08-25T00:00:0${index}Z`,
            source: "wrangler",
          },
          annotations: {
            "workers/message": sourceShaAnnotation(SOURCE_SHA),
            "workers/triggered_by": "version_upload",
          },
        },
      ],
      deployment: {
        id: worker.deploymentId,
        created_on: `2026-08-25T01:00:0${index}Z`,
        source: "wrangler",
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: worker.versionId }],
        annotations: { "workers/message": "staging release" },
        author_email: "release@punks.bot",
      },
    })),
  };
  mutate(observation);
  return {
    async observe() {
      return structuredClone(observation);
    },
  };
}

function installedNames(platform) {
  const prefix = `punks-desktop-${platform}-${SOURCE_SHA}`;
  if (platform.startsWith("macos-")) {
    return [`${prefix}.app.tar.gz`, `${prefix}.app.tar.gz.sig`];
  }
  if (platform === "linux-x64") {
    return [`${prefix}.AppImage`, `${prefix}.AppImage.sig`];
  }
  return [`${prefix}.exe`, `${prefix}.exe.sig`];
}

function fixture(platform = "linux-x64") {
  const root = mkdtempSync(join(tmpdir(), "punks-installed-proof-"));
  const [artifactName, signatureName] = installedNames(platform);
  const artifact = join(root, artifactName);
  const signature = join(root, signatureName);
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
    accessibility: Object.fromEntries(
      ACCESSIBILITY_CRITERIA.map((criterion) => [
        criterion,
        {
          resultat: "vert",
          methodes: [...ACCESSIBILITY_METHODS],
          ...(criterion === "lecteur-ecran"
            ? { technologie: screenReader(platform) }
            : {}),
        },
      ]),
    ),
    network: {
      deployment: {
        transport: "https",
        method: "POST",
        origin: "https://staging.punks.bot",
        path: "/api/v1/desktop/compatibility",
        status: 200,
        responseHeader: "x-punks-worker-versions",
        responseHeaderValue: RUNTIME_HEADER,
        workers: structuredClone(RUNTIME_WORKERS),
      },
      requests: [
        {
          transport: "https",
          method: "POST",
          origin: "https://staging.punks.bot",
          path: "/api/v1/desktop/compatibility",
          status: 200,
        },
        {
          ...preuveFollowFixture().request,
        },
      ],
      follow: preuveFollowFixture(),
    },
  };
  const transcriptPath = join(root, "transcript.json");
  writeFileSync(transcriptPath, `${JSON.stringify(transcript)}\n`);
  const stagingDeploymentProof = join(root, "staging-deployment-proof.json");
  writeFileSync(
    stagingDeploymentProof,
    `${JSON.stringify(
      {
        ...STAGING_PROOF_MATERIAL,
        deploymentId: DEPLOYMENT_ID,
      },
      null,
      2,
    )}\n`,
  );
  return {
    root,
    artifact,
    signature,
    transcript,
    transcriptPath,
    stagingDeploymentProof,
  };
}

test("emits only content-addressed evidence tied to the installed artifact", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  const networkOutput = join(output, "network-proof.json");
  const result = await emitInstalledAppEvidence(
    {
      platform: "linux-x64",
      candidateSha: SOURCE_SHA,
      stagingDeploymentProof: input.stagingDeploymentProof,
      artifact: input.artifact,
      signature: input.signature,
      transcript: input.transcriptPath,
      output,
      networkOutput,
    },
    { remoteBoundary: remoteBoundary() },
  );

  assert.equal(result.references.length, 4 + 5 + REQUIRED_STORIES.length + 7);
  const networkProof = JSON.parse(readFileSync(networkOutput, "utf8"));
  assert.deepEqual(networkProof, {
    schema: "punks.installed-network-proof.v1",
    platform: "linux-x64",
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    transcriptSha256: sha256(input.transcriptPath),
    network: input.transcript.network,
  });
  assert.equal(result.networkProofSha256, sha256(networkOutput));
  const index = JSON.parse(readFileSync(join(output, "index.json"), "utf8"));
  assert.equal(index.schema, "punks.promotion-evidence-index.v1");
  for (const reference of index.preuves) {
    assert.match(reference.sha256, /^[0-9a-f]{64}$/);
    assert.ok(reference.chemin.startsWith("sha256/"));
    assert.equal(sha256(join(output, reference.chemin)), reference.sha256);
  }
  const bundleReference = index.preuves.find(
    ({ id }) => id === "artefact/linux-x64/bundle",
  );
  const bundleProof = JSON.parse(
    readFileSync(join(output, bundleReference.chemin), "utf8"),
  );
  assert.equal(bundleProof.data.subjectSha256, sha256(input.artifact));
  assert.equal(bundleProof.data.bundleId, "bot.punks.desktop.staging");

  const transcriptReference = index.preuves.find(
    ({ id }) => id === "transcript/linux-x64",
  );
  const transcriptProof = JSON.parse(
    readFileSync(join(output, transcriptReference.chemin), "utf8"),
  );
  assert.equal(transcriptProof.data.plateforme, "linux-x64");
  assert.equal(transcriptReference.sujet.sha256, sha256(input.transcriptPath));
  assert.equal(
    readFileSync(join(output, transcriptReference.sujet.chemin), "utf8"),
    readFileSync(input.transcriptPath, "utf8"),
  );
  assert.equal(
    readdirSync(output).includes("transcript.json"),
    false,
    "le transcript ne doit jamais être recopié depuis son chemin après validation",
  );
  const reobservationReference = index.preuves.find(
    ({ id }) => id === "staging/reobservation/linux-x64",
  );
  const reobservationProof = JSON.parse(
    readFileSync(join(output, reobservationReference.chemin), "utf8"),
  );
  assert.equal(
    reobservationProof.data.transcriptSha256,
    sha256(input.transcriptPath),
  );
  assert.deepEqual(reobservationProof.data.sequence, [
    "transcript-installed",
    "cloudflare-reobserved",
  ]);
  assert.equal(
    readFileSync(join(output, reobservationReference.sujet.chemin), "utf8"),
    readFileSync(input.stagingDeploymentProof, "utf8"),
  );
});

test("rejects missing stories, false UI claims, legacy traffic and tampering", async (t) => {
  for (const mutation of [
    (value) => value.stories.pop(),
    (value) => (value.stories[0].via = ["ui"]),
    (value) => value.stories[0].via.push("http-direct"),
    (value) => (value.facadeTest = true),
    (value) =>
      value.network.requests.push({
        transport: "wss",
        method: "FOLLOW",
        origin: "wss://legacy.example",
        path: "/buzz/relay",
        status: 101,
      }),
    (value) => (value.accessibility.focus.resultat = "echec"),
    (value) =>
      (value.network.deployment.workers[0].versionId = crypto.randomUUID()),
    (value) => (value.network.deployment.responseHeaderValue = "Zm9yZ2Vk"),
    (value) => (value.network.deployment.path = "/api/v1/health"),
  ]) {
    const input = fixture();
    t.after(() => rmSync(input.root, { recursive: true, force: true }));
    mutation(input.transcript);
    writeFileSync(
      input.transcriptPath,
      `${JSON.stringify(input.transcript)}\n`,
    );
    await assert.rejects(
      emitInstalledAppEvidence(
        {
          platform: "linux-x64",
          candidateSha: SOURCE_SHA,
          stagingDeploymentProof: input.stagingDeploymentProof,
          artifact: input.artifact,
          signature: input.signature,
          transcript: input.transcriptPath,
          output: join(input.root, "evidence"),
        },
        { remoteBoundary: remoteBoundary() },
      ),
    );
  }

  const tampered = fixture();
  t.after(() => rmSync(tampered.root, { recursive: true, force: true }));
  tampered.transcript.installed.artifactSha256 = "0".repeat(64);
  writeFileSync(
    tampered.transcriptPath,
    `${JSON.stringify(tampered.transcript)}\n`,
  );
  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: tampered.stagingDeploymentProof,
        artifact: tampered.artifact,
        signature: tampered.signature,
        transcript: tampered.transcriptPath,
        output: join(tampered.root, "evidence"),
      },
      { remoteBoundary: remoteBoundary() },
    ),
    /artifact digest/,
  );
});

test("requires automated and manual evidence with the native screen reader", async (t) => {
  const cases = [
    {
      platform: "macos-arm64",
      mutate: (value) =>
        (value.accessibility["lecteur-ecran"].technologie = "NVDA"),
      message: /VoiceOver/,
    },
    {
      platform: "windows-x64",
      mutate: (value) =>
        (value.accessibility["lecteur-ecran"].technologie = "VoiceOver"),
      message: /NVDA/,
    },
    {
      platform: "linux-x64",
      mutate: (value) => value.accessibility.clavier.methodes.pop(),
      message: /automatique.*manuelle/i,
    },
  ];

  for (const { platform, mutate, message } of cases) {
    const input = fixture(platform);
    t.after(() => rmSync(input.root, { recursive: true, force: true }));
    mutate(input.transcript);
    writeFileSync(
      input.transcriptPath,
      `${JSON.stringify(input.transcript)}\n`,
    );
    await assert.rejects(
      emitInstalledAppEvidence(
        {
          platform,
          candidateSha: SOURCE_SHA,
          stagingDeploymentProof: input.stagingDeploymentProof,
          artifact: input.artifact,
          signature: input.signature,
          transcript: input.transcriptPath,
          output: join(input.root, "evidence"),
        },
        { remoteBoundary: remoteBoundary() },
      ),
      message,
    );
  }
});

test("refuses to overwrite or merge an existing evidence directory", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  mkdirSync(output);
  writeFileSync(join(output, "foreign"), "do not overwrite\n");
  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingDeploymentProof,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output,
      },
      { remoteBoundary: remoteBoundary() },
    ),
    /already exists/,
  );
  assert.deepEqual(readdirSync(output), ["foreign"]);
});

test("atomically refuses a destination created during remote reobservation", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  const boundary = remoteBoundary();
  const originalObserve = boundary.observe;
  boundary.observe = async (...args) => {
    mkdirSync(output);
    writeFileSync(join(output, "foreign"), "do not overwrite\n");
    return originalObserve(...args);
  };

  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingDeploymentProof,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output,
      },
      { remoteBoundary: boundary },
    ),
    /already exists/,
  );
  assert.deepEqual(readdirSync(output), ["foreign"]);
});

test("rejects a forged staging deployment even when every declaration repeats its ID", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const proof = JSON.parse(readFileSync(input.stagingDeploymentProof, "utf8"));
  proof.workers[0].deploymentId = "20000000-0000-4000-8000-000000000001";
  writeFileSync(input.stagingDeploymentProof, `${JSON.stringify(proof)}\n`);

  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingDeploymentProof,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output: join(input.root, "evidence"),
      },
      { remoteBoundary: remoteBoundary() },
    ),
    /staging deployment proof|digest does not match material/i,
  );
});

test("reobserves Cloudflare after the transcript and writes nothing on aggregate drift", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  let transcriptReadBeforeRemote = false;
  const boundary = remoteBoundary((observation) => {
    observation.workers[0].deployment.id =
      "20000000-0000-4000-8000-000000000001";
  });
  const originalObserve = boundary.observe;
  boundary.observe = async (...args) => {
    transcriptReadBeforeRemote = sha256(input.transcriptPath).length === 64;
    return originalObserve(...args);
  };

  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingDeploymentProof,
        artifact: input.artifact,
        signature: input.signature,
        transcript: input.transcriptPath,
        output,
      },
      { remoteBoundary: boundary },
    ),
    /post-exercise.*differs|aggregate/i,
  );
  assert.equal(transcriptReadBeforeRemote, true);
  assert.equal(readdirSync(input.root).includes("evidence"), false);
});

test("keeps the transcript snapshot read before Cloudflare reobservation", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const output = join(input.root, "evidence");
  const originalTranscript = readFileSync(input.transcriptPath);
  const boundary = remoteBoundary();
  const originalObserve = boundary.observe;
  boundary.observe = async (...args) => {
    writeFileSync(input.transcriptPath, "replaced during reobservation\n");
    return originalObserve(...args);
  };

  const result = await emitInstalledAppEvidence(
    {
      platform: "linux-x64",
      candidateSha: SOURCE_SHA,
      stagingDeploymentProof: input.stagingDeploymentProof,
      artifact: input.artifact,
      signature: input.signature,
      transcript: input.transcriptPath,
      output,
    },
    { remoteBoundary: boundary },
  );
  const transcript = result.references.find(
    ({ id }) => id === "transcript/linux-x64",
  );

  assert.equal(transcript.sujet.sha256, sha256(originalTranscript));
  assert.deepEqual(
    readFileSync(join(output, transcript.sujet.chemin)),
    originalTranscript,
  );
  assert.equal(
    readFileSync(input.transcriptPath, "utf8"),
    "replaced during reobservation\n",
  );
});

test("refuses a release asset attributed to another platform", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const foreign = installedNames("macos-arm64");
  const artifact = join(input.root, foreign[0]);
  const signature = join(input.root, foreign[1]);
  writeFileSync(artifact, readFileSync(input.artifact));
  writeFileSync(signature, readFileSync(input.signature));
  input.transcript.installed.artifactSha256 = sha256(artifact);
  writeFileSync(input.transcriptPath, `${JSON.stringify(input.transcript)}\n`);

  await assert.rejects(
    emitInstalledAppEvidence(
      {
        platform: "linux-x64",
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingDeploymentProof,
        artifact,
        signature,
        transcript: input.transcriptPath,
        output: join(input.root, "evidence"),
      },
      { remoteBoundary: remoteBoundary() },
    ),
    /release names.*platform/i,
  );
});

test("the real CLI exposes no post-proof or remote-boundary bypass", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  await assert.rejects(
    run([
      "--platform",
      "linux-x64",
      "--source-sha",
      SOURCE_SHA,
      "--staging-deployment-proof",
      input.stagingDeploymentProof,
      "--installed-artifact",
      input.artifact,
      "--updater-signature",
      input.signature,
      "--driver-transcript",
      input.transcriptPath,
      "--proof-output",
      join(input.root, "evidence"),
      "--network-output",
      join(input.root, "evidence", "network-proof.json"),
      "--post-staging-proof",
      input.stagingDeploymentProof,
    ]),
    /exact installed evidence CLI arguments/i,
  );
});
