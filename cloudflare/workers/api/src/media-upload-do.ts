import { DurableObject } from "cloudflare:workers";

import {
  expectedMediaUploadPartSize,
  MEDIA_UPLOAD_OPERATION_LEASE_MS,
} from "@punks/core";

import type { ApiEnv } from "./env";
import {
  initializeMediaUploadStorage,
  isPreparedMediaUploadIntent,
  type MediaUploadIntentRow,
  type MediaUploadInternalSnapshot,
  type MediaUploadPartRow,
  mediaUploadSnapshot,
  sameMediaUploadIntent,
} from "./media-upload-state";

type BeginGrantResult =
  | {
      ok: true;
      action: "create";
      attemptId: string;
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: true;
      action: "ready";
      replayed: true;
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "in_progress"
        | "expired"
        | "terminal";
    };

type BeginPartResult =
  | {
      ok: true;
      action: "upload";
      attemptId: string;
      stagingKey: string;
      r2UploadId: string;
    }
  | { ok: true; action: "replay"; replayed: true }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "in_progress"
        | "expired"
        | "not_uploading";
    };

interface FinalizePart {
  partNumber: number;
  etag: string;
}

type BeginFinalizeResult =
  | {
      ok: true;
      action: "finalize";
      attemptId: string;
      parts: FinalizePart[];
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: true;
      action: "replay";
      replayed: true;
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "in_progress"
        | "expired"
        | "parts_missing"
        | "rejected"
        | "not_uploading";
    };

type BeginAbandonResult =
  | {
      ok: true;
      action: "cleanup";
      attemptId: string;
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: true;
      action: "replay";
      replayed: true;
      snapshot: MediaUploadInternalSnapshot;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "idempotency_conflict"
        | "in_progress"
        | "expired"
        | "finalized";
    };

