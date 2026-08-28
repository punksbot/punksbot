import type {
  AccountMergeCommitResponse,
  AccountMergeFreshProof,
  AccountMergePlan,
  AccountMergePlanResponse,
  AccountMergeReceipt,
  AccountMergeState,
  CommitAccountMergeCommand,
  Punk,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  deriveOpaqueUuid,
  prepareAccountMergePlan,
  sha256Hex,
  type AccountMergeAuthoritativeProof,
  type AccountMergePunkSnapshot,
  type ApplyAccountMergeToWorkspaceInput,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";

type IntentRow = Record<"intent_id", string>;
type ProofRow = Record<
  | "proof_id"
  | "account_role"
  | "punk_id"
  | "source_session_id"
  | "descriptor_json"
  | "state",
  string
>;
type PlanRow = Record<
  "command_id" | "plan_id" | "plan_json" | "authority_manifest_json",
  string | null
>;
type SagaRow = Record<
  | "commit_command_id"
  | "command_json"
  | "status"
  | "receipt_json"
  | "last_failure_json"
  | "committed_at"
  | "completed_at"
  | "updated_at",
  string | null
> &
  Record<"application_cursor" | "application_total", number>;

interface StoredAccountMergeManifestPunk {
  punkId: string;
  revision: number;
  identities: Array<Punk["identities"][number]>;
  rights: Array<{
    workspaceId: string;
    role: "owner" | "moderator" | "member" | "guest";
    revision: number;
  }>;
  sessions: Array<{
    sessionId: string;
    clientKind: "browser" | "desktop" | "mobile" | "api";
    authenticatedAt: string;
    expiresAt: string;
  }>;
  handoffs: Array<{
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
  }>;
}

interface StoredAccountMergeManifest {
  schemaVersion: 1;
  survivor: StoredAccountMergeManifestPunk;
  absorbed: StoredAccountMergeManifestPunk;
}

interface StoredAccountMergeRecoveryDescriptor {
  schemaVersion: 1;
  plan: AccountMergePlan;
  authorityManifest: StoredAccountMergeManifest;
}

type AccountMergeSagaCoordinate = {
  readonly intentId: string;
  readonly planId: string;
  readonly receiptId: string;
  readonly survivorPunkId: string;
  readonly absorbedPunkId: string;
};
type PrepareAccountMergeAuthoritiesResult =
  | "prepared"
  | "revision_conflict"
  | "authority_unavailable";
type AccountMergeRecoveryRead = {
  receipt: AccountMergeReceipt;
  plan: AccountMergePlan;
  manifest: StoredAccountMergeManifest;
};

/** Private RPC input that binds a commit to its surviving Session. */
export interface CommitStoredAccountMergePlanInput {
  readonly command: unknown;
  readonly callerSessionId: string;
  readonly correlationId: string;
}

/** Private recovery read bound to the immutable Plan and surviving Punk. */
export interface ReadStoredAccountMergeStateInput {
  readonly planId: string;
  readonly callerPunkId: string;
}

const ACCOUNT_MERGE_RECEIPT_NAMESPACE = "punks.account-merge-receipt.v1";
const PLAN_ID_NAMESPACE = "punks.account-merge-plan.v1";

/** Trusted RPC input containing only the contract command and correlation ID. */
export interface PrepareStoredAccountMergePlanInput {
  readonly command: unknown;
  readonly correlationId: string;
}

/** Server-only provenance for a proof minted from a verified Session. */
export interface AccountMergeFreshProofAuthority {
  readonly sourceSessionId: string;
}

function unavailable(correlationId: string): AccountMergePlanResponse {
  return {
    contract: "account-merge.plan-response@1",
    ok: false,
    code: "plan_unavailable",
    correlationId:
      typeof correlationId === "string" && correlationId.length <= 128
        ? correlationId || "account-merge"
        : "account-merge",
  };
}

class AccountMergeInternalFailure extends Error {
  constructor(readonly classification: string) {
    super(classification);
  }
}

const CLIENT_KINDS = new Set(["browser", "desktop", "mobile", "api"]);
const HANDOFF_KINDS = new Set([
  "desktop-auth-flow",
  "oauth-transaction",
  "passkey-ceremony",
  "reauth-authorization",
  "session-renewal",
  "account-link",
]);
const HANDOFF_STATES = new Set(["pending", "prepared", "deliverable"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function internalFailure(
  correlationId: string,
  error: unknown,
): AccountMergePlanResponse {
  console.error(
    JSON.stringify({
      event: "account_merge_plan_internal_failure",
      classification:
        error instanceof AccountMergeInternalFailure
          ? error.classification
          : "unexpected",
      correlationId:
        typeof correlationId === "string" && correlationId.length <= 128
          ? correlationId || "account-merge"
          : "account-merge",
    }),
  );
  return unavailable(correlationId);
}

async function claimsForPunk(
  punk: Pick<Punk, "id" | "revision"> & {
    identities: readonly Punk["identities"][number][];
  },
): Promise<AccountMergePunkSnapshot["claims"]> {
  const claims: Array<AccountMergePunkSnapshot["claims"][number]> = [];
  for (const identity of punk.identities) {
    if (identity.provider !== "google" && identity.provider !== "github")
      continue;
    claims.push({
      claimBindingHash: await sha256Hex(
        canonicalJson({
          kind: "provider-subject",
          provider: identity.provider,
          value: identity.subjectHash,
        }),
      ),
      kind: "provider-subject",
      provider: identity.provider,
      punkId: punk.id,
      revision: punk.revision,
    });
    if (identity.verifiedEmail !== null) {
      claims.push({
        claimBindingHash: await sha256Hex(
          canonicalJson({
            kind: "verified-email",
            provider: identity.provider,
            value: identity.emailHash,
          }),
        ),
        kind: "verified-email",
        provider: identity.provider,
        punkId: punk.id,
        revision: punk.revision,
      });
    }
  }
  return claims;
}

function storedManifestPunk(value: {
  punkId: string;
  state: {
    revision: number;
    identities: readonly Punk["identities"][number][];
  };
  inventory: {
    rights: readonly StoredAccountMergeManifestPunk["rights"][number][];
    sessions: readonly StoredAccountMergeManifestPunk["sessions"][number][];
    handoffs: readonly StoredAccountMergeManifestPunk["handoffs"][number][];
  };
}): StoredAccountMergeManifestPunk {
  return {
    punkId: value.punkId,
    revision: value.state.revision,
    identities: structuredClone([...value.state.identities]),
    rights: structuredClone([...value.inventory.rights]),
    sessions: structuredClone([...value.inventory.sessions]),
    handoffs: structuredClone([...value.inventory.handoffs]),
  };
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedCorrelationId(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : "account-merge";
}

function commitFailure(
  code: Exclude<AccountMergeCommitResponse, { ok: true }>["code"],
  correlationId: unknown,
): AccountMergeCommitResponse {
  return {
    contract: "account-merge.commit-response@1",
    ok: false,
    code,
    correlationId: boundedCorrelationId(correlationId),
  };
}

function parseStoredManifest(
  value: string | null,
): StoredAccountMergeManifest | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !exactKeys(parsed, ["absorbed", "schemaVersion", "survivor"]) ||
    Reflect.get(parsed, "schemaVersion") !== 1
  ) {
    return null;
  }
  const manifest = parsed as StoredAccountMergeManifest;
  for (const punk of [manifest.survivor, manifest.absorbed]) {
    if (
      typeof punk !== "object" ||
      punk === null ||
      Array.isArray(punk) ||
      !exactKeys(punk, [
        "handoffs",
        "identities",
        "punkId",
        "revision",
        "rights",
        "sessions",
      ]) ||
      !UUID.test(punk.punkId) ||
      !Number.isSafeInteger(punk.revision) ||
      punk.revision < 1 ||
      !Array.isArray(punk.identities) ||
      punk.identities.length > 64 ||
      !Array.isArray(punk.rights) ||
      punk.rights.length > 256 ||
      !Array.isArray(punk.sessions) ||
      punk.sessions.length > 128 ||
      !Array.isArray(punk.handoffs) ||
      punk.handoffs.length > 64
    ) {
      return null;
    }
  }
  return canonicalJson(manifest) === value ? manifest : null;
}

function parseStoredRecoveryDescriptor(
  value: string,
): StoredAccountMergeRecoveryDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !exactKeys(parsed, ["authorityManifest", "plan", "schemaVersion"]) ||
    Reflect.get(parsed, "schemaVersion") !== 1
  ) {
    return null;
  }
  const plan = Reflect.get(parsed, "plan");
  const authorityManifest = parseStoredManifest(
    canonicalJson(Reflect.get(parsed, "authorityManifest")),
  );
  if (
    !validateContract("punks://contracts/account-merge.plan@1", plan).valid ||
    authorityManifest === null ||
    canonicalJson(parsed) !== value
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    plan: plan as AccountMergePlan,
    authorityManifest,
  };
}

