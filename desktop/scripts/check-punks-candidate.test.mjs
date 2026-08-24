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

function runChecker(...args) {
  return execFileSync(process.execPath, [checker, ...args], {
    cwd: desktopRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("the Punks candidate flavor removes every Buzz distribution edge", () => {
  const output = runChecker("--base", base, "--config", flavor);
  assert.match(
    output,
    /Punks candidate configuration verified for macOS, Linux, and Windows/,
  );
});

test("the public checker rejects a flavor that leaves a Buzz sidecar", () => {
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
        externalBin: ["binaries/buzz"],
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

test("the public checker rejects inherited Buzz capabilities", () => {
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

test("the public checker rejects a native binary that keeps the Buzz name", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  candidate.mainBinaryName = "buzz-desktop";
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

test("the public checker rejects the global Buzz TypeScript build", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "punks-candidate-config-"));
  const fixture = join(fixtureRoot, "invalid.json");
  const candidate = JSON.parse(readFileSync(flavor, "utf8"));
  delete candidate.build;
  writeFileSync(fixture, JSON.stringify(candidate));
  try {
    assert.throws(
      () => runChecker("--base", base, "--config", fixture),
      /Punks-only TypeScript build is required/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
