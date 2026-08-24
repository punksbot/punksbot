import type {
  BotWakeOffer,
  BotWakeQueueBody,
  ClaimBotWakeCommand,
  ClaimBotWakeResult,
  CompleteBotWakeCommand,
  InvokeBotRuntimeReactionCommand,
  InvokeBotRuntimeReactionResult,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  deriveBotActionDigest,
  deriveBotWakeActionId,
  validateBotWakeOffer,
  validateBotWakeTerminalReceipt,
} from "@punks/core";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import type { BotRuntimeEnv, ReadWakeContextResult } from "./env";
import { reactionTurnModelForEnvironment } from "./model-port";

type WakeTerminal = CompleteBotWakeCommand["terminal"];

type BoundedWakeDecision =
  | { decision: "skip" }
  | { decision: "react"; reaction: string }
  | {
      decision: "failed";
      code: Extract<WakeTerminal, { outcome: "failed" }>["code"];
    };

const RPC_STEP = {
  retries: { limit: 3, delay: "1 second", backoff: "exponential" },
  timeout: "30 seconds",
} as const;

const SENSITIVE_DECISION_STEP = {
  retries: { limit: 0, delay: "1 second", backoff: "constant" },
  timeout: "30 seconds",
  sensitive: "output",
} as const;

function workflowParams(value: unknown): BotWakeQueueBody | null {
  try {
    return validateContract("punks://contracts/bot-wake.queue@1", value).valid
      ? (value as BotWakeQueueBody)
      : null;
  } catch {
    return null;
  }
}

function validClaimResult(value: unknown): value is ClaimBotWakeResult {
  try {
    return validateContract("punks://contracts/bot-wake.claim-result@1", value)
      .valid;
  } catch {
    return false;
  }
}

async function exactClaimedOffer(
  result: ClaimBotWakeResult,
  params: BotWakeQueueBody,
): Promise<BotWakeOffer | null> {
  if (
    !result.ok ||
    result.status !== "claimed" ||
    result.offer.installationId !== params.installationId ||
    result.offer.wakeId !== params.wakeId ||
    !(await validateBotWakeOffer(result.offer))
  ) {
    return null;
  }
  return result.offer;
}

async function isExactTerminalClaim(
  result: ClaimBotWakeResult,
  params: BotWakeQueueBody,
): Promise<boolean> {
  return (
    result.ok &&
    result.status === "terminal" &&
    result.receipt.offer.installationId === params.installationId &&
    result.receipt.offer.wakeId === params.wakeId &&
    (await validateBotWakeTerminalReceipt(result.receipt))
  );
}

function exactReadResult(value: unknown): value is ReadWakeContextResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.ok === true) {
    return (
      Object.keys(result).sort().join(",") === "content,ok" &&
      typeof result.content === "string" &&
      new TextEncoder().encode(result.content).byteLength <= 8_192
    );
  }
  return (
    result.ok === false &&
    Object.keys(result).sort().join(",") === "code,ok" &&
    [
      "invalid_request",
      "forbidden",
      "not_found",
      "authority_revoked",
      "content_unavailable",
      "temporarily_unavailable",
      "internal",
    ].includes(String(result.code))
  );
}

function validReactionResult(
  value: unknown,
): value is InvokeBotRuntimeReactionResult {
  try {
    return validateContract(
      "punks://contracts/bot-runtime.reaction-result@1",
      value,
    ).valid;
  } catch {
    return false;
  }
}

async function executeReaction(
  runtime: Pick<
    InstanceType<typeof import("./index").BotRuntimeService>,
    "invokeReaction"
  >,
  offer: BotWakeOffer,
  reaction: string,
): Promise<WakeTerminal> {
  const actionId = await deriveBotWakeActionId(offer.wakeId);
  const action = {
    contract: "message.reaction-toggle@1" as const,
    conversationId: offer.conversationId,
    messageId: offer.messageId,
    payload: { reaction },
  };
  const command: InvokeBotRuntimeReactionCommand = {
    contract: "bot-runtime.reaction-invoke@1",
    workspaceId: offer.workspaceId,
    installationId: offer.installationId,
    botId: offer.botId,
    actionId,
    authorityGeneration: offer.subscriptionEpoch,
    action,
  };
  let result: unknown;
  try {
    result = await runtime.invokeReaction(command);
  } catch {
    throw new Error("wake_action_temporarily_unavailable");
  }
  if (!validReactionResult(result)) {
    throw new Error("wake_action_result_unavailable");
  }
  if (!result.ok) {
    if (
      result.code === "credential_unavailable" ||
      result.code === "temporarily_unavailable"
    ) {
      throw new Error("wake_action_temporarily_unavailable");
    }
    return { outcome: "failed", code: "action_failed" };
  }
  const actionDigest = await deriveBotActionDigest({
    contract: "bot-action.admit@1",
    commandId: actionId,
    actionId,
    workspaceId: offer.workspaceId,
    installationId: offer.installationId,
    actor: { kind: "bot", installationId: offer.installationId },
    action,
  });
  return {
    outcome: "succeeded",
    decision: "react",
    actionId,
    admissionId: result.admissionId,
    actionDigest,
  };
}

function deterministicReadFailure(
  code: Extract<ReadWakeContextResult, { ok: false }>["code"],
): Extract<BoundedWakeDecision, { decision: "failed" }> {
  switch (code) {
    case "authority_revoked":
    case "forbidden":
      return { decision: "failed", code: "revoked" };
    case "not_found":
      return { decision: "failed", code: "not_found" };
    case "content_unavailable":
      return { decision: "failed", code: "content_unavailable" };
    case "invalid_request":
    case "internal":
    case "temporarily_unavailable":
      return { decision: "failed", code: "internal" };
  }
}

