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

import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { REQUIRED_STORIES } from "../promotion-installed-transcript-lib.mjs";
import { exerciseReviewedInstalledCandidate } from "./reviewed-installed-driver.mjs";

const PLATFORM = "linux-x64";
const SOURCE_SHA = "8a".repeat(20);
const DEPLOYMENT_ID = `sha256:${"8b".repeat(32)}`;
const ARTIFACT_SHA256 = "8c".repeat(32);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-reviewed-driver-"));
  const rawEvidence = join(root, "raw");
  const installedRoot = join(root, "installed");
  const nativeBinary = join(installedRoot, "usr", "bin", "punks-bot-staging");
  const nativeProof = join(root, "native-proof.json");
  mkdirSync(join(installedRoot, "usr", "bin"), { recursive: true });
  writeFileSync(nativeBinary, "native candidate\n");
  writeFileSync(
    nativeProof,
    `${JSON.stringify({
      schema: "punks.desktop-native-proof.v1",
      platform: PLATFORM,
      verified: true,
      identity: "signed-linux-test-key",
      timestamped: false,
      embeddedAppImageSignature: true,
      detachedDebSignature: true,
    })}\n`,
  );
  return { root, rawEvidence, installedRoot, nativeBinary, nativeProof };
}

function ipcRecords() {
  const commands = [
    "punks_check_compatibility",
    "punks_list_workspaces",
    "punks_open_workspace",
    "punks_list_streams",
    "punks_get_timeline",
    "punks_get_timeline",
    "punks_follow_conversation",
    "punks_follow_next",
    "punks_confirm_follow_batch",
    "punks_post_message",
    "punks_get_thread",
    "punks_post_message",
    "punks_add_reaction",
  ];
  return commands.map((command, index) => ({
    schema: "punks.native-ipc-observation.v1",
    sequence: index + 1,
    observedAtMs: 1_787_733_000_000 + index,
    command,
    status: "ok",
    contract: "observed.contract@1",
    coordinates: {},
  }));
}

