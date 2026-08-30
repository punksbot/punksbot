import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";
import { canonicalJson, sha256Hex } from "@punks/core";

import type { AuthEnv } from "./env";
import type { SessionRecord } from "./rpc";

type SessionRow = Record<
  | "session_id"
  | "punk_id"
  | "authenticated_at"
  | "expires_at"
  | "recent_reauth_until"
  | "client_kind"
  | "status",
  string | null
>;

const LAST_RENEWED_AT_KEY = "last_renewed_at";
const PENDING_RENEWAL_KEY = "pending_renewal_command";
const ACCOUNT_MERGE_REAUTH_KEY = "account_merge_reauth_v1";

interface AccountMergeReauthentication {
  authenticationMethod: "google" | "github";
  providerSubjectBindingHash: string;
  authenticatedAt: string;
  expiresAt: string;
}

type AccountMergeClaimRow = Record<"intent_id" | "account_role", string>;

export class SessionDO extends PromotionFaultableDurableObject<AuthEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const current = this.row();
    if (current === undefined)
      throw new Error("promotion Session target is missing");
    return sha256Hex(canonicalJson(current));
  }

  protected override async invalidatePromotionSessionForRecovery(): Promise<void> {
    const current = this.row();
    if (current === undefined) {
      throw new Error("promotion Session target is missing");
    }
    if (current.status !== "revoked" && !(await this.revoke())) {
      throw new Error("promotion Session could not be revoked for recovery");
    }
    if (this.row()?.status !== "revoked") {
      throw new Error("promotion Session remained active after recovery");
    }
  }

  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth_session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL,
        punk_id TEXT NOT NULL,
        authenticated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        recent_reauth_until TEXT,
        client_kind TEXT NOT NULL DEFAULT 'browser'
          CHECK (client_kind IN ('browser', 'desktop', 'mobile', 'api')),
        status TEXT NOT NULL CHECK (status IN ('prepared', 'active', 'revoked')),
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_reauth_claim (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        intent_id TEXT NOT NULL,
        account_role TEXT NOT NULL
          CHECK (account_role IN ('survivor', 'absorbed')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'consumed'))
      ) STRICT
    `);
    const initialSessionColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(auth_session)")
      .toArray();
    if (
      !initialSessionColumns.some((column) => column.name === "client_kind")
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE auth_session ADD COLUMN client_kind TEXT NOT NULL
         DEFAULT 'browser' CHECK (client_kind IN ('browser', 'desktop', 'mobile', 'api'))`,
      );
    }
    const sessionTableSql = this.ctx.storage.sql
      .exec<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_session'",
      )
      .toArray()[0]?.sql;
    if (
      sessionTableSql !== undefined &&
      !sessionTableSql.includes("'prepared'")
    ) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE auth_session RENAME TO auth_session_before_prepared;
        CREATE TABLE auth_session (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          session_id TEXT NOT NULL,
          punk_id TEXT NOT NULL,
          authenticated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          recent_reauth_until TEXT,
          client_kind TEXT NOT NULL DEFAULT 'browser'
            CHECK (client_kind IN ('browser', 'desktop', 'mobile', 'api')),
          status TEXT NOT NULL CHECK (status IN ('prepared', 'active', 'revoked')),
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO auth_session
          (singleton, session_id, punk_id, authenticated_at, expires_at,
           recent_reauth_until, client_kind, status, updated_at)
        SELECT singleton, session_id, punk_id, authenticated_at, expires_at,
               recent_reauth_until, client_kind, status, updated_at
        FROM auth_session_before_prepared;
        DROP TABLE auth_session_before_prepared
      `);
    }
    const claimColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(account_merge_reauth_claim)")
      .toArray();
    if (!claimColumns.some((column) => column.name === "status")) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE account_merge_reauth_claim ADD COLUMN status TEXT
         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed'))`,
      );
    }
  }

  async create(
    session: SessionRecord,
    clientKind: "browser" | "desktop" | "mobile" | "api" = "browser",
    status: "prepared" | "active" = "active",
    lastRenewedAt?: string,
  ): Promise<boolean> {
    if (
      this.row() !== undefined ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO auth_session
        (singleton, session_id, punk_id, authenticated_at, expires_at,
         recent_reauth_until, client_kind, status, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.sessionId,
      session.punkId,
      session.authenticatedAt,
      session.expiresAt,
      session.recentReauthUntil,
      clientKind,
      status,
      session.authenticatedAt,
    );
    if (lastRenewedAt !== undefined) {
      await this.ctx.storage.put(LAST_RENEWED_AT_KEY, lastRenewedAt);
    }
    if (status === "prepared") {
      this.ctx.waitUntil(
        this.ctx.storage.setAlarm(Date.parse(session.expiresAt)),
      );
      return true;
    }
    let indexed = false;
    try {
      indexed = await this.env.PUNKS.getByName(
        session.punkId,
      ).recordAccountMergeSession({ ...session, clientKind });
    } catch {
      // The local Session must never survive an ambiguous index write. A
      // possible stale remote coordinate is safe: planning revalidates it
      // against this authority and removes it when the Session is absent.
      this.ctx.storage.sql.exec("DELETE FROM auth_session WHERE singleton = 1");
      return false;
    }
    if (!indexed) {
      this.ctx.storage.sql.exec("DELETE FROM auth_session WHERE singleton = 1");
      return false;
    }
    this.ctx.waitUntil(
      this.ctx.storage.setAlarm(Date.parse(session.expiresAt)),
    );
    return true;
  }

  async get(): Promise<SessionRecord | null> {
    if (!(await this.promotionAuthorityIsAvailable())) return null;
    try {
      return this.readForAccountMerge();
    } catch {
      return null;
    }
  }

  /**
   * Returns only the Punk coordinate for terminal alias recovery. This never
   * makes a revoked, expired, or prepared Session active again.
   */
  readPunkIdForTerminalResolution(sessionId: string): string | null {
    const row = this.row();
    return row !== undefined && row.session_id === sessionId
      ? String(row.punk_id)
      : null;
  }

  /** Reads a prepared or active Session only for the native delivery protocol. */
  readForDesktopDelivery(): {
    record: SessionRecord;
    status: "prepared" | "active";
    clientKind: "browser" | "desktop" | "mobile" | "api";
  } | null {
    const row = this.row();
    if (
      row === undefined ||
      (row.status !== "prepared" && row.status !== "active") ||
      Date.parse(String(row.expires_at)) <= Date.now()
    ) {
      return null;
    }
    return {
      record: {
        sessionId: String(row.session_id),
        punkId: String(row.punk_id),
        authenticatedAt: String(row.authenticated_at),
        expiresAt: String(row.expires_at),
        recentReauthUntil:
          row.recent_reauth_until === null
            ? null
            : String(row.recent_reauth_until),
      },
      status: row.status,
      clientKind: String(row.client_kind) as
        | "browser"
        | "desktop"
        | "mobile"
        | "api",
    };
  }

  /** Activates exactly one prepared Session after native confirmation. */
  async activatePrepared(sessionId: string): Promise<boolean> {
    const delivery = this.readForDesktopDelivery();
    if (delivery === null || delivery.record.sessionId !== sessionId) {
      return false;
    }
    if (delivery.status === "active") return true;
    let indexed = false;
    try {
      indexed = await this.env.PUNKS.getByName(
        delivery.record.punkId,
      ).recordAccountMergeSession({
        ...delivery.record,
        clientKind: delivery.clientKind,
      });
    } catch {
      return false;
    }
    if (!indexed) return false;
    return (
      this.ctx.storage.sql.exec(
        `UPDATE auth_session SET status = 'active', updated_at = ?
         WHERE singleton = 1 AND status = 'prepared'`,
        new Date().toISOString(),
      ).rowsWritten === 1
    );
  }

  /** Reserves one due rotation command without extending this Session in place. */
  async beginRenewal(input: {
    commandId: string;
    now: number;
    thresholdSeconds: number;
    minIntervalSeconds: number;
  }): Promise<
    | { ok: true; record: SessionRecord }
    | {
        ok: false;
        code: "inactive" | "not_due" | "too_recent" | "in_progress";
      }
  > {
    const row = this.row();
    if (
      row === undefined ||
      row.status !== "active" ||
      Date.parse(String(row.expires_at)) <= input.now
    ) {
      return { ok: false, code: "inactive" };
    }
    if (
      (Date.parse(String(row.expires_at)) - input.now) / 1_000 >=
      input.thresholdSeconds
    ) {
      return { ok: false, code: "not_due" };
    }
    const lastRenewedAt =
      await this.ctx.storage.get<string>(LAST_RENEWED_AT_KEY);
    if (
      lastRenewedAt !== undefined &&
      input.now - Date.parse(lastRenewedAt) < input.minIntervalSeconds * 1_000
    ) {
      return { ok: false, code: "too_recent" };
    }
    const pending = await this.ctx.storage.get<string>(PENDING_RENEWAL_KEY);
    if (pending !== undefined && pending !== input.commandId) {
      return { ok: false, code: "in_progress" };
    }
    if (pending === undefined) {
      await this.ctx.storage.put(PENDING_RENEWAL_KEY, input.commandId);
    }
    return {
      ok: true,
      record: {
        sessionId: String(row.session_id),
        punkId: String(row.punk_id),
        authenticatedAt: String(row.authenticated_at),
        expiresAt: String(row.expires_at),
        recentReauthUntil:
          row.recent_reauth_until === null
            ? null
            : String(row.recent_reauth_until),
      },
    };
  }

  async clearRenewal(commandId: string): Promise<void> {
    const pending = await this.ctx.storage.get<string>(PENDING_RENEWAL_KEY);
    if (pending === commandId) {
      await this.ctx.storage.delete(PENDING_RENEWAL_KEY);
    }
  }

  /** Reads this Session without hiding authority/storage failures. */
  readForAccountMerge(): SessionRecord | null {
    const row = this.row();
    if (
      row === undefined ||
      row.status !== "active" ||
      Date.parse(String(row.expires_at)) <= Date.now()
    ) {
      return null;
    }
    return {
      sessionId: String(row.session_id),
      punkId: String(row.punk_id),
      authenticatedAt: String(row.authenticated_at),
      expiresAt: String(row.expires_at),
      recentReauthUntil:
        row.recent_reauth_until === null
          ? null
          : String(row.recent_reauth_until),
    };
  }

  /** Records an exact five-minute OAuth provider reauthentication. */
  async markReauthenticated(options: {
    sessionId: string;
    punkId: string;
    until: string;
    authenticationMethod: "google" | "github";
    providerSubjectBindingHash: string;
  }): Promise<boolean> {
    const current = await this.get();
    const until = Date.parse(options.until);
    if (
      current === null ||
      current.sessionId !== options.sessionId ||
      current.punkId !== options.punkId ||
      !Number.isFinite(until) ||
      new Date(until).toISOString() !== options.until ||
      until <= Date.now() ||
      until - Date.now() > 5 * 60_000 ||
      (options.authenticationMethod !== "google" &&
        options.authenticationMethod !== "github") ||
      !/^[0-9a-f]{64}$/.test(options.providerSubjectBindingHash)
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      "UPDATE auth_session SET recent_reauth_until = ?, updated_at = ? WHERE singleton = 1",
      options.until,
      new Date().toISOString(),
    );
    this.ctx.storage.sql.exec("DELETE FROM account_merge_reauth_claim");
    const authenticatedAt = new Date(
      Date.parse(options.until) - 5 * 60_000,
    ).toISOString();
    await this.ctx.storage.put(ACCOUNT_MERGE_REAUTH_KEY, {
      authenticationMethod: options.authenticationMethod,
      providerSubjectBindingHash: options.providerSubjectBindingHash,
      authenticatedAt,
      expiresAt: options.until,
    } satisfies AccountMergeReauthentication);
    return true;
  }

  /** Returns the server-recorded fresh reauthentication bound to this Session. */
  async accountMergeProofContext(): Promise<
    | (AccountMergeReauthentication & { sessionId: string; punkId: string })
    | null
  > {
    const session = await this.get();
    const proof = await this.ctx.storage.get<AccountMergeReauthentication>(
      ACCOUNT_MERGE_REAUTH_KEY,
    );
    const authenticatedAt = Date.parse(proof?.authenticatedAt ?? "");
    const expiresAt = Date.parse(proof?.expiresAt ?? "");
    if (
      session === null ||
      proof === undefined ||
      session.recentReauthUntil !== proof.expiresAt ||
      (proof.authenticationMethod !== "google" &&
        proof.authenticationMethod !== "github") ||
      !/^[0-9a-f]{64}$/.test(proof.providerSubjectBindingHash) ||
      !Number.isFinite(authenticatedAt) ||
      !Number.isFinite(expiresAt) ||
      new Date(authenticatedAt).toISOString() !== proof.authenticatedAt ||
      new Date(expiresAt).toISOString() !== proof.expiresAt ||
      authenticatedAt > Date.now() ||
      expiresAt <= Date.now() ||
      expiresAt - authenticatedAt !== 5 * 60_000
    ) {
      return null;
    }
    return {
      ...proof,
      sessionId: session.sessionId,
      punkId: session.punkId,
    };
  }

  /** Claims this reauthentication for exactly one merge intent and role. */
  async claimAccountMergeProof(input: {
    intentId: string;
    accountRole: "survivor" | "absorbed";
  }): Promise<
    | (AccountMergeReauthentication & { sessionId: string; punkId: string })
    | null
  > {
    const context = await this.accountMergeProofContext();
    if (context === null) return null;
    const claimed = this.ctx.storage.transactionSync(() => {
      const existing = this.accountMergeClaim();
      if (existing !== undefined) {
        return (
          existing.intent_id === input.intentId &&
          existing.account_role === input.accountRole
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_reauth_claim
          (singleton, intent_id, account_role, status) VALUES (1, ?, ?, 'active')`,
        input.intentId,
        input.accountRole,
      );
      return true;
    });
    return claimed ? context : null;
  }

  /** Revalidates that this Session proof is still claimed by one intent. */
  async accountMergeClaimedProofContext(input: {
    intentId: string;
    accountRole: "survivor" | "absorbed";
  }): Promise<
    | (AccountMergeReauthentication & { sessionId: string; punkId: string })
    | null
  > {
    const claim = this.accountMergeClaim();
    return claim?.intent_id === input.intentId &&
      claim.account_role === input.accountRole &&
      claim.status === "active"
      ? this.accountMergeProofContext()
      : null;
  }

  /** Atomically consumes the claimed Session authorization before Plan commit. */
  async consumeAccountMergeProof(input: {
    intentId: string;
    accountRole: "survivor" | "absorbed";
    authenticationMethod: "google" | "github";
    providerSubjectBindingHash: string;
    authenticatedAt: string;
    expiresAt: string;
  }): Promise<boolean> {
    const context = await this.accountMergeProofContext();
    if (
      context === null ||
      context.authenticationMethod !== input.authenticationMethod ||
      context.providerSubjectBindingHash !== input.providerSubjectBindingHash ||
      context.authenticatedAt !== input.authenticatedAt ||
      context.expiresAt !== input.expiresAt
    ) {
      return false;
    }
    const consumed = this.ctx.storage.transactionSync(() => {
      const row = this.row();
      const claim = this.accountMergeClaim();
      if (
        row === undefined ||
        row.status !== "active" ||
        Date.parse(String(row.expires_at)) <= Date.now() ||
        claim?.intent_id !== input.intentId ||
        claim.account_role !== input.accountRole ||
        claim.status !== "active"
      ) {
        return false;
      }
      return (
        this.ctx.storage.sql.exec(
          `UPDATE account_merge_reauth_claim SET status = 'consumed'
           WHERE singleton = 1 AND status = 'active'`,
        ).rowsWritten === 1
      );
    });
    if (consumed) await this.ctx.storage.delete(ACCOUNT_MERGE_REAUTH_KEY);
    return consumed;
  }

  /**
   * Renouvellement glissant (issue #54) : étend la session à now + ttl
   * seulement si l'expiration restante est sous le seuil et si le dernier
   * renouvellement respecte l'intervalle minimal d'une fois par 24 heures.
   * La date du dernier renouvellement vit dans une clé de stockage dédiée —
   * le schéma SQL des objets existants n'est jamais migré.
   */
  async extend(policy: {
    now: number;
    ttlSeconds: number;
    thresholdSeconds: number;
    minIntervalSeconds: number;
  }): Promise<
    | { ok: true; record: SessionRecord }
    | {
        ok: false;
        code: "inactive" | "not_due" | "too_recent";
      }
  > {
    const row = this.row();
    if (row === undefined || row.status !== "active") {
      return { ok: false, code: "inactive" };
    }
    const expiresAtMs = Date.parse(String(row.expires_at));
    if (expiresAtMs <= policy.now) {
      return { ok: false, code: "inactive" };
    }
    const remainingSeconds = (expiresAtMs - policy.now) / 1_000;
    if (remainingSeconds >= policy.thresholdSeconds) {
      return { ok: false, code: "not_due" };
    }
    const lastRenewedAt =
      await this.ctx.storage.get<string>(LAST_RENEWED_AT_KEY);
    if (
      lastRenewedAt !== undefined &&
      policy.now - Date.parse(lastRenewedAt) < policy.minIntervalSeconds * 1_000
    ) {
      return { ok: false, code: "too_recent" };
    }
    const expiresAt = new Date(
      policy.now + policy.ttlSeconds * 1_000,
    ).toISOString();
    const renewedAt = new Date(policy.now).toISOString();
    if (
      !(await this.env.PUNKS.getByName(
        String(row.punk_id),
      ).recordAccountMergeSession({
        sessionId: String(row.session_id),
        punkId: String(row.punk_id),
        clientKind: String(row.client_kind) as
          | "browser"
          | "desktop"
          | "mobile"
          | "api",
        authenticatedAt: String(row.authenticated_at),
        expiresAt,
      }))
    ) {
      return { ok: false, code: "inactive" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE auth_session SET expires_at = ?, updated_at = ? WHERE singleton = 1",
      expiresAt,
      renewedAt,
    );
    await this.ctx.storage.put(LAST_RENEWED_AT_KEY, renewedAt);
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(expiresAt)));
    return {
      ok: true,
      record: {
        sessionId: String(row.session_id),
        punkId: String(row.punk_id),
        authenticatedAt: String(row.authenticated_at),
        expiresAt,
        recentReauthUntil:
          row.recent_reauth_until === null
            ? null
            : String(row.recent_reauth_until),
      },
    };
  }

  async revoke(): Promise<boolean> {
    const row = this.row();
    if (row === undefined || row.status === "revoked") {
      return false;
    }
    this.ctx.storage.sql.exec(
      "UPDATE auth_session SET status = 'revoked', updated_at = ? WHERE singleton = 1",
      new Date().toISOString(),
    );
    await this.ctx.storage.delete(ACCOUNT_MERGE_REAUTH_KEY);
    await this.ctx.storage.delete(PENDING_RENEWAL_KEY);
    this.ctx.storage.sql.exec("DELETE FROM account_merge_reauth_claim");
    await this.env.PUNKS.getByName(
      String(row.punk_id),
    ).removeAccountMergeSession(String(row.session_id));
    return true;
  }

  override async alarm(): Promise<void> {
    const row = this.row();
    if (row !== undefined) {
      await this.env.PUNKS.getByName(
        String(row.punk_id),
      ).removeAccountMergeSession(String(row.session_id));
    }
    await this.ctx.storage.deleteAll();
  }

  /** Reads current state and atomically retires matching legacy passkey freshness. */
  private row(): SessionRow | undefined {
    const row = this.ctx.storage.sql
      .exec<SessionRow>("SELECT * FROM auth_session WHERE singleton = 1")
      .toArray()[0];
    if (row !== undefined && row.recent_reauth_until !== null) {
      const proof = this.ctx.storage.kv.get<{
        authenticationMethod: unknown;
        expiresAt: unknown;
      }>(ACCOUNT_MERGE_REAUTH_KEY);
      if (
        proof?.authenticationMethod === "passkey" &&
        proof.expiresAt === row.recent_reauth_until
      ) {
        // Retire only the matching legacy freshness, never the Session itself
        // or an OAuth reauthentication recorded after that old proof.
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE auth_session SET recent_reauth_until = NULL WHERE singleton = 1",
          );
          this.ctx.storage.sql.exec("DELETE FROM account_merge_reauth_claim");
          this.ctx.storage.kv.delete(ACCOUNT_MERGE_REAUTH_KEY);
        });
        row.recent_reauth_until = null;
      }
    }
    return row;
  }

  private accountMergeClaim():
    | (AccountMergeClaimRow & { status: string })
    | undefined {
    return this.ctx.storage.sql
      .exec<AccountMergeClaimRow & { status: string }>(
        `SELECT intent_id, account_role, status FROM account_merge_reauth_claim
         WHERE singleton = 1`,
      )
      .toArray()[0];
  }
}