async function decideWithoutPersistingContent(
  env: BotRuntimeEnv,
  params: BotWakeQueueBody,
  turnId: string,
): Promise<BoundedWakeDecision> {
  let context: ReadWakeContextResult;
  try {
    const untrusted = await env.BOT_HARNESS_SERVICE.readWakeContext({
      installationId: params.installationId,
      wakeId: params.wakeId,
      turnId,
    });
    if (!exactReadResult(untrusted)) {
      return { decision: "failed", code: "internal" };
    }
    context = untrusted;
  } catch {
    return { decision: "failed", code: "internal" };
  }
  if (!context.ok) {
    return deterministicReadFailure(context.code);
  }

  const modelResult = await reactionTurnModelForEnvironment(
    env.ENVIRONMENT,
    env.AI,
  ).decideReaction({
    content: context.content,
  });
  if (!modelResult.ok) {
    switch (modelResult.code) {
      case "content_limit_exceeded":
        return { decision: "failed", code: "content_unavailable" };
      case "invalid_model_response":
        return { decision: "failed", code: "model_invalid" };
      case "model_timeout":
        return { decision: "failed", code: "model_timeout" };
      case "model_unavailable":
        return { decision: "failed", code: "internal" };
    }
  }
  return modelResult.decision.decision === "skip"
    ? { decision: "skip" }
    : { decision: "react", reaction: modelResult.decision.reaction };
}

async function exactTerminalCompletion(
  result: ClaimBotWakeResult,
  command: CompleteBotWakeCommand,
): Promise<boolean> {
  return (
    result.ok &&
    result.status === "terminal" &&
    result.receipt.offer.installationId === command.installationId &&
    result.receipt.offer.wakeId === command.wakeId &&
    result.receipt.turnId === command.turnId &&
    canonicalJson(result.receipt.terminal) ===
      canonicalJson(command.terminal) &&
    (await validateBotWakeTerminalReceipt(result.receipt))
  );
}

/** Durable, content-minimizing execution of one authoritative Bot Wake. */
export class BotWakeWorkflow extends WorkflowEntrypoint<
  BotRuntimeEnv,
  BotWakeQueueBody
> {
  override async run(
    event: Readonly<WorkflowEvent<BotWakeQueueBody>>,
    step: WorkflowStep,
  ): Promise<{ status: "rejected" | "terminal" }> {
    const params = workflowParams(event.payload);
    if (params === null) {
      return { status: "rejected" };
    }

    const claimCommand: ClaimBotWakeCommand = {
      contract: "bot-wake.claim@1",
      installationId: params.installationId,
      wakeId: params.wakeId,
    };
    const claim = await step.do("claim-wake", RPC_STEP, async () => {
      let result: unknown;
      try {
        result = await this.env.BOT_HARNESS_SERVICE.claimWake(claimCommand);
      } catch {
        throw new Error("wake_claim_temporarily_unavailable");
      }
      if (!validClaimResult(result)) {
        throw new Error("wake_claim_result_unavailable");
      }
      if (
        !result.ok &&
        (result.code === "conflict" ||
          result.code === "internal" ||
          result.code === "temporarily_unavailable")
      ) {
        throw new Error("wake_claim_temporarily_unavailable");
      }
      return result;
    });
    if (!claim.ok) {
      return { status: "rejected" };
    }
    if (claim.status === "terminal") {
      return {
        status: (await isExactTerminalClaim(claim, params))
          ? "terminal"
          : "rejected",
      };
    }
    const offer = await exactClaimedOffer(claim, params);
    if (offer === null) {
      return { status: "rejected" };
    }

    let decision: BoundedWakeDecision;
    try {
      decision = await step.do(
        "read-context-and-decide",
        SENSITIVE_DECISION_STEP,
        async () =>
          decideWithoutPersistingContent(this.env, params, claim.turnId),
      );
    } catch {
      decision = { decision: "failed", code: "internal" };
    }

    let terminal: WakeTerminal;
    if (decision.decision === "react") {
      try {
        terminal = await step.do("execute-reaction", RPC_STEP, async () =>
          executeReaction(
            this.ctx.exports.BotRuntimeService,
            offer,
            decision.reaction,
          ),
        );
      } catch {
        terminal = { outcome: "failed", code: "budget_exhausted" };
      }
    } else {
      terminal =
        decision.decision === "skip"
          ? {
              outcome: "succeeded",
              decision: "skip",
              reason: "model_selected_skip",
            }
          : { outcome: "failed", code: decision.code };
    }
    const completeCommand: CompleteBotWakeCommand = {
      contract: "bot-wake.complete@1",
      installationId: params.installationId,
      wakeId: params.wakeId,
      turnId: claim.turnId,
      terminal,
    };
    await step.do("complete-wake", RPC_STEP, async () => {
      let result: unknown;
      try {
        result =
          await this.env.BOT_HARNESS_SERVICE.completeWake(completeCommand);
      } catch {
        throw new Error("wake_completion_temporarily_unavailable");
      }
      if (
        !validClaimResult(result) ||
        !(await exactTerminalCompletion(result, completeCommand))
      ) {
        throw new Error("wake_completion_result_unavailable");
      }
      return { status: "terminal" as const };
    });
    return { status: "terminal" };
  }
}
