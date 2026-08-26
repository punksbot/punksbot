import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";

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
const AUTHORITIES = new Set([
  "auth-punk",
  "auth-session-revocation",
  "auth-session",
  "api-workspace",
  "api-workspace-slug",
  "api-conversation",
  "api-message-content",
  "erasure-registry",
  "internal-event-signature",
]);
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const EXECUTION_RE = /^[a-z0-9][a-z0-9.:-]{0,299}$/u;
const RETENTION_MS = 15 * 60 * 1000;

export type PromotionFaultType = (typeof PROMOTION_FAULT_TYPES)[number];
export type PromotionRecoveryProof = (typeof PROMOTION_RECOVERY_PROOFS)[number];

export function isPromotionFaultType(
  value: string,
): value is PromotionFaultType {
  return (PROMOTION_FAULT_TYPES as readonly string[]).includes(value);
}

export function isPromotionRecoveryProof(
  value: string,
): value is PromotionRecoveryProof {
  return (PROMOTION_RECOVERY_PROOFS as readonly string[]).includes(value);
}

export function isPromotionFaultAuthority(value: string): boolean {
  return AUTHORITIES.has(value);
}

export function isPromotionFaultExecutionId(value: string): boolean {
  return EXECUTION_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsePromotionFaultIdentity(
  value: unknown,
): PromotionFaultIdentity | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.executionId !== "string" ||
    !isPromotionFaultExecutionId(value.executionId) ||
    typeof value.candidateSha !== "string" ||
    !SHA1_RE.test(value.candidateSha) ||
    typeof value.stagingDeploymentId !== "string" ||
    !DEPLOYMENT_RE.test(value.stagingDeploymentId) ||
    typeof value.type !== "string" ||
    !isPromotionFaultType(value.type) ||
    typeof value.authority !== "string" ||
    !isPromotionFaultAuthority(value.authority) ||
    !isRecord(value.target) ||
    JSON.stringify(Object.keys(value.target).sort()) !==
      JSON.stringify(["id", "kind"]) ||
    !["aggregate", "service"].includes(String(value.target.kind)) ||
    typeof value.target.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,299}$/u.test(value.target.id)
  ) {
    return null;
  }
  return {
    executionId: value.executionId,
    candidateSha: value.candidateSha,
    stagingDeploymentId: value.stagingDeploymentId,
    type: value.type,
    authority: value.authority,
    target: {
      kind: value.target.kind as "aggregate" | "service",
      id: value.target.id,
    },
  };
}

export interface PromotionFaultIdentity {
  executionId: string;
  candidateSha: string;
  stagingDeploymentId: string;
  type: PromotionFaultType;
  authority: string;
  target: { kind: "aggregate" | "service"; id: string };
}

export interface PromotionFaultRecoverInput extends PromotionFaultIdentity {
  proof: PromotionRecoveryProof;
}

export interface PromotionFaultReceipt extends PromotionFaultIdentity {
  schema: "punks.promotion-fault-receipt.v1";
  phase: "injected" | "recovering" | "recovered";
  proof: PromotionRecoveryProof | null;
  sequence: number;
  observedAt: string;
  replayed: boolean;
}

interface FaultRow extends Record<string, SqlStorageValue> {
  execution_id: string;
  candidate_sha: string;
  staging_deployment_id: string;
  fault_type: PromotionFaultType;
  authority: string;
  target_kind: "aggregate" | "service";
  target_id: string;
  phase: "injected" | "recovering" | "recovered";
  injected_at: string;
  updated_at: string;
}

interface RecoveryRow extends Record<string, SqlStorageValue> {
  proof: PromotionRecoveryProof;
  sequence: number;
  observed_at: string;
}

export type PromotionFaultProbeResult =
  | { status: "missing" }
  | ({
      status: "injected" | "recovering" | "recovered";
    } & PromotionFaultIdentity);

function sameIdentity(row: FaultRow, input: PromotionFaultIdentity): boolean {
  return (
    row.execution_id === input.executionId &&
    row.candidate_sha === input.candidateSha &&
    row.staging_deployment_id === input.stagingDeploymentId &&
    row.fault_type === input.type &&
    row.authority === input.authority &&
    row.target_kind === input.target.kind &&
    row.target_id === input.target.id
  );
}

