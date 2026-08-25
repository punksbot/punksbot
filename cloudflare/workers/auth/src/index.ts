import type { AuthEnv } from "./env";
import { route } from "./router";
import {
  canonicalPunk,
  ensureSessionForToken,
  getActiveSession,
} from "./session";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type AccountMergeFreshProof,
  type AccountMergePlan,
  type AccountMergePlanResponse,
  type AuthSession,
  type Punk,
  validateContract,
} from "@punks/contracts";
import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "@punks/core";
import { mintBotInvocation, verifyBotInvocation } from "./bot-invocation";
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
export { PasskeyCeremonyDO } from "./passkey-ceremony-do";
export { PasskeyCredentialDO } from "./passkey-credential-do";
export { PunkDO } from "./punk-do";
export { SessionDO } from "./session-do";
export { SessionRevocationDO } from "./session-revocation-do";
export { SessionRotationDO } from "./session-rotation-do";

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
      return result.state as unknown as Punk;
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
        return {
          ok: true,
          state: result.state as unknown as Punk,
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
    const seen = new Set<string>();
    let currentId = punkId;
    for (let hop = 0; hop < 2; hop += 1) {
      if (seen.has(currentId)) return null;
      seen.add(currentId);
      let state: Punk | null;
      try {
        const raw =
          await this.env.PUNKS.getByName(currentId).readForResolution();
        state =
          raw !== null &&
          validateContract("punks://contracts/punk@1", raw).valid
            ? (raw as unknown as Punk)
            : null;
      } catch {
        return null;
      }
      if (state === null || state.id !== currentId) return null;
      if (state.status === "active") {
        return {
          id: state.id,
          displayName: state.displayName,
          avatarUrl: state.avatarUrl,
          revision: state.revision,
          updatedAt: state.updatedAt,
        };
      }
      if (
        state.status !== "merged" ||
        state.mergedInto === null ||
        !uuidPattern.test(state.mergedInto)
      ) {
        return null;
      }
      currentId = state.mergedInto;
    }
    return null;
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
