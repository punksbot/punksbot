import type {
  ConversationEventContentV2,
  ConversationProjectionMessageV2,
  SignedNostrEvent,
  UnsignedNostrEvent,
  WorkspaceEventContentV2,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import { canonicalJson, sha256Hex } from "./json";
import { encodeMembershipProjectionPayload } from "./membership-projection";
import { PUNKS_EVENT_KINDS } from "./workspace";

export const MAX_MEMBERSHIP_JOURNAL_SEGMENT_ENTRIES = 64;
export const MAX_MEMBERSHIP_JOURNAL_SEGMENT_CHUNKS = 64;
export const MAX_MEMBERSHIP_JOURNAL_SEGMENT_DELTAS = 4_096;
export const MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES = 1_000_000;

export interface WorkspaceMembershipJournalEntryV2 {
  cursor: number;
  event: SignedNostrEvent;
  chunks: readonly WorkspaceProjectionMessageV2[];
}

export interface MembershipJournalSegmentDraftV2 {
  schemaVersion: 2;
  workspaceId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  entries: readonly WorkspaceMembershipJournalEntryV2[];
  unsignedSeal: UnsignedNostrEvent;
}

export interface ConversationMembershipJournalEntryV2 {
  cursor: number;
  event: SignedNostrEvent;
  chunks: readonly ConversationProjectionMessageV2[];
}

export interface ConversationMembershipJournalSegmentDraftV2 {
  schemaVersion: 2;
  workspaceId: string;
  conversationId: string;
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  entries: readonly ConversationMembershipJournalEntryV2[];
  unsignedSeal: UnsignedNostrEvent;
}

const segmentHashPattern = /^[0-9a-f]{64}$/u;
const signedSealByteBudget = 8_192;
const textEncoder = new TextEncoder();

interface BoundedMembershipJournalEntry {
  cursor: number;
  event: SignedNostrEvent;
  chunks: readonly {
    memberDeltas: readonly { punkId: string }[];
  }[];
}

function requireSegmentEntries<Entry extends BoundedMembershipJournalEntry>(
  entries: readonly Entry[],
): Entry {
  const first = entries[0];
  if (first === undefined) {
    throw new TypeError("Membership journal segment must contain an entry");
  }
  if (entries.length > MAX_MEMBERSHIP_JOURNAL_SEGMENT_ENTRIES) {
    throw new RangeError(
      `Membership journal segment exceeds ${MAX_MEMBERSHIP_JOURNAL_SEGMENT_ENTRIES} entries`,
    );
  }
  const eventIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (
      first.cursor < 1 ||
      !Number.isSafeInteger(entry.cursor) ||
      entry.cursor !== first.cursor + index
    ) {
      throw new TypeError(
        "Membership journal segment cursors must be contiguous and ordered",
      );
    }
    if (eventIds.has(entry.event.id)) {
      throw new TypeError(
        "Membership journal segment contains a duplicate event id",
      );
    }
    eventIds.add(entry.event.id);
  }
  return first;
}

function requirePreviousSegmentHash(value: string | null): void {
  if (value !== null && !segmentHashPattern.test(value)) {
    throw new TypeError(
      "Membership journal previous segment hash must be lowercase hexadecimal",
    );
  }
}

function requireSegmentCapacity(
  entries: readonly BoundedMembershipJournalEntry[],
): void {
  const chunkCount = entries.reduce(
    (total, entry) => total + entry.chunks.length,
    0,
  );
  const deltaCount = entries.reduce(
    (total, entry) =>
      total +
      entry.chunks.reduce(
        (entryTotal, chunk) => entryTotal + chunk.memberDeltas.length,
        0,
      ),
    0,
  );
  if (chunkCount > MAX_MEMBERSHIP_JOURNAL_SEGMENT_CHUNKS) {
    throw new RangeError(
      `Membership journal segment exceeds ${MAX_MEMBERSHIP_JOURNAL_SEGMENT_CHUNKS} chunks`,
    );
  }
  if (deltaCount > MAX_MEMBERSHIP_JOURNAL_SEGMENT_DELTAS) {
    throw new RangeError(
      `Membership journal segment exceeds ${MAX_MEMBERSHIP_JOURNAL_SEGMENT_DELTAS} deltas`,
    );
  }
}

function eventHasExactTag(
  event: SignedNostrEvent,
  name: string,
  value: string,
): boolean {
  const matches = event.tags.filter(([tagName]) => tagName === name);
  return (
    matches.length === 1 &&
    matches[0]?.length === 2 &&
    matches[0]?.[1] === value
  );
}

