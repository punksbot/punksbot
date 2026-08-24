import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { DurableObject } from "cloudflare:workers";

import { base64UrlToBytes } from "./crypto";
import type { AuthEnv } from "./env";

type CredentialRow = Record<
  | "credential_id"
  | "punk_id"
  | "subject_hash"
  | "public_key"
  | "counter"
  | "transports_json"
  | "device_type"
  | "backed_up"
  | "status"
  | "transaction_id"
  | "pending_ceremony_id"
  | "attempts"
  | "created_at"
  | "updated_at",
  string | number | null
>;

export type ReservePasskeyResult =
  | { ok: true; replayed: boolean }
  | { ok: false; ownerPunkId: string };

export type VerifyPasskeyResult =
  | { ok: true; punkId: string; subjectHash: string }
  | {
      ok: false;
      code: "missing" | "pending" | "in_progress" | "invalid_assertion";
    };

export class PasskeyCredentialDO extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS passkey_credential (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        credential_id TEXT NOT NULL,
        punk_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL,
        transports_json TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
        backed_up INTEGER NOT NULL CHECK (backed_up IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
        transaction_id TEXT NOT NULL,
        pending_ceremony_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
  }

  reserve(input: {
    credentialId: string;
    punkId: string;
    subjectHash: string;
    publicKey: string;
    counter: number;
    transports: AuthenticatorTransportFuture[];
    deviceType: "singleDevice" | "multiDevice";
    backedUp: boolean;
    transactionId: string;
    now: string;
  }): ReservePasskeyResult {
    const row = this.row();
    if (row === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO passkey_credential
          (singleton, credential_id, punk_id, subject_hash, public_key, counter,
           transports_json, device_type, backed_up, status, transaction_id,
           pending_ceremony_id, attempts, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, ?, ?)`,
        input.credentialId,
        input.punkId,
        input.subjectHash,
        input.publicKey,
        input.counter,
        JSON.stringify(input.transports),
        input.deviceType,
        input.backedUp ? 1 : 0,
        input.transactionId,
        input.now,
        input.now,
      );
      this.scheduleAlarm(1_000);
      return { ok: true, replayed: false };
    }
    if (
      row.credential_id === input.credentialId &&
      row.punk_id === input.punkId &&
      (row.status === "active" || row.transaction_id === input.transactionId)
    ) {
      return { ok: true, replayed: true };
    }
    return { ok: false, ownerPunkId: String(row.punk_id) };
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
      "UPDATE passkey_credential SET status = 'active', updated_at = ? WHERE singleton = 1",
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
    this.ctx.storage.sql.exec(
      "DELETE FROM passkey_credential WHERE singleton = 1",
    );
    return true;
  }

  async verifyAuthentication(input: {
    ceremonyId: string;
    challenge: string;
    origin: string;
    rpId: string;
    response: AuthenticationResponseJSON;
  }): Promise<VerifyPasskeyResult> {
    const row = this.row();
    if (row === undefined) {
      return { ok: false, code: "missing" };
    }
    if (row.status !== "active") {
      return { ok: false, code: "pending" };
    }
    if (row.pending_ceremony_id !== null) {
      return { ok: false, code: "in_progress" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE passkey_credential SET pending_ceremony_id = ?, updated_at = ? WHERE singleton = 1",
      input.ceremonyId,
      new Date().toISOString(),
    );
    this.scheduleAlarm(30_000);
    try {
      const verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: input.challenge,
        expectedOrigin: input.origin,
        expectedRPID: input.rpId,
        credential: {
          id: String(row.credential_id),
          publicKey: base64UrlToBytes(String(row.public_key)),
          counter: Number(row.counter),
          transports: JSON.parse(
            String(row.transports_json),
          ) as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
      if (
        !verification.verified ||
        !verification.authenticationInfo.userVerified
      ) {
        throw new Error("Passkey assertion was not user-verified");
      }
      this.ctx.storage.sql.exec(
        `UPDATE passkey_credential
         SET counter = ?, backed_up = ?, pending_ceremony_id = NULL, updated_at = ?
         WHERE singleton = 1 AND pending_ceremony_id = ?`,
        verification.authenticationInfo.newCounter,
        verification.authenticationInfo.credentialBackedUp ? 1 : 0,
        new Date().toISOString(),
        input.ceremonyId,
      );
      return {
        ok: true,
        punkId: String(row.punk_id),
        subjectHash: String(row.subject_hash),
      };
    } catch {
      this.ctx.storage.sql.exec(
        `UPDATE passkey_credential
         SET pending_ceremony_id = NULL, updated_at = ?
         WHERE singleton = 1 AND pending_ceremony_id = ?`,
        new Date().toISOString(),
        input.ceremonyId,
      );
      return { ok: false, code: "invalid_assertion" };
    }
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row === undefined) {
      return;
    }
    if (row.status === "active") {
      if (
        row.pending_ceremony_id !== null &&
        Date.now() - Date.parse(String(row.updated_at)) >= 25_000
      ) {
        this.ctx.storage.sql.exec(
          `UPDATE passkey_credential
           SET pending_ceremony_id = NULL, updated_at = ?
           WHERE singleton = 1`,
          new Date().toISOString(),
        );
      }
      return;
    }
    const punk = this.env.PUNKS.getByName(String(row.punk_id));
    if (await punk.hasPasskey(String(row.subject_hash))) {
      this.activate({
        punkId: String(row.punk_id),
        transactionId: String(row.transaction_id),
      });
      return;
    }
    const age = Date.now() - Date.parse(String(row.created_at));
    if (age >= 10 * 60_000) {
      this.ctx.storage.sql.exec(
        "DELETE FROM passkey_credential WHERE singleton = 1",
      );
      return;
    }
    const attempts = Number(row.attempts) + 1;
    this.ctx.storage.sql.exec(
      "UPDATE passkey_credential SET attempts = ?, updated_at = ? WHERE singleton = 1",
      attempts,
      new Date().toISOString(),
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private row(): CredentialRow | undefined {
    return this.ctx.storage.sql
      .exec<CredentialRow>(
        "SELECT * FROM passkey_credential WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private scheduleAlarm(delayMs: number): void {
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + delayMs));
  }
}
