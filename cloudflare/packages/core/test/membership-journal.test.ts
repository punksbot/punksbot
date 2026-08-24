import type {
  ConversationMemberDeltaV2,
  ConversationProjectionMessageV2,
  SignedNostrEvent,
  WorkspaceMemberDeltaV2,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES,
  prepareConversationJournalSegmentV2,
  prepareJournalSegmentV2,
  prepareMembershipProjection,
  verifyConversationJournalSegmentHashV2,
  verifyJournalSegmentHashV2,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const previousSegmentHash = "a".repeat(64);

function fixtureItem<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) {
    throw new Error(`Missing test fixture ${label}`);
  }
  return value;
}

async function workspaceEntry(
  cursor: number,
  memberDeltas: WorkspaceMemberDeltaV2[] = [
    { punkId: "punk_owner", present: true, role: "owner" },
  ],
) {
  const prepared = await prepareMembershipProjection(
    { workspaceId, cursor },
    memberDeltas,
  );
  const content = canonicalJson({
    schemaVersion: 2,
    workspace: {
      id: workspaceId,
      slug: "engineering",
      name: "Engineering",
      visibility: "private",
      status: "active",
      ownerPunkId: "punk_owner",
      memberCount: memberDeltas.length,
      revision: 1,
      cursor,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
    },
    transition: { type: "created" },
    membershipCommitment: prepared.commitment,
  });
  const event: SignedNostrEvent = {
    id: cursor.toString(16).padStart(64, "0"),
    pubkey: "2".repeat(64),
    created_at: 1_787_230_800,
    kind: 50000,
    tags: [
      ["workspace", workspaceId],
      ["cursor", String(cursor)],
      ["contract", "workspace.create@1"],
      [
        "delta",
        "sha256",
        prepared.commitment.deltaDigest,
        String(prepared.commitment.deltaCount),
        String(prepared.commitment.chunkCount),
      ],
    ],
    content,
    sig: "3".repeat(128),
  };
  const chunks: WorkspaceProjectionMessageV2[] = prepared.chunks.map(
    (chunk) => ({
      schemaVersion: 2,
      workspaceId,
      cursor,
      chunkIndex: chunk.chunkIndex,
      chunkCount: prepared.commitment.chunkCount,
      chunkDigest: chunk.chunkDigest,
      memberDeltas: [...chunk.memberDeltas],
      event,
    }),
  );
  return { cursor, event, chunks };
}

async function conversationEntry(cursor: number) {
  const memberDeltas: ConversationMemberDeltaV2[] = [
    {
      punkId: "punk_owner",
      present: true,
      access: "owner",
      joinedAt: "2026-08-21T10:00:00.000Z",
      invitedByPunkId: null,
    },
  ];
  const prepared = await prepareMembershipProjection(
    { workspaceId, conversationId, cursor },
    memberDeltas,
  );
  const content = canonicalJson({
    schemaVersion: 2,
    conversation: {
      id: conversationId,
      workspaceId,
      name: "General",
      type: "stream",
      visibility: "private",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      maxMembers: 1_000,
      ttlSeconds: null,
      ttlDeadline: null,
      ownerPunkId: "punk_owner",
      memberCount: 1,
      status: "active",
      revision: 1,
      cursor,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      archivedAt: null,
    },
    transition: { type: "created" },
    membershipCommitment: prepared.commitment,
  });
  const event: SignedNostrEvent = {
    id: (cursor + 100).toString(16).padStart(64, "0"),
    pubkey: "2".repeat(64),
    created_at: 1_787_230_800,
    kind: 50100,
    tags: [
      ["workspace", workspaceId],
      ["conversation", conversationId],
      ["cursor", String(cursor)],
      ["contract", "conversation.create@1"],
      [
        "delta",
        "sha256",
        prepared.commitment.deltaDigest,
        String(prepared.commitment.deltaCount),
        String(prepared.commitment.chunkCount),
      ],
    ],
    content,
    sig: "3".repeat(128),
  };
  const chunks: ConversationProjectionMessageV2[] = prepared.chunks.map(
    (chunk) => ({
      schemaVersion: 2,
      workspaceId,
      conversationId,
      cursor,
      chunkIndex: chunk.chunkIndex,
      chunkCount: prepared.commitment.chunkCount,
      chunkDigest: chunk.chunkDigest,
      memberDeltas: [...chunk.memberDeltas],
      event,
    }),
  );
  return { cursor, event, chunks };
}