function eventHasExactValuesTag(
  event: SignedNostrEvent,
  name: string,
  values: readonly string[],
): boolean {
  const matches = event.tags.filter(([tagName]) => tagName === name);
  return (
    matches.length === 1 &&
    matches[0]?.length === values.length + 1 &&
    matches[0]?.every((value, index) =>
      index === 0 ? value === name : value === values[index - 1],
    ) === true
  );
}

function workspaceContractForKind(kind: number): string | null {
  return kind === PUNKS_EVENT_KINDS.workspaceCreated
    ? "workspace.create@1"
    : kind === PUNKS_EVENT_KINDS.workspaceRenamed
      ? "workspace.rename@1"
      : kind === PUNKS_EVENT_KINDS.workspaceMemberRoleSet
        ? "workspace.member-set-role@1"
        : kind === PUNKS_EVENT_KINDS.workspaceMemberRemoved
          ? "workspace.member-remove@1"
          : null;
}

async function requireCompleteWorkspaceChunkLot(
  workspaceId: string,
  entry: WorkspaceMembershipJournalEntryV2,
): Promise<void> {
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(entry.event.content) as unknown;
  } catch {
    throw new TypeError("Membership journal event content must be JSON");
  }
  if (
    canonicalJson(parsedContent) !== entry.event.content ||
    !validateContract("punks://contracts/workspace.event@2", parsedContent)
      .valid
  ) {
    throw new TypeError(
      "Membership journal event must contain canonical Workspace v2 content",
    );
  }
  const content = parsedContent as WorkspaceEventContentV2;
  const commitment = content.membershipCommitment;
  const chunkCount = commitment.chunkCount;
  const expectedContract = workspaceContractForKind(entry.event.kind);
  if (
    entry.chunks.length === 0 ||
    entry.chunks.length !== chunkCount ||
    commitment.chunkDigests.length !== chunkCount
  ) {
    throw new TypeError(
      "Membership journal entry must contain its complete chunk lot",
    );
  }
  if (
    expectedContract === null ||
    content.workspace.id !== workspaceId ||
    content.workspace.cursor !== entry.cursor ||
    !eventHasExactTag(entry.event, "workspace", workspaceId) ||
    !eventHasExactTag(entry.event, "cursor", String(entry.cursor)) ||
    !eventHasExactTag(entry.event, "contract", expectedContract) ||
    !eventHasExactValuesTag(entry.event, "delta", [
      "sha256",
      commitment.deltaDigest,
      String(commitment.deltaCount),
      String(commitment.chunkCount),
    ]) ||
    entry.chunks.some(
      (chunk, index) =>
        chunk.workspaceId !== workspaceId ||
        chunk.cursor !== entry.cursor ||
        chunk.chunkIndex !== index ||
        chunk.chunkCount !== chunkCount ||
        canonicalJson(chunk.event) !== canonicalJson(entry.event),
    )
  ) {
    throw new TypeError(
      "Membership journal chunk does not match its Workspace scope, cursor, order, or event",
    );
  }

  const memberDeltas = [] as WorkspaceProjectionMessageV2["memberDeltas"];
  for (const [index, chunk] of entry.chunks.entries()) {
    if (
      !validateContract("punks://contracts/workspace.projection@2", chunk).valid
    ) {
      throw new TypeError("Membership journal chunk is not a v2 projection");
    }
    encodeMembershipProjectionPayload(chunk);
    const digest = await sha256Hex(
      canonicalJson({
        schemaVersion: 2,
        workspaceId,
        cursor: entry.cursor,
        chunkIndex: index,
        memberDeltas: chunk.memberDeltas,
      }),
    );
    if (
      digest !== chunk.chunkDigest ||
      digest !== commitment.chunkDigests[index]
    ) {
      throw new TypeError("Membership journal chunk digest does not match");
    }
    memberDeltas.push(...chunk.memberDeltas);
  }
  if (
    memberDeltas.length !== commitment.deltaCount ||
    (await sha256Hex(canonicalJson({ schemaVersion: 2, memberDeltas }))) !==
      commitment.deltaDigest ||
    new Set(memberDeltas.map((delta) => delta.punkId)).size !==
      memberDeltas.length
  ) {
    throw new TypeError(
      "Membership journal global delta commitment does not match",
    );
  }
}

