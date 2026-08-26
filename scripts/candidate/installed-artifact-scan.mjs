#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_PUNKS_NATIVE_MARKERS,
  verifyPunksNativeArtifact,
} from "../punks-native-artifact.mjs";
import { validateInstalledReleaseNames } from "../promotion-materials-lib.mjs";

const PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`installed artifact scan rejected: ${message}`);
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

function stableFile(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size < 1) {
    fail(`${label} must be one non-empty real regular file`);
  }
  const real = realpathSync(absolute);
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
    return { absolute: real, content };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stableDirectory(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  return realpathSync(absolute);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function validateScannedFile(value, label) {
  exactKeys(value, ["name", "size", "sha256"], label);
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    !SHA256_RE.test(value.sha256 ?? "")
  ) {
    fail(`${label} is invalid`);
  }
}

function canonicalInventoryDigest(schema, files, links) {
  return sha256(
    Buffer.from(
      JSON.stringify(
        links === undefined ? { schema, files } : { schema, files, links },
      ),
    ),
  );
}

function validateRelativePath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(`${label} path is not one canonical relative path`);
  }
}

function validateInstallation(value, native) {
  exactKeys(
    value,
    ["schema", "files", "links", "sha256"],
    "installed file inventory",
  );
  if (
    value.schema !== "punks.installed-file-inventory.v1" ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.links) ||
    value.files.length === 0 ||
    !SHA256_RE.test(value.sha256 ?? "")
  ) {
    fail("installed file inventory is invalid");
  }
  const filePaths = [];
  for (const [index, file] of value.files.entries()) {
    exactKeys(file, ["path", "size", "sha256"], `installed file ${index}`);
    validateRelativePath(file.path, `installed file ${index}`);
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      !SHA256_RE.test(file.sha256 ?? "")
    ) {
      fail(`installed file ${index} is invalid`);
    }
    filePaths.push(file.path);
  }
  const linkPaths = [];
  for (const [index, link] of value.links.entries()) {
    exactKeys(link, ["path", "target"], `installed link ${index}`);
    validateRelativePath(link.path, `installed link ${index}`);
    validateRelativePath(link.target, `installed link ${index} target`);
    linkPaths.push(link.path);
  }
  const paths = [...filePaths, ...linkPaths];
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(filePaths) !== JSON.stringify([...filePaths].sort()) ||
    JSON.stringify(linkPaths) !== JSON.stringify([...linkPaths].sort()) ||
    value.sha256 !==
      canonicalInventoryDigest(value.schema, value.files, value.links)
  ) {
    fail("installed file inventory is duplicated, unordered or divergent");
  }
  const nativeFiles = value.files.filter(
    (file) =>
      file.sha256 === native.sha256 && basename(file.path) === native.name,
  );
  if (nativeFiles.length !== 1 || nativeFiles[0].size !== native.size) {
    fail(
      "installed native executable is not uniquely present in the inventory",
    );
  }
}

function validateEmbeddedAssets(value) {
  exactKeys(
    value,
    ["schema", "product", "mode", "files", "sha256", "forbiddenMarkers"],
    "embedded frontend asset manifest",
  );
  if (
    value.schema !== "punks.embedded-asset-manifest.v1" ||
    value.product !== "punks-frontend" ||
    value.mode !== "embedded-runtime" ||
    !Array.isArray(value.files) ||
    value.files.length < 2 ||
    !SHA256_RE.test(value.sha256 ?? "") ||
    !Array.isArray(value.forbiddenMarkers) ||
    value.forbiddenMarkers.length !== 0
  ) {
    fail("embedded frontend asset manifest is invalid");
  }
  const paths = [];
  for (const [index, file] of value.files.entries()) {
    exactKeys(file, ["path", "size", "sha256"], `embedded asset ${index}`);
    validateRelativePath(file.path, `embedded asset ${index}`);
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      !SHA256_RE.test(file.sha256 ?? "")
    ) {
      fail(`embedded asset ${index} is invalid`);
    }
    paths.push(file.path);
  }
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort()) ||
    !paths.includes("index.html") ||
    !paths.some((path) => path.startsWith("assets/")) ||
    value.sha256 !== canonicalInventoryDigest(value.schema, value.files)
  ) {
    fail("embedded frontend asset closure is unordered or divergent");
  }
}

function installedFiles(root) {
  const files = [];
  const links = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolute = resolve(directory, entry.name);
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) {
        const target = realpathSync(absolute);
        const containedTarget = relative(root, target);
        if (
          containedTarget === "" ||
          containedTarget === ".." ||
          containedTarget.startsWith(`..${sep}`) ||
          isAbsolute(containedTarget)
        ) {
          fail("installed symbolic link escapes its inventory root");
        }
        const containedLink = relative(root, absolute);
        const rawTarget = readlinkSync(absolute);
        if (rawTarget.length === 0) {
          fail("installed symbolic link has an empty target");
        }
        links.push({
          path: containedLink.split(sep).join("/"),
          target: containedTarget.split(sep).join("/"),
        });
        continue;
      }
      if (status.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!status.isFile()) {
        fail("installed file inventory contains a non-regular entry");
      }
      const file = stableFile(absolute, "installed file");
      const contained = relative(root, file.absolute);
      if (
        contained === "" ||
        contained.startsWith(`..${sep}`) ||
        contained === ".." ||
        isAbsolute(contained)
      ) {
        fail("installed file escapes its inventory root");
      }
      files.push({
        path: contained.split(sep).join("/"),
        size: file.content.length,
        sha256: sha256(file.content),
      });
    }
  };
  visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  links.sort((left, right) => left.path.localeCompare(right.path));
  return { files, links };
}

