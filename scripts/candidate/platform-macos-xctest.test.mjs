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
  configureMacosXctestSchemeContent,
  exerciseMacosInstalledCandidate,
  macosXctestCommands,
  macosXctestrunEnvironmentCommands,
} from "./platform-macos-xctest.mjs";

const XCTEST_ENVIRONMENT = {
  PUNKS_XCTEST_APPLICATION: '/tmp/Punks & "Staging".app',
  PUNKS_XCTEST_RESULT: "/tmp/result.json",
  PUNKS_XCTEST_SCREENSHOTS: "/tmp/screenshots",
  PUNKS_XCTEST_PLATFORM: "macos-arm64",
  PUNKS_XCTEST_FIXTURE: '{"workspaceSlug":"A&B"}',
  PUNKS_XCTEST_NATIVE_BINARY:
    "/tmp/Punks Bot Staging.app/Contents/MacOS/punks-bot-staging",
  PUNKS_PROMOTION_ASSET_MANIFEST: "/tmp/assets.json",
  PUNKS_PROMOTION_IPC_LOG: "/tmp/ipc.jsonl",
  PUNKS_PROMOTION_NETWORK_LOG: "/tmp/network.jsonl",
  PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT: "/tmp/accessibility.json",
  PUNKS_XCTEST_ARTIFACT_SHA256: "ef".repeat(32),
};
const ACCESSIBILITY_XCTEST_ENVIRONMENT = {
  ...XCTEST_ENVIRONMENT,
  PUNKS_XCTEST_RESULT: "/tmp/accessibility.json",
  PUNKS_XCTEST_SCREENSHOTS: "/tmp/accessibility-screenshots",
  PUNKS_PROMOTION_ASSET_MANIFEST: "/tmp/accessibility-assets.json",
  PUNKS_PROMOTION_IPC_LOG: "/tmp/accessibility-ipc.jsonl",
  PUNKS_PROMOTION_NETWORK_LOG: "/tmp/accessibility-network.jsonl",
};

test("adds the exact UI-test target to the generated Release scheme", () => {
  const reference = `<BuildableReference
               BuildableIdentifier="primary"
               BlueprintIdentifier="ABC123"
               BuildableName="PunksPromotionUITests.xctest/Contents/MacOS/PunksPromotionUITests"
               BlueprintName="PunksPromotionUITests"
               ReferencedContainer="container:/tmp/PunksPromotionDriver.xcodeproj"/>`;
  const buildAction = `<BuildAction><BuildActionEntries><BuildActionEntry>${reference}</BuildActionEntry></BuildActionEntries></BuildAction>`;
  const testAction =
    '<TestAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><Testables/><AdditionalOptions/></TestAction>';
  const scheme = `<Scheme>${buildAction}${testAction}</Scheme>`;
  const configured = configureMacosXctestSchemeContent(
    scheme,
    XCTEST_ENVIRONMENT,
  );
  assert.match(configured, /<TestableReference skipped="NO">/u);
  assert.match(configured, /shouldUseLaunchSchemeArgsEnv="NO"/u);
  assert.doesNotMatch(configured, /shouldUseLaunchSchemeArgsEnv="YES"/u);
  assert.equal(configured.match(/BlueprintIdentifier="ABC123"/gu)?.length, 2);
  assert.doesNotMatch(configured, /<Testables\/>/u);
  assert.match(configured, /<EnvironmentVariables>/u);
  for (const name of Object.keys(XCTEST_ENVIRONMENT)) {
    assert.equal(
      configured.match(new RegExp(`key="${name}"`, "gu"))?.length,
      1,
    );
  }
  assert.match(
    configured,
    /value="\/tmp\/Punks &amp; &quot;Staging&quot;\.app"/u,
  );
  assert.match(
    configured,
    /value="\{&quot;workspaceSlug&quot;:&quot;A&amp;B&quot;\}"/u,
  );
  assert.throws(
    () =>
      configureMacosXctestSchemeContent(
        `<Scheme>${buildAction}${buildAction}${testAction}</Scheme>`,
        XCTEST_ENVIRONMENT,
      ),
    /unique build\/test actions/,
  );
  assert.throws(
    () =>
      configureMacosXctestSchemeContent(
        `<Scheme>${buildAction}${testAction}${testAction}</Scheme>`,
        XCTEST_ENVIRONMENT,
      ),
    /unique build\/test actions/,
  );
  assert.throws(
    () =>
      configureMacosXctestSchemeContent(scheme, {
        ...XCTEST_ENVIRONMENT,
        UNREVIEWED_VARIABLE: "forbidden",
      }),
    /closed XCTest environment/u,
  );
  const missing = { ...XCTEST_ENVIRONMENT };
  delete missing.PUNKS_XCTEST_APPLICATION;
  assert.throws(
    () => configureMacosXctestSchemeContent(scheme, missing),
    /closed XCTest environment/u,
  );
});

