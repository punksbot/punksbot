/**
 * Harnais du corpus commun de conformité `desktop-social-loop@1` (issue #50).
 *
 * TypeScript, Rust et `workerd` consomment les mêmes événements JSON avec
 * trois moteurs indépendants. Aucun nom de scénario ne sélectionne un verdict.
 *
 * Chaque cas produit la trace canonique complète (phase, reprise, génération,
 * livraisons, confirmation renderer et ACK inclus), comparée à l'attendu et
 * localisée par opération/cas. Les payloads et diagnostics restent hors trace.
 */
import followCorpusJson from "../../contracts/conformance/desktop-social-loop-follow.json";
import operationCorpusJson from "../../contracts/conformance/desktop-social-loop-operations.json";
import {
  validateContract,
  type ConversationFollowServerFrame,
} from "@punks/contracts";
import validationCorpusJson from "../../contracts/conformance/desktop-social-loop-validation.json";

import { classifyObservedInterruption, PunksClientError } from "./client-error";
import {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
  type FollowEffect,
  type FollowState,
} from "./follow-reducer";
import { validateDirectoryCursor, validateHistoryCursor } from "./cursors";

type FollowExpected = {
  phase: FollowState["phase"];
  effect: string;
  appliedCursor: number;
  followCheckpoint: number;
  pendingConfirmationCursor: number | null;
};

type FollowStep =
  | {
      operation: "frame";
      frame: ConversationFollowServerFrame;
      expected: FollowExpected;
    }
  | { operation: "confirm"; throughCursor: number; expected: FollowExpected };

type FollowCorpus = {
  profile: "desktop-social-loop@1";
  operation: "followConversation";
  traces: Array<{
    name: string;
    initialPaginationHighWater: number;
    steps: FollowStep[];
  }>;
};

type ValidationCase = {
  operation: string;
  name: string;
  kind:
    | "valid_payload"
    | "unknown_field"
    | "version_incompatibility"
    | "malformed_response"
    | "closed_error"
    | "cursor";
  contract?: string;
  payload?: unknown;
  problem?: Record<string, unknown>;
  cursor?: string;
  forbiddenMarker?: string;
  expect: { outcome: "ok" | "reject"; failureKind?: string };
};

type ValidationCorpus = {
  profile: "desktop-social-loop@1";
  operation: "contract-validation";
  cases: ValidationCase[];
};

