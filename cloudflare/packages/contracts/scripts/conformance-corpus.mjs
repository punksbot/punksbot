const UUID = "00000000-0000-8000-8000-000000000001";
const DATE = "2026-08-22T12:00:00.000Z";
const HISTORY_CURSOR = `mhc1.cGF5bG9hZA.${"A".repeat(43)}`;
const PUNK_SEARCH_CURSOR = `psc1.${"A".repeat(16)}.${"A".repeat(43)}`;
const SECRET = "secret-conformance-8f31c0a6-ne-doit-jamais-apparaitre";

function externalName(reference) {
  const match = /schemas\/([a-z0-9.-]+)\.schema\.json$/.exec(reference ?? "");
  return match?.[1]?.replace(/\.schema$/, "") ?? null;
}

function matchesCondition(value, condition) {
  if (condition?.required?.some((field) => !(field in value))) return false;
  return Object.entries(condition?.properties ?? {}).every(
    ([field, schema]) =>
      schema.const === undefined || value[field] === schema.const,
  );
}

function stringSample(schema, path) {
  if (schema.format === "uuid") return UUID;
  if (schema.format === "date-time") return DATE;
  if (
    ["verifierCommitment", "verifier", "capability", "token"].some((field) =>
      path.endsWith(field),
    )
  ) {
    return "A".repeat(43);
  }
  if (path.endsWith("origin")) return "https://punks.example";
  if (path.endsWith("slug")) return "aa";
  if (path.endsWith("reaction")) return "🔥";
  if (schema.format === "uri") return "https://punks.example/conformance";
  const pattern = schema.pattern ?? "";
  if (pattern.includes("mhc1")) return HISTORY_CURSOR;
  if (pattern.includes("psc1")) return PUNK_SEARCH_CURSOR;
  if (pattern.includes("[0-9a-f]{64}")) return "a".repeat(64);
  if (pattern.includes("[0-9]+\\.[0-9]+")) return "1.0.0";
  if (pattern.includes("https?://")) return "https://punks.example";
  if (pattern.includes("/(?!")) return "/conformance";
  if (pattern.includes("A-Za-z0-9._~-")) return "cursor_1";
  if (pattern.startsWith("^:") || pattern.includes("A-Za-z0-9_-")) {
    return ":wave:";
  }
  return "value";
}

function mergeObjectSample(target, schema, context) {
  for (const field of schema.required ?? []) {
    if (
      target[field] === undefined &&
      schema.properties?.[field] !== undefined
    ) {
      target[field] = sampleSchema(schema.properties[field], context, field);
    }
  }
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (
      target[field] !== undefined ||
      !(schema.required ?? []).includes(field)
    ) {
      continue;
    }
    target[field] = sampleSchema(property, context, field);
  }
}

function sampleSchema(schema, context, path = "value") {
  if (schema.$ref !== undefined) {
    if (schema.$ref.startsWith("#/$defs/")) {
      const definition = context.root.$defs?.[schema.$ref.slice(8)];
      if (definition === undefined)
        throw new Error(`$ref local absent : ${schema.$ref}`);
      return sampleSchema(definition, context, path);
    }
    const name = externalName(schema.$ref);
    if (name === null || !context.schemas.has(name)) {
      throw new Error(`$ref externe absent : ${schema.$ref}`);
    }
    const root = context.schemas.get(name);
    return sampleSchema(root, { ...context, root }, path);
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.anyOf !== undefined) {
    const nullable = schema.anyOf.find((variant) => variant.type === "null");
    if (nullable !== undefined) return null;
    return sampleSchema(schema.anyOf[0], context, path);
  }
  if (
    schema.oneOf !== undefined &&
    schema.properties === undefined &&
    schema.type !== "object"
  ) {
    return sampleSchema(schema.oneOf[0], context, path);
  }
  switch (
    schema.type ??
    (schema.properties === undefined ? undefined : "object")
  ) {
    case "null":
      return null;
    case "string":
      return stringSample(schema, path);
    case "integer":
    case "number":
      return schema.minimum ?? 0;
    case "boolean":
      return false;
    case "array": {
      const count = schema.minItems ?? 0;
      return Array.from({ length: count }, (_, index) =>
        sampleSchema(schema.items ?? {}, context, `${path}[${index}]`),
      );
    }
    case "object": {
      const value = {};
      mergeObjectSample(value, schema, context);
      if (schema.oneOf !== undefined) {
        mergeObjectSample(value, schema.oneOf[0], context);
        for (const [field, property] of Object.entries(
          schema.oneOf[0].properties ?? {},
        )) {
          value[field] = sampleSchema(property, context, field);
        }
      }
      for (const rule of schema.allOf ?? []) {
        if (rule.if !== undefined && matchesCondition(value, rule.if)) {
          for (const [field, property] of Object.entries(
            rule.then?.properties ?? {},
          )) {
            value[field] = sampleSchema(property, context, field);
          }
        }
      }
      return value;
    }
    default:
      return {};
  }
}

