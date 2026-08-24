import type { SignedNostrEvent } from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  prepareConversationJournalSegment,
  prepareJournalSegment,
  sha256Hex,
  verifyConversationJournalSegmentHash,
  verifyJournalSegmentHash,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";

function event(
  id: string,
  options: {
    workspaceId?: string;
    conversationId?: string;
    kind?: number;
  } = {},
): SignedNostrEvent {
  const aggregateWorkspaceId = options.workspaceId ?? workspaceId;
  return {
    id: id.padStart(64, "0"),
    pubkey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    created_at: 1_787_227_200,
    kind: options.kind ?? 50000,
    tags: [
      ["workspace", aggregateWorkspaceId],
      ...(options.conversationId === undefined
        ? []
        : [["conversation", options.conversationId] as [string, string]]),
    ],
    content: "{}",
    sig: "0".repeat(128),
  };
}

describe("sealed journal segments", () => {
  it("hashes ordered events and includes the previous segment hash in the seal", async () => {
    const previous = "a".repeat(64);
    const draft = await prepareJournalSegment(
      "58975ca8-3b75-42c7-a13a-51c9d7306200",
      [
        { cursor: 10, event: event("1") },
        { cursor: 11, event: event("2") },
      ],
      previous,
      new Date("2026-08-20T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      startCursor: 10,
      endCursor: 11,
      previousSegmentHash: previous,
      unsignedSeal: { kind: 50002 },
    });
    expect(draft.unsignedSeal.tags).toContainEqual([
      "previous_segment_hash",
      previous,
    ]);
    expect(await verifyJournalSegmentHash(draft)).toBe(true);
    expect(
      await verifyJournalSegmentHash({
        ...draft,
        events: [event("2"), event("1")],
      }),
    ).toBe(false);
  });

  it("rejects a segment with a cursor gap", async () => {
    await expect(
      prepareJournalSegment(
        "58975ca8-3b75-42c7-a13a-51c9d7306200",
        [
          { cursor: 1, event: event("1") },
          { cursor: 3, event: event("2") },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow("contiguous");
  });

  it("rejects Workspace segments that cross aggregate or event-family boundaries", async () => {
    await expect(
      prepareJournalSegment(
        workspaceId,
        [
          {
            cursor: 1,
            event: event("1", {
              workspaceId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
            }),
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/Workspace/);
    await expect(
      prepareJournalSegment(
        workspaceId,
        [{ cursor: 1, event: event("1", { kind: 50100 }) }],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/kind/);
  });

  it("rejects a self-consistent Workspace archive with invalid scope, range, or chain", async () => {
    const draft = await prepareJournalSegment(
      workspaceId,
      [{ cursor: 1, event: event("1") }],
      null,
      new Date(),
    );
    const foreignEvents = [
      event("1", {
        workspaceId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
      }),
    ];
    const foreign = {
      ...draft,
      events: foreignEvents,
      segmentHash: await sha256Hex(
        canonicalJson({
          schemaVersion: 1,
          workspaceId,
          startCursor: 1,
          endCursor: 1,
          previousSegmentHash: null,
          events: foreignEvents,
        }),
      ),
    };
    await expect(verifyJournalSegmentHash(foreign)).resolves.toBe(false);
    await expect(
      prepareJournalSegment(
        workspaceId,
        [{ cursor: 1, event: event("1") }],
        "A".repeat(64),
        new Date(),
      ),
    ).rejects.toThrow(/previous segment hash/);
  });

  it("binds a Conversation segment hash and seal to both aggregate ids", async () => {
    const draft = await prepareConversationJournalSegment(
      workspaceId,
      conversationId,
      [
        {
          cursor: 5,
          event: event("1", { conversationId, kind: 50100 }),
        },
      ],
      null,
      new Date("2026-08-20T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      workspaceId,
      conversationId,
      startCursor: 5,
      endCursor: 5,
      previousSegmentHash: null,
      unsignedSeal: { kind: 50104 },
    });
    expect(draft.unsignedSeal.tags).toContainEqual([
      "conversation",
      conversationId,
    ]);
    expect(await verifyConversationJournalSegmentHash(draft)).toBe(true);
    expect(
      await verifyConversationJournalSegmentHash({
        ...draft,
        conversationId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
      }),
    ).toBe(false);
  });

  it("rejects Conversation segments from another scope or event family", async () => {
    await expect(
      prepareConversationJournalSegment(
        workspaceId,
        conversationId,
        [
          {
            cursor: 1,
            event: event("1", {
              conversationId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
              kind: 50100,
            }),
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/Conversation/);
    await expect(
      prepareConversationJournalSegment(
        workspaceId,
        conversationId,
        [
          {
            cursor: 1,
            event: event("1", { conversationId, kind: 50300 }),
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/kind/);
  });

  it("rejects a self-consistent Conversation archive with invalid scope, range, or chain", async () => {
    const draft = await prepareConversationJournalSegment(
      workspaceId,
      conversationId,
      [{ cursor: 1, event: event("1", { conversationId, kind: 50100 }) }],
      null,
      new Date(),
    );
    const foreignEvents = [
      event("1", {
        conversationId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
        kind: 50100,
      }),
    ];
    const foreign = {
      ...draft,
      events: foreignEvents,
      segmentHash: await sha256Hex(
        canonicalJson({
          schemaVersion: 1,
          workspaceId,
          conversationId,
          startCursor: 1,
          endCursor: 1,
          previousSegmentHash: null,
          events: foreignEvents,
        }),
      ),
    };
    await expect(verifyConversationJournalSegmentHash(foreign)).resolves.toBe(
      false,
    );
    await expect(
      prepareConversationJournalSegment(
        workspaceId,
        conversationId,
        [{ cursor: 1, event: event("1", { conversationId, kind: 50100 }) }],
        "A".repeat(64),
        new Date(),
      ),
    ).rejects.toThrow(/previous segment hash/);
  });
});