async function validStoredPlanIntegrity(
  plan: AccountMergePlan,
): Promise<boolean> {
  const { planId, planDigest, ...descriptor } = plan;
  return (
    (await sha256Hex(canonicalJson(descriptor))) === planDigest &&
    (await deriveOpaqueUuid(PLAN_ID_NAMESPACE, planDigest)) === planId
  );
}

function receiptDecisionMatches(
  receipt: AccountMergeReceipt,
  command: CommitAccountMergeCommand,
): boolean {
  return (
    receipt.intentId === command.intentId &&
    receipt.planId === command.planId &&
    receipt.planDigest === command.planDigest &&
    receipt.commitCommandId === command.commandId &&
    receipt.survivorPunkId === command.survivorPunkId &&
    receipt.absorbedPunkId === command.absorbedPunkId &&
    receipt.accountRevisions.survivor === command.accountRevisions.survivor &&
    receipt.accountRevisions.absorbed === command.accountRevisions.absorbed
  );
}

async function storedPlanMatchesCommand(
  plan: AccountMergePlan | null,
  manifest: StoredAccountMergeManifest | null,
  command: CommitAccountMergeCommand,
): Promise<boolean> {
  return (
    plan !== null &&
    manifest !== null &&
    plan.intentId === command.intentId &&
    plan.planId === command.planId &&
    plan.planDigest === command.planDigest &&
    plan.survivorPunkId === command.survivorPunkId &&
    plan.absorbedPunkId === command.absorbedPunkId &&
    canonicalJson(plan.accountRevisions) ===
      canonicalJson(command.accountRevisions) &&
    manifest.survivor.punkId === plan.survivorPunkId &&
    manifest.absorbed.punkId === plan.absorbedPunkId &&
    manifest.survivor.revision === plan.accountRevisions.survivor &&
    manifest.absorbed.revision === plan.accountRevisions.absorbed &&
    (await validStoredPlanIntegrity(plan))
  );
}

async function recoveryDescriptorMatchesReceipt(
  descriptor: StoredAccountMergeRecoveryDescriptor,
  receipt: AccountMergeReceipt,
): Promise<boolean> {
  const plan = descriptor.plan;
  const manifest = descriptor.authorityManifest;
  return (
    plan.intentId === receipt.intentId &&
    plan.planId === receipt.planId &&
    plan.planDigest === receipt.planDigest &&
    plan.survivorPunkId === receipt.survivorPunkId &&
    plan.absorbedPunkId === receipt.absorbedPunkId &&
    canonicalJson(plan.accountRevisions) ===
      canonicalJson(receipt.accountRevisions) &&
    manifest.survivor.punkId === plan.survivorPunkId &&
    manifest.absorbed.punkId === plan.absorbedPunkId &&
    manifest.survivor.revision === plan.accountRevisions.survivor &&
    manifest.absorbed.revision === plan.accountRevisions.absorbed &&
    (await validStoredPlanIntegrity(plan))
  );
}

/**
 * Single authority for one account-merge intent. It consumes the two remote
 * Session authorizations before atomically consuming the local proof
 * descriptors and persisting the immutable Plan.
 */
