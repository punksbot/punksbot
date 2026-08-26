import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  REQUIRED_STORIES,
  VERIFICATIONS_ARTEFACT,
} from "../promotion-installed-transcript-lib.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { validateResilienceObservation } from "./resilience-observation.mjs";
import { manualAccessibilityForPlatform } from "./manual-accessibility-review.mjs";

const PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const STORY_COMMANDS = Object.freeze({
  connexion: ["punks_check_compatibility", "punks_list_workspaces"],
  workspace: ["punks_open_workspace", "punks_list_streams"],
  "lecture-live": [
    "punks_follow_conversation",
    "punks_follow_next",
    "punks_confirm_follow_batch",
  ],
  pagination: ["punks_get_timeline"],
  publication: ["punks_post_message"],
  reponse: ["punks_get_thread", "punks_post_message"],
  sujet: ["punks_post_message"],
  reactions: ["punks_add_reaction"],
});

function fail(message) {
  throw new Error(`reviewed installed driver rejected: ${message}`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function stableFile(path, label, root = null) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size < 1) {
    fail(`${label} must be one non-empty real regular file`);
  }
  const real = realpathSync(absolute);
  if (root !== null) {
    const contained = relative(root, real);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    ) {
      fail(`${label} escapes its evidence root`);
    }
  }
  let descriptor;
  try {
    descriptor = openSync(
      real,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail(`${label} changed while it was read`);
    }
    return { absolute: real, content, sha256: sha256(content) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseJson(file, label) {
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch {
    fail(`${label} is not JSON`);
  }
}

function parseJsonLines(file, label) {
  const lines = file.content
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
  if (lines.length === 0) fail(`${label} is empty`);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      return fail(`${label} line ${index + 1} is not JSON`);
    }
  });
}

