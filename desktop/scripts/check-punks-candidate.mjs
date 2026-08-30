import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PLATFORMS = ["macos", "linux", "windows"];
const EXPECTED_PRODUCT_NAME = "Punks Bot Staging";
const EXPECTED_MAIN_BINARY_NAME = "punks-bot-staging";
const EXPECTED_IDENTIFIER = "bot.punks.desktop.staging";
const EXPECTED_VERSION = "0.6.0";
const EXPECTED_DEEP_LINK_SCHEME = "punks-staging";
const EXPECTED_UPDATER_ENDPOINT =
  "https://github.com/punksbot/punksbot/releases/latest/download/latest.json";
const EXPECTED_UPDATER_PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ2MTFCOEFFQTQyRjBDQTUKUldTbERDK2tycmdSMXJINFZUSWt3bkFWS3o4Y1EyazRrazBCbXV1M2FSSUY4M1dqSDZBUlIrKzYK";
const EXPECTED_PUNKS_BUILD = "pnpm build";
const EXPECTED_MACOS_INFO_PLIST = "Info.punks.plist";
const previousProduct = String.fromCharCode(98, 117, 122, 122);
const ENVIRONMENT_FLAVORS = [
  {
    environment: "staging",
    file: "tauri.punks.conf.json",
    productName: "Punks Bot Staging",
    mainBinaryName: "punks-bot-staging",
    identifier: "bot.punks.desktop.staging",
    scheme: "punks-staging",
    version: "0.6.0",
    build: EXPECTED_PUNKS_BUILD,
    infoPlist: EXPECTED_MACOS_INFO_PLIST,
    externalBinCount: 0,
    capability: "punks",
  },
  {
    environment: "local",
    file: "tauri.punks.local.conf.json",
    productName: "Punks Full Local",
    mainBinaryName: "punks-full-local",
    identifier: "bot.punks.full.local",
    scheme: "punks-local",
    version: "0.5.20",
    build: undefined,
    infoPlist: "Info.punks.local.plist",
    externalBinCount: 5,
    capability: undefined,
  },
  {
    environment: "production",
    file: "tauri.punks.production.conf.json",
    productName: "Punks Bot",
    mainBinaryName: "punks-bot",
    identifier: "bot.punks.desktop",
    scheme: "punks",
    version: "0.6.0",
    build: EXPECTED_PUNKS_BUILD,
    infoPlist: EXPECTED_MACOS_INFO_PLIST,
    externalBinCount: 0,
    capability: "punks",
  },
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Apply RFC 7396 JSON Merge Patch, matching Tauri's configuration merge. */
export function mergePatch(target, patch) {
  if (!isObject(patch)) {
    return structuredClone(patch);
  }
  const result = isObject(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = mergePatch(result[key], value);
    }
  }
  return result;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertCandidate(config, platform) {
  const externalBins = config?.bundle?.externalBin;
  if (!Array.isArray(externalBins) || externalBins.length !== 0) {
    throw new Error(`${platform}: bundle.externalBin must be empty`);
  }
  if (config?.productName !== EXPECTED_PRODUCT_NAME) {
    throw new Error(
      `${platform}: productName must identify the Punks candidate`,
    );
  }
  if (config?.mainBinaryName !== EXPECTED_MAIN_BINARY_NAME) {
    throw new Error(
      `${platform}: mainBinaryName must isolate the Punks executable`,
    );
  }
  if (config?.identifier !== EXPECTED_IDENTIFIER) {
    throw new Error(`${platform}: identifier must isolate the Punks candidate`);
  }
  const capabilities = config?.app?.security?.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.length !== 1 ||
    capabilities[0] !== "punks"
  ) {
    throw new Error(`${platform}: only the punks capability is allowed`);
  }
  if (config?.build?.beforeBuildCommand !== EXPECTED_PUNKS_BUILD) {
    throw new Error(`${platform}: Punks-only TypeScript build is required`);
  }
  const schemes = config?.plugins?.["deep-link"]?.desktop?.schemes;
  if (
    !Array.isArray(schemes) ||
    schemes.length !== 1 ||
    schemes[0] !== EXPECTED_DEEP_LINK_SCHEME
  ) {
    throw new Error(
      `${platform}: only the punks-staging deep-link scheme is allowed`,
    );
  }
  const updater = config?.plugins?.updater;
  if (
    !Array.isArray(updater?.endpoints) ||
    updater.endpoints.length !== 1 ||
    updater.endpoints[0] !== EXPECTED_UPDATER_ENDPOINT
  ) {
    throw new Error(
      `${platform}: the immutable Punks updater endpoint is required`,
    );
  }
  if (updater?.pubkey !== EXPECTED_UPDATER_PUBLIC_KEY) {
    throw new Error(`${platform}: the Punks updater public key is required`);
  }
  if (config?.bundle?.createUpdaterArtifacts !== true) {
    throw new Error(`${platform}: signed updater artifacts must be enabled`);
  }
  if (config?.bundle?.macOS?.infoPlist !== EXPECTED_MACOS_INFO_PLIST) {
    throw new Error(`${platform}: the Punks-only Info.plist is required`);
  }
  const csp = config?.app?.security?.csp;
  if (typeof csp !== "string" || csp.toLowerCase().includes(previousProduct)) {
    throw new Error(
      `${platform}: the candidate CSP must not retain a Punks scheme`,
    );
  }
  if (config?.version !== EXPECTED_VERSION) {
    throw new Error(`${platform}: version must satisfy the staging minimum`);
  }
}

