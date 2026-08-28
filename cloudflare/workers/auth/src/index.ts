import type { AuthEnv } from "./env";
import { route } from "./router";
import {
  aggregateName,
  canonicalPunk,
  ensureSessionForToken,
  getActiveSession,
  resolveActivePunk,
} from "./session";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type AccountMergeFreshProof,
  type AccountMergeCommitResponse,
  type AccountMergePlan,
  type AccountMergePlanResponse,
  type AuthSession,
  type Punk,
  validateContract,
} from "@punks/contracts";
import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "@punks/core";
import { mintBotInvocation, verifyBotInvocation } from "./bot-invocation";
import { randomToken } from "./crypto";
import type {
  AccountMergeRightsChangeInput,
  AccountMergeWorkspaceRole,
  CommitAccountMergeRightsChangeInput,
  PunkProfileUpdateResult,
} from "./punk-do";

export { AuthTransactionDO } from "./auth-transaction-do";
export { AccountMergeIntentDO } from "./account-merge-intent-do";

/** Dedicated private probe for the version executing this Auth Worker. */
export class RuntimeIdentityService extends WorkerEntrypoint<AuthEnv> {
  override fetch(): Response {
    return privateNotFound();
  }

  runtimeVersion(): { versionId: string } {
    return { versionId: this.env.CF_VERSION_METADATA.id };
  }
}
export { DesktopAuthFlowDO } from "./desktop-auth-flow-do";
export { DesktopReauthGrantDO } from "./desktop-reauth-grant-do";
export { EmailClaimDO } from "./email-claim-do";
export { IdentityClaimDO } from "./identity-claim-do";
export { PunkDO } from "./punk-do";
export { PromotionAuthorityFaultService } from "./promotion-authority-fault-service";
export { PromotionAuthProofService } from "./promotion-auth-proof-service";
export { SessionDO } from "./session-do";
export { SessionRevocationDO } from "./session-revocation-do";
export { SessionRotationDO } from "./session-rotation-do";

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function activePunkProfile(
  punk: Omit<Punk, "identities"> & {
    identities: readonly Punk["identities"][number][];
  },
): Punk | null {
  const identities = punk.identities.filter(
    (identity) =>
      identity.provider === "google" || identity.provider === "github",
  );
  const [first, ...rest] = identities;
  return first === undefined ? null : { ...punk, identities: [first, ...rest] };
}

/** Private request that binds one account role to a recent Session proof. */
export interface RecordAccountMergeFreshProofInput {
  readonly intentId: string;
  readonly accountRole: "survivor" | "absorbed";
  readonly sessionId: string;
  readonly holderBindingToken: string;
}

/** Private authority input for one canonical intent Plan. */
export interface PrepareAccountMergePlanAuthorityInput {
  readonly intentId: string;
  readonly command: unknown;
  readonly correlationId: string;
}

/** Private authority input for the irreversible Plan commit. */
export interface CommitAccountMergePlanAuthorityInput {
  readonly intentId: string;
  readonly command: unknown;
  readonly callerSessionId: string;
  readonly correlationId: string;
}

function exactObjectKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export type BotInvocationIssuerProps = {
  role: "punks-bot-runtime";
  environment: "local" | "staging" | "production";
};

export type LocalDevBootstrapProps = {
  role: "punks-local-dev-bootstrap";
  environment: "local";
};

/** Exact service-binding capability required by the account-merge planner. */
export type AccountMergePlannerProps = {
  role: "punks-account-merge-planner";
  environment: "local" | "staging" | "production";
};

/** Exact capability accepted from the authoritative Workspace writer. */
export type AccountMergeRightsIndexWriterProps = {
  role: "punks-account-merge-rights-index-writer";
  environment: "local" | "staging" | "production";
};

/** Exact capability allowed to consume a strong Workspace ownership grant. */
export type WorkspaceOwnershipAuthorizationProps = {
  role: "punks-workspace-ownership-authorizer";
  environment: "local" | "staging" | "production";
};

/** One bounded Workspace membership change for exactly one Punk. */
export interface WorkspaceMembershipIndexChange
  extends CommitAccountMergeRightsChangeInput {}

const LOCAL_DEV_PUNK_ID = "019913d8-1254-811e-8c0f-43aac49f3b21";
const LOCAL_DEV_SESSION_TOKEN =
  "punks-local-dev-session-v1-00000000000000000000000000000000";

function privateNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function hasExactIssuerProps(
  value: unknown,
  environment: AuthEnv["ENVIRONMENT"],
): value is BotInvocationIssuerProps {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-bot-runtime" &&
    props.environment === environment
  );
}

function hasExactLocalDevProps(
  value: unknown,
  environment: AuthEnv["ENVIRONMENT"],
): value is LocalDevBootstrapProps {
  if (
    environment !== "local" ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-local-dev-bootstrap" &&
    props.environment === "local"
  );
}

function hasExactAccountMergePlannerProps(
  value: unknown,
  environment: AuthEnv["ENVIRONMENT"],
): value is AccountMergePlannerProps {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-account-merge-planner" &&
    props.environment === environment
  );
}

function hasExactAccountMergeRightsIndexWriterProps(
  value: unknown,
  environment: AuthEnv["ENVIRONMENT"],
): value is AccountMergeRightsIndexWriterProps {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-account-merge-rights-index-writer" &&
    props.environment === environment
  );
}

function hasExactWorkspaceOwnershipAuthorizationProps(
  value: unknown,
  environment: AuthEnv["ENVIRONMENT"],
): value is WorkspaceOwnershipAuthorizationProps {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-workspace-ownership-authorizer" &&
    props.environment === environment
  );
}

function workspaceMembershipIndexChange(
  value: unknown,
): WorkspaceMembershipIndexChange | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactObjectKeys(value, [
      "membership",
      "operationId",
      "punkId",
      "workspaceId",
    ])
  ) {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.operationId !== "string" ||
    !uuidPattern.test(input.operationId) ||
    typeof input.workspaceId !== "string" ||
    !uuidPattern.test(input.workspaceId) ||
    typeof input.punkId !== "string" ||
    !uuidPattern.test(input.punkId)
  ) {
    return null;
  }
  let membership: WorkspaceMembershipIndexChange["membership"] = null;
  if (input.membership !== null) {
    if (
      typeof input.membership !== "object" ||
      Array.isArray(input.membership) ||
      !exactObjectKeys(input.membership, ["revision", "role"])
    ) {
      return null;
    }
    const candidate = input.membership as Record<string, unknown>;
    if (
      typeof candidate.role !== "string" ||
      !["owner", "moderator", "member", "guest"].includes(candidate.role) ||
      !Number.isSafeInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      Number(candidate.revision) > 2_147_483_647
    ) {
      return null;
    }
    membership = {
      role: candidate.role as AccountMergeWorkspaceRole,
      revision: Number(candidate.revision),
    };
  }
  return {
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    punkId: input.punkId,
    membership,
  };
}

/** Local-only capability that provisions the deterministic development Punk. */
export class LocalDevAuthBootstrapService extends WorkerEntrypoint<
  AuthEnv,
  LocalDevBootstrapProps
> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  async bootstrap() {
    if (!hasExactLocalDevProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return { ok: false as const, code: "invalid_request" as const };
    }
    const now = new Date().toISOString();
    const result = await this.env.PUNKS.getByName(LOCAL_DEV_PUNK_ID).provision({
      punkId: LOCAL_DEV_PUNK_ID,
      identity: {
        profile: {
          provider: "github",
          subject: "punks-local-development",
          verifiedEmail: "punk-local@localhost.invalid",
          displayName: "Punk local",
          avatarUrl: null,
          username: "punk-local",
        },
        subjectHash: "1".repeat(64),
        emailHash: "2".repeat(64),
      },
      now,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        code: "temporarily_unavailable" as const,
      };
    }
    const session = await ensureSessionForToken(
      this.env,
      canonicalPunk(result.state),
      LOCAL_DEV_SESSION_TOKEN,
      "local-dev",
    );
    return {
      ok: true as const,
      session: session.value,
      cookie: session.cookie,
    };
  }
}