/** Strongly consistent authority for exactly one immutable upload intention. */
export class MediaUploadDO extends DurableObject<ApiEnv> {
  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      initializeMediaUploadStorage(this.ctx.storage);
    });
  }

  async beginGrant(input: unknown): Promise<BeginGrantResult> {
    if (
      !isPreparedMediaUploadIntent(input) ||
      input.uploadId !== this.ctx.id.name
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    const now = Date.now();
    if (current !== undefined) {
      if (!sameMediaUploadIntent(current, input)) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (current.expires_at_ms <= now) {
        return { ok: false, code: "expired" };
      }
      if (
        current.state === "abandoned" ||
        current.state === "expired" ||
        current.state === "rejected" ||
        current.state === "cleanup_pending"
      ) {
        return { ok: false, code: "terminal" };
      }
      if (current.state !== "granting" && current.r2_upload_id !== null) {
        return {
          ok: true,
          action: "ready",
          replayed: true,
          snapshot: mediaUploadSnapshot(current, this.parts()),
        };
      }
      if (
        current.operation_started_at_ms !== null &&
        current.operation_started_at_ms + MEDIA_UPLOAD_OPERATION_LEASE_MS > now
      ) {
        return { ok: false, code: "in_progress" };
      }
    }

    const attemptId = crypto.randomUUID();
    if (current === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO media_upload_intent
          (singleton, upload_id, media_id, command_digest, workspace_id,
           punk_id, purpose, byte_length, content_type, expected_sha256,
           issued_at, issued_at_ms, expires_at, expires_at_ms, part_size,
           part_count, staging_key, candidate_key, r2_upload_id, state,
           operation_attempt_id, operation_started_at_ms, failure_code,
           finalized_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
                 'granting', ?, ?, NULL, NULL)`,
        input.uploadId,
        input.mediaId,
        input.commandDigest,
        input.workspaceId,
        input.punkId,
        input.purpose,
        input.byteLength,
        input.contentType,
        input.sha256,
        input.issuedAt,
        input.issuedAtMs,
        input.expiresAt,
        input.expiresAtMs,
        input.partSize,
        input.partCount,
        input.stagingKey,
        input.candidateKey,
        attemptId,
        now,
      );
      await this.ctx.storage.setAlarm(input.expiresAtMs);
    } else {
      this.ctx.storage.sql.exec(
        `UPDATE media_upload_intent
            SET operation_attempt_id = ?, operation_started_at_ms = ?,
                failure_code = NULL
          WHERE singleton = 1 AND state = 'granting'`,
        attemptId,
        now,
      );
    }
    const claimed = this.intent();
    if (claimed === undefined) {
      return { ok: false, code: "invalid_request" };
    }
    return {
      ok: true,
      action: "create",
      attemptId,
      snapshot: mediaUploadSnapshot(claimed, this.parts()),
    };
  }

  commitGrant(
    input: unknown,
  ):
    | { ok: true; snapshot: MediaUploadInternalSnapshot }
    | { ok: false; code: "invalid_request" | "superseded" } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      !("r2UploadId" in input) ||
      typeof input.attemptId !== "string" ||
      typeof input.r2UploadId !== "string" ||
      input.r2UploadId.length === 0
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    if (
      current === undefined ||
      current.state !== "granting" ||
      current.operation_attempt_id !== input.attemptId
    ) {
      return { ok: false, code: "superseded" };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET r2_upload_id = ?, state = 'uploading',
              operation_attempt_id = NULL, operation_started_at_ms = NULL,
              failure_code = NULL
        WHERE singleton = 1 AND operation_attempt_id = ?`,
      input.r2UploadId,
      input.attemptId,
    );
    const committed = this.intent();
    return committed === undefined
      ? { ok: false, code: "superseded" }
      : { ok: true, snapshot: mediaUploadSnapshot(committed, this.parts()) };
  }

  failGrant(input: unknown): { ok: boolean } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET operation_attempt_id = NULL, operation_started_at_ms = NULL,
              failure_code = 'storage_unavailable'
        WHERE singleton = 1 AND state = 'granting'
          AND operation_attempt_id = ?`,
      input.attemptId,
    );
    return { ok: true };
  }

  beginPart(input: unknown): BeginPartResult {
    if (
      typeof input !== "object" ||
      input === null ||
      !("workspaceId" in input) ||
      !("punkId" in input) ||
      !("partNumber" in input) ||
      !("byteLength" in input) ||
      !("sha256" in input) ||
      typeof input.workspaceId !== "string" ||
      typeof input.punkId !== "string" ||
      typeof input.partNumber !== "number" ||
      typeof input.byteLength !== "number" ||
      !Number.isSafeInteger(input.partNumber) ||
      !Number.isSafeInteger(input.byteLength) ||
      typeof input.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(input.sha256)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const intent = this.intent();
    if (
      intent === undefined ||
      intent.workspace_id !== input.workspaceId ||
      intent.punk_id !== input.punkId ||
      intent.r2_upload_id === null
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const now = Date.now();
    if (intent.expires_at_ms <= now) {
      return { ok: false, code: "expired" };
    }
    if (intent.state !== "uploading") {
      return { ok: false, code: "not_uploading" };
    }
    const partNumber = input.partNumber;
    const existing = this.part(partNumber);
    if (existing !== undefined) {
      if (
        existing.byte_length !== input.byteLength ||
        existing.sha256 !== input.sha256
      ) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (existing.status === "uploaded") {
        return { ok: true, action: "replay", replayed: true };
      }
      if (
        existing.started_at_ms !== null &&
        existing.started_at_ms + MEDIA_UPLOAD_OPERATION_LEASE_MS > now
      ) {
        return { ok: false, code: "in_progress" };
      }
    }

    const attemptId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO media_upload_parts
        (part_number, byte_length, sha256, etag, status, attempt_id,
         started_at_ms)
       VALUES (?, ?, ?, NULL, 'uploading', ?, ?)
       ON CONFLICT(part_number) DO UPDATE SET
         attempt_id = excluded.attempt_id,
         started_at_ms = excluded.started_at_ms`,
      partNumber,
      input.byteLength,
      input.sha256,
      attemptId,
      now,
    );
    return {
      ok: true,
      action: "upload",
      attemptId,
      stagingKey: intent.staging_key,
      r2UploadId: intent.r2_upload_id,
    };
  }

  commitPart(
    input: unknown,
  ): { ok: true } | { ok: false; code: "invalid_request" | "superseded" } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("partNumber" in input) ||
      !("attemptId" in input) ||
      !("etag" in input) ||
      typeof input.partNumber !== "number" ||
      !Number.isSafeInteger(input.partNumber) ||
      typeof input.attemptId !== "string" ||
      typeof input.etag !== "string" ||
      input.etag.length === 0 ||
      input.etag.length > 256
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const partNumber = input.partNumber;
    const current = this.part(partNumber);
    const intent = this.intent();
    if (
      intent === undefined ||
      intent.state !== "uploading" ||
      current === undefined ||
      current.status !== "uploading" ||
      current.attempt_id !== input.attemptId
    ) {
      return { ok: false, code: "superseded" };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_parts
          SET etag = ?, status = 'uploaded', attempt_id = NULL,
              started_at_ms = NULL
        WHERE part_number = ? AND attempt_id = ?`,
      input.etag,
      partNumber,
      input.attemptId,
    );
    return { ok: true };
  }

  failPart(input: unknown): { ok: boolean } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("partNumber" in input) ||
      !("attemptId" in input) ||
      typeof input.partNumber !== "number" ||
      !Number.isSafeInteger(input.partNumber) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_parts
          SET attempt_id = NULL, started_at_ms = NULL
        WHERE part_number = ? AND status = 'uploading' AND attempt_id = ?`,
      input.partNumber,
      input.attemptId,
    );
    return { ok: true };
  }

  beginFinalize(input: unknown): BeginFinalizeResult {
    if (
      typeof input !== "object" ||
      input === null ||
      !("workspaceId" in input) ||
      !("punkId" in input) ||
      !("commandId" in input) ||
      typeof input.workspaceId !== "string" ||
      typeof input.punkId !== "string" ||
      typeof input.commandId !== "string"
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    if (
      current === undefined ||
      current.upload_id !== this.ctx.id.name ||
      current.workspace_id !== input.workspaceId ||
      current.punk_id !== input.punkId ||
      current.r2_upload_id === null
    ) {
      return { ok: false, code: "invalid_request" };
    }
    if (
      current.finalize_command_id !== null &&
      current.finalize_command_id !== input.commandId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (current.state === "candidate") {
      return {
        ok: true,
        action: "replay",
        replayed: true,
        snapshot: mediaUploadSnapshot(current, this.parts()),
      };
    }
    if (current.state === "rejected") {
      return { ok: false, code: "rejected" };
    }
    const now = Date.now();
    if (current.expires_at_ms <= now) {
      return { ok: false, code: "expired" };
    }
    if (current.state !== "uploading" && current.state !== "finalizing") {
      return { ok: false, code: "not_uploading" };
    }
    if (
      current.state === "finalizing" &&
      current.operation_started_at_ms !== null &&
      current.operation_started_at_ms + MEDIA_UPLOAD_OPERATION_LEASE_MS > now
    ) {
      return { ok: false, code: "in_progress" };
    }

    const rows = this.parts();
    const parts: FinalizePart[] = [];
    if (rows.length !== current.part_count) {
      return { ok: false, code: "parts_missing" };
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const partNumber = index + 1;
      if (
        row === undefined ||
        row.part_number !== partNumber ||
        row.status !== "uploaded" ||
        row.etag === null ||
        row.byte_length !==
          expectedMediaUploadPartSize(current.byte_length, partNumber)
      ) {
        return { ok: false, code: "parts_missing" };
      }
      parts.push({ partNumber, etag: row.etag });
    }

    const attemptId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = 'finalizing', finalize_command_id = ?,
              operation_attempt_id = ?, operation_started_at_ms = ?,
              failure_code = NULL
        WHERE singleton = 1`,
      input.commandId,
      attemptId,
      now,
    );
    const claimed = this.intent();
    if (claimed === undefined) {
      return { ok: false, code: "invalid_request" };
    }
    return {
      ok: true,
      action: "finalize",
      attemptId,
      parts,
      snapshot: mediaUploadSnapshot(claimed, rows),
    };
  }

  authorizeCandidatePublish(input: unknown): { ok: boolean } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false };
    }
    const current = this.intent();
    return {
      ok:
        current !== undefined &&
        current.state === "finalizing" &&
        current.operation_attempt_id === input.attemptId &&
        current.expires_at_ms > Date.now(),
    };
  }

  commitFinalize(
    input: unknown,
  ):
    | { ok: true; snapshot: MediaUploadInternalSnapshot }
    | { ok: false; code: "invalid_request" | "superseded" } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      !("finalizedAt" in input) ||
      typeof input.attemptId !== "string" ||
      typeof input.finalizedAt !== "string" ||
      !Number.isFinite(Date.parse(input.finalizedAt))
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    if (
      current === undefined ||
      current.state !== "finalizing" ||
      current.operation_attempt_id !== input.attemptId
    ) {
      return { ok: false, code: "superseded" };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = 'candidate', finalized_at = ?,
              operation_attempt_id = NULL, operation_started_at_ms = NULL,
              failure_code = NULL
        WHERE singleton = 1 AND operation_attempt_id = ?`,
      input.finalizedAt,
      input.attemptId,
    );
    const committed = this.intent();
    return committed === undefined
      ? { ok: false, code: "superseded" }
      : { ok: true, snapshot: mediaUploadSnapshot(committed, this.parts()) };
  }

  rejectFinalize(input: unknown): { ok: boolean } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      !("code" in input) ||
      typeof input.attemptId !== "string" ||
      (input.code !== "hash_invalid" && input.code !== "conflict")
    ) {
      return { ok: false };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = 'rejected', failure_code = ?,
              operation_attempt_id = NULL, operation_started_at_ms = NULL
              , cleanup_target = 'rejected'
        WHERE singleton = 1 AND state = 'finalizing'
          AND operation_attempt_id = ?`,
      input.code,
      input.attemptId,
    );
    return { ok: true };
  }

  releaseFinalize(input: unknown): { ok: boolean } {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET failure_code = 'ambiguous', operation_attempt_id = NULL,
              operation_started_at_ms = NULL
        WHERE singleton = 1 AND state = 'finalizing'
          AND operation_attempt_id = ?`,
      input.attemptId,
    );
    return { ok: true };
  }

  beginAbandon(input: unknown): BeginAbandonResult {
    if (
      typeof input !== "object" ||
      input === null ||
      !("workspaceId" in input) ||
      !("punkId" in input) ||
      !("commandId" in input) ||
      typeof input.workspaceId !== "string" ||
      typeof input.punkId !== "string" ||
      typeof input.commandId !== "string"
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    if (
      current === undefined ||
      current.upload_id !== this.ctx.id.name ||
      current.workspace_id !== input.workspaceId ||
      current.punk_id !== input.punkId
    ) {
      return { ok: false, code: "invalid_request" };
    }
    if (current.state === "candidate") {
      return { ok: false, code: "finalized" };
    }
    if (
      current.abandon_command_id !== null &&
      current.abandon_command_id !== input.commandId
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    if (current.state === "abandoned") {
      return {
        ok: true,
        action: "replay",
        replayed: true,
        snapshot: mediaUploadSnapshot(current, this.parts()),
      };
    }
    if (current.state === "expired") {
      return { ok: false, code: "expired" };
    }
    const now = Date.now();
    if (
      current.state === "cleanup_pending" &&
      current.operation_started_at_ms !== null &&
      current.operation_started_at_ms + MEDIA_UPLOAD_OPERATION_LEASE_MS > now
    ) {
      return { ok: false, code: "in_progress" };
    }
    const attemptId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = 'cleanup_pending', abandon_command_id = ?,
              failure_code = 'abandoned', operation_attempt_id = ?,
              operation_started_at_ms = ?, cleanup_sweeps = 0,
              cleanup_target = 'abandoned'
        WHERE singleton = 1`,
      input.commandId,
      attemptId,
      now,
    );
    const claimed = this.intent();
    return claimed === undefined
      ? { ok: false, code: "invalid_request" }
      : {
          ok: true,
          action: "cleanup",
          attemptId,
          snapshot: mediaUploadSnapshot(claimed, this.parts()),
        };
  }

  async commitAbandon(
    input: unknown,
  ): Promise<
    | { ok: true; snapshot: MediaUploadInternalSnapshot }
    | { ok: false; code: "invalid_request" | "superseded" }
  > {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const current = this.intent();
    if (
      current === undefined ||
      current.state !== "cleanup_pending" ||
      current.operation_attempt_id !== input.attemptId
    ) {
      return { ok: false, code: "superseded" };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = 'abandoned', failure_code = 'abandoned',
              operation_attempt_id = NULL, operation_started_at_ms = NULL,
              cleanup_sweeps = 1
        WHERE singleton = 1 AND operation_attempt_id = ?`,
      input.attemptId,
    );
    await this.ctx.storage.setAlarm(
      Date.now() + MEDIA_UPLOAD_OPERATION_LEASE_MS,
    );
    const committed = this.intent();
    return committed === undefined
      ? { ok: false, code: "superseded" }
      : { ok: true, snapshot: mediaUploadSnapshot(committed, this.parts()) };
  }

  async deferCleanup(input: unknown): Promise<{ ok: boolean }> {
    if (
      typeof input !== "object" ||
      input === null ||
      !("attemptId" in input) ||
      typeof input.attemptId !== "string"
    ) {
      return { ok: false };
    }
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET failure_code = 'storage_unavailable',
              operation_attempt_id = NULL, operation_started_at_ms = NULL
        WHERE singleton = 1 AND state = 'cleanup_pending'
          AND operation_attempt_id = ?`,
      input.attemptId,
    );
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return { ok: true };
  }

  override async alarm(): Promise<void> {
    let current = this.intent();
    if (current === undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current.state === "candidate") {
      try {
        await this.env.CONTENT_BUCKET.delete(current.staging_key);
        await this.ctx.storage.deleteAlarm();
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      }
      return;
    }

    const now = Date.now();
    let target = current.cleanup_target;
    if (target === null) {
      if (current.state === "abandoned") target = "abandoned";
      else if (current.state === "expired") target = "expired";
      else if (current.state === "rejected") target = "rejected";
      else if (current.expires_at_ms <= now) target = "expired";
    }
    if (target === null) {
      await this.ctx.storage.setAlarm(current.expires_at_ms);
      return;
    }
    if (
      current.state !== "abandoned" &&
      current.state !== "expired" &&
      current.state !== "rejected"
    ) {
      this.ctx.storage.sql.exec(
        `UPDATE media_upload_intent
            SET state = 'cleanup_pending', cleanup_target = ?,
                failure_code = ?, operation_attempt_id = NULL,
                operation_started_at_ms = NULL
          WHERE singleton = 1`,
        target,
        target,
      );
      current = this.intent();
      if (current === undefined) return;
    }

    let cleanupFailed = false;
    if (current.r2_upload_id !== null) {
      try {
        await this.env.CONTENT_BUCKET.resumeMultipartUpload(
          current.staging_key,
          current.r2_upload_id,
        ).abort();
      } catch {
        try {
          await this.env.CONTENT_BUCKET.head(current.staging_key);
        } catch {
          cleanupFailed = true;
        }
      }
    }
    try {
      await this.env.CONTENT_BUCKET.delete([
        current.staging_key,
        current.candidate_key,
      ]);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      this.ctx.storage.sql.exec(
        `UPDATE media_upload_intent
            SET state = 'cleanup_pending', failure_code = 'storage_unavailable',
                cleanup_target = ?
          WHERE singleton = 1`,
        target,
      );
      await this.ctx.storage.setAlarm(now + 60_000);
      return;
    }

    const terminalState = target;
    const terminalFailure =
      target === "rejected" ? (current.failure_code ?? "conflict") : target;
    const previousSweeps = current.cleanup_sweeps;
    this.ctx.storage.sql.exec(
      `UPDATE media_upload_intent
          SET state = ?, failure_code = ?, cleanup_sweeps = cleanup_sweeps + 1,
              operation_attempt_id = NULL, operation_started_at_ms = NULL
        WHERE singleton = 1`,
      terminalState,
      terminalFailure,
    );
    if (previousSweeps < 1) {
      await this.ctx.storage.setAlarm(now + MEDIA_UPLOAD_OPERATION_LEASE_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  inspect(): MediaUploadInternalSnapshot | null {
    const current = this.intent();
    return current === undefined
      ? null
      : mediaUploadSnapshot(current, this.parts());
  }

  private intent(): MediaUploadIntentRow | undefined {
    return this.ctx.storage.sql
      .exec<MediaUploadIntentRow>(
        "SELECT * FROM media_upload_intent WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private part(partNumber: number): MediaUploadPartRow | undefined {
    return this.ctx.storage.sql
      .exec<MediaUploadPartRow>(
        "SELECT * FROM media_upload_parts WHERE part_number = ?",
        partNumber,
      )
      .toArray()[0];
  }

  private parts(): MediaUploadPartRow[] {
    return this.ctx.storage.sql
      .exec<MediaUploadPartRow>(
        "SELECT * FROM media_upload_parts ORDER BY part_number",
      )
      .toArray();
  }
}
