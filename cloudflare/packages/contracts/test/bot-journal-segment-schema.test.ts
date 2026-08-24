import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const botId = "20000000-0000-8000-8000-000000000002";
const installationId = "30000000-0000-8000-8000-000000000003";
const segmentHash = "a".repeat(64);
const previousSegmentHash = "b".repeat(64);

function signedEvent(id: string, kind = 50300) {
  return {
    id: id.padStart(64, "0"),
    pubkey: "c".repeat(64),
    created_at: 1_787_313_600,
    kind,
    tags: [["bot", botId]],
    content: "{}",
    sig: "d".repeat(128),
  };
}

const botArchive = {
  schemaVersion: 1,
  botId,
  startCursor: 1,
  endCursor: 1,
  previousSegmentHash,
  segmentHash,
  events: [signedEvent("1")],
  seal: {
    ...signedEvent("2", 50302),
    tags: [
      ["bot", botId],
      ["start_cursor", "1"],
      ["end_cursor", "1"],
      ["segment_hash", segmentHash],
      ["previous_segment_hash", previousSegmentHash],
      ["attestation", "staging-v1"],
    ],
    content: "{}",
  },
};

const installationArchive = {
  schemaVersion: 1,
  workspaceId,
  installationId,
  startCursor: 7,
  endCursor: 7,
  previousSegmentHash: null,
  segmentHash,
  events: [signedEvent("3", 50310)],
  seal: {
    ...signedEvent("4", 50313),
    tags: [
      ["workspace", workspaceId],
      ["installation", installationId],
      ["start_cursor", "7"],
      ["end_cursor", "7"],
      ["segment_hash", segmentHash],
      ["attestation", "staging-v1"],
    ],
    content: "{}",
  },
};

describe("Bot journal segment JSON contracts", () => {
  it("registers strict Bot and Installation archive contracts", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/bot.journal-segment@1",
        "punks://contracts/bot-installation.journal-segment@1",
      ]),
    );
    expect(
      validateContract("punks://contracts/bot.journal-segment@1", botArchive),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/bot-installation.journal-segment@1",
        installationArchive,
      ),
    ).toEqual({ valid: true });
  });

  it("rejects wrong seal kinds, tag order, unbounded events, and extra data", () => {
    const cases = [
      [
        "punks://contracts/bot.journal-segment@1",
        { ...botArchive, seal: { ...botArchive.seal, kind: 50313 } },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        {
          ...botArchive,
          seal: {
            ...botArchive.seal,
            tags: [
              botArchive.seal.tags[1],
              botArchive.seal.tags[0],
              ...botArchive.seal.tags.slice(2),
            ],
          },
        },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        { ...botArchive, events: [] },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        { ...botArchive, events: [signedEvent("1", 50310)] },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        {
          ...botArchive,
          events: Array.from({ length: 501 }, (_, index) =>
            signedEvent(String(index + 1)),
          ),
        },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        { ...botArchive, workspaceId },
      ],
      [
        "punks://contracts/bot.journal-segment@1",
        { ...botArchive, previousSegmentHash: null },
      ],
      [
        "punks://contracts/bot-installation.journal-segment@1",
        {
          ...installationArchive,
          seal: { ...installationArchive.seal, kind: 50302 },
        },
      ],
      [
        "punks://contracts/bot-installation.journal-segment@1",
        {
          ...installationArchive,
          events: [signedEvent("3", 50300)],
        },
      ],
      [
        "punks://contracts/bot-installation.journal-segment@1",
        {
          ...installationArchive,
          previousSegmentHash,
        },
      ],
      [
        "punks://contracts/bot-installation.journal-segment@1",
        {
          ...installationArchive,
          seal: {
            ...installationArchive.seal,
            tags: [...installationArchive.seal.tags, ["extra", "forbidden"]],
          },
        },
      ],
    ] as const;
    for (const [contract, invalid] of cases) {
      expect(validateContract(contract as never, invalid).valid).toBe(false);
    }
  });
});
