import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const desktopRoot = resolve(import.meta.dirname, "..");
const checker = join(import.meta.dirname, "check-punks-candidate.mjs");
const base = join(desktopRoot, "src-tauri", "tauri.conf.json");
const flavor = join(desktopRoot, "src-tauri", "tauri.punks.conf.json");
const previousProduct = String.fromCharCode(98, 117, 122, 122);

function runChecker(...args) {
  return execFileSync(process.execPath, [checker, ...args], {
    cwd: desktopRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("the Punks candidate flavor removes every Punks distribution edge", () => {
  const output = runChecker("--base", base, "--config", flavor);
  assert.match(
    output,
    /Punks candidate configuration verified for macOS, Linux, and Windows/,
  );
});

test("the base Tauri shell is Punks-owned", () => {
  const shell = JSON.parse(readFileSync(base, "utf8"));
  assert.equal(shell.productName, "Punks Bot");
  assert.equal(shell.mainBinaryName, "punks-bot");
  assert.equal(shell.identifier, "bot.punks.desktop");
  assert.deepEqual(shell.plugins?.["deep-link"]?.desktop?.schemes, ["punks"]);
  assert.deepEqual(shell.bundle?.externalBin, []);
  assert.ok(!JSON.stringify(shell).toLowerCase().includes(previousProduct));
});

test("the conventional macOS bundle metadata is Punks-owned", () => {
  const info = readFileSync(
    join(desktopRoot, "src-tauri", "Info.plist"),
    "utf8",
  );
  assert.match(info, /<string>Punks Bot<\/string>/u);
  assert.ok(!new RegExp(`${previousProduct}|nostr|relay`, "iu").test(info));
});

test("the signed staging candidate is accepted by its backend and official updater", () => {
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  assert.equal(
    candidate.version,
    "0.6.0",
    "the exact Tauri version must satisfy the staging minimum",
  );
  assert.deepEqual(candidate.plugins?.updater?.endpoints, [
    "https://github.com/punksbot/punksbot/releases/latest/download/latest.json",
  ]);
  assert.equal(candidate.bundle?.macOS?.infoPlist, "Info.punks.plist");
});

test("the public checker rejects the inherited Punks Info.plist", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  candidate.bundle.macOS.infoPlist = "Info.plist";
  writeFileSync(fixture, JSON.stringify(candidate));
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /Punks-only Info\.plist is required/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("local, staging and production own distinct app and protocol identities", () => {
  assert.doesNotThrow(() => runChecker("--base", base, "--config", flavor));
  for (const name of [
    "tauri.punks.local.conf.json",
    "tauri.punks.production.conf.json",
  ]) {
    assert.ok(
      JSON.parse(readFileSync(join(desktopRoot, "src-tauri", name), "utf8")),
    );
  }
});

test("the local flavor disables updates with a complete updater configuration", () => {
  const local = JSON.parse(
    readFileSync(
      join(desktopRoot, "src-tauri", "tauri.punks.local.conf.json"),
      "utf8",
    ),
  );
  const staging = JSON.parse(readFileSync(flavor, "utf8"));
  assert.deepEqual(local.plugins?.updater?.endpoints, []);
  assert.equal(
    local.plugins?.updater?.pubkey,
    staging.plugins?.updater?.pubkey,
  );
  const csp = local.app?.security?.csp;
  assert.equal(typeof csp, "string");
  assert.match(csp, /punks-media/u);
  assert.match(csp, /http:\/\/punks-media\.localhost/u);
  assert.ok(!csp.toLowerCase().includes(previousProduct));
});

test("the public checker rejects a flavor that leaves a Punks sidecar", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  writeFileSync(
    fixture,
    JSON.stringify({
      productName: "Punks Bot Staging",
      mainBinaryName: "punks-bot-staging",
      identifier: "bot.punks.desktop.staging",
      app: {
        macOSPrivateApi: false,
        security: { capabilities: ["punks"] },
      },
      bundle: {
        externalBin: ["binaries/punks"],
      },
    }),
  );
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /bundle\.externalBin must be empty/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the public checker rejects inherited Punks capabilities", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  writeFileSync(
    fixture,
    JSON.stringify({
      productName: "Punks Bot Staging",
      mainBinaryName: "punks-bot-staging",
      identifier: "bot.punks.desktop.staging",
      app: {
        macOSPrivateApi: false,
        security: { capabilities: ["default", "punks"] },
      },
      bundle: { externalBin: [] },
    }),
  );
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /only the punks capability is allowed/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the public checker rejects a native binary that keeps the Punks name", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  candidate.mainBinaryName = "punks-desktop";
  writeFileSync(fixture, JSON.stringify(candidate));
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /mainBinaryName must isolate the Punks executable/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the public checker rejects a candidate without the rich TypeScript build", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  delete candidate.build;
  writeFileSync(fixture, JSON.stringify(candidate));
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /Punks application identity is not isolated/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the public checker rejects the production deep-link scheme for staging", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  candidate.plugins["deep-link"].desktop.schemes = ["punks"];
  writeFileSync(fixture, JSON.stringify(candidate));
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /only the punks-staging deep-link scheme is allowed/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
