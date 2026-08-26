import assert from "node:assert/strict";
import test from "node:test";

import { proveLiveStagingFollow } from "./live-staging-follow-proof.mjs";

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
