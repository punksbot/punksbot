import type { AuthProviderProfile } from "@punks/contracts";
import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";
import type { ClaimResolution, ClaimResult } from "./rpc";

type ClaimRow = Record<
  | "provider"
  | "subject_hash"
  | "punk_id"
  | "transaction_id"
  | "status"
  | "attempts"
  | "created_at",
  string | number
>;

export class IdentityClaimDO extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS identity_claim (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'passkey')),
        subject_hash TEXT NOT NULL,
        punk_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  }

  resolve(): ClaimResolution {
    const row = this.row();
    return row === undefined
      ? { status: "missing" }
      : {
          status: String(row.status) as "pending" | "active",
          punkId: String(row.punk_id),
        };
  }

  claim(input: {
    provider: AuthProviderProfile["provider"];
    subjectHash: string;
    punkId: string;
    transactionId: string;
    now: string;
  }): ClaimResult {
    const row = this.row();
    if (row === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO identity_claim
          (singleton, provider, subject_hash, punk_id, transaction_id, status, attempts, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
        input.provider,
        input.subjectHash,
        input.punkId,
        input.transactionId,
        input.now,
        input.now,
      );
      this.scheduleAlarm(1_000);
      return { ok: true, replayed: false };
    }
    if (
      row.punk_id === input.punkId &&
      (row.status === "active" || row.transaction_id === input.transactionId)
    ) {
      return { ok: true, replayed: true };
    }
    return {
      ok: false,
      ownerPunkId: String(row.punk_id),
      status: String(row.status) as "pending" | "active",
    };
  }

  activate(input: { punkId: string; transactionId: string }): boolean {
    const row = this.row();
    if (
      row === undefined ||
      row.punk_id !== input.punkId ||
      (row.status === "pending" && row.transaction_id !== input.transactionId)
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      "UPDATE identity_claim SET status = 'active', updated_at = ? WHERE singleton = 1",
      new Date().toISOString(),
    );
    return true;
  }

  release(input: { punkId: string; transactionId: string }): boolean {
    const row = this.row();
    if (
      row === undefined ||
      row.status !== "pending" ||
      row.punk_id !== input.punkId ||
      row.transaction_id !== input.transactionId
    ) {
      return false;
    }
    this.ctx.storage.sql.exec("DELETE FROM identity_claim WHERE singleton = 1");
    return true;
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row === undefined || row.status === "active") {
      return;
    }
    const punk = this.env.PUNKS.getByName(String(row.punk_id));
    if (
      await punk.hasIdentity({
        provider: String(row.provider) as AuthProviderProfile["provider"],
        subjectHash: String(row.subject_hash),
      })
    ) {
      this.activate({
        punkId: String(row.punk_id),
        transactionId: String(row.transaction_id),
      });
      return;
    }
    const age = Date.now() - Date.parse(String(row.created_at));
    if (age >= 10 * 60_000) {
      this.ctx.storage.sql.exec(
        "DELETE FROM identity_claim WHERE singleton = 1",
      );
      return;
    }
    const attempts = Number(row.attempts) + 1;
    this.ctx.storage.sql.exec(
      "UPDATE identity_claim SET attempts = ?, updated_at = ? WHERE singleton = 1",
      attempts,
      new Date().toISOString(),
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private row(): ClaimRow | undefined {
    return this.ctx.storage.sql
      .exec<ClaimRow>("SELECT * FROM identity_claim WHERE singleton = 1")
      .toArray()[0];
  }

  private scheduleAlarm(delayMs: number): void {
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + delayMs));
  }
}
