#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  validateSigstoreBundleContent,
  verifyGithubSubject,
} from "../github-attestation-lib.mjs";
import { buildRecoveryIndex } from "./aggregate-recovery-evidence.mjs";

const SOURCE_SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID = /^sha256:[0-9a-f]{64}$/;
const PLATFORM_TARGETS = Object.freeze({
  "macos-arm64": "aarch64-apple-darwin",
  "macos-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "windows-x64": "x86_64-pc-windows-msvc",
});
const PLATFORM_KEYS = Object.freeze({
  "macos-arm64": "darwin-aarch64",
  "macos-x64": "darwin-x86_64",
  "linux-x64": "linux-x86_64",
  "windows-x64": "windows-x86_64",
});
const PLATFORMS = Object.keys(PLATFORM_TARGETS);
const EVIDENCE_INDEX_SCHEMA = "punks.promotion-evidence-index.v1";
const PROMOTION_PROOF_SCHEMA = "punks.promotion-proof.v1";
const NETWORK_PROOF_SCHEMA = "punks.installed-network-proof.v1";
const PLATFORM_ROLES = Object.freeze({
  "macos-arm64": ["native-dmg", "updater", "updater-signature"],
  "macos-x64": ["native-dmg", "updater", "updater-signature"],
  "linux-x64": [
    "native-updater",
    "updater-signature",
    "native-deb",
    "native-deb-signature",
  ],
  "windows-x64": [
    "native-updater-nsis",
    "updater-nsis-signature",
    "native-updater-msi",
    "updater-msi-signature",
  ],
});

function fail(message) {
  throw new Error(message);
}

const COMMAND_OPTIONS = {
  collect: new Set([
    "--platform",
    "--target",
    "--source-sha",
    "--staging-deployment-id",
    "--bundle",
    "--native-proof",
    "--installed-proof",
    "--network-proof",
    "--output",
  ]),
  aggregate: new Set([
    "--input",
    "--output",
    "--staging-proof",
    "--source-sha",
    "--staging-deployment-id",
    "--repository",
    "--release-tag",
    "--source-ref",
    "--signer-workflow",
  ]),
};

function parseArguments(argv) {
  if (argv.length === 0) fail("A collect or aggregate command is required");
  const command = argv[0];
  const allowed = COMMAND_OPTIONS[command];
  if (allowed === undefined) fail(`Unknown command ${String(command)}`);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      fail("Arguments must be supplied as --name value pairs");
    }
    if (!allowed.has(name)) fail(`Unknown option ${name}`);
    const key = name.slice(2);
    if (values.has(key)) fail(`Duplicate option ${name}`);
    values.set(key, value);
  }
  return { command, values };
}

function required(values, name) {
  const value = values.get(name);
  if (!value) fail("--" + name + " is required");
  return value;
}

