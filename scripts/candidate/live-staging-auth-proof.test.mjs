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
import {
  proveLiveStagingAuth,
  proveLiveStagingAuthMatrix,
} from "./live-staging-auth-proof.mjs";

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
              sourceSha,
              stagingDeploymentId,
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

test("accepts only the complete Google, GitHub and passkey success/cancellation matrix", async () => {
  const methods = ["google", "github", "passkey"];
  const matrix = Object.fromEntries(
    methods.map((method, methodIndex) => [
      method,
      {
        successFlowId: `${methodIndex + 1}0000000-0000-8000-8000-000000000058`,
        cancellationFlowId: `${methodIndex + 4}0000000-0000-8000-8000-000000000058`,
      },
    ]),
  );
  const flows = Object.fromEntries(
    methods.map((method, methodIndex) => {
      const common = {
        method,
        intent: "sign_in",
        environment: "staging",
        browserBindingHash: `${methodIndex + 1}`.repeat(64),
        nativeVerifierCommitment: `${methodIndex + 4}`.repeat(43),
        sourceSha,
        stagingDeploymentId,
      };
      return [
        method,
        {
          success: {
            ...common,
            flowId: matrix[method].successFlowId,
            outcomeCode:
              method === "passkey" ? "passkey_authenticated" : "authenticated",
            punkId: `${methodIndex + 7}0000000-0000-8000-8000-000000000058`,
            sessionId: `${methodIndex + 1}1000000-0000-8000-8000-000000000058`,
            browserCompletedAt: `2026-08-26T17:0${methodIndex}:00.000Z`,
            confirmedAt: `2026-08-26T17:0${methodIndex}:01.000Z`,
            methodEvidence:
              method === "passkey"
                ? {
                    kind: "passkey",
                    challengeHash: "a".repeat(64),
                    credentialIdHash: "b".repeat(64),
                  }
                : {
                    kind: "oauth",
                    oauthStateHash: "c".repeat(64),
                    providerPkceHash: "d".repeat(64),
                  },
          },
          cancellation: {
            ...common,
            flowId: matrix[method].cancellationFlowId,
            outcomeCode: "cancelled",
            cancelledAt: `2026-08-26T17:0${methodIndex}:02.000Z`,
          },
        },
      ];
    }),
  );
  const proof = await proveLiveStagingAuthMatrix(
    {
      sourceSha,
      stagingDeploymentId,
      matrix,
      operatorToken: "operator-token-never-emitted-000000000000000000000000",
      stagingProof,
    },
    {
      async fetchImpl(_url, init) {
        const request = JSON.parse(init.body);
        assert.deepEqual(request.flows, matrix);
        return Response.json({
          proof: {
            schema: "punks.live-staging-auth-matrix-proof.v2",
            sourceSha,
            stagingDeploymentId,
            authWorkerVersionId: workers[0].versionId,
            flows,
            negative: {
              wrongOauthState: "refused",
              wrongBrowserBinding: "refused",
              wrongNativePkceVerifier: "refused",
              wrongPasskeyChallenge: "refused",
            },
            observedAt: "2026-08-26T17:03:00.000Z",
          },
        });
      },
    },
  );
  assert.deepEqual(Object.keys(proof.flows), methods);
  assert.equal(proof.flows.passkey.success.methodEvidence.kind, "passkey");
  assert.equal(proof.flows.github.success.methodEvidence.kind, "oauth");
});
