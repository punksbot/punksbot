import { describe, expect, it } from "vitest";

import { validateContract } from "../src/registry";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const digest = "a".repeat(64);

function workspaceEvent() {
  return {
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1_787_230_800,
    kind: 50000,
    tags: [
      ["workspace", workspaceId],
      ["cursor", "1"],
      ["contract", "workspace.create@1"],
      ["delta", "sha256", digest, "1", "1"],
    ],
    content: "{}",
    sig: "3".repeat(128),
  };
}

function seal(kind: number) {
  return {
    id: "4".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1_787_230_801,
    kind,
    tags: [["workspace", workspaceId]],
    content: "{}",
    sig: "5".repeat(128),
  };
}

function conversationEvent() {
  return {
    ...workspaceEvent(),
    kind: 50100,
    tags: [
      ["workspace", workspaceId],
      ["conversation", conversationId],
      ["cursor", "1"],
      ["contract", "conversation.create@1"],
      ["delta", "sha256", digest, "1", "1"],
    ],
  };
}

function workspaceArchive() {
  const event = workspaceEvent();
  return {
    schemaVersion: 2,
    workspaceId,
    startCursor: 1,
    endCursor: 1,
    previousSegmentHash: null,
    segmentHash: "6".repeat(64),
    entries: [
      {
        cursor: 1,
        event,
        chunks: [
          {
            schemaVersion: 2,
            workspaceId,
            cursor: 1,
            chunkIndex: 0,
            chunkCount: 1,
            chunkDigest: digest,
            memberDeltas: [
              { punkId: "punk_owner", present: true, role: "owner" },
            ],
            event,
          },
        ],
      },
    ],
    seal: seal(50002),
  };
}

function conversationArchive() {
  const event = conversationEvent();
  return {
    schemaVersion: 2,
    workspaceId,
    conversationId,
    startCursor: 1,
    endCursor: 1,
    previousSegmentHash: null,
    segmentHash: "6".repeat(64),
    entries: [
      {
        cursor: 1,
        event,
        chunks: [
          {
            schemaVersion: 2,
            workspaceId,
            conversationId,
            cursor: 1,
            chunkIndex: 0,
            chunkCount: 1,
            chunkDigest: digest,
            memberDeltas: [
              {
                punkId: "punk_owner",
                present: true,
                access: "owner",
                joinedAt: "2026-08-21T10:00:00.000Z",
                invitedByPunkId: null,
              },
            ],
            event,
          },
        ],
      },
    ],
    seal: seal(50104),
  };
}

describe("membership journal segment v2 contracts", () => {
  it("accepts a Workspace entry that owns its complete projection chunk lot", () => {
    expect(
      validateContract(
        "punks://contracts/journal.segment@2",
        workspaceArchive(),
      ),
    ).toEqual({ valid: true });
  });

  it("accepts a Conversation entry that owns its complete projection chunk lot", () => {
    expect(
      validateContract(
        "punks://contracts/conversation.journal-segment@2",
        conversationArchive(),
      ),
    ).toEqual({ valid: true });
  });

  it("keeps rosters inside bounded chunks only", () => {
    const archive = workspaceArchive();
    expect(
      validateContract("punks://contracts/journal.segment@2", {
        ...archive,
        members: [],
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/journal.segment@2", {
        ...archive,
        entries: Array.from({ length: 65 }, () => archive.entries[0]),
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/journal.segment@2", {
        ...archive,
        entries: [
          {
            ...archive.entries[0],
            chunks: Array.from(
              { length: 65 },
              () => archive.entries[0]?.chunks[0],
            ),
          },
        ],
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/journal.segment@2", {
        ...archive,
        entries: [
          {
            ...archive.entries[0],
            chunks: [
              {
                ...archive.entries[0]?.chunks[0],
                memberDeltas: Array.from({ length: 101 }, (_, index) => ({
                  punkId: `punk_${index}`,
                  present: true,
                  role: "member",
                })),
              },
            ],
          },
        ],
      }).valid,
    ).toBe(false);
  });
});
