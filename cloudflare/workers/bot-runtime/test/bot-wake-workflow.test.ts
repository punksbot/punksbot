import type {
  BotWakeQueueBody,
  CompleteBotWakeCommand,
} from "@punks/contracts";
import {
  deriveBotActionAdmissionId,
  deriveBotActionDigest,
  deriveBotWakeActionId,
  deriveBotWakeId,
  deriveBotWakeTurnId,
  deriveBotWakeWorkflowId,
} from "@punks/core";
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

interface HarnessAudit {
  claims: unknown[];
  reads: unknown[];
  completions: CompleteBotWakeCommand[];
}

interface HarnessAuditService {
  configure(wakeId: string, scenario: string): Promise<void>;
  getAudit(wakeId: string): Promise<HarnessAudit>;
}

const installationId = "20000000-0000-8000-8000-000000000002";

async function exactQueueBody(
  targetInstallationId = installationId,
): Promise<BotWakeQueueBody> {
  return {
    installationId: targetInstallationId,
    wakeId: await deriveBotWakeId({
      installationId: targetInstallationId,
      subscriptionEpoch: 7,
      messageId: "60000000-0000-8000-8000-000000000006",
      messageCursor: 42,
    }),
  };
}

async function waitForCompletion(workflowId: string) {
  const instance = await env.BOT_WAKE_WORKFLOW.get(workflowId);
  let status = await instance.status();
  await vi.waitFor(
    async () => {
      status = await instance.status();
      expect(status.status).toBe("complete");
    },
    { timeout: 5_000, interval: 20 },
  );
  return status;
}

async function waitForErrored(workflowId: string) {
  const instance = await env.BOT_WAKE_WORKFLOW.get(workflowId);
  let status = await instance.status();
  await vi.waitFor(
    async () => {
      status = await instance.status();
      expect(status.status).toBe("errored");
    },
    { timeout: 12_000, interval: 20 },
  );
  return status;
}

