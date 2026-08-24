import {
  PUNKS_REACTION_TURN_RELEASE_V1,
  PUNKS_REACTION_TURN_SYSTEM_PROMPT_V1,
  parseReactionTurnDecision,
  type ReactionTurnDecision,
} from "@punks/core";

export type ReactionTurnModelResult =
  | { ok: true; decision: ReactionTurnDecision }
  | {
      ok: false;
      code:
        | "content_limit_exceeded"
        | "invalid_model_response"
        | "model_timeout"
        | "model_unavailable";
    };

export interface ModelPort {
  decideReaction(input: { content: string }): Promise<ReactionTurnModelResult>;
}

export type ReactionTurnInferenceRequest = {
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  response_format: {
    type: "json_schema";
    json_schema: {
      oneOf: Array<{
        type: "object";
        additionalProperties: false;
        properties: Record<string, unknown>;
        required: string[];
      }>;
    };
  };
  stream: false;
  max_tokens: number;
  temperature: number;
  top_p: number;
  top_k: number;
};

/** Narrow outbound seam implemented by the generated Workers AI binding. */
export interface WorkersAiRunner {
  run(
    model: typeof PUNKS_REACTION_TURN_RELEASE_V1.model,
    input: ReactionTurnInferenceRequest,
    options: { signal: AbortSignal },
  ): Promise<unknown>;
}

function contentFitsRelease(content: string): boolean {
  return (
    new TextEncoder().encode(content).byteLength <=
    PUNKS_REACTION_TURN_RELEASE_V1.maximumContentBytes
  );
}

function inferenceRequest(content: string): ReactionTurnInferenceRequest {
  return {
    messages: [
      {
        role: "system",
        content: PUNKS_REACTION_TURN_SYSTEM_PROMPT_V1,
      },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: { decision: { const: "skip" } },
            required: ["decision"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { const: "react" },
              reaction: {
                type: "string",
                enum: [...PUNKS_REACTION_TURN_RELEASE_V1.allowedReactions],
              },
            },
            required: ["decision", "reaction"],
          },
        ],
      },
    },
    stream: false,
    max_tokens: PUNKS_REACTION_TURN_RELEASE_V1.maximumOutputTokens,
    temperature: PUNKS_REACTION_TURN_RELEASE_V1.temperature,
    top_p: PUNKS_REACTION_TURN_RELEASE_V1.topP,
    top_k: PUNKS_REACTION_TURN_RELEASE_V1.topK,
  };
}

function modelResponseContent(response: unknown): string | null {
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    return null;
  }
  const responseRecord = response as Record<string, unknown>;
  if (responseRecord.tool_calls !== undefined) {
    return null;
  }
  if (responseRecord.response !== undefined) {
    const nativeResponse = responseRecord.response;
    if (
      responseRecord.choices !== undefined ||
      nativeResponse === null ||
      typeof nativeResponse !== "object" ||
      Array.isArray(nativeResponse)
    ) {
      return null;
    }
    try {
      return JSON.stringify(nativeResponse);
    } catch {
      return null;
    }
  }
  const choices = responseRecord.choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    return null;
  }
  const choice = choices[0];
  if (choice === null || typeof choice !== "object" || Array.isArray(choice)) {
    return null;
  }
  const message = (choice as Record<string, unknown>).message;
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.tool_calls !== undefined || typeof record.content !== "string") {
    return null;
  }
  return record.content;
}

/** Workers AI adapter for the single immutable Punks Reaction Turn release. */
export class WorkersAiReactionTurnModel implements ModelPort {
  constructor(private readonly ai: WorkersAiRunner) {}

  async decideReaction(input: {
    content: string;
  }): Promise<ReactionTurnModelResult> {
    if (!contentFitsRelease(input.content)) {
      return { ok: false, code: "content_limit_exceeded" };
    }

    const signal = AbortSignal.timeout(
      PUNKS_REACTION_TURN_RELEASE_V1.timeoutMs,
    );
    let response: unknown;
    try {
      response = await this.ai.run(
        PUNKS_REACTION_TURN_RELEASE_V1.model,
        inferenceRequest(input.content),
        { signal },
      );
    } catch {
      return signal.aborted
        ? { ok: false, code: "model_timeout" }
        : { ok: false, code: "model_unavailable" };
    }
    if (signal.aborted) {
      return { ok: false, code: "model_timeout" };
    }

    const content = modelResponseContent(response);
    const decision =
      content === null ? null : parseReactionTurnDecision(content);
    return decision === null
      ? { ok: false, code: "invalid_model_response" }
      : { ok: true, decision };
  }
}

/** Builds the adapter from the generated native Workers AI binding type. */
export function workersAiReactionTurnModel(ai: Ai): WorkersAiReactionTurnModel {
  return new WorkersAiReactionTurnModel(ai);
}

/** Deterministic Workerd-only fake; it never retains or returns Message text. */
export class DeterministicWorkerdReactionModel implements ModelPort {
  private readonly decision: ReactionTurnDecision;

  constructor(decision: ReactionTurnDecision = { decision: "skip" }) {
    const parsed = parseReactionTurnDecision(JSON.stringify(decision));
    if (parsed === null) {
      throw new Error("invalid deterministic Reaction Turn decision");
    }
    this.decision = parsed;
  }

  async decideReaction(input: {
    content: string;
  }): Promise<ReactionTurnModelResult> {
    if (!contentFitsRelease(input.content)) {
      return { ok: false, code: "content_limit_exceeded" };
    }
    return this.decision.decision === "skip"
      ? { ok: true, decision: { decision: "skip" } }
      : {
          ok: true,
          decision: {
            decision: "react",
            reaction: this.decision.reaction,
          },
        };
  }
}

/** Selects the only model implementation authorized for an environment. */
export function reactionTurnModelForEnvironment(
  environment: "local" | "staging" | "production",
  ai?: WorkersAiRunner,
): ModelPort {
  if (environment === "local") {
    return new DeterministicWorkerdReactionModel({
      decision: "react",
      reaction: "🎉",
    });
  }
  return ai === undefined
    ? {
        async decideReaction(): Promise<ReactionTurnModelResult> {
          return { ok: false, code: "model_unavailable" };
        },
      }
    : new WorkersAiReactionTurnModel(ai);
}
