import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { localDesktopEnvironment, localTauriArguments } from "./dev-punks.mjs";

test("pins the native and frontend distributions to local Punks", () => {
  assert.deepEqual(localDesktopEnvironment({ PRESERVED: "yes" }), {
    PRESERVED: "yes",
    PUNKS_DISTRIBUTION: "development",
    PUNKS_LOCAL_KEYRING_SERVICE: "punks-bot-local-dev-v1",
    PUNKS_ORIGIN: "http://127.0.0.1:8787",
    VITE_PUNKS_DISTRIBUTION: "punks",
  });
});

test("runs the integrated desktop with the Punks-only flavor", () => {
  assert.deepEqual(localTauriArguments(), [
    "tauri",
    "dev",
    "--config",
    "src-tauri/tauri.punks.local.conf.json",
  ]);
});

test("the native manifest selects Punks instead of Punks by default", () => {
  const manifest = readFileSync(
    resolve(import.meta.dirname, "../src-tauri/Cargo.toml"),
    "utf8",
  );
  assert.match(manifest, /^default = \["punks-desktop-social-loop"\]$/mu);
  assert.doesNotMatch(manifest, /^default = .*punks-desktop.*$/mu);
  assert.doesNotMatch(manifest.split("[package]", 1)[0], /punks/iu);
});
