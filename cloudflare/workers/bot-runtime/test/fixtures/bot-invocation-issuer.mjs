import { WorkerEntrypoint } from "cloudflare:workers";

const unavailableBotId = "a0000000-0000-8000-8000-00000000000f";

export class BotInvocationIssuer extends WorkerEntrypoint {
  async mintBotInvocation(input) {
    if (input.botId === unavailableBotId) {
      return { ok: false, code: "configuration_invalid" };
    }
    const now = Math.floor(Date.now() / 1_000);
    return {
      ok: true,
      credential: `pbi1.test-v1.${input.invocationId}.${"A".repeat(43)}`,
      principal: {
        schemaVersion: 1,
        environment: "local",
        audience: "punks-bot-action",
        kid: "test-v1",
        jti: input.invocationId,
        invocationId: input.invocationId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        botId: input.botId,
        authorityGeneration: input.authorityGeneration,
        issuedAt: now,
        notBefore: now,
        expiresAt: now + 30,
      },
    };
  }
}
