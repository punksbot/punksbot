import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "10000000-0000-8000-8000-000000000002";
const botId = "10000000-0000-8000-8000-000000000003";
const invocationId = "10000000-0000-8000-8000-000000000004";
const actionId = "10000000-0000-8000-8000-000000000005";
const conversationId = "10000000-0000-8000-8000-000000000006";
const messageId = "10000000-0000-8000-8000-000000000007";

const credential = `pbi1.test.${"a".repeat(8)}.${"b".repeat(43)}`;

function command(overrides: Record<string, unknown> = {}) {
  return {
    contract: "bot-action.execute@1",
    credential,
    invocationId,
    actionId,
    workspaceId,
    installationId,
    botId,
    authorityGeneration: 1,
    action: {
      contract: "message.reaction-toggle@1",
      conversationId,
      messageId,
      payload: { reaction: "🔥" },
    },
    ...overrides,
  };
}

type ActionBinding = {
  executeBotAction(input: unknown): Promise<unknown>;
};

async function invoke(
  binding:
    | "BOT_ACTION_SERVICE"
    | "BOT_ACTION_WRONG_ENV"
    | "BOT_ACTION_NO_PROPS",
  input: unknown,
): Promise<unknown> {
  return (
    (env as unknown as Record<string, unknown>)[binding] as ActionBinding
  ).executeBotAction(input);
}

describe("BotActionService private invocation boundary", () => {
  it("fails closed without exact static service-binding props", async () => {
    const noProps = await invoke("BOT_ACTION_NO_PROPS", command());
    const wrongEnvironment = await invoke("BOT_ACTION_WRONG_ENV", command());

    expect(noProps).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(wrongEnvironment).toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("rejects malformed action contracts before credential verification", async () => {
    const response = await invoke("BOT_ACTION_SERVICE", {
      ...command(),
      capability: "messages.react",
    });
    expect(response).toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it("fails closed on malformed verifier truthiness and mismatched claims", async () => {
    for (const kid of ["malformed-verifier", "mismatched-bot"]) {
      const response = await invoke("BOT_ACTION_SERVICE", {
        ...command(),
        credential: `pbi1.${kid}.${"a".repeat(8)}.${"b".repeat(43)}`,
      });
      expect(response).toEqual({ ok: false, code: "invalid_credential" });
    }
  });

  it("keeps Bot action HTTP endpoints private", async () => {
    const response = await SELF.fetch("https://punks.bot/api/v1/bot-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command()),
    });
    expect([403, 404]).toContain(response.status);
  });
});
