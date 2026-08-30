import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../workers/api/wrangler.jsonc", import.meta.url);

test("local and isolated staging expose the implemented desktop profile", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(
    manifest.vars.DESKTOP_SOCIAL_LOOP_ENABLED,
    "true",
    "local development must mount the autonomous Punks desktop",
  );
  assert.equal(
    manifest.env.staging.vars.DESKTOP_SOCIAL_LOOP_ENABLED,
    "true",
    "the exact staging deployment must expose T1 to the installed candidate",
  );
  assert.equal(manifest.env.staging.vars.ENVIRONMENT, "staging");
  assert.deepEqual(manifest.env.staging.routes, [
    { pattern: "staging.punks.bot/api/*", zone_name: "punks.bot" },
  ]);
});
