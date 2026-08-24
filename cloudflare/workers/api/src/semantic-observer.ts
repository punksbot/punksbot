import { validateContract } from "@punks/contracts";

/** Validateur fermé partagé par les routes produit et le replay workerd. */
export function backendContractAccepted(
  contract: string,
  payload: unknown,
): boolean {
  return validateContract(contract as never, payload).valid;
}

/** Trace canonique admise par les frontières HTTP/FOLLOW du Worker. */
export type BackendSemanticTrace = {
  operation: string;
  case: string;
  phase: string;
  outcome: "ok" | "reject" | "noop" | "replayed" | "resumed" | "pending";
  failureKind: string | null;
  recoveryDecision: string;
  generation: string | null;
  deliveries: string[];
  rendererConfirmation: string;
  ack: string;
};

export type BackendSemanticEvent =
  | {
      type: "validate";
      boundary: "request" | "response" | "frame";
      contract: string | null;
      payload: unknown;
    }
  | { type: "complete" }
  | { type: "server_result"; outcome: "noop" | "replayed" }
  | { type: "emit" }
  | { type: "commit" }
  | { type: "cancel"; phase: string }
  | { type: "interrupt"; phase: string }
  | { type: "problem"; payload: unknown }
  | { type: "same_command" }
  | { type: "session_expired" }
  | { type: "generation_changed"; phase: string }
  | { type: "resume_read" }
  | {
      type: "delivery";
      contract: string;
      payload: unknown;
      deliveryId: string;
    }
  | { type: "renderer"; state: "suspended" | "confirmed" }
  | { type: "ack"; cursor: number };

export type BackendSemanticScenario = {
  operation: string;
  caseName: string;
  owner: "account" | "workspace";
  kind: "read" | "mutation" | "follow" | "local-orchestration";
  events: readonly BackendSemanticEvent[];
  diagnostic?: unknown;
};

function normalized(
  trace: BackendSemanticTrace & { diagnostic?: unknown },
): BackendSemanticTrace {
  return {
    operation: trace.operation,
    case: trace.case,
    phase: trace.phase,
    outcome: trace.outcome,
    failureKind: trace.failureKind,
    recoveryDecision: trace.recoveryDecision,
    generation: trace.generation,
    deliveries: [...trace.deliveries],
    rendererConfirmation: trace.rendererConfirmation,
    ack: trace.ack,
  };
}

/**
 * Observe une séquence de frontières backend. Le libellé de fixture n'est
 * jamais utilisé comme entrée de décision ; les contrats et événements le sont.
 */
