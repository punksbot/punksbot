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
import { PREUVES_RECUPERATION } from "../promotion-resilience-lib.mjs";
import { assignedResilienceScenarios } from "./resilience-observation.mjs";
import {
  exerciseInstalledSocialLoop,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
  run,
} from "./exercise-installed-social-loop.mjs";

const SOURCE_SHA = "6b".repeat(20);
const PLATFORM = "linux-x64";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PUNK_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_REVOCATION_ID = "77777777-7777-4777-8777-777777777777";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const REPLY_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
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
const AUTHORITIES = JSON.parse(
  readFileSync(
    new URL("../../cloudflare/promotion-profiles.json", import.meta.url),
    "utf8",
  ),
).profiles[0].authorities.map(({ id }) => id);
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
  path: `/api/v1/workspaces/${WORKSPACE_ID}/conversations/${CONVERSATION_ID}/follow`,
  status: 101,
};

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function liveAuthMatrixProof() {
  const methods = ["google", "github", "passkey"];
  const flows = Object.fromEntries(
    methods.map((method, index) => {
      const common = {
        method,
        intent: "sign_in",
        environment: "staging",
        browserBindingHash: `${index + 1}`.repeat(64),
        nativeVerifierCommitment: `${index + 4}`.repeat(43),
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
      };
      return [
        method,
        {
          success: {
            ...common,
            flowId: `${index + 1}0000000-0000-8000-8000-000000000058`,
            outcomeCode:
              method === "passkey" ? "passkey_authenticated" : "authenticated",
            punkId: method === "github" ? PUNK_ID : crypto.randomUUID(),
            sessionId: method === "github" ? SESSION_ID : crypto.randomUUID(),
            browserCompletedAt: `2026-08-26T17:0${index}:00.000Z`,
            confirmedAt: `2026-08-26T17:0${index}:01.000Z`,
            methodEvidence:
              method === "passkey"
                ? {
                    kind: "passkey",
                    challengeHash: "a".repeat(64),
                    credentialIdHash: "b".repeat(64),
                  }
                : {
                    kind: "oauth",
                    oauthStateHash: "c".repeat(64),
                    providerPkceHash: "d".repeat(64),
                  },
          },
          cancellation: {
            ...common,
            flowId: `${index + 4}0000000-0000-8000-8000-000000000058`,
            outcomeCode: "cancelled",
            cancelledAt: `2026-08-26T17:0${index}:02.000Z`,
          },
        },
      ];
    }),
  );
  return {
    schema: "punks.live-staging-auth-matrix-proof.v2",
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    authWorkerVersionId: WORKERS[0].versionId,
    flows,
    negative: {
      wrongOauthState: "refused",
      wrongBrowserBinding: "refused",
      wrongNativePkceVerifier: "refused",
      wrongPasskeyChallenge: "refused",
    },
    observedAt: "2026-08-26T17:03:00.000Z",
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-installed-exercise-"));
  const artifact = join(
    root,
    `punks-desktop-${PLATFORM}-${SOURCE_SHA}.AppImage`,
  );
  const bundle = join(root, "bundle");
  const stagingProof = join(root, "staging-deployment-proof.json");
  const liveAuthProof = join(root, "live-staging-auth-proof.json");
  const liveFollowProof = join(root, "live-staging-follow-proof.json");
  const stagingFixture = join(root, "staging-fixture.json");
  const networkLog = join(root, "network.jsonl");
  const output = join(root, "transcript.json");
  const resilienceOutput = join(root, "resilience.json");
  const rawEvidenceOutput = join(root, "raw-evidence");
  const nativeBinary = join(bundle, "punks-bot-staging");
  const nativeProof = join(root, "native-proof.json");
  const faultObservation = join(root, "fault-observation.json");
  const operatorTokenFile = join(root, "operator-token");
  const manualReviewFile = join(root, "manual-review.json");
  const gateReport = join(root, "gate-report.json");
  const gateLog = join(root, "gate.log");
  const screenReaderBinary = join(root, "orca");
  mkdirSync(bundle);
  writeFileSync(nativeBinary, "installed native executable\n");
  writeFileSync(screenReaderBinary, "installed screen reader\n");
  writeFileSync(
    nativeProof,
    `${JSON.stringify({ schema: "punks.desktop-native-proof.v1" })}\n`,
  );
  writeFileSync(artifact, "signed installed candidate\n");
  writeFileSync(
    faultObservation,
    `${JSON.stringify(observation(sha256(readFileSync(artifact))).resilience)}\n`,
  );
  writeFileSync(gateReport, "{}\n");
  writeFileSync(gateLog, "observed gates\n");
  writeFileSync(
    operatorTokenFile,
    "operator-secret-never-output-000000000000\n",
  );
  writeFileSync(stagingProof, `${JSON.stringify(STAGING_PROOF, null, 2)}\n`);
  writeFileSync(liveAuthProof, `${JSON.stringify(liveAuthMatrixProof())}\n`);
  writeFileSync(
    liveFollowProof,
    `${JSON.stringify({
      schema: "punks.live-staging-follow-proof.v1",
      result: "PASS",
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      staging: "https://staging.punks.bot",
      workspaceId: WORKSPACE_ID,
      conversationId: CONVERSATION_ID,
      catchUpFrames: 53,
      initialCursor: 54,
      liveCursor: 55,
      crashBeforeAckCursor: 56,
      replayCursor: 56,
      scenarios: {
        catchUpAckReady: "vert",
        liveChangeAck: "vert",
        crashBeforeAckReplay: "vert",
        afterAckNoReplay: "vert",
        revokedSessionRejected: "vert",
      },
      observedAt: "2026-08-26T17:11:41.455Z",
    })}\n`,
  );
  writeFileSync(
    stagingFixture,
    `${JSON.stringify({
      schema: "punks.staging-promotion-fixture.v1",
      sourceSha: SOURCE_SHA,
      origin: "https://staging.punks.bot",
      sessionId: SESSION_ID,
      sessionRevocationId: SESSION_REVOCATION_ID,
      punkId: PUNK_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSlug: "promotion-fixture",
      conversationId: CONVERSATION_ID,
      topicRequired: true,
      seedMessageIds: Array.from(
        { length: 52 },
        (_, index) =>
          `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
      ),
      replyMessageId: REPLY_MESSAGE_ID,
    })}\n`,
  );
  return {
    root,
    artifact,
    bundle,
    stagingProof,
    liveAuthProof,
    liveFollowProof,
    stagingFixture,
    networkLog,
    output,
    resilienceOutput,
    rawEvidenceOutput,
    nativeBinary,
    nativeProof,
    faultObservation,
    operatorTokenFile,
    manualReviewFile,
    gateReport,
    gateLog,
    screenReaderBinary,
  };
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
              reviewer: "release-reviewer",
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
    resilience: {
      schema: "punks.installed-resilience-observation.v1",
      platform: PLATFORM,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      artifactSha256,
      scenarios: assignedResilienceScenarios(PLATFORM, AUTHORITIES).map(
        ({ type, authority }, index) => ({
          type,
          authority,
          executionId: `${PLATFORM}-${type}-${authority}`,
          injection: {
            startedAt: `2026-08-26T11:${String(index).padStart(2, "0")}:00.000Z`,
            observedAt: `2026-08-26T11:${String(index).padStart(2, "0")}:01.000Z`,
            operation: "installed-public-contract",
            failureKind: type === "revocation" ? "problem" : "transport",
            observations: [`${type}/${authority} failed closed`],
          },
          recoveries: Object.fromEntries(
            PREUVES_RECUPERATION.map((proof) => [
              proof,
              {
                observedAt: `2026-08-26T11:${String(index).padStart(2, "0")}:02.000Z`,
                observations: [`${proof} recovered ${type}/${authority}`],
              },
            ]),
          ),
        }),
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
        assert.equal(request.screenReaderBinary, input.screenReaderBinary);
        assert.deepEqual(request.fixture, {
          origin: "https://staging.punks.bot",
          sessionId: SESSION_ID,
          sessionRevocationId: SESSION_REVOCATION_ID,
          punkId: PUNK_ID,
          workspaceId: WORKSPACE_ID,
          workspaceSlug: "promotion-fixture",
          conversationId: CONVERSATION_ID,
          topicRequired: true,
          seedMessageIds: JSON.parse(readFileSync(input.stagingFixture, "utf8"))
            .seedMessageIds,
          replyMessageId: REPLY_MESSAGE_ID,
        });
        writeFileSync(
          request.networkLog,
          `${JSON.stringify(COMPATIBILITY_RECORD)}\n${JSON.stringify(FOLLOW_RECORD)}\n`,
          { flag: "wx" },
        );
        const value = observation(request.artifactSha256);
        mkdirSync(request.rawEvidence);
        writeFileSync(join(request.rawEvidence, "driver.log"), "observed\n");
        const files = [
          {
            path: "driver.log",
            size: Buffer.byteLength("observed\n"),
            sha256: sha256("observed\n"),
          },
        ];
        const indexContent = Buffer.from(
          `${JSON.stringify(
            {
              schema: "punks.installed-raw-evidence-index.v1",
              platform: PLATFORM,
              candidateSha: SOURCE_SHA,
              stagingDeploymentId: DEPLOYMENT_ID,
              artifactSha256: request.artifactSha256,
              files,
            },
            null,
            2,
          )}\n`,
        );
        writeFileSync(join(request.rawEvidence, "index.json"), indexContent);
        value.rawEvidence = {
          indexSha256: sha256(indexContent),
          files: files.length,
        };
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
      liveAuthProof: input.liveAuthProof,
      liveFollowProof: input.liveFollowProof,
      stagingFixture: input.stagingFixture,
      bundle: input.bundle,
      installedRoot: input.bundle,
      installedArtifact: input.artifact,
      networkLog: input.networkLog,
      output: input.output,
      resilienceOutput: input.resilienceOutput,
      rawEvidenceOutput: input.rawEvidenceOutput,
      nativeBinary: input.nativeBinary,
      nativeProof: input.nativeProof,
      faultObservation: input.faultObservation,
      operatorTokenFile: input.operatorTokenFile,
      manualReviewFile: input.manualReviewFile,
      gateReport: input.gateReport,
      gateLog: input.gateLog,
      screenReaderBinary: input.screenReaderBinary,
    },
    boundaries(input),
  );

  assert.deepEqual(JSON.parse(readFileSync(input.output, "utf8")), transcript);
  assert.equal(
    JSON.parse(readFileSync(input.resilienceOutput, "utf8")).scenarios.length,
    assignedResilienceScenarios(PLATFORM, AUTHORITIES).length,
  );
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
  assert.deepEqual(transcript.network.follow.distributed.scenarios, {
    catchUpAckReady: "vert",
    liveChangeAck: "vert",
    crashBeforeAckReplay: "vert",
    afterAckNoReplay: "vert",
    revokedSessionRejected: "vert",
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
        liveAuthProof: input.liveAuthProof,
        liveFollowProof: input.liveFollowProof,
        stagingFixture: input.stagingFixture,
        bundle: input.bundle,
        installedRoot: input.bundle,
        installedArtifact: input.artifact,
        networkLog: input.networkLog,
        output: input.output,
        resilienceOutput: input.resilienceOutput,
        rawEvidenceOutput: input.rawEvidenceOutput,
        nativeBinary: input.nativeBinary,
        nativeProof: input.nativeProof,
        faultObservation: input.faultObservation,
        operatorTokenFile: input.operatorTokenFile,
        manualReviewFile: input.manualReviewFile,
        gateReport: input.gateReport,
        gateLog: input.gateLog,
        screenReaderBinary: input.screenReaderBinary,
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
      "--live-auth-proof",
      "auth-proof.json",
      "--staging-fixture",
      "fixture.json",
      "--bundle",
      "bundle",
      "--installed-root",
      "installed",
      "--installed-artifact",
      "candidate.AppImage",
      "--network-log",
      "network.jsonl",
      "--output",
      "transcript.json",
      "--resilience-output",
      "resilience.json",
      "--raw-evidence-output",
      "raw-evidence",
      "--native-binary",
      "punks-bot-staging",
      "--native-proof",
      "native-proof.json",
      "--fault-observation",
      "fault-observation.json",
      "--operator-token-file",
      "operator-token",
      "--manual-review-file",
      "manual-review.json",
      "--gate-report",
      "gate-report.json",
      "--gate-log",
      "gate.log",
      "--screen-reader-binary",
      "orca",
      "--driver",
      "fake-driver",
    ]),
    /exact installed exercise CLI arguments/i,
  );
});
