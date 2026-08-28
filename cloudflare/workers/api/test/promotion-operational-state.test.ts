import { canonicalJson, deriveOpaqueUuid } from "@punks/core";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { ApiEnv } from "../src/env";
import { routePromotionOperationalState } from "../src/promotion-operational-state-http";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const token = "operator-token-that-is-long-enough-for-tests";
const url =
  "https://staging.punks.bot/api/internal/v1/promotion/operational-state";

async function fixtureId(domain: string) {
  return deriveOpaqueUuid(
    "punks.promotion.fixture.v1",
    `${domain}\u0000${sourceSha}`,
  );
}

async function expectedCoordinates() {
  const workspaceId = await deriveOpaqueUuid(
    "punks.workspace.v1",
    await fixtureId("workspace"),
  );
  const conversationId = await deriveOpaqueUuid(
    "punks.conversation.v1",
    canonicalJson({
      commandId: await fixtureId("conversation"),
      workspaceId,
    }),
  );
  return { workspaceId, conversationId };
}

function request(authorization = `Bearer ${token}`, body: unknown = {}) {
  return new Request(url, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function archiveBucket() {
  const objects = new Map<
    string,
    {
      body: string;
      httpMetadata: R2HTTPMetadata;
      customMetadata: Record<string, string>;
    }
  >();
  return {
    async put(key: string, body: string, options: R2PutOptions = {}) {
      if (objects.has(key) && options.onlyIf !== undefined) return null;
      objects.set(key, {
        body,
        httpMetadata: (options.httpMetadata ?? {}) as R2HTTPMetadata,
        customMetadata: options.customMetadata ?? {},
      });
      return { key };
    },
    async get(key: string) {
      const value = objects.get(key);
      if (value === undefined) return null;
      return {
        key,
        httpMetadata: value.httpMetadata,
        customMetadata: value.customMetadata,
        text: async () => value.body,
      };
    },
  } as unknown as R2Bucket;
}

function emptyQueue() {
  return {
    async metrics() {
      return { backlogCount: 0, backlogBytes: 0 };
    },
  } as unknown as Queue;
}

describe("promotion operational state", () => {
  it("observes the exact deterministic fixture and no unrelated aggregate", async () => {
    const coordinates = await expectedCoordinates();
    const workspaceState = {
      authority: "api-workspace",
      outboxesPending: 0,
      pendingArchives: 0,
      archiveSegments: 1,
      archiveHeadValid: true,
    };
    const conversationState = {
      authority: "api-conversation",
      outboxesPending: 0,
      pendingArchives: 0,
      archiveSegments: 1,
      archiveHeadValid: true,
    };
    const workspaceGet = vi.fn((id: string) => {
      expect(id).toBe(coordinates.workspaceId);
      return {
        observePromotionOperationalState: vi.fn(async () => workspaceState),
      };
    });
    const conversationGet = vi.fn((id: string) => {
      expect(id).toBe(coordinates.conversationId);
      return {
        observePromotionOperationalState: vi.fn(async () => conversationState),
      };
    });
    const env = {
      OPERATOR_PROVISIONING_TOKEN: token,
      ENVIRONMENT: "staging",
      PROMOTION_FAULTS_ENABLED: "true",
      JOURNAL_ARCHIVE_BUCKET: archiveBucket(),
      PROJECTION_QUEUE: emptyQueue(),
      PROJECTION_DLQ_OBSERVER: emptyQueue(),
      BOT_WAKE_QUEUE: emptyQueue(),
      BOT_WAKE_DLQ_OBSERVER: emptyQueue(),
      WORKSPACES: { getByName: workspaceGet },
      CONVERSATIONS: { getByName: conversationGet },
    } as unknown as ApiEnv;
    const response = await routePromotionOperationalState(
      request(`Bearer ${token}`, {
        contract: "promotion.operational-state@1",
        sourceSha,
        stagingDeploymentId,
      }),
      env,
      new URL(url).pathname,
    );
    expect(response?.status).toBe(200);
    const document = (await response?.json()) as Record<string, unknown>;
    expect(document).toMatchObject({
      schema: "punks.promotion-operational-state.v1",
      sourceSha,
      stagingDeploymentId,
      fixture: coordinates,
      authorities: [workspaceState, conversationState],
      queues: [
        "punks-projection-staging",
        "punks-projection-staging-dlq",
        "punks-bot-wake-staging",
        "punks-bot-wake-staging-dlq",
      ].map((name) => ({
        name,
        backlogCount: 0,
        backlogBytes: 0,
        oldestMessageTimestampMs: 0,
        result: "vert",
      })),
    });
    expect(document.r2Probe).toMatchObject({
      objects: 2,
      objectsValid: true,
      duplicateWriteRejected: true,
      result: "vert",
    });
    expect(
      (document.r2Probe as { chainHeadSha256: string }).chainHeadSha256,
    ).toMatch(/^[0-9a-f]{64}$/u);
    expect(workspaceGet).toHaveBeenCalledOnce();
    expect(conversationGet).toHaveBeenCalledOnce();
  });

  it("refuses a missing operator identity and a widened body", async () => {
    const env = {
      OPERATOR_PROVISIONING_TOKEN: token,
      ENVIRONMENT: "staging",
      PROMOTION_FAULTS_ENABLED: "true",
    } as unknown as ApiEnv;
    expect(
      (
        await routePromotionOperationalState(
          request("", {}),
          env,
          new URL(url).pathname,
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await routePromotionOperationalState(
          request(`Bearer ${token}`, {
            contract: "promotion.operational-state@1",
            sourceSha,
            stagingDeploymentId,
            bypass: true,
          }),
          env,
          new URL(url).pathname,
        )
      )?.status,
    ).toBe(400);
  });

  it("refuses empty Durable Objects instead of reporting zero pending work", async () => {
    const workspace = env.WORKSPACES.getByName(
      "33333333-3333-8333-8333-333333333333",
    );
    const conversation = env.CONVERSATIONS.getByName(
      "44444444-4444-8444-8444-444444444444",
    );
    await runInDurableObject(workspace, async (instance) => {
      await expect(instance.observePromotionOperationalState()).rejects.toThrow(
        /absent or inactive/u,
      );
    });
    await runInDurableObject(conversation, async (instance) => {
      await expect(instance.observePromotionOperationalState()).rejects.toThrow(
        /absent or inactive/u,
      );
    });
  });
});