test("builds the reviewed XCTest bundle before running it without rebuilding", () => {
  const xctestrun =
    "/tmp/punks-xctest-build/DerivedData/Build/Products/PunksPromotionUITests.xctestrun";
  const commands = macosXctestCommands("/tmp/punks-xctest-build", xctestrun);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, "xcodebuild");
  assert.ok(commands[0].args.includes("build-for-testing"));
  assert.equal(commands[0].args.includes("test"), false);
  assert.equal(commands[1].command, "xcodebuild");
  assert.ok(commands[1].args.includes("test-without-building"));
  assert.equal(commands[1].args.includes("build-for-testing"), false);
  assert.deepEqual(commands[1].args.slice(0, 2), ["-xctestrun", xctestrun]);
  assert.equal(commands[1].args.includes("-project"), false);
  assert.equal(commands[1].args.includes("-scheme"), false);
  assert.ok(
    commands[1].args.includes(
      "-only-testing:PunksPromotionUITests/PunksPromotionUITests/testInstalledSocialLoop",
    ),
  );
  const accessibility = macosXctestCommands(
    "/tmp/punks-xctest-build",
    xctestrun,
    "accessibility",
  )[1];
  assert.ok(
    accessibility.args.includes(
      "-only-testing:PunksPromotionUITests/PunksPromotionUITests/testIndependentAccessibilityReview",
    ),
  );
  assert.equal(
    accessibility.args.includes(
      "-only-testing:PunksPromotionUITests/PunksPromotionUITests/testInstalledSocialLoop",
    ),
    false,
  );
  assert.throws(
    () =>
      macosXctestCommands("/tmp/punks-xctest-build", xctestrun, "unreviewed"),
    /closed reviewed test kind/u,
  );
});

test("rebinds the independent XCTest plan to separate review evidence", () => {
  const xctestrun = "/tmp/punks-independent-accessibility.xctestrun";
  const commands = macosXctestrunEnvironmentCommands(
    xctestrun,
    ACCESSIBILITY_XCTEST_ENVIRONMENT,
  );
  assert.equal(commands.length, Object.keys(XCTEST_ENVIRONMENT).length);
  assert.ok(commands.every(({ command }) => command === "/usr/bin/plutil"));
  assert.ok(commands.every(({ args }) => args.at(-1) === xctestrun));
  const ipc = commands.find(({ key }) => key === "PUNKS_PROMOTION_IPC_LOG");
  assert.equal(ipc?.value, "/tmp/accessibility-ipc.jsonl");
  assert.deepEqual(ipc?.args.slice(0, 4), [
    "-replace",
    "PunksPromotionUITests.EnvironmentVariables.PUNKS_PROMOTION_IPC_LOG",
    "-string",
    "/tmp/accessibility-ipc.jsonl",
  ]);
  assert.notEqual(
    ACCESSIBILITY_XCTEST_ENVIRONMENT.PUNKS_PROMOTION_NETWORK_LOG,
    XCTEST_ENVIRONMENT.PUNKS_PROMOTION_NETWORK_LOG,
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
        workspaceId: "80000000-0000-8000-8000-000000000059",
        workspaceSlug: "promotion-fixture",
        conversationId: "80000000-0000-8000-8000-000000000060",
        seedMessageIds: ["80000000-0000-8000-8000-000000000061"],
        replyMessageId: "80000000-0000-8000-8000-000000000062",
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
