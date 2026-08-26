import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";
import {
  canonicalJson,
  encodeMessageContentEnvelope,
  MESSAGE_CONTENT_ENVELOPE_MAX_BYTES,
  sha256Hex,
} from "@punks/core";

import type { ApiEnv, ErasureTombstone } from "./env";

export const MESSAGE_CONTENT_PREPARATION_TTL_MS = 15 * 60 * 1_000;
/** Historical API alias; the canonical envelope limit is owned by Core. */
export const MESSAGE_CONTENT_MAX_ENVELOPE_BYTES =
  MESSAGE_CONTENT_ENVELOPE_MAX_BYTES;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ContentStatus =
  | "preparing"
  | "staged"
  | "expiring"
  | "finalized"
  | "expired"
  | "destroyed";

export interface MessageContentScope {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** A Message generation is its stable Message id, across every edit. */
  generationId: string;
}

export interface StageMessageContentInput extends MessageContentScope {
  /** The post/edit command id. */
  operationId: string;
  version: number;
  payload: MessageContentPayload;
}

export interface MessageContentPayload {
  schemaVersion: 1;
  content: string;
  topic: string | null;
}

export interface FinalizeMessageContentInput extends MessageContentScope {
  /** The post/edit command id used by stage(). */
  operationId: string;
  contentKeyId: string;
}

export type ClaimMessageContentForCommitInput = FinalizeMessageContentInput;

export interface ReadMessageContentInput extends MessageContentScope {
  contentKeyId: string;
  purpose: "display" | "search" | "moderation" | "bot-context";
}

export interface DestroyMessageContentGenerationInput
  extends MessageContentScope {
  /** The erasure command id. */
  operationId: string;
  expectedContentKeyIds: string[];
}

export interface PreparedMessageContentReference {
  version: number;
  contentCommitment: string;
  ciphertextRef: string;
  contentKeyId: string;
  topicPresent: boolean;
}

export interface MessageContentDestructionProof {
  schemaVersion: 1;
  operationId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  generationId: string;
  destroyedAt: string;
  destroyedContentKeyIds: string[];
  proofHash: string;
}

export type StageMessageContentResult =
  | {
      ok: true;
      prepared: PreparedMessageContentReference;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "version_conflict"
        | "generation_destroyed"
        | "preparation_expired"
        | "storage_unavailable"
        | "storage_conflict";
    };

export type FinalizeMessageContentResult =
  | {
      ok: true;
      prepared: PreparedMessageContentReference;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "not_found"
        | "not_ready"
        | "generation_destroyed"
        | "preparation_expired"
        | "integrity_failure"
        | "storage_unavailable";
    };

export type ClaimMessageContentForCommitResult = FinalizeMessageContentResult;

export type ReleaseMessageContentCommitClaimResult =
  | { ok: true; released: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "not_found"
        | "generation_destroyed";
    };

export type ReadMessageContentResult =
  | {
      ok: true;
      payload: MessageContentPayload;
      contentCommitment: string;
      version: number;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "not_finalized"
        | "generation_destroyed"
        | "integrity_failure"
        | "storage_unavailable";
    };

export type DestroyMessageContentGenerationResult =
  | {
      ok: true;
      proof: MessageContentDestructionProof;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "not_found"
        | "key_set_mismatch"
        | "storage_unavailable";
    };

type ContentRow = {
  operation_id: string;
  generation_id: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string;
  version: number;
  content_key_id: string;
  content_commitment: string;
  topic_present: number;
  ciphertext_hash: string;
  object_key: string;
  key_material: ArrayBuffer | null;
  iv: ArrayBuffer | null;
  status: ContentStatus;
  expires_at_ms: number | null;
  commit_claimed: number;
  gc_attempts: number;
};

type DestructionRow = {
  generation_id: string;
  operation_id: string;
  expected_key_ids_json: string;
  proof_json: string;
};

type ExpiredContentRow = {
  operation_id: string;
  generation_id: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string;
  version: number;
  content_key_id: string;
};

type StageValidation = {
  input: StageMessageContentInput;
  payloadBytes: Uint8Array<ArrayBuffer>;
};

type DestructionDraft = Omit<MessageContentDestructionProof, "proofHash">;

type ErasureLookup =
  | { status: "clear" }
  | { status: "erased"; tombstone: ErasureTombstone }
  | { status: "unavailable" };

type ErasureDecision =
  | { status: "recorded"; tombstone: ErasureTombstone; replayed: boolean }
  | { status: "conflict" }
  | { status: "unavailable" };

/**
 * Authoritative, per-Message content vault.
 *
 * RPC is deliberately the only surface: callers must already have performed
 * user/Bot authorization before obtaining this private namespace binding.
 * Every key-bearing operation is serialized around the private erasure-registry
 * lookup so a tombstone always wins over restored local state. Plaintext and
 * AES keys are never logged, sent to the registry, or written to R2.
 */
