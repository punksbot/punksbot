#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  CANONICAL_STAGING_ACCOUNT_ID,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";

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

function parseArguments(argv) {
  if (argv.length === 0) fail("A collect or aggregate command is required");
  const command = argv[0];
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      fail("Arguments must be supplied as --name value pairs");
    }
    values.set(name.slice(2), value);
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
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadStagingProof(path, sourceSha, stagingDeploymentId) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("Staging deployment proof must be one real regular file");
  }
  const proof = validateStagingDeploymentProof(readJson(path), {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha,
  });
  if (proof.deploymentId !== stagingDeploymentId) {
    fail("Staging deployment proof ID does not match candidate identity");
  }
  return proof;
}

function topEntries(directory) {
  if (!statSync(directory).isDirectory())
    fail(directory + " is not a directory");
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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

function validateNativeProof(path, platform) {
  const proof = readJson(path);
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

export function collectPlatformLeg(options) {
  const {
    platform,
    target,
    sourceSha,
    stagingDeploymentId,
    bundle,
    nativeProof,
    output,
  } = options;
  assertCandidateIdentity(sourceSha, stagingDeploymentId);
  if (PLATFORM_TARGETS[platform] !== target) {
    fail("Platform and Rust target do not match");
  }
  if (existsSync(output)) fail("Platform leg output already exists");

  const proof = validateNativeProof(nativeProof, platform);
  const sourceArtifacts = inspectBundle(platform, bundle);
  const platformRoot = join(output, platform);
  const artifactRoot = join(platformRoot, "artifacts");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o755 });

  const prefix = "punks-desktop-" + platform + "-" + sourceSha;
  const artifacts = sourceArtifacts.map(({ source, suffix, role }) => {
    const name = prefix + suffix;
    const destination = join(artifactRoot, name);
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    return {
      name,
      path: "artifacts/" + name,
      role,
      sha256: sha256(destination),
      size: statSync(destination).size,
    };
  });

  const proofDestination = join(platformRoot, "native-proof.json");
  copyFileSync(nativeProof, proofDestination, constants.COPYFILE_EXCL);
  const manifest = {
    schema: "punks.desktop-platform-leg.v1",
    sourceSha,
    stagingDeploymentId,
    version: readVersion(),
    platform,
    target,
    nativeProof: {
      path: "native-proof.json",
      sha256: sha256(proofDestination),
      identity: proof.identity,
      timestamped: proof.timestamped,
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

function validateSigstoreBundle(path) {
  const bundle = readJson(path);
  if (
    typeof bundle.mediaType !== "string" ||
    !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle.") ||
    typeof bundle.dsseEnvelope?.payload !== "string" ||
    !Array.isArray(bundle.dsseEnvelope?.signatures) ||
    bundle.dsseEnvelope.signatures.length === 0 ||
    !bundle.verificationMaterial ||
    typeof bundle.verificationMaterial !== "object"
  ) {
    fail("The provenance file is not a Sigstore bundle");
  }
}

function verifyGithubSubject({
  artifact,
  bundle,
  repository,
  sourceSha,
  sourceRef,
  signerWorkflow,
  ghBinary,
}) {
  const result = spawnSync(
    ghBinary,
    [
      "attestation",
      "verify",
      artifact,
      "--repo",
      repository,
      "--signer-workflow",
      signerWorkflow,
      "--source-digest",
      sourceSha,
      "--source-ref",
      sourceRef,
      "--deny-self-hosted-runners",
      "--bundle",
      bundle,
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      "GitHub attestation verification failed for " +
        basename(artifact) +
        ": " +
        (result.stderr || "unknown gh failure").trim(),
    );
  }
  let verification;
  try {
    verification = JSON.parse(result.stdout);
  } catch {
    fail("GitHub attestation verification did not return JSON");
  }
  if (!Array.isArray(verification) || verification.length === 0) {
    fail("GitHub attestation verification returned no verified statement");
  }
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
  const manifest = readJson(manifestPath);
  if (
    manifest.schema !== "punks.desktop-platform-leg.v1" ||
    manifest.platform !== platform ||
    manifest.target !== PLATFORM_TARGETS[platform] ||
    manifest.sourceSha !== sourceSha ||
    manifest.stagingDeploymentId !== stagingDeploymentId
  ) {
    fail("Invalid platform manifest for " + platform);
  }
  if (
    !existsSync(provenancePath) ||
    lstatSync(provenancePath).isSymbolicLink()
  ) {
    fail("Verified provenance bundle missing for " + platform);
  }
  validateSigstoreBundle(provenancePath);
  if (
    manifest.nativeProof?.path !== "native-proof.json" ||
    lstatSync(nativeProofPath).isSymbolicLink() ||
    sha256(nativeProofPath) !== manifest.nativeProof.sha256
  ) {
    fail("Native proof digest mismatch for " + platform);
  }
  validateNativeProof(nativeProofPath, platform);
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
  const subjects = [manifestPath, nativeProofPath];
  for (const artifact of manifest.artifacts) {
    const path = join(root, artifact.path);
    if (
      artifact.path !== "artifacts/" + artifact.name ||
      !artifact.name.includes(sourceSha) ||
      basename(path) !== artifact.name ||
      lstatSync(path).isSymbolicLink() ||
      !statSync(path).isFile() ||
      sha256(path) !== artifact.sha256 ||
      statSync(path).size !== artifact.size
    ) {
      fail("Artifact digest mismatch for " + artifact.name);
    }
    subjects.push(path);
  }
  for (const subject of subjects) {
    verifyGithubSubject({
      artifact: subject,
      bundle: provenancePath,
      repository: verification.repository,
      sourceSha,
      sourceRef: verification.sourceRef,
      signerWorkflow: verification.signerWorkflow,
      ghBinary: verification.ghBinary,
    });
  }
  return { root, manifest, provenancePath };
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
  if (existsSync(output)) fail("Candidate aggregate output already exists");
  loadStagingProof(stagingProof, sourceSha, stagingDeploymentId);
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

  const releaseAssets = join(output, "release-assets");
  mkdirSync(releaseAssets, { recursive: true, mode: 0o755 });

  const allAssetNames = legs.flatMap(({ manifest }) =>
    manifest.artifacts.map(({ name }) => name),
  );
  if (new Set(allAssetNames).size !== allAssetNames.length) {
    fail("Platform legs contain duplicate release asset names");
  }
  for (const { root, manifest } of legs) {
    for (const artifact of manifest.artifacts) {
      copyFileSync(
        join(root, artifact.path),
        join(releaseAssets, artifact.name),
        constants.COPYFILE_EXCL,
      );
    }
  }

  const platforms = {};
  for (const { manifest } of legs) {
    const { artifact, signature } = updaterSelection(manifest);
    const signatureValue = readFileSync(
      join(releaseAssets, signature.name),
      "utf8",
    ).trim();
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
  const latestPath = join(releaseAssets, "latest.json");
  const immutableLatestPath = join(
    releaseAssets,
    "latest-" + sourceSha + ".json",
  );
  writeJsonExclusive(latestPath, latest);
  writeJsonExclusive(immutableLatestPath, latest);

  const stagedProofPath = join(output, "staging-deployment-proof.json");
  copyFileSync(stagingProof, stagedProofPath, constants.COPYFILE_EXCL);

  const releaseAssetManifest = topEntries(releaseAssets).map((entry) => {
    if (!entry.isFile()) fail("Release assets must contain files only");
    const path = join(releaseAssets, entry.name);
    return {
      name: entry.name,
      sha256: sha256(path),
      size: statSync(path).size,
    };
  });
  const aggregate = {
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha,
    stagingDeploymentId,
    version,
    repository,
    releaseTag,
    stagingProof: {
      path: relative(output, stagedProofPath),
      sha256: sha256(stagedProofPath),
    },
    platforms: PLATFORMS.map((platform) => {
      const leg = legs.find(({ manifest }) => manifest.platform === platform);
      return {
        platform,
        target: leg.manifest.target,
        manifestSha256: sha256(join(leg.root, "platform-manifest.json")),
        provenanceSha256: sha256(leg.provenancePath),
      };
    }),
    immutableLatest: {
      path: relative(output, immutableLatestPath),
      sha256: sha256(immutableLatestPath),
    },
    releaseAssets: releaseAssetManifest,
  };
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
      ghBinary: values.get("gh-binary") ?? "gh",
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