export class AccountMergeIntentDO extends DurableObject<AuthEnv> {
  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS account_merge_intent (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        intent_id TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_proof (
        proof_id TEXT PRIMARY KEY,
        account_role TEXT NOT NULL UNIQUE
          CHECK (account_role IN ('survivor', 'absorbed')),
        punk_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'revoked', 'consumed'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_plan (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        plan_digest TEXT NOT NULL UNIQUE,
        plan_json TEXT NOT NULL,
        authority_manifest_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_merge_saga (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        commit_command_id TEXT NOT NULL UNIQUE,
        command_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('preparing', 'committed', 'applying', 'completed')
        ),
        application_cursor INTEGER NOT NULL CHECK (application_cursor >= 0),
        application_total INTEGER NOT NULL CHECK (application_total >= 0),
        receipt_json TEXT,
        last_failure_json TEXT,
        committed_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    const planColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(account_merge_plan)")
      .toArray();
    if (
      !planColumns.some((column) => column.name === "authority_manifest_json")
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE account_merge_plan ADD COLUMN authority_manifest_json TEXT",
      );
    }
  }

  /**
   * Records one schema-valid proof emitted by the private auth authority.
   * Identical active retries are idempotent; roles and proof IDs are create-only.
   */
  async recordFreshProof(
    value: unknown,
    authority: AccountMergeFreshProofAuthority,
  ): Promise<boolean> {
    if (
      !validateContract("punks://contracts/account-merge.fresh-proof@1", value)
        .valid ||
      typeof authority?.sourceSessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        authority.sourceSessionId,
      )
    ) {
      return false;
    }
    this.initialize();
    const proof = value as AccountMergeFreshProof;
    const recorded = this.ctx.storage.transactionSync(() => {
      const intent = this.intent();
      if (intent !== undefined && intent.intent_id !== proof.intentId) {
        return false;
      }
      const existing = this.proof(proof.proofId);
      const descriptorJson = canonicalJson(proof);
      if (existing !== undefined) {
        return (
          existing.state === "active" &&
          existing.descriptor_json === descriptorJson &&
          existing.source_session_id === authority.sourceSessionId
        );
      }
      const occupiedRole = this.ctx.storage.sql
        .exec<ProofRow>(
          `SELECT proof_id, account_role, punk_id, source_session_id,
                  descriptor_json, state
           FROM account_merge_proof
           WHERE account_role = ?`,
          proof.accountRole,
        )
        .toArray()[0];
      if (occupiedRole !== undefined) return false;
      if (intent === undefined) {
        this.ctx.storage.sql.exec(
          `INSERT INTO account_merge_intent (singleton, intent_id)
           VALUES (1, ?)`,
          proof.intentId,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_proof
          (proof_id, account_role, punk_id, source_session_id,
           descriptor_json, state)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        proof.proofId,
        proof.accountRole,
        proof.punkId,
        authority.sourceSessionId,
        descriptorJson,
      );
      return true;
    });
    if (recorded) {
      const cleanupAt = Date.parse(proof.expiresAt) + 60_000;
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (currentAlarm === null || cleanupAt < currentAlarm) {
        await this.ctx.storage.setAlarm(cleanupAt);
      }
    }
    return recorded;
  }

  /**
   * Consumes both active proofs and stores one immutable Plan. The private
   * caller supplies no authority snapshots: Punks, rights, Sessions and
   * handoffs are read and revalidated inside the trusted Worker graph.
   */
  async preparePlan(
    input: PrepareStoredAccountMergePlanInput,
  ): Promise<AccountMergePlanResponse> {
    const correlationId = input?.correlationId ?? "account-merge";
    if (
      !validateContract(
        "punks://contracts/account-merge.plan-create@1",
        input?.command,
      ).valid
    ) {
      return unavailable(correlationId);
    }
    this.initialize();
    try {
      const command = input.command as {
        commandId?: unknown;
        intentId?: unknown;
      };
      const existingPlan = this.plan();
      if (existingPlan !== undefined) {
        return unavailable(correlationId);
      }
      const proofs = this.proofs();
      if (proofs.length !== 2) {
        return unavailable(correlationId);
      }
      const authoritativeProofs: AccountMergeAuthoritativeProof[] = [];
      const sourceSessions: Array<{
        descriptor: AccountMergeFreshProof;
        sourceSessionId: string;
      }> = [];
      for (const row of proofs) {
        let descriptor: unknown;
        try {
          descriptor = JSON.parse(row.descriptor_json);
        } catch {
          throw new AccountMergeInternalFailure("corrupt-proof-descriptor");
        }
        if (
          !validateContract(
            "punks://contracts/account-merge.fresh-proof@1",
            descriptor,
          ).valid ||
          (row.state !== "active" &&
            row.state !== "revoked" &&
            row.state !== "consumed")
        ) {
          return unavailable(correlationId);
        }
        authoritativeProofs.push({
          descriptor: descriptor as AccountMergeFreshProof,
          state: row.state,
        });
        const typedDescriptor = descriptor as AccountMergeFreshProof;
        let proofContext: Awaited<
          ReturnType<
            import("./session-do").SessionDO["accountMergeClaimedProofContext"]
          >
        >;
        try {
          proofContext = await this.env.SESSIONS.getByName(
            row.source_session_id,
          ).accountMergeClaimedProofContext({
            intentId: typedDescriptor.intentId,
            accountRole: typedDescriptor.accountRole,
          });
        } catch {
          throw new AccountMergeInternalFailure(
            "session-proof-authority-unavailable",
          );
        }
        if (
          proofContext === null ||
          proofContext.sessionId !== row.source_session_id ||
          proofContext.punkId !== typedDescriptor.punkId ||
          proofContext.authenticationMethod !==
            typedDescriptor.authenticationMethod ||
          proofContext.providerSubjectBindingHash !==
            typedDescriptor.providerSubjectBindingHash ||
          proofContext.authenticatedAt !== typedDescriptor.authenticatedAt ||
          proofContext.expiresAt !== typedDescriptor.expiresAt
        ) {
          return unavailable(correlationId);
        }
        sourceSessions.push({
          descriptor: typedDescriptor,
          sourceSessionId: row.source_session_id,
        });
      }
      const requestedPunkIds = [
        (input.command as { survivorPunkId: string }).survivorPunkId,
        (input.command as { absorbedPunkId: string }).absorbedPunkId,
      ];
      const authoritativePunks: AccountMergePunkSnapshot[] = [];
      let potentialClaimCount = 0;
      let indexedRightCount = 0;
      let indexedSessionCount = 0;
      let indexedHandoffCount = 0;
      const punkStates: Array<{
        punkId: string;
        state: Parameters<typeof claimsForPunk>[0] & { status: "active" };
        inventory: Awaited<
          ReturnType<
            ReturnType<AuthEnv["PUNKS"]["getByName"]>["accountMergeInventory"]
          >
        >;
      }> = [];
      for (const punkId of requestedPunkIds) {
        let current: Awaited<
          ReturnType<ReturnType<AuthEnv["PUNKS"]["getByName"]>["query"]>
        >;
        try {
          current = await this.env.PUNKS.getByName(punkId).query();
        } catch {
          throw new AccountMergeInternalFailure("punk-authority-unavailable");
        }
        if (
          !current.ok ||
          current.state.status !== "active" ||
          current.state.id !== punkId
        ) {
          return unavailable(correlationId);
        }
        if (
          !Array.isArray(current.state.identities) ||
          current.state.identities.length > 64 - potentialClaimCount ||
          !validateContract("punks://contracts/punk@1", current.state).valid ||
          current.state.identities.some((identity) =>
            identity.provider === "passkey"
              ? typeof identity.credentialId !== "string"
              : identity.credentialId !== null,
          )
        ) {
          return unavailable(correlationId);
        }
        const activeState = { ...current.state, status: "active" as const };
        const inventory =
          await this.env.PUNKS.getByName(punkId).accountMergeInventory();
        if (
          !inventory.complete ||
          !Array.isArray(inventory.rights) ||
          inventory.rights.length > 512 - indexedRightCount
        ) {
          return unavailable(correlationId);
        }
        indexedRightCount += inventory.rights.length;
        for (const identity of activeState.identities) {
          if (identity.provider !== "google" && identity.provider !== "github")
            continue;
          potentialClaimCount += 1 + (identity.verifiedEmail === null ? 0 : 1);
          if (potentialClaimCount > 64) {
            return unavailable(correlationId);
          }
        }
        indexedSessionCount += inventory.sessions.length;
        indexedHandoffCount += inventory.handoffs.length;
        punkStates.push({ punkId, state: activeState, inventory });
      }
      if (
        potentialClaimCount > 64 ||
        indexedRightCount > 512 ||
        indexedSessionCount > 128 ||
        indexedHandoffCount + 2 > 64
      ) {
        return unavailable(correlationId);
      }
      for (const { punkId, state, inventory } of punkStates) {
        const rights: Array<AccountMergePunkSnapshot["rights"][number]> = [];
        const sessions: Array<AccountMergePunkSnapshot["sessions"][number]> =
          [];
        const handoffs: Array<AccountMergePunkSnapshot["handoffs"][number]> =
          [];
        for (const indexedRight of inventory.rights) {
          if (
            !UUID.test(indexedRight.workspaceId) ||
            !["owner", "moderator", "member", "guest"].includes(
              indexedRight.role,
            ) ||
            !Number.isSafeInteger(indexedRight.revision) ||
            indexedRight.revision < 1
          ) {
            return unavailable(correlationId);
          }
          const authorityBindingHash = await sha256Hex(
            `punks.account-merge.workspace.v1:${indexedRight.workspaceId}`,
          );
          rights.push({
            rightBindingHash: await sha256Hex(
              canonicalJson({
                authorityBindingHash,
                kind: "workspace-membership",
                punkId,
              }),
            ),
            kind: "workspace-membership",
            authorityBindingHash,
            punkId,
            role: indexedRight.role,
            revision: indexedRight.revision,
          });
        }
        for (const indexedSession of inventory.sessions) {
          const sessionStub = this.env.SESSIONS.getByName(
            indexedSession.sessionId,
          );
          let session: Awaited<
            ReturnType<typeof sessionStub.readForAccountMerge>
          >;
          try {
            session = await sessionStub.readForAccountMerge();
          } catch {
            throw new AccountMergeInternalFailure(
              "session-authority-unavailable",
            );
          }
          if (session === null) {
            await this.env.PUNKS.getByName(punkId).removeAccountMergeSession(
              indexedSession.sessionId,
            );
            continue;
          }
          if (
            session.punkId !== punkId ||
            session.authenticatedAt !== indexedSession.authenticatedAt ||
            session.expiresAt !== indexedSession.expiresAt ||
            !CLIENT_KINDS.has(indexedSession.clientKind) ||
            !canonicalTimestamp(session.authenticatedAt) ||
            !canonicalTimestamp(session.expiresAt)
          ) {
            return unavailable(correlationId);
          }
          sessions.push({
            sessionBindingHash: await sha256Hex(
              `punks.account-merge.session.v1:${indexedSession.sessionId}`,
            ),
            punkId,
            clientKind: indexedSession.clientKind,
            authenticatedAt: session.authenticatedAt,
            expiresAt: session.expiresAt,
          });
        }
        for (const indexedHandoff of inventory.handoffs) {
          if (
            !UUID.test(indexedHandoff.handoffId) ||
            !HANDOFF_KINDS.has(indexedHandoff.kind) ||
            !HANDOFF_STATES.has(indexedHandoff.state) ||
            !canonicalTimestamp(indexedHandoff.expiresAt)
          ) {
            return unavailable(correlationId);
          }
          let sourceHandoff: {
            punkId: string;
            kind: string;
            state: string;
            expiresAt: string;
          } | null;
          try {
            switch (indexedHandoff.kind) {
              case "desktop-auth-flow":
                sourceHandoff = await this.env.DESKTOP_AUTH_FLOWS.getByName(
                  indexedHandoff.handoffId,
                ).readForAccountMerge();
                break;
              case "oauth-transaction":
              case "account-link":
                sourceHandoff = await this.env.AUTH_TRANSACTIONS.getByName(
                  indexedHandoff.handoffId,
                ).readForAccountMerge();
                break;
              case "passkey-ceremony":
                // The dedicated namespace is deleted by Auth migration v6.
                sourceHandoff = null;
                break;
              case "reauth-authorization":
                sourceHandoff = await this.env.DESKTOP_REAUTH_GRANTS.getByName(
                  indexedHandoff.handoffId,
                ).readForAccountMerge();
                break;
              case "session-renewal":
                sourceHandoff = await this.env.SESSION_ROTATIONS.getByName(
                  indexedHandoff.handoffId,
                ).readForAccountMerge();
                break;
            }
          } catch {
            throw new AccountMergeInternalFailure(
              "handoff-authority-unavailable",
            );
          }
          if (sourceHandoff === null) {
            await this.env.PUNKS.getByName(punkId).removeAccountMergeHandoff(
              indexedHandoff.handoffId,
            );
            continue;
          }
          if (
            sourceHandoff.punkId !== punkId ||
            sourceHandoff.kind !== indexedHandoff.kind ||
            sourceHandoff.state !== indexedHandoff.state ||
            sourceHandoff.expiresAt !== indexedHandoff.expiresAt
          ) {
            return unavailable(correlationId);
          }
          handoffs.push({
            handoffBindingHash: await sha256Hex(
              `punks.account-merge.handoff.v1:${indexedHandoff.handoffId}`,
            ),
            punkId,
            kind: indexedHandoff.kind,
            state: indexedHandoff.state,
            expiresAt: indexedHandoff.expiresAt,
          });
        }
        for (const source of sourceSessions.filter(
          (item) => item.descriptor.punkId === punkId,
        )) {
          handoffs.push({
            handoffBindingHash: await sha256Hex(
              `punks.account-merge.reauth.v1:${source.descriptor.proofId}`,
            ),
            punkId,
            kind: "reauth-authorization",
            state: "prepared",
            expiresAt: source.descriptor.expiresAt,
          });
        }
        authoritativePunks.push({
          punkId,
          status: "active",
          revision: state.revision,
          claims: await claimsForPunk(state),
          rights,
          sessions,
          handoffs,
        });
      }
      const response = await prepareAccountMergePlan({
        command: input.command,
        now: new Date(),
        correlationId,
        authoritativeProofs,
        punks: authoritativePunks,
      });
      if (!response.ok) return unavailable(correlationId);
      const survivorManifest = punkStates.find(
        ({ punkId }) => punkId === response.plan.survivorPunkId,
      );
      const absorbedManifest = punkStates.find(
        ({ punkId }) => punkId === response.plan.absorbedPunkId,
      );
      if (survivorManifest === undefined || absorbedManifest === undefined) {
        throw new AccountMergeInternalFailure("manifest-account-missing");
      }
      const authorityManifest: StoredAccountMergeManifest = {
        schemaVersion: 1,
        survivor: storedManifestPunk(survivorManifest),
        absorbed: storedManifestPunk(absorbedManifest),
      };
      const authorityManifestJson = canonicalJson(authorityManifest);

      if (typeof command.commandId !== "string") {
        return unavailable(correlationId);
      }
      for (const source of sourceSessions) {
        const consumed = await this.env.SESSIONS.getByName(
          source.sourceSessionId,
        ).consumeAccountMergeProof({
          intentId: source.descriptor.intentId,
          accountRole: source.descriptor.accountRole,
          authenticationMethod: source.descriptor.authenticationMethod,
          providerSubjectBindingHash:
            source.descriptor.providerSubjectBindingHash,
          authenticatedAt: source.descriptor.authenticatedAt,
          expiresAt: source.descriptor.expiresAt,
        });
        if (!consumed) return unavailable(correlationId);
      }
      const persisted = this.ctx.storage.transactionSync(() => {
        if (this.plan() !== undefined) return false;
        const current = this.proofs();
        if (
          current.length !== 2 ||
          current.some((proof) => proof.state !== "active")
        ) {
          return false;
        }
        this.ctx.storage.sql.exec(
          `UPDATE account_merge_proof SET state = 'consumed'
         WHERE state = 'active'`,
        );
        if (this.proofs().some((proof) => proof.state !== "consumed")) {
          throw new TypeError("Account merge proof consumption was incomplete");
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO account_merge_plan
          (singleton, command_id, plan_id, plan_digest, plan_json,
           authority_manifest_json)
         VALUES (1, ?, ?, ?, ?, ?)`,
          command.commandId,
          response.plan.planId,
          response.plan.planDigest,
          canonicalJson(response.plan),
          authorityManifestJson,
        );
        return true;
      });
      if (persisted) this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
      return persisted ? response : unavailable(correlationId);
    } catch (error) {
      return internalFailure(correlationId, error);
    }
  }

  /** Starts or replays the irreversible saga for the stored Plan. */
  async commitPlan(
    input: CommitStoredAccountMergePlanInput,
  ): Promise<AccountMergeCommitResponse> {
    const correlationId = boundedCorrelationId(input?.correlationId);
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactKeys(input, ["callerSessionId", "command", "correlationId"]) ||
      !validateContract(
        "punks://contracts/account-merge.commit@1",
        input.command,
      ).valid ||
      typeof input.callerSessionId !== "string" ||
      !UUID.test(input.callerSessionId)
    ) {
      return commitFailure("invalid_request", correlationId);
    }
    this.initialize();
    const command = input.command as CommitAccountMergeCommand;
    const row = this.plan();
    let plan =
      row === undefined || typeof row.plan_json !== "string"
        ? null
        : this.parsePlan(row.plan_json);
    let manifest = parseStoredManifest(row?.authority_manifest_json ?? null);
    let terminalRecovery: AccountMergeRecoveryRead | null = null;
    if (!(await storedPlanMatchesCommand(plan, manifest, command))) {
      const recovery = await this.lookupMergeRecovery(command.absorbedPunkId);
      if (recovery === "unavailable") {
        return commitFailure("authority_unavailable", correlationId);
      }
      if (
        recovery === null ||
        !receiptDecisionMatches(recovery.receipt, command) ||
        !(await storedPlanMatchesCommand(
          recovery.plan,
          recovery.manifest,
          command,
        ))
      ) {
        return commitFailure("plan_unavailable", correlationId);
      }
      terminalRecovery = recovery;
      plan = recovery.plan;
      manifest = recovery.manifest;
      this.restorePlanFromRecovery(command, recovery);
    }
    if (plan === null || manifest === null) {
      return commitFailure("plan_unavailable", correlationId);
    }
    if (plan.conflicts.some((conflict) => conflict.blocking)) {
      return commitFailure("blocking_conflict", correlationId);
    }
    const survivorProof = this.proofs().find(
      (proof) => proof.account_role === "survivor",
    );
    if (
      survivorProof === undefined ||
      survivorProof.state !== "consumed" ||
      survivorProof.punk_id !== plan.survivorPunkId ||
      survivorProof.source_session_id !== input.callerSessionId
    ) {
      const recovery =
        terminalRecovery ??
        (await this.lookupMergeRecovery(command.absorbedPunkId));
      if (recovery === "unavailable") {
        return commitFailure("authority_unavailable", correlationId);
      }
      if (
        recovery === null ||
        !receiptDecisionMatches(recovery.receipt, command) ||
        !(await storedPlanMatchesCommand(
          recovery.plan,
          recovery.manifest,
          command,
        ))
      ) {
        return commitFailure("authority_unavailable", correlationId);
      }
      terminalRecovery = recovery;
    }

    const commandJson = canonicalJson(command);
    const existing = this.saga();
    if (existing !== undefined && existing.command_json !== commandJson) {
      return commitFailure("idempotency_conflict", correlationId);
    }
    if (existing === undefined) {
      const total =
        manifest.absorbed.rights.length +
        2 +
        manifest.survivor.sessions.length +
        manifest.absorbed.sessions.length +
        manifest.survivor.handoffs.length +
        manifest.absorbed.handoffs.length;
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_saga
          (singleton, commit_command_id, command_json, status,
           application_cursor, application_total, receipt_json,
           last_failure_json, committed_at, completed_at, updated_at)
         VALUES (1, ?, ?, 'preparing', 0, ?, NULL, NULL, NULL, NULL, ?)`,
        command.commandId,
        commandJson,
        total,
        now,
      );
    }
    await this.advanceMergeSaga(plan, manifest, correlationId);
    const response = this.commitSuccess(plan, existing !== undefined);
    if (
      response?.ok &&
      response.state.status === "preparing" &&
      response.state.lastFailure !== null
    ) {
      const code = response.state.lastFailure.code;
      return code === "application_pending"
        ? commitFailure("authority_unavailable", correlationId)
        : commitFailure(code, correlationId);
    }
    return response ?? commitFailure("authority_unavailable", correlationId);
  }

  /** Reads the bounded state for the surviving Punk after an ambiguous call. */
  readMergeState(
    input: ReadStoredAccountMergeStateInput,
  ): AccountMergeCommitResponse {
    this.initialize();
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactKeys(input, ["callerPunkId", "planId"]) ||
      !UUID.test(input.planId) ||
      !UUID.test(input.callerPunkId)
    ) {
      return commitFailure("invalid_request", "account-merge-read");
    }
    const row = this.plan();
    const plan =
      row === undefined || typeof row.plan_json !== "string"
        ? null
        : this.parsePlan(row.plan_json);
    if (
      plan === null ||
      plan.planId !== input.planId ||
      plan.survivorPunkId !== input.callerPunkId
    ) {
      return commitFailure("plan_unavailable", "account-merge-read");
    }
    return (
      this.commitSuccess(plan, true) ??
      commitFailure("plan_unavailable", "account-merge-read")
    );
  }

  private async advanceMergeSaga(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    correlationId: string,
  ): Promise<void> {
    let saga = this.saga();
    if (saga === undefined || saga.status === "completed") return;
    const command = JSON.parse(saga.command_json ?? "null") as unknown;
    if (
      !validateContract("punks://contracts/account-merge.commit@1", command)
        .valid
    ) {
      this.recordSagaFailure("authority_unavailable", correlationId);
      return;
    }
    const commit = command as CommitAccountMergeCommand;
    const receiptId = await deriveOpaqueUuid(
      ACCOUNT_MERGE_RECEIPT_NAMESPACE,
      canonicalJson({ planId: plan.planId, planDigest: plan.planDigest }),
    );
    const coordinate = {
      intentId: plan.intentId,
      planId: plan.planId,
      receiptId,
      survivorPunkId: plan.survivorPunkId,
      absorbedPunkId: plan.absorbedPunkId,
    };
    if (saga.status === "preparing") {
      const receiptLookup = await this.lookupMergeReceipt(plan.absorbedPunkId);
      if (receiptLookup === "unavailable") {
        this.recordSagaFailure("authority_unavailable", correlationId);
        await this.scheduleSagaAlarm();
        return;
      }
      if (receiptLookup !== null) {
        if (!receiptDecisionMatches(receiptLookup, commit)) {
          this.recordSagaFailure("receipt_conflict", correlationId);
          return;
        }
        this.markSagaCommitted(receiptLookup);
        saga = this.saga();
      } else {
        if (Date.parse(plan.expiresAt) <= Date.now()) {
          const aborted = await this.abortPreparedAuthorities(
            plan,
            manifest,
            coordinate,
            commit.commandId,
          );
          this.recordSagaFailure(
            aborted ? "plan_expired" : "authority_unavailable",
            correlationId,
          );
          if (!aborted) await this.scheduleSagaAlarm();
          return;
        }
        const preparation = await this.preparePunkAuthorities(
          plan,
          manifest,
          coordinate,
          commit.commandId,
        );
        if (preparation !== "prepared") {
          const aborted = await this.abortPreparedAuthorities(
            plan,
            manifest,
            coordinate,
            commit.commandId,
          );
          this.recordSagaFailure(
            aborted ? preparation : "authority_unavailable",
            correlationId,
          );
          if (!aborted) await this.scheduleSagaAlarm();
          return;
        }
        const receipt = await this.recordMergeReceipt(
          {
            receiptId,
            intentId: plan.intentId,
            planId: plan.planId,
            planDigest: plan.planDigest,
            commitCommandId: commit.commandId,
            survivorPunkId: plan.survivorPunkId,
            absorbedPunkId: plan.absorbedPunkId,
            accountRevisions: plan.accountRevisions,
          },
          {
            schemaVersion: 1,
            plan,
            authorityManifest: manifest,
          },
        );
        if (receipt === "conflict") {
          this.recordSagaFailure("receipt_conflict", correlationId);
          return;
        }
        if (receipt === null) {
          this.recordSagaFailure("authority_unavailable", correlationId);
          await this.scheduleSagaAlarm();
          return;
        }
        this.markSagaCommitted(receipt);
        saga = this.saga();
      }
    }
    if (saga === undefined) return;
    if (saga.status === "committed" || saga.status === "applying") {
      const terminalReceipt = await this.lookupMergeReceipt(
        plan.absorbedPunkId,
      );
      if (terminalReceipt === "unavailable" || terminalReceipt === null) {
        this.recordSagaFailure("authority_unavailable", correlationId);
        await this.scheduleSagaAlarm();
        return;
      }
      if (!receiptDecisionMatches(terminalReceipt, commit)) {
        this.recordSagaFailure("receipt_conflict", correlationId);
        return;
      }
      if (
        !(await this.ensureCommittedAuthorities(
          plan,
          manifest,
          coordinate,
          commit.commandId,
        ))
      ) {
        this.recordSagaFailure("application_pending", correlationId);
        await this.scheduleSagaAlarm();
        return;
      }
    }
    if (saga.status === "committed") {
      this.ctx.storage.sql.exec(
        `UPDATE account_merge_saga SET status = 'applying', updated_at = ?
         WHERE singleton = 1 AND status = 'committed'`,
        new Date().toISOString(),
      );
      saga = this.saga();
    }
    if (saga?.status !== "applying") return;
    const applied = await this.applyNextEffect(
      plan,
      manifest,
      coordinate,
      commit.commandId,
      saga,
    );
    if (!applied) {
      this.recordSagaFailure("application_pending", correlationId);
      await this.scheduleSagaAlarm();
      return;
    }
    const current = this.saga();
    if (
      current !== undefined &&
      current.application_cursor >= current.application_total
    ) {
      const completedAt = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE account_merge_saga
         SET status = 'completed', completed_at = ?, updated_at = ?,
             last_failure_json = NULL
         WHERE singleton = 1 AND status = 'applying'`,
        completedAt,
        completedAt,
      );
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.scheduleSagaAlarm();
    }
  }

  private async preparePunkAuthorities(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    coordinate: AccountMergeSagaCoordinate,
    commitCommandId: string,
  ): Promise<PrepareAccountMergeAuthoritiesResult> {
    const proofRows = this.proofs();
    if (
      proofRows.length !== 2 ||
      proofRows.some((proof) => proof.state !== "consumed")
    ) {
      return "authority_unavailable";
    }
    for (const proof of proofRows) {
      try {
        const session = await this.env.SESSIONS.getByName(
          proof.source_session_id,
        ).readForAccountMerge();
        if (session?.punkId !== proof.punk_id) {
          return "authority_unavailable";
        }
      } catch {
        return "authority_unavailable";
      }
    }
    for (const [role, expected] of [
      ["survivor", manifest.survivor],
      ["absorbed", manifest.absorbed],
    ] as const) {
      const punk = this.env.PUNKS.getByName(expected.punkId);
      try {
        const prepareInput = {
          ...coordinate,
          accountRole: role,
          expectedRevision: expected.revision,
        } as const;
        if (!(await punk.prepareAccountMerge(prepareInput))) {
          return "revision_conflict";
        }
        const snapshot = await punk.readPreparedAccountMerge(prepareInput);
        if (
          snapshot === null ||
          snapshot.state.revision !== expected.revision ||
          canonicalJson(snapshot.state.identities) !==
            canonicalJson(expected.identities) ||
          !snapshot.inventory.complete ||
          canonicalJson(snapshot.inventory.rights) !==
            canonicalJson(expected.rights) ||
          canonicalJson(snapshot.inventory.sessions) !==
            canonicalJson(expected.sessions) ||
          canonicalJson(snapshot.inventory.handoffs) !==
            canonicalJson(expected.handoffs)
        ) {
          return "revision_conflict";
        }
      } catch {
        return "authority_unavailable";
      }
    }
    const workspaces = await this.accountMergeWorkspaceInputs(
      plan,
      manifest,
      coordinate.receiptId,
      commitCommandId,
    );
    if (workspaces === null) return "authority_unavailable";
    const workspacePreparation =
      await this.prepareWorkspaceAuthorities(workspaces);
    if (workspacePreparation !== "prepared") return workspacePreparation;
    for (const proof of proofRows) {
      try {
        const session = await this.env.SESSIONS.getByName(
          proof.source_session_id,
        ).readForAccountMerge();
        if (session?.punkId !== proof.punk_id) {
          return "authority_unavailable";
        }
      } catch {
        return "authority_unavailable";
      }
    }
    return "prepared";
  }

  private async prepareWorkspaceAuthorities(
    workspaces: readonly ApplyAccountMergeToWorkspaceInput[],
  ): Promise<PrepareAccountMergeAuthoritiesResult> {
    for (let offset = 0; offset < workspaces.length; offset += 32) {
      let result: unknown;
      try {
        result = await this.env.ACCOUNT_MERGE_WORKSPACES.prepare({
          workspaces: workspaces.slice(offset, offset + 32),
        });
      } catch {
        return "authority_unavailable";
      }
      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result)
      ) {
        return "authority_unavailable";
      }
      if (Reflect.get(result, "ok") !== true) {
        const results = Reflect.get(result, "results");
        const failed = Array.isArray(results)
          ? results.find(
              (item) =>
                typeof item === "object" &&
                item !== null &&
                !Array.isArray(item) &&
                Reflect.get(item, "ok") === false,
            )
          : null;
        return failed !== null &&
          failed !== undefined &&
          Reflect.get(failed, "code") === "revision_conflict"
          ? "revision_conflict"
          : "authority_unavailable";
      }
    }
    return "prepared";
  }

  private async ensureCommittedAuthorities(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    coordinate: AccountMergeSagaCoordinate,
    commitCommandId: string,
  ): Promise<boolean> {
    for (const [role, expected] of [
      ["survivor", manifest.survivor],
      ["absorbed", manifest.absorbed],
    ] as const) {
      try {
        if (
          !(await this.env.PUNKS.getByName(expected.punkId).prepareAccountMerge(
            {
              ...coordinate,
              accountRole: role,
              expectedRevision: expected.revision,
            },
          ))
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    const workspaces = await this.accountMergeWorkspaceInputs(
      plan,
      manifest,
      coordinate.receiptId,
      commitCommandId,
    );
    return (
      workspaces !== null &&
      (await this.prepareWorkspaceAuthorities(workspaces)) === "prepared"
    );
  }

  private async applyNextEffect(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    coordinate: AccountMergeSagaCoordinate,
    commitCommandId: string,
    saga: SagaRow,
  ): Promise<boolean> {
    const cursor = saga.application_cursor;
    let applied = false;
    const workspaces = await this.accountMergeWorkspaceInputs(
      plan,
      manifest,
      coordinate.receiptId,
      commitCommandId,
    );
    if (workspaces === null) return false;
    const workspace = workspaces[cursor];
    if (workspace !== undefined) {
      let result: unknown;
      try {
        result = await this.env.ACCOUNT_MERGE_WORKSPACES.apply({
          workspaces: [workspace],
        });
      } catch {
        return false;
      }
      const results =
        typeof result === "object" &&
        result !== null &&
        !Array.isArray(result) &&
        Reflect.get(result, "ok") === true
          ? Reflect.get(result, "results")
          : null;
      const first = Array.isArray(results) ? results[0] : null;
      if (
        typeof first !== "object" ||
        first === null ||
        Array.isArray(first) ||
        Reflect.get(first, "ok") !== true ||
        Reflect.get(first, "workspaceId") !== workspace.workspaceId ||
        Reflect.get(first, "role") !== workspace.resultingRole ||
        !Number.isSafeInteger(Reflect.get(first, "revision"))
      ) {
        return false;
      }
      const membership = {
        role: workspace.resultingRole,
        revision: Number(Reflect.get(first, "revision")),
      };
      applied =
        (await this.env.PUNKS.getByName(
          plan.survivorPunkId,
        ).applyAccountMergeWorkspaceRight({
          ...coordinate,
          workspaceId: workspace.workspaceId,
          membership,
        })) &&
        (await this.env.PUNKS.getByName(
          plan.absorbedPunkId,
        ).applyAccountMergeWorkspaceRight({
          ...coordinate,
          workspaceId: workspace.workspaceId,
          membership: null,
        }));
    } else if (cursor === workspaces.length) {
      applied = await this.env.PUNKS.getByName(
        plan.survivorPunkId,
      ).applyAccountMergeAsSurvivor({
        ...coordinate,
        expectedRevision: manifest.survivor.revision,
        absorbedIdentities: manifest.absorbed.identities,
        appliedAt: new Date().toISOString(),
      });
    } else if (cursor === workspaces.length + 1) {
      applied = await this.env.PUNKS.getByName(
        plan.absorbedPunkId,
      ).applyAccountMergeAsAbsorbed({
        ...coordinate,
        expectedRevision: manifest.absorbed.revision,
        appliedAt: new Date().toISOString(),
      });
    } else {
      const sessions = [
        ...manifest.survivor.sessions,
        ...manifest.absorbed.sessions,
      ];
      const accountEffectCount = workspaces.length + 2;
      const session = sessions[cursor - accountEffectCount];
      if (session !== undefined) {
        const source = this.env.SESSIONS.getByName(session.sessionId);
        const current = await source.readForAccountMerge();
        applied = current === null ? true : await source.revoke();
      } else {
        const handoffs = [
          ...manifest.survivor.handoffs.map((handoff) => ({
            punkId: manifest.survivor.punkId,
            handoff,
          })),
          ...manifest.absorbed.handoffs.map((handoff) => ({
            punkId: manifest.absorbed.punkId,
            handoff,
          })),
        ];
        const item = handoffs[cursor - accountEffectCount - sessions.length];
        applied =
          item === undefined
            ? true
            : await this.cancelHandoff(item.punkId, item.handoff);
      }
    }
    if (!applied) return false;
    this.ctx.storage.sql.exec(
      `UPDATE account_merge_saga
       SET application_cursor = application_cursor + 1,
           last_failure_json = NULL, updated_at = ?
       WHERE singleton = 1 AND status = 'applying'
         AND application_cursor = ?`,
      new Date().toISOString(),
      cursor,
    );
    return true;
  }

  private async abortPreparedAuthorities(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    coordinate: AccountMergeSagaCoordinate,
    commitCommandId: string,
  ): Promise<boolean> {
    const workspaces = await this.accountMergeWorkspaceInputs(
      plan,
      manifest,
      coordinate.receiptId,
      commitCommandId,
    );
    if (workspaces === null) return false;
    for (let offset = 0; offset < workspaces.length; offset += 32) {
      try {
        const result = await this.env.ACCOUNT_MERGE_WORKSPACES.abort({
          workspaces: workspaces.slice(offset, offset + 32),
        });
        if (
          typeof result !== "object" ||
          result === null ||
          Array.isArray(result) ||
          Reflect.get(result, "ok") !== true
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    const [survivor, absorbed] = await Promise.all([
      this.env.PUNKS.getByName(plan.survivorPunkId).abortAccountMerge(
        coordinate,
      ),
      this.env.PUNKS.getByName(plan.absorbedPunkId).abortAccountMerge(
        coordinate,
      ),
    ]);
    return survivor && absorbed;
  }

  private async cancelHandoff(
    punkId: string,
    handoff: StoredAccountMergeManifestPunk["handoffs"][number],
  ): Promise<boolean> {
    try {
      switch (handoff.kind) {
        case "desktop-auth-flow":
          return await this.env.DESKTOP_AUTH_FLOWS.getByName(
            handoff.handoffId,
          ).cancelForAccountMerge({
            handoffId: handoff.handoffId,
            punkId,
            kind: "desktop-auth-flow",
            state: handoff.state,
            expiresAt: handoff.expiresAt,
          });
        case "oauth-transaction":
        case "account-link":
          if (handoff.state === "deliverable") return false;
          return await this.env.AUTH_TRANSACTIONS.getByName(
            handoff.handoffId,
          ).cancelForAccountMerge({
            ...handoff,
            punkId,
            kind: handoff.kind,
            state: handoff.state,
          });
        case "passkey-ceremony":
          // Legacy merge plans may retain this now-inert handoff descriptor.
          return true;
        case "reauth-authorization":
          if (handoff.state !== "deliverable") return false;
          return await this.env.DESKTOP_REAUTH_GRANTS.getByName(
            handoff.handoffId,
          ).cancelForAccountMerge({
            ...handoff,
            punkId,
            kind: "reauth-authorization",
            state: "deliverable",
          });
        case "session-renewal":
          if (handoff.state === "deliverable") return false;
          return await this.env.SESSION_ROTATIONS.getByName(
            handoff.handoffId,
          ).cancelForAccountMerge({
            ...handoff,
            punkId,
            kind: "session-renewal",
            state: handoff.state,
          });
      }
    } catch {
      return false;
    }
  }

  private async accountMergeWorkspaceInputs(
    plan: AccountMergePlan,
    manifest: StoredAccountMergeManifest,
    receiptId: string,
    commitCommandId: string,
  ): Promise<ApplyAccountMergeToWorkspaceInput[] | null> {
    if (
      plan.rights.length !==
      manifest.survivor.rights.length + manifest.absorbed.rights.length
    ) {
      return null;
    }
    const survivorByWorkspace = new Map(
      manifest.survivor.rights.map((right) => [right.workspaceId, right]),
    );
    if (
      survivorByWorkspace.size !== manifest.survivor.rights.length ||
      new Set(manifest.absorbed.rights.map((right) => right.workspaceId))
        .size !== manifest.absorbed.rights.length
    ) {
      return null;
    }
    const workspaces: ApplyAccountMergeToWorkspaceInput[] = [];
    for (const absorbed of manifest.absorbed.rights) {
      const survivor = survivorByWorkspace.get(absorbed.workspaceId);
      const authorityBindingHash = await sha256Hex(
        `punks.account-merge.workspace.v1:${absorbed.workspaceId}`,
      );
      const effects = plan.rights.filter(
        (right) => right.authorityBindingHash === authorityBindingHash,
      );
      const absorbedEffect = effects.find(
        (right) => right.originPunkId === plan.absorbedPunkId,
      );
      const survivorEffect = effects.find(
        (right) => right.originPunkId === plan.survivorPunkId,
      );
      if (
        absorbedEffect === undefined ||
        absorbedEffect.kind !== "workspace-membership" ||
        absorbedEffect.role !== absorbed.role ||
        absorbedEffect.expectedRevision !== absorbed.revision ||
        absorbedEffect.resultingRole === null ||
        (survivor === undefined) !== (survivorEffect === undefined) ||
        (survivor !== undefined &&
          (survivorEffect?.kind !== "workspace-membership" ||
            survivorEffect.role !== survivor.role ||
            survivorEffect.expectedRevision !== survivor.revision ||
            survivorEffect.resultingRole !== absorbedEffect.resultingRole))
      ) {
        return null;
      }
      workspaces.push({
        workspaceId: absorbed.workspaceId,
        planId: plan.planId,
        receiptId,
        commitCommandId,
        survivorPunkId: plan.survivorPunkId,
        absorbedPunkId: plan.absorbedPunkId,
        expectedRevision: absorbed.revision,
        survivorRole: survivor?.role ?? null,
        absorbedRole: absorbed.role,
        resultingRole: absorbedEffect.resultingRole,
      });
    }
    return workspaces.sort((left, right) =>
      left.workspaceId.localeCompare(right.workspaceId),
    );
  }

  private async lookupMergeReceipt(
    absorbedPunkId: string,
  ): Promise<AccountMergeReceipt | null | "unavailable"> {
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
      ).valid
        ? (receipt as AccountMergeReceipt)
        : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  private async lookupMergeRecovery(
    absorbedPunkId: string,
  ): Promise<AccountMergeRecoveryRead | null | "unavailable"> {
    try {
      const result =
        await this.env.ACCOUNT_MERGE_RECEIPTS.lookupAccountMergeRecovery({
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
      const recoveryDescriptor = Reflect.get(result, "recoveryDescriptor");
      if (receipt === null && recoveryDescriptor === null) return null;
      if (
        !validateContract("punks://contracts/account-merge.receipt@1", receipt)
          .valid ||
        typeof recoveryDescriptor !== "string"
      ) {
        return "unavailable";
      }
      const descriptor = parseStoredRecoveryDescriptor(recoveryDescriptor);
      if (
        descriptor === null ||
        !(await recoveryDescriptorMatchesReceipt(
          descriptor,
          receipt as AccountMergeReceipt,
        ))
      ) {
        return "unavailable";
      }
      return {
        receipt: receipt as AccountMergeReceipt,
        plan: descriptor.plan,
        manifest: descriptor.authorityManifest,
      };
    } catch {
      return "unavailable";
    }
  }

  private restorePlanFromRecovery(
    command: CommitAccountMergeCommand,
    recovery: AccountMergeRecoveryRead,
  ): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_intent (singleton, intent_id) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET intent_id = excluded.intent_id`,
        recovery.plan.intentId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO account_merge_plan
          (singleton, command_id, plan_id, plan_digest, plan_json,
           authority_manifest_json)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           command_id = excluded.command_id,
           plan_id = excluded.plan_id,
           plan_digest = excluded.plan_digest,
           plan_json = excluded.plan_json,
           authority_manifest_json = excluded.authority_manifest_json`,
        command.commandId,
        recovery.plan.planId,
        recovery.plan.planDigest,
        canonicalJson(recovery.plan),
        canonicalJson(recovery.manifest),
      );
    });
  }

  private async recordMergeReceipt(
    input: Omit<
      AccountMergeReceipt,
      "contract" | "schemaVersion" | "committedAt" | "receiptHash"
    >,
    recovery: StoredAccountMergeRecoveryDescriptor,
  ): Promise<AccountMergeReceipt | null | "conflict"> {
    try {
      const result =
        await this.env.ACCOUNT_MERGE_RECEIPTS.recordAccountMergeReceipt({
          ...input,
          recoveryDescriptor: canonicalJson(recovery),
        });
      if (
        typeof result !== "object" ||
        result === null ||
        Array.isArray(result) ||
        Reflect.get(result, "ok") !== true
      ) {
        return Reflect.get(result ?? {}, "code") === "conflict"
          ? "conflict"
          : null;
      }
      const receipt = Reflect.get(result, "receipt");
      return validateContract(
        "punks://contracts/account-merge.receipt@1",
        receipt,
      ).valid
        ? (receipt as AccountMergeReceipt)
        : null;
    } catch {
      return null;
    }
  }

  private markSagaCommitted(receipt: AccountMergeReceipt): void {
    this.ctx.storage.sql.exec(
      `UPDATE account_merge_saga
       SET status = 'committed', receipt_json = ?, committed_at = ?,
           last_failure_json = NULL, updated_at = ?
       WHERE singleton = 1 AND status = 'preparing'`,
      canonicalJson(receipt),
      receipt.committedAt,
      new Date().toISOString(),
    );
  }

  private recordSagaFailure(
    code: NonNullable<AccountMergeState["lastFailure"]>["code"],
    correlationId: string,
  ): void {
    const recordedAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE account_merge_saga SET last_failure_json = ?, updated_at = ?
       WHERE singleton = 1`,
      canonicalJson({ code, correlationId, recordedAt }),
      recordedAt,
    );
  }

  private async scheduleSagaAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + 1_000);
  }

