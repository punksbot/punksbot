import { execFileSync, spawn } from "node:child_process";
import {
  constants as fsConstants,
  copyFileSync,
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

const XCTEST_ENVIRONMENT_KEYS = Object.freeze([
  "PUNKS_XCTEST_APPLICATION",
  "PUNKS_XCTEST_RESULT",
  "PUNKS_XCTEST_SCREENSHOTS",
  "PUNKS_XCTEST_PLATFORM",
  "PUNKS_XCTEST_FIXTURE",
  "PUNKS_XCTEST_NATIVE_BINARY",
  "PUNKS_PROMOTION_ASSET_MANIFEST",
  "PUNKS_PROMOTION_IPC_LOG",
  "PUNKS_PROMOTION_NETWORK_LOG",
  "PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT",
  "PUNKS_XCTEST_ARTIFACT_SHA256",
]);
const XCTEST_IDENTIFIERS = Object.freeze({
  installed:
    "PunksPromotionUITests/PunksPromotionUITests/testInstalledSocialLoop",
  accessibility:
    "PunksPromotionUITests/PunksPromotionUITests/testIndependentAccessibilityReview",
});

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

function findXctestruns(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) continue;
    if (status.isDirectory()) {
      findXctestruns(path, found);
    } else if (status.isFile() && entry.name.endsWith(".xctestrun")) {
      found.push(realpathSync(path));
    }
  }
  return found;
}

function exactXctestrun(buildRoot) {
  const files = findXctestruns(realpathSync(buildRoot));
  if (files.length !== 1) {
    fail("build-for-testing must emit exactly one .xctestrun plan");
  }
  return files[0];
}

function xmlAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function containsInvalidXmlControl(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      codePoint < 0x20 &&
      ![0x09, 0x0a, 0x0d].includes(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

function closedXctestEnvironmentEntries(environmentVariables) {
  const expectedEnvironmentKeys = [...XCTEST_ENVIRONMENT_KEYS].sort();
  const environmentKeys =
    environmentVariables !== null &&
    typeof environmentVariables === "object" &&
    !Array.isArray(environmentVariables)
      ? Object.keys(environmentVariables).sort()
      : [];
  if (
    environmentKeys.length !== expectedEnvironmentKeys.length ||
    environmentKeys.some(
      (key, index) => key !== expectedEnvironmentKeys[index],
    ) ||
    environmentKeys.some((key) => {
      const value = environmentVariables[key];
      return (
        typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        containsInvalidXmlControl(value)
      );
    })
  ) {
    fail("generated scheme requires the closed XCTest environment");
  }
  return environmentKeys.map((key) => [key, environmentVariables[key]]);
}

export function configureMacosXctestSchemeContent(
  content,
  environmentVariables,
) {
  if (typeof content !== "string") {
    fail("generated XCTest scheme is not text");
  }
  const environmentEntries =
    closedXctestEnvironmentEntries(environmentVariables);
  const buildActions = [
    ...content.matchAll(/<BuildAction\b[\s\S]*?<\/BuildAction>/gu),
  ];
  const testActions = [
    ...content.matchAll(/<TestAction\b[\s\S]*?<\/TestAction>/gu),
  ];
  if (buildActions.length !== 1 || testActions.length !== 1) {
    fail("generated XCTest scheme has no unique build/test actions");
  }
  const buildAction = buildActions[0][0];
  const testAction = testActions[0][0];
  const buildableReferences = [
    ...buildAction.matchAll(/<BuildableReference\b[\s\S]*?\/>/gu),
  ];
  if (
    buildableReferences.length !== 1 ||
    !buildableReferences[0][0].includes(
      'BlueprintName="PunksPromotionUITests"',
    ) ||
    !testAction.includes('buildConfiguration="Release"') ||
    !testAction.includes('shouldUseLaunchSchemeArgsEnv="YES"') ||
    !testAction.includes("<Testables/>") ||
    !testAction.includes("<AdditionalOptions/>") ||
    testAction.includes("<EnvironmentVariables>")
  ) {
    fail("generated XCTest scheme does not match the closed UI-test target");
  }
  const environmentXml = environmentEntries
    .map(
      ([key, value]) =>
        `         <EnvironmentVariable key="${key}" value="${xmlAttribute(value)}" isEnabled="YES"/>`,
    )
    .join("\n");
  const configuredTestAction = testAction
    .replace(
      'shouldUseLaunchSchemeArgsEnv="YES"',
      'shouldUseLaunchSchemeArgsEnv="NO"',
    )
    .replace(
      "<Testables/>",
      `<Testables>\n         <TestableReference skipped="NO">\n${buildableReferences[0][0]}\n         </TestableReference>\n      </Testables>`,
    )
    .replace(
      "<AdditionalOptions/>",
      `<EnvironmentVariables>\n${environmentXml}\n      </EnvironmentVariables>\n      <AdditionalOptions/>`,
    );
  return content.replace(testAction, configuredTestAction);
}

function configureGeneratedXctestScheme(buildRoot, environmentVariables) {
  const path = join(
    buildRoot,
    "PunksPromotionDriver.xcodeproj",
    "xcshareddata",
    "xcschemes",
    "PunksPromotionUITests.xcscheme",
  );
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink()) {
    fail("generated XCTest scheme must be one regular file");
  }
  const configured = configureMacosXctestSchemeContent(
    readFileSync(path, "utf8"),
    environmentVariables,
  );
  writeFileSync(path, configured, { encoding: "utf8" });
  if (readFileSync(path, "utf8") !== configured) {
    fail("generated XCTest scheme write did not persist");
  }
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

export function macosXctestrunEnvironmentCommands(
  xctestrun,
  environmentVariables,
) {
  if (typeof xctestrun !== "string" || xctestrun.length === 0) {
    fail("rebound .xctestrun path is missing");
  }
  return closedXctestEnvironmentEntries(environmentVariables).map(
    ([key, value]) => ({
      command: "/usr/bin/plutil",
      args: [
        "-replace",
        `PunksPromotionUITests.EnvironmentVariables.${key}`,
        "-string",
        value,
        xctestrun,
      ],
      key,
      value,
    }),
  );
}

async function rebindXctestrunEnvironment({
  source,
  destination,
  environmentVariables,
  log,
}) {
  copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
  const status = lstatSync(destination);
  if (!status.isFile() || status.isSymbolicLink()) {
    fail("rebound .xctestrun must be one regular create-only file");
  }
  const commands = macosXctestrunEnvironmentCommands(
    destination,
    environmentVariables,
  );
  for (const command of commands) {
    await runCommand(command.command, command.args, {
      stdio: ["ignore", log, log],
    });
    const observed = execFileSync(
      command.command,
      [
        "-extract",
        `PunksPromotionUITests.EnvironmentVariables.${command.key}`,
        "raw",
        "-o",
        "-",
        destination,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", log] },
    ).trimEnd();
    if (observed !== command.value) {
      fail(`rebound .xctestrun did not persist ${command.key}`);
    }
  }
}

export function macosXctestCommands(
  buildRoot,
  xctestrun = join(buildRoot, "PunksPromotionUITests.xctestrun"),
  testKind = "installed",
) {
  const testIdentifier = XCTEST_IDENTIFIERS[testKind];
  if (testIdentifier === undefined) {
    fail("XCTest invocation requires one closed reviewed test kind");
  }
  const build = [
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
    { command: "xcodebuild", args: [...build, "build-for-testing"] },
    {
      command: "xcodebuild",
      args: [
        "-xctestrun",
        xctestrun,
        "-destination",
        "platform=macOS",
        "CODE_SIGNING_ALLOWED=NO",
        "test-without-building",
        `-only-testing:${testIdentifier}`,
      ],
    },
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
  const xctestEnvironment = {
    PUNKS_XCTEST_APPLICATION: application,
    PUNKS_XCTEST_RESULT: resultPath,
    PUNKS_XCTEST_SCREENSHOTS: screenshots,
    PUNKS_XCTEST_PLATFORM: input.platform,
    PUNKS_XCTEST_FIXTURE: JSON.stringify(input.fixture),
    PUNKS_XCTEST_NATIVE_BINARY: input.nativeBinary,
    PUNKS_PROMOTION_ASSET_MANIFEST: input.outputs.embeddedAssets,
    PUNKS_PROMOTION_IPC_LOG: input.outputs.ipc,
    PUNKS_PROMOTION_NETWORK_LOG: input.outputs.network,
    PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT: join(
      dirname(input.outputs.platformLog),
      "macos-independent-accessibility-review.json",
    ),
    PUNKS_XCTEST_ARTIFACT_SHA256: input.artifactSha256,
  };
  const environment = { ...process.env, ...xctestEnvironment };
  await runCommand(
    "cmake",
    ["-S", projectRoot, "-B", buildRoot, "-G", "Xcode"],
    { env: environment, stdio: ["ignore", log, log] },
  );
  configureGeneratedXctestScheme(buildRoot, xctestEnvironment);
  const buildInvocation = macosXctestCommands(buildRoot)[0];
  await runCommand(buildInvocation.command, buildInvocation.args, {
    env: environment,
    stdio: ["ignore", log, log],
  });
  const testInvocation = macosXctestCommands(
    buildRoot,
    exactXctestrun(buildRoot),
  )[1];
  await runCommand(testInvocation.command, testInvocation.args, {
    env: environment,
    stdio: ["ignore", log, log],
  });
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
  const xctestEnvironment = {
    PUNKS_XCTEST_APPLICATION: application,
    PUNKS_XCTEST_RESULT: resultPath,
    PUNKS_XCTEST_SCREENSHOTS: join(
      dirname(input.outputs.platformLog),
      "macos-independent-accessibility-screenshots",
    ),
    PUNKS_XCTEST_ACCESSIBILITY_REVIEW_RESULT: resultPath,
    PUNKS_XCTEST_PLATFORM: input.platform,
    PUNKS_XCTEST_FIXTURE: JSON.stringify(input.fixture),
    PUNKS_XCTEST_NATIVE_BINARY: input.nativeBinary,
    PUNKS_XCTEST_ARTIFACT_SHA256: input.artifactSha256,
    PUNKS_PROMOTION_ASSET_MANIFEST: input.outputs.embeddedAssets,
    PUNKS_PROMOTION_IPC_LOG: input.outputs.ipc,
    PUNKS_PROMOTION_NETWORK_LOG: input.outputs.network,
  };
  const environment = { ...process.env, ...xctestEnvironment };
  const independentXctestrun = join(
    buildRoot,
    `PunksPromotionUITests-${input.platform}-accessibility.xctestrun`,
  );
  await rebindXctestrunEnvironment({
    source: exactXctestrun(buildRoot),
    destination: independentXctestrun,
    environmentVariables: xctestEnvironment,
    log,
  });
  const invocation = macosXctestCommands(
    buildRoot,
    independentXctestrun,
    "accessibility",
  )[1];
  await runCommand(invocation.command, invocation.args, {
    env: environment,
    stdio: ["ignore", log, log],
  });
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