/** Session-only capability entrypoint for trusted Punks Workers. */
export class PunkSessionService extends WorkerEntrypoint<AuthEnv> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  /**
   * Issues one short-lived, source-SHA-bound desktop Session for the protected
   * staging promotion harness. This private RPC never exposes a general login
   * or accepts a production environment.
   */
  async issuePromotionSession(input: unknown): Promise<{
    source_sha: string;
    cookie: string;
    metadata: {
      session_id: string;
      punk_id: string;
      expires_at_seconds: number;
      last_renewed_at_seconds: null;
    };
    revoke_capability: string;
    revoke_expires_at_seconds: number;
  } | null> {
    if (
      this.env.PROMOTION_SESSION_ISSUANCE_ENABLED !== "true" ||
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "sourceSha"
    ) {
      return null;
    }
    const sourceSha = Reflect.get(input, "sourceSha");
    if (typeof sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(sourceSha)) {
      return null;
    }
    const punkId = await deriveOpaqueUuid(
      "punks.auth.promotion-punk.v1",
      this.env.ENVIRONMENT,
    );
    const subject = `promotion-${this.env.ENVIRONMENT}`;
    const verifiedEmail = `promotion-${this.env.ENVIRONMENT}@punks.bot`;
    const provisioned = await this.env.PUNKS.getByName(punkId).provision({
      punkId,
      identity: {
        profile: {
          provider: "github",
          subject,
          verifiedEmail,
          displayName: "Punks Promotion",
          avatarUrl: null,
          username: "punks-promotion",
        },
        subjectHash: await sha256Hex(subject),
        emailHash: await sha256Hex(verifiedEmail),
      },
      now: new Date().toISOString(),
    });
    if (!provisioned.ok || provisioned.state.id !== punkId) return null;

    const session = await ensureSessionForToken(
      this.env,
      canonicalPunk(provisioned.state),
      randomToken(32),
      "host",
      "desktop",
    );
    const revokeCapability = randomToken(32);
    const revocation = this.env.SESSION_REVOCATIONS.getByName(
      await aggregateName("session-revocation", revokeCapability),
    );
    if (
      !(await revocation.create({
        sessionId: session.value.sessionId,
        expiresAt: session.value.expiresAt,
      }))
    ) {
      await this.env.SESSIONS.getByName(session.value.sessionId).revoke();
      return null;
    }
    const expiresAtSeconds = Math.floor(
      Date.parse(session.value.expiresAt) / 1_000,
    );
    const cookie = session.cookie.split(";", 1)[0] ?? "";
    return {
      source_sha: sourceSha,
      cookie,
      metadata: {
        session_id: session.value.sessionId,
        punk_id: session.value.punkId,
        expires_at_seconds: expiresAtSeconds,
        last_renewed_at_seconds: null,
      },
      revoke_capability: revokeCapability,
      revoke_expires_at_seconds: expiresAtSeconds,
    };
  }

  async resolveSessionId(sessionId: string): Promise<AuthSession | null> {
    if (typeof sessionId !== "string" || !opaqueUuidPattern.test(sessionId)) {
      return null;
    }
    try {
      const record = await this.env.SESSIONS.getByName(sessionId).get();
      if (
        record === null ||
        record.sessionId !== sessionId ||
        !opaqueUuidPattern.test(record.punkId)
      ) {
        return null;
      }
      const punk = await this.env.PUNKS.getByName(record.punkId).query();
      if (!punk.ok || punk.state.id !== record.punkId) {
        return null;
      }
      const session: AuthSession = {
        ...record,
        punk: {
          id: punk.state.id,
          displayName: punk.state.displayName,
          avatarUrl: punk.state.avatarUrl,
        },
      };
      return validateContract("punks://contracts/auth.session@1", session).valid
        ? session
        : null;
    } catch {
      return null;
    }
  }

  async resolveSessionCookie(cookie: string): Promise<AuthSession | null> {
    if (cookie.length === 0 || cookie.length > 8_192) {
      return null;
    }
    const current = await getActiveSession(
      new Request(`${this.env.AUTH_BASE_URL}/api/auth/v1/session`, {
        headers: { cookie },
      }),
      this.env,
    );
    if (current === null) {
      return null;
    }
    return {
      ...current.record,
      punk: {
        id: current.punk.id,
        displayName: current.punk.displayName,
        avatarUrl: current.punk.avatarUrl,
      },
    };
  }

  async punkExists(punkId: string): Promise<boolean> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        punkId,
      )
    ) {
      return false;
    }
    return (await this.env.PUNKS.getByName(punkId).query()).ok;
  }

  async getPunkProfile(punkId: string): Promise<Punk | null> {
    if (!uuidPattern.test(punkId)) return null;
    try {
      const result = await this.env.PUNKS.getByName(punkId).query();
      if (
        !result.ok ||
        result.state.id !== punkId ||
        !validateContract("punks://contracts/punk@1", result.state).valid
      ) {
        return null;
      }
      return activePunkProfile(result.state);
    } catch {
      return null;
    }
  }

  async updatePunkProfile(
    punkId: string,
    command: unknown,
  ): Promise<PunkProfileUpdateResult> {
    if (!uuidPattern.test(punkId)) {
      return { ok: false, code: "invalid_input" };
    }
    try {
      const result =
        await this.env.PUNKS.getByName(punkId).updateProfile(command);
      if (result.ok) {
        if (
          result.state.id !== punkId ||
          !validateContract("punks://contracts/punk@1", result.state).valid
        ) {
          return { ok: false, code: "inactive" };
        }
        const profile = activePunkProfile(result.state);
        if (profile === null) return { ok: false, code: "inactive" };
        return {
          ok: true,
          state: profile,
          replayed: result.replayed,
        };
      }
      return result as PunkProfileUpdateResult;
    } catch {
      return { ok: false, code: "inactive" };
    }
  }

  async resolvePunkSummary(punkId: string): Promise<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    revision: number;
    updatedAt: string;
  } | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        punkId,
      )
    ) {
      return null;
    }
    const state = await resolveActivePunk(this.env, punkId);
    return state === null
      ? null
      : {
          id: state.id,
          displayName: state.displayName,
          avatarUrl: state.avatarUrl,
          revision: state.revision,
          updatedAt: state.updatedAt,
        };
  }
}