  private commitSuccess(
    plan: AccountMergePlan,
    replayed: boolean,
  ): AccountMergeCommitResponse | null {
    const saga = this.saga();
    if (saga === undefined) return null;
    let receipt: AccountMergeReceipt | null = null;
    let lastFailure: AccountMergeState["lastFailure"] = null;
    try {
      receipt =
        saga.receipt_json === null
          ? null
          : (JSON.parse(saga.receipt_json) as AccountMergeReceipt);
      lastFailure =
        saga.last_failure_json === null
          ? null
          : (JSON.parse(
              saga.last_failure_json,
            ) as AccountMergeState["lastFailure"]);
    } catch {
      return null;
    }
    const status = saga.status as AccountMergeState["status"];
    const state: AccountMergeState = {
      contract: "account-merge.state@1",
      schemaVersion: 1,
      intentId: plan.intentId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      status,
      survivorPunkId: plan.survivorPunkId,
      absorbedPunkId: plan.absorbedPunkId,
      applicationCursor: saga.application_cursor,
      applicationTotal: saga.application_total,
      receipt,
      lastFailure,
      committedAt: saga.committed_at,
      completedAt: saga.completed_at,
      updatedAt: String(saga.updated_at),
    };
    const response: AccountMergeCommitResponse = {
      contract: "account-merge.commit-response@1",
      ok: true,
      state,
      replayed,
    };
    return validateContract(
      "punks://contracts/account-merge.commit-response@1",
      response,
    ).valid
      ? response
      : null;
  }

