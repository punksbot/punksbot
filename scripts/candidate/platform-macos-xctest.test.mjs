import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTHENTICATION_SCENARIO_OUTCOMES,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
} from "../promotion-installed-transcript-lib.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import {
  exerciseMacosInstalledCandidate,
  macosXctestCommands,
} from "./platform-macos-xctest.mjs";

test("builds the reviewed XCTest bundle before running it without rebuilding", () => {
  const commands = macosXctestCommands("/tmp/punks-xctest-build");
  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, "xcodebuild");
  assert.ok(commands[0].args.includes("build-for-testing"));
  assert.equal(commands[0].args.includes("test"), false);
  assert.equal(commands[1].command, "xcodebuild");
  assert.ok(commands[1].args.includes("test-without-building"));
  assert.equal(commands[1].args.includes("build-for-testing"), false);
  assert.ok(
    commands.every(({ args }) =>
      args.includes("/tmp/punks-xctest-build/PunksPromotionDriver.xcodeproj"),
    ),
  );
});

test("accepts only a create-only XCTest result emitted for the installed app", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-xctest-driver-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "Punks Bot Staging.app");
  const outputs = {
    ipc: join(root, "ipc.jsonl"),
    network: join(root, "network.jsonl"),
    embeddedAssets: join(root, "embedded-assets.json"),
    platformLog: join(root, "platform-driver.log"),
    screenReaderLog: join(root, "screen-reader.log"),
  };
  mkdirSync(app);

  const result = await exerciseMacosInstalledCandidate(
    {
      platform: "macos-arm64",
      candidateSha: "ab".repeat(20),
      stagingDeploymentId: `sha256:${"cd".repeat(32)}`,
      artifactSha256: "ef".repeat(32),
      authorities: ["auth-session", "api-conversation"],
      installedRoot: root,
      nativeBinary: join(app, "Contents", "MacOS", "punks-bot-staging"),
      screenReaderBinary:
        "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOver",
      fixture: {
        sessionId: "70000000-0000-4000-8000-000000000001",
        sessionRevocationId: "70000000-0000-4000-8000-000000000002",
        punkId: "80000000-0000-8000-8000-000000000058",
        workspaceId: "w",
        conversationId: "c",
      },
      faultContext: { output: join(root, "fault-observation.json") },
      outputs,
    },
    {
      async withScreenReader(input, action) {
        assert.equal(input.platform, "macos-arm64");
        assert.equal(input.log, outputs.screenReaderLog);
        const value = await action();
        writeFileSync(
          input.log,
          "VoiceOver application=Punks Bot Staging AXWebArea\n",
          { flag: "wx" },
        );
        return {
          value,
          technology: "VoiceOver",
          observation: "application=Punks Bot Staging AXWebArea",
        };
      },
      async runXctest({ resultPath, screenshots }) {
        mkdirSync(screenshots);
        for (const story of REQUIRED_STORIES) {
          writeFileSync(join(screenshots, `${story}.png`), `png:${story}`);
        }
        for (const [name, path] of Object.entries(outputs)) {
          if (name === "ipc") {
            writeFileSync(
              path,
              `${[
                {
                  sequence: 1,
                  command: "punks_promotion_auth_conformance",
                  status: "ok",
                  coordinates: {
                    scenarios: Object.fromEntries(
                      Object.entries(AUTHENTICATION_SCENARIO_OUTCOMES).map(
                        ([id, outcome]) => [
                          id,
                          { outcome, observations: [`${id} compiled`] },
                        ],
                      ),
                    ),
                  },
                },
                {
                  sequence: 2,
                  command: "punks_follow_conversation",
                  status: "ok",
                  coordinates: {
                    operationId: "11111111-1111-4111-8111-111111111111",
                    afterCursor: 0,
                  },
                },
                {
                  sequence: 3,
                  command: "punks_promotion_live_follow_conformance",
                  status: "ok",
                  coordinates: {
                    operationId: "11111111-1111-4111-8111-111111111111",
                    scenarios: Object.fromEntries(
                      Object.entries(FOLLOW_SCENARIO_OUTCOMES).map(
                        ([id, outcome]) => [
                          id,
                          { outcome, observations: [`${id} embedded`] },
                        ],
                      ),
                    ),
                  },
                },
                {
                  sequence: 4,
                  command: "punks_get_account_session_state",
                  status: "ok",
                  coordinates: {
                    state: "authenticated",
                    punkId: "80000000-0000-8000-8000-000000000058",
                  },
                },
              ]
                .map((record) => JSON.stringify(record))
                .join("\n")}\n`,
            );
          } else if (name !== "screenReaderLog") {
            writeFileSync(path, "observed\n");
          }
        }
        writeFileSync(
          resultPath,
          `${JSON.stringify({
            schema: "punks.macos-xctest-result.v1",
            platform: "macos-arm64",
            bundleId: "bot.punks.desktop.staging",
            executable: join(app, "Contents", "MacOS", "punks-bot-staging"),
            authentication: { complete: true },
            ui: REQUIRED_STORIES.map((story) => ({
              story,
              action: "xctest",
              selector: story,
              outcome: "visible",
            })),
            accessibility: Object.fromEntries(
              MATRICE_ACCESSIBILITE.map((criterion) => [
                criterion,
                {
                  automated: [
                    {
                      tool: "XCTest",
                      exitCode: 0,
                      observation: `${criterion} automated`,
                    },
                  ],
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
              trace: Array.from({ length: 7 }, (_, index) => ({ index })),
              scenarios: Object.fromEntries(
                Object.entries(FOLLOW_SCENARIO_OUTCOMES).map(
                  ([id, outcome]) => [
                    id,
                    { outcome, observations: [`${id} observed`] },
                  ],
                ),
              ),
            },
          })}\n`,
        );
      },
    },
  );

  assert.equal(result.installed.bundleId, "bot.punks.desktop.staging");
  assert.deepEqual(
    result.ui.map(({ story }) => story),
    REQUIRED_STORIES,
  );
  assert.ok(
    Object.values(result.screenshots).every(
      (content) => Buffer.isBuffer(content) && content.length > 0,
    ),
  );
  assert.equal(result.accessibility["lecteur-ecran"].technology, "VoiceOver");
  assert.equal(result.accessibility["lecteur-ecran"].automated.length, 2);
  assert.equal("manual" in result.accessibility["lecteur-ecran"], false);
});
