import { WorkerEntrypoint } from "cloudflare:workers";

import {
  PromotionFaultableDurableObject,
  type PromotionAuthorityFaultIdentity,
  type PromotionAuthorityFaultRecovery,
  type PromotionAuthorityFaultState,
} from "../../../shared/promotion-faultable-do";

interface ErasurePromotionEnv extends CloudflareBindings {
  PROMOTION_AUTHORITY_FAULTS: DurableObjectNamespace<PromotionAuthorityFaultDO>;
}

const SCHEMA_VERSION = 1 as const;
const MAX_CONTENT_KEY_IDS = 1_000;
const MAX_TOMBSTONE_BYTES = 64 * 1024;
const MAX_ACCOUNT_MERGE_ENVELOPE_BYTES = 1024 * 1024;
const MAX_ACCOUNT_MERGE_RECOVERY_DESCRIPTOR_BYTES = 900 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const scopeKeys = [
  "conversationId",
  "generationId",
  "messageId",
  "workspaceId",
] as const;
const recordKeys = [
  "conversationId",
  "erasureCommandId",
  "expectedContentKeyIds",
  "generationId",
  "messageId",
  "workspaceId",
] as const;
const tombstoneKeys = [
  "conversationId",
  "erasureCommandId",
  "expectedContentKeyIds",
  "generationId",
  "messageId",
  "recordedAt",
  "schemaVersion",
  "tombstoneHash",
  "workspaceId",
] as const;
const accountMergeReceiptLookupKeys = ["absorbedPunkId"] as const;
const accountMergeReceiptRecordKeys = [
  "absorbedPunkId",
  "accountRevisions",
  "commitCommandId",
  "intentId",
  "planDigest",
  "planId",
  "receiptId",
  "recoveryDescriptor",
  "survivorPunkId",
] as const;
const accountMergeReceiptKeys = [
  "absorbedPunkId",
  "accountRevisions",
  "commitCommandId",
  "committedAt",
  "contract",
  "intentId",
  "planDigest",
  "planId",
  "receiptHash",
  "receiptId",
  "schemaVersion",
  "survivorPunkId",
] as const;
const accountMergeRecoveryEnvelopeKeys = [
  "envelopeHash",
  "receipt",
  "recoveryDescriptor",
  "schemaVersion",
] as const;

/** Scope that uniquely identifies one Message erasure generation. */
export interface ErasureScope {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  generationId: string;
}

/** Request to durably record one irreversible erasure decision. */
export interface RecordErasureInput extends ErasureScope {
  erasureCommandId: string;
  expectedContentKeyIds: string[];
}

/** Canonical immutable tombstone stored by the erasure registry. */
export interface ErasureTombstone extends RecordErasureInput {
  schemaVersion: 1;
  recordedAt: string;
  tombstoneHash: string;
}

export type RecordErasureResult =
  | { ok: true; tombstone: ErasureTombstone; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "conflict"
        | "corrupt_tombstone"
        | "storage_unavailable";
    };

export type LookupErasureResult =
  | { ok: true; tombstone: ErasureTombstone | null }
  | {
      ok: false;
      code: "invalid_request" | "corrupt_tombstone" | "storage_unavailable";
    };

/** Irreversible account-merge decision bound into the terminal receipt. */
export interface AccountMergeReceiptDecision {
  receiptId: string;
  intentId: string;
  planId: string;
  planDigest: string;
  commitCommandId: string;
  survivorPunkId: string;
  absorbedPunkId: string;
  accountRevisions: { survivor: number; absorbed: number };
}

/** Private write carrying the canonical recovery descriptor stored cold. */
export interface RecordAccountMergeReceiptInput
  extends AccountMergeReceiptDecision {
  recoveryDescriptor: string;
}

/** Minimal create-only proof preventing an absorbed account from reviving. */
export interface AccountMergeReceipt extends AccountMergeReceiptDecision {
  contract: "account-merge.receipt@1";
  schemaVersion: 1;
  committedAt: string;
  receiptHash: string;
}

/** Result of a create-only terminal receipt write or exact replay. */
export type RecordAccountMergeReceiptResult =
  | { ok: true; receipt: AccountMergeReceipt; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "conflict"
        | "corrupt_receipt"
        | "storage_unavailable";
    };

/** Result of a bounded terminal receipt lookup by absorbed Punk. */
export type LookupAccountMergeReceiptResult =
  | { ok: true; receipt: AccountMergeReceipt | null }
  | {
      ok: false;
      code: "invalid_request" | "corrupt_receipt" | "storage_unavailable";
    };

