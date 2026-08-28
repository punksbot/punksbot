import type {
  AccountMergeFreshProof,
  AccountMergePlan,
  AccountMergePlanResponse,
  CreateAccountMergePlanCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "./json";
import { rolePermissions, type WorkspaceRole } from "./permissions";

/** Maximum lifetime of one fresh account-merge proof. */
export const ACCOUNT_MERGE_PROOF_MAX_AGE_MS = 5 * 60 * 1_000;

const PLAN_ID_NAMESPACE = "punks.account-merge-plan.v1";
const MAX_PLAN_CLAIMS = 64;
const MAX_PLAN_RIGHTS = 512;
const MAX_PLAN_SESSIONS = 128;
const MAX_PLAN_HANDOFFS = 64;
const MAX_PLAN_CONFLICTS = 256;

type ClaimKind = AccountMergePlan["claims"][number]["kind"];
type ClaimProvider = AccountMergePlan["claims"][number]["provider"];
type RightKind = AccountMergePlan["rights"][number]["kind"];
type ClientKind = AccountMergePlan["sessions"][number]["clientKind"];
type HandoffKind = AccountMergePlan["handoffs"][number]["kind"];
type HandoffState = AccountMergePlan["handoffs"][number]["state"];
type Origin = AccountMergePlan["claims"][number]["origin"];

const RIGHT_MERGE_STRATEGIES = Object.freeze({
  "workspace-membership": "strongest-role",
  "workspace-invitation": "retarget",
  "account-owned-resource": "transfer-or-block",
  "local-resource-binding": "invalidate",
  "local-tool-authorization": "invalidate",
  "repository-access-proof": "invalidate",
} as const satisfies Record<RightKind, string>);

const CLAIM_KINDS = new Set<ClaimKind>(["provider-subject", "verified-email"]);
const CLAIM_PROVIDERS = new Set<ClaimProvider>(["google", "github"]);
const RIGHT_KINDS = new Set<RightKind>(
  Object.keys(RIGHT_MERGE_STRATEGIES) as RightKind[],
);
const CLIENT_KINDS = new Set<ClientKind>([
  "browser",
  "desktop",
  "mobile",
  "api",
]);
const HANDOFF_KINDS = new Set<HandoffKind>([
  "desktop-auth-flow",
  "oauth-transaction",
  "reauth-authorization",
  "session-renewal",
  "account-link",
]);
const HANDOFF_STATES = new Set<HandoffState>([
  "pending",
  "prepared",
  "deliverable",
]);
const WORKSPACE_ROLES = new Set<WorkspaceRole>([
  "owner",
  "moderator",
  "member",
  "guest",
]);

/** Server-owned state attached to one public fresh-proof descriptor. */
export interface AccountMergeAuthoritativeProof {
  readonly descriptor: AccountMergeFreshProof;
  readonly state: "active" | "revoked" | "consumed";
}

/** Authority snapshot for one claim belonging to a Compte Punks. */
export interface AccountMergeClaimSnapshot {
  readonly claimBindingHash: string;
  readonly kind: ClaimKind;
  readonly provider: ClaimProvider;
  readonly punkId: string;
  readonly revision: number;
}

/** Authority snapshot for one account-scoped right. */
export interface AccountMergeRightSnapshot {
  readonly rightBindingHash: string;
  readonly kind: RightKind;
  readonly authorityBindingHash: string;
  readonly punkId: string;
  readonly role: WorkspaceRole | null;
  readonly revision: number;
}

/** Authority snapshot for one session that the future merge must revoke. */
export interface AccountMergeSessionSnapshot {
  readonly sessionBindingHash: string;
  readonly punkId: string;
  readonly clientKind: ClientKind;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

/** Authority snapshot for one handoff that the future merge must cancel. */
export interface AccountMergeHandoffSnapshot {
  readonly handoffBindingHash: string;
  readonly punkId: string;
  readonly kind: HandoffKind;
  readonly state: HandoffState;
  readonly expiresAt: string;
}

/** Complete read-only inventory for one Compte Punks at an exact revision. */
export interface AccountMergePunkSnapshot {
  readonly punkId: string;
  readonly status: "active" | "merged";
  readonly revision: number;
  readonly claims: readonly AccountMergeClaimSnapshot[];
  readonly rights: readonly AccountMergeRightSnapshot[];
  readonly sessions: readonly AccountMergeSessionSnapshot[];
  readonly handoffs: readonly AccountMergeHandoffSnapshot[];
}

/** Inputs read from the contract boundary and authoritative stores. */
export interface PrepareAccountMergePlanInput {
  readonly command: unknown;
  readonly now: Date;
  readonly correlationId: string;
  readonly authoritativeProofs: readonly AccountMergeAuthoritativeProof[];
  readonly punks: readonly AccountMergePunkSnapshot[];
}

interface BoundMergeInput {
  command: CreateAccountMergePlanCommand;
  survivor: AccountMergePunkSnapshot;
  absorbed: AccountMergePunkSnapshot;
  survivorProof: AccountMergeFreshProof;
  absorbedProof: AccountMergeFreshProof;
  now: Date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function timestampMilliseconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function unavailable(correlationId: string): AccountMergePlanResponse {
  return deepFreeze({
    contract: "account-merge.plan-response@1",
    ok: false,
    code: "plan_unavailable",
    correlationId,
  });
}

class AccountMergePlanUnavailable extends Error {}

function rejectPlan(reason: string): never {
  throw new AccountMergePlanUnavailable(reason);
}

function assertBoundedInventory(
  snapshots: readonly AccountMergePunkSnapshot[],
): void {
  if (
    snapshots.some(
      (snapshot) =>
        !Array.isArray(snapshot.claims) ||
        !Array.isArray(snapshot.rights) ||
        !Array.isArray(snapshot.sessions) ||
        !Array.isArray(snapshot.handoffs),
    ) ||
    snapshots.reduce((total, snapshot) => total + snapshot.claims.length, 0) >
      MAX_PLAN_CLAIMS ||
    snapshots.reduce((total, snapshot) => total + snapshot.rights.length, 0) >
      MAX_PLAN_RIGHTS ||
    snapshots.reduce((total, snapshot) => total + snapshot.sessions.length, 0) >
      MAX_PLAN_SESSIONS ||
    snapshots.reduce((total, snapshot) => total + snapshot.handoffs.length, 0) >
      MAX_PLAN_HANDOFFS
  ) {
    rejectPlan("Account merge authority inventory exceeds its bound");
  }
}

function assertCanonicalSnapshot(snapshot: AccountMergePunkSnapshot): void {
  if (
    !isNonEmptyString(snapshot.punkId) ||
    snapshot.status !== "active" ||
    !isRevision(snapshot.revision)
  ) {
    rejectPlan("Account merge authority snapshot is invalid");
  }
  const bindings = new Set<string>();
  for (const claim of snapshot.claims) {
    if (
      claim.punkId !== snapshot.punkId ||
      !isDigest(claim.claimBindingHash) ||
      !CLAIM_KINDS.has(claim.kind) ||
      !CLAIM_PROVIDERS.has(claim.provider) ||
      !isRevision(claim.revision) ||
      bindings.has(claim.claimBindingHash)
    ) {
      rejectPlan("Account merge claim snapshot is invalid");
    }
    bindings.add(claim.claimBindingHash);
  }
  const rightCoordinates = new Set<string>();
  for (const right of snapshot.rights) {
    const coordinate = rightCoordinate(right);
    if (
      right.punkId !== snapshot.punkId ||
      !isDigest(right.rightBindingHash) ||
      !isDigest(right.authorityBindingHash) ||
      !RIGHT_KINDS.has(right.kind) ||
      !isRevision(right.revision) ||
      (right.role !== null && !WORKSPACE_ROLES.has(right.role)) ||
      (right.kind === "workspace-membership") !== (right.role !== null) ||
      rightCoordinates.has(coordinate) ||
      bindings.has(right.rightBindingHash)
    ) {
      rejectPlan("Account merge right snapshot is invalid");
    }
    rightCoordinates.add(coordinate);
    bindings.add(right.rightBindingHash);
  }
  for (const session of snapshot.sessions) {
    if (
      session.punkId !== snapshot.punkId ||
      !isDigest(session.sessionBindingHash) ||
      !CLIENT_KINDS.has(session.clientKind) ||
      timestampMilliseconds(session.authenticatedAt) === null ||
      timestampMilliseconds(session.expiresAt) === null ||
      bindings.has(session.sessionBindingHash)
    ) {
      rejectPlan("Account merge session snapshot is invalid");
    }
    bindings.add(session.sessionBindingHash);
  }
  for (const handoff of snapshot.handoffs) {
    if (
      handoff.punkId !== snapshot.punkId ||
      !isDigest(handoff.handoffBindingHash) ||
      !HANDOFF_KINDS.has(handoff.kind) ||
      !HANDOFF_STATES.has(handoff.state) ||
      timestampMilliseconds(handoff.expiresAt) === null ||
      bindings.has(handoff.handoffBindingHash)
    ) {
      rejectPlan("Account merge handoff snapshot is invalid");
    }
    bindings.add(handoff.handoffBindingHash);
  }
}

function bindInput(input: PrepareAccountMergePlanInput): BoundMergeInput {
  if (
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    !isNonEmptyString(input.correlationId) ||
    input.correlationId.length > 128 ||
    !validateContract(
      "punks://contracts/account-merge.plan-create@1",
      input.command,
    ).valid
  ) {
    rejectPlan("Account merge command is invalid");
  }
  const command = input.command as CreateAccountMergePlanCommand;
  if (
    command.survivorPunkId === command.absorbedPunkId ||
    input.punks.length !== 2 ||
    input.authoritativeProofs.length !== 2
  ) {
    rejectPlan("Account merge selection is invalid");
  }
  const survivor = input.punks.find(
    (punk) => punk.punkId === command.survivorPunkId,
  );
  const absorbed = input.punks.find(
    (punk) => punk.punkId === command.absorbedPunkId,
  );
  if (
    survivor === undefined ||
    absorbed === undefined ||
    survivor === absorbed
  ) {
    rejectPlan("Account merge inventory is invalid");
  }
  assertBoundedInventory([survivor, absorbed]);
  assertCanonicalSnapshot(survivor);
  assertCanonicalSnapshot(absorbed);

  const publicProofs = [...command.proofs];
  const survivorProof = publicProofs.find(
    (proof) => proof.accountRole === "survivor",
  );
  const absorbedProof = publicProofs.find(
    (proof) => proof.accountRole === "absorbed",
  );
  if (
    survivorProof === undefined ||
    absorbedProof === undefined ||
    survivorProof.proofId === absorbedProof.proofId
  ) {
    rejectPlan("Account merge proof roles are invalid");
  }
  const proofById = new Map(
    input.authoritativeProofs.map((proof) => [proof.descriptor.proofId, proof]),
  );
  if (proofById.size !== 2) {
    rejectPlan("Account merge proof inventory is invalid");
  }
  for (const [proof, role, punk] of [
    [survivorProof, "survivor", survivor],
    [absorbedProof, "absorbed", absorbed],
  ] as const) {
    const authoritative = proofById.get(proof.proofId);
    const authenticatedAt = timestampMilliseconds(proof.authenticatedAt);
    const expiresAt = timestampMilliseconds(proof.expiresAt);
    if (
      authoritative === undefined ||
      authoritative.state !== "active" ||
      canonicalJson(authoritative.descriptor) !== canonicalJson(proof) ||
      proof.accountRole !== role ||
      proof.punkId !== punk.punkId ||
      proof.intentId !== command.intentId ||
      proof.holderBindingHash !== command.holderBindingHash ||
      proof.accountRevision !== punk.revision ||
      authenticatedAt === null ||
      expiresAt === null ||
      authenticatedAt > input.now.getTime() ||
      expiresAt <= input.now.getTime() ||
      expiresAt <= authenticatedAt ||
      expiresAt - authenticatedAt !== ACCOUNT_MERGE_PROOF_MAX_AGE_MS
    ) {
      rejectPlan("Account merge proof binding is invalid");
    }
  }
  return {
    command,
    survivor,
    absorbed,
    survivorProof,
    absorbedProof,
    now: input.now,
  };
}

function originFor(punkId: string, survivorPunkId: string): Origin {
  return punkId === survivorPunkId ? "survivor" : "absorbed";
}

function strongestRole(
  left: WorkspaceRole | null,
  right: WorkspaceRole | null,
): WorkspaceRole | null {
  if (left === null) return right;
  if (right === null) return left;
  return rolePermissions[left].size >= rolePermissions[right].size
    ? left
    : right;
}

function claimCoordinate(claim: AccountMergeClaimSnapshot): string {
  return `${claim.kind}\u0000${claim.provider}\u0000${claim.claimBindingHash}`;
}

function rightCoordinate(right: AccountMergeRightSnapshot): string {
  return `${right.kind}\u0000${right.authorityBindingHash}`;
}

function planClaims(bound: BoundMergeInput): AccountMergePlan["claims"] {
  const survivorClaims = new Map(
    bound.survivor.claims.map((claim) => [claimCoordinate(claim), claim]),
  );
  return [bound.survivor, bound.absorbed]
    .flatMap((punk) =>
      punk.claims.map((claim): AccountMergePlan["claims"][number] => {
        const origin = originFor(punk.punkId, bound.survivor.punkId);
        const duplicate = survivorClaims.get(claimCoordinate(claim));
        return {
          claimBindingHash: claim.claimBindingHash,
          kind: claim.kind,
          provider: claim.provider,
          origin,
          disposition:
            origin === "survivor"
              ? "preserve"
              : duplicate === undefined
                ? "transfer"
                : "deduplicate",
          duplicateOfBindingHash:
            origin === "absorbed" && duplicate !== undefined
              ? duplicate.claimBindingHash
              : null,
          expectedRevision: claim.revision,
        };
      }),
    )
    .sort(
      (left, right) =>
        compareText(left.claimBindingHash, right.claimBindingHash) ||
        compareText(left.origin, right.origin),
    );
}

function planRights(bound: BoundMergeInput): AccountMergePlan["rights"] {
  const survivorRights = new Map(
    bound.survivor.rights.map((right) => [rightCoordinate(right), right]),
  );
  const absorbedRights = new Map(
    bound.absorbed.rights.map((right) => [rightCoordinate(right), right]),
  );
  return [bound.survivor, bound.absorbed]
    .flatMap((punk) =>
      punk.rights.map((right): AccountMergePlan["rights"][number] => {
        const origin = originFor(punk.punkId, bound.survivor.punkId);
        const counterpart =
          origin === "survivor"
            ? absorbedRights.get(rightCoordinate(right))
            : survivorRights.get(rightCoordinate(right));
        const strategy = RIGHT_MERGE_STRATEGIES[right.kind];
        const invalidated = strategy === "invalidate";
        const disposition = invalidated
          ? "invalidate"
          : origin === "survivor"
            ? "preserve"
            : counterpart !== undefined && right.kind === "workspace-membership"
              ? "deduplicate"
              : strategy === "retarget"
                ? "retarget"
                : "transfer";
        const resultingRole =
          right.kind === "workspace-membership"
            ? strongestRole(right.role, counterpart?.role ?? null)
            : null;
        return {
          rightBindingHash: right.rightBindingHash,
          kind: right.kind,
          authorityBindingHash: right.authorityBindingHash,
          origin,
          originPunkId: punk.punkId,
          disposition,
          role: right.role,
          resultingRole,
          expectedRevision: right.revision,
        };
      }),
    )
    .sort(
      (left, right) =>
        compareText(left.rightBindingHash, right.rightBindingHash) ||
        compareText(left.origin, right.origin),
    );
}

function planSessions(bound: BoundMergeInput): AccountMergePlan["sessions"] {
  return [bound.survivor, bound.absorbed]
    .flatMap((punk) =>
      punk.sessions.map((session): AccountMergePlan["sessions"][number] => ({
        sessionBindingHash: session.sessionBindingHash,
        origin: originFor(punk.punkId, bound.survivor.punkId),
        clientKind: session.clientKind,
        action: "revoke",
        authenticatedAt: session.authenticatedAt,
        expiresAt: session.expiresAt,
      })),
    )
    .sort((left, right) =>
      compareText(left.sessionBindingHash, right.sessionBindingHash),
    );
}

function planHandoffs(bound: BoundMergeInput): AccountMergePlan["handoffs"] {
  return [bound.survivor, bound.absorbed]
    .flatMap((punk) =>
      punk.handoffs.map((handoff): AccountMergePlan["handoffs"][number] => ({
        handoffBindingHash: handoff.handoffBindingHash,
        origin: originFor(punk.punkId, bound.survivor.punkId),
        kind: handoff.kind,
        state: handoff.state,
        action: "cancel",
        expiresAt: handoff.expiresAt,
      })),
    )
    .sort((left, right) =>
      compareText(left.handoffBindingHash, right.handoffBindingHash),
    );
}

type ConflictDescriptor = Omit<
  AccountMergePlan["conflicts"][number],
  "conflictBindingHash"
>;

function addConflictDescriptor(
  descriptors: ConflictDescriptor[],
  descriptor: ConflictDescriptor,
): void {
  if (descriptors.length >= MAX_PLAN_CONFLICTS) {
    rejectPlan("Account merge conflict inventory exceeds its bound");
  }
  descriptors.push(descriptor);
}

async function conflict(
  descriptor: ConflictDescriptor,
): Promise<AccountMergePlan["conflicts"][number]> {
  return {
    conflictBindingHash: await sha256Hex(canonicalJson(descriptor)),
    ...descriptor,
  };
}

async function planConflicts(
  bound: BoundMergeInput,
): Promise<AccountMergePlan["conflicts"]> {
  const survivorClaims = new Map(
    bound.survivor.claims.map((claim) => [claimCoordinate(claim), claim]),
  );
  const survivorRights = new Map(
    bound.survivor.rights.map((right) => [rightCoordinate(right), right]),
  );
  const descriptors: ConflictDescriptor[] = [];
  for (const claimSnapshot of bound.absorbed.claims) {
    const duplicate = survivorClaims.get(claimCoordinate(claimSnapshot));
    if (duplicate !== undefined) {
      addConflictDescriptor(descriptors, {
        kind: "identical-claim",
        authorityBindingHash: duplicate.claimBindingHash,
        resolution: "deduplicate",
        blocking: false,
      });
    }
  }
  for (const right of bound.absorbed.rights) {
    const duplicate = survivorRights.get(rightCoordinate(right));
    if (duplicate === undefined) continue;
    switch (right.kind) {
      case "workspace-membership":
        addConflictDescriptor(descriptors, {
          kind:
            right.role === "owner" || duplicate.role === "owner"
              ? "workspace-owner"
              : "workspace-role",
          authorityBindingHash: right.authorityBindingHash,
          resolution:
            right.role === "owner" || duplicate.role === "owner"
              ? "preserve-workspace-ownership"
              : "strongest-role",
          blocking: false,
        });
        break;
      case "workspace-invitation":
        addConflictDescriptor(descriptors, {
          kind: "duplicate-invitation",
          authorityBindingHash: right.authorityBindingHash,
          resolution: "retarget-invitation",
          blocking: false,
        });
        break;
      case "account-owned-resource":
        addConflictDescriptor(descriptors, {
          kind: "account-owned-resource",
          authorityBindingHash: right.authorityBindingHash,
          resolution: "requires-adapter",
          blocking: true,
        });
        break;
      case "local-resource-binding":
      case "local-tool-authorization":
      case "repository-access-proof":
        break;
    }
  }
  const conflicts: AccountMergePlan["conflicts"] = [];
  for (const descriptor of descriptors) {
    conflicts.push(await conflict(descriptor));
  }
  return conflicts.sort(
    (left, right) =>
      compareText(left.conflictBindingHash, right.conflictBindingHash) ||
      compareText(left.kind, right.kind),
  );
}

type PlanDescriptor = Omit<AccountMergePlan, "planId" | "planDigest">;

async function buildPlan(bound: BoundMergeInput): Promise<AccountMergePlan> {
  const earliestProofExpiry = Math.min(
    Date.parse(bound.survivorProof.expiresAt),
    Date.parse(bound.absorbedProof.expiresAt),
  );
  const conflicts = await planConflicts(bound);
  const descriptor: PlanDescriptor = {
    contract: "account-merge.plan@1",
    schemaVersion: 1,
    intentId: bound.command.intentId,
    status: "planned",
    generatedAt: bound.now.toISOString(),
    expiresAt: new Date(earliestProofExpiry).toISOString(),
    validForSeconds: Math.max(
      1,
      Math.min(
        300,
        Math.ceil((earliestProofExpiry - bound.now.getTime()) / 1_000),
      ),
    ),
    holderBindingHash: bound.command.holderBindingHash,
    strategy: "preserve-origin",
    survivorPunkId: bound.survivor.punkId,
    absorbedPunkId: bound.absorbed.punkId,
    accountRevisions: {
      survivor: bound.survivor.revision,
      absorbed: bound.absorbed.revision,
    },
    proofBindings: {
      survivorProofId: bound.survivorProof.proofId,
      absorbedProofId: bound.absorbedProof.proofId,
    },
    claims: planClaims(bound),
    rights: planRights(bound),
    sessions: planSessions(bound),
    handoffs: planHandoffs(bound),
    conflicts,
  };
  const planDigest = await sha256Hex(canonicalJson(descriptor));
  const plan: AccountMergePlan = {
    ...descriptor,
    planId: await deriveOpaqueUuid(PLAN_ID_NAMESPACE, planDigest),
    planDigest,
  };
  if (!validateContract("punks://contracts/account-merge.plan@1", plan).valid) {
    throw new TypeError("Generated account merge plan is invalid");
  }
  return deepFreeze(plan);
}

/**
 * Builds the exact public Plan contract from two authoritative snapshots.
 * This function never mutates proofs, Punks, rights, sessions, or handoffs.
 */
export async function prepareAccountMergePlan(
  input: PrepareAccountMergePlanInput,
): Promise<AccountMergePlanResponse> {
  const correlationId =
    isNonEmptyString(input.correlationId) && input.correlationId.length <= 128
      ? input.correlationId
      : "account-merge";
  try {
    const plan = await buildPlan(bindInput(input));
    const response: AccountMergePlanResponse = {
      contract: "account-merge.plan-response@1",
      ok: true,
      status: "planned",
      plan,
    };
    if (
      !validateContract(
        "punks://contracts/account-merge.plan-response@1",
        response,
      ).valid
    ) {
      throw new TypeError("Generated account merge response is invalid");
    }
    return deepFreeze(response);
  } catch (error) {
    if (!(error instanceof AccountMergePlanUnavailable)) throw error;
    const response = unavailable(correlationId);
    if (
      !validateContract(
        "punks://contracts/account-merge.plan-response@1",
        response,
      ).valid
    ) {
      throw new TypeError("Account merge failure contract is invalid");
    }
    return response;
  }
}
