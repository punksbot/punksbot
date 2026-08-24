import type { PunksProblem } from "@punks/contracts";

/** Stable failure taxonomy shared by the desktop client profiles. */
export type PunksFailureKind =
  | "problem"
  | "transport"
  | "contract_violation"
  | "cancelled"
  | "stale_workspace"
  | "session_expired"
  | "ambiguous";

export type ObservedInterruption = {
  phase: "before_emit" | "after_emit" | "after_commit";
  failureKind: PunksFailureKind;
  recoveryDecision:
    | "effect_excluded"
    | "new_intent_required"
    | "authoritative_read"
    | "retry_active_lease";
};

/**
 * Classifie une interruption depuis la frontière réellement franchie. Cette
 * fonction est utilisée par le transport produit et le corpus commun.
 */
export function classifyObservedInterruption(input: {
  kind: "read" | "mutation" | "follow" | "local-orchestration";
  emitted: boolean;
  committed?: boolean;
  cancelled: boolean;
}): ObservedInterruption {
  const phase = input.committed
    ? "after_commit"
    : input.emitted
      ? "after_emit"
      : "before_emit";
  if (input.cancelled && !input.emitted) {
    return {
      phase,
      failureKind: "cancelled",
      recoveryDecision: "effect_excluded",
    };
  }
  if (input.kind === "mutation" && input.emitted) {
    return {
      phase,
      failureKind: "ambiguous",
      recoveryDecision: "authoritative_read",
    };
  }
  if (input.cancelled) {
    return {
      phase,
      failureKind: "cancelled",
      recoveryDecision: "effect_excluded",
    };
  }
  return {
    phase,
    failureKind: "transport",
    recoveryDecision:
      input.kind === "mutation" ? "new_intent_required" : "retry_active_lease",
  };
}

/** Error carrying both the stable client kind and the server problem. */
export class PunksClientError extends Error {
  readonly kind: PunksFailureKind;
  readonly problem: PunksProblem;

  constructor(problem: PunksProblem, kind?: PunksFailureKind) {
    super(problem.detail ?? problem.title);
    this.name = "PunksClientError";
    this.kind =
      kind ??
      (problem.code === "unauthenticated" || problem.status === 401
        ? "session_expired"
        : problem.retry === "same_command"
          ? "ambiguous"
          : "problem");
    this.problem = problem;
  }
}

/** Builds a redacted local problem without transport or server internals. */
export function clientProblem(
  detail: string,
  options: {
    code?: PunksProblem["code"];
    kind?: PunksFailureKind;
    retry?: PunksProblem["retry"];
    status?: number;
  } = {},
): PunksClientError {
  return new PunksClientError(
    {
      type: "https://punks.bot/problems/client",
      title: "Punks client request failed",
      status: options.status ?? 500,
      code: options.code ?? "internal",
      detail,
      correlationId: crypto.randomUUID(),
      retry: options.retry ?? "never",
    },
    options.kind,
  );
}
