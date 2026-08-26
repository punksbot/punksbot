import { spawn } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
} from "../promotion-installed-transcript-lib.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import {
  authenticationFromIpc,
  followScenariosFromIpc,
  traceFromIpc,
} from "./platform-installed-automation.mjs";
import { withNativeScreenReader } from "./native-screen-reader.mjs";
import {
  exerciseIndependentFaultMatrix,
  promotionAuthorityTargets,
} from "./independent-fault-controller.mjs";

function fail(message) {
  throw new Error(`macOS XCTest installed driver rejected: ${message}`);
}

function findApplications(root, directory = root, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) continue;
    if (status.isDirectory() && entry.name.endsWith(".app")) {
      found.push(realpathSync(path));
    } else if (status.isDirectory()) {
      findApplications(root, path, found);
    }
  }
  return found;
}

function exactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

async function runCommand(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function macosXctestCommands(buildRoot) {
  const common = [
    "-project",
    join(buildRoot, "PunksPromotionDriver.xcodeproj"),
    "-scheme",
    "PunksPromotionUITests",
    "-configuration",
    "Release",
    "-destination",
    "platform=macOS",
    "-derivedDataPath",
    join(buildRoot, "DerivedData"),
    "CODE_SIGNING_ALLOWED=NO",
  ];
  return [
    { command: "xcodebuild", args: [...common, "build-for-testing"] },
    { command: "xcodebuild", args: [...common, "test-without-building"] },
  ];
}

async function runReviewedXctest({
  input,
  application,
  resultPath,
  screenshots,
}) {
  const projectRoot = resolve(import.meta.dirname, "drivers", "macos-xctest");
  const buildRoot = join(
    process.env.RUNNER_TEMP ?? dirname(input.installedRoot),
    `punks-xctest-build-${input.platform}`,
  );
  mkdirSync(buildRoot, { mode: 0o700 });
  writeFileSync(
    input.outputs.platformLog,
    `${JSON.stringify({
      schema: "punks.platform-driver-log.v1",
      platform: input.platform,
      driver: "xctest",
      application,
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const log = openSync(input.outputs.platformLog, "a");
  const environment = {
    ...process.env,
    PUNKS_XCTEST_APPLICATION: application,
    PUNKS_XCTEST_RESULT: resultPath,
    PUNKS_XCTEST_SCREENSHOTS: screenshots,
    PUNKS_XCTEST_PLATFORM: input.platform,
    PUNKS_XCTEST_FIXTURE: JSON.stringify(input.fixture),
    PUNKS_XCTEST_NATIVE_BINARY: input.nativeBinary,
    PUNKS_PROMOTION_ASSET_MANIFEST: input.outputs.embeddedAssets,
    PUNKS_PROMOTION_IPC_LOG: input.outputs.ipc,
    PUNKS_PROMOTION_NETWORK_LOG: input.outputs.network,
  };
  await runCommand(
    "cmake",
    ["-S", projectRoot, "-B", buildRoot, "-G", "Xcode"],
    { env: environment, stdio: ["ignore", log, log] },
  );
  for (const invocation of macosXctestCommands(buildRoot)) {
    await runCommand(invocation.command, invocation.args, {
      env: environment,
      stdio: ["ignore", log, log],
    });
  }
}

async function runIndependentAccessibilityXctest({
  input,
  application,
  resultPath,
}) {
  const buildRoot = join(
    process.env.RUNNER_TEMP ?? dirname(input.installedRoot),
    `punks-xctest-build-${input.platform}`,
  );
  realpathSync(buildRoot);
  writeFileSync(
    input.outputs.platformLog,
    `${JSON.stringify({
      schema: "punks.independent-platform-review-log.v1",
      platform: input.platform,
      driver: "xctest-second-process",
      application,
      artifactSha256: input.artifactSha256,
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const log = openSync(input.outputs.platformLog, "a");
  const environment = {
    ...process.env,
    PUNKS_XCTEST_APPLICATION: application,
    PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT: resultPath,
    PUNKS_XCTEST_PLATFORM: input.platform,
    PUNKS_XCTEST_ARTIFACT_SHA256: input.artifactSha256,
    PUNKS_PROMOTION_ASSET_MANIFEST: input.outputs.embeddedAssets,
    PUNKS_PROMOTION_IPC_LOG: input.outputs.ipc,
    PUNKS_PROMOTION_NETWORK_LOG: input.outputs.network,
  };
  const invocation = macosXctestCommands(buildRoot)[1];
  await runCommand(
    invocation.command,
    [
      ...invocation.args,
      "-only-testing:PunksPromotionUITests/PunksPromotionUITests/testIndependentAccessibilityReview",
    ],
    { env: environment, stdio: ["ignore", log, log] },
  );
}

/** Runs a second XCTest process against the same extracted application. */
export async function reviewMacosInstalledAccessibility(
  input,
  {
    runXctest = runIndependentAccessibilityXctest,
    withScreenReader = withNativeScreenReader,
  } = {},
) {
  if (!["macos-arm64", "macos-x64"].includes(input.platform)) {
    fail("macOS platform is required for independent accessibility review");
  }
  const applications = findApplications(
    realpathSync(resolve(input.installedRoot)),
  );
  if (applications.length !== 1) {
    fail("independent review requires exactly one installed .app");
  }
  const resultPath = join(
    dirname(input.outputs.platformLog),
    "macos-independent-accessibility-review.json",
  );
  const session = await withScreenReader(
    {
      platform: input.platform,
      binary: input.screenReaderBinary,
      log: input.outputs.screenReaderLog,
      applicationTokens: [
        "Punks Bot Staging",
        "punks-bot-staging",
        "bot.punks.desktop.staging",
      ],
    },
    async () =>
      await runXctest({
        input,
        application: applications[0],
        resultPath,
      }),
  );
  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    fail("independent XCTest did not emit one review result");
  }
  exactKeys(
    result,
    ["schema", "platform", "artifactSha256", "criteria"],
    "independent XCTest review",
  );
  exactKeys(
    result.criteria,
    MATRICE_ACCESSIBILITE,
    "independent XCTest criteria",
  );
  if (
    result.schema !== "punks.independent-accessibility-review.v1" ||
    result.platform !== input.platform ||
    result.artifactSha256 !== input.artifactSha256
  ) {
    fail("independent XCTest review belongs to another artifact");
  }
  for (const path of [
    input.outputs.platformLog,
    input.outputs.screenReaderLog,
    input.outputs.ipc,
    input.outputs.network,
    input.outputs.embeddedAssets,
  ]) {
    if (readFileSync(path).length === 0) {
      fail("independent XCTest review output is empty");
    }
  }
  return Object.fromEntries(
    MATRICE_ACCESSIBILITE.map((criterion) => {
      const observation = result.criteria[criterion];
      if (typeof observation !== "string" || observation.trim() === "") {
        fail(`independent XCTest ${criterion} observation is missing`);
      }
      return [
        criterion,
        {
          tool: "independent-xctest-process",
          reviewer: "independent-platform-review-process",
          observation: `${observation}; native-screen-reader=${session.technology}`,
        },
      ];
    }),
  );
}

export async function exerciseMacosInstalledCandidate(
  input,
  {
    runXctest = runReviewedXctest,
    withScreenReader = withNativeScreenReader,
  } = {},
) {
  if (!["macos-arm64", "macos-x64"].includes(input.platform)) {
    fail("macOS platform is required");
  }
  const installedRoot = realpathSync(resolve(input.installedRoot));
  const applications = findApplications(installedRoot);
  if (applications.length !== 1) {
    fail("the updater must extract exactly one installed .app");
  }
  const resultPath = join(
    dirname(input.outputs.platformLog),
    "macos-xctest-result.json",
  );
  const screenshots = join(
    dirname(input.outputs.platformLog),
    "macos-xctest-screenshots",
  );
  const screenReaderSession = await withScreenReader(
    {
      platform: input.platform,
      binary: input.screenReaderBinary,
      log: input.outputs.screenReaderLog,
      applicationTokens: [
        "Punks Bot Staging",
        "punks-bot-staging",
        "bot.punks.desktop.staging",
      ],
    },
    async () =>
      await runXctest({
        input,
        application: applications[0],
        resultPath,
        screenshots,
      }),
  );
  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    fail("XCTest did not emit one JSON result");
  }
  if (input.gateReport !== undefined && input.gateLog !== undefined) {
    result.follow.trace = traceFromIpc(input.outputs.ipc);
  }
  result.follow.scenarios = followScenariosFromIpc(input.outputs.ipc);
  result.authentication = authenticationFromIpc(
    input.outputs.ipc,
    input.fixture,
  );
  if (input.faultContext?.output === undefined) {
    fail("macOS fault observation output is missing");
  }
  await exerciseIndependentFaultMatrix({
    platform: input.platform,
    candidateSha: input.candidateSha,
    stagingDeploymentId: input.stagingDeploymentId,
    artifactSha256: input.artifactSha256,
    authorities: input.authorities,
    targets: promotionAuthorityTargets(input.fixture, input.authorities),
    output: input.faultContext.output,
  });
  exactKeys(
    result,
    [
      "schema",
      "platform",
      "bundleId",
      "executable",
      "authentication",
      "ui",
      "accessibility",
      "follow",
    ],
    "XCTest result",
  );
  if (
    result.schema !== "punks.macos-xctest-result.v1" ||
    result.platform !== input.platform ||
    result.bundleId !== "bot.punks.desktop.staging" ||
    result.executable !== input.nativeBinary ||
    result.authentication?.complete !== true ||
    !Array.isArray(result.ui) ||
    result.ui.length !== REQUIRED_STORIES.length ||
    JSON.stringify(result.ui.map(({ story }) => story)) !==
      JSON.stringify(REQUIRED_STORIES)
  ) {
    fail("XCTest result belongs to another installation or is incomplete");
  }
  exactKeys(
    result.accessibility,
    MATRICE_ACCESSIBILITE,
    "XCTest accessibility result",
  );
  const screenReader = result.accessibility["lecteur-ecran"];
  if (
    screenReader === null ||
    typeof screenReader !== "object" ||
    Array.isArray(screenReader) ||
    !Array.isArray(screenReader.automated)
  ) {
    fail("XCTest screen-reader accessibility result is incomplete");
  }
  screenReader.automated.push({
    tool: `${screenReaderSession.technology}-native-session`,
    exitCode: 0,
    observation: screenReaderSession.observation,
  });
  screenReader.technology = screenReaderSession.technology;
  if (
    Object.entries(FOLLOW_SCENARIO_OUTCOMES).some(
      ([id, outcome]) => result.follow?.scenarios?.[id]?.outcome !== outcome,
    )
  ) {
    fail("XCTest FOLLOW scenarios are incomplete");
  }
  const screenshotFiles = Object.fromEntries(
    REQUIRED_STORIES.map((story) => {
      const content = readFileSync(join(screenshots, `${story}.png`));
      if (content.length === 0) fail(`XCTest screenshot ${story} is empty`);
      return [story, content];
    }),
  );
  for (const [name, path] of Object.entries(input.outputs)) {
    if (readFileSync(path).length === 0) {
      fail(`XCTest ${name} observation is empty`);
    }
  }
  return {
    installed: {
      bundleId: result.bundleId,
      launched: true,
      executable: result.executable,
    },
    ui: result.ui,
    screenshots: screenshotFiles,
    accessibility: result.accessibility,
    follow: result.follow,
  };
}