export function observeBackendScenario(
  scenario: BackendSemanticScenario,
): BackendSemanticTrace {
  let trace: BackendSemanticTrace = {
    operation: scenario.operation,
    case: scenario.caseName,
    phase: "completed",
    outcome: "ok",
    failureKind: null,
    recoveryDecision: "none",
    generation: scenario.owner === "workspace" ? "generation:1" : null,
    deliveries: [],
    rendererConfirmation: "not_applicable",
    ack: "not_applicable",
  };
  let emitted = false;
  let committed = false;
  const update = (change: Partial<BackendSemanticTrace>) => {
    trace = { ...trace, ...change };
  };
  for (const event of scenario.events) {
    switch (event.type) {
      case "validate": {
        const valid =
          event.contract !== null &&
          backendContractAccepted(event.contract, event.payload);
        if (event.boundary === "frame") {
          update({
            phase: "delivery",
            outcome: valid ? "ok" : "reject",
            failureKind: valid ? null : "contract_violation",
            recoveryDecision: valid ? "none" : "resync",
            rendererConfirmation: valid ? "pending" : "not_confirmed",
            ack: "suppressed",
          });
        } else {
          update({
            phase: `${event.boundary}_validation`,
            outcome: valid ? "ok" : "reject",
            failureKind: valid ? null : "contract_violation",
            recoveryDecision: "none",
          });
        }
        break;
      }
      case "complete":
        update({
          phase: "completed",
          outcome: "ok",
          failureKind: null,
          recoveryDecision: "none",
        });
        break;
      case "server_result":
        update({
          phase: "completed",
          outcome: event.outcome,
          failureKind: null,
          recoveryDecision: "none",
        });
        break;
      case "emit":
        emitted = true;
        break;
      case "commit":
        committed = true;
        break;
      case "cancel":
        if (event.phase === "before_emit") {
          update({
            phase: "before_emit",
            outcome: "reject",
            failureKind: "cancelled",
            recoveryDecision: "effect_excluded",
          });
        } else if (event.phase === "in_flight") {
          update({
            phase: "after_emit",
            outcome: "reject",
            failureKind:
              scenario.kind === "mutation" ? "ambiguous" : "cancelled",
            recoveryDecision:
              scenario.kind === "mutation"
                ? "authoritative_read"
                : "effect_excluded",
            ...(scenario.kind === "follow" ? { ack: "suppressed" } : {}),
          });
        } else if (event.phase === "delivery") {
          update({
            phase: "delivery",
            outcome: "reject",
            failureKind: "cancelled",
            recoveryDecision: "stop_follow",
            rendererConfirmation: "not_confirmed",
            ack: "suppressed",
          });
        } else {
          update({
            phase: "renderer_confirmation",
            outcome: "reject",
            failureKind: "cancelled",
            recoveryDecision: "discard_delivery",
            rendererConfirmation: "cancelled",
            ack: "suppressed",
          });
        }
        break;
      case "interrupt":
        update({
          phase: committed
            ? "after_commit"
            : emitted
              ? "after_emit"
              : "before_emit",
          outcome: "reject",
          failureKind:
            scenario.kind === "mutation" && emitted ? "ambiguous" : "transport",
          recoveryDecision:
            scenario.kind === "mutation"
              ? emitted
                ? "authoritative_read"
                : "new_intent_required"
              : "retry_active_lease",
        });
        break;
      case "problem": {
        const valid = backendContractAccepted(
          "punks://contracts/problem@1",
          event.payload,
        );
        const problem =
          valid &&
          typeof event.payload === "object" &&
          event.payload !== null &&
          !Array.isArray(event.payload)
            ? (event.payload as Record<string, unknown>)
            : null;
        const failure =
          problem === null
            ? "contract_violation"
            : problem.status === 401 || problem.code === "unauthenticated"
              ? "session_expired"
              : problem.retry === "same_command"
                ? "ambiguous"
                : "problem";
        update({
          phase: "remote_boundary",
          outcome: "reject",
          failureKind: failure,
          recoveryDecision:
            failure === "session_expired" ? "close_session" : "fail_closed",
        });
        break;
      }
      case "same_command":
        update({
          phase: "after_emit",
          outcome: "reject",
          failureKind: "ambiguous",
          recoveryDecision: "new_intent_required",
        });
        break;
      case "session_expired":
        update({
          phase: "remote_boundary",
          outcome: "reject",
          failureKind: "session_expired",
          recoveryDecision: "close_session",
        });
        break;
      case "generation_changed":
        update({
          phase:
            event.phase === "before_emit"
              ? "before_emit"
              : event.phase === "delivery"
                ? "delivery"
                : "after_response",
          outcome: "reject",
          failureKind: "stale_workspace",
          recoveryDecision:
            event.phase === "before_emit"
              ? "close_generation"
              : event.phase === "delivery"
                ? "discard_delivery"
                : "discard_result",
          generation: "generation:stale",
          ...(event.phase === "delivery"
            ? { rendererConfirmation: "rejected", ack: "suppressed" }
            : {}),
        });
        break;
      case "resume_read":
        update({
          phase: "completed",
          outcome: "resumed",
          failureKind: null,
          recoveryDecision: "retry_active_lease",
        });
        break;
      case "delivery": {
        const valid = backendContractAccepted(event.contract, event.payload);
        update({
          phase: "delivery",
          outcome: valid ? "ok" : "reject",
          failureKind: valid ? null : "contract_violation",
          recoveryDecision: valid ? "none" : "resync",
          deliveries: valid
            ? [...trace.deliveries, event.deliveryId]
            : trace.deliveries,
          rendererConfirmation: valid ? "pending" : "not_confirmed",
          ack: "suppressed",
        });
        break;
      }
      case "renderer":
        update({
          phase: "renderer_confirmation",
          outcome: event.state === "suspended" ? "pending" : "ok",
          failureKind: null,
          recoveryDecision:
            event.state === "suspended" ? "wait_renderer" : "none",
          rendererConfirmation: event.state,
          ack: "suppressed",
        });
        break;
      case "ack":
        update({
          ack:
            trace.rendererConfirmation === "confirmed" &&
            trace.deliveries.length > 0
              ? `sent:cursor:${event.cursor}`
              : "suppressed",
        });
        break;
    }
  }
  return normalized({ ...trace, diagnostic: scenario.diagnostic });
}