  /** Revokes one still-active proof; consumed proofs can never be revived. */
  revokeFreshProof(proofId: string): boolean {
    if (
      typeof proofId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        proofId,
      ) ||
      !this.hasTables()
    ) {
      return false;
    }
    const result = this.ctx.storage.sql.exec(
      `UPDATE account_merge_proof SET state = 'revoked'
       WHERE proof_id = ? AND state = 'active'`,
      proofId,
    );
    return result.rowsWritten === 1;
  }

  /**
   * Reads the immutable Plan for this intent. When supplied, `planId` must
   * match; omitting it supports recovery after an ambiguous RPC response.
   */
  readPlan(planId?: string): AccountMergePlan | null {
    if (
      (planId !== undefined && typeof planId !== "string") ||
      !this.hasTables()
    ) {
      return null;
    }
    const row = this.ctx.storage.sql
      .exec<PlanRow>(
        `SELECT command_id, plan_id, plan_json, authority_manifest_json
         FROM account_merge_plan
         WHERE singleton = 1`,
      )
      .toArray()[0];
    return row === undefined ||
      typeof row.plan_json !== "string" ||
      (planId !== undefined && row.plan_id !== planId)
      ? null
      : this.parsePlan(row.plan_json);
  }

  override async alarm(): Promise<void> {
    if (!this.hasTables() || this.plan() === undefined) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const row = this.plan();
    const plan =
      row === undefined || typeof row.plan_json !== "string"
        ? null
        : this.parsePlan(row.plan_json);
    const manifest = parseStoredManifest(row?.authority_manifest_json ?? null);
    const saga = this.saga();
    if (
      plan !== null &&
      manifest !== null &&
      saga !== undefined &&
      saga.status !== "completed"
    ) {
      await this.advanceMergeSaga(plan, manifest, "account-merge-alarm");
      return;
    }
    await this.ctx.storage.deleteAlarm();
  }

  private intent(): IntentRow | undefined {
    return this.ctx.storage.sql
      .exec<IntentRow>(
        "SELECT intent_id FROM account_merge_intent WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private proof(proofId: string): ProofRow | undefined {
    return this.ctx.storage.sql
      .exec<ProofRow>(
        `SELECT proof_id, account_role, punk_id, source_session_id,
                descriptor_json, state
         FROM account_merge_proof
         WHERE proof_id = ?`,
        proofId,
      )
      .toArray()[0];
  }

  private proofs(): ProofRow[] {
    return this.ctx.storage.sql
      .exec<ProofRow>(
        `SELECT proof_id, account_role, punk_id, source_session_id,
                descriptor_json, state
         FROM account_merge_proof
         ORDER BY account_role`,
      )
      .toArray();
  }

  private plan(): PlanRow | undefined {
    return this.ctx.storage.sql
      .exec<PlanRow>(
        `SELECT command_id, plan_id, plan_json, authority_manifest_json
         FROM account_merge_plan
         WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private saga(): SagaRow | undefined {
    return this.ctx.storage.sql
      .exec<SagaRow>(
        `SELECT commit_command_id, command_json, status, application_cursor,
                application_total, receipt_json, last_failure_json,
                committed_at, completed_at, updated_at
         FROM account_merge_saga WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private hasTables(): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'account_merge_intent'`,
        )
        .toArray()[0] !== undefined
    );
  }

  private parsePlan(planJson: string): AccountMergePlan | null {
    try {
      const plan = JSON.parse(planJson);
      return validateContract("punks://contracts/account-merge.plan@1", plan)
        .valid
        ? (plan as AccountMergePlan)
        : null;
    } catch {
      return null;
    }
  }
}
