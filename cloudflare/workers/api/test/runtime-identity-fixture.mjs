import { WorkerEntrypoint } from "cloudflare:workers";

const promotionFaultStates = new Map();
const promotionRecoveryProofs = [
  "roll-forward",
  "rpo-logique-nul",
  "session-non-restauree",
  "recu-resistant-pitr",
];

export class PromotionAuthorityFaultService extends WorkerEntrypoint {
  injectPromotionFault(input) {
    const existing = promotionFaultStates.get(input.executionId);
    if (existing !== undefined) return structuredClone(existing);
    const state = {
      schema: "punks.promotion-authority-fault-state.v1",
      ...input,
      phase: "injected",
      proof: null,
      sequence: 1,
      stateFingerprint: "f".repeat(64),
    };
    promotionFaultStates.set(input.executionId, state);
    return structuredClone(state);
  }

  recoverPromotionFault(input) {
    const existing = promotionFaultStates.get(input.executionId);
    const index = promotionRecoveryProofs.indexOf(input.proof);
    if (existing === undefined || index < 0) {
      throw new Error("promotion fault recovery is invalid");
    }
    const state = {
      ...existing,
      phase:
        index === promotionRecoveryProofs.length - 1
          ? "recovered"
          : "recovering",
      proof: input.proof,
      sequence: index + 2,
    };
    promotionFaultStates.set(input.executionId, state);
    return structuredClone(state);
  }

  probePromotionFault(input) {
    return structuredClone(promotionFaultStates.get(input.executionId) ?? null);
  }

  observePromotionFault(input) {
    const state = promotionFaultStates.get(input.executionId);
    if (state === undefined)
      throw new Error("promotion authority fault is missing");
    if (state.phase !== "recovered") {
      throw new Error(
        `promotion authority fault is active:${state.phase}:${state.type}`,
      );
    }
    return structuredClone(state);
  }
}

/** Private runtime identity RPC fixture; deliberately has no fetch method. */
export class RuntimeIdentityService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "00000000-0000-4000-8000-000000000007" };
  }
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
