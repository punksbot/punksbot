import { describe, expect, it } from "vitest";

import validationCorpusJson from "../../contracts/conformance/desktop-social-loop-validation.json";
import operationCorpusJson from "../../contracts/conformance/desktop-social-loop-operations.json";
import desktopProfile from "../../contracts/profiles/desktop-social-loop@1.json";
import {
  compareNormalizedTrace,
  normalizeSemanticTrace,
  runFollowCorpus,
  runOperationCorpus,
  runSemanticScenario,
  runValidationCorpus,
} from "../src/conformance";

/**
 * Corpus commun `desktop-social-loop@1` — exécution TypeScript (vitest).
 * La même exécution a lieu sous `workerd` dans
 * `cloudflare/workers/api/test/conformance-workerd.test.ts`, et en Rust dans
 * `punks-account-client/src/tests.rs`.
 */
describe("corpus commun desktop-social-loop@1", () => {
  it("FOLLOW : aucune divergence de trace normalisée", () => {
    const run = runFollowCorpus();
    expect(run.divergences).toEqual([]);
    expect(run.traces.length).toBeGreaterThan(0);
  });

  it("validation : aucune divergence de trace normalisée", () => {
    const run = runValidationCorpus();
    expect(run.divergences).toEqual([]);
    expect(run.traces.length).toBeGreaterThan(0);
  });

  it("matrice exhaustive : chaque opération produit la trace canonique complète", () => {
    const run = runOperationCorpus();
    expect(run.divergences).toEqual([]);
    expect(new Set(run.traces.map(({ operation }) => operation))).toEqual(
      new Set(operationCorpusJson.operations.map(({ operation }) => operation)),
    );
    expect(operationCorpusJson.operations).toHaveLength(
      desktopProfile.operations.length,
    );
    for (const trace of run.traces) {
      expect(Object.keys(trace).sort()).toEqual([
        "ack",
        "case",
        "deliveries",
        "failureKind",
        "generation",
        "operation",
        "outcome",
        "phase",
        "recoveryDecision",
        "rendererConfirmation",
      ]);
    }
  });

  it("redaction : aucun marqueur interdit ne franchit la normalisation", () => {
    const follow = runFollowCorpus();
    const validation = runValidationCorpus();
    expect(follow.redactionHeld).toBe(true);
    expect(validation.redactionHeld).toBe(true);
    expect(runOperationCorpus().redactionHeld).toBe(true);
    const marker = "secret-injecte-dans-le-diagnostic";
    const normalized = normalizeSemanticTrace({
      operation: "postMessage",
      case: "redaction-reelle",
      phase: "after_emit",
      outcome: "reject",
      failureKind: "ambiguous",
      recoveryDecision: "authoritative_read",
      generation: "generation:1",
      deliveries: [],
      rendererConfirmation: "not_applicable",
      ack: "not_applicable",
      diagnostic: { authorization: `Bearer ${marker}`, detail: marker },
    });
    expect(JSON.stringify(normalized)).not.toContain(marker);
  });

  it("divergence localisée par opération et par cas (auto-test du harnais)", () => {
    expect(
      compareNormalizedTrace(
        {
          operation: "postMessage",
          case: "divergence-injectee",
          phase: "after_emit",
          outcome: "reject",
          failureKind: "ambiguous",
          recoveryDecision: "authoritative_read",
          generation: "generation:1",
          deliveries: [],
          rendererConfirmation: "not_applicable",
          ack: "not_applicable",
        },
        { outcome: "ok" },
      ),
    ).toEqual({
      operation: "postMessage",
      case: "divergence-injectee",
      expected: JSON.stringify({ outcome: "ok" }),
      actual: JSON.stringify({
        outcome: "reject",
        failureKind: "ambiguous",
      }),
    });
  });

  it("calcule les transitions depuis les événements, jamais depuis le nom du scénario", () => {
    const base = {
      operation: "postMessage",
      caseName: "nom-volontairement-trompeur",
      owner: "workspace" as const,
      kind: "mutation" as const,
      events: [
        { type: "emit" as const },
        { type: "cancel" as const, phase: "in_flight" as const },
      ],
    };
    expect(runSemanticScenario(base)).toMatchObject({
      phase: "after_emit",
      outcome: "reject",
      failureKind: "ambiguous",
      recoveryDecision: "authoritative_read",
    });
    expect(
      runSemanticScenario({
        ...base,
        events: [{ type: "complete" as const }],
      }),
    ).toMatchObject({
      phase: "completed",
      outcome: "ok",
      failureKind: null,
    });
  });

  it("supprime tout ACK avant livraison et confirmation renderer", () => {
    const trace = runSemanticScenario({
      operation: "confirmFollowBatch",
      caseName: "ack-premature",
      owner: "workspace",
      kind: "local-orchestration",
      events: [{ type: "ack", cursor: 6 }],
    });
    expect(trace.ack).toBe("suppressed");
    expect(trace.deliveries).toEqual([]);
    expect(trace.rendererConfirmation).toBe("not_applicable");
  });

  it("les réponses mal formées sont confrontées à un contrat de réponse", () => {
    const malformedCases = validationCorpusJson.cases.filter(
      (testCase) => testCase.kind === "malformed_response",
    );
    expect(malformedCases.length).toBeGreaterThan(0);
    for (const testCase of malformedCases) {
      expect(testCase.contract).toMatch(/-response@1$/);
    }
  });
});
