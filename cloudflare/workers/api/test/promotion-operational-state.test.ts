import { canonicalJson, deriveOpaqueUuid } from "@punks/core";
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
    expect(await response?.json()).toEqual({
      schema: "punks.promotion-operational-state.v1",
      sourceSha,
      stagingDeploymentId,
      fixture: coordinates,
      authorities: [workspaceState, conversationState],
    });
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
});
