import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";
import type { DesktopDeliveryRecord } from "./rpc";

type DeliveryRow = Record<
  "session_token" | "punk_id" | "installation_hash" | "expires_at" | "status",
  string
>;

/**
 * Livraison de session desktop à usage unique (issue #54) : le callback
 * navigateur y dépose la session scellée pour exactement une installation
 * déclarée ; la consommation atomique par le client natif Rust est le seul
 * moyen de la retirer. Rejeu, expiration et installation divergente sont
 * refusés structurellement.
 */
export class DesktopDeliveryDO extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS desktop_delivery (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_token TEXT NOT NULL,
        punk_id TEXT NOT NULL,
        installation_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'consumed'))
      ) STRICT
    `);
  }

  async create(record: DesktopDeliveryRecord): Promise<boolean> {
    if (
      this.row() !== undefined ||
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO desktop_delivery
        (singleton, session_token, punk_id, installation_hash, expires_at, status)
       VALUES (1, ?, ?, ?, ?, 'open')`,
      record.sessionToken,
      record.punkId,
      record.installationHash,
      record.expiresAt,
    );
    let indexed = false;
    try {
      indexed = await this.env.PUNKS.getByName(
        record.punkId,
      ).recordAccountMergeHandoff({
        handoffId: this.ctx.id.name ?? "",
        punkId: record.punkId,
        kind: "desktop-auth-flow",
        state: "deliverable",
        expiresAt: record.expiresAt,
      });
    } catch {
      // A possible stale remote marker is conservative and will be removed
      // when planning revalidates it against this absent source authority.
    }
    if (!indexed) {
      this.ctx.storage.sql.exec(
        "DELETE FROM desktop_delivery WHERE singleton = 1",
      );
      return false;
    }
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(record.expiresAt)));
    return true;
  }

  /** Reads the exact active handoff without hiding storage failures. */
  readForAccountMerge(): {
    punkId: string;
    kind: "desktop-auth-flow";
    state: "deliverable";
    expiresAt: string;
  } | null {
    const row = this.row();
    if (
      row === undefined ||
      row.status !== "open" ||
      Date.parse(String(row.expires_at)) <= Date.now()
    ) {
      return null;
    }
    return {
      punkId: String(row.punk_id),
      kind: "desktop-auth-flow",
      state: "deliverable",
      expiresAt: String(row.expires_at),
    };
  }

  /** Consommation atomique : open + non expirée + installation attendue. */
  async consume(installationHash: string): Promise<
    | { ok: true; record: DesktopDeliveryRecord }
    | {
        ok: false;
        code: "missing" | "expired" | "installation_mismatch" | "consumed";
      }
  > {
    const row = this.row();
    if (row === undefined) {
      return { ok: false, code: "missing" };
    }
    if (row.status !== "open") {
      return { ok: false, code: "consumed" };
    }
    if (Date.parse(String(row.expires_at)) <= Date.now()) {
      return { ok: false, code: "expired" };
    }
    if (String(row.installation_hash) !== installationHash) {
      return { ok: false, code: "installation_mismatch" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE desktop_delivery SET status = 'consumed' WHERE singleton = 1",
    );
    await this.env.PUNKS.getByName(
      String(row.punk_id),
    ).removeAccountMergeHandoff(this.ctx.id.name ?? "");
    return {
      ok: true,
      record: {
        sessionToken: String(row.session_token),
        punkId: String(row.punk_id),
        installationHash: String(row.installation_hash),
        expiresAt: String(row.expires_at),
      },
    };
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row !== undefined) {
      await this.env.PUNKS.getByName(
        String(row.punk_id),
      ).removeAccountMergeHandoff(this.ctx.id.name ?? "");
    }
    await this.ctx.storage.deleteAll();
  }

  private row(): DeliveryRow | undefined {
    return this.ctx.storage.sql
      .exec<DeliveryRow>("SELECT * FROM desktop_delivery WHERE singleton = 1")
      .toArray()[0];
  }
}
