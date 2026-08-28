import assert from "node:assert/strict";
import test from "node:test";

import { collectOperationalBackendProbe } from "./operational-backend-probe.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const cookie = `__Host-punks_session=${"s".repeat(64)}`;

function sessionBundle() {
  return {
    source_sha: sourceSha,
    cookie,
    metadata: {
      session_id: "11111111-1111-4111-8111-111111111111",
      punk_id: "22222222-2222-4222-8222-222222222222",
      expires_at_seconds: 4_102_444_800,
      last_renewed_at_seconds: null,
    },
    revoke_capability: "r".repeat(43),
    revoke_expires_at_seconds: 4_102_444_800,
  };
}

function response(path, status = 200) {
  const body =
    path === "/api/health"
      ? { service: "punks-api", environment: "staging", status: "ok" }
      : path === "/api/auth/v1/session"
        ? {
            session: {
              sessionId: "11111111-1111-4111-8111-111111111111",
              punkId: "22222222-2222-4222-8222-222222222222",
            },
          }
        : { punk: { id: "22222222-2222-4222-8222-222222222222" } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("collects real bounded endpoint outcomes without serializing authority", async () => {
  let tick = 0;
  const calls = [];
  const report = await collectOperationalBackendProbe(
    {
      sourceSha,
      stagingDeploymentId,
      sessionBundle: sessionBundle(),
      countPerEndpoint: 10,
      concurrency: 3,
    },
    {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      clock: () => {
        tick += 2;
        return tick;
      },
      async fetchImpl(url, init) {
        const parsed = new URL(url);
        calls.push({ path: parsed.pathname, headers: init.headers });
        return response(parsed.pathname);
      },
    },
  );

  assert.equal(calls.length, 30);
  assert.deepEqual(
    report.endpoints.map(({ path, total, failures }) => ({
      path,
      total,
      failures,
    })),
    [
      { path: "/api/health", total: 10, failures: 0 },
      { path: "/api/auth/v1/session", total: 10, failures: 0 },
      { path: "/api/v1/punk", total: 10, failures: 0 },
    ],
  );
  assert.ok(
    report.endpoints.every(
      ({ histogram }) =>
        histogram.reduce((sum, bucket) => sum + bucket.count, 0) === 10,
    ),
  );
  assert.doesNotMatch(JSON.stringify(report), /punks_session|ssss|rrrr/u);
  assert.match(report.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(
    calls
      .filter(({ path }) => path !== "/api/health")
      .every(({ headers }) => headers.cookie === cookie),
  );
});

test("records a failed provider response instead of declaring it green", async () => {
  let request = 0;
  let tick = 0;
  const report = await collectOperationalBackendProbe(
    {
      sourceSha,
      stagingDeploymentId,
      sessionBundle: sessionBundle(),
      countPerEndpoint: 2,
      concurrency: 1,
    },
    {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      clock: () => ++tick,
      async fetchImpl(url) {
        request += 1;
        return response(new URL(url).pathname, request === 2 ? 503 : 200);
      },
    },
  );
  assert.equal(
    report.endpoints.reduce((sum, endpoint) => sum + endpoint.failures, 0),
    1,
  );
});

test("rejects another candidate, invalid bounds and a stale Session", async () => {
  const stale = sessionBundle();
  stale.metadata.expires_at_seconds = 1;
  stale.revoke_expires_at_seconds = 1;
  await assert.rejects(
    collectOperationalBackendProbe(
      {
        sourceSha,
        stagingDeploymentId,
        sessionBundle: stale,
        countPerEndpoint: 1,
        concurrency: 1,
      },
      { fetchImpl: async () => response("/api/health") },
    ),
    /Session metadata|expiry|invalid/i,
  );
  await assert.rejects(
    collectOperationalBackendProbe(
      {
        sourceSha: "not-a-sha",
        stagingDeploymentId,
        sessionBundle: sessionBundle(),
        countPerEndpoint: 0,
        concurrency: 0,
      },
      { fetchImpl: async () => response("/api/health") },
    ),
    /exact candidate|bounded/i,
  );
});
