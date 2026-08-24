import type { SignedNostrEvent } from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  prepareBotInstallationJournalSegment,
  prepareBotJournalSegment,
  verifyBotInstallationJournalSegmentHash,
  verifyBotJournalSegmentHash,
} from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const anotherWorkspaceId = "10000000-0000-8000-8000-000000000009";
const botId = "20000000-0000-8000-8000-000000000002";
const anotherBotId = "20000000-0000-8000-8000-000000000009";
const installationId = "30000000-0000-8000-8000-000000000003";
const anotherInstallationId = "30000000-0000-8000-8000-000000000009";
const previousSegmentHash = "a".repeat(64);
const now = new Date("2026-08-21T12:00:00.000Z");

function event(
  id: number,
  tags: [string, ...string[]][],
  kind = 50300,
): SignedNostrEvent {
  return {
    id: id.toString(16).padStart(64, "0"),
    pubkey: "b".repeat(64),
    created_at: 1_787_313_600,
    kind,
    tags,
    content: `{"event":${id}}`,
    sig: "c".repeat(128),
  };
}

function botEvent(id: number, aggregateId = botId): SignedNostrEvent {
  return event(id, [["bot", aggregateId]]);
}

function installationEvent(
  id: number,
  aggregateWorkspaceId = workspaceId,
  aggregateInstallationId = installationId,
): SignedNostrEvent {
  return event(
    id,
    [
      ["workspace", aggregateWorkspaceId],
      ["installation", aggregateInstallationId],
    ],
    50310,
  );
}

describe("Bot journal segment foundations", () => {
  it("prepares a Bot seal bound to coordinates, range, chain, and ordered events", async () => {
    const draft = await prepareBotJournalSegment(
      botId,
      [
        { cursor: 10, event: botEvent(1) },
        { cursor: 11, event: botEvent(2) },
      ],
      previousSegmentHash,
      now,
    );

    expect(draft).toMatchObject({
      botId,
      startCursor: 10,
      endCursor: 11,
      previousSegmentHash,
      unsignedSeal: {
        created_at: 1_787_313_600,
        kind: 50302,
        tags: [
          ["bot", botId],
          ["start_cursor", "10"],
          ["end_cursor", "11"],
          ["segment_hash", draft.segmentHash],
          ["previous_segment_hash", previousSegmentHash],
        ],
      },
    });
    expect(JSON.parse(draft.unsignedSeal.content)).toEqual({
      schemaVersion: 1,
      botId,
      startCursor: 10,
      endCursor: 11,
      previousSegmentHash,
      segmentHash: draft.segmentHash,
      eventIds: [botEvent(1).id, botEvent(2).id],
    });
    expect(await verifyBotJournalSegmentHash(draft)).toBe(true);
  });

  it("rejects cross-Bot substitution, event reorder, range changes, and chain substitution", async () => {
    const draft = await prepareBotJournalSegment(
      botId,
      [
        { cursor: 4, event: botEvent(1) },
        { cursor: 5, event: botEvent(2) },
      ],
      previousSegmentHash,
      now,
    );
    const firstEvent = draft.events[0];
    const secondEvent = draft.events[1];
    if (firstEvent === undefined || secondEvent === undefined) {
      throw new Error("Bot segment fixture is incomplete");
    }

    for (const forged of [
      { ...draft, botId: anotherBotId },
      { ...draft, events: [secondEvent, firstEvent] },
      { ...draft, startCursor: 3 },
      { ...draft, endCursor: 6 },
      { ...draft, previousSegmentHash: "d".repeat(64) },
    ]) {
      await expect(verifyBotJournalSegmentHash(forged)).resolves.toBe(false);
    }
    await expect(
      prepareBotJournalSegment(
        botId,
        [{ cursor: 1, event: botEvent(1, anotherBotId) }],
        null,
        now,
      ),
    ).rejects.toThrow(/Bot/);
    await expect(
      prepareBotJournalSegment(
        botId,
        [{ cursor: 1, event: event(1, [["bot", botId]], 50310) }],
        null,
        now,
      ),
    ).rejects.toThrow(/kind/);
  });

  it("binds an Installation seal to both Workspace and Installation", async () => {
    const draft = await prepareBotInstallationJournalSegment(
      workspaceId,
      installationId,
      [{ cursor: 7, event: installationEvent(3) }],
      null,
      now,
    );

    expect(draft).toMatchObject({
      workspaceId,
      installationId,
      startCursor: 7,
      endCursor: 7,
      previousSegmentHash: null,
      unsignedSeal: {
        kind: 50313,
        tags: [
          ["workspace", workspaceId],
          ["installation", installationId],
          ["start_cursor", "7"],
          ["end_cursor", "7"],
          ["segment_hash", draft.segmentHash],
        ],
      },
    });
    expect(await verifyBotInstallationJournalSegmentHash(draft)).toBe(true);
    await expect(
      verifyBotInstallationJournalSegmentHash({
        ...draft,
        workspaceId: anotherWorkspaceId,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyBotInstallationJournalSegmentHash({
        ...draft,
        installationId: anotherInstallationId,
      }),
    ).resolves.toBe(false);
  });

  it("refuses non-contiguous, non-positive, oversized, and cross-aggregate input", async () => {
    for (const cursorEvents of [
      [
        { cursor: 1, event: botEvent(1) },
        { cursor: 3, event: botEvent(2) },
      ],
      [{ cursor: 0, event: botEvent(1) }],
      Array.from({ length: 501 }, (_, index) => ({
        cursor: index + 1,
        event: botEvent(index + 1),
      })),
    ]) {
      await expect(
        prepareBotJournalSegment(botId, cursorEvents, null, now),
      ).rejects.toThrow();
    }
    await expect(
      prepareBotInstallationJournalSegment(
        workspaceId,
        installationId,
        [
          {
            cursor: 1,
            event: installationEvent(1, anotherWorkspaceId, installationId),
          },
        ],
        null,
        now,
      ),
    ).rejects.toThrow(/Workspace/);
    await expect(
      prepareBotInstallationJournalSegment(
        workspaceId,
        installationId,
        [
          {
            cursor: 1,
            event: installationEvent(1, workspaceId, anotherInstallationId),
          },
        ],
        null,
        now,
      ),
    ).rejects.toThrow(/Installation/);
    await expect(
      prepareBotInstallationJournalSegment(
        workspaceId,
        installationId,
        [
          {
            cursor: 1,
            event: event(
              1,
              [
                ["workspace", workspaceId],
                ["installation", installationId],
              ],
              50300,
            ),
          },
        ],
        null,
        now,
      ),
    ).rejects.toThrow(/kind/);
  });

  it("rejects malformed chain hashes", async () => {
    await expect(
      prepareBotJournalSegment(
        botId,
        [{ cursor: 1, event: botEvent(1) }],
        "A".repeat(64),
        now,
      ),
    ).rejects.toThrow(/previous segment hash/);
  });
});
