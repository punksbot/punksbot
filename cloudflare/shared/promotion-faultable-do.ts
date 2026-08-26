import { DurableObject } from "cloudflare:workers";

export const PROMOTION_FAULT_TYPES = [
  "coupure",
  "revocation",
  "perte-autorite",
] as const;

export const PROMOTION_RECOVERY_PROOFS = [
  "roll-forward",
  "rpo-logique-nul",
  "session-non-restauree",
  "recu-resistant-pitr",
] as const;

export type PromotionFaultType = (typeof PROMOTION_FAULT_TYPES)[number];
export type PromotionRecoveryProof = (typeof PROMOTION_RECOVERY_PROOFS)[number];

/** Immutable coordinate installed in the authority that is actually faulted. */
export interface PromotionAuthorityFaultIdentity {
  executionId: string;
  candidateSha: string;
  stagingDeploymentId: string;
  type: PromotionFaultType;
  authority: string;
  target: {
    kind: "aggregate" | "service";
    id: string;
  };
}

/** One ordered recovery operation applied to the faulted authority itself. */
export interface PromotionAuthorityFaultRecovery
  extends PromotionAuthorityFaultIdentity {
  proof: PromotionRecoveryProof;
}

/** Public RPC observation emitted by the faulted Durable Object. */
export interface PromotionAuthorityFaultState
  extends PromotionAuthorityFaultIdentity {
  schema: "punks.promotion-authority-fault-state.v1";
  phase: "injected" | "recovering" | "recovered";
  proof: PromotionRecoveryProof | null;
  sequence: number;
  stateFingerprint: string;
}

interface StoredPromotionAuthorityFault {
  identity: PromotionAuthorityFaultIdentity;
  current: PromotionAuthorityFaultState;
  recoveries: PromotionAuthorityFaultState[];
}

const STORAGE_KEY = "__punks_promotion_authority_fault_v1";
export const PROMOTION_AUTHORITY_FAULT_ACTIVE =
  "promotion authority fault is active";
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const EXECUTION_RE = /^[a-z0-9][a-z0-9.:-]{0,299}$/u;
const AUTHORITY_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])$/u;

function sameIdentity(
  left: PromotionAuthorityFaultIdentity,
  right: PromotionAuthorityFaultIdentity,
): boolean {
  return (
    left.executionId === right.executionId &&
    left.candidateSha === right.candidateSha &&
    left.stagingDeploymentId === right.stagingDeploymentId &&
    left.type === right.type &&
    left.authority === right.authority &&
    left.target.kind === right.target.kind &&
    left.target.id === right.target.id
  );
}

function validIdentity(
  value: PromotionAuthorityFaultIdentity,
): value is PromotionAuthorityFaultIdentity {
  return (
    EXECUTION_RE.test(value.executionId) &&
    SHA1_RE.test(value.candidateSha) &&
    DEPLOYMENT_RE.test(value.stagingDeploymentId) &&
    (PROMOTION_FAULT_TYPES as readonly string[]).includes(value.type) &&
    AUTHORITY_RE.test(value.authority) &&
    value.target !== null &&
    typeof value.target === "object" &&
    ["aggregate", "service"].includes(value.target.kind) &&
    /^[A-Za-z0-9][A-Za-z0-9.:-]{0,299}$/u.test(value.target.id)
  );
}

function state(
  identity: PromotionAuthorityFaultIdentity,
  phase: PromotionAuthorityFaultState["phase"],
  proof: PromotionRecoveryProof | null,
  sequence: number,
  stateFingerprint: string,
): PromotionAuthorityFaultState {
  return {
    schema: "punks.promotion-authority-fault-state.v1",
    ...identity,
    phase,
    proof,
    sequence,
    stateFingerprint,
  };
}

/**
 * Durable Object base that stores promotion faults in the named authority
 * instance, rather than in the independent receipt controller.
 */
