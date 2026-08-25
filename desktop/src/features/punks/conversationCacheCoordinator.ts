import {
  notifyManager,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import type { MessageHistoryResponse } from "@punks/contracts";

import {
  reduceConversationPage,
  replaceConversationPage,
  type ConversationCache,
  type ConversationReduction,
} from "./socialLoop";

type RedactableStreamProjection = {
  name: string;
  description: string | null;
  topic: string | null;
  purpose: string | null;
};

/** Compares React Query keys without allowing a cross-view cache update. */
export function sameQueryKey(left: QueryKey, right: QueryKey): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Commits a continuation page against the projection present at publication
 * time. A FOLLOW batch may land while the network read is in flight, so the
 * cache captured before that read is never an admissible write base.
 */
export function commitConversationPage(
  queryClient: QueryClient,
  queryKey: QueryKey,
  page: MessageHistoryResponse,
): ConversationReduction {
  let outcome: ConversationReduction = {
    kind: "resync-required",
    reason: "protocol_violation",
  };
  queryClient.setQueryData<ConversationCache>(queryKey, (current) => {
    if (current === undefined) return undefined;
    outcome = reduceConversationPage(current, page, "append");
    return outcome.kind === "applied" ? outcome.state : current;
  });
  return outcome;
}

/**
 * Replaces one authoritative bounded projection and discards every sibling
 * view from the old cursor domain. The primary query is deliberately not
 * invalidated after publication: doing so could race a fresh FOLLOW with an
 * older HTTP refetch and overwrite the just-published cache.
 */
export function replaceConversationProjection(
  queryClient: QueryClient,
  primaryKey: QueryKey,
  queryPrefix: QueryKey,
  page: MessageHistoryResponse,
  threadRootMessageId?: string,
): ConversationCache {
  const replacement = replaceConversationPage(page, threadRootMessageId);
  const siblingKeys = queryClient
    .getQueriesData<ConversationCache>({ queryKey: queryPrefix })
    .map(([key]) => key)
    .filter((key) => !sameQueryKey(key, primaryKey));
  notifyManager.batch(() => {
    for (const key of siblingKeys) {
      void queryClient.resetQueries({ queryKey: key, exact: true });
    }
    queryClient.setQueryData(primaryKey, replacement);
  });
  return replacement;
}

/**
 * Redacts every renderer-visible Conversation body before a terminal view is
 * rendered. The sanitized queries stay mounted so active observers cannot
 * retain plaintext or immediately refetch a now-forbidden resource.
 */
export function purgeConversationProjections(
  queryClient: QueryClient,
  messagePrefix: QueryKey,
  authorPrefix: QueryKey,
  streamKey: QueryKey,
): void {
  void queryClient.cancelQueries({ queryKey: messagePrefix });
  void queryClient.cancelQueries({ queryKey: authorPrefix });
  void queryClient.cancelQueries({ queryKey: streamKey, exact: true });
  const messageViews = queryClient.getQueriesData<ConversationCache>({
    queryKey: messagePrefix,
  });
  const authorKeys = queryClient
    .getQueriesData({ queryKey: authorPrefix })
    .map(([key]) => key);
  notifyManager.batch(() => {
    for (const [key, current] of messageViews) {
      if (current === undefined) continue;
      queryClient.setQueryData<ConversationCache>(key, {
        ...current,
        history: {
          ...current.history,
          items: [],
          nextCursor: null,
        },
        threadPatches: [],
        reactionPatches: [],
        reactionCollectionPatches: [],
        seenBatchSignatures: [],
      });
    }
    for (const key of authorKeys) queryClient.setQueryData(key, []);
    queryClient.setQueryData<RedactableStreamProjection>(
      streamKey,
      (current) =>
        current === undefined
          ? undefined
          : {
              ...current,
              name: "Stream",
              description: null,
              topic: null,
              purpose: null,
            },
    );
  });
}
