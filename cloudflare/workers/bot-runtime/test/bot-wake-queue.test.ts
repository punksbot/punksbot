import { deriveBotWakeWorkflowId } from "@punks/core";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src";
import type { BotRuntimeEnv } from "../src/env";

const installationId = "20000000-0000-8000-8000-000000000002";
const wakeId = "70000000-0000-8000-8000-000000000007";

type CreateBatch = BotRuntimeEnv["BOT_WAKE_WORKFLOW"]["createBatch"];
type GetWorkflow = (id: string) => Promise<{
  status(): Promise<unknown>;
  restart(): Promise<void>;
}>;

function createdInstances(
  batch: Parameters<CreateBatch>[0],
): WorkflowInstance[] {
  return batch.map(({ id }) => ({ id }) as WorkflowInstance);
}

function testEnvironment(
  createBatch: CreateBatch,
  get?: GetWorkflow,
): BotRuntimeEnv {
  return new Proxy(env as BotRuntimeEnv, {
    get(target, property, receiver) {
      return property === "BOT_WAKE_WORKFLOW"
        ? {
            createBatch,
            get:
              get ??
              (async (_id: string) => {
                throw new Error("no existing Workflow in this test seam");
              }),
          }
        : Reflect.get(target, property, receiver);
    },
  });
}

async function consume(
  bodies: unknown[],
  createBatch: CreateBatch,
  get?: GetWorkflow,
) {
  const batch = createMessageBatch(
    "punks-bot-wake-local",
    bodies.map((body, index) => ({
      id: `wake-${index}`,
      timestamp: new Date("2026-08-21T00:00:00.000Z"),
      body,
      attempts: 1,
    })),
  );
  const context = createExecutionContext();
  await worker.queue?.(batch, testEnvironment(createBatch, get), context);
  return getQueueResult(batch, context);
}

describe("Bot Wake Queue consumer", () => {
  it("creates one deterministic Workflow for an exact opaque Queue body", async () => {
    const createBatch = vi.fn<CreateBatch>(async (batch) =>
      createdInstances(batch),
    );

    const result = await consume([{ installationId, wakeId }], createBatch);

    expect(createBatch).toHaveBeenCalledExactlyOnceWith([
      {
        id: await deriveBotWakeWorkflowId(wakeId),
        params: { installationId, wakeId },
      },
    ]);
    expect(result.explicitAcks).toEqual(["wake-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("drops malformed poison messages without widening Workflow parameters", async () => {
    const createBatch = vi.fn<CreateBatch>(async (_batch) => []);

    const result = await consume(
      [
        { installationId, wakeId, plaintext: "never persist me" },
        { installationId },
        "not-an-object",
      ],
      createBatch,
    );

    expect(createBatch).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual(["wake-0", "wake-1", "wake-2"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("deduplicates one delivery batch and retries only transient creation failure", async () => {
    const successfulCreate = vi.fn<CreateBatch>(async (batch) =>
      createdInstances(batch),
    );
    const duplicateResult = await consume(
      [
        { installationId, wakeId },
        { installationId, wakeId },
      ],
      successfulCreate,
    );

    expect(successfulCreate).toHaveBeenCalledTimes(1);
    expect(successfulCreate.mock.calls[0]?.[0]).toHaveLength(1);
    expect(duplicateResult.explicitAcks).toEqual(["wake-0", "wake-1"]);
    expect(duplicateResult.retryMessages).toEqual([]);

    const unavailableCreate = vi.fn<CreateBatch>(async (_batch) => {
      throw new Error("opaque workflow binding failure");
    });
    const retryResult = await consume(
      [{ installationId, wakeId }],
      unavailableCreate,
    );

    expect(retryResult.explicitAcks).toEqual([]);
    expect(retryResult.retryMessages).toEqual([{ msgId: "wake-0" }]);
  });

  it("does not collapse conflicting Installation coordinates onto one Workflow ID", async () => {
    const createBatch = vi.fn<CreateBatch>(async (_batch) => []);

    const result = await consume(
      [
        { installationId, wakeId },
        {
          installationId: "20000000-0000-8000-8000-00000000000d",
          wakeId,
        },
      ],
      createBatch,
    );

    expect(createBatch).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([
      { msgId: "wake-0" },
      { msgId: "wake-1" },
    ]);
  });

  it("repairs an existing errored deterministic Workflow before acknowledging the opaque redelivery", async () => {
    const createBatch = vi.fn<CreateBatch>(async (_batch) => []);
    const restart = vi.fn(async () => undefined);
    const get = vi.fn<GetWorkflow>(async (_id) => ({
      status: async () => ({ status: "errored" }),
      restart,
    }));

    const result = await consume(
      [{ installationId, wakeId }],
      createBatch,
      get,
    );

    expect(get).toHaveBeenCalledExactlyOnceWith(
      await deriveBotWakeWorkflowId(wakeId),
    );
    expect(restart).toHaveBeenCalledTimes(1);
    expect(result.explicitAcks).toEqual(["wake-0"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("acknowledges compatible existing Workflow states and retries every fail-closed state", async () => {
    const createBatch = vi.fn<CreateBatch>(async (_batch) => []);
    const states = new Map<string, unknown>([
      [wakeId, { status: "running" }],
      ["70000000-0000-8000-8000-000000000008", { status: "complete" }],
      ["70000000-0000-8000-8000-000000000009", { status: "paused" }],
      ["70000000-0000-8000-8000-00000000000a", { status: "terminated" }],
      ["70000000-0000-8000-8000-00000000000b", { status: "unknown" }],
      ["70000000-0000-8000-8000-00000000000c", { state: "running" }],
    ]);
    const workflowIdToWakeId = new Map<string, string>();
    for (const candidateWakeId of states.keys()) {
      workflowIdToWakeId.set(
        await deriveBotWakeWorkflowId(candidateWakeId),
        candidateWakeId,
      );
    }
    const get = vi.fn<GetWorkflow>(async (workflowId) => ({
      status: async () => states.get(workflowIdToWakeId.get(workflowId) ?? ""),
      restart: async () => undefined,
    }));

    const result = await consume(
      [...states.keys()].map((candidateWakeId) => ({
        installationId,
        wakeId: candidateWakeId,
      })),
      createBatch,
      get,
    );

    expect(result.explicitAcks).toEqual(["wake-0", "wake-1"]);
    expect(result.retryMessages).toEqual([
      { msgId: "wake-2" },
      { msgId: "wake-3" },
      { msgId: "wake-4" },
      { msgId: "wake-5" },
    ]);
  });

  it("retries when existing Workflow inspection or restart cannot be proven", async () => {
    const createBatch = vi.fn<CreateBatch>(async (_batch) => []);
    const getFailure = vi.fn<GetWorkflow>(async (_id) => {
      throw new Error("workflow lookup unavailable");
    });
    const lookupResult = await consume(
      [{ installationId, wakeId }],
      createBatch,
      getFailure,
    );
    expect(lookupResult.explicitAcks).toEqual([]);
    expect(lookupResult.retryMessages).toEqual([{ msgId: "wake-0" }]);

    const restartFailure = vi.fn<GetWorkflow>(async (_id) => ({
      status: async () => ({ status: "errored" }),
      restart: async () => {
        throw new Error("restart unavailable");
      },
    }));
    const restartResult = await consume(
      [{ installationId, wakeId }],
      createBatch,
      restartFailure,
    );
    expect(restartResult.explicitAcks).toEqual([]);
    expect(restartResult.retryMessages).toEqual([{ msgId: "wake-0" }]);
  });
});
