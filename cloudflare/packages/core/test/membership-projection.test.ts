import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  encodeMembershipProjectionPayload,
  MAX_MEMBERSHIP_DELTA_CHUNKS,
  MAX_PROJECTION_QUEUE_BYTES,
  prepareMembershipProjection,
  sha256Hex,
  TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";

describe("membership projection preparation", () => {
  it("commits globally and binds every ordered chunk to its scope", async () => {
    const memberDeltas = [
      { punkId: "punk-2", present: false, role: "guest" },
      { punkId: "punk-1", present: true, role: "member" },
    ] as const;
    const prepared = await prepareMembershipProjection(
      { workspaceId, conversationId, cursor: 7 },
      memberDeltas,
    );

    expect(prepared.commitment).toEqual({
      algorithm: "sha256-canonical-json",
      deltaDigest: await sha256Hex(
        canonicalJson({ schemaVersion: 2, memberDeltas }),
      ),
      deltaCount: 2,
      chunkCount: 1,
      chunkDigests: [prepared.chunks[0]?.chunkDigest],
    });
    expect(prepared.chunks[0]?.chunkDigest).toBe(
      await sha256Hex(
        canonicalJson({
          schemaVersion: 2,
          workspaceId,
          conversationId,
          cursor: 7,
          chunkIndex: 0,
          memberDeltas,
        }),
      ),
    );
    expect(prepared.chunks[0]?.memberDeltas).toEqual(memberDeltas);
  });

  it("emits one empty chunk for metadata-only events", async () => {
    const prepared = await prepareMembershipProjection(
      { workspaceId, cursor: 2 },
      [],
    );
    expect(prepared.chunks).toHaveLength(1);
    expect(prepared.chunks[0]?.memberDeltas).toEqual([]);
    expect(prepared.commitment).toMatchObject({
      deltaCount: 0,
      chunkCount: 1,
    });
  });

  it("bounds a 1000-member multibyte create to at most 64 chunks", async () => {
    const memberDeltas = Array.from({ length: 1000 }, (_, index) => ({
      punkId: `${"🧑🏿‍💻".repeat(15)}-${String(index).padStart(4, "0")}`,
      present: true,
      access: "member",
      joinedAt: "2026-08-21T10:00:00.000Z",
      invitedByPunkId: "punk_owner",
    }));
    const prepared = await prepareMembershipProjection(
      { workspaceId, conversationId, cursor: 1 },
      memberDeltas,
    );

    expect(prepared.chunks.length).toBeLessThanOrEqual(
      MAX_MEMBERSHIP_DELTA_CHUNKS,
    );
    expect(prepared.chunks.flatMap((chunk) => chunk.memberDeltas)).toEqual(
      memberDeltas,
    );
    for (const chunk of prepared.chunks) {
      expect(chunk.memberDeltas.length).toBeLessThanOrEqual(100);
      expect(
        new TextEncoder().encode(
          canonicalJson({
            schemaVersion: 2,
            workspaceId,
            conversationId,
            cursor: 1,
            chunkIndex: chunk.chunkIndex,
            memberDeltas: chunk.memberDeltas,
          }),
        ).byteLength,
      ).toBeLessThanOrEqual(TARGET_MEMBERSHIP_DELTA_CHUNK_BYTES);
    }
  });

  it("rejects duplicate Punk coordinates", async () => {
    await expect(
      prepareMembershipProjection({ workspaceId, cursor: 1 }, [
        { punkId: "duplicate", present: true, role: "member" },
        { punkId: "duplicate", present: false, role: "member" },
      ]),
    ).rejects.toThrow("duplicate");
  });

  it("measures the exact canonical UTF-8 body at 126000/126001 bytes", () => {
    const emptyBytes = new TextEncoder().encode(
      canonicalJson({ payload: "" }),
    ).byteLength;
    const atLimit = {
      payload: "x".repeat(MAX_PROJECTION_QUEUE_BYTES - emptyBytes),
    };
    expect(encodeMembershipProjectionPayload(atLimit).byteLength).toBe(
      MAX_PROJECTION_QUEUE_BYTES,
    );
    expect(() =>
      encodeMembershipProjectionPayload({
        payload: `${atLimit.payload}x`,
      }),
    ).toThrow("126000");

    const multibyte = encodeMembershipProjectionPayload({ payload: "é" });
    expect(multibyte.byteLength).toBeGreaterThan(multibyte.json.length);
  });
});
