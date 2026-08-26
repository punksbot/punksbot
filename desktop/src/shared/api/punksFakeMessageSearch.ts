import type {
  ConversationSummary,
  MessageSearchResponse,
} from "@punks/contracts";

import { PunksDesktopFailure } from "./punksFailure";
import type {
  FakePunksClientSeed,
  PunksWorkspaceSession,
  WorkspaceLease,
} from "./punksClientTypes";

function lexicalTerms(value: string, maximum: number): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const match of value
    .normalize("NFKC")
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length === maximum) break;
  }
  return terms;
}

/** Builds the deterministic, scope-bound message-search seam used by E2E. */
export function createFakeMessageSearch(input: {
  seed: FakePunksClientSeed;
  streams: ConversationSummary[];
  lease: WorkspaceLease;
  workspaceId: string;
  assertCapability(capability: string): void;
  assertCurrent(lease: WorkspaceLease): void;
}): PunksWorkspaceSession["searchMessages"] {
  const cursors = new Map<string, { scope: string; offset: number }>();
  const cursor = (scope: string, offset: number) => {
    const sequence = String(cursors.size + 1).padStart(16, "A");
    const value = `msc1.${sequence}.${"B".repeat(64)}${offset}`;
    cursors.set(value, { scope, offset });
    return value;
  };

  return async (query) => {
    input.assertCapability("search");
    input.assertCurrent(input.lease);
    if (!input.streams.some((stream) => stream.id === query.conversationId)) {
      throw new PunksDesktopFailure("problem", "Stream is not accessible");
    }
    const terms = lexicalTerms(query.query, 33);
    if (
      terms.length < 1 ||
      terms.length > 32 ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "Message search query is invalid",
      );
    }
    const scope = JSON.stringify([
      query.conversationId,
      query.threadRootMessageId,
      terms,
      query.limit,
    ]);
    const continuation =
      query.cursor === null ? null : cursors.get(query.cursor);
    if (
      query.cursor !== null &&
      (continuation === null ||
        continuation === undefined ||
        continuation.scope !== scope)
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "Message search cursor is invalid for this scope",
      );
    }
    const configured = input.seed.messageSearchState?.[
      `${query.conversationId}:${query.threadRootMessageId ?? "conversation"}`
    ] ?? { completeness: "complete" as const, partialReason: null };
    const matches = (input.seed.messages[query.conversationId] ?? [])
      .filter((message) => {
        if (
          configured.partialReason === "index_unavailable" ||
          message.status !== "active" ||
          (query.threadRootMessageId !== null &&
            message.threadRootMessageId !== query.threadRootMessageId)
        ) {
          return false;
        }
        const documentTerms = new Set(
          lexicalTerms(
            message.topic === null
              ? (message.content ?? "")
              : `${message.content ?? ""}\u0000${message.topic}`,
            1_024,
          ),
        );
        return terms.every((term) => documentTerms.has(term));
      })
      .sort(
        (left, right) =>
          right.createdCursor - left.createdCursor ||
          left.id.localeCompare(right.id),
      );
    const start = continuation?.offset ?? 0;
    const end = Math.min(matches.length, start + query.limit);
    const items = structuredClone(
      matches.slice(start, end),
    ) as MessageSearchResponse["items"];
    input.assertCurrent(input.lease);
    return {
      workspaceId: input.workspaceId,
      conversationId: query.conversationId,
      threadRootMessageId: query.threadRootMessageId,
      order: "createdCursor-descending" as const,
      completeness: configured.completeness,
      partialReason: configured.partialReason,
      items,
      nextCursor: end < matches.length ? cursor(scope, end) : null,
    } satisfies MessageSearchResponse;
  };
}