function conversationContractForKind(kind: number): string | null {
  return kind === PUNKS_EVENT_KINDS.conversationCreated
    ? "conversation.create@1"
    : kind === PUNKS_EVENT_KINDS.conversationMemberJoined
      ? "conversation.join@1"
      : kind === PUNKS_EVENT_KINDS.conversationMemberAccessSet
        ? "conversation.member-set-access@1"
        : kind === PUNKS_EVENT_KINDS.conversationMemberRemoved
          ? "conversation.member-remove@1"
          : kind === PUNKS_EVENT_KINDS.conversationMetadataUpdated
            ? "conversation.update@1"
            : kind === PUNKS_EVENT_KINDS.conversationArchived
              ? "conversation.archive@1"
              : kind === PUNKS_EVENT_KINDS.conversationRestored
                ? "conversation.restore@1"
                : null;
}

async function requireCompleteConversationChunkLot(
  workspaceId: string,
  conversationId: string,
  entry: ConversationMembershipJournalEntryV2,
): Promise<void> {
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(entry.event.content) as unknown;
  } catch {
    throw new TypeError("Membership journal event content must be JSON");
  }
  if (
    canonicalJson(parsedContent) !== entry.event.content ||
    !validateContract("punks://contracts/conversation.event@2", parsedContent)
      .valid
  ) {
    throw new TypeError(
      "Membership journal event must contain canonical Conversation v2 content",
    );
  }
  const content = parsedContent as ConversationEventContentV2;
  const commitment = content.membershipCommitment;
  const expectedContract = conversationContractForKind(entry.event.kind);
  if (
    entry.chunks.length === 0 ||
    entry.chunks.length !== commitment.chunkCount ||
    commitment.chunkDigests.length !== commitment.chunkCount
  ) {
    throw new TypeError(
      "Membership journal entry must contain its complete chunk lot",
    );
  }
  if (
    expectedContract === null ||
    content.conversation.workspaceId !== workspaceId ||
    content.conversation.id !== conversationId ||
    content.conversation.cursor !== entry.cursor ||
    !eventHasExactTag(entry.event, "workspace", workspaceId) ||
    !eventHasExactTag(entry.event, "conversation", conversationId) ||
    !eventHasExactTag(entry.event, "cursor", String(entry.cursor)) ||
    !eventHasExactTag(entry.event, "contract", expectedContract) ||
    !eventHasExactValuesTag(entry.event, "delta", [
      "sha256",
      commitment.deltaDigest,
      String(commitment.deltaCount),
      String(commitment.chunkCount),
    ]) ||
    entry.chunks.some(
      (chunk, index) =>
        chunk.workspaceId !== workspaceId ||
        chunk.conversationId !== conversationId ||
        chunk.cursor !== entry.cursor ||
        chunk.chunkIndex !== index ||
        chunk.chunkCount !== commitment.chunkCount ||
        canonicalJson(chunk.event) !== canonicalJson(entry.event),
    )
  ) {
    throw new TypeError(
      "Membership journal chunk does not match its Conversation scope, cursor, order, or event",
    );
  }

  const memberDeltas = [] as ConversationProjectionMessageV2["memberDeltas"];
  for (const [index, chunk] of entry.chunks.entries()) {
    if (
      !validateContract("punks://contracts/conversation.projection@2", chunk)
        .valid
    ) {
      throw new TypeError("Membership journal chunk is not a v2 projection");
    }
    encodeMembershipProjectionPayload(chunk);
    const digest = await sha256Hex(
      canonicalJson({
        schemaVersion: 2,
        workspaceId,
        conversationId,
        cursor: entry.cursor,
        chunkIndex: index,
        memberDeltas: chunk.memberDeltas,
      }),
    );
    if (
      digest !== chunk.chunkDigest ||
      digest !== commitment.chunkDigests[index]
    ) {
      throw new TypeError("Membership journal chunk digest does not match");
    }
    memberDeltas.push(...chunk.memberDeltas);
  }
  if (
    memberDeltas.length !== commitment.deltaCount ||
    (await sha256Hex(canonicalJson({ schemaVersion: 2, memberDeltas }))) !==
      commitment.deltaDigest ||
    new Set(memberDeltas.map((delta) => delta.punkId)).size !==
      memberDeltas.length
  ) {
    throw new TypeError(
      "Membership journal global delta commitment does not match",
    );
  }
}

