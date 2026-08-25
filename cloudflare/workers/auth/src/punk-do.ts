import type {
  AuthProviderProfile,
  Punk,
  UpdatePunkProfileCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  canonicalPunkAvatarUrl,
  canonicalPunkDisplayName,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

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

export type PunkProfileUpdateResult =
  | { ok: true; state: Punk; replayed: boolean }
  | {
      ok: false;
      code: "invalid_input" | "not_found" | "inactive" | "idempotency_conflict";
    }
  | { ok: false; code: "revision_conflict"; currentRevision: number };

export type AccountMergeWorkspaceRole =
  | "owner"
  | "moderator"
  | "member"
  | "guest";

export interface AccountMergeRightsChangeInput {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly punkId: string;
}

export interface CommitAccountMergeRightsChangeInput
  extends AccountMergeRightsChangeInput {
  readonly membership: {
    readonly role: AccountMergeWorkspaceRole;
    readonly revision: number;
  } | null;
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

export class PunkDO extends DurableObject<AuthEnv> {
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
      ) STRICT
    `);
  }

  provision(input: {
    punkId: string;
    identity: IdentityInput;
    now: string;
  }): PunkResult {
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

  linkIdentity(input: { identity: IdentityInput; now: string }): PunkResult {
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

  linkPasskey(input: {
    credentialId: string;
    subjectHash: string;
    emailHash: string;
    now: string;
  }): PunkResult {
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

  query(): PunkResult {
    const state = this.state();
    if (state === null) {
      return { ok: false, code: "not_found" };
    }
    if (state.status !== "active") {
      return { ok: false, code: "inactive" };
    }
    return { ok: true, state, replayed: true };
  }

  /** Private authority read used only for bounded alias resolution. */
  readForResolution(): Punk | null {
    const state = this.state();
    return state !== null &&
      validateContract("punks://contracts/punk@1", state).valid
      ? state
      : null;
  }

  /** Applies one self-profile command atomically at its expected revision. */
  updateProfile(input: unknown): PunkProfileUpdateResult {
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

  hasIdentity(input: {
    provider: AuthProviderProfile["provider"];
    subjectHash: string;
  }): boolean {
    return (
      this.state()?.identities.some(
        (item) =>
          item.provider === input.provider &&
          item.subjectHash === input.subjectHash,
      ) ?? false
    );
  }

  hasVerifiedEmail(emailHash: string): boolean {
    return (
      this.state()?.identities.some((item) => item.emailHash === emailHash) ??
      false
    );
  }

  hasPasskey(subjectHash: string): boolean {
    return (
      this.state()?.identities.some(
        (item) =>
          item.provider === "passkey" && item.subjectHash === subjectHash,
      ) ?? false
    );
  }

  passkeyCredentialIds(): string[] {
    return (this.state()?.identities ?? []).flatMap((item) =>
      item.provider === "passkey" && item.credentialId !== null
        ? [item.credentialId]
        : [],
    );
  }

  /** Registers one authoritative Session coordinate for future merge planning. */
  recordAccountMergeSession(input: {
    sessionId: string;
    punkId: string;
    clientKind: "browser" | "desktop" | "mobile" | "api";
    authenticatedAt: string;
    expiresAt: string;
  }): boolean {
    if (
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
  recordAccountMergeHandoff(input: {
    handoffId: string;
    punkId: string;
    kind: PunkAccountMergeInventory["handoffs"][number]["kind"];
    state: PunkAccountMergeInventory["handoffs"][number]["state"];
    expiresAt: string;
  }): boolean {
    if (
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
  prepareAccountMergeRightsChange(
    input: AccountMergeRightsChangeInput,
  ): boolean {
    if (
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
  commitAccountMergeRightsChange(
    input: CommitAccountMergeRightsChangeInput,
  ): boolean {
    if (
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
  accountMergeInventory(): PunkAccountMergeInventory {
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
