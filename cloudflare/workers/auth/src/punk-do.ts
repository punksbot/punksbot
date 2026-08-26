import type {
  AccountMergeReceipt,
  AuthProviderProfile,
  Punk,
  UpdatePunkProfileCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  canonicalPunkAvatarUrl,
  canonicalPunkDisplayName,
  sha256Hex,
} from "@punks/core";
import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";

import type { AuthEnv } from "./env";
import type { IdentityInput, PunkResult } from "./rpc";

type StateRow = Record<"state_json", string>;
type SessionInventoryRow = Record<
  "session_id" | "client_kind" | "authenticated_at" | "expires_at",
  string
>;
type HandoffInventoryRow = Record<
  "handoff_id" | "kind" | "state" | "expires_at",
  string
>;
type SessionInventoryCoverageRow = Record<"complete_after", string>;
type RightsInventoryRow = {
  workspace_id: string;
  role: string;
  revision: number;
};
type RightsInventoryCoverageRow = Record<"singleton", number>;
type RightsOperationRow = {
  workspace_id: string;
  punk_id: string;
  status: string;
  membership_role: string | null;
  membership_revision: number | null;
};
type ProfileCommandRow = Record<"payload_json" | "response_json", string>;
type AccountMergeOperationRow = Record<
  | "intent_id"
  | "plan_id"
  | "receipt_id"
  | "survivor_punk_id"
  | "absorbed_punk_id"
  | "account_role"
  | "status"
  | "applied_at",
  string | null
> &
  Record<"expected_revision", number>;

/** Typed result of the public Punk profile mutation. */
export type PunkProfileUpdateResult =
  | { ok: true; state: Punk; replayed: boolean }
  | {
      ok: false;
      code: "invalid_input" | "not_found" | "inactive" | "idempotency_conflict";
    }
  | { ok: false; code: "revision_conflict"; currentRevision: number };

/** Workspace roles that may participate in an Account Merge transfer. */
export type AccountMergeWorkspaceRole =
  | "owner"
  | "moderator"
  | "member"
  | "guest";

/** Coordinate for one prepared change to the authoritative rights index. */
export interface AccountMergeRightsChangeInput {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly punkId: string;
}

/** Final value for one previously prepared rights-index change. */
export interface CommitAccountMergeRightsChangeInput
  extends AccountMergeRightsChangeInput {
  readonly membership: {
    readonly role: AccountMergeWorkspaceRole;
    readonly revision: number;
  } | null;
}

/** Immutable coordinate shared by every fenced Punk merge effect. */
export interface PunkAccountMergeCoordinate {
  readonly intentId: string;
  readonly planId: string;
  readonly receiptId: string;
  readonly survivorPunkId: string;
  readonly absorbedPunkId: string;
}

/** Punk fence request bound to one role and one observed account revision. */
export interface PreparePunkAccountMergeInput
  extends PunkAccountMergeCoordinate {
  readonly accountRole: "survivor" | "absorbed";
  readonly expectedRevision: number;
}

/** Exact fenced Punk snapshot revalidated after preparation. */
export interface PreparedPunkAccountMergeSnapshot {
  readonly state: Punk;
  readonly inventory: PunkAccountMergeInventory;
}

/** Bounded authoritative Session and handoff index for one Compte Punks. */
export interface PunkAccountMergeInventory {
  readonly complete: boolean;
  readonly rights: readonly {
    workspaceId: string;
    role: AccountMergeWorkspaceRole;
    revision: number;
  }[];
  readonly sessions: readonly {
    sessionId: string;
    clientKind: "browser" | "desktop" | "mobile" | "api";
    authenticatedAt: string;
    expiresAt: string;
  }[];
  readonly handoffs: readonly {
    handoffId: string;
    kind:
      | "desktop-auth-flow"
      | "oauth-transaction"
      | "passkey-ceremony"
      | "reauth-authorization"
      | "session-renewal"
      | "account-link";
    state: "pending" | "prepared" | "deliverable";
    expiresAt: string;
  }[];
}

const MAX_ACCOUNT_MERGE_SESSIONS = 128;
const MAX_ACCOUNT_MERGE_HANDOFFS = 64;
const MAX_ACCOUNT_MERGE_RIGHTS = 256;
const MAX_PENDING_ACCOUNT_MERGE_RIGHTS_OPERATIONS = 64;
const MAX_TERMINAL_ACCOUNT_MERGE_RIGHTS_OPERATIONS = 256;
const MAX_WORKSPACE_REVISION = 2_147_483_647;
const MAX_PROFILE_COMMAND_RESULTS = 256;
const MAX_ACCOUNT_MERGE_OPERATION_RESULTS = 256;
const LEGACY_SESSION_COVERAGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const OPAQUE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function canonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function exactObjectKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validRightsChangeCoordinate(
  value: unknown,
): value is AccountMergeRightsChangeInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    exactObjectKeys(input, ["operationId", "punkId", "workspaceId"]) &&
    typeof input.operationId === "string" &&
    UUID.test(input.operationId) &&
    typeof input.workspaceId === "string" &&
    UUID.test(input.workspaceId) &&
    typeof input.punkId === "string" &&
    UUID.test(input.punkId)
  );
}

