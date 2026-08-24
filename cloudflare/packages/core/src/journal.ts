import type { SignedNostrEvent, UnsignedNostrEvent } from "@punks/contracts";

import { canonicalJson, sha256Hex } from "./json";
import { PUNKS_EVENT_KINDS } from "./workspace";

export interface CursorEvent {
  cursor: number;
  event: SignedNostrEvent;
}

export interface JournalSegmentDraft {
  workspaceId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  events: SignedNostrEvent[];
  unsignedSeal: UnsignedNostrEvent;
}

export interface ConversationJournalSegmentDraft {
  workspaceId: string;
  conversationId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  events: SignedNostrEvent[];
  unsignedSeal: UnsignedNostrEvent;
}

export interface BotJournalSegmentDraft {
  botId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  events: SignedNostrEvent[];
  unsignedSeal: UnsignedNostrEvent;
}

export interface BotInstallationJournalSegmentDraft {
  workspaceId: string;
  installationId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  events: SignedNostrEvent[];
  unsignedSeal: UnsignedNostrEvent;
}

const segmentHashPattern = /^[0-9a-f]{64}$/u;
const maximumSegmentEvents = 500;
const workspaceJournalEventKinds = [
  PUNKS_EVENT_KINDS.workspaceCreated,
  PUNKS_EVENT_KINDS.workspaceRenamed,
  PUNKS_EVENT_KINDS.workspaceMemberRoleSet,
  PUNKS_EVENT_KINDS.workspaceMemberRemoved,
] as const;
const conversationJournalEventKinds = [
  PUNKS_EVENT_KINDS.conversationCreated,
  PUNKS_EVENT_KINDS.conversationMemberJoined,
  PUNKS_EVENT_KINDS.conversationMemberAccessSet,
  PUNKS_EVENT_KINDS.conversationMemberRemoved,
  PUNKS_EVENT_KINDS.conversationMetadataUpdated,
  PUNKS_EVENT_KINDS.conversationArchived,
  PUNKS_EVENT_KINDS.conversationRestored,
  PUNKS_EVENT_KINDS.messagePosted,
  PUNKS_EVENT_KINDS.messageEdited,
  PUNKS_EVENT_KINDS.messageRetracted,
  PUNKS_EVENT_KINDS.messageRestored,
  PUNKS_EVENT_KINDS.messageErasureMarked,
  PUNKS_EVENT_KINDS.messageReactionAdded,
  PUNKS_EVENT_KINDS.messageReactionRemoved,
] as const;
const botJournalEventKinds = [
  PUNKS_EVENT_KINDS.botPublished,
  PUNKS_EVENT_KINDS.botUpdated,
] as const;
const botInstallationJournalEventKinds = [
  PUNKS_EVENT_KINDS.botInstallationInstalled,
  PUNKS_EVENT_KINDS.botInstallationConfigured,
  PUNKS_EVENT_KINDS.botInstallationRevoked,
  PUNKS_EVENT_KINDS.botActionAdmitted,
  PUNKS_EVENT_KINDS.botActionCompleted,
] as const;

function requireContiguousCursorEvents(
  cursorEvents: readonly CursorEvent[],
  label: string,
): CursorEvent {
  const first = cursorEvents[0];
  if (first === undefined) {
    throw new TypeError(`${label} must contain at least one event`);
  }
  if (cursorEvents.length > maximumSegmentEvents) {
    throw new TypeError(
      `${label} must contain no more than ${maximumSegmentEvents} events`,
    );
  }
  if (!Number.isSafeInteger(first.cursor) || first.cursor < 1) {
    throw new TypeError(`${label} cursors must be positive safe integers`);
  }
  for (const [index, item] of cursorEvents.entries()) {
    if (
      !Number.isSafeInteger(item.cursor) ||
      item.cursor !== first.cursor + index
    ) {
      throw new TypeError(`${label} cursors must be contiguous and ordered`);
    }
  }
  return first;
}

function requirePreviousSegmentHash(previousSegmentHash: string | null): void {
  if (
    previousSegmentHash !== null &&
    !segmentHashPattern.test(previousSegmentHash)
  ) {
    throw new TypeError(
      "Journal segment previous segment hash must be lowercase hexadecimal",
    );
  }
}

function eventHasAggregateTag(
  event: SignedNostrEvent,
  name: string,
  expectedValue: string,
): boolean {
  const matches = event.tags.filter(([tagName]) => tagName === name);
  return (
    matches.length === 1 &&
    matches[0]?.length === 2 &&
    matches[0]?.[1] === expectedValue
  );
}

