import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";

export interface PasskeyCeremony {
  purpose: "registration" | "authentication";
  challenge: string;
  browserBindingHash: string;
  punkId: string | null;
  sessionId: string | null;
  createdAt: string;
  expiresAt: string;
}

type CeremonyRow = Record<"status" | "ceremony_json", string>;

export type BeginCeremonyResult =
  | { ok: true; ceremony: PasskeyCeremony }
  | {
      ok: false;
      code: "missing" | "expired" | "binding_mismatch" | "consumed";
    };

export class PasskeyCeremonyDO extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS passkey_ceremony (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        status TEXT NOT NULL CHECK (status IN ('open', 'consumed')),
        ceremony_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  }

  async create(ceremony: PasskeyCeremony): Promise<boolean> {
    if (
      this.row() !== undefined ||
      Date.parse(ceremony.expiresAt) <= Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO passkey_ceremony (singleton, status, ceremony_json, updated_at)
       VALUES (1, 'open', ?, ?)`,
      JSON.stringify(ceremony),
      ceremony.createdAt,
    );
    if (ceremony.punkId !== null) {
      let indexed = false;
      try {
        indexed = await this.env.PUNKS.getByName(
          ceremony.punkId,
        ).recordAccountMergeHandoff({
          handoffId: this.ctx.id.name ?? "",
          punkId: ceremony.punkId,
          kind: "passkey-ceremony",
          state: "pending",
          expiresAt: ceremony.expiresAt,
        });
      } catch {
        // A possibly committed remote write may remain as a fail-closed conflict.
      }
      if (!indexed) {
        this.ctx.storage.sql.exec(
          "DELETE FROM passkey_ceremony WHERE singleton = 1",
        );
        return false;
      }
    }
    this.ctx.waitUntil(
      this.ctx.storage.setAlarm(Date.parse(ceremony.expiresAt)),
    );
    return true;
  }

  async begin(bindingHash: string): Promise<BeginCeremonyResult> {
    const row = this.row();
    if (row === undefined) {
      return { ok: false, code: "missing" };
    }
    if (row.status !== "open") {
      return { ok: false, code: "consumed" };
    }
    const ceremony = JSON.parse(row.ceremony_json) as PasskeyCeremony;
    if (Date.parse(ceremony.expiresAt) <= Date.now()) {
      this.ctx.storage.sql.exec(
        "DELETE FROM passkey_ceremony WHERE singleton = 1",
      );
      return { ok: false, code: "expired" };
    }
    if (ceremony.browserBindingHash !== bindingHash) {
      return { ok: false, code: "binding_mismatch" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE passkey_ceremony SET status = 'consumed', updated_at = ? WHERE singleton = 1",
      new Date().toISOString(),
    );
    if (ceremony.punkId !== null) {
      let prepared = false;
      try {
        prepared = await this.env.PUNKS.getByName(
          ceremony.punkId,
        ).recordAccountMergeHandoff({
          handoffId: this.ctx.id.name ?? "",
          punkId: ceremony.punkId,
          kind: "passkey-ceremony",
          state: "prepared",
          expiresAt: ceremony.expiresAt,
        });
      } catch {
        // The existing pending index remains fail-closed until expiry.
      }
      if (!prepared) {
        return { ok: false, code: "consumed" };
      }
    }
    return { ok: true, ceremony };
  }

  /** Reads the exact active handoff without hiding storage failures. */
  readForAccountMerge(): {
    punkId: string;
    kind: "passkey-ceremony";
    state: "pending" | "prepared";
    expiresAt: string;
  } | null {
    const row = this.row();
    if (row === undefined) return null;
    const ceremony = JSON.parse(row.ceremony_json) as PasskeyCeremony;
    if (
      ceremony.punkId === null ||
      Date.parse(ceremony.expiresAt) <= Date.now()
    ) {
      return null;
    }
    return {
      punkId: ceremony.punkId,
      kind: "passkey-ceremony",
      state: row.status === "open" ? "pending" : "prepared",
      expiresAt: ceremony.expiresAt,
    };
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row !== undefined) {
      try {
        const ceremony = JSON.parse(row.ceremony_json) as PasskeyCeremony;
        if (ceremony.punkId !== null) {
          await this.env.PUNKS.getByName(
            ceremony.punkId,
          ).removeAccountMergeHandoff(this.ctx.id.name ?? "");
        }
      } catch {
        // The terminal delete below remains fail-closed for corrupt state.
      }
    }
    await this.ctx.storage.deleteAll();
  }

  private row(): CeremonyRow | undefined {
    return this.ctx.storage.sql
      .exec<CeremonyRow>(
        "SELECT status, ceremony_json FROM passkey_ceremony WHERE singleton = 1",
      )
      .toArray()[0];
  }
}
