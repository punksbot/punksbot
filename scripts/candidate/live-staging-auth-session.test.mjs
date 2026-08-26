import assert from "node:assert/strict";
import test from "node:test";

import { createLiveStagingAuthSession } from "./live-staging-auth-session.mjs";

test("delivers the real claimed browser Session as a source-bound promotion bundle", async () => {
  const sourceSha = "ab".repeat(20);
  const flowId = "70000000-0000-8000-8000-000000000058";
  const sessionId = "80000000-0000-8000-8000-000000000058";
  const punkId = "90000000-0000-8000-8000-000000000058";
  const expiresAt = "2099-01-01T00:00:00.000Z";
  const calls = [];
  const result = await createLiveStagingAuthSession(
    { sourceSha, pollLimit: 2 },
    {
      onBrowserUrl(url, observedFlowId) {
        assert.equal(observedFlowId, flowId);
        assert.match(url, /desktop\/browser/);
      },
      async wait() {
        throw new Error("ready flow must not wait");
      },
      async fetchImpl(url, init) {
        const path = new URL(url).pathname;
        const body = JSON.parse(init.body);
        calls.push([path, body.contract]);
        if (path.endsWith("/start")) {
          return Response.json(
            {
              flowId,
              browserUrl: `https://staging.punks.bot/api/auth/v1/desktop/browser?flow=${flowId}`,
            },
            { status: 201 },
          );
        }
        if (path.endsWith("/status")) {
          return Response.json({ phase: "ready" });
        }
        if (path.endsWith("/claim")) {
          return Response.json(
            {
              deliveryKind: "session",
              deliveryId: "a0000000-0000-8000-8000-000000000058",
              session: {
                sessionId,
                punkId,
                expiresAt,
                recentReauthUntil: null,
              },
              revokeCapability: {
                token: "r".repeat(64),
                expiresAt,
              },
            },
            {
              status: 200,
              headers: {
                "set-cookie": `__Host-punks_session=${"s".repeat(48)}; Path=/; Secure; HttpOnly`,
              },
            },
          );
        }
        if (path.endsWith("/confirm")) {
          return Response.json({ phase: "confirmed", sessionId });
        }
        throw new Error(`unexpected path ${path}`);
      },
    },
  );
  assert.equal(result.flowId, flowId);
  assert.equal(result.bundle.source_sha, sourceSha);
  assert.equal(result.bundle.metadata.session_id, sessionId);
  assert.equal(result.bundle.metadata.punk_id, punkId);
  assert.equal(result.bundle.revoke_capability, "r".repeat(64));
  assert.deepEqual(
    calls.map(([path]) => path),
    [
      "/api/auth/v1/desktop/start",
      "/api/auth/v1/desktop/status",
      "/api/auth/v1/desktop/claim",
      "/api/auth/v1/desktop/confirm",
    ],
  );
});
