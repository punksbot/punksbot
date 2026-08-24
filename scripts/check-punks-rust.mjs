#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPunksNativeArtifact } from "./punks-native-artifact.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = join(root, "desktop", "src-tauri", "Cargo.toml");
const capabilityPath = join(
  root,
  "desktop",
  "src-tauri",
  "capabilities",
  "punks.json",
);
const tauriConfig = JSON.stringify({
  app: {
    security: { capabilities: ["punks"] },
  },
  bundle: { externalBin: [] },
});
const argumentsList = process.argv.slice(2);
let nativeArtifact;
if (argumentsList.length !== 0) {
  if (
    argumentsList.length !== 2 ||
    argumentsList[0] !== "--binary" ||
    !argumentsList[1]
  ) {
    console.error("usage: check-punks-rust.mjs [--binary <path>]");
    process.exit(1);
  }
  nativeArtifact = argumentsList[1];
}

const environment = {
  ...process.env,
  PUNKS_DISTRIBUTION: process.env.PUNKS_DISTRIBUTION ?? "staging",
  PUNKS_ORIGIN: process.env.PUNKS_ORIGIN ?? "https://staging.punks.bot",
  TAURI_CONFIG: tauriConfig,
};
const featureArguments = [
  "--manifest-path",
  manifest,
  "--no-default-features",
  "--features",
  "punks-desktop-social-loop",
];

const result = spawnSync("cargo", ["check", ...featureArguments], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const tree = spawnSync(
  "cargo",
  ["tree", ...featureArguments, "--edges", "normal", "--prefix", "none"],
  {
    cwd: root,
    env: environment,
    encoding: "utf8",
  },
);
if (tree.error) {
  throw tree.error;
}
if (tree.status !== 0) {
  process.stderr.write(tree.stderr);
  process.exit(tree.status ?? 1);
}

const packages = new Set(
  tree.stdout
    .split("\n")
    .map((line) => line.trim().match(/^([^ ]+) v\d/)?.[1])
    .filter(Boolean),
);
const forbiddenPackages = [
  "buzz-agent",
  "buzz-core",
  "buzz-persona",
  "buzz-sdk",
  "buzz-terminal",
  "buzz-voice",
  "buzz-ws-client",
  "nostr",
  "nostr-sdk",
  "rodio",
  "sherpa-onnx",
  "tauri-plugin-dialog",
  "tauri-plugin-global-shortcut",
  "tauri-plugin-notification",
  "tauri-plugin-window-state",
];
const presentForbiddenPackages = forbiddenPackages.filter((name) =>
  packages.has(name),
);
if (presentForbiddenPackages.length > 0) {
  console.error(
    `Punks native dependency graph contains forbidden packages: ${presentForbiddenPackages.join(", ")}`,
  );
  process.exit(1);
}

const capability = JSON.parse(readFileSync(capabilityPath, "utf8"));
const expectedPermissions = [
  "core:default",
  "core:window:allow-set-focus",
  "core:window:allow-show",
  "opener:default",
  "process:allow-restart",
  "updater:allow-check",
  "updater:allow-download",
  "updater:allow-install",
].sort();
const actualPermissions = Array.isArray(capability.permissions)
  ? [...capability.permissions].sort()
  : [];
if (
  capability.identifier !== "punks" ||
  JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)
) {
  console.error(
    "Punks Tauri capability must contain only the reviewed minimal permission set.",
  );
  process.exit(1);
}

console.log(
  `Punks native graph verified: ${packages.size} packages, no Buzz/Nostr/media/agent runtime packages.`,
);
if (nativeArtifact) {
  const proof = verifyPunksNativeArtifact(nativeArtifact);
  console.log(
    `Punks native artifact verified: ${proof.name}, ${proof.size} bytes, sha256:${proof.sha256}.`,
  );
}
