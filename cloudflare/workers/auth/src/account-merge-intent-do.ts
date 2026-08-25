import type {
  AccountMergeFreshProof,
  AccountMergePlan,
  AccountMergePlanResponse,
  Punk,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  prepareAccountMergePlan,
  sha256Hex,
  type AccountMergeAuthoritativeProof,
  type AccountMergePunkSnapshot,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";

type IntentRow = Record<"intent_id", string>;
type ProofRow = Record<
  "proof_id" | "punk_id" | "source_session_id" | "descriptor_json" | "state",
  string
>;
type PlanRow = Record<"command_id" | "plan_id" | "plan_json", string>;

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
    if (identity.provider === "passkey") {
      claims.push({
        claimBindingHash: await sha256Hex(
          canonicalJson({
            kind: "passkey-credential",
            provider: "passkey",
            value: identity.credentialId,
          }),
        ),
        kind: "passkey-credential",
        provider: "passkey",
        punkId: punk.id,
        revision: punk.revision,
      });
    }
  }
  return claims;
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
        plan_json TEXT NOT NULL
      ) STRICT;
    `);
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
          `SELECT proof_id, punk_id, source_session_id, descriptor_json, state
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
          potentialClaimCount +=
            1 +
            (identity.verifiedEmail === null ? 0 : 1) +
            (identity.provider === "passkey" ? 1 : 0);
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
                sourceHandoff = await this.env.PASSKEY_CEREMONIES.getByName(
                  indexedHandoff.handoffId,
                ).readForAccountMerge();
                break;
              case "reauth-authorization":
              case "session-renewal":
                return unavailable(correlationId);
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
          (singleton, command_id, plan_id, plan_digest, plan_json)
         VALUES (1, ?, ?, ?, ?)`,
          command.commandId,
          response.plan.planId,
          response.plan.planDigest,
          canonicalJson(response.plan),
        );
        return true;
      });
      if (persisted) this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
      return persisted ? response : unavailable(correlationId);
    } catch (error) {
      return internalFailure(correlationId, error);
    }
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
        `SELECT command_id, plan_id, plan_json FROM account_merge_plan
         WHERE singleton = 1`,
      )
      .toArray()[0];
    return row === undefined || (planId !== undefined && row.plan_id !== planId)
      ? null
      : this.parsePlan(row.plan_json);
  }

  override async alarm(): Promise<void> {
    if (!this.hasTables() || this.plan() === undefined) {
      await this.ctx.storage.deleteAll();
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
        `SELECT proof_id, punk_id, source_session_id, descriptor_json, state
         FROM account_merge_proof
         WHERE proof_id = ?`,
        proofId,
      )
      .toArray()[0];
  }

  private proofs(): ProofRow[] {
    return this.ctx.storage.sql
      .exec<ProofRow>(
        `SELECT proof_id, punk_id, source_session_id, descriptor_json, state
         FROM account_merge_proof
         ORDER BY account_role`,
      )
      .toArray();
  }

  private plan(): PlanRow | undefined {
    return this.ctx.storage.sql
      .exec<PlanRow>(
        `SELECT command_id, plan_id, plan_json FROM account_merge_plan
         WHERE singleton = 1`,
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