/** Cold Plan/manifest material returned only to the merge intent authority. */
export type LookupAccountMergeRecoveryResult =
  | {
      ok: true;
      receipt: AccountMergeReceipt | null;
      recoveryDescriptor: string | null;
    }
  | {
      ok: false;
      code: "invalid_request" | "corrupt_receipt" | "storage_unavailable";
    };

type TombstoneDraft = Omit<ErasureTombstone, "tombstoneHash">;
type StoredRead =
  | { status: "missing" }
  | { status: "valid"; tombstone: ErasureTombstone }
  | { status: "scope_mismatch" }
  | { status: "corrupt" }
  | { status: "unavailable" };
type AccountMergeReceiptDraft = Omit<AccountMergeReceipt, "receiptHash">;
type AccountMergeRecoveryEnvelopeDraft = {
  schemaVersion: 1;
  receipt: AccountMergeReceipt;
  recoveryDescriptor: string;
};
interface AccountMergeRecoveryEnvelope
  extends AccountMergeRecoveryEnvelopeDraft {
  envelopeHash: string;
}
type StoredAccountMergeReceiptRead =
  | { status: "missing" }
  | { status: "valid"; envelope: AccountMergeRecoveryEnvelope }
  | { status: "scope_mismatch" }
  | { status: "corrupt" }
  | { status: "unavailable" };

/** Dedicated private probe for the version executing this Erasure Worker. */
export class RuntimeIdentityService extends WorkerEntrypoint<CloudflareBindings> {
  override fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  runtimeVersion(): { versionId: string } {
    return { versionId: this.env.CF_VERSION_METADATA.id };
  }
}

/** Worker-local Durable Object that carries an injected Erasure service fault. */
export class PromotionAuthorityFaultDO extends PromotionFaultableDurableObject<ErasurePromotionEnv> {}

/** Private service binding for faulting the Erasure authority itself. */
export class PromotionAuthorityFaultService extends WorkerEntrypoint<ErasurePromotionEnv> {
  override fetch(): Response {
    return new Response(null, { status: 404 });
  }

  async injectPromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    return this.env.PROMOTION_AUTHORITY_FAULTS.getByName(
      input.target.id,
    ).injectPromotionFault(input);
  }

  async recoverPromotionFault(
    input: PromotionAuthorityFaultRecovery,
  ): Promise<PromotionAuthorityFaultState> {
    return this.env.PROMOTION_AUTHORITY_FAULTS.getByName(
      input.target.id,
    ).recoverPromotionFault(input);
  }

  async probePromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState | null> {
    return this.env.PROMOTION_AUTHORITY_FAULTS.getByName(
      input.target.id,
    ).probePromotionFault(input.executionId);
  }

  async observePromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    return this.env.PROMOTION_AUTHORITY_FAULTS.getByName(
      input.target.id,
    ).observePromotionFault(input.executionId);
  }
}

/** Private, append-only registry of Message erasure tombstones. */
export default class ErasureRegistry extends WorkerEntrypoint<CloudflareBindings> {
  /** Records one create-only tombstone or replays the exact prior decision. */
  async record(input: unknown): Promise<RecordErasureResult> {
    const request = validateRecordInput(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }

    const draft: TombstoneDraft = {
      schemaVersion: SCHEMA_VERSION,
      workspaceId: request.workspaceId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      generationId: request.generationId,
      erasureCommandId: request.erasureCommandId,
      expectedContentKeyIds: request.expectedContentKeyIds,
      recordedAt: new Date().toISOString(),
    };
    const tombstone: ErasureTombstone = {
      ...draft,
      tombstoneHash: await digestHex(canonicalJson(draft)),
    };
    const body = canonicalJson(tombstone);
    const path = tombstonePath(request);

    let created: R2Object | null;
    try {
      created = await this.env.ERASURE_TOMBSTONES.put(path, body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      });
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    if (created !== null) {
      return { ok: true, tombstone, replayed: false };
    }

    const existing = await readStored(this.env.ERASURE_TOMBSTONES, request);
    if (existing.status === "unavailable" || existing.status === "missing") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (existing.status === "corrupt") {
      return { ok: false, code: "corrupt_tombstone" };
    }
    if (existing.status === "scope_mismatch") {
      return { ok: false, code: "conflict" };
    }
    if (!sameDecision(existing.tombstone, request)) {
      return { ok: false, code: "conflict" };
    }
    return { ok: true, tombstone: existing.tombstone, replayed: true };
  }