export class PromotionFaultDO extends DurableObject<ApiEnv> {
  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS promotion_fault (
          execution_id TEXT PRIMARY KEY,
          candidate_sha TEXT NOT NULL,
          staging_deployment_id TEXT NOT NULL,
          fault_type TEXT NOT NULL,
          authority TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          target_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          injected_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS promotion_fault_recovery (
          proof TEXT PRIMARY KEY,
          sequence INTEGER NOT NULL UNIQUE,
          observed_at TEXT NOT NULL
        );
      `);
    });
  }

  private row(): FaultRow | null {
    return (
      this.ctx.storage.sql
        .exec<FaultRow>("SELECT * FROM promotion_fault LIMIT 1")
        .toArray()[0] ?? null
    );
  }

  private receipt(
    row: FaultRow,
    proof: PromotionRecoveryProof | null,
    sequence: number,
    observedAt: string,
    replayed: boolean,
  ): PromotionFaultReceipt {
    return {
      schema: "punks.promotion-fault-receipt.v1",
      executionId: row.execution_id,
      candidateSha: row.candidate_sha,
      stagingDeploymentId: row.staging_deployment_id,
      type: row.fault_type,
      authority: row.authority,
      target: { kind: row.target_kind, id: row.target_id },
      phase: row.phase,
      proof,
      sequence,
      observedAt,
      replayed,
    };
  }

  async inject(input: PromotionFaultIdentity): Promise<PromotionFaultReceipt> {
    if (parsePromotionFaultIdentity(input) === null)
      throw new Error("invalid promotion fault identity");
    const existing = this.row();
    if (existing !== null) {
      if (!sameIdentity(existing, input) || existing.phase === "recovered") {
        throw new Error(
          "promotion fault execution conflicts with durable state",
        );
      }
      return this.receipt(existing, null, 1, existing.injected_at, true);
    }
    const observedAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO promotion_fault (
        execution_id, candidate_sha, staging_deployment_id, fault_type,
        authority, target_kind, target_id, phase, injected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'injected', ?, ?)`,
      input.executionId,
      input.candidateSha,
      input.stagingDeploymentId,
      input.type,
      input.authority,
      input.target.kind,
      input.target.id,
      observedAt,
      observedAt,
    );
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
    const row = this.row();
    if (row === null)
      throw new Error("promotion fault disappeared after inject");
    return this.receipt(row, null, 1, observedAt, false);
  }

  async recover(
    input: PromotionFaultRecoverInput,
  ): Promise<PromotionFaultReceipt> {
    if (
      parsePromotionFaultIdentity(input) === null ||
      !isPromotionRecoveryProof(input.proof)
    ) {
      throw new Error("invalid promotion fault recovery");
    }
    const row = this.row();
    if (row === null || !sameIdentity(row, input)) {
      throw new Error("promotion fault recovery has no matching injection");
    }
    const recoveries = this.ctx.storage.sql
      .exec<RecoveryRow>(
        "SELECT proof, sequence, observed_at FROM promotion_fault_recovery ORDER BY sequence",
      )
      .toArray();
    const existing = recoveries.find(({ proof }) => proof === input.proof);
    if (existing !== undefined) {
      return this.receipt(
        row,
        input.proof,
        existing.sequence,
        existing.observed_at,
        true,
      );
    }
    const expectedProof = PROMOTION_RECOVERY_PROOFS[recoveries.length];
    if (expectedProof !== input.proof || row.phase === "recovered") {
      throw new Error("promotion fault recovery proof is out of order");
    }
    const sequence = recoveries.length + 2;
    const observedAt = new Date().toISOString();
    const phase =
      recoveries.length + 1 === PROMOTION_RECOVERY_PROOFS.length
        ? "recovered"
        : "recovering";
    this.ctx.storage.sql.exec(
      "INSERT INTO promotion_fault_recovery (proof, sequence, observed_at) VALUES (?, ?, ?)",
      input.proof,
      sequence,
      observedAt,
    );
    this.ctx.storage.sql.exec(
      "UPDATE promotion_fault SET phase = ?, updated_at = ? WHERE execution_id = ?",
      phase,
      observedAt,
      input.executionId,
    );
    if (phase === "recovered") {
      await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
    }
    const updated = this.row();
    if (updated === null)
      throw new Error("promotion fault disappeared during recovery");
    return this.receipt(updated, input.proof, sequence, observedAt, false);
  }

  probe(): PromotionFaultProbeResult {
    const row = this.row();
    if (row === null) return { status: "missing" };
    return {
      status: row.phase,
      executionId: row.execution_id,
      candidateSha: row.candidate_sha,
      stagingDeploymentId: row.staging_deployment_id,
      type: row.fault_type,
      authority: row.authority,
      target: { kind: row.target_kind, id: row.target_id },
    };
  }

  override alarm(): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM promotion_fault_recovery; DELETE FROM promotion_fault;",
    );
  }
}
