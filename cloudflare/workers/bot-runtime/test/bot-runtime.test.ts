import type { InvokeBotRuntimeReactionResult } from "@punks/contracts";
import { env, SELF } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { BotRuntimeService } from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "a0000000-0000-8000-8000-000000000003";
const actionId = "30000000-0000-8000-8000-000000000004";
const conversationId = "50000000-0000-8000-8000-000000000005";
const messageId = "60000000-0000-8000-8000-000000000006";

const invokeCommand = {
  contract: "bot-runtime.reaction-invoke@1",
  workspaceId,
  installationId,
  botId,
  actionId,
  authorityGeneration: 7,
  action: {
    contract: "message.reaction-toggle@1",
    conversationId,
    messageId,
    payload: { reaction: "+" },
  },
} as const;

type BotRuntimeRpc = {
  invokeReaction(input: unknown): Promise<InvokeBotRuntimeReactionResult>;
  fetch(request: Request): Promise<Response>;
};

const runtime = workerExports.BotRuntimeService as unknown as BotRuntimeRpc;

describe("private Punks Bot Runtime", () => {
  it("keeps Workers AI remote access out of the local test runtime", () => {
    expect(Reflect.has(env, "AI")).toBe(false);
  });

  it("keeps actionId stable while minting a fresh invocation for a response-loss retry", async () => {
    const first = await runtime.invokeReaction(invokeCommand);
    const retry = await runtime.invokeReaction(invokeCommand);

    expect(first).toMatchObject({
      contract: "bot-runtime.reaction-result@1",
      ok: true,
      actionId,
      replayed: false,
    });
    expect(retry).toMatchObject({
      contract: "bot-runtime.reaction-result@1",
      ok: true,
      actionId,
      replayed: true,
    });
    if (!(first.ok && retry.ok)) {
      throw new Error("retry fixture unexpectedly failed");
    }
    expect(retry.admissionId).toBe(first.admissionId);
    expect(retry.invocationId).not.toBe(first.invocationId);
  });

  it("rejects malformed or widened requests before invoking a capability", async () => {
    for (const malformed of [
      {},
      { ...invokeCommand, actionId: undefined },
      { ...invokeCommand, actionId: crypto.randomUUID() },
      { ...invokeCommand, capability: "messages.react" },
      {
        ...invokeCommand,
        action: { ...invokeCommand.action, command: "arbitrary" },
      },
      {
        ...invokeCommand,
        action: {
          contract: "message.reaction-toggle@1",
          conversationId,
          messageId,
          payload: { reaction: "+", plaintext: "secret" },
        },
      },
    ]) {
      await expect(runtime.invokeReaction(malformed)).resolves.toEqual({
        contract: "bot-runtime.reaction-result@1",
        ok: false,
        code: "invalid_request",
      });
    }
  });

  it("maps unavailable credentials and action-authority failures fail closed", async () => {
    await expect(
      runtime.invokeReaction({
        ...invokeCommand,
        actionId: "30000000-0000-8000-8000-000000000007",
        botId: "a0000000-0000-8000-8000-00000000000f",
      }),
    ).resolves.toEqual({
      contract: "bot-runtime.reaction-result@1",
      ok: false,
      code: "credential_unavailable",
    });
    await expect(
      runtime.invokeReaction({
        ...invokeCommand,
        actionId: "30000000-0000-8000-8000-000000000008",
        action: {
          ...invokeCommand.action,
          payload: { reaction: "forbidden" },
        },
      }),
    ).resolves.toEqual({
      contract: "bot-runtime.reaction-result@1",
      ok: false,
      code: "action_rejected",
    });
    await expect(
      runtime.invokeReaction({
        ...invokeCommand,
        actionId: "30000000-0000-8000-8000-000000000009",
        action: {
          ...invokeCommand.action,
          payload: { reaction: "temporary" },
        },
      }),
    ).resolves.toEqual({
      contract: "bot-runtime.reaction-result@1",
      ok: false,
      code: "temporarily_unavailable",
    });
  });

  it("exposes one bounded RPC method and returns 404 over HTTP", async () => {
    expect(
      Object.getOwnPropertyNames(BotRuntimeService.prototype).sort(),
    ).toEqual(["constructor", "fetch", "invokeReaction"].sort());
    const responses = await Promise.all([
      SELF.fetch("https://runtime.punks.test/private"),
      runtime.fetch(new Request("https://runtime.punks.test/private")),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([404, 404]);
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("does not log invocation credentials or action input", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      await expect(
        runtime.invokeReaction({
          ...invokeCommand,
          actionId: "30000000-0000-8000-8000-00000000000a",
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
