import assert from "node:assert/strict";
import test from "node:test";

import { smokeApi, smokeLocal } from "./smoke-local.mjs";

test("accepts the exact local API health response", async () => {
  const calls = [];
  const result = await smokeLocal("http://127.0.0.1:8787", async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ service: "punks-api", environment: "local", status: "ok" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  assert.deepEqual(calls, ["http://127.0.0.1:8787/api/health"]);
  assert.deepEqual(result, {
    service: "punks-api",
    environment: "local",
    status: "ok",
  });
});

test("accepts the exact staging API health response", async () => {
  const result = await smokeApi(
    "https://staging.punks.bot",
    "staging",
    async () =>
      new Response(
        JSON.stringify({
          service: "punks-api",
          environment: "staging",
          status: "ok",
        }),
      ),
  );

  assert.equal(result.environment, "staging");
});

test("fails when the server is not the local Punks API", async () => {
  await assert.rejects(
    smokeLocal(
      "http://127.0.0.1:8787",
      async () => new Response(JSON.stringify({ service: "other", status: "ok" })),
    ),
    /unexpected local health response/,
  );
});
