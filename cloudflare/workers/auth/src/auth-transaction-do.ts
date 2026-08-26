import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";
import type { AuthTransaction } from "./rpc";

type TransactionRow = Record<"status" | "transaction_json", string>;

export type BeginTransactionResult =
  | { ok: true; transaction: AuthTransaction }
  | {
      ok: false;
      code: "missing" | "expired" | "binding_mismatch" | "consumed";
    };

export class AuthTransactionDO extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth_transaction (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        status TEXT NOT NULL CHECK (status IN ('open', 'consumed')),
        transaction_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  }

  async create(transaction: AuthTransaction): Promise<boolean> {
    const existing = this.row();
    if (existing !== undefined) {
      return (
        existing.status === "open" &&
        existing.transaction_json === JSON.stringify(transaction) &&
        Date.parse(transaction.expiresAt) > Date.now()
      );
    }
    if (Date.parse(transaction.expiresAt) <= Date.now()) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO auth_transaction (singleton, status, transaction_json, updated_at)
       VALUES (1, 'open', ?, ?)`,
      JSON.stringify(transaction),
      transaction.createdAt,
    );
    if (transaction.currentPunkId !== null) {
      let indexed = false;
      try {
        indexed = await this.env.PUNKS.getByName(
          transaction.currentPunkId,
        ).recordAccountMergeHandoff({
          handoffId: this.ctx.id.name ?? "",
          punkId: transaction.currentPunkId,
          kind:
            transaction.intent === "link"
              ? "account-link"
              : "oauth-transaction",
          state: "pending",
          expiresAt: transaction.expiresAt,
        });
      } catch {
        // A possibly committed remote write may remain as a fail-closed conflict.
      }
      if (!indexed) {
        this.ctx.storage.sql.exec(
          "DELETE FROM auth_transaction WHERE singleton = 1",
        );
        return false;
      }
    }
    this.ctx.waitUntil(
      this.ctx.storage.setAlarm(Date.parse(transaction.expiresAt)),
    );
    return true;
  }

  async begin(browserBindingHash: string): Promise<BeginTransactionResult> {
    const row = this.row();
    if (row === undefined) {
      return { ok: false, code: "missing" };
    }
    if (row.status !== "open") {
      return { ok: false, code: "consumed" };
    }
    const transaction = JSON.parse(row.transaction_json) as AuthTransaction;
    if (Date.parse(transaction.expiresAt) <= Date.now()) {
      this.ctx.storage.sql.exec(
        "DELETE FROM auth_transaction WHERE singleton = 1",
      );
      return { ok: false, code: "expired" };
    }
    if (transaction.browserBindingHash !== browserBindingHash) {
      return { ok: false, code: "binding_mismatch" };
    }
    return this.consume(transaction);
  }

  private async consume(
    transaction: AuthTransaction,
  ): Promise<BeginTransactionResult> {
    const consumed = this.ctx.storage.sql.exec(
      `UPDATE auth_transaction
       SET status = 'consumed', updated_at = ?
       WHERE singleton = 1 AND status = 'open'`,
      new Date().toISOString(),
    );
    if (consumed.rowsWritten !== 1) {
      return { ok: false, code: "consumed" };
    }
    if (transaction.currentPunkId !== null) {
      let prepared = false;
      try {
        prepared = await this.env.PUNKS.getByName(
          transaction.currentPunkId,
        ).recordAccountMergeHandoff({
          handoffId: this.ctx.id.name ?? "",
          punkId: transaction.currentPunkId,
          kind:
            transaction.intent === "link"
              ? "account-link"
              : "oauth-transaction",
          state: "prepared",
          expiresAt: transaction.expiresAt,
        });
      } catch {
        // The existing pending index remains fail-closed until expiry.
      }
      if (!prepared) {
        return { ok: false, code: "consumed" };
      }
    }
    return { ok: true, transaction };
  }

  /** Reads the exact active handoff without hiding storage failures. */
  readForAccountMerge(): {
    punkId: string;
    kind: "oauth-transaction" | "account-link";
    state: "pending" | "prepared";
    expiresAt: string;
  } | null {
    const row = this.row();
    if (row === undefined) return null;
    const transaction = JSON.parse(row.transaction_json) as AuthTransaction;
    if (
      transaction.currentPunkId === null ||
      Date.parse(transaction.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return {
      punkId: transaction.currentPunkId,
      kind:
        transaction.intent === "link" ? "account-link" : "oauth-transaction",
      state: row.status === "open" ? "pending" : "prepared",
      expiresAt: transaction.expiresAt,
    };
  }

  /** Cancels this exact active handoff after the merge point of no return. */
  async cancelForAccountMerge(input: {
    handoffId: string;
    punkId: string;
    kind: "oauth-transaction" | "account-link";
    state: "pending" | "prepared";
    expiresAt: string;
  }): Promise<boolean> {
    const current = this.readForAccountMerge();
    if (current === null) return true;
    if (
      input.handoffId !== this.ctx.id.name ||
      current.punkId !== input.punkId ||
      current.kind !== input.kind ||
      current.state !== input.state ||
      current.expiresAt !== input.expiresAt
    ) {
      return false;
    }
    await this.alarm();
    return this.readForAccountMerge() === null;
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row !== undefined) {
      try {
        const transaction = JSON.parse(row.transaction_json) as AuthTransaction;
        if (transaction.currentPunkId !== null) {
          await this.env.PUNKS.getByName(
            transaction.currentPunkId,
          ).removeAccountMergeHandoff(this.ctx.id.name ?? "");
        }
      } catch {
        // The terminal delete below remains fail-closed for corrupt state.
      }
    }
    await this.ctx.storage.deleteAll();
  }

  private row(): TransactionRow | undefined {
    return this.ctx.storage.sql
      .exec<TransactionRow>(
        "SELECT status, transaction_json FROM auth_transaction WHERE singleton = 1",
      )
      .toArray()[0];
  }
}
