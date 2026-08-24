import type {
  ClaimBotWakeCommand,
  ClaimBotWakeResult,
  CompleteBotWakeCommand,
  ExecuteBotActionCommand,
  ExecuteBotActionResult,
  MintBotInvocationCredentialCommand,
  MintBotInvocationCredentialResult,
} from "@punks/contracts";

export type ReadWakeContextResult =
  | { ok: true; content: string }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "forbidden"
        | "not_found"
        | "authority_revoked"
        | "content_unavailable"
        | "temporarily_unavailable"
        | "internal";
    };

export interface BotInvocationIssuerRpc {
  mintBotInvocation(
    input: MintBotInvocationCredentialCommand,
  ): Promise<MintBotInvocationCredentialResult>;
}

export interface BotActionServiceRpc {
  executeBotAction(
    input: ExecuteBotActionCommand,
  ): Promise<ExecuteBotActionResult>;
}

export interface BotHarnessServiceRpc {
  claimWake(input: ClaimBotWakeCommand): Promise<ClaimBotWakeResult>;
  readWakeContext(input: {
    installationId: string;
    wakeId: string;
    turnId: string;
  }): Promise<ReadWakeContextResult>;
  completeWake(input: CompleteBotWakeCommand): Promise<ClaimBotWakeResult>;
}

export type BotRuntimeEnv = Omit<CloudflareBindings, "AI"> & {
  AI?: Ai;
  BOT_INVOCATION_ISSUER: BotInvocationIssuerRpc;
  BOT_ACTION_SERVICE: BotActionServiceRpc;
  BOT_HARNESS_SERVICE: BotHarnessServiceRpc;
};
