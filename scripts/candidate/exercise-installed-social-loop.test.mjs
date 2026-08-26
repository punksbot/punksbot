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

import {
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import {
  exerciseInstalledSocialLoop,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
  run,
} from "./exercise-installed-social-loop.mjs";

const SOURCE_SHA = "6b".repeat(20);
const PLATFORM = "linux-x64";
const WORKERS = CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
  name,
  versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  sourceShaAnnotation: sourceShaAnnotation(SOURCE_SHA),
  deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
}));
const PROOF_CORE = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SOURCE_SHA,
  observer: "cloudflare-remote",
  workers: WORKERS,
};
const DEPLOYMENT_ID = `sha256:${createHash("sha256")
  .update(canonicalJson(PROOF_CORE))
  .digest("hex")}`;
const STAGING_PROOF = { ...PROOF_CORE, deploymentId: DEPLOYMENT_ID };
const RUNTIME_WORKERS = WORKERS.map(({ name, versionId }) => ({
  name,
  versionId,
}));
const COMPATIBILITY_RECORD = {
  transport: "https",
  method: "POST",
  origin: "https://staging.punks.bot",
  path: "/api/v1/desktop/compatibility",
  status: 200,
};
const FOLLOW_RECORD = {
  transport: "wss",
  method: "FOLLOW",
  origin: "wss://staging.punks.bot",
  path: "/api/v1/workspaces/workspace/conversations/conversation/follow",
  status: 101,
};

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-installed-exercise-"));
  const artifact = join(
    root,
    `punks-desktop-${PLATFORM}-${SOURCE_SHA}.AppImage`,
  );
  const bundle = join(root, "bundle");
  const stagingProof = join(root, "staging-deployment-proof.json");
  const networkLog = join(root, "network.jsonl");
  const output = join(root, "transcript.json");
  mkdirSync(bundle);
  writeFileSync(artifact, "signed installed candidate\n");
  writeFileSync(stagingProof, `${JSON.stringify(STAGING_PROOF, null, 2)}\n`);
  return { root, artifact, bundle, stagingProof, networkLog, output };
}

function observation(artifactSha256) {
  const trace = [
    { state: "accepted", cursor: "cursor-1" },
    {
      state: "changes",
      previousCursor: "cursor-1",
      cursor: "cursor-2",
      batchId: "batch-1",
      atomic: true,
    },
    { state: "renderer-confirmed", cursor: "cursor-2" },
    { state: "ack", cursor: "cursor-2" },
    { state: "ready", cursor: "cursor-2" },
    { state: "live", cursor: "cursor-2" },
    { state: "terminal", cursor: "cursor-2" },
  ];
  return {
    schema: "punks.installed-driver-observation.v1",
    platform: PLATFORM,
    candidateSha: SOURCE_SHA,
    artifactSha256,
    installed: {
      bundleId: "bot.punks.desktop.staging",
      binarySha256: "7c".repeat(32),
      launched: true,
      executable: "/opt/punks/punks-bot-staging",
    },
    verifications: Object.fromEntries(
      [
        "signature",
        "identite-application",
        "protocol-handlers",
        "stockage-securise",
        "updater",
      ].map((id) => [
        id,
        {
          command: `verify-${id}`,
          exitCode: 0,
          observation: `${id} observed on the installed application`,
        },
      ]),
    ),
    stories: REQUIRED_STORIES.map((id) => ({
      id,
      ui: [{ action: "activate", selector: `[data-story='${id}']` }],
      ipc: [{ command: `punks_${id.replaceAll("-", "_")}`, requestId: id }],
      contracts: [{ contract: `${id}.response@1`, status: "accepted" }],
    })),
    accessibility: Object.fromEntries(
      MATRICE_ACCESSIBILITE.map((criterion) => [
        criterion,
        {
          automated: [
            {
              tool: "platform-accessibility-audit",
              exitCode: 0,
              observation: `${criterion} automated audit passed`,
            },
          ],
          manual: [
            {
              tool: "reviewed-platform-checklist",
              observation: `${criterion} was observed on the installed UI`,
            },
          ],
          ...(criterion === "lecteur-ecran" ? { technology: "Orca" } : {}),
        },
      ]),
    ),
    follow: {
      request: FOLLOW_RECORD,
      trace,
      scenarios: Object.fromEntries(
        Object.entries(FOLLOW_SCENARIO_OUTCOMES).map(([id, outcome]) => [
          id,
          {
            outcome,
            observations: [`${id} exercised through the installed renderer`],
          },
        ]),
      ),
    },
  };
}

