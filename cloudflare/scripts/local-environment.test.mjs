import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ensureLocalEnvironment,
  LOCAL_BINDING_FILES,
} from "./local-environment.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("creates isolated local Worker bindings without a remote AI binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-local-environment-"));

  const result = await ensureLocalEnvironment(root);

  assert.deepEqual(
    result.created.sort(),
    Object.keys(LOCAL_BINDING_FILES).sort(),
  );
  for (const [relativePath, bindings] of Object.entries(LOCAL_BINDING_FILES)) {
    const path = join(root, relativePath);
    const content = await readFile(path, "utf8");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    for (const key of Object.keys(bindings)) {
      assert.match(content, new RegExp(`^${key}=`, "m"));
    }
    assert.doesNotMatch(content, /^AI=/m);
  }
  const apiVariables = await readFile(
    join(root, "cloudflare/workers/api/.dev.vars"),
    "utf8",
  );
  assert.match(
    apiVariables,
    /^ATTESTATION_PUBLIC_KEYS_JSON='\{"local":\{"local-v1":"[0-9a-f]{64}"\}\}'$/m,
  );
});

test("preserves an existing Worker-specific local binding file", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-local-environment-"));
  const relativePath = "cloudflare/workers/auth/.dev.vars";
  const path = join(root, relativePath);
  await mkdir(join(root, "cloudflare/workers/auth"), { recursive: true });
  await writeFile(path, "CUSTOM=value\n", { mode: 0o600 });

  const result = await ensureLocalEnvironment(root);

  assert.equal(await readFile(path, "utf8"), "CUSTOM=value\n");
  assert.ok(result.preserved.includes(relativePath));
});

test("repairs only the exact legacy-generated escaped binding file", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-local-environment-"));
  const relativePath = "cloudflare/workers/api/.dev.vars";
  const path = join(root, relativePath);
  const bindings = LOCAL_BINDING_FILES[relativePath];
  const legacy = `${Object.entries(bindings)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, legacy, { mode: 0o600 });

  const result = await ensureLocalEnvironment(root);

  assert.ok(result.repaired.includes(relativePath));
  assert.ok(!result.preserved.includes(relativePath));
  assert.match(
    await readFile(path, "utf8"),
    /^ATTESTATION_PUBLIC_KEYS_JSON='\{"local":\{"local-v1":"[0-9a-f]{64}"\}\}'$/m,
  );
});

test("keeps local Auth and the Punks UI proxy on one strict origin", async () => {
  const auth = JSON.parse(
    await readFile(
      join(repositoryRoot, "cloudflare/workers/auth/wrangler.jsonc"),
      "utf8",
    ),
  );
  const gateway = JSON.parse(
    await readFile(
      join(repositoryRoot, "cloudflare/workers/dev-gateway/wrangler.jsonc"),
      "utf8",
    ),
  );

  assert.equal(gateway.vars.PUNKS_UI_ORIGIN, "http://localhost:1420");
  assert.equal(auth.vars.AUTH_BASE_URL, gateway.vars.PUNKS_UI_ORIGIN);
  for (const name of [
    "GOOGLE_AUTHORIZATION_ENDPOINT",
    "GOOGLE_TOKEN_ENDPOINT",
    "GOOGLE_USERINFO_ENDPOINT",
    "GITHUB_AUTHORIZATION_ENDPOINT",
    "GITHUB_TOKEN_ENDPOINT",
    "GITHUB_API_BASE_URL",
  ]) {
    assert.match(auth.vars[name], /^http:\/\/127\.0\.0\.1(?::\d+)?\//u);
    assert.match(auth.env.staging.vars[name], /^https:\/\//u);
  }
  assert.equal(
    auth.env.staging.vars.AUTH_BASE_URL,
    "https://staging.punks.bot",
  );
  assert.equal(gateway.env, undefined);
});
