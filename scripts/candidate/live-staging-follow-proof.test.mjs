import assert from "node:assert/strict";
import test from "node:test";

import { proveLiveStagingFollow } from "./live-staging-follow-proof.mjs";
import { authAggregateUuid } from "./staging-fixture.mjs";

const SOURCE_SHA = "84".repeat(20);
const DEPLOYMENT_ID = `sha256:${"ab".repeat(32)}`;

test("refuse une identité non exacte avant toute frontière distante", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("frontière distante appelée");
  };

  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: "bad",
      stagingDeploymentId: DEPLOYMENT_ID,
      operatorToken: "x".repeat(64),
      fetchImpl,
    }),
    /exact source SHA/i,
  );
  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: "sha256:bad",
      operatorToken: "x".repeat(64),
      fetchImpl,
    }),
    /exact staging deployment ID/i,
  );
  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      operatorToken: "short",
      fetchImpl,
    }),
    /operator token unavailable/i,
  );
  assert.equal(calls, 0);
});

test("lie la fixture à l'autorité de révocation de la Session émise", async () => {
  const capability = "r".repeat(43);
  let fixtureInput;
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).endsWith("/api/internal/v1/promotion/session")) {
      return Response.json(
        {
          session: {
            cookie: `__Host-punks_session=${"s".repeat(64)}`,
            revoke_capability: capability,
          },
        },
        { status: 201 },
      );
    }
    if (String(url).endsWith("/api/auth/v1/desktop/session/revoke")) {
      return Response.json({ revoked: true }, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  await assert.rejects(
    proveLiveStagingFollow(
      {
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        operatorToken: "x".repeat(64),
        fetchImpl,
      },
      {
        async prepareFixture(input) {
          fixtureInput = input;
          throw new Error("stop after fixture identity");
        },
      },
    ),
    /stop after fixture identity/u,
  );
  assert.equal(
    fixtureInput.sessionRevocationId,
    authAggregateUuid("session-revocation", capability),
  );
  assert.equal(fixtureInput.fixtureScope, "follow");
  assert.equal(calls, 2);
});
