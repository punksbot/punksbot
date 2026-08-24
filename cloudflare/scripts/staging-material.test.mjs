import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureStagingMaterial,
  parseBindingFile,
  STAGING_MACHINE_KEYS,
} from "./staging-material.mjs";

test("generates independent staging machine secrets and the matching public key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "punks-staging-material-"));
  const path = join(directory, ".dev.vars.staging");

  const first = await ensureStagingMaterial(path);
  const bindings = parseBindingFile(await readFile(path, "utf8"));

  assert.deepEqual(first.created.sort(), [...STAGING_MACHINE_KEYS].sort());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  for (const key of STAGING_MACHINE_KEYS) {
    assert.ok(typeof bindings[key] === "string" && bindings[key].length >= 64);
  }
  assert.match(bindings.ATTESTATION_PRIVATE_KEY, /^[0-9a-f]{64}$/);
  const registry = JSON.parse(bindings.ATTESTATION_PUBLIC_KEYS_JSON);
  assert.match(registry.staging["staging-v1"], /^[0-9a-f]{64}$/);
  assert.equal(
    new Set([
      bindings.BOT_INVOCATION_CURRENT_SECRET,
      bindings.OPERATOR_PROVISIONING_TOKEN,
      bindings.MESSAGE_SEARCH_MASTER_KEY,
      bindings.MESSAGE_SEARCH_CURSOR_KEY,
      bindings.MESSAGE_HISTORY_CURSOR_KEY,
      bindings.DIRECTORY_CURSOR_KEY,
    ]).size,
    6,
  );

  const firstContent = await readFile(path, "utf8");
  const second = await ensureStagingMaterial(path);
  assert.deepEqual(second.created, []);
  assert.equal(await readFile(path, "utf8"), firstContent);
});

test("preserves OAuth values captured by the staging wizard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "punks-staging-material-"));
  const path = join(directory, ".dev.vars.staging");
  const initial = [
    "GOOGLE_OAUTH_CLIENT_ID=google-id",
    "GOOGLE_OAUTH_CLIENT_SECRET=google-secret",
    "GITHUB_OAUTH_CLIENT_ID=github-id",
    "GITHUB_OAUTH_CLIENT_SECRET=github-secret",
    "",
  ].join("\n");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, initial, { mode: 0o600 }),
  );

  await ensureStagingMaterial(path);
  const bindings = parseBindingFile(await readFile(path, "utf8"));

  assert.equal(bindings.GOOGLE_OAUTH_CLIENT_ID, "google-id");
  assert.equal(bindings.GITHUB_OAUTH_CLIENT_SECRET, "github-secret");
});