export function validateInstalledArtifactScan(
  report,
  { platform, candidateSha, artifactSha256 },
) {
  exactKeys(
    report,
    [
      "schema",
      "platform",
      "candidateSha",
      "artifact",
      "native",
      "installation",
      "frontend",
      "forbiddenMarkers",
    ],
    "installed artifact scan",
  );
  if (
    !PLATFORMS.includes(platform) ||
    !SHA1_RE.test(candidateSha ?? "") ||
    !SHA256_RE.test(artifactSha256 ?? "") ||
    report.schema !== "punks.installed-artifact-scan.v2" ||
    report.platform !== platform ||
    report.candidateSha !== candidateSha
  ) {
    fail("installed artifact scan belongs to another candidate");
  }
  validateScannedFile(report.artifact, "installed updater artifact scan");
  validateScannedFile(report.native, "installed native executable scan");
  const expectedNativeName =
    platform === "windows-x64" ? "punks-bot-staging.exe" : "punks-bot-staging";
  if (
    report.artifact.sha256 !== artifactSha256 ||
    report.native.name !== expectedNativeName
  ) {
    fail("installed artifact or native executable digest is divergent");
  }
  validateInstalledReleaseNames({
    platform,
    candidateSha,
    artifactName: report.artifact.name,
    signatureName: `${report.artifact.name}.sig`,
  });
  validateInstallation(report.installation, report.native);
  validateEmbeddedAssets(report.frontend);
  if (
    JSON.stringify(report.forbiddenMarkers) !==
    JSON.stringify(FORBIDDEN_PUNKS_NATIVE_MARKERS)
  ) {
    fail("installed artifact scan forbidden marker set is divergent");
  }
  return report;
}

export function buildInstalledArtifactScan(
  {
    platform,
    candidateSha,
    nativeBinary,
    installedArtifact,
    installedRoot,
    embeddedAssets,
    output,
  },
  { scanNative = verifyPunksNativeArtifact } = {},
) {
  if (!PLATFORMS.includes(platform)) fail("unsupported platform");
  if (!SHA1_RE.test(candidateSha ?? "")) fail("exact source SHA required");
  const outputPath = resolve(output);
  if (existsSync(outputPath)) fail("artifact scan output already exists");
  const nativeFile = stableFile(nativeBinary, "native executable");
  const artifactFile = stableFile(
    installedArtifact,
    "installed updater artifact",
  );
  const installationRoot = stableDirectory(installedRoot, "installed root");
  const embeddedAssetFile = stableFile(
    embeddedAssets,
    "embedded runtime asset manifest",
  );
  const nativeContained = relative(installationRoot, nativeFile.absolute);
  if (
    nativeContained === "" ||
    nativeContained === ".." ||
    nativeContained.startsWith(`..${sep}`) ||
    isAbsolute(nativeContained)
  ) {
    fail("native executable is outside the installed root");
  }
  const native = scanNative(nativeFile.absolute);
  const artifact = scanNative(artifactFile.absolute);
  if (
    native.name !== basename(nativeFile.absolute) ||
    native.size !== nativeFile.content.length ||
    native.sha256 !== sha256(nativeFile.content) ||
    artifact.name !== basename(artifactFile.absolute) ||
    artifact.size !== artifactFile.content.length ||
    artifact.sha256 !== sha256(artifactFile.content)
  ) {
    fail("artifact scanner result diverges from the exact bytes read");
  }
  let frontend;
  try {
    frontend = JSON.parse(embeddedAssetFile.content.toString("utf8"));
  } catch {
    fail("embedded runtime asset manifest is not JSON");
  }
  validateEmbeddedAssets(frontend);
  const { files, links } = installedFiles(installationRoot);
  const installation = {
    schema: "punks.installed-file-inventory.v1",
    files,
    links,
    sha256: canonicalInventoryDigest(
      "punks.installed-file-inventory.v1",
      files,
      links,
    ),
  };
  const report = {
    schema: "punks.installed-artifact-scan.v2",
    platform,
    candidateSha,
    artifact,
    native,
    installation,
    frontend,
    forbiddenMarkers: [...FORBIDDEN_PUNKS_NATIVE_MARKERS],
  };
  validateInstalledArtifactScan(report, {
    platform,
    candidateSha,
    artifactSha256: artifact.sha256,
  });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return report;
}

function parseOptions(argv) {
  const names = [
    "platform",
    "source-sha",
    "native-binary",
    "installed-artifact",
    "installed-root",
    "embedded-assets",
    "output",
  ];
  const expected = new Set(names.map((name) => `--${name}`));
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    values.set(flag, value);
  }
  if (
    values.size !== expected.size ||
    [...values.keys()].some((flag) => !expected.has(flag))
  ) {
    fail("exact installed artifact scan CLI arguments are required");
  }
  return Object.fromEntries(
    names.map((name) => [
      name.replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()),
      values.get(`--${name}`),
    ]),
  );
}

export function run(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  return buildInstalledArtifactScan({
    platform: options.platform,
    candidateSha: options.sourceSha,
    nativeBinary: options.nativeBinary,
    installedArtifact: options.installedArtifact,
    installedRoot: options.installedRoot,
    embeddedAssets: options.embeddedAssets,
    output: options.output,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