  /** Looks up the immutable tombstone for an exact Message scope. */
  async lookup(input: unknown): Promise<LookupErasureResult> {
    const scope = validateScopeInput(input);
    if (scope === null) {
      return { ok: false, code: "invalid_request" };
    }
    const stored = await readStored(this.env.ERASURE_TOMBSTONES, scope);
    if (stored.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (stored.status === "corrupt" || stored.status === "scope_mismatch") {
      return { ok: false, code: "corrupt_tombstone" };
    }
    return {
      ok: true,
      tombstone: stored.status === "missing" ? null : stored.tombstone,
    };
  }

  /** Refuses every HTTP request; callers must use a service binding RPC. */
  override fetch(_request: Request): Response {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
}

/** Exact capability props required by the terminal receipt registry. */
export type AccountMergeReceiptRegistryProps = {
  role: "punks-account-merge-receipt-writer";
  environment: "local" | "staging" | "production";
};

/** Capability-separated registry for Account Merge terminal decisions. */
export class AccountMergeReceiptRegistryService extends WorkerEntrypoint<
  CloudflareBindings,
  AccountMergeReceiptRegistryProps
> {
  #allowed(): boolean {
    const props = this.ctx.props;
    return (
      typeof props === "object" &&
      props !== null &&
      !Array.isArray(props) &&
      Object.keys(props).sort().join(",") === "environment,role" &&
      props.role === "punks-account-merge-receipt-writer" &&
      props.environment === this.env.ENVIRONMENT
    );
  }

  /** Records the point-of-no-return for one absorbed Compte Punks. */
  async recordAccountMergeReceipt(
    input: unknown,
  ): Promise<RecordAccountMergeReceiptResult> {
    if (!this.#allowed()) return { ok: false, code: "invalid_request" };
    const request = validateAccountMergeReceiptInput(input);
    if (request === null) return { ok: false, code: "invalid_request" };

    const draft: AccountMergeReceiptDraft = {
      contract: "account-merge.receipt@1",
      schemaVersion: 1,
      receiptId: request.receiptId,
      intentId: request.intentId,
      planId: request.planId,
      planDigest: request.planDigest,
      commitCommandId: request.commitCommandId,
      survivorPunkId: request.survivorPunkId,
      absorbedPunkId: request.absorbedPunkId,
      accountRevisions: request.accountRevisions,
      committedAt: new Date().toISOString(),
    };
    const receipt: AccountMergeReceipt = {
      ...draft,
      receiptHash: await digestHex(canonicalJson(draft)),
    };
    const envelopeDraft: AccountMergeRecoveryEnvelopeDraft = {
      schemaVersion: 1,
      receipt,
      recoveryDescriptor: request.recoveryDescriptor,
    };
    const envelope: AccountMergeRecoveryEnvelope = {
      ...envelopeDraft,
      envelopeHash: await digestHex(canonicalJson(envelopeDraft)),
    };
    const body = canonicalJson(envelope);
    const path = accountMergeReceiptPath(request.absorbedPunkId);
    let created: R2Object | null;
    try {
      created = await this.env.ERASURE_TOMBSTONES.put(path, body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      });
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    if (created !== null) {
      return { ok: true, receipt, replayed: false };
    }

    const existing = await readStoredAccountMergeReceipt(
      this.env.ERASURE_TOMBSTONES,
      request.absorbedPunkId,
    );
    if (existing.status === "unavailable" || existing.status === "missing") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (existing.status === "corrupt") {
      return { ok: false, code: "corrupt_receipt" };
    }
    if (
      existing.status === "scope_mismatch" ||
      !sameAccountMergeDecision(existing.envelope.receipt, request) ||
      existing.envelope.recoveryDescriptor !== request.recoveryDescriptor
    ) {
      return { ok: false, code: "conflict" };
    }
    return {
      ok: true,
      receipt: existing.envelope.receipt,
      replayed: true,
    };
  }

  /** Looks up the terminal decision by the absorbed Punk only. */
  async lookupAccountMergeReceipt(
    input: unknown,
  ): Promise<LookupAccountMergeReceiptResult> {
    if (
      !this.#allowed() ||
      !isExactRecord(input, accountMergeReceiptLookupKeys)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const absorbedPunkId = input.absorbedPunkId;
    if (
      typeof absorbedPunkId !== "string" ||
      !uuidPattern.test(absorbedPunkId)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const stored = await readStoredAccountMergeReceipt(
      this.env.ERASURE_TOMBSTONES,
      absorbedPunkId,
    );
    if (stored.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (stored.status === "corrupt" || stored.status === "scope_mismatch") {
      return { ok: false, code: "corrupt_receipt" };
    }
    return {
      ok: true,
      receipt: stored.status === "missing" ? null : stored.envelope.receipt,
    };
  }

  /** Returns the cold recovery descriptor only to the exact private caller. */
  async lookupAccountMergeRecovery(
    input: unknown,
  ): Promise<LookupAccountMergeRecoveryResult> {
    if (
      !this.#allowed() ||
      !isExactRecord(input, accountMergeReceiptLookupKeys)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const absorbedPunkId = input.absorbedPunkId;
    if (
      typeof absorbedPunkId !== "string" ||
      !uuidPattern.test(absorbedPunkId)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const stored = await readStoredAccountMergeReceipt(
      this.env.ERASURE_TOMBSTONES,
      absorbedPunkId,
    );
    if (stored.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (stored.status === "corrupt" || stored.status === "scope_mismatch") {
      return { ok: false, code: "corrupt_receipt" };
    }
    return stored.status === "missing"
      ? { ok: true, receipt: null, recoveryDescriptor: null }
      : {
          ok: true,
          receipt: stored.envelope.receipt,
          recoveryDescriptor: stored.envelope.recoveryDescriptor,
        };
  }

  /** Refuses every HTTP request; callers must use a service binding RPC. */
  override fetch(_request: Request): Response {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
}

function validateAccountMergeReceiptInput(
  input: unknown,
): RecordAccountMergeReceiptInput | null {
  if (!isExactRecord(input, accountMergeReceiptRecordKeys)) return null;
  if (
    typeof input.receiptId !== "string" ||
    !uuidPattern.test(input.receiptId) ||
    typeof input.intentId !== "string" ||
    !uuidPattern.test(input.intentId) ||
    typeof input.planId !== "string" ||
    !uuidPattern.test(input.planId) ||
    typeof input.planDigest !== "string" ||
    !hashPattern.test(input.planDigest) ||
    typeof input.commitCommandId !== "string" ||
    !uuidPattern.test(input.commitCommandId) ||
    typeof input.survivorPunkId !== "string" ||
    !uuidPattern.test(input.survivorPunkId) ||
    typeof input.absorbedPunkId !== "string" ||
    !uuidPattern.test(input.absorbedPunkId) ||
    input.survivorPunkId === input.absorbedPunkId ||
    !validAccountRevisions(input.accountRevisions) ||
    typeof input.recoveryDescriptor !== "string" ||
    !canonicalBoundedRecoveryDescriptor(input.recoveryDescriptor)
  ) {
    return null;
  }
  return {
    receiptId: input.receiptId,
    intentId: input.intentId,
    planId: input.planId,
    planDigest: input.planDigest,
    commitCommandId: input.commitCommandId,
    survivorPunkId: input.survivorPunkId,
    absorbedPunkId: input.absorbedPunkId,
    accountRevisions: input.accountRevisions,
    recoveryDescriptor: input.recoveryDescriptor,
  };
}

function canonicalBoundedRecoveryDescriptor(value: string): boolean {
  if (
    new TextEncoder().encode(value).byteLength >
    MAX_ACCOUNT_MERGE_RECOVERY_DESCRIPTOR_BYTES
  ) {
    return false;
  }
  try {
    return canonicalJson(JSON.parse(value)) === value;
  } catch {
    return false;
  }
}

function validAccountRevisions(
  value: unknown,
): value is RecordAccountMergeReceiptInput["accountRevisions"] {
  return (
    isExactRecord(value, ["absorbed", "survivor"] as const) &&
    Number.isSafeInteger(value.survivor) &&
    Number(value.survivor) >= 1 &&
    Number.isSafeInteger(value.absorbed) &&
    Number(value.absorbed) >= 1
  );
}

async function readStoredAccountMergeReceipt(
  bucket: R2Bucket,
  absorbedPunkId: string,
): Promise<StoredAccountMergeReceiptRead> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(accountMergeReceiptPath(absorbedPunkId));
  } catch {
    return { status: "unavailable" };
  }
  if (object === null) return { status: "missing" };
  if (object.size > MAX_ACCOUNT_MERGE_ENVELOPE_BYTES) {
    return { status: "corrupt" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await object.arrayBuffer(),
    );
  } catch {
    return { status: "corrupt" };
  }
  const envelope = await validateStoredAccountMergeReceipt(text);
  if (envelope === null) return { status: "corrupt" };
  return envelope.receipt.absorbedPunkId === absorbedPunkId
    ? { status: "valid", envelope }
    : { status: "scope_mismatch" };
}

/**
 * Revalidates the complete canonical object independently at the R2 boundary.
 * The cold anti-PITR authority deliberately does not depend on the generated
 * application validator: a structurally valid but non-canonical or rehashed
 * object must never become a terminal decision after restoration.
 */
async function validateStoredAccountMergeReceipt(
  text: string,
): Promise<AccountMergeRecoveryEnvelope | null> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isExactRecord(value, accountMergeRecoveryEnvelopeKeys) ||
    value.schemaVersion !== 1 ||
    typeof value.recoveryDescriptor !== "string" ||
    !canonicalBoundedRecoveryDescriptor(value.recoveryDescriptor) ||
    typeof value.envelopeHash !== "string" ||
    !hashPattern.test(value.envelopeHash)
  ) {
    return null;
  }
  const receipt = await validateCanonicalAccountMergeReceipt(
    canonicalJson(value.receipt),
    value.recoveryDescriptor,
  );
  if (receipt === null) return null;
  const draft: AccountMergeRecoveryEnvelopeDraft = {
    schemaVersion: 1,
    receipt,
    recoveryDescriptor: value.recoveryDescriptor,
  };
  const expectedHash = await digestHex(canonicalJson(draft));
  const envelope: AccountMergeRecoveryEnvelope = {
    ...draft,
    envelopeHash: value.envelopeHash,
  };
  return expectedHash === value.envelopeHash && canonicalJson(envelope) === text
    ? envelope
    : null;
}

async function validateCanonicalAccountMergeReceipt(
  text: string,
  recoveryDescriptor: string,
): Promise<AccountMergeReceipt | null> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isExactRecord(value, accountMergeReceiptKeys) ||
    value.contract !== "account-merge.receipt@1" ||
    value.schemaVersion !== 1 ||
    typeof value.committedAt !== "string" ||
    !isCanonicalTimestamp(value.committedAt) ||
    typeof value.receiptHash !== "string" ||
    !hashPattern.test(value.receiptHash)
  ) {
    return null;
  }
  const request = validateAccountMergeReceiptInput({
    receiptId: value.receiptId,
    intentId: value.intentId,
    planId: value.planId,
    planDigest: value.planDigest,
    commitCommandId: value.commitCommandId,
    survivorPunkId: value.survivorPunkId,
    absorbedPunkId: value.absorbedPunkId,
    accountRevisions: value.accountRevisions,
    recoveryDescriptor,
  });
  if (request === null) return null;
  const draft: AccountMergeReceiptDraft = {
    contract: "account-merge.receipt@1",
    schemaVersion: 1,
    receiptId: request.receiptId,
    intentId: request.intentId,
    planId: request.planId,
    planDigest: request.planDigest,
    commitCommandId: request.commitCommandId,
    survivorPunkId: request.survivorPunkId,
    absorbedPunkId: request.absorbedPunkId,
    accountRevisions: request.accountRevisions,
    committedAt: value.committedAt,
  };
  const expectedHash = await digestHex(canonicalJson(draft));
  const receipt: AccountMergeReceipt = {
    ...draft,
    receiptHash: value.receiptHash,
  };
  return expectedHash === value.receiptHash && canonicalJson(receipt) === text
    ? receipt
    : null;
}

function sameAccountMergeDecision(
  receipt: AccountMergeReceipt,
  request: RecordAccountMergeReceiptInput,
): boolean {
  return (
    receipt.receiptId === request.receiptId &&
    receipt.intentId === request.intentId &&
    receipt.planId === request.planId &&
    receipt.planDigest === request.planDigest &&
    receipt.commitCommandId === request.commitCommandId &&
    receipt.survivorPunkId === request.survivorPunkId &&
    receipt.absorbedPunkId === request.absorbedPunkId &&
    receipt.accountRevisions.survivor === request.accountRevisions.survivor &&
    receipt.accountRevisions.absorbed === request.accountRevisions.absorbed
  );
}

function accountMergeReceiptPath(absorbedPunkId: string): string {
  return `account-merges/v1/absorbed/${absorbedPunkId}/receipt.json`;
}

function validateRecordInput(input: unknown): RecordErasureInput | null {
  if (!isExactRecord(input, recordKeys)) {
    return null;
  }
  const scope = validateScopeFields(input);
  if (
    scope === null ||
    typeof input.erasureCommandId !== "string" ||
    !uuidPattern.test(input.erasureCommandId) ||
    !Array.isArray(input.expectedContentKeyIds) ||
    input.expectedContentKeyIds.length === 0 ||
    input.expectedContentKeyIds.length > MAX_CONTENT_KEY_IDS ||
    !input.expectedContentKeyIds.every(
      (value) => typeof value === "string" && uuidPattern.test(value),
    )
  ) {
    return null;
  }
  const expectedContentKeyIds = sortedUnique(input.expectedContentKeyIds);
  if (expectedContentKeyIds === null) {
    return null;
  }
  return {
    ...scope,
    erasureCommandId: input.erasureCommandId,
    expectedContentKeyIds,
  };
}

function validateScopeInput(input: unknown): ErasureScope | null {
  return isExactRecord(input, scopeKeys) ? validateScopeFields(input) : null;
}

function validateScopeFields(
  input: Record<string, unknown>,
): ErasureScope | null {
  if (
    typeof input.workspaceId !== "string" ||
    !uuidPattern.test(input.workspaceId) ||
    typeof input.conversationId !== "string" ||
    !uuidPattern.test(input.conversationId) ||
    typeof input.messageId !== "string" ||
    !uuidPattern.test(input.messageId) ||
    typeof input.generationId !== "string" ||
    input.generationId !== input.messageId
  ) {
    return null;
  }
  return {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    generationId: input.generationId,
  };
}

async function readStored(
  bucket: R2Bucket,
  scope: ErasureScope,
): Promise<StoredRead> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(tombstonePath(scope));
  } catch {
    return { status: "unavailable" };
  }
  if (object === null) {
    return { status: "missing" };
  }
  if (object.size > MAX_TOMBSTONE_BYTES) {
    return { status: "corrupt" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await object.arrayBuffer(),
    );
  } catch {
    return { status: "corrupt" };
  }
  const tombstone = await validateStoredTombstone(text);
  if (tombstone === null) {
    return { status: "corrupt" };
  }
  return sameScope(tombstone, scope)
    ? { status: "valid", tombstone }
    : { status: "scope_mismatch" };
}

async function validateStoredTombstone(
  text: string,
): Promise<ErasureTombstone | null> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isExactRecord(value, tombstoneKeys) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.recordedAt) ||
    typeof value.tombstoneHash !== "string" ||
    !hashPattern.test(value.tombstoneHash)
  ) {
    return null;
  }
  const request = validateRecordInput({
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    messageId: value.messageId,
    generationId: value.generationId,
    erasureCommandId: value.erasureCommandId,
    expectedContentKeyIds: value.expectedContentKeyIds,
  });
  if (
    request === null ||
    !sameStringArray(request.expectedContentKeyIds, value.expectedContentKeyIds)
  ) {
    return null;
  }
  const draft: TombstoneDraft = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: request.workspaceId,
    conversationId: request.conversationId,
    messageId: request.messageId,
    generationId: request.generationId,
    erasureCommandId: request.erasureCommandId,
    expectedContentKeyIds: request.expectedContentKeyIds,
    recordedAt: value.recordedAt,
  };
  const expectedHash = await digestHex(canonicalJson(draft));
  const tombstone: ErasureTombstone = {
    ...draft,
    tombstoneHash: value.tombstoneHash,
  };
  return expectedHash === value.tombstoneHash &&
    canonicalJson(tombstone) === text
    ? tombstone
    : null;
}

function tombstonePath(scope: ErasureScope): string {
  return `workspaces/${scope.workspaceId}/conversations/${scope.conversationId}/messages/${scope.messageId}/erasure-tombstone.json`;
}

function sameDecision(
  tombstone: ErasureTombstone,
  request: RecordErasureInput,
): boolean {
  return (
    sameScope(tombstone, request) &&
    tombstone.erasureCommandId === request.erasureCommandId &&
    sameStringArray(
      tombstone.expectedContentKeyIds,
      request.expectedContentKeyIds,
    )
  );
}

function sameScope(left: ErasureScope, right: ErasureScope): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.conversationId === right.conversationId &&
    left.messageId === right.messageId &&
    left.generationId === right.generationId
  );
}

function sortedUnique(values: string[]): string[] | null {
  const sorted = [...values].sort();
  return sorted.some((value, index) => index > 0 && value === sorted[index - 1])
    ? null
    : sorted;
}

function sameStringArray(left: string[], right: unknown): boolean {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return sameStringArray([...keys], actual);
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("Unsupported canonical JSON value");
  }
  return encoded;
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
