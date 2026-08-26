import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  createStagingDeploymentProof,
  observeStagingDeployment,
  sourceShaAnnotation,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  observeOperationalTopology,
  validateOperationalTopologyObservation,
} from "./operational-topology-observation.mjs";

const sourceSha = "71".repeat(20);
const versionIds = CANONICAL_STAGING_WORKER_NAMES.map(
  (_, index) =>
    `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
);
const deploymentIds = CANONICAL_STAGING_WORKER_NAMES.map(
  (_, index) =>
    `${String(index + 11).padStart(8, "0")}-2222-4222-8222-222222222222`,
);

function rawStaging() {
  return {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha,
    workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
      name,
      versions: [
        {
          id: versionIds[index],
          number: index + 1,
          metadata: {
            created_on: `2026-08-26T19:00:0${index}Z`,
            source: "wrangler",
          },
          annotations: {
            "workers/message": sourceShaAnnotation(sourceSha),
            "workers/triggered_by": "version_upload",
          },
        },
      ],
      deployment: {
        id: deploymentIds[index],
        created_on: `2026-08-26T19:01:0${index}Z`,
        source: "wrangler",
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionIds[index] }],
      },
    })),
  };
}

const securityGenerations = {
  compatibility: 1,
  operatorProvisioning: 2,
  promotionSession: 3,
  releaseApprovers: 4,
  r2Primary: 5,
  r2Recovery: 6,
  attestationPrimary: 7,
  attestationSecondary: 8,
  sessionRecovery: 9,
};

test("reobserves the exact deployed Workflow version and protected generations", async () => {
  const stagingBoundary = {
    async observe() {
      return rawStaging();
    },
  };
  const staging = createStagingDeploymentProof(
    await observeStagingDeployment(
      {
        accountId: CANONICAL_STAGING_ACCOUNT_ID,
        environment: "staging",
        sourceSha,
      },
      stagingBoundary,
    ),
  );
  const observation = await observeOperationalTopology(
    {
      sourceSha,
      stagingDeploymentId: staging.deploymentId,
      securityGenerations,
    },
    {
      cloudflare: {
        staging: stagingBoundary,
        async listWorkflows() {
          return [
            {
              id: "workflow-id",
              name: "punks-bot-wake-staging",
              script_name: "punks-bot-runtime-staging",
              class_name: "BotWakeWorkflow",
              created_on: "2026-08-26T19:02:00.000Z",
              modified_on: "2026-08-26T19:03:00.000Z",
            },
          ];
        },
        async listWorkflowVersions() {
          return [
            {
              id: "workflow-version-id",
              created_on: "2026-08-26T19:03:00.000Z",
            },
          ];
        },
      },
      now: () => new Date("2026-08-26T19:04:00.000Z"),
    },
  );
  assert.equal(observation.workflows[0].versionId, "workflow-version-id");
  assert.deepEqual(observation.securityGenerations, securityGenerations);
  assert.equal(
    validateOperationalTopologyObservation(observation, {
      sourceSha,
      stagingDeploymentId: staging.deploymentId,
    }),
    observation,
  );
});

test("refuses configured-only or ambiguous Workflows", async () => {
  const stagingBoundary = {
    async observe() {
      return rawStaging();
    },
  };
  const staging = createStagingDeploymentProof(
    await observeStagingDeployment(
      {
        accountId: CANONICAL_STAGING_ACCOUNT_ID,
        environment: "staging",
        sourceSha,
      },
      stagingBoundary,
    ),
  );
  await assert.rejects(
    observeOperationalTopology(
      {
        sourceSha,
        stagingDeploymentId: staging.deploymentId,
        securityGenerations,
      },
      {
        cloudflare: {
          staging: stagingBoundary,
          async listWorkflows() {
            return [];
          },
          async listWorkflowVersions() {
            return [];
          },
        },
      },
    ),
    /Workflow is missing/i,
  );
});