describe("Bot Wake Workflow", () => {
  it("claims, reads and decides in one sensitive step, then completes without persisting plaintext", async () => {
    const body = await exactQueueBody();
    const workflowId = await deriveBotWakeWorkflowId(body.wakeId);

    await env.BOT_WAKE_WORKFLOW.createBatch([{ id: workflowId, params: body }]);
    const status = await waitForCompletion(workflowId);

    const auditService = Reflect.get(
      env,
      "BOT_HARNESS_TEST_AUDIT",
    ) as HarnessAuditService;
    const audit = await auditService.getAudit(body.wakeId);
    const actionId = await deriveBotWakeActionId(body.wakeId);
    const action = {
      contract: "message.reaction-toggle@1" as const,
      conversationId: "50000000-0000-8000-8000-000000000005",
      messageId: "60000000-0000-8000-8000-000000000006",
      payload: { reaction: "🎉" },
    };
    const actionDigest = await deriveBotActionDigest({
      contract: "bot-action.admit@1",
      commandId: actionId,
      actionId,
      workspaceId: "10000000-0000-8000-8000-000000000001",
      installationId,
      actor: { kind: "bot", installationId },
      action,
    });
    expect(audit.claims).toEqual([
      {
        contract: "bot-wake.claim@1",
        installationId,
        wakeId: body.wakeId,
      },
    ]);
    expect(audit.reads).toEqual([
      {
        installationId,
        wakeId: body.wakeId,
        turnId: await deriveBotWakeTurnId(body.wakeId),
      },
    ]);
    expect(audit.completions).toEqual([
      {
        contract: "bot-wake.complete@1",
        installationId,
        wakeId: body.wakeId,
        turnId: await deriveBotWakeTurnId(body.wakeId),
        terminal: {
          outcome: "succeeded",
          decision: "react",
          actionId,
          admissionId: await deriveBotActionAdmissionId(
            installationId,
            actionId,
          ),
          actionDigest,
        },
      },
    ]);
    expect(status.output).toEqual({ status: "terminal" });
    expect(JSON.stringify({ status, audit })).not.toContain(
      "SENSITIVE_WORKFLOW_SENTINEL",
    );
  });

  it("uses createBatch idempotence for a duplicate deterministic Workflow ID", async () => {
    const body = await exactQueueBody();
    const workflowId = await deriveBotWakeWorkflowId(body.wakeId);

    await waitForCompletion(workflowId);
    await env.BOT_WAKE_WORKFLOW.createBatch([{ id: workflowId, params: body }]);

    const auditService = Reflect.get(
      env,
      "BOT_HARNESS_TEST_AUDIT",
    ) as HarnessAuditService;
    await vi.waitFor(async () => {
      const audit = await auditService.getAudit(body.wakeId);
      expect(audit.claims).toHaveLength(1);
      expect(audit.reads).toHaveLength(1);
      expect(audit.completions).toHaveLength(1);
    });
  });

  it("makes one private-read attempt and terminalizes a transient failure without an inference retry", async () => {
    const transientInstallationId = "20000000-0000-8000-8000-00000000000c";
    const body = await exactQueueBody(transientInstallationId);
    const workflowId = await deriveBotWakeWorkflowId(body.wakeId);
    const auditService = Reflect.get(
      env,
      "BOT_HARNESS_TEST_AUDIT",
    ) as HarnessAuditService;
    await auditService.configure(body.wakeId, "temporarily-unavailable");

    await env.BOT_WAKE_WORKFLOW.createBatch([{ id: workflowId, params: body }]);
    const status = await waitForCompletion(workflowId);
    const audit = await auditService.getAudit(body.wakeId);

    expect(audit.reads).toHaveLength(1);
    expect(audit.completions).toEqual([
      {
        contract: "bot-wake.complete@1",
        installationId: transientInstallationId,
        wakeId: body.wakeId,
        turnId: await deriveBotWakeTurnId(body.wakeId),
        terminal: { outcome: "failed", code: "internal" },
      },
    ]);
    expect(JSON.stringify({ status, audit })).not.toContain(
      "SENSITIVE_WORKFLOW_SENTINEL",
    );
  });

  it("bounds transient claim retries before the Workflow fails closed", async () => {
    const transientInstallationId = "20000000-0000-8000-8000-00000000000e";
    const body = await exactQueueBody(transientInstallationId);
    const workflowId = await deriveBotWakeWorkflowId(body.wakeId);
    const auditService = Reflect.get(
      env,
      "BOT_HARNESS_TEST_AUDIT",
    ) as HarnessAuditService;
    await auditService.configure(body.wakeId, "claim-temporarily-unavailable");

    await env.BOT_WAKE_WORKFLOW.createBatch([{ id: workflowId, params: body }]);
    const status = await waitForErrored(workflowId);
    const audit = await auditService.getAudit(body.wakeId);

    expect(audit.claims).toHaveLength(4);
    expect(audit.reads).toEqual([]);
    expect(audit.completions).toEqual([]);
    expect(JSON.stringify({ status, audit })).not.toContain(
      "SENSITIVE_WORKFLOW_SENTINEL",
    );
  }, 15_000);

  it("rejects a terminal replay that is not bound to the exact Installation and Wake", async () => {
    const targetInstallationId = "20000000-0000-8000-8000-00000000000f";
    const body = await exactQueueBody(targetInstallationId);
    const workflowId = await deriveBotWakeWorkflowId(body.wakeId);
    const auditService = Reflect.get(
      env,
      "BOT_HARNESS_TEST_AUDIT",
    ) as HarnessAuditService;
    await auditService.configure(body.wakeId, "mismatched-terminal");

    await env.BOT_WAKE_WORKFLOW.createBatch([{ id: workflowId, params: body }]);
    const status = await waitForCompletion(workflowId);
    const audit = await auditService.getAudit(body.wakeId);

    expect(status.output).toEqual({ status: "rejected" });
    expect(audit.claims).toHaveLength(1);
    expect(audit.reads).toEqual([]);
    expect(audit.completions).toEqual([]);
  });
});
