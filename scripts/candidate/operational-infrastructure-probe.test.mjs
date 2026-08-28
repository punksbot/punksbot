import assert from "node:assert/strict";
import test from "node:test";

import { collectOperationalInfrastructureProof } from "./operational-infrastructure-probe.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const queueNames = [
  "punks-projection-staging",
  "punks-projection-staging-dlq",
  "punks-bot-wake-staging",
  "punks-bot-wake-staging-dlq",
];

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function input() {
  return {
    sourceSha,
    stagingDeploymentId,
    operatorToken: "o".repeat(64),
    destinations: [
      {
        role: "primaire",
        compte: "3a391620584c792dbbd8cfa148d7634a",
        bucket: "primary",
      },
      {
        role: "secondaire",
        compte: "3a391620584c792dbbd8cfa148d7634a",
        bucket: "recovery",
      },
    ],
  };
}

function boundaries() {
  return {
    cloudflare: {
      async lireVerrouillage() {
        return { mode: "compliance", actif: true };
      },
    },
  };
}

function fetchBoundary({ failedQueue = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/internal/v1/promotion/operational-state")) {
      return response({
        schema: "punks.promotion-operational-state.v1",
        sourceSha,
        stagingDeploymentId,
        fixture: {
          workspaceId: "11111111-1111-8111-8111-111111111111",
          conversationId: "22222222-2222-8222-8222-222222222222",
        },
        authorities: ["api-workspace", "api-conversation"].map((authority) => ({
          authority,
          outboxesPending: 0,
          pendingArchives: 0,
          archiveSegments: 1,
          archiveHeadValid: true,
        })),
        queues: queueNames.map((name) => {
          const failed = name === failedQueue;
          return {
            name,
            backlogCount: failed ? 1 : 0,
            backlogBytes: failed ? 64 : 0,
            oldestMessageTimestampMs: failed ? 1_787_910_000_000 : 0,
            result: failed ? "rouge" : "vert",
          };
        }),
        r2Probe: {
          objects: 2,
          chainHeadSha256: "ab".repeat(32),
          objectsValid: true,
          duplicateWriteRejected: true,
          result: "vert",
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { calls, fetchImpl };
}

test("collects dedicated queue, outbox, archive and R2 lock proofs", async () => {
  const remote = fetchBoundary();
  const report = await collectOperationalInfrastructureProof(input(), {
    fetchImpl: remote.fetchImpl,
    frontieres: boundaries(),
    now: () => new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(report.queues.length, 4);
  assert.ok(report.queues.every(({ result }) => result === "vert"));
  assert.ok(report.authorities.every(({ result }) => result === "vert"));
  assert.ok(report.locks.every(({ result }) => result === "vert"));
  assert.equal(report.r2Probe.result, "vert");
  assert.match(report.sha256, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(report), /o{32}/u);
  assert.equal(remote.calls.length, 1);
});

test("keeps a non-empty DLQ red instead of manufacturing an empty state", async () => {
  const remote = fetchBoundary({ failedQueue: "punks-bot-wake-staging-dlq" });
  const report = await collectOperationalInfrastructureProof(input(), {
    fetchImpl: remote.fetchImpl,
    frontieres: boundaries(),
    now: () => new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(
    report.queues.find(({ name }) => name.endsWith("wake-staging-dlq")).result,
    "rouge",
  );
});