export type NormalizedTrace = {
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

export type CorpusRun = {
  traces: NormalizedTrace[];
  divergences: Array<{
    operation: string;
    case: string;
    expected: string;
    actual: string;
  }>;
  redactionHeld: boolean;
};

/** Compare une trace à son résultat attendu et localise toute divergence. */
export function compareNormalizedTrace(
  actual: NormalizedTrace,
  expected: Partial<NormalizedTrace> & { outcome: NormalizedTrace["outcome"] },
): CorpusRun["divergences"][number] | null {
  const comparedKeys = new Set(Object.keys(expected));
  if (actual.failureKind !== null) comparedKeys.add("failureKind");
  const actualOutcome = Object.fromEntries(
    [...comparedKeys].map((key) => [key, actual[key as keyof NormalizedTrace]]),
  );
  if (JSON.stringify(actualOutcome) === JSON.stringify(expected)) {
    return null;
  }
  return {
    operation: actual.operation,
    case: actual.case,
    expected: JSON.stringify(expected),
    actual: JSON.stringify(actualOutcome),
  };
}

/**
 * Normalise une observation potentiellement sensible par allowlist stricte.
 * `diagnostic` est volontairement accepté puis ignoré : les runners injectent
 * leurs marqueurs secrets dans ce champ pour exercer réellement la redaction.
 */
export function normalizeSemanticTrace(
  input: NormalizedTrace & { diagnostic?: unknown },
): NormalizedTrace {
  return {
    operation: input.operation,
    case: input.case,
    phase: input.phase,
    outcome: input.outcome,
    failureKind: input.failureKind,
    recoveryDecision: input.recoveryDecision,
    generation: input.generation,
    deliveries: [...input.deliveries],
    rendererConfirmation: input.rendererConfirmation,
    ack: input.ack,
  };
}

function canonicalTrace(
  operation: string,
  caseName: string,
  overrides: Partial<Omit<NormalizedTrace, "operation" | "case">> = {},
): NormalizedTrace {
  return {
    operation,
    case: caseName,
    phase: "completed",
    outcome: "ok",
    failureKind: null,
    recoveryDecision: "none",
    generation: null,
    deliveries: [],
    rendererConfirmation: "not_applicable",
    ack: "not_applicable",
    ...overrides,
  };
}

function effectTrace(effect: FollowEffect): string {
  return effect.kind === "resync"
    ? `${effect.kind}:${effect.reason}`
    : effect.kind;
}

/** Rejoue le corpus FOLLOW et compare chaque trace normalisée. */
export function runFollowCorpus(): CorpusRun {
  const corpus = followCorpusJson as unknown as FollowCorpus;
  const traces: NormalizedTrace[] = [];
  const divergences: CorpusRun["divergences"] = [];
  for (const trace of corpus.traces) {
    let state = createFollowState(trace.initialPaginationHighWater);
    for (const [index, step] of trace.steps.entries()) {
      if (step.operation === "frame") {
        const validity = validateContract(
          "punks://contracts/conversation.follow-server-frame@1",
          step.frame,
        );
        if (!validity.valid) {
          divergences.push({
            operation: "followConversation",
            case: `${trace.name}#${index}`,
            expected:
              "trame conforme au contrat conversation.follow-server-frame@1",
            actual: "trame refusée par le schéma",
          });
        }
        const reduction = reduceFollowFrame(state, step.frame);
        state = reduction.state;
        const actual = {
          phase: state.phase,
          effect: effectTrace(reduction.effect),
          appliedCursor: state.appliedCursor,
          followCheckpoint: state.followCheckpoint,
          pendingConfirmationCursor: state.pendingConfirmationCursor,
        };
        const expected = { ...step.expected };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          divergences.push({
            operation: "followConversation",
            case: `${trace.name}#${index}`,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual),
          });
        }
      } else {
        const confirmation = confirmFollowBatch(state, step.throughCursor);
        state = confirmation.state;
        const actual = {
          phase: state.phase,
          effect: confirmation.ack === null ? "none" : "ack",
          appliedCursor: state.appliedCursor,
          followCheckpoint: state.followCheckpoint,
          pendingConfirmationCursor: state.pendingConfirmationCursor,
        };
        const expected = { ...step.expected };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          divergences.push({
            operation: "followConversation",
            case: `${trace.name}#${index}`,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual),
          });
        }
      }
      const caseName = `${trace.name}#${index}`;
      const followMarker = `secret-follow-${caseName}`;
      traces.push(
        normalizeSemanticTrace({
          ...canonicalTrace("followConversation", caseName, {
            phase: state.phase,
            recoveryDecision:
              state.phase === "resync_required" ? "resync" : "none",
            generation: "generation:1",
            deliveries:
              step.operation === "frame" && step.frame.type === "changes"
                ? [`delivery:cursor:${step.frame.throughCursor}`]
                : [],
            rendererConfirmation:
              state.pendingConfirmationCursor === null
                ? "not_pending"
                : "pending",
            ack:
              step.operation === "confirm" &&
              state.followCheckpoint === step.throughCursor
                ? `sent:cursor:${step.throughCursor}`
                : "suppressed",
          }),
          diagnostic: { followMarker, frame: step },
        }),
      );
    }
  }
  const serialized = JSON.stringify(traces);
  const redactionHeld = !serialized.includes("secret-follow-");
  return { traces, divergences, redactionHeld };
}

/** Mappe un problème serveur fermé vers la taxonomie client stable. */
function failureKindForProblem(problem: ValidationCase["problem"]): string {
  const error = new PunksClientError(problem as never);
  return error.kind;
}