function validMembership(
  value: unknown,
): value is NonNullable<CommitAccountMergeRightsChangeInput["membership"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const membership = value as Record<string, unknown>;
  return (
    exactObjectKeys(membership, ["revision", "role"]) &&
    ["owner", "moderator", "member", "guest"].includes(
      String(membership.role),
    ) &&
    Number.isSafeInteger(membership.revision) &&
    Number(membership.revision) >= 1 &&
    Number(membership.revision) <= MAX_WORKSPACE_REVISION
  );
}

function validCommitRightsChange(
  value: unknown,
): value is CommitAccountMergeRightsChangeInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    exactObjectKeys(input, [
      "membership",
      "operationId",
      "punkId",
      "workspaceId",
    ]) &&
    validRightsChangeCoordinate({
      operationId: input.operationId,
      punkId: input.punkId,
      workspaceId: input.workspaceId,
    }) &&
    (input.membership === null || validMembership(input.membership))
  );
}

function validAccountMergeCoordinate(
  value: unknown,
): value is PunkAccountMergeCoordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    typeof input.intentId === "string" &&
    UUID.test(input.intentId) &&
    typeof input.planId === "string" &&
    UUID.test(input.planId) &&
    typeof input.receiptId === "string" &&
    UUID.test(input.receiptId) &&
    typeof input.survivorPunkId === "string" &&
    UUID.test(input.survivorPunkId) &&
    typeof input.absorbedPunkId === "string" &&
    UUID.test(input.absorbedPunkId) &&
    input.survivorPunkId !== input.absorbedPunkId
  );
}

function validPreparePunkAccountMergeInput(
  value: unknown,
  punkId: string | undefined,
): value is PreparePunkAccountMergeInput {
  if (!validAccountMergeCoordinate(value)) return false;
  const input = value as PreparePunkAccountMergeInput;
  return (
    exactObjectKeys(input, [
      "absorbedPunkId",
      "accountRole",
      "expectedRevision",
      "intentId",
      "planId",
      "receiptId",
      "survivorPunkId",
    ]) &&
    (input.accountRole === "survivor" || input.accountRole === "absorbed") &&
    Number.isSafeInteger(input.expectedRevision) &&
    input.expectedRevision >= 1 &&
    punkId ===
      (input.accountRole === "survivor"
        ? input.survivorPunkId
        : input.absorbedPunkId)
  );
}

function accountMergeOperationMatches(
  row: AccountMergeOperationRow,
  input: PunkAccountMergeCoordinate,
): boolean {
  return (
    row.intent_id === input.intentId &&
    row.plan_id === input.planId &&
    row.receipt_id === input.receiptId &&
    row.survivor_punk_id === input.survivorPunkId &&
    row.absorbed_punk_id === input.absorbedPunkId
  );
}

function identity(
  input: IdentityInput,
  linkedAt: string,
): Punk["identities"][number] {
  return {
    provider: input.profile.provider,
    subjectHash: input.subjectHash,
    emailHash: input.emailHash,
    verifiedEmail: input.profile.verifiedEmail.toLowerCase(),
    username: input.profile.username,
    credentialId: null,
    linkedAt,
  };
}