function requireAggregateEvents(
  cursorEvents: readonly CursorEvent[],
  coordinates: readonly { name: string; value: string; label: string }[],
  allowedKinds: readonly number[],
): void {
  for (const { event } of cursorEvents) {
    if (!allowedKinds.includes(event.kind)) {
      throw new TypeError("Journal segment event kind is not allowed");
    }
    for (const coordinate of coordinates) {
      if (!eventHasAggregateTag(event, coordinate.name, coordinate.value)) {
        throw new TypeError(
          `Journal segment event does not belong to the ${coordinate.label}`,
        );
      }
    }
  }
}

function validSegmentShape(
  segment: {
    startCursor: number;
    endCursor: number;
    previousSegmentHash: string | null;
    segmentHash: string;
    events: SignedNostrEvent[];
  },
  coordinates: readonly { name: string; value: string }[],
  allowedKinds: readonly number[],
): boolean {
  return (
    Number.isSafeInteger(segment.startCursor) &&
    segment.startCursor >= 1 &&
    Number.isSafeInteger(segment.endCursor) &&
    segment.endCursor === segment.startCursor + segment.events.length - 1 &&
    segment.events.length >= 1 &&
    segment.events.length <= maximumSegmentEvents &&
    (segment.previousSegmentHash === null ||
      segmentHashPattern.test(segment.previousSegmentHash)) &&
    segmentHashPattern.test(segment.segmentHash) &&
    segment.events.every((event) => allowedKinds.includes(event.kind)) &&
    segment.events.every((event) =>
      coordinates.every((coordinate) =>
        eventHasAggregateTag(event, coordinate.name, coordinate.value),
      ),
    )
  );
}

export async function prepareJournalSegment(
  workspaceId: string,
  cursorEvents: readonly CursorEvent[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<JournalSegmentDraft> {
  const first = requireContiguousCursorEvents(cursorEvents, "Journal segment");
  requirePreviousSegmentHash(previousSegmentHash);
  requireAggregateEvents(
    cursorEvents,
    [{ name: "workspace", value: workspaceId, label: "Workspace" }],
    workspaceJournalEventKinds,
  );

  const events = cursorEvents.map(({ event }) => event);
  const startCursor = first.cursor;
  const endCursor =
    cursorEvents[cursorEvents.length - 1]?.cursor ?? startCursor;
  const hashInput = canonicalJson({
    schemaVersion: 1,
    workspaceId,
    startCursor,
    endCursor,
    previousSegmentHash,
    events,
  });
  const segmentHash = await sha256Hex(hashInput);
  const tags: [string, ...string[]][] = [
    ["workspace", workspaceId],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }

  return {
    workspaceId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    events,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.journalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 1,
        workspaceId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        eventIds: events.map(({ id }) => id),
      }),
    },
  };
}

export async function prepareConversationJournalSegment(
  workspaceId: string,
  conversationId: string,
  cursorEvents: readonly CursorEvent[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<ConversationJournalSegmentDraft> {
  const first = requireContiguousCursorEvents(
    cursorEvents,
    "Conversation journal segment",
  );
  requirePreviousSegmentHash(previousSegmentHash);
  requireAggregateEvents(
    cursorEvents,
    [
      { name: "workspace", value: workspaceId, label: "Workspace" },
      {
        name: "conversation",
        value: conversationId,
        label: "Conversation",
      },
    ],
    conversationJournalEventKinds,
  );
  const events = cursorEvents.map(({ event }) => event);
  const startCursor = first.cursor;
  const endCursor =
    cursorEvents[cursorEvents.length - 1]?.cursor ?? startCursor;
  const hashInput = canonicalJson({
    schemaVersion: 1,
    workspaceId,
    conversationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    events,
  });
  const segmentHash = await sha256Hex(hashInput);
  const tags: [string, ...string[]][] = [
    ["workspace", workspaceId],
    ["conversation", conversationId],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }

  return {
    workspaceId,
    conversationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    events,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.conversationJournalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 1,
        workspaceId,
        conversationId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        eventIds: events.map(({ id }) => id),
      }),
    },
  };
}

export async function prepareBotJournalSegment(
  botId: string,
  cursorEvents: readonly CursorEvent[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<BotJournalSegmentDraft> {
  const first = requireContiguousCursorEvents(
    cursorEvents,
    "Bot journal segment",
  );
  requirePreviousSegmentHash(previousSegmentHash);
  requireAggregateEvents(
    cursorEvents,
    [{ name: "bot", value: botId, label: "Bot" }],
    botJournalEventKinds,
  );
  const events = cursorEvents.map(({ event }) => event);
  const startCursor = first.cursor;
  const endCursor =
    cursorEvents[cursorEvents.length - 1]?.cursor ?? startCursor;
  const segmentHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      botId,
      startCursor,
      endCursor,
      previousSegmentHash,
      events,
    }),
  );
  const tags: [string, ...string[]][] = [
    ["bot", botId],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }
  return {
    botId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    events,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.botJournalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 1,
        botId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        eventIds: events.map(({ id }) => id),
      }),
    },
  };
}