/** Mutation-only capability for one desktop-sealed ownership authorization. */
export class WorkspaceOwnershipAuthorizationService extends WorkerEntrypoint<
  AuthEnv,
  WorkspaceOwnershipAuthorizationProps
> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  async consume(input: unknown): Promise<boolean> {
    if (
      !hasExactWorkspaceOwnershipAuthorizationProps(
        this.ctx.props,
        this.env.ENVIRONMENT,
      ) ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, [
        "authorizationId",
        "commandId",
        "expectedRevision",
        "punkId",
        "sessionId",
        "targetPunkId",
        "workspaceId",
      ])
    ) {
      return false;
    }
    const request = input as Record<string, unknown>;
    if (
      typeof request.authorizationId !== "string" ||
      !uuidPattern.test(request.authorizationId) ||
      typeof request.commandId !== "string" ||
      !uuidPattern.test(request.commandId) ||
      typeof request.punkId !== "string" ||
      !uuidPattern.test(request.punkId) ||
      typeof request.sessionId !== "string" ||
      !opaqueUuidPattern.test(request.sessionId) ||
      typeof request.workspaceId !== "string" ||
      !uuidPattern.test(request.workspaceId) ||
      typeof request.targetPunkId !== "string" ||
      !uuidPattern.test(request.targetPunkId) ||
      typeof request.expectedRevision !== "number" ||
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 1
    ) {
      return false;
    }
    try {
      const session = await this.env.SESSIONS.getByName(
        request.sessionId,
      ).get();
      if (
        session?.sessionId !== request.sessionId ||
        session.punkId !== request.punkId ||
        !(await this.env.PUNKS.getByName(request.punkId).query()).ok
      ) {
        return false;
      }
      const consumed = await this.env.DESKTOP_REAUTH_GRANTS.getByName(
        request.authorizationId,
      ).consume({
        authorizationId: request.authorizationId,
        sessionId: request.sessionId,
        punkId: request.punkId,
        targetMethod: "transfer_workspace_ownership",
        workspaceOwnershipTransfer: {
          workspaceId: request.workspaceId,
          targetPunkId: request.targetPunkId,
          expectedRevision: request.expectedRevision,
        },
        flowId: request.commandId,
      });
      return consumed.ok;
    } catch {
      return false;
    }
  }
}

/** Private capability that serializes Workspace membership index changes. */
export class AccountMergeRightsIndexService extends WorkerEntrypoint<
  AuthEnv,
  AccountMergeRightsIndexWriterProps
> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  #change(input: unknown): WorkspaceMembershipIndexChange | null {
    return hasExactAccountMergeRightsIndexWriterProps(
      this.ctx.props,
      this.env.ENVIRONMENT,
    )
      ? workspaceMembershipIndexChange(input)
      : null;
  }

  async prepareWorkspaceMembershipChange(input: unknown): Promise<boolean> {
    const change = this.#change(input);
    if (change === null) return false;
    const coordinate: AccountMergeRightsChangeInput = {
      operationId: change.operationId,
      workspaceId: change.workspaceId,
      punkId: change.punkId,
    };
    try {
      return await this.env.PUNKS.getByName(
        change.punkId,
      ).prepareAccountMergeRightsChange(coordinate);
    } catch {
      return false;
    }
  }

  async commitWorkspaceMembershipChange(input: unknown): Promise<boolean> {
    const change = this.#change(input);
    if (change === null) return false;
    try {
      return await this.env.PUNKS.getByName(
        change.punkId,
      ).commitAccountMergeRightsChange(change);
    } catch {
      return false;
    }
  }

  async abortWorkspaceMembershipChange(input: unknown): Promise<boolean> {
    const change = this.#change(input);
    if (change === null) return false;
    const coordinate: AccountMergeRightsChangeInput = {
      operationId: change.operationId,
      workspaceId: change.workspaceId,
      punkId: change.punkId,
    };
    try {
      return await this.env.PUNKS.getByName(
        change.punkId,
      ).abortAccountMergeRightsChange(coordinate);
    } catch {
      return false;
    }
  }
}