export class PunkDO extends PromotionFaultableDurableObject<AuthEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const current = await this.readForResolution();
    if (current === null) throw new Error("promotion Punk target is missing");
    return sha256Hex(canonicalJson(current));
  }

  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS punk_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_session_inventory (
        session_id TEXT PRIMARY KEY,
        client_kind TEXT NOT NULL
          CHECK (client_kind IN ('browser', 'desktop', 'mobile', 'api')),
        authenticated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_session_inventory_coverage (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        complete_after TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_rights_inventory (
        workspace_id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'member', 'guest')),
        revision INTEGER NOT NULL CHECK (revision >= 1)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_rights_inventory_coverage (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_rights_operations (
        operation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        punk_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'aborted')),
        membership_role TEXT CHECK (
          membership_role IS NULL OR
          membership_role IN ('owner', 'moderator', 'member', 'guest')
        ),
        membership_revision INTEGER CHECK (
          membership_revision IS NULL OR membership_revision >= 1
        )
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS account_merge_rights_pending_workspace
        ON account_merge_rights_operations (workspace_id)
        WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS account_merge_handoff_inventory (
        handoff_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN (
          'desktop-auth-flow', 'oauth-transaction', 'passkey-ceremony',
          'reauth-authorization', 'session-renewal', 'account-link'
        )),
        state TEXT NOT NULL CHECK (state IN ('pending', 'prepared', 'deliverable')),
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profile_command_results (
        command_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_operation (
        intent_id TEXT NOT NULL,
        plan_id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        survivor_punk_id TEXT NOT NULL,
        absorbed_punk_id TEXT NOT NULL,
        account_role TEXT NOT NULL CHECK (account_role IN ('survivor', 'absorbed')),
        expected_revision INTEGER NOT NULL CHECK (expected_revision >= 1),
        status TEXT NOT NULL CHECK (status IN ('prepared', 'applied')),
        applied_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS account_merge_single_prepared
        ON account_merge_operation (status) WHERE status = 'prepared';
    `);
  }

  async provision(input: {
    punkId: string;
    identity: IdentityInput;
    now: string;
  }): Promise<PunkResult> {
    if ((await this.accountMergeReceipt()) !== null) {
      return { ok: false, code: "inactive" };
    }
    if (this.accountMergePrepared()) {
      return { ok: false, code: "inactive" };
    }
    const current = this.state();
    if (current !== null) {
      if (
        current.identities.some(
          (item) =>
            item.provider === input.identity.profile.provider &&
            item.subjectHash === input.identity.subjectHash,
        )
      ) {
        return { ok: true, state: current, replayed: true };
      }
      return { ok: false, code: "identity_conflict" };
    }
    const next: Punk = {
      id: input.punkId,
      status: "active",
      displayName: input.identity.profile.displayName,
      avatarUrl: input.identity.profile.avatarUrl,
      identities: [identity(input.identity, input.now)],
      mergedInto: null,
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) {
      return { ok: false, code: "identity_conflict" };
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO punk_state (singleton, state_json) VALUES (1, ?)",
        JSON.stringify(next),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_session_inventory_coverage
          (singleton, complete_after) VALUES (1, ?)`,
        new Date().toISOString(),
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO account_merge_rights_inventory_coverage (singleton) VALUES (1)",
      );
    });
    return { ok: true, state: next, replayed: false };
  }

  async linkIdentity(input: {
    identity: IdentityInput;
    now: string;
  }): Promise<PunkResult> {
    if ((await this.accountMergeReceipt()) !== null) {
      return { ok: false, code: "inactive" };
    }
    if (this.accountMergePrepared()) {
      return { ok: false, code: "inactive" };
    }
    const current = this.state();
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    if (current.status !== "active") {
      return { ok: false, code: "inactive" };
    }
    const existing = current.identities.find(
      (item) =>
        item.provider === input.identity.profile.provider &&
        item.subjectHash === input.identity.subjectHash,
    );
    if (existing !== undefined) {
      return { ok: true, state: current, replayed: true };
    }
    const next: Punk = {
      ...current,
      identities: [...current.identities, identity(input.identity, input.now)],
      revision: current.revision + 1,
      updatedAt: input.now,
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) {
      return { ok: false, code: "identity_conflict" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
      JSON.stringify(next),
    );
    return { ok: true, state: next, replayed: false };
  }

  async linkPasskey(input: {
    credentialId: string;
    subjectHash: string;
    emailHash: string;
    now: string;
  }): Promise<PunkResult> {
    if ((await this.accountMergeReceipt()) !== null) {
      return { ok: false, code: "inactive" };
    }
    if (this.accountMergePrepared()) {
      return { ok: false, code: "inactive" };
    }
    const current = this.state();
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    if (current.status !== "active") {
      return { ok: false, code: "inactive" };
    }
    if (
      current.identities.some(
        (item) =>
          item.provider === "passkey" && item.subjectHash === input.subjectHash,
      )
    ) {
      return { ok: true, state: current, replayed: true };
    }
    const next: Punk = {
      ...current,
      identities: [
        ...current.identities,
        {
          provider: "passkey",
          subjectHash: input.subjectHash,
          emailHash: input.emailHash,
          verifiedEmail: null,
          username: null,
          credentialId: input.credentialId,
          linkedAt: input.now,
        },
      ],
      revision: current.revision + 1,
      updatedAt: input.now,
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) {
      return { ok: false, code: "identity_conflict" };
    }
    this.ctx.storage.sql.exec(
      "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
      JSON.stringify(next),
    );
    return { ok: true, state: next, replayed: false };
  }

  async query(): Promise<PunkResult> {
    if (!(await this.promotionAuthorityIsAvailable())) {
      return { ok: false, code: "inactive" };
    }
    if (this.state() === null) {
      return { ok: false, code: "not_found" };
    }
    const receipt = await this.accountMergeReceipt();
    const state = this.state();
    if (
      state === null ||
      state.status !== "active" ||
      this.accountMergePreparedAsAbsorbed() ||
      receipt !== null
    ) {
      return { ok: false, code: "inactive" };
    }
    return { ok: true, state, replayed: true };
  }

  /** Private authority read used only for bounded alias resolution. */
  async readForResolution(): Promise<Punk | null> {
    const initial = this.state();
    if (
      initial === null ||
      !validateContract("punks://contracts/punk@1", initial).valid
    ) {
      return null;
    }
    const receipt = await this.accountMergeReceipt();
    const state = this.state();
    if (
      state === null ||
      !validateContract("punks://contracts/punk@1", state).valid
    ) {
      return null;
    }
    if (state.status === "merged") {
      return receipt !== "unavailable" &&
        receipt !== null &&
        state.mergedInto === receipt.survivorPunkId
        ? state
        : null;
    }
    if (state.status !== "active") return state;
    if (receipt === "unavailable") return null;
    if (receipt === null) {
      return this.accountMergePreparedAsAbsorbed() ? null : state;
    }
    const alias: Punk = {
      ...state,
      status: "merged",
      mergedInto: receipt.survivorPunkId,
      revision: receipt.accountRevisions.absorbed + 1,
      updatedAt: receipt.committedAt,
    };
    return validateContract("punks://contracts/punk@1", alias).valid
      ? alias
      : null;
  }

  /** Applies one self-profile command atomically at its expected revision. */
  async updateProfile(input: unknown): Promise<PunkProfileUpdateResult> {
    if ((await this.accountMergeReceipt()) !== null) {
      return { ok: false, code: "inactive" };
    }
    if (this.accountMergePrepared()) {
      return { ok: false, code: "inactive" };
    }
    if (!validateContract("punks://contracts/punk.update@1", input).valid) {
      return { ok: false, code: "invalid_input" };
    }
    const command = input as UpdatePunkProfileCommand;
    let displayName: string;
    let avatarUrl: string | null;
    try {
      displayName = canonicalPunkDisplayName(command.displayName);
      avatarUrl = canonicalPunkAvatarUrl(command.avatarUrl);
    } catch {
      return { ok: false, code: "invalid_input" };
    }
    const payloadJson = canonicalJson({
      contract: command.contract,
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
      displayName,
      avatarUrl,
    });
    const receipt = this.ctx.storage.sql
      .exec<ProfileCommandRow>(
        `SELECT payload_json, response_json
         FROM profile_command_results WHERE command_id = ?`,
        command.commandId,
      )
      .toArray()[0];
    if (receipt !== undefined) {
      if (receipt.payload_json !== payloadJson) {
        return { ok: false, code: "idempotency_conflict" };
      }
      try {
        const state = JSON.parse(receipt.response_json) as Punk;
        return validateContract("punks://contracts/punk@1", state).valid
          ? { ok: true, state, replayed: true }
          : { ok: false, code: "inactive" };
      } catch {
        return { ok: false, code: "inactive" };
      }
    }

    const current = this.state();
    if (current === null) return { ok: false, code: "not_found" };
    if (current.status !== "active") return { ok: false, code: "inactive" };
    if (current.revision !== command.expectedRevision) {
      return {
        ok: false,
        code: "revision_conflict",
        currentRevision: current.revision,
      };
    }
    const next: Punk = {
      ...current,
      displayName,
      avatarUrl,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) {
      return { ok: false, code: "invalid_input" };
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(next),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO profile_command_results
          (command_id, payload_json, response_json, committed_at)
         VALUES (?, ?, ?, ?)`,
        command.commandId,
        payloadJson,
        JSON.stringify(next),
        next.updatedAt,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM profile_command_results
         WHERE rowid NOT IN (
           SELECT rowid FROM profile_command_results
           ORDER BY rowid DESC LIMIT ?
         )`,
        MAX_PROFILE_COMMAND_RESULTS,
      );
    });
    return { ok: true, state: next, replayed: false };
  }

  async hasIdentity(input: {
    provider: AuthProviderProfile["provider"];
    subjectHash: string;
  }): Promise<boolean> {
    if ((await this.accountMergeReceipt()) !== null) return false;
    return (
      this.state()?.identities.some(
        (item) =>
          item.provider === input.provider &&
          item.subjectHash === input.subjectHash,
      ) ?? false
    );
  }

  async hasVerifiedEmail(emailHash: string): Promise<boolean> {
    if ((await this.accountMergeReceipt()) !== null) return false;
    return (
      this.state()?.identities.some((item) => item.emailHash === emailHash) ??
      false
    );
  }

  async hasPasskey(subjectHash: string): Promise<boolean> {
    if ((await this.accountMergeReceipt()) !== null) return false;
    return (
      this.state()?.identities.some(
        (item) =>
          item.provider === "passkey" && item.subjectHash === subjectHash,
      ) ?? false
    );
  }

  async passkeyCredentialIds(): Promise<string[]> {
    if ((await this.accountMergeReceipt()) !== null) return [];
    return (this.state()?.identities ?? []).flatMap((item) =>
      item.provider === "passkey" && item.credentialId !== null
        ? [item.credentialId]
        : [],
    );
  }

  /** Registers one authoritative Session coordinate for future merge planning. */
  async recordAccountMergeSession(input: {
    sessionId: string;
    punkId: string;
    clientKind: "browser" | "desktop" | "mobile" | "api";
    authenticatedAt: string;
    expiresAt: string;
  }): Promise<boolean> {
    if (
      (await this.accountMergeReceipt()) !== null ||
      this.accountMergePrepared() ||
      input.punkId !== this.ctx.id.name ||
      !OPAQUE_UUID.test(input.sessionId) ||
      !["browser", "desktop", "mobile", "api"].includes(input.clientKind) ||
      typeof input.authenticatedAt !== "string" ||
      input.authenticatedAt.length === 0 ||
      input.authenticatedAt.length > 128 ||
      !canonicalTimestamp(input.expiresAt) ||
      Date.parse(input.expiresAt) <= Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO account_merge_session_inventory
        (session_id, client_kind, authenticated_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         client_kind = excluded.client_kind,
         authenticated_at = excluded.authenticated_at,
         expires_at = excluded.expires_at`,
      input.sessionId,
      input.clientKind,
      input.authenticatedAt,
      input.expiresAt,
    );
    return true;
  }

  /** Removes a Session coordinate after revocation or terminal expiry. */
  removeAccountMergeSession(sessionId: string): boolean {
    return (
      OPAQUE_UUID.test(sessionId) &&
      this.ctx.storage.sql.exec(
        "DELETE FROM account_merge_session_inventory WHERE session_id = ?",
        sessionId,
      ).rowsWritten === 1
    );
  }

  /** Registers one active, account-bound ceremony or delivery handoff. */
  async recordAccountMergeHandoff(input: {
    handoffId: string;
    punkId: string;
    kind: PunkAccountMergeInventory["handoffs"][number]["kind"];
    state: PunkAccountMergeInventory["handoffs"][number]["state"];
    expiresAt: string;
  }): Promise<boolean> {
    if (
      (await this.accountMergeReceipt()) !== null ||
      this.accountMergePrepared() ||
      input.punkId !== this.ctx.id.name ||
      !(UUID.test(input.handoffId) || OPAQUE_UUID.test(input.handoffId)) ||
      ![
        "desktop-auth-flow",
        "oauth-transaction",
        "passkey-ceremony",
        "reauth-authorization",
        "session-renewal",
        "account-link",
      ].includes(input.kind) ||
      !["pending", "prepared", "deliverable"].includes(input.state) ||
      !canonicalTimestamp(input.expiresAt) ||
      Date.parse(input.expiresAt) <= Date.now()
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO account_merge_handoff_inventory
        (handoff_id, kind, state, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(handoff_id) DO UPDATE SET
         kind = excluded.kind,
         state = excluded.state,
         expires_at = excluded.expires_at`,
      input.handoffId,
      input.kind,
      input.state,
      input.expiresAt,
    );
    return true;
  }

  /** Removes one handoff once its authority reaches a terminal state. */
  removeAccountMergeHandoff(handoffId: string): boolean {
    return (
      (UUID.test(handoffId) || OPAQUE_UUID.test(handoffId)) &&
      this.ctx.storage.sql.exec(
        "DELETE FROM account_merge_handoff_inventory WHERE handoff_id = ?",
        handoffId,
      ).rowsWritten === 1
    );
  }

  /** Prepares one exact Workspace membership index transition. */
  async prepareAccountMergeRightsChange(
    input: AccountMergeRightsChangeInput,
  ): Promise<boolean> {
    if (
      (await this.accountMergeReceipt()) !== null ||
      this.accountMergePrepared() ||
      !validRightsChangeCoordinate(input) ||
      input.punkId !== this.ctx.id.name ||
      this.state()?.status !== "active"
    ) {
      return false;
    }
    const existing = this.rightsOperation(input.operationId);
    if (existing !== undefined) {
      return (
        existing.workspace_id === input.workspaceId &&
        existing.punk_id === input.punkId
      );
    }
    const pendingCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM account_merge_rights_operations WHERE status = 'pending'`,
      )
      .one().count;
    if (pendingCount >= MAX_PENDING_ACCOUNT_MERGE_RIGHTS_OPERATIONS) {
      return false;
    }
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_rights_operations
          (operation_id, workspace_id, punk_id, status,
           membership_role, membership_revision)
         VALUES (?, ?, ?, 'pending', NULL, NULL)`,
        input.operationId,
        input.workspaceId,
        input.punkId,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Atomically applies one prepared Workspace membership index transition. */
  async commitAccountMergeRightsChange(
    input: CommitAccountMergeRightsChangeInput,
  ): Promise<boolean> {
    if (
      (await this.accountMergeReceipt()) !== null ||
      !validCommitRightsChange(input) ||
      input.punkId !== this.ctx.id.name ||
      this.state()?.status !== "active"
    ) {
      return false;
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const operation = this.rightsOperation(input.operationId);
        if (
          operation === undefined ||
          operation.workspace_id !== input.workspaceId ||
          operation.punk_id !== input.punkId ||
          operation.status === "aborted"
        ) {
          return false;
        }
        const membershipRole = input.membership?.role ?? null;
        const membershipRevision = input.membership?.revision ?? null;
        if (operation.status === "committed") {
          return (
            operation.membership_role === membershipRole &&
            operation.membership_revision === membershipRevision
          );
        }

        if (input.membership === null) {
          this.ctx.storage.sql.exec(
            "DELETE FROM account_merge_rights_inventory WHERE workspace_id = ?",
            input.workspaceId,
          );
        } else {
          const current = this.ctx.storage.sql
            .exec<RightsInventoryRow>(
              `SELECT workspace_id, role, revision
               FROM account_merge_rights_inventory WHERE workspace_id = ?`,
              input.workspaceId,
            )
            .toArray()[0];
          if (
            current !== undefined &&
            (current.revision > input.membership.revision ||
              (current.revision === input.membership.revision &&
                current.role !== input.membership.role))
          ) {
            return false;
          }
          if (
            current === undefined &&
            this.ctx.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM account_merge_rights_inventory",
              )
              .one().count >= MAX_ACCOUNT_MERGE_RIGHTS
          ) {
            return false;
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO account_merge_rights_inventory
              (workspace_id, role, revision) VALUES (?, ?, ?)
             ON CONFLICT(workspace_id) DO UPDATE SET
               role = excluded.role,
               revision = excluded.revision`,
            input.workspaceId,
            input.membership.role,
            input.membership.revision,
          );
        }
        this.ctx.storage.sql.exec(
          `UPDATE account_merge_rights_operations
           SET status = 'committed', membership_role = ?, membership_revision = ?
           WHERE operation_id = ? AND status = 'pending'`,
          membershipRole,
          membershipRevision,
          input.operationId,
        );
        this.trimTerminalRightsOperations();
        return true;
      });
    } catch {
      return false;
    }
  }

  /** Aborts one exact pending Workspace membership index transition. */
  abortAccountMergeRightsChange(input: AccountMergeRightsChangeInput): boolean {
    if (
      !validRightsChangeCoordinate(input) ||
      input.punkId !== this.ctx.id.name
    ) {
      return false;
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const operation = this.rightsOperation(input.operationId);
        if (
          operation === undefined ||
          operation.workspace_id !== input.workspaceId ||
          operation.punk_id !== input.punkId ||
          operation.status === "committed"
        ) {
          return false;
        }
        if (operation.status === "aborted") {
          return true;
        }
        this.ctx.storage.sql.exec(
          `UPDATE account_merge_rights_operations SET status = 'aborted'
           WHERE operation_id = ? AND status = 'pending'`,
          input.operationId,
        );
        this.trimTerminalRightsOperations();
        return true;
      });
    } catch {
      return false;
    }
  }

  /** Returns the bounded authoritative index used by account-merge planning. */
  async accountMergeInventory(): Promise<PunkAccountMergeInventory> {
    const state = this.state();
    if (
      state === null ||
      state.status !== "active" ||
      (await this.accountMergeReceipt()) !== null
    ) {
      return { complete: false, rights: [], sessions: [], handoffs: [] };
    }
    return this.currentAccountMergeInventory();
  }

  /** Fences every new account-scoped authority before the merge commit. */
  prepareAccountMerge(input: PreparePunkAccountMergeInput): boolean {
    if (!validPreparePunkAccountMergeInput(input, this.ctx.id.name)) {
      return false;
    }
    const existing = this.accountMergeOperation(input.planId);
    if (existing !== undefined) {
      return (
        accountMergeOperationMatches(existing, input) &&
        existing.account_role === input.accountRole &&
        existing.expected_revision === input.expectedRevision
      );
    }
    const state = this.state();
    if (
      state === null ||
      state.status !== "active" ||
      state.revision !== input.expectedRevision ||
      this.ctx.storage.sql
        .exec<{ operation_id: string }>(
          `SELECT operation_id FROM account_merge_rights_operations
           WHERE status = 'pending' LIMIT 1`,
        )
        .toArray()[0] !== undefined
    ) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO account_merge_operation
        (intent_id, plan_id, receipt_id, survivor_punk_id,
         absorbed_punk_id, account_role, expected_revision, status, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', NULL)`,
      input.intentId,
      input.planId,
      input.receiptId,
      input.survivorPunkId,
      input.absorbedPunkId,
      input.accountRole,
      input.expectedRevision,
    );
    return true;
  }

  /** Reads state and inventory atomically while the exact Punk fence is held. */
  readPreparedAccountMerge(
    input: PreparePunkAccountMergeInput,
  ): PreparedPunkAccountMergeSnapshot | null {
    if (!validPreparePunkAccountMergeInput(input, this.ctx.id.name)) {
      return null;
    }
    const operation = this.accountMergeOperation(input.planId);
    const state = this.state();
    if (
      operation === undefined ||
      operation.status !== "prepared" ||
      !accountMergeOperationMatches(operation, input) ||
      operation.account_role !== input.accountRole ||
      operation.expected_revision !== input.expectedRevision ||
      state === null ||
      state.status !== "active" ||
      state.revision !== input.expectedRevision
    ) {
      return null;
    }
    return { state, inventory: this.currentAccountMergeInventory() };
  }

  private currentAccountMergeInventory(): PunkAccountMergeInventory {
    const now = new Date().toISOString();
    const sessionInventoryComplete =
      this.accountMergeSessionInventoryComplete(now);
    const rightsInventoryComplete = this.accountMergeRightsInventoryComplete();
    const hasPendingRightsOperation =
      this.ctx.storage.sql
        .exec<{ operation_id: string }>(
          `SELECT operation_id FROM account_merge_rights_operations
           WHERE status = 'pending' LIMIT 1`,
        )
        .toArray()[0] !== undefined;
    this.ctx.storage.sql.exec(
      "DELETE FROM account_merge_session_inventory WHERE expires_at <= ?",
      now,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM account_merge_handoff_inventory WHERE expires_at <= ?",
      now,
    );
    const sessions = this.ctx.storage.sql
      .exec<SessionInventoryRow>(
        `SELECT session_id, client_kind, authenticated_at, expires_at
         FROM account_merge_session_inventory ORDER BY session_id
         LIMIT ?`,
        MAX_ACCOUNT_MERGE_SESSIONS + 1,
      )
      .toArray();
    const handoffs = this.ctx.storage.sql
      .exec<HandoffInventoryRow>(
        `SELECT handoff_id, kind, state, expires_at
         FROM account_merge_handoff_inventory ORDER BY handoff_id
         LIMIT ?`,
        MAX_ACCOUNT_MERGE_HANDOFFS + 1,
      )
      .toArray();
    const rights = this.ctx.storage.sql
      .exec<RightsInventoryRow>(
        `SELECT workspace_id, role, revision
         FROM account_merge_rights_inventory ORDER BY workspace_id
         LIMIT ?`,
        MAX_ACCOUNT_MERGE_RIGHTS + 1,
      )
      .toArray();
    const complete =
      sessionInventoryComplete &&
      rightsInventoryComplete &&
      !hasPendingRightsOperation &&
      sessions.length <= MAX_ACCOUNT_MERGE_SESSIONS &&
      handoffs.length <= MAX_ACCOUNT_MERGE_HANDOFFS &&
      rights.length <= MAX_ACCOUNT_MERGE_RIGHTS;
    return {
      complete,
      rights: rights.slice(0, MAX_ACCOUNT_MERGE_RIGHTS).map((row) => ({
        workspaceId: row.workspace_id,
        role: row.role as PunkAccountMergeInventory["rights"][number]["role"],
        revision: row.revision,
      })),
      sessions: sessions.slice(0, MAX_ACCOUNT_MERGE_SESSIONS).map((row) => ({
        sessionId: row.session_id,
        clientKind:
          row.client_kind as PunkAccountMergeInventory["sessions"][number]["clientKind"],
        authenticatedAt: row.authenticated_at,
        expiresAt: row.expires_at,
      })),
      handoffs: handoffs.slice(0, MAX_ACCOUNT_MERGE_HANDOFFS).map((row) => ({
        handoffId: row.handoff_id,
        kind: row.kind as PunkAccountMergeInventory["handoffs"][number]["kind"],
        state:
          row.state as PunkAccountMergeInventory["handoffs"][number]["state"],
        expiresAt: row.expires_at,
      })),
    };
  }

  /** Releases only a pre-commit fence; an applied merge can never be undone. */
  abortAccountMerge(input: PunkAccountMergeCoordinate): boolean {
    if (
      !validAccountMergeCoordinate(input) ||
      !exactObjectKeys(input, [
        "absorbedPunkId",
        "intentId",
        "planId",
        "receiptId",
        "survivorPunkId",
      ])
    ) {
      return false;
    }
    const operation = this.accountMergeOperation(input.planId);
    if (operation === undefined) return true;
    if (
      !accountMergeOperationMatches(operation, input) ||
      operation.status !== "prepared"
    ) {
      return false;
    }
    return (
      this.ctx.storage.sql.exec(
        "DELETE FROM account_merge_operation WHERE plan_id = ? AND status = 'prepared'",
        input.planId,
      ).rowsWritten === 1
    );
  }

  /** Applies one post-commit Workspace right while the Punk fence is held. */
  applyAccountMergeWorkspaceRight(
    input: PunkAccountMergeCoordinate & {
      workspaceId: string;
      membership: { role: AccountMergeWorkspaceRole; revision: number } | null;
    },
  ): boolean {
    if (
      !validAccountMergeCoordinate(input) ||
      !exactObjectKeys(input, [
        "absorbedPunkId",
        "intentId",
        "membership",
        "planId",
        "receiptId",
        "survivorPunkId",
        "workspaceId",
      ]) ||
      !UUID.test(input.workspaceId) ||
      (input.membership !== null && !validMembership(input.membership))
    ) {
      return false;
    }
    const operation = this.accountMergeOperation(input.planId);
    if (
      operation === undefined ||
      !accountMergeOperationMatches(operation, input) ||
      (operation.status !== "prepared" && operation.status !== "applied")
    ) {
      return false;
    }
    if (input.membership === null) {
      this.ctx.storage.sql.exec(
        "DELETE FROM account_merge_rights_inventory WHERE workspace_id = ?",
        input.workspaceId,
      );
      return true;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO account_merge_rights_inventory
        (workspace_id, role, revision) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         role = excluded.role,
         revision = excluded.revision`,
      input.workspaceId,
      input.membership.role,
      input.membership.revision,
    );
    return true;
  }

  /** Adds the absorbed login identities without changing historical origin. */
  applyAccountMergeAsSurvivor(
    input: PunkAccountMergeCoordinate & {
      expectedRevision: number;
      absorbedIdentities: readonly Punk["identities"][number][];
      appliedAt: string;
    },
  ): boolean {
    if (
      !validAccountMergeCoordinate(input) ||
      !exactObjectKeys(input, [
        "absorbedIdentities",
        "absorbedPunkId",
        "appliedAt",
        "expectedRevision",
        "intentId",
        "planId",
        "receiptId",
        "survivorPunkId",
      ]) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !canonicalTimestamp(input.appliedAt) ||
      !Array.isArray(input.absorbedIdentities) ||
      input.absorbedIdentities.length > 64
    ) {
      return false;
    }
    const operation = this.accountMergeOperation(input.planId);
    if (
      operation === undefined ||
      operation.account_role !== "survivor" ||
      operation.expected_revision !== input.expectedRevision ||
      !accountMergeOperationMatches(operation, input)
    ) {
      return false;
    }
    if (operation.status === "applied") return true;
    const current = this.state();
    if (
      current === null ||
      current.status !== "active" ||
      current.revision !== input.expectedRevision
    ) {
      return false;
    }
    const identities: Punk["identities"] = [
      current.identities[0],
      ...current.identities.slice(1),
    ];
    const coordinates = new Set(
      identities.map((item) => `${item.provider}\u0000${item.subjectHash}`),
    );
    for (const candidate of input.absorbedIdentities) {
      const coordinate = `${candidate.provider}\u0000${candidate.subjectHash}`;
      if (!coordinates.has(coordinate)) {
        identities.push(candidate);
        coordinates.add(coordinate);
      }
    }
    const next: Punk = {
      ...current,
      identities,
      revision: current.revision + 1,
      updatedAt: input.appliedAt,
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) return false;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(next),
      );
      this.ctx.storage.sql.exec(
        `UPDATE account_merge_operation
         SET status = 'applied', applied_at = ? WHERE plan_id = ?`,
        input.appliedAt,
        input.planId,
      );
      this.trimAccountMergeOperations();
    });
    return true;
  }

  /** Converts the absorbed account into an immutable inactive alias. */
  applyAccountMergeAsAbsorbed(
    input: PunkAccountMergeCoordinate & {
      expectedRevision: number;
      appliedAt: string;
    },
  ): boolean {
    if (
      !validAccountMergeCoordinate(input) ||
      !exactObjectKeys(input, [
        "absorbedPunkId",
        "appliedAt",
        "expectedRevision",
        "intentId",
        "planId",
        "receiptId",
        "survivorPunkId",
      ]) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !canonicalTimestamp(input.appliedAt)
    ) {
      return false;
    }
    const operation = this.accountMergeOperation(input.planId);
    if (
      operation === undefined ||
      operation.account_role !== "absorbed" ||
      operation.expected_revision !== input.expectedRevision ||
      !accountMergeOperationMatches(operation, input)
    ) {
      return false;
    }
    if (operation.status === "applied") return true;
    const current = this.state();
    if (
      current === null ||
      current.status !== "active" ||
      current.revision !== input.expectedRevision
    ) {
      return false;
    }
    const next: Punk = {
      ...current,
      status: "merged",
      mergedInto: input.survivorPunkId,
      revision: current.revision + 1,
      updatedAt: input.appliedAt,
    };
    if (!validateContract("punks://contracts/punk@1", next).valid) return false;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(next),
      );
      this.ctx.storage.sql.exec("DELETE FROM account_merge_rights_inventory");
      this.ctx.storage.sql.exec("DELETE FROM account_merge_session_inventory");
      this.ctx.storage.sql.exec("DELETE FROM account_merge_handoff_inventory");
      this.ctx.storage.sql.exec(
        `UPDATE account_merge_operation
         SET status = 'applied', applied_at = ? WHERE plan_id = ?`,
        input.appliedAt,
        input.planId,
      );
      this.trimAccountMergeOperations();
    });
    return true;
  }

  private accountMergeSessionInventoryComplete(now: string): boolean {
    const coverage = this.ctx.storage.sql
      .exec<SessionInventoryCoverageRow>(
        `SELECT complete_after
         FROM account_merge_session_inventory_coverage
         WHERE singleton = 1`,
      )
      .toArray()[0];
    if (coverage !== undefined) {
      return (
        canonicalTimestamp(coverage.complete_after) &&
        Date.parse(coverage.complete_after) <= Date.parse(now)
      );
    }
    if (this.state() === null) {
      return false;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO account_merge_session_inventory_coverage
        (singleton, complete_after) VALUES (1, ?)`,
      new Date(
        Date.parse(now) + LEGACY_SESSION_COVERAGE_MILLISECONDS,
      ).toISOString(),
    );
    return false;
  }

  private accountMergeOperation(
    planId?: string,
  ): AccountMergeOperationRow | undefined {
    return this.ctx.storage.sql
      .exec<AccountMergeOperationRow>(
        `SELECT intent_id, plan_id, receipt_id, survivor_punk_id,
                absorbed_punk_id, account_role, expected_revision,
                status, applied_at
         FROM account_merge_operation
         WHERE (? IS NOT NULL AND plan_id = ?)
            OR (? IS NULL AND status = 'prepared')
         ORDER BY rowid DESC LIMIT 1`,
        planId ?? null,
        planId ?? null,
        planId ?? null,
      )
      .toArray()[0];
  }

  private async accountMergeReceipt(): Promise<
    AccountMergeReceipt | null | "unavailable"
  > {
    const absorbedPunkId = this.ctx.id.name;
    if (typeof absorbedPunkId !== "string" || !UUID.test(absorbedPunkId)) {
      return "unavailable";
    }
    try {
      const result =
        await this.env.ACCOUNT_MERGE_RECEIPTS.lookupAccountMergeReceipt({
          absorbedPunkId,
        });
      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result) ||
        Reflect.get(result, "ok") !== true
      ) {
        return "unavailable";
      }
      const receipt = Reflect.get(result, "receipt");
      if (receipt === null) return null;
      return validateContract(
        "punks://contracts/account-merge.receipt@1",
        receipt,
      ).valid && Reflect.get(receipt, "absorbedPunkId") === absorbedPunkId
        ? (receipt as AccountMergeReceipt)
        : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  private accountMergePrepared(): boolean {
    return this.accountMergeOperation()?.status === "prepared";
  }

  private accountMergePreparedAsAbsorbed(): boolean {
    const operation = this.accountMergeOperation();
    return (
      operation?.status === "prepared" && operation.account_role === "absorbed"
    );
  }

  private trimAccountMergeOperations(): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM account_merge_operation
       WHERE status = 'applied' AND plan_id NOT IN (
         SELECT plan_id FROM account_merge_operation
         WHERE status = 'applied' ORDER BY applied_at DESC LIMIT ?
       )`,
      MAX_ACCOUNT_MERGE_OPERATION_RESULTS,
    );
  }

  private accountMergeRightsInventoryComplete(): boolean {
    return (
      this.ctx.storage.sql
        .exec<RightsInventoryCoverageRow>(
          `SELECT singleton
           FROM account_merge_rights_inventory_coverage
           WHERE singleton = 1`,
        )
        .toArray()[0]?.singleton === 1
    );
  }

  private rightsOperation(operationId: string): RightsOperationRow | undefined {
    return this.ctx.storage.sql
      .exec<RightsOperationRow>(
        `SELECT workspace_id, punk_id, status,
                membership_role, membership_revision
         FROM account_merge_rights_operations WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
  }

  private trimTerminalRightsOperations(): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM account_merge_rights_operations
       WHERE status != 'pending' AND rowid NOT IN (
         SELECT rowid FROM account_merge_rights_operations
         WHERE status != 'pending' ORDER BY rowid DESC LIMIT ?
       )`,
      MAX_TERMINAL_ACCOUNT_MERGE_RIGHTS_OPERATIONS,
    );
  }

  private state(): Punk | null {
    const row = this.ctx.storage.sql
      .exec<StateRow>("SELECT state_json FROM punk_state WHERE singleton = 1")
      .toArray()[0];
    return row === undefined ? null : (JSON.parse(row.state_json) as Punk);
  }
}