function trace(operation, owner, stimulus, overrides = {}) {
  const generation = owner === "workspace" ? "generation:1" : null;
  return {
    operation,
    case: stimulus,
    phase: "completed",
    outcome: "ok",
    failureKind: null,
    recoveryDecision: "none",
    generation,
    deliveries: [],
    rendererConfirmation: "not_applicable",
    ack: "not_applicable",
    ...overrides,
  };
}

function expectedTrace(operation, owner, kind, retry, stimulus) {
  const base = (overrides) => trace(operation, owner, stimulus, overrides);
  switch (stimulus) {
    case "valid_request":
      return base({ phase: "request_validation" });
    case "valid_response":
      return base({ phase: "response_validation" });
    case "unknown_field":
    case "version_incompatibility":
      return base({
        phase: "request_validation",
        outcome: "reject",
        failureKind: "contract_violation",
      });
    case "malformed_response":
      return base({
        phase: "response_validation",
        outcome: "reject",
        failureKind: "contract_violation",
      });
    case "authoritative_noop":
      return base({ outcome: "noop" });
    case "replayed_response":
      return base({ outcome: "replayed" });
    case "cancel_before_emit":
      return base({
        phase: "before_emit",
        outcome: "reject",
        failureKind: "cancelled",
        recoveryDecision: "effect_excluded",
      });
    case "cancel_in_flight":
      return base({
        phase: "after_emit",
        outcome: "reject",
        failureKind: kind === "mutation" ? "ambiguous" : "cancelled",
        recoveryDecision:
          kind === "mutation" ? "authoritative_read" : "effect_excluded",
        ...(kind === "follow" ? { ack: "suppressed" } : {}),
      });
    case "cancel_delivery":
      return base({
        phase: "delivery",
        outcome: "reject",
        failureKind: "cancelled",
        recoveryDecision: "stop_follow",
        rendererConfirmation: "not_confirmed",
        ack: "suppressed",
      });
    case "cancel_renderer_confirmation":
      return base({
        phase: "renderer_confirmation",
        outcome: "reject",
        failureKind: "cancelled",
        recoveryDecision: "discard_delivery",
        deliveries: ["delivery:1"],
        rendererConfirmation: "cancelled",
        ack: "suppressed",
      });
    case "interrupt_before_emit":
      return base({
        phase: "before_emit",
        outcome: "reject",
        failureKind: "transport",
        recoveryDecision:
          kind === "mutation" ? "new_intent_required" : "retry_active_lease",
      });
    case "interrupt_after_emit":
      return base({
        phase: "after_emit",
        outcome: "reject",
        failureKind: kind === "mutation" ? "ambiguous" : "transport",
        recoveryDecision:
          kind === "mutation" ? "authoritative_read" : "retry_active_lease",
      });
    case "loss_after_commit":
      return base({
        phase: "after_commit",
        outcome: "reject",
        failureKind: "ambiguous",
        recoveryDecision: "authoritative_read",
      });
    case "same_command":
      return base({
        phase: "after_emit",
        outcome: "reject",
        failureKind: "ambiguous",
        recoveryDecision: "new_intent_required",
      });
    case "session_expired":
      return base({
        phase: "remote_boundary",
        outcome: "reject",
        failureKind: "session_expired",
        recoveryDecision: "close_session",
      });
    case "closed_problem":
      return base({
        phase: "remote_boundary",
        outcome: "reject",
        failureKind: "problem",
        recoveryDecision: "fail_closed",
      });
    case "stale_before_io":
      return base({
        phase: "before_emit",
        outcome: "reject",
        failureKind: "stale_workspace",
        recoveryDecision: "close_generation",
        generation: "generation:stale",
      });
    case "stale_during_io":
      return base({
        phase: "after_response",
        outcome: "reject",
        failureKind: "stale_workspace",
        recoveryDecision: "discard_result",
        generation: "generation:stale",
      });
    case "safe_read_resume":
      return base({
        outcome: "resumed",
        recoveryDecision: "retry_active_lease",
      });
    case "malformed_frame":
      return base({
        phase: "delivery",
        outcome: "reject",
        failureKind: "contract_violation",
        recoveryDecision: "resync",
        rendererConfirmation: "not_confirmed",
        ack: "suppressed",
      });
    case "stale_delivery":
      return base({
        phase: "delivery",
        outcome: "reject",
        failureKind: "stale_workspace",
        recoveryDecision: "discard_delivery",
        generation: "generation:stale",
        deliveries: ["delivery:1"],
        rendererConfirmation: "rejected",
        ack: "suppressed",
      });
    case "renderer_suspended":
      return base({
        phase: "renderer_confirmation",
        outcome: "pending",
        recoveryDecision: "wait_renderer",
        deliveries: ["delivery:1"],
        rendererConfirmation: "suspended",
        ack: "suppressed",
      });
    case "renderer_confirmed":
      return base({
        phase: "renderer_confirmation",
        deliveries: ["delivery:1"],
        rendererConfirmation: "confirmed",
        ack: "sent:cursor:6",
      });
    default:
      return base({ recoveryDecision: retry === "never" ? "none" : "none" });
  }
}

