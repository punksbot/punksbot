import type { BotWakeQueueBody } from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveBotWakeWorkflowId } from "@punks/core";

import type { BotRuntimeEnv } from "./env";

interface PendingWorkflow {
  readonly params: BotWakeQueueBody;
  readonly messages: Message<unknown>[];
  conflicting: boolean;
}

const ACKNOWLEDGEABLE_WORKFLOW_STATUSES = new Set([
  "queued",
  "running",
  "waiting",
  "complete",
]);

function workflowStatus(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status = Reflect.get(value, "status");
  return typeof status === "string" ? status : null;
}

async function repairExistingWorkflow(
  workflowId: string,
  env: BotRuntimeEnv,
): Promise<boolean> {
  try {
    const instance = await env.BOT_WAKE_WORKFLOW.get(workflowId);
    const status = workflowStatus(await instance.status());
    if (status !== null && ACKNOWLEDGEABLE_WORKFLOW_STATUSES.has(status)) {
      return true;
    }
    if (status !== "errored") {
      return false;
    }
    await instance.restart();
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts the opaque at-least-once Queue delivery into idempotent Workflow
 * instances without adding authority coordinates to persisted parameters.
 */
export async function consumeBotWakeQueue(
  batch: MessageBatch<unknown>,
  env: BotRuntimeEnv,
): Promise<void> {
  const pendingByWorkflowId = new Map<string, PendingWorkflow>();

  for (const queued of batch.messages) {
    let valid = false;
    try {
      valid = validateContract(
        "punks://contracts/bot-wake.queue@1",
        queued.body,
      ).valid;
    } catch {
      valid = false;
    }
    if (!valid) {
      queued.ack();
      continue;
    }

    const params = queued.body as BotWakeQueueBody;
    let workflowId: string;
    try {
      workflowId = await deriveBotWakeWorkflowId(params.wakeId);
    } catch {
      queued.retry();
      continue;
    }
    const pending = pendingByWorkflowId.get(workflowId);
    if (pending === undefined) {
      pendingByWorkflowId.set(workflowId, {
        params,
        messages: [queued],
        conflicting: false,
      });
    } else {
      pending.messages.push(queued);
      if (pending.params.installationId !== params.installationId) {
        pending.conflicting = true;
      }
    }
  }

  const actionable = [...pendingByWorkflowId].filter(
    ([, pending]) => !pending.conflicting,
  );
  for (const pending of pendingByWorkflowId.values()) {
    if (pending.conflicting) {
      for (const queued of pending.messages) {
        queued.retry();
      }
    }
  }
  if (actionable.length === 0) {
    return;
  }
  let createdWorkflowIds = new Set<string>();
  try {
    const created = await env.BOT_WAKE_WORKFLOW.createBatch(
      actionable.map(([id, { params }]) => ({ id, params })),
    );
    if (!Array.isArray(created)) {
      throw new Error("invalid Workflow createBatch result");
    }
    for (const instance of created) {
      const id = Reflect.get(instance, "id");
      if (
        typeof id === "string" &&
        pendingByWorkflowId.has(id) &&
        !createdWorkflowIds.has(id)
      ) {
        createdWorkflowIds.add(id);
      }
    }
  } catch {
    createdWorkflowIds = new Set();
  }
  for (const [workflowId, { messages }] of actionable) {
    const accepted =
      createdWorkflowIds.has(workflowId) ||
      (await repairExistingWorkflow(workflowId, env));
    for (const queued of messages) {
      if (accepted) {
        queued.ack();
      } else {
        queued.retry();
      }
    }
  }
}