/** Dedicated private capability for canonical account-merge preparation. */
export class AccountMergePlanningService extends WorkerEntrypoint<
  AuthEnv,
  AccountMergePlannerProps
> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  #allowed(): boolean {
    return hasExactAccountMergePlannerProps(
      this.ctx.props,
      this.env.ENVIRONMENT,
    );
  }

  /**
   * Mints and records one proof only from a live, server-recorded recent
   * reauthentication. The canonical Durable Object name is always `intentId`.
   */
  async recordAccountMergeFreshProof(
    input: unknown,
  ): Promise<AccountMergeFreshProof | null> {
    if (
      !this.#allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, [
        "accountRole",
        "holderBindingToken",
        "intentId",
        "sessionId",
      ])
    ) {
      return null;
    }
    const request = input as RecordAccountMergeFreshProofInput;
    if (
      !uuidPattern.test(request.intentId) ||
      !opaqueUuidPattern.test(request.sessionId) ||
      (request.accountRole !== "survivor" &&
        request.accountRole !== "absorbed") ||
      typeof request.holderBindingToken !== "string" ||
      request.holderBindingToken.length < 32 ||
      request.holderBindingToken.length > 256 ||
      /\s/.test(request.holderBindingToken)
    ) {
      return null;
    }
    const session = this.env.SESSIONS.getByName(request.sessionId);
    const context = await session.claimAccountMergeProof({
      intentId: request.intentId,
      accountRole: request.accountRole,
    });
    if (context === null || context.sessionId !== request.sessionId) {
      return null;
    }
    const punk = await this.env.PUNKS.getByName(context.punkId).query();
    if (!punk.ok || punk.state.status !== "active") return null;
    const holderBindingHash = await sha256Hex(
      canonicalJson({
        intentId: request.intentId,
        holderBindingToken: request.holderBindingToken,
      }),
    );
    const proof: AccountMergeFreshProof = {
      contract: "account-merge.fresh-proof@1",
      proofId: await deriveOpaqueUuid(
        "punks.account-merge-proof.v1",
        canonicalJson({
          accountRole: request.accountRole,
          authenticatedAt: context.authenticatedAt,
          intentId: request.intentId,
          sessionId: request.sessionId,
        }),
      ),
      intentId: request.intentId,
      accountRole: request.accountRole,
      punkId: context.punkId,
      accountRevision: punk.state.revision,
      holderBindingHash,
      authenticationMethod: context.authenticationMethod,
      providerSubjectBindingHash: context.providerSubjectBindingHash,
      authenticatedAt: context.authenticatedAt,
      expiresAt: context.expiresAt,
      validForSeconds: 300,
    };
    if (
      !validateContract("punks://contracts/account-merge.fresh-proof@1", proof)
        .valid
    ) {
      return null;
    }
    const recorded = await this.env.ACCOUNT_MERGE_INTENTS.getByName(
      request.intentId,
    ).recordFreshProof(proof, { sourceSessionId: request.sessionId });
    return recorded ? proof : null;
  }

  /** Revokes one active proof in the single authority named by its intent. */
  async revokeAccountMergeFreshProof(input: unknown): Promise<boolean> {
    if (
      !this.#allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, ["intentId", "proofId"])
    ) {
      return false;
    }
    const intentId = Reflect.get(input, "intentId");
    const proofId = Reflect.get(input, "proofId");
    return typeof intentId === "string" &&
      uuidPattern.test(intentId) &&
      typeof proofId === "string" &&
      opaqueUuidPattern.test(proofId)
      ? this.env.ACCOUNT_MERGE_INTENTS.getByName(intentId).revokeFreshProof(
          proofId,
        )
      : false;
  }

  /** Prepares one Plan through the canonical intent authority. */
  async prepareAccountMergePlan(
    input: PrepareAccountMergePlanAuthorityInput,
  ): Promise<AccountMergePlanResponse> {
    if (
      !this.#allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, ["command", "correlationId", "intentId"]) ||
      typeof input?.intentId !== "string" ||
      !uuidPattern.test(input.intentId) ||
      typeof input.correlationId !== "string" ||
      typeof input.command !== "object" ||
      input.command === null ||
      Reflect.get(input.command, "intentId") !== input.intentId
    ) {
      return {
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        correlationId: "account-merge",
      };
    }
    return this.env.ACCOUNT_MERGE_INTENTS.getByName(input.intentId).preparePlan(
      {
        command: input.command,
        correlationId: input.correlationId,
      },
    );
  }

  /** Reads the current immutable Plan after a retry or ambiguous response. */
  async readAccountMergePlan(
    intentId: string,
  ): Promise<AccountMergePlan | null> {
    return this.#allowed() &&
      typeof intentId === "string" &&
      uuidPattern.test(intentId)
      ? this.env.ACCOUNT_MERGE_INTENTS.getByName(intentId).readPlan()
      : null;
  }

  /** Commits one exact Plan through its canonical intent authority. */
  async commitAccountMergePlan(
    input: unknown,
  ): Promise<AccountMergeCommitResponse> {
    if (
      !this.#allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, [
        "callerSessionId",
        "command",
        "correlationId",
        "intentId",
      ])
    ) {
      return {
        contract: "account-merge.commit-response@1",
        ok: false,
        code: "invalid_request",
        correlationId: "account-merge",
      };
    }
    const request = input as CommitAccountMergePlanAuthorityInput;
    if (
      !uuidPattern.test(request.intentId) ||
      !opaqueUuidPattern.test(request.callerSessionId) ||
      typeof request.correlationId !== "string" ||
      request.correlationId.length === 0 ||
      request.correlationId.length > 128 ||
      typeof request.command !== "object" ||
      request.command === null ||
      Reflect.get(request.command, "intentId") !== request.intentId
    ) {
      return {
        contract: "account-merge.commit-response@1",
        ok: false,
        code: "invalid_request",
        correlationId: "account-merge",
      };
    }
    return this.env.ACCOUNT_MERGE_INTENTS.getByName(
      request.intentId,
    ).commitPlan({
      command: request.command,
      callerSessionId: request.callerSessionId,
      correlationId: request.correlationId,
    });
  }

  /** Reads post-commit progress after an ambiguous response or reauthentication. */
  async readAccountMergeState(
    input: unknown,
  ): Promise<AccountMergeCommitResponse> {
    if (
      !this.#allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !exactObjectKeys(input, ["callerPunkId", "intentId", "planId"])
    ) {
      return {
        contract: "account-merge.commit-response@1",
        ok: false,
        code: "invalid_request",
        correlationId: "account-merge-read",
      };
    }
    const intentId = Reflect.get(input, "intentId");
    const planId = Reflect.get(input, "planId");
    const callerPunkId = Reflect.get(input, "callerPunkId");
    if (
      typeof intentId !== "string" ||
      !uuidPattern.test(intentId) ||
      typeof planId !== "string" ||
      !opaqueUuidPattern.test(planId) ||
      typeof callerPunkId !== "string" ||
      !uuidPattern.test(callerPunkId)
    ) {
      return {
        contract: "account-merge.commit-response@1",
        ok: false,
        code: "invalid_request",
        correlationId: "account-merge-read",
      };
    }
    return this.env.ACCOUNT_MERGE_INTENTS.getByName(intentId).readMergeState({
      planId,
      callerPunkId,
    });
  }
}

/** Mint-only capability held exclusively by the private Punks Bot Runtime. */
export class BotInvocationIssuer extends WorkerEntrypoint<
  AuthEnv,
  BotInvocationIssuerProps
> {
  async mintBotInvocation(input: unknown) {
    if (!hasExactIssuerProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return { ok: false as const, code: "invalid_request" as const };
    }
    return mintBotInvocation(input, this.env);
  }

  override fetch(_request: Request): Response {
    return privateNotFound();
  }
}

/** Verify-only capability used by the Bot action authority. */
export class BotInvocationVerifier extends WorkerEntrypoint<AuthEnv> {
  async verifyBotInvocation(input: unknown) {
    return verifyBotInvocation(input, this.env);
  }

  override fetch(_request: Request): Response {
    return privateNotFound();
  }
}

export default {
  fetch(request: Request, env: AuthEnv): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<AuthEnv>;
