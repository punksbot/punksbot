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
  const calls = [];
  const report = await collectOperationalBackendProbe(
    {
      sourceSha,
      stagingDeploymentId,
      sessionBundle: sessionBundle(),
    },
    {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      async fetchImpl(url, init) {
        const parsed = new URL(url);
        calls.push({ path: parsed.pathname, headers: init.headers });
        return response(parsed.pathname);
      },
    },
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(
    report.endpoints.map(({ path, status, result }) => ({
      path,
      status,
      result,
    })),
    [
      { path: "/api/health", status: 200, result: "vert" },
      { path: "/api/auth/v1/session", status: 200, result: "vert" },
      { path: "/api/v1/punk", status: 200, result: "vert" },
    ],
  );
  assert.ok(
    report.endpoints.every(({ responseSha256 }) =>
      /^[0-9a-f]{64}$/u.test(responseSha256),
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
  const report = await collectOperationalBackendProbe(
    {
      sourceSha,
      stagingDeploymentId,
      sessionBundle: sessionBundle(),
    },
    {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      async fetchImpl(url) {
        request += 1;
        return response(new URL(url).pathname, request === 2 ? 503 : 200);
      },
    },
  );
  assert.equal(
    report.endpoints.filter(({ result }) => result === "rouge").length,
    1,
  );
});

test("records a valid-looking Session from another account as a failure", async () => {
  const report = await collectOperationalBackendProbe(
    {
      sourceSha,
      stagingDeploymentId,
      sessionBundle: sessionBundle(),
    },
    {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      async fetchImpl(url) {
        const path = new URL(url).pathname;
        if (path !== "/api/auth/v1/session") return response(path);
        return new Response(
          JSON.stringify({
            session: {
              sessionId: "99999999-9999-4999-8999-999999999999",
              punkId: "88888888-8888-4888-8888-888888888888",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  assert.equal(
    report.endpoints.find(({ path }) => path === "/api/auth/v1/session").result,
    "rouge",
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
      },
      { fetchImpl: async () => response("/api/health") },
    ),
    /exact candidate|boundaries/i,
  );
});