describe("membership journal segments v2", () => {
  it("prepares and verifies a chained Workspace segment", async () => {
    const entry = await workspaceEntry(7);
    const draft = await prepareJournalSegmentV2(
      workspaceId,
      [entry],
      previousSegmentHash,
      new Date("2026-08-21T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      schemaVersion: 2,
      workspaceId,
      startCursor: 7,
      endCursor: 7,
      previousSegmentHash,
      entries: [entry],
      unsignedSeal: { kind: 50002 },
    });
    expect(draft.unsignedSeal.tags).toContainEqual([
      "contract",
      "journal.segment@2",
    ]);
    await expect(verifyJournalSegmentHashV2(draft)).resolves.toBe(true);
  });

  it("refuses to seal an incomplete Workspace projection chunk lot", async () => {
    const entry = await workspaceEntry(1);

    await expect(
      prepareJournalSegmentV2(
        workspaceId,
        [{ ...entry, chunks: [] }],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/complete|chunk/i);
  });

  it("refuses a Workspace chunk substituted from another scope", async () => {
    const entry = await workspaceEntry(1);
    const chunk = fixtureItem(entry.chunks[0], "Workspace chunk");

    await expect(
      prepareJournalSegmentV2(
        workspaceId,
        [
          {
            ...entry,
            chunks: [
              {
                ...chunk,
                workspaceId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
              },
            ],
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/scope|Workspace/i);
  });

  it("refuses substituted Workspace chunk bytes with a retained digest", async () => {
    const entry = await workspaceEntry(1);
    const chunk = fixtureItem(entry.chunks[0], "Workspace chunk");

    await expect(
      prepareJournalSegmentV2(
        workspaceId,
        [
          {
            ...entry,
            chunks: [
              {
                ...chunk,
                memberDeltas: [
                  { punkId: "punk_substituted", present: true, role: "member" },
                ],
              },
            ],
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/digest|commitment/i);
  });

  it("refuses a duplicate signed event across Workspace cursors", async () => {
    const first = await workspaceEntry(1);
    const second = await workspaceEntry(2);
    const duplicatedEvent = { ...second.event, id: first.event.id };

    await expect(
      prepareJournalSegmentV2(
        workspaceId,
        [
          first,
          {
            ...second,
            event: duplicatedEvent,
            chunks: second.chunks.map((chunk) => ({
              ...chunk,
              event: duplicatedEvent,
            })),
          },
        ],
        null,
        new Date(),
      ),
    ).rejects.toThrow(/duplicate|event/i);
  });

  it("bounds aggregate chunks and deltas across a Workspace segment", async () => {
    const entries = await Promise.all(
      Array.from({ length: 7 }, (_, entryIndex) =>
        workspaceEntry(
          entryIndex + 1,
          Array.from({ length: 1_000 }, (_, deltaIndex) => ({
            punkId: `punk_${entryIndex}_${deltaIndex}`,
            present: true,
            role: "member" as const,
          })),
        ),
      ),
    );

    await expect(
      prepareJournalSegmentV2(workspaceId, entries, null, new Date()),
    ).rejects.toThrow(/chunk|delta|bound/i);
  });

  it("bounds the exact canonical Workspace segment UTF-8 bytes", async () => {
    const counts = [1_000, 1_000, 1_000, 1_000, 96];
    const entries = await Promise.all(
      counts.map((count, entryIndex) =>
        workspaceEntry(
          entryIndex + 1,
          Array.from({ length: count }, (_, deltaIndex) => ({
            punkId: `${"é".repeat(118)}_${entryIndex}_${deltaIndex}`,
            present: true,
            role: "member" as const,
          })),
        ),
      ),
    );

    const failure = await prepareJournalSegmentV2(
      workspaceId,
      entries,
      null,
      new Date(),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES).toBe(1_000_000);
    expect(failure).toBeInstanceOf(RangeError);
    expect(String(failure)).toMatch(/UTF-8|bytes/i);
  });

  it("prepares and verifies a chained Conversation segment", async () => {
    const entry = await conversationEntry(3);
    const draft = await prepareConversationJournalSegmentV2(
      workspaceId,
      conversationId,
      [entry],
      previousSegmentHash,
      new Date("2026-08-21T12:00:00.000Z"),
    );

    expect(draft).toMatchObject({
      schemaVersion: 2,
      workspaceId,
      conversationId,
      startCursor: 3,
      endCursor: 3,
      previousSegmentHash,
      entries: [entry],
      unsignedSeal: { kind: 50104 },
    });
    expect(draft.unsignedSeal.tags).toContainEqual([
      "contract",
      "conversation.journal-segment@2",
    ]);
    await expect(verifyConversationJournalSegmentHashV2(draft)).resolves.toBe(
      true,
    );
  });

  it("binds the Workspace hash to chain, event ids, digests, and canonical chunk bytes", async () => {
    const entry = await workspaceEntry(1);
    const draft = await prepareJournalSegmentV2(
      workspaceId,
      [entry],
      previousSegmentHash,
      new Date(),
    );
    const changedEvent = { ...entry.event, sig: "4".repeat(128) };
    const changedCanonicalEntry = {
      ...entry,
      event: changedEvent,
      chunks: entry.chunks.map((chunk) => ({ ...chunk, event: changedEvent })),
    };
    const changedIdEvent = { ...entry.event, id: "9".repeat(64) };
    const changedIdEntry = {
      ...entry,
      event: changedIdEvent,
      chunks: entry.chunks.map((chunk) => ({
        ...chunk,
        event: changedIdEvent,
      })),
    };
    const firstChunk = fixtureItem(entry.chunks[0], "Workspace chunk");

    await expect(
      Promise.all([
        verifyJournalSegmentHashV2({
          ...draft,
          previousSegmentHash: "b".repeat(64),
        }),
        verifyJournalSegmentHashV2({
          ...draft,
          entries: [changedIdEntry],
        }),
        verifyJournalSegmentHashV2({
          ...draft,
          entries: [changedCanonicalEntry],
        }),
        verifyJournalSegmentHashV2({
          ...draft,
          entries: [
            {
              ...entry,
              chunks: [{ ...firstChunk, chunkDigest: "8".repeat(64) }],
            },
          ],
        }),
      ]),
    ).resolves.toEqual([false, false, false, false]);
  });

  it("refuses Workspace chunk order, cursor, and event substitution", async () => {
    const entry = await workspaceEntry(
      1,
      Array.from({ length: 101 }, (_, index) => ({
        punkId: `punk_${index}`,
        present: true,
        role: "member" as const,
      })),
    );
    const reversed = [...entry.chunks].reverse();
    const firstChunk = fixtureItem(entry.chunks[0], "Workspace chunk");
    const otherEvent = { ...entry.event, sig: "4".repeat(128) };

    const failures = await Promise.all(
      [
        { ...entry, chunks: reversed },
        {
          ...entry,
          chunks: [{ ...firstChunk, cursor: 2 }, ...entry.chunks.slice(1)],
        },
        {
          ...entry,
          chunks: [
            { ...firstChunk, event: otherEvent },
            ...entry.chunks.slice(1),
          ],
        },
      ].map((candidate) =>
        prepareJournalSegmentV2(
          workspaceId,
          [candidate],
          null,
          new Date(),
        ).then(
          () => null,
          (error: unknown) => error,
        ),
      ),
    );
    expect(failures.every((failure) => failure instanceof TypeError)).toBe(
      true,
    );
  });

  it("refuses a Conversation lot substituted across either coordinate", async () => {
    const entry = await conversationEntry(1);
    const foreignId = "d86a1021-24dd-4e2d-bf0a-5ba340637bbc";

    await expect(
      Promise.all([
        prepareConversationJournalSegmentV2(
          foreignId,
          conversationId,
          [entry],
          null,
          new Date(),
        ).then(
          () => null,
          (error: unknown) => error,
        ),
        prepareConversationJournalSegmentV2(
          workspaceId,
          foreignId,
          [entry],
          null,
          new Date(),
        ).then(
          () => null,
          (error: unknown) => error,
        ),
      ]),
    ).resolves.toEqual([expect.any(TypeError), expect.any(TypeError)]);
  });

  it("refuses incomplete, substituted, or canonically altered Conversation lots", async () => {
    const entry = await conversationEntry(1);
    const firstChunk = fixtureItem(entry.chunks[0], "Conversation chunk");
    const firstDelta = fixtureItem(
      firstChunk.memberDeltas[0],
      "Conversation delta",
    );
    const incomplete = await prepareConversationJournalSegmentV2(
      workspaceId,
      conversationId,
      [{ ...entry, chunks: [] }],
      null,
      new Date(),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const substituted = await prepareConversationJournalSegmentV2(
      workspaceId,
      conversationId,
      [
        {
          ...entry,
          chunks: [
            {
              ...firstChunk,
              memberDeltas: [
                {
                  ...firstDelta,
                  punkId: "punk_substituted",
                },
              ],
            },
          ],
        },
      ],
      null,
      new Date(),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const draft = await prepareConversationJournalSegmentV2(
      workspaceId,
      conversationId,
      [entry],
      null,
      new Date(),
    );
    const changedEvent = { ...entry.event, sig: "4".repeat(128) };
    const altered = await verifyConversationJournalSegmentHashV2({
      ...draft,
      entries: [
        {
          ...entry,
          event: changedEvent,
          chunks: entry.chunks.map((chunk) => ({
            ...chunk,
            event: changedEvent,
          })),
        },
      ],
    });

    expect(incomplete).toBeInstanceOf(TypeError);
    expect(substituted).toBeInstanceOf(TypeError);
    expect(altered).toBe(false);
  });
});
