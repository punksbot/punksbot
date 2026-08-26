import { sha256 } from "@noble/hashes/sha2.js";

import type { MediaUploadInternalSnapshot } from "./media-upload-state";

export function bytesHex(bytes: ArrayBuffer | ArrayBufferView): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function hexBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function hashMediaUploadStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<{ byteLength: number; sha256: string } | null> {
  const hasher = sha256.create();
  const reader = stream.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("Media upload exceeded its immutable grant");
        return null;
      }
      hasher.update(value);
    }
    return { byteLength, sha256: bytesHex(hasher.digest()) };
  } finally {
    reader.releaseLock();
    hasher.destroy();
  }
}

export function candidateObjectMatches(
  object: R2Object,
  snapshot: MediaUploadInternalSnapshot,
): boolean {
  const checksum = object.checksums.sha256;
  return (
    object.key === snapshot.candidateKey &&
    object.size === snapshot.byteLength &&
    object.httpMetadata?.contentType === snapshot.contentType &&
    object.customMetadata?.["punks-schema"] === "media-candidate@1" &&
    object.customMetadata?.["upload-id"] === snapshot.uploadId &&
    object.customMetadata?.["media-id"] === snapshot.mediaId &&
    object.customMetadata?.["verified-sha256"] === snapshot.sha256 &&
    checksum !== undefined &&
    bytesHex(checksum) === snapshot.sha256
  );
}

export function stagingObjectMatches(
  object: R2Object,
  snapshot: MediaUploadInternalSnapshot,
): boolean {
  return (
    object.key === snapshot.stagingKey &&
    object.size === snapshot.byteLength &&
    object.httpMetadata?.contentType === snapshot.contentType &&
    object.customMetadata?.["punks-schema"] === "media-upload-staging@1" &&
    object.customMetadata?.["upload-id"] === snapshot.uploadId &&
    object.customMetadata?.["expected-sha256"] === snapshot.sha256
  );
}