function assertCandidateIdentity(sourceSha, stagingDeploymentId) {
  if (!SOURCE_SHA.test(sourceSha)) fail("source SHA must be 40 lowercase hex");
  if (!DEPLOYMENT_ID.test(stagingDeploymentId)) {
    fail("staging deployment ID must be an exact sha256 identifier");
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonExclusive(path, value) {
  const content = jsonContent(value);
  writeFileSync(path, content, {
    flag: "wx",
    mode: 0o644,
  });
  return content;
}

function jsonContent(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

function createOutputRoot(path, alreadyExistsMessage) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail(alreadyExistsMessage);
    throw error;
  }
}

function readStableFile(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be one real regular file`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
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
    return {
      path,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.length,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseJsonContent(file, label) {
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function loadStagingProof(path, sourceSha, stagingDeploymentId) {
  const file = readStableFile(path, "Staging deployment proof");
  const proof = validateStagingDeploymentProof(
    parseJsonContent(file, "Staging deployment proof"),
    {
      accountId: CANONICAL_STAGING_ACCOUNT_ID,
      environment: "staging",
      sourceSha,
    },
  );
  if (proof.deploymentId !== stagingDeploymentId) {
    fail("Staging deployment proof ID does not match candidate identity");
  }
  return { proof, file };
}

function topEntries(directory) {
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    fail(directory + " is not a directory");
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function exactObjectKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function evidenceRelativePath(path) {
  return (
    typeof path === "string" &&
    /^sha256\/[0-9a-f]{64}-[A-Za-z0-9._-]+$/u.test(path)
  );
}

function loadInstalledEvidence(
  installedProof,
  networkProof,
  platform,
  sourceSha,
  stagingDeploymentId,
) {
  const root = resolve(installedProof);
  const expectedNetworkPath = join(root, "network-proof.json");
  if (resolve(networkProof) !== expectedNetworkPath) {
    fail("Installed network proof must belong to the exact evidence root");
  }
  assertExactEntries(root, ["index.json", "network-proof.json", "sha256"]);
  const shaRoot = join(root, "sha256");
  const shaEntries = topEntries(shaRoot);
  if (shaEntries.length === 0 || shaEntries.some((entry) => !entry.isFile())) {
    fail("Installed evidence sha256 directory must contain only regular files");
  }

  const indexFile = readStableFile(
    join(root, "index.json"),
    "Installed evidence index",
  );
  const index = parseJsonContent(indexFile, "Installed evidence index");
  if (
    !exactObjectKeys(index, ["schema", "preuves"]) ||
    index.schema !== EVIDENCE_INDEX_SCHEMA ||
    !Array.isArray(index.preuves) ||
    index.preuves.length === 0
  ) {
    fail("Installed evidence index is invalid");
  }

  const referenced = new Map();
  const proofIds = new Set();
  for (const reference of index.preuves) {
    if (
      !exactObjectKeys(reference, ["id", "chemin", "sha256", "sujet"]) ||
      typeof reference.id !== "string" ||
      reference.id.length === 0 ||
      proofIds.has(reference.id) ||
      !evidenceRelativePath(reference.chemin) ||
      !/^[0-9a-f]{64}$/u.test(reference.sha256 ?? "") ||
      !exactObjectKeys(reference.sujet, ["chemin", "sha256"]) ||
      !evidenceRelativePath(reference.sujet.chemin) ||
      !/^[0-9a-f]{64}$/u.test(reference.sujet.sha256 ?? "")
    ) {
      fail("Installed evidence reference is invalid or duplicated");
    }
    proofIds.add(reference.id);
    const proofFile = readStableFile(
      join(root, reference.chemin),
      `Installed evidence proof ${reference.id}`,
    );
    const subjectFile = readStableFile(
      join(root, reference.sujet.chemin),
      `Installed evidence subject ${reference.id}`,
    );
    const proof = parseJsonContent(
      proofFile,
      `Installed evidence proof ${reference.id}`,
    );
    if (
      proofFile.sha256 !== reference.sha256 ||
      subjectFile.sha256 !== reference.sujet.sha256 ||
      !exactObjectKeys(proof, [
        "schema",
        "id",
        "candidateSha",
        "stagingDeploymentId",
        "result",
        ...(proof.plateforme === undefined ? [] : ["plateforme"]),
        "data",
      ]) ||
      proof.schema !== PROMOTION_PROOF_SCHEMA ||
      proof.id !== reference.id ||
      proof.candidateSha !== sourceSha ||
      proof.stagingDeploymentId !== stagingDeploymentId ||
      proof.result !== "vert" ||
      (proof.plateforme !== undefined && proof.plateforme !== platform) ||
      proof.data?.subjectSha256 !== subjectFile.sha256
    ) {
      fail(`Installed evidence proof ${reference.id} is divergent`);
    }
    referenced.set(reference.chemin, proofFile);
    referenced.set(reference.sujet.chemin, subjectFile);
  }
  const actualReferencedPaths = shaEntries
    .map((entry) => `sha256/${entry.name}`)
    .sort();
  const expectedReferencedPaths = [...referenced.keys()].sort();
  if (
    JSON.stringify(actualReferencedPaths) !==
    JSON.stringify(expectedReferencedPaths)
  ) {
    fail(
      "Installed evidence contains unreferenced or missing content-addressed files",
    );
  }

  const networkFile = readStableFile(
    expectedNetworkPath,
    "Installed network proof",
  );
  const network = parseJsonContent(networkFile, "Installed network proof");
  const transcriptReference = index.preuves.find(
    ({ id }) => id === `transcript/${platform}`,
  );
  if (
    !exactObjectKeys(network, [
      "schema",
      "platform",
      "candidateSha",
      "stagingDeploymentId",
      "transcriptSha256",
      "network",
    ]) ||
    network.schema !== NETWORK_PROOF_SCHEMA ||
    network.platform !== platform ||
    network.candidateSha !== sourceSha ||
    network.stagingDeploymentId !== stagingDeploymentId ||
    network.transcriptSha256 !== transcriptReference?.sujet?.sha256 ||
    network.network === null ||
    typeof network.network !== "object" ||
    Array.isArray(network.network)
  ) {
    fail("Installed network proof is invalid or divergent");
  }
  return {
    root,
    indexFile,
    networkFile,
    contentFiles: [...referenced.entries()].map(([path, file]) => ({
      path,
      file,
    })),
  };
}

function onlyEntry(directory, predicate, expectedType, description) {
  const matches = topEntries(directory).filter(
    (entry) =>
      predicate(entry.name) &&
      (expectedType === "file" ? entry.isFile() : entry.isDirectory()),
  );
  if (matches.length !== 1) {
    fail("Expected exactly one " + description + " in " + directory);
  }
  return join(directory, matches[0].name);
}

function assertExactEntries(directory, expectedNames) {
  const actual = topEntries(directory).map((entry) => entry.name);
  const expected = [...expectedNames].sort((left, right) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      "Unexpected artifact layout in " +
        directory +
        ": expected " +
        JSON.stringify(expected) +
        ", received " +
        JSON.stringify(actual),
    );
  }
}

function inspectBundle(platform, bundleRoot) {
  if (platform.startsWith("macos-")) {
    const macos = join(bundleRoot, "macos");
    const dmgDirectory = join(bundleRoot, "dmg");
    const app = onlyEntry(
      macos,
      (name) => name.endsWith(".app"),
      "directory",
      "app",
    );
    const updater = onlyEntry(
      macos,
      (name) => name.endsWith(".app.tar.gz"),
      "file",
      "macOS updater archive",
    );
    const updaterSignature = updater + ".sig";
    const dmg = onlyEntry(
      dmgDirectory,
      (name) => name.endsWith(".dmg"),
      "file",
      "DMG",
    );
    assertExactEntries(macos, [
      basename(app),
      basename(updater),
      basename(updaterSignature),
    ]);
    assertExactEntries(dmgDirectory, [basename(dmg)]);
    return [
      { source: dmg, suffix: ".dmg", role: "native-dmg" },
      { source: updater, suffix: ".app.tar.gz", role: "updater" },
      {
        source: updaterSignature,
        suffix: ".app.tar.gz.sig",
        role: "updater-signature",
      },
    ];
  }

  if (platform === "linux-x64") {
    const appimageDirectory = join(bundleRoot, "appimage");
    const debDirectory = join(bundleRoot, "deb");
    const appimage = onlyEntry(
      appimageDirectory,
      (name) => name.endsWith(".AppImage"),
      "file",
      "AppImage",
    );
    const updaterSignature = appimage + ".sig";
    const deb = onlyEntry(
      debDirectory,
      (name) => name.endsWith(".deb"),
      "file",
      "Debian package",
    );
    const debSignature = deb + ".asc";
    assertExactEntries(appimageDirectory, [
      basename(appimage),
      basename(updaterSignature),
    ]);
    assertExactEntries(debDirectory, [basename(deb), basename(debSignature)]);
    return [
      { source: appimage, suffix: ".AppImage", role: "native-updater" },
      {
        source: updaterSignature,
        suffix: ".AppImage.sig",
        role: "updater-signature",
      },
      { source: deb, suffix: ".deb", role: "native-deb" },
      {
        source: debSignature,
        suffix: ".deb.asc",
        role: "native-deb-signature",
      },
    ];
  }

  if (platform === "windows-x64") {
    const nsisDirectory = join(bundleRoot, "nsis");
    const msiDirectory = join(bundleRoot, "msi");
    const nsis = onlyEntry(
      nsisDirectory,
      (name) => name.endsWith(".exe"),
      "file",
      "NSIS installer",
    );
    const msi = onlyEntry(
      msiDirectory,
      (name) => name.endsWith(".msi"),
      "file",
      "MSI installer",
    );
    const nsisSignature = nsis + ".sig";
    const msiSignature = msi + ".sig";
    assertExactEntries(nsisDirectory, [
      basename(nsis),
      basename(nsisSignature),
    ]);
    assertExactEntries(msiDirectory, [basename(msi), basename(msiSignature)]);
    return [
      { source: nsis, suffix: ".exe", role: "native-updater-nsis" },
      {
        source: nsisSignature,
        suffix: ".exe.sig",
        role: "updater-nsis-signature",
      },
      { source: msi, suffix: ".msi", role: "native-updater-msi" },
      {
        source: msiSignature,
        suffix: ".msi.sig",
        role: "updater-msi-signature",
      },
    ];
  }

  fail("Unsupported platform " + platform);
}

function validateNativeProofValue(proof, platform) {
  if (
    proof.schema !== "punks.desktop-native-proof.v1" ||
    proof.platform !== platform ||
    proof.verified !== true ||
    typeof proof.identity !== "string" ||
    proof.identity.length === 0
  ) {
    fail("Invalid native proof for " + platform);
  }
  if (platform !== "linux-x64" && proof.timestamped !== true) {
    fail("Native timestamp proof is required for " + platform);
  }
  if (platform.startsWith("macos-") && proof.notarized !== true) {
    fail("Notarization proof is required for " + platform);
  }
  if (
    platform === "linux-x64" &&
    (proof.embeddedAppImageSignature !== true ||
      proof.detachedDebSignature !== true)
  ) {
    fail("Both Linux native signature proofs are required");
  }
  return proof;
}

function readVersion() {
  const config = readJson(resolve("desktop/src-tauri/tauri.conf.json"));
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(config.version ?? "")) {
    fail("The Tauri version must be an exact SemVer");
  }
  return config.version;
}

/**
 * Collect one signed platform leg into a newly owned create-only directory.
 * The optional boundary is test-only and is not exposed by the CLI.
 */
export function collectPlatformLeg(options, testBoundary = {}) {
  const {
    platform,
    target,
    sourceSha,
    stagingDeploymentId,
    bundle,
    nativeProof,
    installedProof,
    networkProof,
    output,
  } = options;
  assertCandidateIdentity(sourceSha, stagingDeploymentId);
  if (PLATFORM_TARGETS[platform] !== target) {
    fail("Platform and Rust target do not match");
  }

  const nativeProofFile = readStableFile(
    nativeProof,
    `Native proof for ${platform}`,
  );
  const proof = validateNativeProofValue(
    parseJsonContent(nativeProofFile, `Native proof for ${platform}`),
    platform,
  );
  const sourceArtifacts = inspectBundle(platform, bundle);
  const evidence = loadInstalledEvidence(
    installedProof,
    networkProof,
    platform,
    sourceSha,
    stagingDeploymentId,
  );
  const version = readVersion();
  const prefix = "punks-desktop-" + platform + "-" + sourceSha;
  const artifactFiles = sourceArtifacts.map(({ source, suffix, role }) => ({
    ...readStableFile(source, `Source artifact ${basename(source)}`),
    name: prefix + suffix,
    role,
  }));

  testBoundary.beforeOutputCreate?.();
  createOutputRoot(output, "Platform leg output already exists");
  const platformRoot = join(output, platform);
  const artifactRoot = join(platformRoot, "artifacts");
  const evidenceRoot = join(platformRoot, "evidence");
  const evidenceShaRoot = join(evidenceRoot, "sha256");
  mkdirSync(platformRoot, { mode: 0o755 });
  mkdirSync(artifactRoot, { mode: 0o755 });
  mkdirSync(evidenceRoot, { mode: 0o755 });
  mkdirSync(evidenceShaRoot, { mode: 0o755 });

  const artifacts = artifactFiles.map((file) => {
    const { name, role } = file;
    const destination = join(artifactRoot, name);
    writeFileSync(destination, file.content, { flag: "wx", mode: 0o644 });
    return {
      name,
      path: "artifacts/" + name,
      role,
      sha256: file.sha256,
      size: file.size,
    };
  });

  const proofDestination = join(platformRoot, "native-proof.json");
  writeFileSync(proofDestination, nativeProofFile.content, {
    flag: "wx",
    mode: 0o644,
  });
  writeFileSync(join(evidenceRoot, "index.json"), evidence.indexFile.content, {
    flag: "wx",
    mode: 0o644,
  });
  writeFileSync(
    join(evidenceRoot, "network-proof.json"),
    evidence.networkFile.content,
    { flag: "wx", mode: 0o644 },
  );
  const evidenceFiles = evidence.contentFiles.map(({ path, file }) => {
    writeFileSync(join(evidenceRoot, path), file.content, {
      flag: "wx",
      mode: 0o644,
    });
    return { path: `evidence/${path}`, sha256: file.sha256, size: file.size };
  });
  evidenceFiles.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema: "punks.desktop-platform-leg.v1",
    sourceSha,
    stagingDeploymentId,
    version,
    platform,
    target,
    nativeProof: {
      path: "native-proof.json",
      sha256: nativeProofFile.sha256,
      identity: proof.identity,
      timestamped: proof.timestamped,
    },
    installedEvidence: {
      index: {
        path: "evidence/index.json",
        sha256: evidence.indexFile.sha256,
      },
      network: {
        path: "evidence/network-proof.json",
        sha256: evidence.networkFile.sha256,
      },
      files: evidenceFiles,
    },
    artifacts,
  };
  writeJsonExclusive(join(platformRoot, "platform-manifest.json"), manifest);
  return manifest;
}

function findArtifact(manifest, role) {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.role === role,
  );
  if (!artifact) fail("Missing " + role + " for " + manifest.platform);
  return artifact;
}

function verifyLeg(
  inputRoot,
  platform,
  sourceSha,
  stagingDeploymentId,
  verification,
) {
  const root = join(inputRoot, platform);
  const manifestPath = join(root, "platform-manifest.json");
  const provenancePath = join(root, "provenance.sigstore.json");
  const nativeProofPath = join(root, "native-proof.json");
  const manifestFile = readStableFile(
    manifestPath,
    `Platform manifest for ${platform}`,
  );
  const manifest = parseJsonContent(
    manifestFile,
    `Platform manifest for ${platform}`,
  );
  if (
    manifest.schema !== "punks.desktop-platform-leg.v1" ||
    manifest.platform !== platform ||
    manifest.target !== PLATFORM_TARGETS[platform] ||
    manifest.sourceSha !== sourceSha ||
    manifest.stagingDeploymentId !== stagingDeploymentId
  ) {
    fail("Invalid platform manifest for " + platform);
  }
  const provenanceFile = readStableFile(
    provenancePath,
    `Verified provenance bundle for ${platform}`,
  );
  validateSigstoreBundleContent(provenanceFile.content);
  const nativeProofFile = readStableFile(
    nativeProofPath,
    `Native proof for ${platform}`,
  );
  if (
    manifest.nativeProof?.path !== "native-proof.json" ||
    nativeProofFile.sha256 !== manifest.nativeProof.sha256
  ) {
    fail("Native proof digest mismatch for " + platform);
  }
  validateNativeProofValue(
    parseJsonContent(nativeProofFile, `Native proof for ${platform}`),
    platform,
  );
  const evidence = loadInstalledEvidence(
    join(root, "evidence"),
    join(root, "evidence", "network-proof.json"),
    platform,
    sourceSha,
    stagingDeploymentId,
  );
  const expectedEvidenceFiles = evidence.contentFiles
    .map(({ path, file }) => ({
      path: `evidence/${path}`,
      sha256: file.sha256,
      size: file.size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    !exactObjectKeys(manifest.installedEvidence, [
      "index",
      "network",
      "files",
    ]) ||
    !exactObjectKeys(manifest.installedEvidence.index, ["path", "sha256"]) ||
    manifest.installedEvidence.index.path !== "evidence/index.json" ||
    manifest.installedEvidence.index.sha256 !== evidence.indexFile.sha256 ||
    !exactObjectKeys(manifest.installedEvidence.network, ["path", "sha256"]) ||
    manifest.installedEvidence.network.path !== "evidence/network-proof.json" ||
    manifest.installedEvidence.network.sha256 !== evidence.networkFile.sha256 ||
    JSON.stringify(manifest.installedEvidence.files) !==
      JSON.stringify(expectedEvidenceFiles)
  ) {
    fail("Installed evidence manifest is invalid for " + platform);
  }
  if (!Array.isArray(manifest.artifacts)) {
    fail("Platform manifest artifacts must be an array");
  }
  const names = manifest.artifacts.map(({ name }) => name);
  const paths = manifest.artifacts.map(({ path }) => path);
  const roles = manifest.artifacts.map(({ role }) => role);
  if (
    new Set(names).size !== names.length ||
    new Set(paths).size !== paths.length ||
    new Set(roles).size !== roles.length
  ) {
    fail("Platform manifest contains duplicate artifact coordinates");
  }
  if (
    JSON.stringify([...roles].sort()) !==
    JSON.stringify([...PLATFORM_ROLES[platform]].sort())
  ) {
    fail("Platform manifest does not contain the exact artifact role set");
  }
  const subjects = [
    manifestFile,
    nativeProofFile,
    evidence.indexFile,
    evidence.networkFile,
    ...evidence.contentFiles.map(({ file }) => file),
  ];
  const artifactFiles = new Map();
  for (const artifact of manifest.artifacts) {
    const path = join(root, artifact.path);
    const file = readStableFile(path, `Artifact ${artifact.name}`);
    if (
      artifact.path !== "artifacts/" + artifact.name ||
      !artifact.name.includes(sourceSha) ||
      basename(path) !== artifact.name ||
      file.sha256 !== artifact.sha256 ||
      file.size !== artifact.size
    ) {
      fail("Artifact digest mismatch for " + artifact.name);
    }
    artifactFiles.set(artifact.path, file);
    subjects.push(file);
  }
  for (const subject of subjects) {
    verifyGithubSubject({
      artifact: subject.path,
      artifactContent: subject.content,
      bundle: provenancePath,
      bundleContent: provenanceFile.content,
      repository: verification.repository,
      sourceSha,
      sourceRef: verification.sourceRef,
      signerWorkflow: verification.signerWorkflow,
      ghBinary: verification.ghBinary,
    });
  }
  return {
    root,
    manifest,
    manifestFile,
    provenanceFile,
    artifactFiles,
    evidence,
  };
}

function updaterSelection(manifest) {
  if (manifest.platform.startsWith("macos-")) {
    return {
      artifact: findArtifact(manifest, "updater"),
      signature: findArtifact(manifest, "updater-signature"),
    };
  }
  if (manifest.platform === "linux-x64") {
    return {
      artifact: findArtifact(manifest, "native-updater"),
      signature: findArtifact(manifest, "updater-signature"),
    };
  }
  return {
    artifact: findArtifact(manifest, "native-updater-nsis"),
    signature: findArtifact(manifest, "updater-nsis-signature"),
  };
}

function immutableReleaseUrl(repository, releaseTag, name) {
  return (
    "https://github.com/" +
    repository +
    "/releases/download/" +
    releaseTag +
    "/" +
    encodeURIComponent(name)
  );
}

export function aggregateCandidate(options) {
  const {
    input,
    output,
    stagingProof,
    sourceSha,
    stagingDeploymentId,
    repository,
    releaseTag,
    sourceRef,
    signerWorkflow,
    ghBinary = "gh",
  } = options;
  assertCandidateIdentity(sourceSha, stagingDeploymentId);
  const staging = loadStagingProof(
    stagingProof,
    sourceSha,
    stagingDeploymentId,
  );
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail("repository must be owner/name");
  }
  if (releaseTag !== "punks-staging-" + sourceSha) {
    fail("release tag must be immutable and source-bound");
  }
  if (!/^refs\/(heads|tags)\/[^\s]+$/.test(sourceRef)) {
    fail("source ref must be an exact branch or tag ref");
  }
  if (
    signerWorkflow !==
    "github.com/" +
      repository +
      "/.github/workflows/punks-desktop-candidate.yml"
  ) {
    fail("signer workflow identity must be exact");
  }

  const rootEntries = topEntries(input).map((entry) => entry.name);
  const expectedPlatforms = [...PLATFORMS].sort();
  if (JSON.stringify(rootEntries) !== JSON.stringify(expectedPlatforms)) {
    fail("The aggregate must contain exactly four platform legs");
  }

  const legs = PLATFORMS.map((platform) =>
    verifyLeg(input, platform, sourceSha, stagingDeploymentId, {
      repository,
      sourceRef,
      signerWorkflow,
      ghBinary,
    }),
  );
  const versions = new Set(legs.map(({ manifest }) => manifest.version));
  if (versions.size !== 1)
    fail("Every platform leg must have the same version");
  const version = [...versions][0];

  const allAssetNames = legs.flatMap(({ manifest }) =>
    manifest.artifacts.map(({ name }) => name),
  );
  if (new Set(allAssetNames).size !== allAssetNames.length) {
    fail("Platform legs contain duplicate release asset names");
  }
  const releaseAssetFiles = legs.flatMap(({ manifest, artifactFiles }) =>
    manifest.artifacts.map((artifact) => {
      const file = artifactFiles.get(artifact.path);
      if (!file) fail("Verified artifact bytes are unavailable");
      return { name: artifact.name, content: file.content };
    }),
  );

  const platforms = {};
  for (const { manifest, artifactFiles } of legs) {
    const { artifact, signature } = updaterSelection(manifest);
    const signatureValue = artifactFiles
      .get(signature.path)
      ?.content.toString("utf8")
      .trim();
    if (!signatureValue)
      fail("Updater signature is empty for " + manifest.platform);
    platforms[PLATFORM_KEYS[manifest.platform]] = {
      signature: signatureValue,
      url: immutableReleaseUrl(repository, releaseTag, artifact.name),
    };
  }

  const latest = {
    version,
    notes: "Punks staging candidate " + sourceSha,
    platforms,
  };
  const latestName = "latest.json";
  const immutableLatestName = "latest-" + sourceSha + ".json";
  if (
    allAssetNames.includes(latestName) ||
    allAssetNames.includes(immutableLatestName)
  ) {
    fail("Platform legs collide with reserved updater metadata names");
  }
  const latestContent = jsonContent(latest);
  const immutableLatestContent = jsonContent(latest);
  releaseAssetFiles.push(
    { name: latestName, content: latestContent },
    { name: immutableLatestName, content: immutableLatestContent },
  );

  const releaseAssetManifest = releaseAssetFiles
    .map(({ name, content }) => ({
      name,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const stagedProofName = "staging-deployment-proof.json";
  const promotionReferences = [];
  const recoveryReferences = [];
  const promotionProofIds = new Set();
  const promotionContent = new Map();
  const promotionNetworks = [];
  for (const { manifest, evidence } of legs) {
    const evidenceIndex = parseJsonContent(
      evidence.indexFile,
      `Installed evidence index for ${manifest.platform}`,
    );
    for (const reference of evidenceIndex.preuves) {
      if (promotionProofIds.has(reference.id)) {
        fail("Platform evidence contains duplicate proof IDs");
      }
      promotionProofIds.add(reference.id);
      if (
        reference.id.startsWith("faute/") ||
        reference.id.startsWith("recuperation/")
      ) {
        recoveryReferences.push(reference);
      } else {
        promotionReferences.push(reference);
      }
    }
    for (const { path, file } of evidence.contentFiles) {
      const previous = promotionContent.get(path);
      if (previous !== undefined && previous.sha256 !== file.sha256) {
        fail("Platform evidence path collision is divergent");
      }
      promotionContent.set(path, file);
    }
    promotionNetworks.push({
      platform: manifest.platform,
      path: `promotion-evidence/network/${manifest.platform}.json`,
      sha256: evidence.networkFile.sha256,
      content: evidence.networkFile.content,
    });
  }
  const recoveryIndexContent = buildRecoveryIndex({
    references: recoveryReferences,
    content: promotionContent,
    sourceSha,
    stagingDeploymentId,
  });
  promotionReferences.sort((left, right) => left.id.localeCompare(right.id));
  promotionNetworks.sort((left, right) =>
    left.platform.localeCompare(right.platform),
  );
  const platformIndexContent = jsonContent({
    schema: EVIDENCE_INDEX_SCHEMA,
    preuves: promotionReferences,
  });
  const promotionEvidence = {
    platformIndex: {
      path: "promotion-evidence/platform-index.json",
      sha256: createHash("sha256").update(platformIndexContent).digest("hex"),
    },
    stagingProof: {
      path: "promotion-evidence/staging-deployment-proof.json",
      sha256: staging.file.sha256,
    },
    network: promotionNetworks.map(({ platform, path, sha256 }) => ({
      platform,
      path,
      sha256,
    })),
    ...(recoveryIndexContent === null
      ? {}
      : {
          recoveryIndex: {
            path: "promotion-evidence/recovery-index.json",
            sha256: createHash("sha256")
              .update(recoveryIndexContent)
              .digest("hex"),
          },
        }),
  };
  const aggregate = {
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha,
    stagingDeploymentId,
    version,
    repository,
    releaseTag,
    stagingProof: {
      path: stagedProofName,
      sha256: staging.file.sha256,
    },
    promotionEvidence,
    platforms: PLATFORMS.map((platform) => {
      const leg = legs.find(({ manifest }) => manifest.platform === platform);
      return {
        platform,
        target: leg.manifest.target,
        manifestSha256: leg.manifestFile.sha256,
        provenanceSha256: leg.provenanceFile.sha256,
      };
    }),
    immutableLatest: {
      path: "release-assets/" + immutableLatestName,
      sha256: createHash("sha256").update(immutableLatestContent).digest("hex"),
    },
    releaseAssets: releaseAssetManifest,
  };

  createOutputRoot(output, "Candidate aggregate output already exists");
  const releaseAssets = join(output, "release-assets");
  const promotionRoot = join(output, "promotion-evidence");
  const promotionShaRoot = join(promotionRoot, "sha256");
  const promotionNetworkRoot = join(promotionRoot, "network");
  mkdirSync(releaseAssets, { mode: 0o755 });
  mkdirSync(promotionRoot, { mode: 0o755 });
  mkdirSync(promotionShaRoot, { mode: 0o755 });
  mkdirSync(promotionNetworkRoot, { mode: 0o755 });
  for (const { name, content } of releaseAssetFiles) {
    writeFileSync(join(releaseAssets, name), content, {
      flag: "wx",
      mode: 0o644,
    });
  }
  writeFileSync(join(output, stagedProofName), staging.file.content, {
    flag: "wx",
    mode: 0o644,
  });
  writeFileSync(
    join(promotionRoot, "staging-deployment-proof.json"),
    staging.file.content,
    { flag: "wx", mode: 0o644 },
  );
  writeFileSync(
    join(promotionRoot, "platform-index.json"),
    platformIndexContent,
    {
      flag: "wx",
      mode: 0o644,
    },
  );
  if (recoveryIndexContent !== null) {
    writeFileSync(
      join(promotionRoot, "recovery-index.json"),
      recoveryIndexContent,
      {
        flag: "wx",
        mode: 0o644,
      },
    );
  }
  for (const [path, file] of promotionContent) {
    writeFileSync(join(promotionRoot, path), file.content, {
      flag: "wx",
      mode: 0o644,
    });
  }
  for (const network of promotionNetworks) {
    writeFileSync(join(output, network.path), network.content, {
      flag: "wx",
      mode: 0o644,
    });
  }
  writeJsonExclusive(join(output, "aggregate-manifest.json"), aggregate);
  return { aggregate, latest };
}

export function run(argv = process.argv.slice(2)) {
  const { command, values } = parseArguments(argv);
  if (command === "collect") {
    return collectPlatformLeg({
      platform: required(values, "platform"),
      target: required(values, "target"),
      sourceSha: required(values, "source-sha"),
      stagingDeploymentId: required(values, "staging-deployment-id"),
      bundle: resolve(required(values, "bundle")),
      nativeProof: resolve(required(values, "native-proof")),
      installedProof: resolve(required(values, "installed-proof")),
      networkProof: resolve(required(values, "network-proof")),
      output: resolve(required(values, "output")),
    });
  }
  if (command === "aggregate") {
    return aggregateCandidate({
      input: resolve(required(values, "input")),
      output: resolve(required(values, "output")),
      stagingProof: resolve(required(values, "staging-proof")),
      sourceSha: required(values, "source-sha"),
      stagingDeploymentId: required(values, "staging-deployment-id"),
      repository: required(values, "repository"),
      releaseTag: required(values, "release-tag"),
      sourceRef: required(values, "source-ref"),
      signerWorkflow: required(values, "signer-workflow"),
    });
  }
  fail("Unknown command " + command);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