function createEvidenceRoot(path) {
  const absolute = resolve(path);
  try {
    mkdirSync(absolute, { mode: 0o700 });
    mkdirSync(join(absolute, "screenshots"), { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("raw evidence output already exists");
    throw error;
  }
  return realpathSync(absolute);
}

function writeExclusive(path, content) {
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
}

function validateNativeProof(file, platform) {
  const proof = parseJson(file, "native proof");
  if (
    proof?.schema !== "punks.desktop-native-proof.v1" ||
    proof.platform !== platform ||
    proof.verified !== true ||
    typeof proof.identity !== "string" ||
    proof.identity.length === 0
  ) {
    fail("native proof is invalid or belongs to another platform");
  }
  return proof;
}

function validateUi(records) {
  if (!Array.isArray(records) || records.length !== REQUIRED_STORIES.length) {
    fail("platform UI observation set is incomplete");
  }
  const byStory = new Map();
  for (const record of records) {
    if (
      record === null ||
      typeof record !== "object" ||
      !REQUIRED_STORIES.includes(record.story) ||
      byStory.has(record.story) ||
      typeof record.action !== "string" ||
      record.action.length === 0 ||
      typeof record.selector !== "string" ||
      record.selector.length === 0 ||
      record.outcome !== "visible"
    ) {
      fail("platform UI observation is unknown, duplicate or invalid");
    }
    byStory.set(record.story, record);
  }
  return byStory;
}

function validateIpc(records) {
  let previous = 0;
  for (const record of records) {
    if (
      record?.schema !== "punks.native-ipc-observation.v1" ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence !== previous + 1 ||
      !Number.isSafeInteger(record.observedAtMs) ||
      record.observedAtMs < 1 ||
      typeof record.command !== "string" ||
      record.status !== "ok" ||
      typeof record.contract !== "string" ||
      record.contract.length === 0
    ) {
      fail("native IPC journal is invalid or not wholly green");
    }
    previous = record.sequence;
  }
  const commands = records.map(({ command }) => command);
  for (const [story, required] of Object.entries(STORY_COMMANDS)) {
    for (const command of required) {
      if (!commands.includes(command)) {
        fail(`native IPC journal lacks ${command} for ${story}`);
      }
    }
  }
}

function inventoryFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) fail("raw evidence contains a symbolic link");
    if (status.isDirectory()) {
      files.push(...inventoryFiles(root, path));
      continue;
    }
    if (!status.isFile()) fail("raw evidence contains a non-regular entry");
    const file = stableFile(path, "raw evidence file", root);
    files.push({
      path: relative(root, file.absolute).split(sep).join("/"),
      size: file.content.length,
      sha256: file.sha256,
    });
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

async function defaultPlatformAutomation(input) {
  const { exerciseInstalledPlatform } = await import(
    "./platform-installed-automation.mjs"
  );
  return exerciseInstalledPlatform(input);
}

async function defaultAccessibilityReviewer(input) {
  const { reviewInstalledAccessibility } = await import(
    "./platform-installed-accessibility-review.mjs"
  );
  return reviewInstalledAccessibility(input);
}

async function defaultFaultController(input) {
  const source = stableFile(
    input.faultObservation,
    "independent fault controller observation",
  );
  let observation;
  try {
    observation = JSON.parse(source.content.toString("utf8"));
    validateResilienceObservation(observation, {
      platform: input.platform,
      candidateSha: input.candidateSha,
      stagingDeploymentId: input.stagingDeploymentId,
      artifactSha256: input.artifactSha256,
      authorities: input.authorities,
    });
  } catch (error) {
    fail(
      `independent fault controller observation is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  writeExclusive(input.output, source.content);
  return observation;
}

export async function exerciseReviewedInstalledCandidate(
  input,
  {
    platformAutomation = { exercise: defaultPlatformAutomation },
    accessibilityReviewer = { review: defaultAccessibilityReviewer },
    faultController = { exercise: defaultFaultController },
  } = {},
) {
  if (!PLATFORMS.includes(input.platform)) fail("unsupported platform");
  if (!SHA1_RE.test(input.candidateSha ?? ""))
    fail("exact source SHA required");
  if (!DEPLOYMENT_RE.test(input.stagingDeploymentId ?? "")) {
    fail("exact staging deployment required");
  }
  if (!SHA256_RE.test(input.artifactSha256 ?? "")) {
    fail("exact updater artifact digest required");
  }
  const installedRoot = realpathSync(resolve(input.installedRoot));
  const native = stableFile(input.nativeBinary, "installed native executable");
  const nativeContained = relative(installedRoot, native.absolute);
  if (
    nativeContained === "" ||
    nativeContained === ".." ||
    nativeContained.startsWith(`..${sep}`) ||
    isAbsolute(nativeContained)
  ) {
    fail("installed native executable escapes its installation");
  }
  const nativeProof = stableFile(input.nativeProof, "native proof");
  const proof = validateNativeProof(nativeProof, input.platform);
  const root = createEvidenceRoot(input.rawEvidence);
  copyFileSync(
    nativeProof.absolute,
    join(root, "native-proof.json"),
    constants.COPYFILE_EXCL,
  );
  let gateReport = input.gateReport;
  let gateLog = input.gateLog;
  if (gateReport !== undefined || gateLog !== undefined) {
    const report = stableFile(gateReport, "secretless gate report");
    const log = stableFile(gateLog, "secretless gate log");
    gateReport = join(root, "secretless-gates-report.json");
    gateLog = join(root, "secretless-gates.log");
    copyFileSync(report.absolute, gateReport, constants.COPYFILE_EXCL);
    copyFileSync(log.absolute, gateLog, constants.COPYFILE_EXCL);
  }
  const outputs = {
    ipc: join(root, "ipc.jsonl"),
    network: join(root, "network.jsonl"),
    embeddedAssets: join(root, "embedded-assets.json"),
    platformLog: join(root, "platform-driver.log"),
    screenReaderLog: join(root, "screen-reader.log"),
  };
  const automated = await platformAutomation.exercise({
    ...input,
    gateReport,
    gateLog,
    installedRoot,
    nativeBinary: native.absolute,
    outputs,
  });
  const reviewOutputs = {
    platformLog: join(root, "accessibility-review.log"),
    screenReaderLog: join(root, "accessibility-review-screen-reader.log"),
    ipc: join(root, "accessibility-review-ipc.jsonl"),
    network: join(root, "accessibility-review-network.jsonl"),
    embeddedAssets: join(root, "accessibility-review-embedded-assets.json"),
  };
  const independent = await accessibilityReviewer.review({
    ...input,
    installedRoot,
    nativeBinary: native.absolute,
    outputs: reviewOutputs,
  });
  const reviewPlatformLog = stableFile(
    reviewOutputs.platformLog,
    "independent accessibility platform log",
    root,
  );
  const reviewScreenReaderLog = stableFile(
    reviewOutputs.screenReaderLog,
    "independent accessibility screen-reader log",
    root,
  );
  const reviewIpc = stableFile(
    reviewOutputs.ipc,
    "independent accessibility IPC log",
    root,
  );
  const reviewNetwork = stableFile(
    reviewOutputs.network,
    "independent accessibility network log",
    root,
  );
  const reviewAssets = stableFile(
    reviewOutputs.embeddedAssets,
    "independent accessibility embedded asset manifest",
    root,
  );
  const external =
    input.manualReview === null || input.manualReview === undefined
      ? null
      : manualAccessibilityForPlatform(input.manualReview, {
          candidateSha: input.candidateSha,
          platform: input.platform,
          artifactSha256: input.artifactSha256,
        });
  for (const criterion of MATRICE_ACCESSIBILITE) {
    const observation = automated.accessibility?.[criterion];
    const reviewed = independent?.[criterion];
    if (
      observation === null ||
      typeof observation !== "object" ||
      Array.isArray(observation) ||
      Object.hasOwn(observation, "manual") ||
      !Array.isArray(observation.automated) ||
      observation.automated.length === 0 ||
      reviewed === null ||
      typeof reviewed !== "object" ||
      Array.isArray(reviewed) ||
      JSON.stringify(Object.keys(reviewed).sort()) !==
        JSON.stringify(["observation", "reviewer", "tool"]) ||
      [reviewed.tool, reviewed.reviewer, reviewed.observation].some(
        (value) =>
          typeof value !== "string" ||
          value.trim() === "" ||
          value.length > 2_000,
      )
    ) {
      fail(`platform accessibility ${criterion} lacks independent review`);
    }
    observation.manual = [
      {
        ...reviewed,
        observation:
          `${reviewed.observation}; artifact=${input.artifactSha256}; ` +
          `review-log=${reviewPlatformLog.sha256}; ` +
          `screen-reader-log=${reviewScreenReaderLog.sha256}; ` +
          `ipc=${reviewIpc.sha256}; network=${reviewNetwork.sha256}; ` +
          `assets=${reviewAssets.sha256}`,
      },
      ...(external?.[criterion] ?? []),
    ];
  }
  const ui = validateUi(automated.ui);
  const uiContent = Buffer.from(
    `${automated.ui.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  writeExclusive(join(root, "ui.jsonl"), uiContent);
  if (
    automated.screenshots === null ||
    typeof automated.screenshots !== "object"
  ) {
    fail("platform screenshots are missing");
  }
  for (const story of REQUIRED_STORIES) {
    const screenshot = automated.screenshots[story];
    if (!Buffer.isBuffer(screenshot) || screenshot.length === 0) {
      fail(`platform screenshot is missing for ${story}`);
    }
    writeExclusive(join(root, "screenshots", `${story}.png`), screenshot);
  }
  writeExclusive(
    join(root, "accessibility.json"),
    Buffer.from(`${JSON.stringify(automated.accessibility, null, 2)}\n`),
  );
  const ipcFile = stableFile(outputs.ipc, "native IPC journal", root);
  const ipc = parseJsonLines(ipcFile, "native IPC journal");
  validateIpc(ipc);
  stableFile(outputs.network, "native network journal", root);
  stableFile(outputs.embeddedAssets, "embedded runtime asset manifest", root);
  stableFile(outputs.platformLog, "platform automation log", root);
  stableFile(outputs.screenReaderLog, "native screen reader log", root);
  const resilience = await faultController.exercise({
    ...input,
    output: join(root, "fault-controller.json"),
  });
  stableFile(
    join(root, "fault-controller.json"),
    "independent fault controller journal",
    root,
  );
  const files = inventoryFiles(root);
  const index = {
    schema: "punks.installed-raw-evidence-index.v1",
    platform: input.platform,
    candidateSha: input.candidateSha,
    stagingDeploymentId: input.stagingDeploymentId,
    artifactSha256: input.artifactSha256,
    files,
  };
  const indexContent = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  writeExclusive(join(root, "index.json"), indexContent);

  return {
    schema: "punks.installed-driver-observation.v1",
    platform: input.platform,
    candidateSha: input.candidateSha,
    artifactSha256: input.artifactSha256,
    installed: {
      bundleId: automated.installed.bundleId,
      binarySha256: native.sha256,
      launched: automated.installed.launched,
      executable: automated.installed.executable,
    },
    verifications: Object.fromEntries(
      VERIFICATIONS_ARTEFACT.map((id) => [
        id,
        {
          command: `native-proof:${id}`,
          exitCode: 0,
          observation: `${id} verified by ${proof.identity}`,
        },
      ]),
    ),
    stories: REQUIRED_STORIES.map((id) => ({
      id,
      ui: [ui.get(id)],
      ipc: ipc.filter(({ command }) => STORY_COMMANDS[id].includes(command)),
      contracts: ipc
        .filter(({ command }) => STORY_COMMANDS[id].includes(command))
        .map(({ contract, status }) => ({ contract, status })),
    })),
    accessibility: automated.accessibility,
    follow: automated.follow,
    resilience,
    rawEvidence: {
      indexSha256: sha256(indexContent),
      files: files.length,
    },
  };
}