function workspaceHashInput(
  workspaceId: string,
  startCursor: number,
  endCursor: number,
  previousSegmentHash: string | null,
  entries: readonly WorkspaceMembershipJournalEntryV2[],
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    contract: "journal.segment@2",
    workspaceId,
    startCursor,
    endCursor,
    previousSegmentHash,
    entries: entries.map((entry) => ({
      cursor: entry.cursor,
      eventId: entry.event.id,
      chunks: entry.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkDigest: chunk.chunkDigest,
        canonicalProjection: chunk,
      })),
    })),
  };
}

function requireWorkspaceSegmentByteCapacity(
  workspaceId: string,
  startCursor: number,
  endCursor: number,
  previousSegmentHash: string | null,
  segmentHash: string,
  entries: readonly WorkspaceMembershipJournalEntryV2[],
): void {
  const bodyBytes = textEncoder.encode(
    canonicalJson({
      schemaVersion: 2,
      workspaceId,
      startCursor,
      endCursor,
      previousSegmentHash,
      segmentHash,
      entries,
    }),
  ).byteLength;
  if (bodyBytes + signedSealByteBudget > MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES) {
    throw new RangeError(
      `Membership journal segment exceeds ${MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES} UTF-8 bytes including its seal budget`,
    );
  }
}

/** Prepares a hash-chained Workspace membership archive segment. */
export async function prepareJournalSegmentV2(
  workspaceId: string,
  entries: readonly WorkspaceMembershipJournalEntryV2[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<MembershipJournalSegmentDraftV2> {
  const first = requireSegmentEntries(entries);
  requirePreviousSegmentHash(previousSegmentHash);
  requireSegmentCapacity(entries);
  for (const entry of entries) {
    await requireCompleteWorkspaceChunkLot(workspaceId, entry);
  }
  const startCursor = first.cursor;
  const endCursor = entries[entries.length - 1]?.cursor ?? startCursor;
  const segmentHash = await sha256Hex(
    canonicalJson(
      workspaceHashInput(
        workspaceId,
        startCursor,
        endCursor,
        previousSegmentHash,
        entries,
      ),
    ),
  );
  requireWorkspaceSegmentByteCapacity(
    workspaceId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    entries,
  );
  const tags: [string, ...string[]][] = [
    ["workspace", workspaceId],
    ["contract", "journal.segment@2"],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }
  return {
    schemaVersion: 2,
    workspaceId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    entries,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.journalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 2,
        contract: "journal.segment@2",
        workspaceId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        entries: entries.map((entry) => ({
          cursor: entry.cursor,
          eventId: entry.event.id,
          chunkDigests: entry.chunks.map((chunk) => chunk.chunkDigest),
        })),
      }),
    },
  };
}

/** Verifies the structural chain and canonical Workspace segment hash. */
export async function verifyJournalSegmentHashV2(
  segment: Omit<MembershipJournalSegmentDraftV2, "unsignedSeal">,
): Promise<boolean> {
  try {
    const first = requireSegmentEntries(segment.entries);
    requirePreviousSegmentHash(segment.previousSegmentHash);
    requireSegmentCapacity(segment.entries);
    for (const entry of segment.entries) {
      await requireCompleteWorkspaceChunkLot(segment.workspaceId, entry);
    }
    if (
      segment.schemaVersion !== 2 ||
      segment.startCursor !== first.cursor ||
      segment.endCursor !== segment.startCursor + segment.entries.length - 1 ||
      !segmentHashPattern.test(segment.segmentHash)
    ) {
      return false;
    }
    requireWorkspaceSegmentByteCapacity(
      segment.workspaceId,
      segment.startCursor,
      segment.endCursor,
      segment.previousSegmentHash,
      segment.segmentHash,
      segment.entries,
    );
    return (
      (await sha256Hex(
        canonicalJson(
          workspaceHashInput(
            segment.workspaceId,
            segment.startCursor,
            segment.endCursor,
            segment.previousSegmentHash,
            segment.entries,
          ),
        ),
      )) === segment.segmentHash
    );
  } catch {
    return false;
  }
}

function conversationHashInput(
  workspaceId: string,
  conversationId: string,
  startCursor: number,
  endCursor: number,
  previousSegmentHash: string | null,
  entries: readonly ConversationMembershipJournalEntryV2[],
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    contract: "conversation.journal-segment@2",
    workspaceId,
    conversationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    entries: entries.map((entry) => ({
      cursor: entry.cursor,
      eventId: entry.event.id,
      chunks: entry.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkDigest: chunk.chunkDigest,
        canonicalProjection: chunk,
      })),
    })),
  };
}