/** Rejoue le corpus de validation (payloads, erreurs fermées, curseurs). */
export function runValidationCorpus(): CorpusRun {
  const corpus = validationCorpusJson as unknown as ValidationCorpus;
  const traces: NormalizedTrace[] = [];
  const divergences: CorpusRun["divergences"] = [];
  const markers: string[] = [];
  for (const testCase of corpus.cases) {
    if (testCase.forbiddenMarker !== undefined) {
      markers.push(testCase.forbiddenMarker);
    }
    let actual: NormalizedTrace;
    switch (testCase.kind) {
      case "closed_error":
        actual = canonicalTrace(testCase.operation, testCase.name, {
          phase: "remote_boundary",
          outcome: "reject",
          failureKind: failureKindForProblem(testCase.problem),
          recoveryDecision: "fail_closed",
        });
        break;
      case "cursor": {
        let rejected: string | undefined;
        try {
          if (testCase.operation === "getTimeline") {
            validateHistoryCursor(testCase.cursor ?? "");
          } else {
            validateDirectoryCursor(testCase.cursor ?? "");
          }
        } catch (error) {
          rejected =
            error instanceof PunksClientError ? error.kind : "unexpected";
        }
        actual = canonicalTrace(testCase.operation, testCase.name, {
          phase: "request_validation",
          outcome: rejected === undefined ? "ok" : "reject",
          failureKind: rejected ?? null,
        });
        break;
      }
      default: {
        const contract = testCase.contract ?? "";
        const result = validateContract(contract as never, testCase.payload);
        actual = canonicalTrace(testCase.operation, testCase.name, {
          phase:
            testCase.kind === "malformed_response"
              ? "response_validation"
              : "request_validation",
          outcome: result.valid ? "ok" : "reject",
          failureKind: result.valid ? null : "contract_violation",
        });
        break;
      }
    }
    traces.push(
      normalizeSemanticTrace({
        ...actual,
        diagnostic: testCase.problem ?? testCase.payload,
      }),
    );
    const divergence = compareNormalizedTrace(actual, testCase.expect);
    if (divergence !== null) divergences.push(divergence);
  }

  const serialized = JSON.stringify(traces);
  const redactionHeld = markers.every((marker) => !serialized.includes(marker));
  return { traces, divergences, redactionHeld };
}

type OperationCorpusCase = {
  name: string;
  stimulus: string;
  contract: string | null;
  payload: unknown;
  diagnostic: string;
  events: SemanticEvent[];
  expect: NormalizedTrace;
};

type OperationCorpusEntry = {
  operation: string;
  owner: "account" | "workspace";
  kind: "read" | "mutation" | "follow" | "local-orchestration";
  retry: string;
  cases: OperationCorpusCase[];
};

export type SemanticEvent =
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
  | {
      type: "cancel";
      phase: "before_emit" | "in_flight" | "delivery" | "renderer_confirmation";
    }
  | { type: "interrupt"; phase: "before_emit" | "in_flight" }
  | { type: "problem"; payload: unknown }
  | { type: "same_command" }
  | { type: "session_expired" }
  | {
      type: "generation_changed";
      phase: "before_emit" | "in_flight" | "delivery";
    }
  | { type: "resume_read" }
  | {
      type: "delivery";
      contract: string;
      payload: unknown;
      deliveryId: string;
    }
  | { type: "renderer"; state: "suspended" | "confirmed" }
  | { type: "ack"; cursor: number };

export type SemanticScenario = {
  operation: string;
  caseName: string;
  owner: "account" | "workspace";
  kind: OperationCorpusEntry["kind"];
  events: SemanticEvent[];
  diagnostic?: unknown;
};

/**
 * Exécute une suite d'observations sémantiques. Le nom du cas ne pilote aucune
 * transition : seules les frontières réellement observées le font.
 */
