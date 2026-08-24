import { canonicalJson } from "./json";

export const MESSAGE_CONTENT_ENVELOPE_MAX_BYTES = 64 * 1_024;

export interface CanonicalMessageContentEnvelope {
  schemaVersion: 1;
  content: string;
  topic: string | null;
}

/** Canonical bytes encrypted as one Message content version. */
export function encodeMessageContentEnvelope(
  content: string,
  topic: string | null,
): Uint8Array {
  return new TextEncoder().encode(
    canonicalJson({ schemaVersion: 1, content, topic }),
  );
}

export function messageContentEnvelopeFits(
  content: string,
  topic: string | null,
): boolean {
  return (
    encodeMessageContentEnvelope(content, topic).byteLength <=
    MESSAGE_CONTENT_ENVELOPE_MAX_BYTES
  );
}