function requireConversationSegmentByteCapacity(
  workspaceId: string,
  conversationId: string,
  startCursor: number,
  endCursor: number,
  previousSegmentHash: string | null,
  segmentHash: string,
  entries: readonly ConversationMembershipJournalEntryV2[],
): void {
  const bodyBytes = textEncoder.encode(
    canonicalJson({
      schemaVersion: 2,
      workspaceId,
      conversationId,
      startCursor,
      endCursor,
      previousSegmentHash,
      segmentHash,
      entries,
    }),
  ).byteLength;
  if (bodyBytes + signedSealByteBudget > MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES) {
    throw new RangeError(
      `Membership journal segment exceeds ${MAX_MEMBERSHIP_JOURNAL_SEGMENT_BYTES} UTF-8 bytes including its seal budget`,
    );
  }
}

/** Prepares a hash-chained Conversation membership archive segment. */
export async function prepareConversationJournalSegmentV2(
  workspaceId: string,
  conversationId: string,
  entries: readonly ConversationMembershipJournalEntryV2[],
  previousSegmentHash: string | null,
  now: Date,
): Promise<ConversationMembershipJournalSegmentDraftV2> {
  const first = requireSegmentEntries(entries);
  requirePreviousSegmentHash(previousSegmentHash);
  requireSegmentCapacity(entries);
  for (const entry of entries) {
    await requireCompleteConversationChunkLot(
      workspaceId,
      conversationId,
      entry,
    );
  }
  const startCursor = first.cursor;
  const endCursor = entries[entries.length - 1]?.cursor ?? startCursor;
  const segmentHash = await sha256Hex(
    canonicalJson(
      conversationHashInput(
        workspaceId,
        conversationId,
        startCursor,
        endCursor,
        previousSegmentHash,
        entries,
      ),
    ),
  );
  requireConversationSegmentByteCapacity(
    workspaceId,
    conversationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    entries,
  );
  const tags: [string, ...string[]][] = [
    ["workspace", workspaceId],
    ["conversation", conversationId],
    ["contract", "conversation.journal-segment@2"],
    ["start_cursor", String(startCursor)],
    ["end_cursor", String(endCursor)],
    ["segment_hash", segmentHash],
  ];
  if (previousSegmentHash !== null) {
    tags.push(["previous_segment_hash", previousSegmentHash]);
  }
  return {
    schemaVersion: 2,
    workspaceId,
    conversationId,
    startCursor,
    endCursor,
    previousSegmentHash,
    segmentHash,
    entries,
    unsignedSeal: {
      created_at: Math.floor(now.getTime() / 1_000),
      kind: PUNKS_EVENT_KINDS.conversationJournalSegmentSealed,
      tags,
      content: canonicalJson({
        schemaVersion: 2,
        contract: "conversation.journal-segment@2",
        workspaceId,
        conversationId,
        startCursor,
        endCursor,
        previousSegmentHash,
        segmentHash,
        entries: entries.map((entry) => ({
          cursor: entry.cursor,
          eventId: entry.event.id,
          chunkDigests: entry.chunks.map((chunk) => chunk.chunkDigest),
        })),
      }),
    },
  };
}

/** Verifies the structural chain and canonical Conversation segment hash. */
export async function verifyConversationJournalSegmentHashV2(
  segment: Omit<ConversationMembershipJournalSegmentDraftV2, "unsignedSeal">,
): Promise<boolean> {
  try {
    const first = requireSegmentEntries(segment.entries);
    requirePreviousSegmentHash(segment.previousSegmentHash);
    requireSegmentCapacity(segment.entries);
    for (const entry of segment.entries) {
      await requireCompleteConversationChunkLot(
        segment.workspaceId,
        segment.conversationId,
        entry,
      );
    }
    if (
      segment.schemaVersion !== 2 ||
      segment.startCursor !== first.cursor ||
      segment.endCursor !== segment.startCursor + segment.entries.length - 1 ||
      !segmentHashPattern.test(segment.segmentHash)
    ) {
      return false;
    }
    requireConversationSegmentByteCapacity(
      segment.workspaceId,
      segment.conversationId,
      segment.startCursor,
      segment.endCursor,
      segment.previousSegmentHash,
      segment.segmentHash,
      segment.entries,
    );
    return (
      (await sha256Hex(
        canonicalJson(
          conversationHashInput(
            segment.workspaceId,
            segment.conversationId,
            segment.startCursor,
            segment.endCursor,
            segment.previousSegmentHash,
            segment.entries,
          ),
        ),
      )) === segment.segmentHash
    );
  } catch {
    return false;
  }
}
