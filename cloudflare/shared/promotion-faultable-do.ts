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
    probe: PromotionBusinessProbe;
  };
}

/** Closed fixture coordinates required to exercise a normal business path. */
export interface PromotionBusinessProbe {
  punkId: string;
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  messageId: string;
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
  injectionBookmark: string;
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
    left.target.id === right.target.id &&
    JSON.stringify(left.target.probe) === JSON.stringify(right.target.probe)
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
    /^[A-Za-z0-9][A-Za-z0-9.:-]{0,299}$/u.test(value.target.id) &&
    value.target.probe !== null &&
    typeof value.target.probe === "object" &&
    !Array.isArray(value.target.probe) &&
    JSON.stringify(Object.keys(value.target.probe).sort()) ===
      JSON.stringify(
        [
          "conversationId",
          "messageId",
          "punkId",
          "workspaceId",
          "workspaceSlug",
        ].sort(),
      ) &&
    [
      value.target.probe.punkId,
      value.target.probe.workspaceId,
      value.target.probe.conversationId,
      value.target.probe.messageId,
    ].every(
      (coordinate) =>
        typeof coordinate === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          coordinate,
        ),
    ) &&
    typeof value.target.probe.workspaceSlug === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$/u.test(
      value.target.probe.workspaceSlug,
    )
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
  private isStaging(): boolean {
    return (this.env as { ENVIRONMENT?: string }).ENVIRONMENT === "staging";
  }

  private canFinalizePromotionPitr(): boolean {
    const env = this.env as {
      ENVIRONMENT?: string;
      PROMOTION_FAULTS_ENABLED?: string;
    };
    return (
      env.ENVIRONMENT === "staging" ||
      (env.ENVIRONMENT === "local" && env.PROMOTION_FAULTS_ENABLED === "true")
    );
  }

  private async currentRecoveryBookmark(): Promise<string> {
    try {
      return await this.ctx.storage.getCurrentBookmark();
    } catch (error) {
      if (this.isStaging()) throw error;
      return `workerd:${await this.promotionRecoveryFingerprint()}`;
    }
  }

  /** Real roll-forward hook; aggregate classes can extend repair before sync. */
  protected async repairPromotionAuthority(): Promise<void> {
    await this.ctx.storage.sync();
  }

  /** SessionDO overrides this to revoke instead of restoring authentication. */
  protected async invalidatePromotionSessionForRecovery(): Promise<void> {
    throw new Error("promotion Session recovery hook is unavailable");
  }
  /**
   * Shared business-path fence. Normal authority operations call this before
   * reading or mutating state; promotion controller RPCs are not a substitute.
   */
  protected async requirePromotionAuthorityAvailable(): Promise<void> {
    const existing =
      await this.ctx.storage.get<StoredPromotionAuthorityFault>(STORAGE_KEY);
    if (existing !== undefined && existing.current.phase !== "recovered") {
      throw new Error(
        `${PROMOTION_AUTHORITY_FAULT_ACTIVE}:${existing.current.phase}:${existing.current.type}`,
      );
    }
  }

  protected async promotionAuthorityIsAvailable(): Promise<boolean> {
    try {
      await this.requirePromotionAuthorityAvailable();
      return true;
    } catch {
      return false;
    }
  }

  /** Service-boundary form used by real stateless Worker entrypoints. */
  async requirePromotionServiceAvailable(): Promise<boolean> {
    await this.requirePromotionAuthorityAvailable();
    return true;
  }

  /** Non-throwing service fence for normal Worker entrypoints. */
  async promotionServiceAvailable(): Promise<boolean> {
    return this.promotionAuthorityIsAvailable();
  }

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
    await this.ctx.storage.sync();
    const injectionBookmark = await this.currentRecoveryBookmark();
    await this.ctx.storage.put<StoredPromotionAuthorityFault>(STORAGE_KEY, {
      identity: input,
      current,
      recoveries: [],
      injectionBookmark,
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
    if (input.proof === "roll-forward") {
      await this.repairPromotionAuthority();
    }
    let recoveryFingerprint = existing.current.stateFingerprint;
    if (
      input.proof === "session-non-restauree" &&
      input.authority === "auth-session" &&
      input.type === "perte-autorite"
    ) {
      await this.invalidatePromotionSessionForRecovery();
      recoveryFingerprint = await this.promotionRecoveryFingerprint();
      if (recoveryFingerprint === existing.current.stateFingerprint) {
        throw new Error(
          "promotion Session recovery did not revoke the Session",
        );
      }
    }
    await this.ctx.storage.sync();
    const currentBookmark = await this.currentRecoveryBookmark();
    if (
      typeof existing.injectionBookmark !== "string" ||
      existing.injectionBookmark.length === 0 ||
      typeof currentBookmark !== "string" ||
      currentBookmark.length === 0 ||
      (await this.promotionRecoveryFingerprint()) !== recoveryFingerprint
    ) {
      throw new Error("promotion authority RPO-zero verification failed");
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
      recoveryFingerprint,
    );
    await this.ctx.storage.put<StoredPromotionAuthorityFault>(STORAGE_KEY, {
      ...existing,
      current,
      recoveries: [...existing.recoveries, current],
    });
    if (
      phase === "recovered" &&
      input.authority !== "auth-session" &&
      this.isStaging()
    ) {
      await this.ctx.storage.onNextSessionRestoreBookmark(
        existing.injectionBookmark,
      );
      this.ctx.abort("promotion PITR pre-injection-bookmark restore");
    }
    return current;
  }

  /**
   * Reapplies only the terminal fence Receipt after the actor has restored its
   * pre-injection bookmark. Business state must hash exactly as it did before
   * the fault; the independent controller is checked by the caller before the
   * public authority is reopened.
   */
  async finalizePromotionAuthorityAfterPitr(
    input: PromotionAuthorityFaultRecovery,
    expectedStateFingerprint: string,
  ): Promise<PromotionAuthorityFaultState> {
    if (
      !this.canFinalizePromotionPitr() ||
      !validIdentity(input) ||
      input.proof !== "recu-resistant-pitr" ||
      input.authority === "auth-session" ||
      !/^[0-9a-f]{64}$/u.test(expectedStateFingerprint)
    ) {
      throw new Error("invalid promotion authority PITR finalization");
    }
    const existing =
      await this.ctx.storage.get<StoredPromotionAuthorityFault>(STORAGE_KEY);
    if (existing !== undefined) {
      if (
        existing.current.phase === "recovered" &&
        sameIdentity(existing.identity, input) &&
        existing.current.stateFingerprint === expectedStateFingerprint
      ) {
        return existing.current;
      }
      throw new Error("promotion authority PITR resurrected a fault fence");
    }
    const restoredFingerprint = await this.promotionRecoveryFingerprint();
    if (restoredFingerprint !== expectedStateFingerprint) {
      throw new Error("promotion authority PITR changed committed state");
    }
    const recoveries = PROMOTION_RECOVERY_PROOFS.map((proof, index) =>
      state(
        input,
        index + 1 === PROMOTION_RECOVERY_PROOFS.length
          ? "recovered"
          : "recovering",
        proof,
        index + 2,
        restoredFingerprint,
      ),
    );
    const current = recoveries.at(-1);
    if (current === undefined) {
      throw new Error("promotion authority PITR receipt chain is empty");
    }
    await this.ctx.storage.sync();
    const injectionBookmark = await this.ctx.storage.getCurrentBookmark();
    await this.ctx.storage.put<StoredPromotionAuthorityFault>(STORAGE_KEY, {
      identity: input,
      current,
      recoveries,
      injectionBookmark,
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