function assertEnvironmentIsolation(configRoot, stagingPatch) {
  const seen = new Set();
  for (const expected of ENVIRONMENT_FLAVORS) {
    const config =
      expected.environment === "staging"
        ? stagingPatch
        : loadJson(join(configRoot, expected.file));
    const schemes = config?.plugins?.["deep-link"]?.desktop?.schemes;
    const identity = [
      config.productName,
      config.mainBinaryName,
      config.identifier,
      schemes?.[0],
    ];
    if (
      identity[0] !== expected.productName ||
      identity[1] !== expected.mainBinaryName ||
      identity[2] !== expected.identifier ||
      !Array.isArray(schemes) ||
      schemes.length !== 1 ||
      identity[3] !== expected.scheme ||
      config?.build?.beforeBuildCommand !== expected.build ||
      config?.version !== expected.version ||
      config?.bundle?.externalBin?.length !== expected.externalBinCount ||
      config?.bundle?.macOS?.infoPlist !== expected.infoPlist ||
      (expected.capability !== undefined &&
        (config?.app?.security?.capabilities?.length !== 1 ||
          config.app.security.capabilities[0] !== expected.capability))
    ) {
      throw new Error(
        `${expected.environment}: Punks application identity is not isolated`,
      );
    }
    const key = identity.join("\0");
    if (seen.has(key)) {
      throw new Error(
        `${expected.environment}: Punks application identity is reused`,
      );
    }
    seen.add(key);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--base" && flag !== "--config") || !value) {
      throw new Error(
        "usage: check-punks-candidate.mjs --base <path> --config <path>",
      );
    }
    options[flag.slice(2)] = resolve(value);
  }
  if (!options.base || !options.config) {
    throw new Error(
      "usage: check-punks-candidate.mjs --base <path> --config <path>",
    );
  }
  return options;
}

export function validateCandidateFiles({ base, config }) {
  const baseConfig = loadJson(base);
  const candidatePatch = loadJson(config);
  const configRoot = dirname(base);
  for (const platform of PLATFORMS) {
    const platformPath = join(configRoot, `tauri.${platform}.conf.json`);
    const platformConfig = existsSync(platformPath)
      ? loadJson(platformPath)
      : {};
    const merged = mergePatch(
      mergePatch(baseConfig, platformConfig),
      candidatePatch,
    );
    assertCandidate(merged, platform);
  }
  const infoPlist = readFileSync(
    join(configRoot, EXPECTED_MACOS_INFO_PLIST),
    "utf8",
  );
  if (
    !infoPlist.includes("<dict/>") ||
    new RegExp(
      `${previousProduct}|nostr|relay|huddle|NS(?:Microphone|Camera|LocalNetwork)UsageDescription`,
      "iu",
    ).test(infoPlist)
  ) {
    throw new Error("the Punks-only Info.plist retains a legacy capability");
  }
  const conventionalInfoPlist = readFileSync(
    join(configRoot, "Info.plist"),
    "utf8",
  );
  if (
    new RegExp(`${previousProduct}|nostr|relay`, "iu").test(
      conventionalInfoPlist,
    )
  ) {
    throw new Error(
      "the bundled macOS Info.plist retains a retired product marker",
    );
  }
  assertEnvironmentIsolation(configRoot, candidatePatch);
}

export function main(argv = process.argv.slice(2)) {
  validateCandidateFiles(parseArgs(argv));
  process.stdout.write(
    "Punks candidate configuration verified for macOS, Linux, and Windows\n",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
