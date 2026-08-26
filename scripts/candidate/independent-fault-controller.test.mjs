import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PREUVES_RECUPERATION } from "../promotion-resilience-lib.mjs";
import { assignedResilienceScenarios } from "./resilience-observation.mjs";
import {
  createStagingBoundary,
  exerciseIndependentFaultMatrix,
  promotionAuthorityTargets,
} from "./independent-fault-controller.mjs";

const PLATFORM = "linux-x64";
const SOURCE_SHA = "91".repeat(20);
const DEPLOYMENT_ID = `sha256:${"92".repeat(32)}`;
const ARTIFACT_SHA256 = "93".repeat(32);
const AUTHORITIES = ["auth-session", "api-workspace", "api-conversation"];
const FIXTURE = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  sessionRevocationId: "66666666-6666-4666-8666-666666666666",
  punkId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  workspaceSlug: "promotion-fixture",
  conversationId: "44444444-4444-4444-8444-444444444444",
  seedMessageIds: ["55555555-5555-4555-8555-555555555555"],
};
const TARGETS = promotionAuthorityTargets(FIXTURE, AUTHORITIES);

test("rejects a receipt-controller response without authority-owned state", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const identity = {
    type: "coupure",
    authority: "api-conversation",
    executionId: `${SOURCE_SHA.slice(0, 12)}:linux-x64:coupure:api-conversation`,
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    target: TARGETS["api-conversation"],
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/inject")) {
      return Response.json(
        {
          receipt: {
            ...identity,
            phase: "injected",
            sequence: 1,
          },
        },
        { status: 201 },
      );
    }
    return Response.json({ code: "temporarily_unavailable" }, { status: 503 });
  };
  await assert.rejects(
    createStagingBoundary({
      origin: "https://staging.punks.bot",
      token: "operator-test-token".repeat(3),
    }).inject(identity),
    /did not emit its own exact fault state/i,
  );
});

test("derives resilience only from an independent inject/recover boundary", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-fault-controller-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "faults.json");
  const calls = [];

  const result = await exerciseIndependentFaultMatrix(
    {
      platform: PLATFORM,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      artifactSha256: ARTIFACT_SHA256,
      authorities: AUTHORITIES,
      targets: TARGETS,
      output,
    },
    {
      boundary: {
        async inject({ type, authority, executionId }) {
          calls.push(["inject", type, authority, executionId]);
          return {
            startedAt: "2026-08-26T14:00:00.000Z",
            receipt: `injected:${executionId}`,
          };
        },
        async recover({ type, authority, executionId, proof }) {
          calls.push(["recover", type, authority, executionId, proof]);
          return {
            receipt: `recovered:${proof}:${executionId}`,
          };
        },
      },
      observer: {
        async observeFailure({ type, authority, executionId, control }) {
          calls.push(["observe-failure", type, authority, executionId]);
          assert.equal(control.receipt, `injected:${executionId}`);
          return {
            observedAt: "2026-08-26T14:00:01.000Z",
            operation: `installed-public-contract/${authority}`,
            failureKind:
              type === "revocation" ? "session_expired" : "transport",
            observations: [
              `${type}/${authority} failed closed in the installed client`,
            ],
          };
        },
        async observeRecovery({
          type,
          authority,
          executionId,
          proof,
          control,
        }) {
          calls.push(["observe-recovery", type, authority, executionId, proof]);
          assert.equal(control.receipt, `recovered:${proof}:${executionId}`);
          return {
            observedAt: "2026-08-26T14:00:02.000Z",
            observations: [
              `${proof} recovered ${type}/${authority} in the installed client`,
            ],
          };
        },
      },
    },
  );

  const expected = assignedResilienceScenarios(PLATFORM, AUTHORITIES);
  assert.equal(result.scenarios.length, expected.length);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), result);
  for (const scenario of expected) {
    const prefix = `${scenario.type}/${scenario.authority}`;
    const injection = calls.find(
      ([kind, type, authority]) =>
        kind === "inject" && `${type}/${authority}` === prefix,
    );
    assert.ok(injection, `missing injection ${prefix}`);
    const injectionIndex = calls.indexOf(injection);
    const failureIndex = calls.findIndex(
      ([kind, type, authority]) =>
        kind === "observe-failure" && `${type}/${authority}` === prefix,
    );
    assert.ok(
      failureIndex > injectionIndex,
      `fault ${prefix} was not observed`,
    );
    assert.equal(
      calls.filter(
        ([kind, type, authority]) =>
          kind === "recover" && `${type}/${authority}` === prefix,
      ).length,
      PREUVES_RECUPERATION.length,
    );
    for (const proof of PREUVES_RECUPERATION) {
      const recoverIndex = calls.findIndex(
        ([kind, type, authority, , selectedProof]) =>
          kind === "recover" &&
          `${type}/${authority}` === prefix &&
          selectedProof === proof,
      );
      const observedIndex = calls.findIndex(
        ([kind, type, authority, , selectedProof]) =>
          kind === "observe-recovery" &&
          `${type}/${authority}` === prefix &&
          selectedProof === proof,
      );
      assert.ok(
        observedIndex > recoverIndex,
        `${proof} ${prefix} was not observed after recovery`,
      );
    }
  }
});

test("refuses a controller self-probe without an installed authority observer", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-fault-self-probe-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    exerciseIndependentFaultMatrix(
      {
        platform: PLATFORM,
        candidateSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        artifactSha256: ARTIFACT_SHA256,
        authorities: AUTHORITIES,
        targets: TARGETS,
        output: join(root, "faults.json"),
      },
      {
        boundary: {
          async inject() {
            return { startedAt: "2026-08-26T14:00:00.000Z" };
          },
          async recover() {
            return {};
          },
        },
      },
    ),
    /installed authority observer is unavailable/i,
  );
});