export class PromotionFaultableDurableObject<Env> extends DurableObject<Env> {
  protected async promotionRecoveryFingerprint(): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(this.ctx.id.name ?? this.ctx.id.toString()),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  /** Installs an idempotent fault in this exact authority instance. */
  async injectPromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    if (!validIdentity(input)) {
      throw new Error("invalid promotion authority fault identity");
    }
    const existing =
      await this.ctx.storage.get<StoredPromotionAuthorityFault>(STORAGE_KEY);
    if (existing !== undefined && existing.current.phase !== "recovered") {
      if (!sameIdentity(existing.identity, input)) {
        throw new Error("promotion authority already has another active fault");
      }
      return existing.current;
    }
    if (
      existing !== undefined &&
      existing.current.phase === "recovered" &&
      sameIdentity(existing.identity, input)
    ) {
      throw new Error("recovered promotion authority fault cannot be reopened");
    }
    const stateFingerprint = await this.promotionRecoveryFingerprint();
    if (!/^[0-9a-f]{64}$/u.test(stateFingerprint)) {
      throw new Error("promotion authority state fingerprint is invalid");
    }
    const current = state(input, "injected", null, 1, stateFingerprint);
    await this.ctx.storage.put<StoredPromotionAuthorityFault>(STORAGE_KEY, {
      identity: input,
      current,
      recoveries: [],
    });
    return current;
  }

  /** Applies one ordered recovery proof to this exact authority instance. */
  async recoverPromotionFault(
    input: PromotionAuthorityFaultRecovery,
  ): Promise<PromotionAuthorityFaultState> {
    if (
      !validIdentity(input) ||
      !(PROMOTION_RECOVERY_PROOFS as readonly string[]).includes(input.proof)
    ) {
      throw new Error("invalid promotion authority recovery identity");
    }
    const existing =
      await this.ctx.storage.get<StoredPromotionAuthorityFault>(STORAGE_KEY);
    if (existing === undefined || !sameIdentity(existing.identity, input)) {
      throw new Error("promotion authority recovery has no matching fault");
    }
    if (
      (await this.promotionRecoveryFingerprint()) !==
      existing.current.stateFingerprint
    ) {
      throw new Error("promotion authority state changed during recovery");
    }
    const replay = existing.recoveries.find(
      ({ proof }) => proof === input.proof,
    );
    if (replay !== undefined) return replay;
    const expected = PROMOTION_RECOVERY_PROOFS[existing.recoveries.length];
    if (expected !== input.proof || existing.current.phase === "recovered") {
      throw new Error("promotion authority recovery proof is out of order");
    }
    const phase =
      existing.recoveries.length + 1 === PROMOTION_RECOVERY_PROOFS.length
        ? "recovered"
        : "recovering";
    const current = state(
      existing.identity,
      phase,
      input.proof,
      existing.recoveries.length + 2,
      existing.current.stateFingerprint,
    );
    await this.ctx.storage.put<StoredPromotionAuthorityFault>(STORAGE_KEY, {
      ...existing,
      current,
      recoveries: [...existing.recoveries, current],
    });
    return current;
  }

  /** Reads this authority instance's own fault state for an installed probe. */
  async probePromotionFault(
    executionId: string,
  ): Promise<PromotionAuthorityFaultState | null> {
    if (!EXECUTION_RE.test(executionId)) return null;
    const existing =
      await this.ctx.storage.get<StoredPromotionAuthorityFault>(STORAGE_KEY);
    return existing?.identity.executionId === executionId
      ? existing.current
      : null;
  }

  /**
   * Executes inside the authority RPC boundary and fails there while the
   * injected fault or any intermediate recovery remains active.
   */
  async observePromotionFault(
    executionId: string,
  ): Promise<PromotionAuthorityFaultState> {
    const current = await this.probePromotionFault(executionId);
    if (current === null) {
      throw new Error("promotion authority fault is missing");
    }
    if (current.phase !== "recovered") {
      throw new Error(
        `${PROMOTION_AUTHORITY_FAULT_ACTIVE}:${current.phase}:${current.type}`,
      );
    }
    return current;
  }
}