function eventsFor(operation, stimulus, contract, payload, validFrame) {
  const validate = (boundary) => [
    { type: "validate", boundary, contract, payload },
  ];
  switch (stimulus) {
    case "success":
      return [{ type: "complete" }];
    case "valid_request":
    case "unknown_field":
    case "version_incompatibility":
      return validate("request");
    case "valid_response":
    case "malformed_response":
      return validate("response");
    case "closed_problem":
      return [{ type: "problem", payload }];
    case "authoritative_noop":
      return [{ type: "server_result", outcome: "noop" }];
    case "replayed_response":
      return [{ type: "server_result", outcome: "replayed" }];
    case "cancel_before_emit":
      return [{ type: "cancel", phase: "before_emit" }];
    case "cancel_in_flight":
      return [{ type: "emit" }, { type: "cancel", phase: "in_flight" }];
    case "cancel_delivery":
      return [{ type: "emit" }, { type: "cancel", phase: "delivery" }];
    case "cancel_renderer_confirmation":
      return [
        { type: "emit" },
        {
          type: "delivery",
          contract: "punks://contracts/conversation.follow-server-frame@1",
          payload: validFrame,
          deliveryId: "delivery:1",
        },
        { type: "cancel", phase: "renderer_confirmation" },
      ];
    case "interrupt_before_emit":
      return [{ type: "interrupt", phase: "before_emit" }];
    case "interrupt_after_emit":
      return [{ type: "emit" }, { type: "interrupt", phase: "in_flight" }];
    case "loss_after_commit":
      return [
        { type: "emit" },
        { type: "commit" },
        { type: "interrupt", phase: "in_flight" },
      ];
    case "same_command":
      return [{ type: "same_command" }];
    case "session_expired":
      return [{ type: "session_expired" }];
    case "stale_before_io":
      return [{ type: "generation_changed", phase: "before_emit" }];
    case "stale_during_io":
      return [
        { type: "emit" },
        { type: "generation_changed", phase: "in_flight" },
      ];
    case "safe_read_resume":
      return [{ type: "resume_read" }];
    case "malformed_frame":
      return [
        { type: "emit" },
        { type: "validate", boundary: "frame", contract, payload },
      ];
    case "stale_delivery":
      return [
        { type: "emit" },
        {
          type: "delivery",
          contract: "punks://contracts/conversation.follow-server-frame@1",
          payload: validFrame,
          deliveryId: "delivery:1",
        },
        { type: "generation_changed", phase: "delivery" },
      ];
    case "renderer_suspended":
      return [
        { type: "emit" },
        {
          type: "delivery",
          contract: "punks://contracts/conversation.follow-server-frame@1",
          payload: validFrame,
          deliveryId: "delivery:1",
        },
        { type: "renderer", state: "suspended" },
      ];
    case "renderer_confirmed":
      return [
        {
          type: "delivery",
          contract: "punks://contracts/conversation.follow-server-frame@1",
          payload: validFrame,
          deliveryId: "delivery:1",
        },
        { type: "renderer", state: "confirmed" },
        { type: "ack", cursor: 6 },
      ];
    default:
      throw new Error(
        `${operation.name} : stimulus sans événements ${stimulus}`,
      );
  }
}

