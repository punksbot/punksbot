import type {
  ContractId,
  ExecuteBotActionCommand,
  ExecuteBotActionResult,
  InvokeBotRuntimeReactionCommand,
  InvokeBotRuntimeReactionResult,
  MintBotInvocationCredentialCommand,
  MintBotInvocationCredentialResult,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { BotRuntimeEnv } from "./env";
import { consumeBotWakeQueue } from "./bot-wake-queue";

export { BotWakeWorkflow } from "./bot-wake-workflow";

function isValidContract(contractId: ContractId, input: unknown): boolean {
  try {
    return validateContract(contractId, input).valid;
  } catch {
    return false;
  }
}

function privateNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function failure(
  code: Extract<InvokeBotRuntimeReactionResult, { ok: false }>["code"],
): InvokeBotRuntimeReactionResult {
  return {
    contract: "bot-runtime.reaction-result@1",
    ok: false,
    code,
  };
}

function mintedPrincipalMatches(
  result: MintBotInvocationCredentialResult,
  command: MintBotInvocationCredentialCommand,
  environment: BotRuntimeEnv["ENVIRONMENT"],
): result is Extract<MintBotInvocationCredentialResult, { ok: true }> {
  return (
    result.ok &&
    result.principal.environment === environment &&
    result.principal.invocationId === command.invocationId &&
    result.principal.workspaceId === command.workspaceId &&
    result.principal.installationId === command.installationId &&
    result.principal.botId === command.botId &&
    result.principal.authorityGeneration === command.authorityGeneration
  );
}

function actionFailureCode(
  result: Extract<ExecuteBotActionResult, { ok: false }>,
): Extract<InvokeBotRuntimeReactionResult, { ok: false }>["code"] {
  switch (result.code) {
    case "invalid_credential":
      return "credential_unavailable";
    case "admission_limit":
    case "attestation_failed":
    case "command_in_progress":
    case "internal":
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    default:
      return "action_rejected";
  }
}

/** Private, bounded entrypoint for Punks-operated Bot reaction invocations. */
export class BotRuntimeService extends WorkerEntrypoint<BotRuntimeEnv> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  async invokeReaction(
    input: unknown,
  ): Promise<InvokeBotRuntimeReactionResult> {
    if (
      !isValidContract("punks://contracts/bot-runtime.reaction-invoke@1", input)
    ) {
      return failure("invalid_request");
    }
    const command = input as InvokeBotRuntimeReactionCommand;
    const invocationId = await deriveOpaqueUuid(
      "punks.bot-runtime-invocation.v1",
      crypto.randomUUID(),
    );
    const mintCommand: MintBotInvocationCredentialCommand = {
      contract: "bot-invocation.mint@1",
      invocationId,
      workspaceId: command.workspaceId,
      installationId: command.installationId,
      botId: command.botId,
      authorityGeneration: command.authorityGeneration,
    };

    let minted: MintBotInvocationCredentialResult;
    try {
      minted =
        await this.env.BOT_INVOCATION_ISSUER.mintBotInvocation(mintCommand);
    } catch {
      return failure("credential_unavailable");
    }
    if (
      !isValidContract(
        "punks://contracts/bot-invocation.mint-result@1",
        minted,
      ) ||
      !mintedPrincipalMatches(minted, mintCommand, this.env.ENVIRONMENT)
    ) {
      return failure("credential_unavailable");
    }

    const executeCommand: ExecuteBotActionCommand = {
      contract: "bot-action.execute@1",
      credential: minted.credential,
      invocationId,
      actionId: command.actionId,
      workspaceId: command.workspaceId,
      installationId: command.installationId,
      botId: command.botId,
      authorityGeneration: command.authorityGeneration,
      action: command.action,
    };
    if (
      !isValidContract("punks://contracts/bot-action.execute@1", executeCommand)
    ) {
      return failure("invalid_request");
    }

    let executed: ExecuteBotActionResult;
    try {
      executed =
        await this.env.BOT_ACTION_SERVICE.executeBotAction(executeCommand);
    } catch {
      return failure("temporarily_unavailable");
    }
    if (
      !isValidContract(
        "punks://contracts/bot-action.execute-result@1",
        executed,
      )
    ) {
      return failure("temporarily_unavailable");
    }
    if (!executed.ok) {
      return failure(actionFailureCode(executed));
    }
    const result: InvokeBotRuntimeReactionResult = {
      contract: "bot-runtime.reaction-result@1",
      ok: true,
      invocationId,
      actionId: command.actionId,
      admissionId: executed.admissionId,
      replayed: executed.replayed,
    };
    return isValidContract(
      "punks://contracts/bot-runtime.reaction-result@1",
      result,
    )
      ? result
      : failure("temporarily_unavailable");
  }
}

export default {
  fetch(_request: Request): Response {
    return privateNotFound();
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: BotRuntimeEnv,
    _context: ExecutionContext,
  ): Promise<void> {
    await consumeBotWakeQueue(batch, env);
  },
} satisfies ExportedHandler<BotRuntimeEnv>;
