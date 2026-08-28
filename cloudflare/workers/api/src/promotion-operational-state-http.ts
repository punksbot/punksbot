import { canonicalJson, deriveOpaqueUuid } from "@punks/core";

import type { ApiEnv } from "./env";
import { isOperator, json, problem, readJson } from "./http";

const PATH = "/api/internal/v1/promotion/operational-state";
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;

function exactRecord(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

async function fixtureCommandId(domain: string, sourceSha: string) {
  return deriveOpaqueUuid(
    "punks.promotion.fixture.v1",
    `${domain}\u0000${sourceSha}`,
  );
}

/** Returns only bounded counters and archive integrity for the exact T1 fixture. */
export async function routePromotionOperationalState(
  request: Request,
  env: ApiEnv,
  path: string,
): Promise<Response | null> {
  if (path !== PATH) return null;
  if (
    env.ENVIRONMENT !== "staging" ||
    env.PROMOTION_FAULTS_ENABLED !== "true"
  ) {
    return problem(404, "not_found", "Resource not found");
  }
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(403, "forbidden", "Operator observation is forbidden");
  }
  if (request.method !== "POST") {
    return problem(405, "invalid_input", "POST is required");
  }
  let value: unknown;
  try {
    value = await readJson(request, 4_096);
  } catch {
    return problem(400, "invalid_input", "Observation body is invalid");
  }
  if (
    !exactRecord(value, ["contract", "sourceSha", "stagingDeploymentId"]) ||
    value.contract !== "promotion.operational-state@1" ||
    typeof value.sourceSha !== "string" ||
    !SHA1_RE.test(value.sourceSha) ||
    typeof value.stagingDeploymentId !== "string" ||
    !DEPLOYMENT_RE.test(value.stagingDeploymentId)
  ) {
    return problem(400, "invalid_input", "Observation identity is invalid");
  }
  const workspaceCommandId = await fixtureCommandId(
    "workspace",
    value.sourceSha,
  );
  const workspaceId = await deriveOpaqueUuid(
    "punks.workspace.v1",
    workspaceCommandId,
  );
  const conversationCommandId = await fixtureCommandId(
    "conversation",
    value.sourceSha,
  );
  const conversationId = await deriveOpaqueUuid(
    "punks.conversation.v1",
    canonicalJson({ commandId: conversationCommandId, workspaceId }),
  );
  try {
    const authorities = await Promise.all([
      env.WORKSPACES.getByName(workspaceId).observePromotionOperationalState(),
      env.CONVERSATIONS.getByName(
        conversationId,
      ).observePromotionOperationalState(),
    ]);
    return json(
      {
        schema: "punks.promotion-operational-state.v1",
        sourceSha: value.sourceSha,
        stagingDeploymentId: value.stagingDeploymentId,
        fixture: { workspaceId, conversationId },
        authorities,
      },
      200,
      { "cache-control": "no-store" },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "promotion operational state observation failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return problem(
      503,
      "temporarily_unavailable",
      "Promotion operational state is unavailable",
    );
  }
}
