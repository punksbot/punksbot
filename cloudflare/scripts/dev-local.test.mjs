import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  LOCAL_D1_DATABASES,
  localD1MigrationArguments,
  localRuntimeEnvironment,
  localWranglerArguments,
} from "./dev-local.mjs";

test("disables Wrangler network telemetry and update prompts locally", () => {
  assert.deepEqual(localRuntimeEnvironment({ PRESERVED: "yes" }), {
    PRESERVED: "yes",
    DO_NOT_TRACK: "1",
    WRANGLER_HIDE_BANNER: "true",
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_SEND_METRICS: "false",
  });
});

test("uses one persistent local state for all D1 migrations", () => {
  const root = "/workspace/punksbot";
  const state = join(root, "cloudflare/.wrangler/local");

  assert.equal(LOCAL_D1_DATABASES.length, 4);
  for (const database of LOCAL_D1_DATABASES) {
    const args = localD1MigrationArguments(root, database);
    assert.deepEqual(args.slice(0, 5), [
      "--filter",
      "@punks/projector-worker",
      "exec",
      "wrangler",
      "d1",
    ]);
    assert.ok(args.includes("migrations"));
    assert.ok(args.includes("apply"));
    assert.ok(args.includes(database));
    assert.ok(args.includes("--local"));
    assert.equal(args.at(-1), state);
    assert.ok(!args.includes("--remote"));
  }
});

test("starts the complete local Worker graph without remote bindings", () => {
  const root = "/workspace/punksbot";
  const args = localWranglerArguments(root, 8787);

  assert.deepEqual(args.slice(0, 5), [
    "--filter",
    "@punks/dev-gateway-worker",
    "exec",
    "wrangler",
    "dev",
  ]);
  assert.ok(args.includes("--local"));
  assert.ok(!args.includes("--remote"));
  assert.equal(args.filter((value) => value === "--config").length, 8);
  assert.ok(
    args.includes(join(root, "cloudflare/workers/dev-gateway/wrangler.jsonc")),
  );
  assert.ok(
    args.includes(join(root, "cloudflare/workers/bot-runtime/wrangler.jsonc")),
  );
  assert.ok(
    args.includes(join(root, "cloudflare/workers/projector/wrangler.jsonc")),
  );
  assert.equal(args.at(-1), join(root, "cloudflare/.wrangler/local"));
});
