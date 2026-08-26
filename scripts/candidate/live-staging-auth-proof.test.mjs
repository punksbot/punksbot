import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { proveLiveStagingAuth } from "./live-staging-auth-proof.mjs";

const sourceSha = "ab".repeat(20);
const flowId = "70000000-0000-8000-8000-000000000058";
const workers = CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
  name,
  versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  sourceShaAnnotation: sourceShaAnnotation(sourceSha),
  deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
}));
const core = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha,
  observer: "cloudflare-remote",
  workers,
};
const stagingDeploymentId = `sha256:${createHash("sha256")
  .update(canonicalJson(core))
  .digest("hex")}`;
const stagingProof = { ...core, deploymentId: stagingDeploymentId };

test("accepts only a confirmed provider proof from the exact Auth Worker", async () => {
  const proof = await proveLiveStagingAuth(
    {
      sourceSha,
      stagingDeploymentId,
      flowId,
      operatorToken: "operator-token-never-emitted-000000000000000000000000",
      stagingProof,
    },
    {
      async fetchImpl(_url, init) {
        assert.match(init.headers.authorization, /^Bearer /);
        return Response.json({
          proof: {
            schema: "punks.live-staging-auth-proof.v1",
            sourceSha,
            stagingDeploymentId,
            authWorkerVersionId: workers[0].versionId,
            flow: {
              flowId,
              method: "github",
              intent: "sign_in",
              environment: "staging",
              outcomeCode: "authenticated",
              punkId: "80000000-0000-8000-8000-000000000058",
              sessionId: "90000000-0000-8000-8000-000000000058",
              browserCompletedAt: "2026-08-26T17:00:00.000Z",
              confirmedAt: "2026-08-26T17:00:01.000Z",
              browserBindingHash: "a".repeat(64),
              oauthStateHash: "b".repeat(64),
              providerPkceHash: "c".repeat(64),
              nativeVerifierCommitment: "d".repeat(43),
            },
            negative: {
              wrongOauthState: "refused",
              wrongBrowserBinding: "refused",
              wrongNativePkceVerifier: "refused",
            },
            observedAt: "2026-08-26T17:00:02.000Z",
          },
        });
      },
    },
  );
  assert.equal(proof.flow.method, "github");
  assert.equal(proof.authWorkerVersionId, workers[0].versionId);
});

test("rejects a provider proof attributed to another Auth deployment", async () => {
  await assert.rejects(
    proveLiveStagingAuth(
      {
        sourceSha,
        stagingDeploymentId,
        flowId,
        operatorToken: "operator-token-never-emitted-000000000000000000000000",
        stagingProof,
      },
      {
        async fetchImpl() {
          return Response.json({
            proof: {
              schema: "punks.live-staging-auth-proof.v1",
              sourceSha,
              stagingDeploymentId,
              authWorkerVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              flow: { flowId },
              negative: {},
              observedAt: "2026-08-26T17:00:02.000Z",
            },
          });
        },
      },
    ),
    /confirmed real provider flow/i,
  );
});