export function runSemanticScenario(
  scenario: SemanticScenario,
): NormalizedTrace {
  let trace = canonicalTrace(scenario.operation, scenario.caseName, {
    generation: scenario.owner === "workspace" ? "generation:1" : null,
  });
  let emitted = false;
  let committed = false;
  let followState: FollowState | null = null;
  let rendererConfirmed = false;
  const update = (
    overrides: Partial<Omit<NormalizedTrace, "operation" | "case">>,
  ) => {
    trace = { ...trace, ...overrides };
  };
  for (const event of scenario.events) {
    switch (event.type) {
      case "validate": {
        const valid =
          event.contract !== null &&
          validateContract(event.contract as never, event.payload).valid;
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
          const interruption = classifyObservedInterruption({
            kind: scenario.kind,
            emitted: true,
            cancelled: true,
          });
          update({
            phase: interruption.phase,
            outcome: "reject",
            failureKind: interruption.failureKind,
            recoveryDecision: interruption.recoveryDecision,
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
      case "interrupt": {
        const interruption = classifyObservedInterruption({
          kind: scenario.kind,
          emitted,
          committed,
          cancelled: false,
        });
        update({
          phase: interruption.phase,
          outcome: "reject",
          failureKind: interruption.failureKind,
          recoveryDecision: interruption.recoveryDecision,
        });
        break;
      }
      case "problem": {
        const valid = validateContract(
          "punks://contracts/problem@1",
          event.payload,
        ).valid;
        const error = valid
          ? new PunksClientError(event.payload as never)
          : null;
        update({
          phase: "remote_boundary",
          outcome: "reject",
          failureKind: error?.kind ?? "contract_violation",
          recoveryDecision:
            error?.kind === "session_expired" ? "close_session" : "fail_closed",
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
        let valid = validateContract(
          event.contract as never,
          event.payload,
        ).valid;
        if (valid) {
          const frame = event.payload as ConversationFollowServerFrame;
          if (frame.type === "changes") {
            const accepted = reduceFollowFrame(
              createFollowState(frame.fromExclusiveCursor),
              {
                schemaVersion: 1,
                type: "accepted",
                resumeAfterCursor: frame.fromExclusiveCursor,
                targetHighWaterCursor: frame.throughCursor,
              },
            );
            const reduction = reduceFollowFrame(accepted.state, frame);
            valid = reduction.effect.kind === "apply_batch";
            followState = valid ? reduction.state : null;
          }
        }
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
        rendererConfirmed = event.state === "confirmed";
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
      case "ack": {
        const confirmation =
          rendererConfirmed && followState !== null
            ? confirmFollowBatch(followState, event.cursor)
            : null;
        update({
          ack:
            confirmation?.ack === null || confirmation === null
              ? "suppressed"
              : `sent:cursor:${confirmation.ack.throughCursor}`,
        });
        break;
      }
    }
  }
  return normalizeSemanticTrace({ ...trace, diagnostic: scenario.diagnostic });
}

/** Rejoue la matrice exhaustive des 18 opérations du profil. */
export function runOperationCorpus(): CorpusRun {
  const corpus = operationCorpusJson as unknown as {
    forbiddenMarkers: string[];
    operations: OperationCorpusEntry[];
  };
  const traces: NormalizedTrace[] = [];
  const divergences: CorpusRun["divergences"] = [];
  for (const operation of corpus.operations) {
    for (const testCase of operation.cases) {
      const actual = runSemanticScenario({
        operation: operation.operation,
        caseName: testCase.name,
        owner: operation.owner,
        kind: operation.kind,
        events: testCase.events,
        diagnostic: testCase.diagnostic,
      });
      traces.push(actual);
      const divergence = compareNormalizedTrace(actual, testCase.expect);
      if (divergence !== null) divergences.push(divergence);
    }
  }
  const serialized = JSON.stringify(traces);
  return {
    traces,
    divergences,
    redactionHeld: corpus.forbiddenMarkers.every(
      (marker) => !serialized.includes(marker),
    ),
  };
}
