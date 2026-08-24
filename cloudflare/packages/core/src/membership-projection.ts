import { canonicalJson, sha256Hex } from "./json";

export const MAX_PROJECTION_QUEUE_BYTES = 126_000;
export const MAX_MEMBERSHIP_DELTA_CHUNKS = 64;
export const MAX_MEMBERSHIP_DELTAS_PER_CHUNK = 100;
export const TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES = 48_000;
export const MAX_MEMBERSHIP_DELTAS_PER_EVENT = 1_000;

export interface MembershipProjectionScope {
  workspaceId: string;
  conversationId?: string;
  cursor: number;
}

export interface MembershipDeltaCoordinate {
  punkId: string;
  present: boolean;
}

export interface MembershipProjectionChunk<
  Delta extends MembershipDeltaCoordinate,
> {
  chunkIndex: number;
  chunkDigest: string;
  memberDeltas: readonly Delta[];
}

export interface MembershipProjectionCommitment {
  algorithm: "sha256-canonical-json";
  deltaDigest: string;
  deltaCount: number;
  chunkCount: number;
  chunkDigests: readonly string[];
}

export interface PreparedMembershipProjection<
  Delta extends MembershipDeltaCoordinate,
> {
  commitment: MembershipProjectionCommitment;
  chunks: readonly MembershipProjectionChunk<Delta>[];
}

export interface EncodedMembershipProjectionPayload {
  json: string;
  byteLength: number;
}

const textEncoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function chunkHashInput<Delta extends MembershipDeltaCoordinate>(
  scope: MembershipProjectionScope,
  chunkIndex: number,
  memberDeltas: readonly Delta[],
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    schemaVersion: 2,
    workspaceId: scope.workspaceId,
    cursor: scope.cursor,
    chunkIndex,
    memberDeltas,
  };
  if (scope.conversationId !== undefined) {
    input.conversationId = scope.conversationId;
  }
  return input;
}

function chunkBodyBytes<Delta extends MembershipDeltaCoordinate>(
  scope: MembershipProjectionScope,
  chunkIndex: number,
  memberDeltas: readonly Delta[],
): number {
  return utf8ByteLength(
    canonicalJson(chunkHashInput(scope, chunkIndex, memberDeltas)),
  );
}

/**
 * Splits an ordered membership delta into bounded chunks and commits every
 * chunk to its aggregate scope. The output is deterministic and side-effect
 * free apart from Web Crypto's digest computation.
 */
export async function prepareMembershipProjection<
  Delta extends MembershipDeltaCoordinate,
>(
  scope: MembershipProjectionScope,
  memberDeltas: readonly Delta[],
): Promise<PreparedMembershipProjection<Delta>> {
  if (memberDeltas.length > MAX_MEMBERSHIP_DELTAS_PER_EVENT) {
    throw new RangeError(
      `Membership projection exceeds ${MAX_MEMBERSHIP_DELTAS_PER_EVENT} deltas`,
    );
  }

  const punkIds = new Set<string>();
  for (const delta of memberDeltas) {
    if (punkIds.has(delta.punkId)) {
      throw new TypeError(
        `Membership projection contains duplicate Punk coordinate ${delta.punkId}`,
      );
    }
    punkIds.add(delta.punkId);
  }

  const chunkDeltas: Delta[][] = [];
  let current: Delta[] = [];
  for (const delta of memberDeltas) {
    const candidate = [...current, delta];
    const exceedsItemLimit = candidate.length > MAX_MEMBERSHIP_DELTAS_PER_CHUNK;
    const exceedsByteTarget =
      chunkBodyBytes(scope, chunkDeltas.length, candidate) >
      TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES;
    if (exceedsItemLimit || exceedsByteTarget) {
      if (current.length === 0) {
        throw new RangeError(
          `A membership delta exceeds the ${TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES}-byte chunk bound`,
        );
      }
      chunkDeltas.push(current);
      current = [delta];
      if (
        chunkBodyBytes(scope, chunkDeltas.length, current) >
        TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES
      ) {
        throw new RangeError(
          `A membership delta exceeds the ${TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES}-byte chunk bound`,
        );
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 || chunkDeltas.length === 0) {
    chunkDeltas.push(current);
  }
  if (chunkDeltas.length > MAX_MEMBERSHIP_DELTA_CHUNKS) {
    throw new RangeError(
      `Membership projection exceeds ${MAX_MEMBERSHIP_DELTA_CHUNKS} chunks`,
    );
  }

  const chunks = await Promise.all(
    chunkDeltas.map(async (chunk, chunkIndex) => ({
      chunkIndex,
      chunkDigest: await sha256Hex(
        canonicalJson(chunkHashInput(scope, chunkIndex, chunk)),
      ),
      memberDeltas: chunk,
    })),
  );
  const deltaDigest = await sha256Hex(
    canonicalJson({ schemaVersion: 2, memberDeltas }),
  );

  return {
    commitment: {
      algorithm: "sha256-canonical-json",
      deltaDigest,
      deltaCount: memberDeltas.length,
      chunkCount: chunks.length,
      chunkDigests: chunks.map((chunk) => chunk.chunkDigest),
    },
    chunks,
  };
}

/** Encodes and enforces the exact UTF-8 size of a final Queue message body. */
export function encodeMembershipProjectionPayload(
  payload: unknown,
): EncodedMembershipProjectionPayload {
  const json = canonicalJson(payload);
  const byteLength = utf8ByteLength(json);
  if (byteLength > MAX_PROJECTION_QUEUE_BYTES) {
    throw new RangeError(
      `Membership projection Queue payload exceeds ${MAX_PROJECTION_QUEUE_BYTES} UTF-8 bytes`,
    );
  }
  return { json, byteLength };
}
