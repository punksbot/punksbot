import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "@punks/core";

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

async function proveR2Archive(
  bucket: R2Bucket,
  sourceSha: string,
  stagingDeploymentId: string,
) {
  const values: Array<{
    key: string;
    body: string;
    sha256: string;
    previousSha256: string | null;
  }> = [];
  let previousSha256: string | null = null;
  for (let index = 0; index < 2; index += 1) {
    const body = canonicalJson({
      schema: "punks.promotion-r2-archive-probe.v1",
      sourceSha,
      stagingDeploymentId,
      index,
      previousSha256,
    });
    const sha256 = await sha256Hex(body);
    values.push({
      key: `promotion-operational-probes/${sourceSha}/${stagingDeploymentId.slice(7)}/${String(index)}-${sha256}.json`,
      body,
      sha256,
      previousSha256,
    });
    previousSha256 = sha256;
  }
  for (const value of values) {
    await bucket.put(value.key, value.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        sourceSha,
        stagingDeploymentId,
        sha256: value.sha256,
        previousSha256: value.previousSha256 ?? "",
      },
    });
  }
  const first = values[0];
  if (first === undefined) throw new Error("R2 probe is empty");
  const duplicate = await bucket.put(first.key, "divergent", {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  let objectsValid = true;
  for (const value of values) {
    const object = await bucket.get(value.key);
    const remoteBody = object === null ? null : await object.text();
    const objectValid =
      object !== null &&
      object.httpMetadata?.contentType === "application/json" &&
      object.customMetadata?.sourceSha === sourceSha &&
      object.customMetadata?.stagingDeploymentId === stagingDeploymentId &&
      object.customMetadata?.sha256 === value.sha256 &&
      object.customMetadata?.previousSha256 === (value.previousSha256 ?? "") &&
      remoteBody === value.body &&
      (await sha256Hex(remoteBody ?? "")) === value.sha256;
    objectsValid = objectsValid && objectValid;
  }
  const duplicateWriteRejected = duplicate === null;
  return {
    objects: values.length,
    chainHeadSha256: values.at(-1)?.sha256 ?? "",
    objectsValid,
    duplicateWriteRejected,
    result:
      objectsValid && duplicateWriteRejected && values.length === 2
        ? "vert"
        : "rouge",
  };
}

async function observeQueues(env: ApiEnv) {
  const bindings = [
    { name: "punks-projection-staging", queue: env.PROJECTION_QUEUE },
    {
      name: "punks-projection-staging-dlq",
      queue: env.PROJECTION_DLQ_OBSERVER,
    },
    { name: "punks-bot-wake-staging", queue: env.BOT_WAKE_QUEUE },
    {
      name: "punks-bot-wake-staging-dlq",
      queue: env.BOT_WAKE_DLQ_OBSERVER,
    },
  ];
  return Promise.all(
    bindings.map(async ({ name, queue }) => {
      const metrics = await queue.metrics();
      const oldestMessageTimestampMs =
        metrics.oldestMessageTimestamp?.getTime() ?? 0;
      if (
        !Number.isSafeInteger(metrics.backlogCount) ||
        metrics.backlogCount < 0 ||
        !Number.isSafeInteger(metrics.backlogBytes) ||
        metrics.backlogBytes < 0 ||
        !Number.isSafeInteger(oldestMessageTimestampMs) ||
        oldestMessageTimestampMs < 0
      ) {
        throw new Error(`promotion Queue ${name} metrics are invalid`);
      }
      return {
        name,
        backlogCount: metrics.backlogCount,
        backlogBytes: metrics.backlogBytes,
        oldestMessageTimestampMs,
        result:
          metrics.backlogCount === 0 &&
          metrics.backlogBytes === 0 &&
          oldestMessageTimestampMs === 0
            ? "vert"
            : "rouge",
      };
    }),
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
    const [authorities, queues, r2Probe] = await Promise.all([
      Promise.all([
        env.WORKSPACES.getByName(
          workspaceId,
        ).observePromotionOperationalState(),
        env.CONVERSATIONS.getByName(
          conversationId,
        ).observePromotionOperationalState(),
      ]),
      observeQueues(env),
      proveR2Archive(
        env.JOURNAL_ARCHIVE_BUCKET,
        value.sourceSha,
        value.stagingDeploymentId,
      ),
    ]);
    return json(
      {
        schema: "punks.promotion-operational-state.v1",
        sourceSha: value.sourceSha,
        stagingDeploymentId: value.stagingDeploymentId,
        fixture: { workspaceId, conversationId },
        authorities,
        queues,
        r2Probe,
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
