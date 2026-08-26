import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deterministicUuid,
  authAggregateUuid,
  parsePromotionSessionBundle,
  prepareStagingFixture,
} from "./staging-fixture.mjs";

const sourceSha = "12".repeat(20);
const origin = "https://staging.punks.bot";
const cookie = `__Host-punks_session=${"s".repeat(48)}`;
const operatorToken = "operator-secret-never-output-000000000000";
const punkId = "00000000-0000-8000-8000-000000000001";
const workspaceId = "00000000-0000-8000-8000-000000000002";
const conversationId = "00000000-0000-8000-8000-000000000003";
const sessionId = "00000000-0000-8000-8000-000000000004";
const sessionRevocationId = authAggregateUuid(
  "session-revocation",
  "r".repeat(64),
);

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("deterministic UUIDs remain source-bound canonical UUIDs", () => {
  const first = deterministicUuid("workspace", sourceSha);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(first, deterministicUuid("workspace", sourceSha));
  assert.notEqual(first, deterministicUuid("conversation", sourceSha));
});

test("accepts only a promotion Session issued for the exact candidate", () => {
  const bundle = {
    source_sha: sourceSha,
    cookie,
    metadata: {
      session_id: "70000000-0000-8000-8000-000000000058",
      punk_id: punkId,
      expires_at_seconds: 4_102_444_800,
      last_renewed_at_seconds: null,
    },
    revoke_capability: "r".repeat(64),
    revoke_expires_at_seconds: 4_102_444_800,
  };
  assert.equal(
    parsePromotionSessionBundle(JSON.stringify(bundle), sourceSha).cookie,
    cookie,
  );
  assert.throws(
    () => parsePromotionSessionBundle(JSON.stringify(bundle), "34".repeat(20)),
    /another source SHA/,
  );
});

test("prepares one idempotent paginated staging fixture without leaking authority", async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === "/api/auth/v1/session") {
      return response(200, {
        session: {
          sessionId,
          punkId,
          expiresAt: "2026-09-24T00:00:00Z",
          punk: { id: punkId, displayName: "Proof Punk", avatarUrl: null },
        },
      });
    }
    if (path === "/api/internal/v1/workspaces") {
      return response(201, { workspace: { id: workspaceId } });
    }
    if (path.endsWith("/conversations")) {
      return response(201, { conversation: { id: conversationId } });
    }
    if (path.endsWith("/messages")) {
      const index = calls.filter(({ url: seen }) =>
        new URL(seen).pathname.endsWith("/messages"),
      ).length;
      return response(201, {
        message: {
          id: `00000000-0000-8000-8001-${String(index).padStart(12, "0")}`,
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const fixture = await prepareStagingFixture({
    sourceSha,
    origin,
    cookie,
    operatorToken,
    sessionRevocationId,
    fetchImpl: fakeFetch,
    historyCount: 52,
  });

  assert.equal(fixture.sourceSha, sourceSha);
  assert.equal(fixture.sessionId, sessionId);
  assert.equal(fixture.sessionRevocationId, sessionRevocationId);
  assert.equal(fixture.workspaceId, workspaceId);
  assert.equal(fixture.conversationId, conversationId);
  assert.equal(fixture.seedMessageIds.length, 52);
  assert.match(fixture.replyMessageId, /^[0-9a-f-]{36}$/);
  assert.equal(fixture.topicRequired, true);
  assert.doesNotMatch(JSON.stringify(fixture), /operator-secret|punks_session/);
  assert.equal(calls.length, 56);
  const replyCall = calls.at(-1);
  assert.equal(
    JSON.parse(replyCall.init.body).payload.replyToMessageId,
    fixture.seedMessageIds.at(-1),
  );

  const workspaceCall = calls[1];
  assert.equal(
    workspaceCall.init.headers.authorization,
    `Bearer ${operatorToken}`,
  );
  for (const call of calls.slice(2)) {
    assert.equal(call.init.headers.cookie, cookie);
    assert.equal(call.init.headers.origin, origin);
    assert.match(call.init.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  }
});

test("fails closed on wrong origin, bad session and partial fixture writes", async () => {
  await assert.rejects(
    prepareStagingFixture({
      sourceSha,
      origin: "http://staging.punks.bot",
      cookie,
      operatorToken,
      sessionRevocationId,
      fetchImpl: async () => response(500, {}),
    }),
    /HTTPS staging origin/,
  );
  await assert.rejects(
    prepareStagingFixture({
      sourceSha,
      origin,
      cookie: "invalid",
      operatorToken,
      sessionRevocationId,
      fetchImpl: async () => response(500, {}),
    }),
    /session cookie/,
  );
  await assert.rejects(
    prepareStagingFixture({
      sourceSha,
      origin,
      cookie,
      operatorToken,
      sessionRevocationId,
      fetchImpl: async (url) =>
        new URL(url).pathname === "/api/auth/v1/session"
          ? response(200, {
              session: {
                sessionId,
                punkId,
                expiresAt: "2026-09-24T00:00:00Z",
                punk: {
                  id: punkId,
                  displayName: "Proof Punk",
                  avatarUrl: null,
                },
              },
            })
          : response(503, { code: "temporarily_unavailable" }),
    }),
    /workspace provisioning failed with HTTP 503/,
  );
});
