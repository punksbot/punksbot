import {
  MEDIA_UPLOAD_PART_SIZE,
  type PreparedMediaUploadIntent,
} from "@punks/core";

export type MediaUploadState =
  | "granting"
  | "uploading"
  | "finalizing"
  | "candidate"
  | "cleanup_pending"
  | "abandoned"
  | "expired"
  | "rejected";

export interface MediaUploadIntentRow extends Record<string, SqlStorageValue> {
  upload_id: string;
  media_id: string;
  command_digest: string;
  workspace_id: string;
  punk_id: string;
  purpose: "message_attachment";
  byte_length: number;
  content_type: PreparedMediaUploadIntent["contentType"];
  expected_sha256: string;
  issued_at: string;
  issued_at_ms: number;
  expires_at: string;
  expires_at_ms: number;
  part_size: number;
  part_count: number;
  staging_key: string;
  candidate_key: string;
  r2_upload_id: string | null;
  state: MediaUploadState;
  operation_attempt_id: string | null;
  operation_started_at_ms: number | null;
  failure_code: string | null;
  finalized_at: string | null;
  finalize_command_id: string | null;
  abandon_command_id: string | null;
  cleanup_sweeps: number;
  cleanup_target: "abandoned" | "expired" | "rejected" | null;
}

export interface MediaUploadPartRow extends Record<string, SqlStorageValue> {
  part_number: number;
  byte_length: number;
  sha256: string;
  etag: string | null;
  status: "uploading" | "uploaded";
  attempt_id: string | null;
  started_at_ms: number | null;
}

export interface MediaUploadInternalSnapshot {
  uploadId: string;
  mediaId: string;
  commandDigest: string;
  workspaceId: string;
  punkId: string;
  purpose: "message_attachment";
  byteLength: number;
  contentType: PreparedMediaUploadIntent["contentType"];
  sha256: string;
  issuedAt: string;
  issuedAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
  partSize: number;
  partCount: number;
  stagingKey: string;
  candidateKey: string;
  r2UploadId: string | null;
  state: MediaUploadState;
  failureCode: string | null;
  finalizedAt: string | null;
  uploadedParts: Array<{
    partNumber: number;
    byteLength: number;
    sha256: string;
  }>;
}

export function isPreparedMediaUploadIntent(
  value: unknown,
): value is PreparedMediaUploadIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    typeof input.uploadId === "string" &&
    typeof input.mediaId === "string" &&
    typeof input.commandDigest === "string" &&
    typeof input.workspaceId === "string" &&
    typeof input.punkId === "string" &&
    input.purpose === "message_attachment" &&
    Number.isSafeInteger(input.byteLength) &&
    typeof input.contentType === "string" &&
    typeof input.sha256 === "string" &&
    typeof input.issuedAt === "string" &&
    Number.isSafeInteger(input.issuedAtMs) &&
    typeof input.expiresAt === "string" &&
    Number.isSafeInteger(input.expiresAtMs) &&
    input.partSize === MEDIA_UPLOAD_PART_SIZE &&
    Number.isSafeInteger(input.partCount) &&
    typeof input.stagingKey === "string" &&
    typeof input.candidateKey === "string"
  );
}

export function mediaUploadSnapshot(
  row: MediaUploadIntentRow,
  parts: readonly MediaUploadPartRow[] = [],
): MediaUploadInternalSnapshot {
  return {
    uploadId: row.upload_id,
    mediaId: row.media_id,
    commandDigest: row.command_digest,
    workspaceId: row.workspace_id,
    punkId: row.punk_id,
    purpose: row.purpose,
    byteLength: row.byte_length,
    contentType: row.content_type,
    sha256: row.expected_sha256,
    issuedAt: row.issued_at,
    issuedAtMs: row.issued_at_ms,
    expiresAt: row.expires_at,
    expiresAtMs: row.expires_at_ms,
    partSize: row.part_size,
    partCount: row.part_count,
    stagingKey: row.staging_key,
    candidateKey: row.candidate_key,
    r2UploadId: row.r2_upload_id,
    state: row.state,
    failureCode: row.failure_code,
    finalizedAt: row.finalized_at,
    uploadedParts: parts
      .filter((part) => part.status === "uploaded")
      .map((part) => ({
        partNumber: part.part_number,
        byteLength: part.byte_length,
        sha256: part.sha256,
      })),
  };
}

export function sameMediaUploadIntent(
  row: MediaUploadIntentRow,
  intent: PreparedMediaUploadIntent,
): boolean {
  return (
    row.upload_id === intent.uploadId &&
    row.media_id === intent.mediaId &&
    row.command_digest === intent.commandDigest &&
    row.workspace_id === intent.workspaceId &&
    row.punk_id === intent.punkId &&
    row.purpose === intent.purpose &&
    row.byte_length === intent.byteLength &&
    row.content_type === intent.contentType &&
    row.expected_sha256 === intent.sha256 &&
    row.part_size === intent.partSize &&
    row.part_count === intent.partCount &&
    row.staging_key === intent.stagingKey &&
    row.candidate_key === intent.candidateKey
  );
}

export function initializeMediaUploadStorage(
  storage: DurableObjectStorage,
): void {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS media_upload_intent (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      upload_id TEXT NOT NULL UNIQUE,
      media_id TEXT NOT NULL UNIQUE,
      command_digest TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      punk_id TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose = 'message_attachment'),
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      content_type TEXT NOT NULL,
      expected_sha256 TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      part_size INTEGER NOT NULL CHECK (part_size = 8388608),
      part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 32),
      staging_key TEXT NOT NULL,
      candidate_key TEXT NOT NULL,
      r2_upload_id TEXT,
      state TEXT NOT NULL CHECK (state IN (
        'granting', 'uploading', 'finalizing', 'candidate',
        'cleanup_pending', 'abandoned', 'expired', 'rejected'
      )),
      operation_attempt_id TEXT,
      operation_started_at_ms INTEGER,
      failure_code TEXT,
      finalized_at TEXT,
      finalize_command_id TEXT,
      abandon_command_id TEXT,
      cleanup_sweeps INTEGER NOT NULL DEFAULT 0,
      cleanup_target TEXT CHECK (
        cleanup_target IN ('abandoned', 'expired', 'rejected')
      )
    );
    CREATE TABLE IF NOT EXISTS media_upload_parts (
      part_number INTEGER PRIMARY KEY CHECK (part_number BETWEEN 1 AND 32),
      byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
      sha256 TEXT NOT NULL,
      etag TEXT,
      status TEXT NOT NULL CHECK (status IN ('uploading', 'uploaded')),
      attempt_id TEXT,
      started_at_ms INTEGER
    );
  `);
}