export class MessageContentDO extends PromotionFaultableDurableObject<ApiEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const rows = this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(
        "SELECT * FROM content_versions ORDER BY version, content_key_id",
      )
      .toArray();
    if (rows.length === 0)
      throw new Error("promotion Message content target is missing");
    return sha256Hex(canonicalJson(rows));
  }

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      await this.scheduleNextGc();
    });
  }

  stage(input: unknown): Promise<StageMessageContentResult> {
    return this.ctx.blockConcurrencyWhile(() => this.stageExclusively(input));
  }

  private async stageExclusively(
    input: unknown,
  ): Promise<StageMessageContentResult> {
    const validated = this.validateStage(input);
    if (validated === null) {
      return { ok: false, code: "invalid_request" };
    }
    const { payloadBytes } = validated;
    const request = validated.input;

    const erasure = await this.lookupErasure(request);
    if (erasure.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (erasure.status === "erased") {
      return { ok: false, code: "generation_destroyed" };
    }

    const existing = this.contentByOperation(request.operationId);
    if (existing !== undefined) {
      await this.scheduleNextGc();
      return this.replayStage(existing, request, payloadBytes);
    }
    const expired = this.expiredByOperation(request.operationId);
    if (expired !== undefined) {
      return sameExpiredScope(expired, request)
        ? { ok: false, code: "preparation_expired" }
        : { ok: false, code: "idempotency_conflict" };
    }
    if (this.destruction(request.generationId) !== undefined) {
      return { ok: false, code: "generation_destroyed" };
    }
    if (this.generationKeyCount(request.generationId) >= 1_000) {
      return { ok: false, code: "version_conflict" };
    }
    if (
      this.contentByVersion(request.generationId, request.version) !== undefined
    ) {
      return { ok: false, code: "version_conflict" };
    }

    const contentKeyId = crypto.randomUUID();
    const objectKey = objectKeyFor(request, contentKeyId);
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keys = await deriveVersionKeys(keyBytes, request, contentKeyId);
    const contentCommitment = await keyedCommitment(
      keys.commitment,
      payloadBytes,
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await encrypt(
      keys.encryption,
      iv,
      payloadBytes,
      additionalData(request, contentKeyId, objectKey),
    );
    const ciphertextHash = await digestHex(ciphertext);
    const now = Date.now();
    let insertFailure:
      | "idempotency_conflict"
      | "version_conflict"
      | "generation_destroyed"
      | undefined;

    this.ctx.storage.transactionSync(() => {
      if (this.destruction(request.generationId) !== undefined) {
        insertFailure = "generation_destroyed";
        return;
      }
      if (this.contentByOperation(request.operationId) !== undefined) {
        insertFailure = "idempotency_conflict";
        return;
      }
      if (this.expiredByOperation(request.operationId) !== undefined) {
        insertFailure = "idempotency_conflict";
        return;
      }
      if (this.generationKeyCount(request.generationId) >= 1_000) {
        insertFailure = "version_conflict";
        return;
      }
      if (
        this.contentByVersion(request.generationId, request.version) !==
        undefined
      ) {
        insertFailure = "version_conflict";
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO content_versions
          (operation_id, generation_id, workspace_id, conversation_id,
           message_id, version, content_key_id, content_commitment,
           topic_present,
           ciphertext_hash,
           object_key, key_material, iv, status, staged_at, finalized_at,
           expires_at_ms, gc_attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, NULL, ?, 0)`,
        request.operationId,
        request.generationId,
        request.workspaceId,
        request.conversationId,
        request.messageId,
        request.version,
        contentKeyId,
        contentCommitment,
        request.payload.topic === null ? 0 : 1,
        ciphertextHash,
        objectKey,
        keyBytes.buffer,
        iv.buffer,
        new Date(now).toISOString(),
        now + MESSAGE_CONTENT_PREPARATION_TTL_MS,
      );
    });

    if (insertFailure !== undefined) {
      if (insertFailure === "idempotency_conflict") {
        const concurrent = this.contentByOperation(request.operationId);
        if (concurrent !== undefined) {
          return this.replayStage(concurrent, request, payloadBytes);
        }
        const concurrentlyExpired = this.expiredByOperation(
          request.operationId,
        );
        if (concurrentlyExpired !== undefined) {
          return sameExpiredScope(concurrentlyExpired, request)
            ? { ok: false, code: "preparation_expired" }
            : { ok: false, code: "idempotency_conflict" };
        }
      }
      return { ok: false, code: insertFailure };
    }

    await this.scheduleNextGc();
    const row = this.contentByOperation(request.operationId);
    if (row === undefined) {
      return { ok: false, code: "storage_unavailable" };
    }
    return this.writePreparation(row, payloadBytes, false);
  }

  finalize(input: unknown): Promise<FinalizeMessageContentResult> {
    return this.ctx.blockConcurrencyWhile(() =>
      this.finalizeExclusively(input),
    );
  }

  claimForCommit(input: unknown): Promise<ClaimMessageContentForCommitResult> {
    return this.ctx.blockConcurrencyWhile(() =>
      this.claimForCommitExclusively(input),
    );
  }

  private async claimForCommitExclusively(
    input: unknown,
  ): Promise<ClaimMessageContentForCommitResult> {
    const request = this.validateFinalize(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }
    const erasure = await this.lookupErasure(request);
    if (erasure.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (erasure.status === "erased") {
      return { ok: false, code: "generation_destroyed" };
    }
    const row = this.contentByOperation(request.operationId);
    if (row === undefined) {
      return { ok: false, code: "not_found" };
    }
    if (
      !sameScope(row, request) ||
      row.content_key_id !== request.contentKeyId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (row.status === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    if (row.status === "expired" || row.status === "expiring") {
      return { ok: false, code: "preparation_expired" };
    }
    if (row.status === "finalized") {
      return { ok: true, prepared: referenceFor(row), replayed: true };
    }
    this.ctx.storage.sql.exec(
      `UPDATE content_versions
       SET commit_claimed = 1
       WHERE operation_id = ? AND status IN ('preparing', 'staged')`,
      request.operationId,
    );
    await this.scheduleNextGc();
    const claimed = this.contentByOperation(request.operationId);
    if (
      claimed === undefined ||
      (claimed.status !== "preparing" && claimed.status !== "staged")
    ) {
      return { ok: false, code: "not_ready" };
    }
    return { ok: true, prepared: referenceFor(claimed), replayed: false };
  }

  releaseCommitClaim(
    input: unknown,
  ): Promise<ReleaseMessageContentCommitClaimResult> {
    return this.ctx.blockConcurrencyWhile(() =>
      this.releaseCommitClaimExclusively(input),
    );
  }

  private async releaseCommitClaimExclusively(
    input: unknown,
  ): Promise<ReleaseMessageContentCommitClaimResult> {
    const request = this.validateFinalize(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }
    const row = this.contentByOperation(request.operationId);
    if (row === undefined) {
      return { ok: false, code: "not_found" };
    }
    if (
      !sameScope(row, request) ||
      row.content_key_id !== request.contentKeyId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (row.status === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    const released = row.commit_claimed === 1;
    this.ctx.storage.sql.exec(
      `UPDATE content_versions SET commit_claimed = 0
       WHERE operation_id = ? AND status IN ('preparing', 'staged')`,
      request.operationId,
    );
    await this.scheduleNextGc();
    return { ok: true, released };
  }

  private async finalizeExclusively(
    input: unknown,
  ): Promise<FinalizeMessageContentResult> {
    const request = this.validateFinalize(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }
    const erasure = await this.lookupErasure(request);
    if (erasure.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (erasure.status === "erased") {
      return { ok: false, code: "generation_destroyed" };
    }
    const row = this.contentByOperation(request.operationId);
    if (row === undefined) {
      return this.destruction(request.generationId) === undefined
        ? { ok: false, code: "not_found" }
        : { ok: false, code: "generation_destroyed" };
    }
    if (
      !sameScope(row, request) ||
      row.content_key_id !== request.contentKeyId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (row.status === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    if (row.status === "expired") {
      return { ok: false, code: "preparation_expired" };
    }
    if (row.status === "expiring") {
      return { ok: false, code: "preparation_expired" };
    }
    if (row.status === "finalized") {
      return { ok: true, prepared: referenceFor(row), replayed: true };
    }

    let object: R2ObjectBody | null;
    try {
      object = await this.env.CONTENT_BUCKET.get(row.object_key);
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    if (object === null) {
      return { ok: false, code: "not_ready" };
    }
    const ciphertext = await object.arrayBuffer();
    if ((await digestHex(ciphertext)) !== row.ciphertext_hash) {
      return { ok: false, code: "integrity_failure" };
    }

    let finalized = false;
    let terminal: ContentStatus | undefined;
    this.ctx.storage.transactionSync(() => {
      const current = this.contentByOperation(request.operationId);
      if (current === undefined) {
        return;
      }
      if (current.status === "staged" || current.status === "preparing") {
        this.ctx.storage.sql.exec(
          `UPDATE content_versions
           SET status = 'finalized', finalized_at = ?, expires_at_ms = NULL,
               commit_claimed = 0, gc_attempts = 0
           WHERE operation_id = ?`,
          new Date().toISOString(),
          request.operationId,
        );
        finalized = true;
        return;
      }
      terminal = current.status;
    });
    if (terminal === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    if (terminal === "expired") {
      return { ok: false, code: "preparation_expired" };
    }
    if (terminal === "expiring") {
      return { ok: false, code: "preparation_expired" };
    }
    const current = this.contentByOperation(request.operationId);
    if (!finalized && current?.status !== "finalized") {
      return { ok: false, code: "not_found" };
    }
    return {
      ok: true,
      prepared: referenceFor(current ?? row),
      replayed: !finalized,
    };
  }

  readAuthorized(input: unknown): Promise<ReadMessageContentResult> {
    return this.ctx.blockConcurrencyWhile(() =>
      this.readAuthorizedExclusively(input),
    );
  }

  private async readAuthorizedExclusively(
    input: unknown,
  ): Promise<ReadMessageContentResult> {
    try {
      await this.requirePromotionAuthorityAvailable();
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    const request = this.validateRead(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }
    const erasure = await this.lookupErasure(request);
    if (erasure.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (erasure.status === "erased") {
      return { ok: false, code: "generation_destroyed" };
    }
    const row = this.contentByKey(request.contentKeyId);
    if (row === undefined || !sameScope(row, request)) {
      return { ok: false, code: "not_found" };
    }
    if (
      row.status === "destroyed" ||
      row.key_material === null ||
      row.iv === null
    ) {
      return { ok: false, code: "generation_destroyed" };
    }
    if (row.status !== "finalized") {
      return { ok: false, code: "not_finalized" };
    }

    let object: R2ObjectBody | null;
    try {
      object = await this.env.CONTENT_BUCKET.get(row.object_key);
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    if (object === null) {
      return { ok: false, code: "integrity_failure" };
    }
    const ciphertext = await object.arrayBuffer();
    if ((await digestHex(ciphertext)) !== row.ciphertext_hash) {
      return { ok: false, code: "integrity_failure" };
    }

    try {
      const keys = await deriveVersionKeys(
        row.key_material,
        row,
        row.content_key_id,
      );
      const plaintext = await decrypt(
        keys.encryption,
        row.iv,
        ciphertext,
        additionalData(row, row.content_key_id, row.object_key),
      );
      if (
        (await keyedCommitment(keys.commitment, plaintext)) !==
        row.content_commitment
      ) {
        return { ok: false, code: "integrity_failure" };
      }
      const decoded: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
      const payload = validatePayload(decoded);
      if (
        payload === null ||
        (payload.topic === null ? 0 : 1) !== row.topic_present
      ) {
        return { ok: false, code: "integrity_failure" };
      }
      return {
        ok: true,
        payload,
        contentCommitment: row.content_commitment,
        version: row.version,
      };
    } catch {
      return { ok: false, code: "integrity_failure" };
    }
  }

  destroyGeneration(
    input: unknown,
  ): Promise<DestroyMessageContentGenerationResult> {
    return this.ctx.blockConcurrencyWhile(() =>
      this.destroyGenerationExclusively(input),
    );
  }

  private async destroyGenerationExclusively(
    input: unknown,
  ): Promise<DestroyMessageContentGenerationResult> {
    const request = this.validateDestroy(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }
    const expected = sortedUnique(request.expectedContentKeyIds);
    if (expected === null || expected.length === 0) {
      return { ok: false, code: "invalid_request" };
    }

    const previous = this.destruction(request.generationId);
    if (previous !== undefined) {
      let previousProof: MessageContentDestructionProof;
      try {
        previousProof = JSON.parse(
          previous.proof_json,
        ) as MessageContentDestructionProof;
      } catch {
        return { ok: false, code: "storage_unavailable" };
      }
      if (
        previous.operation_id !== request.operationId ||
        !sameProofScope(previousProof, request) ||
        !isStringArraySubset(expected, previousProof.destroyedContentKeyIds) ||
        previous.expected_key_ids_json !==
          JSON.stringify(previousProof.destroyedContentKeyIds)
      ) {
        return { ok: false, code: "idempotency_conflict" };
      }
    }

    const lookup = await this.lookupErasure(request);
    if (lookup.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }

    const currentKeys = this.contentKeyIds(request);
    let canonicalKeys: string[];
    if (lookup.status === "clear") {
      if (currentKeys.length === 0) {
        return { ok: false, code: "not_found" };
      }
      if (!isStringArraySubset(expected, currentKeys)) {
        return { ok: false, code: "key_set_mismatch" };
      }
      canonicalKeys = currentKeys;
    } else {
      if (!sameErasureScopeAndOperation(lookup.tombstone, request)) {
        return { ok: false, code: "idempotency_conflict" };
      }
      canonicalKeys = lookup.tombstone.expectedContentKeyIds;
      if (
        !isStringArraySubset(expected, canonicalKeys) ||
        !isStringArraySubset(currentKeys, canonicalKeys)
      ) {
        return { ok: false, code: "key_set_mismatch" };
      }
    }

    const registry = await this.ensureErasureDecision(
      request,
      canonicalKeys,
      lookup,
    );
    if (registry.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (registry.status === "conflict") {
      return { ok: false, code: "idempotency_conflict" };
    }

    const draft: DestructionDraft = {
      schemaVersion: 1,
      operationId: request.operationId,
      workspaceId: request.workspaceId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      generationId: request.generationId,
      destroyedAt: registry.tombstone.recordedAt,
      destroyedContentKeyIds: canonicalKeys,
    };
    const proof: MessageContentDestructionProof = {
      ...draft,
      proofHash: await digestHex(
        new TextEncoder().encode(JSON.stringify(draft)),
      ),
    };
    const result = this.ctx.storage.transactionSync<
      "destroyed" | "replayed" | "conflict" | "mismatch"
    >(() => {
      const existing = this.destruction(request.generationId);
      if (existing !== undefined) {
        const existingProof = JSON.parse(
          existing.proof_json,
        ) as MessageContentDestructionProof;
        if (
          existing.operation_id !== request.operationId ||
          existing.expected_key_ids_json !== JSON.stringify(canonicalKeys) ||
          !sameProofScope(existingProof, request) ||
          existing.proof_json !== JSON.stringify(proof)
        ) {
          return "conflict";
        }
      }
      const keys = this.contentKeyIds(request);
      if (!isStringArraySubset(keys, canonicalKeys)) {
        return "mismatch";
      }
      this.ctx.storage.sql.exec(
        `UPDATE content_versions
         SET key_material = NULL, iv = NULL, status = 'destroyed',
             expires_at_ms = NULL, commit_claimed = 0,
             gc_attempts = 0
         WHERE generation_id = ? AND workspace_id = ? AND conversation_id = ?
           AND message_id = ?`,
        request.generationId,
        request.workspaceId,
        request.conversationId,
        request.messageId,
      );
      if (existing === undefined) {
        this.ctx.storage.sql.exec(
          `INSERT INTO destruction_proofs
            (generation_id, operation_id, expected_key_ids_json, proof_json,
             destroyed_at)
           VALUES (?, ?, ?, ?, ?)`,
          request.generationId,
          request.operationId,
          JSON.stringify(canonicalKeys),
          JSON.stringify(proof),
          proof.destroyedAt,
        );
      }
      return existing === undefined ? "destroyed" : "replayed";
    });

    if (result === "conflict") {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (result === "mismatch") {
      return { ok: false, code: "key_set_mismatch" };
    }
    const stored = this.destruction(request.generationId);
    return {
      ok: true,
      proof:
        stored === undefined
          ? proof
          : (JSON.parse(stored.proof_json) as MessageContentDestructionProof),
      replayed: result === "replayed" || registry.replayed,
    };
  }

  override async alarm(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<ContentRow>(
        `${contentSelect}
         WHERE status IN ('preparing', 'staged', 'expiring')
           AND commit_claimed = 0
           AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?
         ORDER BY expires_at_ms, version
         LIMIT 50`,
        Date.now(),
      )
      .toArray();
    this.ctx.storage.transactionSync(() => {
      for (const row of due) {
        this.ctx.storage.sql.exec(
          `UPDATE content_versions SET status = 'expiring'
           WHERE operation_id = ? AND status IN ('preparing', 'staged')`,
          row.operation_id,
        );
      }
    });
    for (const row of due) {
      try {
        await this.env.CONTENT_BUCKET.delete(row.object_key);
      } catch {
        const attempts = row.gc_attempts + 1;
        this.ctx.storage.sql.exec(
          "UPDATE content_versions SET gc_attempts = ? WHERE operation_id = ?",
          attempts,
          row.operation_id,
        );
        await this.ctx.storage.setAlarm(
          Date.now() + Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
        );
        return;
      }
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO expired_content_history
            (operation_id, generation_id, workspace_id, conversation_id,
             message_id, version, content_key_id, content_commitment,
             topic_present, ciphertext_hash, object_key, staged_at, expired_at)
           SELECT operation_id, generation_id, workspace_id, conversation_id,
                  message_id, version, content_key_id, content_commitment,
                  topic_present, ciphertext_hash, object_key, staged_at, ?
           FROM content_versions
           WHERE operation_id = ? AND status = 'expiring'`,
          new Date().toISOString(),
          row.operation_id,
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM content_versions
           WHERE operation_id = ? AND status = 'expiring'
             AND EXISTS (
               SELECT 1 FROM expired_content_history
               WHERE expired_content_history.operation_id = ?
             )`,
          row.operation_id,
          row.operation_id,
        );
      });
    }
    await this.scheduleNextGc();
  }

  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS content_versions (
        operation_id TEXT PRIMARY KEY NOT NULL,
        generation_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1 AND version <= 1000),
        content_key_id TEXT NOT NULL UNIQUE,
        content_commitment TEXT NOT NULL,
        topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
        ciphertext_hash TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        key_material BLOB,
        iv BLOB,
        status TEXT NOT NULL CHECK (
          status IN (
            'preparing', 'staged', 'expiring', 'finalized', 'expired', 'destroyed'
          )
        ),
        staged_at TEXT NOT NULL,
        finalized_at TEXT,
        expires_at_ms INTEGER,
        commit_claimed INTEGER NOT NULL DEFAULT 0
          CHECK (commit_claimed IN (0, 1)),
        gc_attempts INTEGER NOT NULL DEFAULT 0 CHECK (gc_attempts >= 0),
        UNIQUE (generation_id, version),
        CHECK (generation_id = message_id),
        CHECK (
          (status IN ('preparing', 'staged', 'expiring', 'finalized') AND
           key_material IS NOT NULL AND iv IS NOT NULL) OR
          (status IN ('expired', 'destroyed') AND
           key_material IS NULL AND iv IS NULL)
        )
      ) STRICT;

      CREATE INDEX IF NOT EXISTS content_versions_gc
        ON content_versions (expires_at_ms)
        WHERE status IN ('preparing', 'staged');

      CREATE TABLE IF NOT EXISTS expired_content_history (
        operation_id TEXT PRIMARY KEY NOT NULL,
        generation_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1 AND version <= 1000),
        content_key_id TEXT NOT NULL UNIQUE,
        content_commitment TEXT NOT NULL,
        topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
        ciphertext_hash TEXT NOT NULL,
        object_key TEXT NOT NULL,
        staged_at TEXT NOT NULL,
        expired_at TEXT NOT NULL,
        CHECK (generation_id = message_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS expired_content_generation
        ON expired_content_history (generation_id, content_key_id);

      CREATE TABLE IF NOT EXISTS destruction_proofs (
        generation_id TEXT PRIMARY KEY NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        expected_key_ids_json TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        destroyed_at TEXT NOT NULL
      ) STRICT;
    `);
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(content_versions)")
      .toArray();
    if (!columns.some((column) => column.name === "commit_claimed")) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE content_versions ADD COLUMN commit_claimed INTEGER
         NOT NULL DEFAULT 0 CHECK (commit_claimed IN (0, 1))`,
      );
    }
    this.migrateExpiredContentHistory();
  }

  /**
   * Releases logical version slots created by the pre-history schema while
   * retaining every historical key identifier for a future generation
   * tombstone. The guarded copy/delete makes constructor replay idempotent.
   */
  private migrateExpiredContentHistory(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO expired_content_history
          (operation_id, generation_id, workspace_id, conversation_id,
           message_id, version, content_key_id, content_commitment,
           topic_present, ciphertext_hash, object_key, staged_at, expired_at)
         SELECT operation_id, generation_id, workspace_id, conversation_id,
                message_id, version, content_key_id, content_commitment,
                topic_present, ciphertext_hash, object_key, staged_at, staged_at
         FROM content_versions
         WHERE status = 'expired'`,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM content_versions
         WHERE status = 'expired'
           AND EXISTS (
             SELECT 1 FROM expired_content_history
             WHERE expired_content_history.operation_id =
                   content_versions.operation_id
               AND expired_content_history.content_key_id =
                   content_versions.content_key_id
           )`,
      );
    });
  }

  private async replayStage(
    row: ContentRow,
    request: StageMessageContentInput,
    payloadBytes: Uint8Array<ArrayBuffer>,
  ): Promise<StageMessageContentResult> {
    if (row.status === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    if (row.status === "expired" || row.status === "expiring") {
      return { ok: false, code: "preparation_expired" };
    }
    if (row.key_material === null) {
      return { ok: false, code: "generation_destroyed" };
    }
    const contentCommitment = await keyedCommitment(
      (await deriveVersionKeys(row.key_material, row, row.content_key_id))
        .commitment,
      payloadBytes,
    );
    if (
      !sameScope(row, request) ||
      row.version !== request.version ||
      row.content_commitment !== contentCommitment ||
      row.topic_present !== (request.payload.topic === null ? 0 : 1)
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (row.status === "staged" || row.status === "finalized") {
      return { ok: true, prepared: referenceFor(row), replayed: true };
    }
    await this.scheduleNextGc();
    return this.writePreparation(row, payloadBytes, true);
  }

  private async writePreparation(
    row: ContentRow,
    payloadBytes: Uint8Array<ArrayBuffer>,
    replayed: boolean,
  ): Promise<StageMessageContentResult> {
    if (row.key_material === null || row.iv === null) {
      return { ok: false, code: "generation_destroyed" };
    }
    const keys = await deriveVersionKeys(
      row.key_material,
      row,
      row.content_key_id,
    );
    const ciphertext = await encrypt(
      keys.encryption,
      row.iv,
      payloadBytes,
      additionalData(row, row.content_key_id, row.object_key),
    );
    if ((await digestHex(ciphertext)) !== row.ciphertext_hash) {
      return { ok: false, code: "storage_conflict" };
    }

    try {
      const stored = await this.env.CONTENT_BUCKET.put(
        row.object_key,
        ciphertext,
        {
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: row.ciphertext_hash,
          httpMetadata: { contentType: "application/octet-stream" },
          customMetadata: {
            encryption: "AES-256-GCM",
            contentKeyId: row.content_key_id,
            version: String(row.version),
          },
        },
      );
      if (stored === null) {
        const existing = await this.env.CONTENT_BUCKET.get(row.object_key);
        if (
          existing === null ||
          (await digestHex(await existing.arrayBuffer())) !==
            row.ciphertext_hash
        ) {
          return { ok: false, code: "storage_conflict" };
        }
      }
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }

    const current = this.contentByOperation(row.operation_id);
    if (current === undefined) {
      return { ok: false, code: "storage_unavailable" };
    }
    if (current.status === "destroyed") {
      return { ok: false, code: "generation_destroyed" };
    }
    if (current.status === "expired") {
      try {
        await this.env.CONTENT_BUCKET.delete(row.object_key);
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 1_000);
      }
      return { ok: false, code: "preparation_expired" };
    }
    if (current.status === "expiring") {
      try {
        await this.env.CONTENT_BUCKET.delete(row.object_key);
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 1_000);
      }
      return { ok: false, code: "preparation_expired" };
    }
    if (current.status === "preparing") {
      this.ctx.storage.sql.exec(
        "UPDATE content_versions SET status = 'staged' WHERE operation_id = ? AND status = 'preparing'",
        row.operation_id,
      );
    }
    return { ok: true, prepared: referenceFor(current), replayed };
  }

  private contentByOperation(operationId: string): ContentRow | undefined {
    return this.ctx.storage.sql
      .exec<ContentRow>(`${contentSelect} WHERE operation_id = ?`, operationId)
      .toArray()[0];
  }

  private contentByVersion(
    generationId: string,
    version: number,
  ): ContentRow | undefined {
    return this.ctx.storage.sql
      .exec<ContentRow>(
        `${contentSelect} WHERE generation_id = ? AND version = ?`,
        generationId,
        version,
      )
      .toArray()[0];
  }

  private expiredByOperation(
    operationId: string,
  ): ExpiredContentRow | undefined {
    return this.ctx.storage.sql
      .exec<ExpiredContentRow>(
        `SELECT operation_id, generation_id, workspace_id, conversation_id,
                message_id, version, content_key_id
         FROM expired_content_history WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
  }

  private generationKeyCount(generationId: string): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM (
           SELECT content_key_id FROM content_versions WHERE generation_id = ?
           UNION
           SELECT content_key_id FROM expired_content_history
           WHERE generation_id = ?
         )`,
        generationId,
        generationId,
      )
      .one().count;
  }

  private contentByKey(contentKeyId: string): ContentRow | undefined {
    return this.ctx.storage.sql
      .exec<ContentRow>(
        `${contentSelect} WHERE content_key_id = ?`,
        contentKeyId,
      )
      .toArray()[0];
  }

  private destruction(generationId: string): DestructionRow | undefined {
    return this.ctx.storage.sql
      .exec<DestructionRow>(
        `SELECT generation_id, operation_id, expected_key_ids_json, proof_json
         FROM destruction_proofs WHERE generation_id = ?`,
        generationId,
      )
      .toArray()[0];
  }

  private contentKeyIds(scope: MessageContentScope): string[] {
    return this.ctx.storage.sql
      .exec<Record<"content_key_id", string>>(
        `SELECT content_key_id FROM (
           SELECT content_key_id FROM content_versions
           WHERE generation_id = ? AND workspace_id = ? AND conversation_id = ?
             AND message_id = ?
           UNION
           SELECT content_key_id FROM expired_content_history
           WHERE generation_id = ? AND workspace_id = ? AND conversation_id = ?
             AND message_id = ?
         ) ORDER BY content_key_id`,
        scope.generationId,
        scope.workspaceId,
        scope.conversationId,
        scope.messageId,
        scope.generationId,
        scope.workspaceId,
        scope.conversationId,
        scope.messageId,
      )
      .toArray()
      .map((row) => row.content_key_id);
  }

  private async ensureErasureDecision(
    request: DestroyMessageContentGenerationInput,
    expectedContentKeyIds: string[],
    lookup: Exclude<ErasureLookup, { status: "unavailable" }>,
  ): Promise<ErasureDecision> {
    if (lookup.status === "erased") {
      return sameErasureDecision(
        lookup.tombstone,
        request,
        expectedContentKeyIds,
      )
        ? { status: "recorded", tombstone: lookup.tombstone, replayed: true }
        : { status: "conflict" };
    }

    let recorded: unknown;
    try {
      recorded = await this.env.ERASURE_REGISTRY.record({
        workspaceId: request.workspaceId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        generationId: request.generationId,
        erasureCommandId: request.operationId,
        expectedContentKeyIds,
      });
    } catch {
      return { status: "unavailable" };
    }
    if (!isRecord(recorded) || typeof recorded.ok !== "boolean") {
      return { status: "unavailable" };
    }
    if (!recorded.ok) {
      return recorded.code === "conflict"
        ? { status: "conflict" }
        : { status: "unavailable" };
    }
    if (
      !hasExactKeys(recorded, ["ok", "replayed", "tombstone"]) ||
      typeof recorded.replayed !== "boolean"
    ) {
      return { status: "unavailable" };
    }
    const tombstone = await validateErasureTombstone(recorded.tombstone);
    if (
      tombstone === null ||
      !sameErasureDecision(tombstone, request, expectedContentKeyIds)
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "recorded",
      tombstone,
      replayed: recorded.replayed,
    };
  }

  private validateStage(input: unknown): StageValidation | null {
    if (!isRecord(input) || !this.validScope(input)) {
      return null;
    }
    const operationId = input.operationId;
    const version = input.version;
    const payload = validatePayload(input.payload);
    if (
      typeof operationId !== "string" ||
      !uuidPattern.test(operationId) ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > 1000 ||
      payload === null
    ) {
      return null;
    }
    const payloadBytes = new Uint8Array(
      encodeMessageContentEnvelope(payload.content, payload.topic),
    );
    if (payloadBytes.byteLength > MESSAGE_CONTENT_MAX_ENVELOPE_BYTES) {
      return null;
    }
    return {
      input: {
        operationId,
        workspaceId: input.workspaceId as string,
        conversationId: input.conversationId as string,
        messageId: input.messageId as string,
        generationId: input.generationId as string,
        version,
        payload,
      },
      payloadBytes,
    };
  }

  private validateFinalize(input: unknown): FinalizeMessageContentInput | null {
    if (!isRecord(input) || !this.validScope(input)) {
      return null;
    }
    if (
      typeof input.operationId !== "string" ||
      !uuidPattern.test(input.operationId) ||
      typeof input.contentKeyId !== "string" ||
      !uuidPattern.test(input.contentKeyId)
    ) {
      return null;
    }
    return {
      operationId: input.operationId,
      workspaceId: input.workspaceId as string,
      conversationId: input.conversationId as string,
      messageId: input.messageId as string,
      generationId: input.generationId as string,
      contentKeyId: input.contentKeyId,
    };
  }

  private validateRead(input: unknown): ReadMessageContentInput | null {
    if (!isRecord(input) || !this.validScope(input)) {
      return null;
    }
    if (
      typeof input.contentKeyId !== "string" ||
      !uuidPattern.test(input.contentKeyId) ||
      !["display", "search", "moderation", "bot-context"].includes(
        String(input.purpose),
      )
    ) {
      return null;
    }
    return {
      workspaceId: input.workspaceId as string,
      conversationId: input.conversationId as string,
      messageId: input.messageId as string,
      generationId: input.generationId as string,
      contentKeyId: input.contentKeyId,
      purpose: input.purpose as ReadMessageContentInput["purpose"],
    };
  }

  private validateDestroy(
    input: unknown,
  ): DestroyMessageContentGenerationInput | null {
    if (!isRecord(input) || !this.validScope(input)) {
      return null;
    }
    if (
      typeof input.operationId !== "string" ||
      !uuidPattern.test(input.operationId) ||
      !Array.isArray(input.expectedContentKeyIds) ||
      input.expectedContentKeyIds.length < 1 ||
      input.expectedContentKeyIds.length > 1_000 ||
      !input.expectedContentKeyIds.every(
        (value) => typeof value === "string" && uuidPattern.test(value),
      )
    ) {
      return null;
    }
    return {
      operationId: input.operationId,
      workspaceId: input.workspaceId as string,
      conversationId: input.conversationId as string,
      messageId: input.messageId as string,
      generationId: input.generationId as string,
      expectedContentKeyIds: input.expectedContentKeyIds,
    };
  }

  private validScope(input: Record<string, unknown>): boolean {
    return (
      typeof input.workspaceId === "string" &&
      uuidPattern.test(input.workspaceId) &&
      typeof input.conversationId === "string" &&
      uuidPattern.test(input.conversationId) &&
      typeof input.messageId === "string" &&
      uuidPattern.test(input.messageId) &&
      typeof input.generationId === "string" &&
      input.generationId === input.messageId &&
      this.ctx.id.name === input.messageId
    );
  }

  private async lookupErasure(
    scope: MessageContentScope,
  ): Promise<ErasureLookup> {
    let result: unknown;
    try {
      result = await this.env.ERASURE_REGISTRY.lookup({
        workspaceId: scope.workspaceId,
        conversationId: scope.conversationId,
        messageId: scope.messageId,
        generationId: scope.generationId,
      });
    } catch {
      return { status: "unavailable" };
    }
    if (!isRecord(result) || result.ok !== true) {
      return { status: "unavailable" };
    }
    if (!hasExactKeys(result, ["ok", "tombstone"])) {
      return { status: "unavailable" };
    }
    if (result.tombstone === null) {
      return { status: "clear" };
    }
    const tombstone = await validateErasureTombstone(result.tombstone);
    return tombstone !== null && sameScope(tombstone, scope)
      ? { status: "erased", tombstone }
      : { status: "unavailable" };
  }

  private async scheduleNextGc(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<Record<"expires_at_ms", number>>(
        `SELECT MIN(
           CASE WHEN status = 'expiring' THEN ? ELSE expires_at_ms END
         ) AS expires_at_ms
         FROM content_versions
         WHERE status IN ('preparing', 'staged', 'expiring')
           AND commit_claimed = 0 AND expires_at_ms IS NOT NULL`,
        Date.now(),
      )
      .toArray()[0]?.expires_at_ms;
    if (typeof next !== "number") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current || current <= Date.now()) {
      await this.ctx.storage.setAlarm(next);
    }
  }
}

const contentSelect = `
  SELECT operation_id, generation_id, workspace_id, conversation_id,
         message_id, version, content_key_id, content_commitment,
         topic_present,
         ciphertext_hash,
         object_key, key_material, iv, status, expires_at_ms, gc_attempts,
         commit_claimed
  FROM content_versions`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return sameStringArray(Object.keys(value).sort(), [...expected].sort());
}

async function validateErasureTombstone(
  value: unknown,
): Promise<ErasureTombstone | null> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "conversationId",
      "erasureCommandId",
      "expectedContentKeyIds",
      "generationId",
      "messageId",
      "recordedAt",
      "schemaVersion",
      "tombstoneHash",
      "workspaceId",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.workspaceId !== "string" ||
    !uuidPattern.test(value.workspaceId) ||
    typeof value.conversationId !== "string" ||
    !uuidPattern.test(value.conversationId) ||
    typeof value.messageId !== "string" ||
    !uuidPattern.test(value.messageId) ||
    value.generationId !== value.messageId ||
    typeof value.erasureCommandId !== "string" ||
    !uuidPattern.test(value.erasureCommandId) ||
    !Array.isArray(value.expectedContentKeyIds) ||
    value.expectedContentKeyIds.length < 1 ||
    value.expectedContentKeyIds.length > 1_000 ||
    !value.expectedContentKeyIds.every(
      (entry) => typeof entry === "string" && uuidPattern.test(entry),
    ) ||
    typeof value.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.recordedAt) ||
    typeof value.tombstoneHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.tombstoneHash)
  ) {
    return null;
  }
  const expectedContentKeyIds = sortedUnique(
    value.expectedContentKeyIds as string[],
  );
  if (
    expectedContentKeyIds === null ||
    !sameStringArray(expectedContentKeyIds, value.expectedContentKeyIds)
  ) {
    return null;
  }
  const draft = {
    schemaVersion: 1 as const,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    messageId: value.messageId,
    generationId: value.generationId as string,
    erasureCommandId: value.erasureCommandId,
    expectedContentKeyIds,
    recordedAt: value.recordedAt,
  };
  if (
    (await digestHex(new TextEncoder().encode(canonicalJson(draft)))) !==
    value.tombstoneHash
  ) {
    return null;
  }
  return { ...draft, tombstoneHash: value.tombstoneHash };
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function validatePayload(value: unknown): MessageContentPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "content" ||
    keys[1] !== "schemaVersion" ||
    keys[2] !== "topic" ||
    value.schemaVersion !== 1 ||
    typeof value.content !== "string" ||
    new TextEncoder().encode(value.content).byteLength >
      MESSAGE_CONTENT_MAX_ENVELOPE_BYTES ||
    !(
      value.topic === null ||
      (typeof value.topic === "string" &&
        value.topic.length >= 1 &&
        value.topic.length <= 255)
    )
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    content: value.content,
    topic: value.topic,
  };
}

function isStringArraySubset(values: string[], expected: string[]): boolean {
  const allowed = new Set(expected);
  return values.every((value) => allowed.has(value));
}

function sameScope(
  left: MessageContentScope | ContentRow,
  right: MessageContentScope,
): boolean {
  return (
    ("workspace_id" in left ? left.workspace_id : left.workspaceId) ===
      right.workspaceId &&
    ("conversation_id" in left ? left.conversation_id : left.conversationId) ===
      right.conversationId &&
    ("message_id" in left ? left.message_id : left.messageId) ===
      right.messageId &&
    ("generation_id" in left ? left.generation_id : left.generationId) ===
      right.generationId
  );
}

function sameExpiredScope(
  expired: ExpiredContentRow,
  request: StageMessageContentInput,
): boolean {
  return (
    expired.generation_id === request.generationId &&
    expired.workspace_id === request.workspaceId &&
    expired.conversation_id === request.conversationId &&
    expired.message_id === request.messageId &&
    expired.version === request.version
  );
}

function sameProofScope(
  proof: MessageContentDestructionProof,
  scope: MessageContentScope,
): boolean {
  return (
    proof.workspaceId === scope.workspaceId &&
    proof.conversationId === scope.conversationId &&
    proof.messageId === scope.messageId &&
    proof.generationId === scope.generationId
  );
}

function sameErasureDecision(
  tombstone: ErasureTombstone,
  request: DestroyMessageContentGenerationInput,
  expectedContentKeyIds: readonly string[],
): boolean {
  return (
    sameScope(tombstone, request) &&
    tombstone.erasureCommandId === request.operationId &&
    sameStringArray(tombstone.expectedContentKeyIds, expectedContentKeyIds)
  );
}

function sameErasureScopeAndOperation(
  tombstone: ErasureTombstone,
  request: DestroyMessageContentGenerationInput,
): boolean {
  return (
    sameScope(tombstone, request) &&
    tombstone.erasureCommandId === request.operationId
  );
}

function objectKeyFor(
  scope: StageMessageContentInput,
  contentKeyId: string,
): string {
  return `workspaces/${scope.workspaceId}/conversations/${scope.conversationId}/messages/${scope.messageId}/versions/${scope.version}/${contentKeyId}.aesgcm`;
}

function referenceFor(row: ContentRow): PreparedMessageContentReference {
  return {
    version: row.version,
    contentCommitment: row.content_commitment,
    ciphertextRef: `r2://content/${row.object_key}`,
    contentKeyId: row.content_key_id,
    topicPresent: row.topic_present === 1,
  };
}

function additionalData(
  scope: MessageContentScope | ContentRow,
  contentKeyId: string,
  objectKey: string,
): Uint8Array<ArrayBuffer> {
  const workspaceId =
    "workspace_id" in scope ? scope.workspace_id : scope.workspaceId;
  const conversationId =
    "conversation_id" in scope ? scope.conversation_id : scope.conversationId;
  const messageId = "message_id" in scope ? scope.message_id : scope.messageId;
  const generationId =
    "generation_id" in scope ? scope.generation_id : scope.generationId;
  const version = "version" in scope ? scope.version : undefined;
  return new TextEncoder().encode(
    JSON.stringify([
      "punks-message-content",
      1,
      workspaceId,
      conversationId,
      messageId,
      generationId,
      version,
      contentKeyId,
      objectKey,
    ]),
  );
}

async function encrypt(
  rawKey: BufferSource,
  iv: BufferSource,
  plaintext: BufferSource,
  aad: BufferSource,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  return crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  );
}

async function deriveVersionKeys(
  rootKey: BufferSource,
  scope: MessageContentScope | ContentRow,
  contentKeyId: string,
): Promise<{ encryption: ArrayBuffer; commitment: ArrayBuffer }> {
  const workspaceId =
    "workspace_id" in scope ? scope.workspace_id : scope.workspaceId;
  const conversationId =
    "conversation_id" in scope ? scope.conversation_id : scope.conversationId;
  const messageId = "message_id" in scope ? scope.message_id : scope.messageId;
  const generationId =
    "generation_id" in scope ? scope.generation_id : scope.generationId;
  const version = "version" in scope ? scope.version : 0;
  const encoder = new TextEncoder();
  const salt = encoder.encode(
    JSON.stringify([
      "punks-message-content-hkdf-salt",
      1,
      workspaceId,
      conversationId,
      messageId,
      generationId,
      version,
      contentKeyId,
    ]),
  );
  const root = await crypto.subtle.importKey("raw", rootKey, "HKDF", false, [
    "deriveBits",
  ]);
  const derive = (info: string) =>
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: encoder.encode(`punks-message-content/${info}`),
      },
      root,
      256,
    );
  const [encryption, commitment] = await Promise.all([
    derive("encryption-v1"),
    derive("commitment-v1"),
  ]);
  return { encryption, commitment };
}

async function decrypt(
  rawKey: BufferSource,
  iv: BufferSource,
  ciphertext: BufferSource,
  aad: BufferSource,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    ciphertext,
  );
}

async function digestHex(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function keyedCommitment(
  rawKey: BufferSource,
  value: BufferSource,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortedUnique(values: readonly string[]): string[] | null {
  const unique = [...new Set(values)].sort();
  return unique.length === values.length ? unique : null;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