function stimuliFor(operation) {
  const stimuli = ["success"];
  if (operation.requestContract !== undefined) {
    stimuli.push("valid_request", "unknown_field", "version_incompatibility");
  }
  if (operation.responseContract !== undefined) {
    stimuli.push("valid_response", "malformed_response");
  }
  for (const phase of operation.cancellablePhases) {
    stimuli.push(`cancel_${phase}`);
  }
  if (operation.kind !== "local-orchestration") {
    stimuli.push("closed_problem", "session_expired");
  }
  if (operation.kind === "read") {
    stimuli.push(
      "interrupt_before_emit",
      "interrupt_after_emit",
      "safe_read_resume",
    );
  } else if (operation.kind === "mutation") {
    stimuli.push(
      "authoritative_noop",
      "replayed_response",
      "interrupt_before_emit",
      "interrupt_after_emit",
      "loss_after_commit",
      "same_command",
    );
  } else if (operation.kind === "follow") {
    stimuli.push(
      "interrupt_before_emit",
      "interrupt_after_emit",
      "malformed_frame",
      "stale_delivery",
      "renderer_suspended",
    );
  } else if (operation.name === "confirmFollowBatch") {
    stimuli.push("renderer_suspended", "renderer_confirmed");
  } else {
    stimuli.push("authoritative_noop");
  }
  if (
    operation.owner === "workspace" &&
    operation.kind !== "local-orchestration"
  ) {
    stimuli.push("stale_before_io", "stale_during_io");
  }
  return [...new Set(stimuli)];
}

/** Produit le corpus commun, fermé sur les opérations du profil. */
export function generateOperationCorpus(profile, schemas) {
  const contractSample = (reference, message) => {
    if (reference === undefined) return null;
    const name = reference.split("@")[0];
    const root = schemas.get(name);
    if (root === undefined) throw new Error(`schéma absent : ${reference}`);
    const variant = root.oneOf
      ?.map((candidate) =>
        candidate.$ref?.startsWith("#/$defs/")
          ? root.$defs?.[candidate.$ref.slice(8)]
          : candidate,
      )
      .find((candidate) => candidate?.properties?.message?.const === message);
    return {
      contract: `punks://contracts/${reference}`,
      payload: sampleSchema(variant ?? root, { root, schemas }),
    };
  };
  const problem = {
    contract: "punks://contracts/problem@1",
    payload: {
      type: "https://punks.bot/problems/forbidden",
      title: "Forbidden",
      status: 403,
      code: "forbidden",
      correlationId: UUID,
      retry: "never",
    },
  };
  const validFrame = {
    schemaVersion: 1,
    type: "changes",
    fromExclusiveCursor: 5,
    throughCursor: 6,
    messages: [],
    threadPatches: [],
    reactionPatches: [],
    reactionCollectionPatches: [],
  };
  return {
    version: profile.corpusVersion,
    profile: profile.id,
    forbiddenMarkers: [SECRET],
    operations: profile.operations.map((operation) => ({
      operation: operation.name,
      owner: operation.owner,
      kind: operation.kind,
      retry: operation.retry,
      cancellablePhases: operation.cancellablePhases,
      request: contractSample(operation.requestContract, "request"),
      response: contractSample(operation.responseContract, "response"),
      cases: stimuliFor(operation).map((stimulus) => {
        const source =
          stimulus === "closed_problem"
            ? problem
            : [
                  "valid_response",
                  "malformed_response",
                  "malformed_frame",
                ].includes(stimulus)
              ? contractSample(operation.responseContract, "response")
              : contractSample(operation.requestContract, "request");
        let payload = source?.payload ?? null;
        if (stimulus === "unknown_field" && payload !== null) {
          payload = { ...payload, forbiddenSecret: SECRET };
        } else if (stimulus === "version_incompatibility" && payload !== null) {
          const contractField = payload.contract;
          payload = {
            ...payload,
            ...(typeof contractField === "string"
              ? { contract: contractField.replace(/@1$/, "@2") }
              : { incompatibleVersion: 2 }),
          };
        } else if (stimulus === "malformed_response") {
          payload = { malformed: true, diagnosticSecret: SECRET };
        } else if (stimulus === "malformed_frame") {
          payload = {
            schemaVersion: 1,
            type: "changes",
            fromCursorExclusive: 7,
            throughCursor: 6,
            hasMore: false,
            changes: [],
            diagnosticSecret: SECRET,
          };
        }
        return {
          name: stimulus,
          stimulus,
          contract: source?.contract ?? null,
          payload,
          diagnostic: `${SECRET}:${operation.name}:${stimulus}`,
          events: eventsFor(
            operation,
            stimulus,
            source?.contract ?? null,
            payload,
            validFrame,
          ),
          expect: expectedTrace(
            operation.name,
            operation.owner,
            operation.kind,
            operation.retry,
            stimulus,
          ),
        };
      }),
    })),
  };
}
