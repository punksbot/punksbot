#!/usr/bin/env node

import { lstatSync, writeFileSync } from "node:fs";

const PLATFORMS = new Set([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be supplied as --name value pairs");
    }
    values.set(name.slice(2), value);
  }
  return values;
}

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(name + " must be exactly true or false");
}

export function buildNativeProof(argumentsMap) {
  const platform = argumentsMap.get("platform");
  const identity = argumentsMap.get("identity");
  const timestamped = parseBoolean(
    argumentsMap.get("timestamped"),
    "timestamped",
  );

  if (!PLATFORMS.has(platform)) {
    throw new Error("Unsupported native proof platform");
  }
  if (!identity?.trim()) {
    throw new Error("A non-empty native signing identity is required");
  }
  if (platform !== "linux-x64" && timestamped !== true) {
    throw new Error("Apple and Windows native signatures must be timestamped");
  }

  const proof = {
    schema: "punks.desktop-native-proof.v1",
    platform,
    verified: true,
    identity,
    timestamped,
  };

  const optionalBooleans = [
    ["notarized", "notarized"],
    ["embedded-appimage-signature", "embeddedAppImageSignature"],
    ["detached-deb-signature", "detachedDebSignature"],
  ];
  for (const [argumentName, propertyName] of optionalBooleans) {
    if (argumentsMap.has(argumentName)) {
      proof[propertyName] = parseBoolean(
        argumentsMap.get(argumentName),
        argumentName,
      );
    }
  }

  for (const [argumentName, propertyName] of [
    ["team-id", "teamId"],
    ["thumbprint", "thumbprint"],
  ]) {
    if (argumentsMap.has(argumentName)) {
      proof[propertyName] = argumentsMap.get(argumentName);
    }
  }

  if (
    platform.startsWith("macos-") &&
    (!/^[A-Z0-9]{10}$/.test(proof.teamId ?? "") || proof.notarized !== true)
  ) {
    throw new Error("macOS proof requires the exact Team ID and notarization");
  }
  if (
    platform === "windows-x64" &&
    !/^[0-9A-F]{40}$/.test(proof.thumbprint ?? "")
  ) {
    throw new Error("Windows proof requires an uppercase SHA-1 thumbprint");
  }
  if (
    platform === "linux-x64" &&
    (proof.embeddedAppImageSignature !== true ||
      proof.detachedDebSignature !== true)
  ) {
    throw new Error("Linux proof requires AppImage and Debian signatures");
  }

  return proof;
}

export function writeNativeProof(argv = process.argv.slice(2)) {
  const argumentsMap = parseArguments(argv);
  const output = argumentsMap.get("output");
  if (!output) {
    throw new Error("--output is required");
  }
  try {
    lstatSync(output);
    throw new Error("Native proof output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const proof = buildNativeProof(argumentsMap);
  writeFileSync(output, JSON.stringify(proof, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return proof;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    writeNativeProof();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