function boundaries(input, mutate = () => {}) {
  return {
    installedDriver: {
      async exercise(request) {
        assert.equal(request.platform, PLATFORM);
        assert.equal(request.candidateSha, SOURCE_SHA);
        assert.equal(
          request.artifactSha256,
          sha256(readFileSync(input.artifact)),
        );
        writeFileSync(
          request.networkLog,
          `${JSON.stringify(COMPATIBILITY_RECORD)}\n${JSON.stringify(FOLLOW_RECORD)}\n`,
          { flag: "wx" },
        );
        const value = observation(request.artifactSha256);
        mutate(value);
        return value;
      },
    },
    async observeCompatibility(request) {
      assert.equal(
        request.url,
        "https://staging.punks.bot/api/v1/desktop/compatibility",
      );
      assert.equal(request.body.profile, "desktop-social-loop@1");
      assert.equal(request.body.distribution, "staging");
      assert.equal(request.body.platform, PLATFORM);
      return {
        status: 200,
        workerVersionsHeader: Buffer.from(
          JSON.stringify(RUNTIME_WORKERS),
        ).toString("base64url"),
        body: {
          contract: "desktop.compatibility-response@1",
          compatible: true,
          profile: "desktop-social-loop@1",
          registryVersion: 1,
          minimumClientVersion: "0.6.0",
          environment: "staging",
          origin: "https://staging.punks.bot",
          capabilities: [
            "account-session",
            "workspace-mount",
            "stream-directory",
            "message-history",
            "conversation-follow",
            "message-post",
            "unicode-reactions",
          ],
        },
      };
    },
  };
}

test("derives the transcript from installed UI, IPC, contracts and the Rust network log", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));

  const transcript = await exerciseInstalledSocialLoop(
    {
      platform: PLATFORM,
      candidateSha: SOURCE_SHA,
      stagingDeploymentProof: input.stagingProof,
      bundle: input.bundle,
      installedArtifact: input.artifact,
      networkLog: input.networkLog,
      output: input.output,
    },
    boundaries(input),
  );

  assert.deepEqual(JSON.parse(readFileSync(input.output, "utf8")), transcript);
  assert.equal(transcript.result, "vert");
  assert.equal(transcript.serveurVite, false);
  assert.equal(transcript.facadeTest, false);
  assert.deepEqual(
    transcript.stories.map(({ id }) => id),
    REQUIRED_STORIES,
  );
  assert.ok(
    transcript.stories.every(
      ({ via, assertions }) =>
        JSON.stringify(via) ===
          JSON.stringify(["ui", "ipc-rust", "contrats-publics"]) &&
        assertions.some((value) => value.includes("IPC")),
    ),
  );
  assert.deepEqual(transcript.network.requests, [
    COMPATIBILITY_RECORD,
    FOLLOW_RECORD,
  ]);
  assert.deepEqual(transcript.network.follow.trace.at(-1), {
    state: "terminal",
    cursor: "cursor-2",
  });
});

test("writes no transcript when a story lacks an observed IPC crossing", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const invalid = boundaries(input, (value) => {
    value.stories[0].ipc = [];
  });

  await assert.rejects(
    exerciseInstalledSocialLoop(
      {
        platform: PLATFORM,
        candidateSha: SOURCE_SHA,
        stagingDeploymentProof: input.stagingProof,
        bundle: input.bundle,
        installedArtifact: input.artifact,
        networkLog: input.networkLog,
        output: input.output,
      },
      invalid,
    ),
    /connexion.*IPC/i,
  );
  assert.throws(() => readFileSync(input.output), /ENOENT/);
});

test("the CLI accepts no transcript, driver binary, boundary or skip", async () => {
  await assert.rejects(
    run([
      "--platform",
      PLATFORM,
      "--source-sha",
      SOURCE_SHA,
      "--staging-deployment-proof",
      "proof.json",
      "--bundle",
      "bundle",
      "--installed-artifact",
      "candidate.AppImage",
      "--network-log",
      "network.jsonl",
      "--output",
      "transcript.json",
      "--driver",
      "fake-driver",
    ]),
    /exact installed exercise CLI arguments/i,
  );
});
