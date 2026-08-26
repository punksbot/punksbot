import type { CreateMediaUploadGrantCommand } from "@punks/contracts";

import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "./json";

export const MEDIA_UPLOAD_PART_SIZE = 8 * 1_024 * 1_024;
export const MEDIA_UPLOAD_MAX_BYTES = 256 * 1_024 * 1_024;
export const MEDIA_UPLOAD_GRANT_TTL_MS = 15 * 60 * 1_000;
export const MEDIA_UPLOAD_OPERATION_LEASE_MS = 30 * 1_000;

export interface PreparedMediaUploadIntent {
  uploadId: string;
  mediaId: string;
  commandDigest: string;
  workspaceId: string;
  punkId: string;
  purpose: "message_attachment";
  byteLength: number;
  contentType: CreateMediaUploadGrantCommand["payload"]["contentType"];
  sha256: string;
  issuedAt: string;
  issuedAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
  partSize: typeof MEDIA_UPLOAD_PART_SIZE;
  partCount: number;
  stagingKey: string;
  candidateKey: string;
}

export async function prepareMediaUploadIntent(
  command: CreateMediaUploadGrantCommand,
  nowMs: number,
): Promise<PreparedMediaUploadIntent> {
  const uploadId = await deriveOpaqueUuid(
    "punks.media-upload.v1",
    canonicalJson({
      workspaceId: command.workspaceId,
      commandId: command.commandId,
    }),
  );
  const mediaId = await deriveOpaqueUuid(
    "punks.media-candidate.v1",
    canonicalJson({ workspaceId: command.workspaceId, uploadId }),
  );
  const workspaceHash = await sha256Hex(command.workspaceId);
  const expiresAtMs = nowMs + MEDIA_UPLOAD_GRANT_TTL_MS;
  return {
    uploadId,
    mediaId,
    commandDigest: await sha256Hex(canonicalJson(command)),
    workspaceId: command.workspaceId,
    punkId: command.actor.punkId,
    purpose: command.payload.purpose,
    byteLength: command.payload.byteLength,
    contentType: command.payload.contentType,
    sha256: command.payload.sha256,
    issuedAt: new Date(nowMs).toISOString(),
    issuedAtMs: nowMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    partSize: MEDIA_UPLOAD_PART_SIZE,
    partCount: Math.ceil(command.payload.byteLength / MEDIA_UPLOAD_PART_SIZE),
    stagingKey: `media-upload-staging/v1/${workspaceHash}/${uploadId}`,
    candidateKey: `media-candidates/v1/${workspaceHash}/${mediaId}`,
  };
}

export function expectedMediaUploadPartSize(
  byteLength: number,
  partNumber: number,
): number | null {
  const partCount = Math.ceil(byteLength / MEDIA_UPLOAD_PART_SIZE);
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > partCount
  ) {
    return null;
  }
  return partNumber === partCount
    ? byteLength - MEDIA_UPLOAD_PART_SIZE * (partCount - 1)
    : MEDIA_UPLOAD_PART_SIZE;
}

export function mediaUploadGrantClaims(
  intent: Pick<
    PreparedMediaUploadIntent,
    | "uploadId"
    | "workspaceId"
    | "punkId"
    | "purpose"
    | "byteLength"
    | "contentType"
    | "sha256"
    | "expiresAtMs"
  >,
): string {
  return canonicalJson({
    version: 1,
    uploadId: intent.uploadId,
    workspaceId: intent.workspaceId,
    punkId: intent.punkId,
    purpose: intent.purpose,
    byteLength: intent.byteLength,
    contentType: intent.contentType,
    sha256: intent.sha256,
    expiresAtMs: intent.expiresAtMs,
  });
}