test("binds real platform automation to native IPC and create-only raw evidence", async (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));

  const observation = await exerciseReviewedInstalledCandidate(
    {
      platform: PLATFORM,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      artifactSha256: ARTIFACT_SHA256,
      installedRoot: input.installedRoot,
      nativeBinary: input.nativeBinary,
      nativeProof: input.nativeProof,
      rawEvidence: input.rawEvidence,
      fixture: {
        sessionId: "55555555-5555-4555-8555-555555555555",
        punkId: "66666666-6666-4666-8666-666666666666",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspaceSlug: "promotion-fixture",
        conversationId: "22222222-2222-4222-8222-222222222222",
        seedMessageIds: ["33333333-3333-4333-8333-333333333333"],
        replyMessageId: "44444444-4444-4444-8444-444444444444",
      },
      authorities: ["auth-session"],
      manualReview: null,
    },
    {
      platformAutomation: {
        async exercise({ outputs }) {
          writeFileSync(outputs.platformLog, "webdriver observed\n", {
            flag: "wx",
          });
          writeFileSync(outputs.screenReaderLog, "screen reader observed\n", {
            flag: "wx",
          });
          writeFileSync(
            outputs.ipc,
            `${ipcRecords()
              .map((record) => JSON.stringify(record))
              .join("\n")}\n`,
            { flag: "wx" },
          );
          writeFileSync(
            outputs.network,
            `${JSON.stringify({
              transport: "https",
              method: "POST",
              origin: "https://staging.punks.bot",
              path: "/api/v1/desktop/compatibility",
              status: 200,
            })}\n${JSON.stringify({
              transport: "wss",
              method: "FOLLOW",
              origin: "wss://staging.punks.bot",
              path: "/api/v1/workspaces/w/conversations/c/follow",
              status: 101,
            })}\n`,
            { flag: "wx" },
          );
          writeFileSync(outputs.embeddedAssets, "embedded assets\n", {
            flag: "wx",
          });
          return {
            installed: {
              bundleId: "bot.punks.desktop.staging",
              launched: true,
              executable: input.nativeBinary,
            },
            ui: REQUIRED_STORIES.map((story) => ({
              story,
              action: "observed",
              selector: `[data-story='${story}']`,
              outcome: "visible",
            })),
            screenshots: Object.fromEntries(
              REQUIRED_STORIES.map((story) => [
                story,
                Buffer.from(`png:${story}`),
              ]),
            ),
            accessibility: Object.fromEntries(
              MATRICE_ACCESSIBILITE.map((criterion) => [
                criterion,
                {
                  automated: [
                    {
                      tool: "platform-accessibility-audit",
                      exitCode: 0,
                      observation: `${criterion} automated`,
                    },
                  ],
                  ...(criterion === "lecteur-ecran"
                    ? { technology: "Orca" }
                    : {}),
                },
              ]),
            ),
            follow: {
              request: {
                transport: "wss",
                method: "FOLLOW",
                origin: "wss://staging.punks.bot",
                path: "/api/v1/workspaces/w/conversations/c/follow",
                status: 101,
              },
              trace: [{ state: "terminal", cursor: "cursor-2" }],
              scenarios: {},
            },
          };
        },
      },
      accessibilityReviewer: {
        async review({ outputs }) {
          writeFileSync(
            outputs.platformLog,
            "independent accessibility driver observed\n",
            { flag: "wx" },
          );
          writeFileSync(
            outputs.screenReaderLog,
            "independent screen reader observed\n",
            { flag: "wx" },
          );
          writeFileSync(outputs.ipc, "independent ipc observed\n", {
            flag: "wx",
          });
          writeFileSync(outputs.network, "independent network observed\n", {
            flag: "wx",
          });
          writeFileSync(
            outputs.embeddedAssets,
            "independent assets observed\n",
            {
              flag: "wx",
            },
          );
          return Object.fromEntries(
            MATRICE_ACCESSIBILITE.map((criterion) => [
              criterion,
              {
                tool: "independent-tauri-driver",
                reviewer: "independent-platform-review-process",
                observation: `${criterion} reviewed in a second installed process`,
              },
            ]),
          );
        },
      },
      faultController: {
        async exercise({ output }) {
          const value = {
            schema: "punks.installed-resilience-observation.v1",
            platform: PLATFORM,
            candidateSha: SOURCE_SHA,
            stagingDeploymentId: DEPLOYMENT_ID,
            artifactSha256: ARTIFACT_SHA256,
            scenarios: [],
          };
          writeFileSync(output, `${JSON.stringify(value)}\n`, { flag: "wx" });
          return value;
        },
      },
    },
  );

  assert.equal(
    observation.installed.binarySha256,
    sha256("native candidate\n"),
  );
  assert.deepEqual(
    observation.stories.map(({ id }) => id),
    REQUIRED_STORIES,
  );
  assert.match(observation.rawEvidence.indexSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    observation.accessibility.clavier.manual[0].reviewer,
    "independent-platform-review-process",
  );
  const index = JSON.parse(
    readFileSync(join(input.rawEvidence, "index.json"), "utf8"),
  );
  assert.deepEqual(
    index.files.map(({ path }) => path),
    [
      "accessibility.json",
      "accessibility-review.log",
      "accessibility-review-embedded-assets.json",
      "accessibility-review-ipc.jsonl",
      "accessibility-review-network.jsonl",
      "accessibility-review-screen-reader.log",
      "embedded-assets.json",
      "fault-controller.json",
      "ipc.jsonl",
      "native-proof.json",
      "network.jsonl",
      "platform-driver.log",
      "screen-reader.log",
      ...REQUIRED_STORIES.map((story) => `screenshots/${story}.png`).sort(),
      "ui.jsonl",
    ].sort(),
  );
  for (const file of index.files) assert.match(file.sha256, /^[0-9a-f]{64}$/);
});