export async function prepareBotInstallationJournalSegment(
  workspaceId: string,
  installationId: string,
  cursorEvents: readonly CursorEvent[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<BotInstallationJournalSegmentDraft> {
  const first = requireContiguousCursorEvents(
    cursorEvents,
    "Bot Installation journal segment",
  );
  requirePreviousSegmentHash(previousSegmentHash);
  requireAggregateEvents(
    cursorEvents,
    [
      { name: "workspace", value: workspaceId, label: "Workspace" },
      {
        name: "installation",
        value: installationId,
        label: "Installation",
      },
    ],
    botInstallationJournalEventKinds,
  );
  const events = cursorEvents.map(({ event }) => event);
  const startCursor = first.cursor;
  const endCursor =
    cursorEvents[cursorEvents.length - 1]?.cursor ?? startCursor;
  const segmentHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      workspaceId,
      installationId,
      startCursor,
      endCursor,
      previousSegmentHash,
      events,
    }),
  );
  const tags: [string, ...string[]][] = [
    ["workspace", workspaceId],
    ["installation", installationId],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }
  return {
    workspaceId,
    installationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    events,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.botInstallationJournalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 1,
        workspaceId,
        installationId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        eventIds: events.map(({ id }) => id),
      }),
    },
  };
}

export async function verifyJournalSegmentHash(
  segment: Omit<JournalSegmentDraft, "unsignedSeal">,
): Promise<boolean> {
  if (
    !validSegmentShape(
      segment,
      [{ name: "workspace", value: segment.workspaceId }],
      workspaceJournalEventKinds,
    )
  ) {
    return false;
  }
  const hashInput = canonicalJson({
    schemaVersion: 1,
    workspaceId: segment.workspaceId,
    startCursor: segment.startCursor,
    endCursor: segment.endCursor,
    previousSegmentHash: segment.previousSegmentHash,
    events: segment.events,
  });
  return (await sha256Hex(hashInput)) === segment.segmentHash;
}

export async function verifyConversationJournalSegmentHash(
  segment: Omit<ConversationJournalSegmentDraft, "unsignedSeal">,
): Promise<boolean> {
  if (
    !validSegmentShape(
      segment,
      [
        { name: "workspace", value: segment.workspaceId },
        { name: "conversation", value: segment.conversationId },
      ],
      conversationJournalEventKinds,
    )
  ) {
    return false;
  }
  const hashInput = canonicalJson({
    schemaVersion: 1,
    workspaceId: segment.workspaceId,
    conversationId: segment.conversationId,
    startCursor: segment.startCursor,
    endCursor: segment.endCursor,
    previousSegmentHash: segment.previousSegmentHash,
    events: segment.events,
  });
  return (await sha256Hex(hashInput)) === segment.segmentHash;
}

export async function verifyBotJournalSegmentHash(
  segment: Omit<BotJournalSegmentDraft, "unsignedSeal">,
): Promise<boolean> {
  if (
    !validSegmentShape(
      segment,
      [{ name: "bot", value: segment.botId }],
      botJournalEventKinds,
    )
  ) {
    return false;
  }
  const hashInput = canonicalJson({
    schemaVersion: 1,
    botId: segment.botId,
    startCursor: segment.startCursor,
    endCursor: segment.endCursor,
    previousSegmentHash: segment.previousSegmentHash,
    events: segment.events,
  });
  return (await sha256Hex(hashInput)) === segment.segmentHash;
}

export async function verifyBotInstallationJournalSegmentHash(
  segment: Omit<BotInstallationJournalSegmentDraft, "unsignedSeal">,
): Promise<boolean> {
  if (
    !validSegmentShape(
      segment,
      [
        { name: "workspace", value: segment.workspaceId },
        { name: "installation", value: segment.installationId },
      ],
      botInstallationJournalEventKinds,
    )
  ) {
    return false;
  }
  const hashInput = canonicalJson({
    schemaVersion: 1,
    workspaceId: segment.workspaceId,
    installationId: segment.installationId,
    startCursor: segment.startCursor,
    endCursor: segment.endCursor,
    previousSegmentHash: segment.previousSegmentHash,
    events: segment.events,
  });
  return (await sha256Hex(hashInput)) === segment.segmentHash;
}
