import { useEffect, useRef, useState } from "react";
import {
  notifyManager,
  type QueryKey,
  useQueryClient,
} from "@tanstack/react-query";

import {
  PunksDesktopFailure,
  type PunksFollowDelivery,
} from "@/shared/api/punksClient";

import {
  purgeConversationProjections,
  replaceConversationProjection,
  sameQueryKey,
} from "./conversationCacheCoordinator";
import { failureStatus, pumpFollow } from "./PunksConversationHelpers";
import type { FollowStatus } from "./PunksConversationTypes";
import { usePunksWorkspace } from "./PunksRuntime";
import { applyConversationBatch, type ConversationCache } from "./socialLoop";

/** Owns FOLLOW, resync and terminal purge for one mounted Conversation. */
export function useConversationFollow({
  conversationId,
  historyReady,
  queryKey,
  queryPrefix,
  resyncToken,
  streamKey,
  streamStatus,
}: {
  conversationId: string;
  historyReady: boolean;
  queryKey: QueryKey;
  queryPrefix: QueryKey;
  resyncToken: number;
  streamKey: QueryKey;
  streamStatus: "active" | "archived" | "access-lost" | "unknown";
}): FollowStatus {
  const { scope, manager } = usePunksWorkspace();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FollowStatus>("loading");
  const scopeKey = `${scope.lease.workspaceId}:${scope.lease.generation}:${conversationId}`;
  const cursorRef = useRef<{ scopeKey: string; cursor: number | null }>({
    scopeKey,
    cursor: null,
  });
  const terminalScopeRef = useRef<{
    scopeKey: string;
    status: "archived" | "unavailable";
  } | null>(null);

  if (cursorRef.current.scopeKey !== scopeKey) {
    cursorRef.current = { scopeKey, cursor: null };
  }
  if (terminalScopeRef.current?.scopeKey !== scopeKey) {
    terminalScopeRef.current = null;
  }

  useEffect(() => {
    const purgeConversationViews = () => {
      purgeConversationProjections(
        queryClient,
        queryPrefix,
        ["punks", "authors", scope.lease.workspaceId, scope.lease.generation],
        streamKey,
      );
    };

    if (terminalScopeRef.current?.scopeKey === scopeKey) {
      setStatus(terminalScopeRef.current.status);
      return;
    }

    if (!historyReady) {
      if (streamStatus === "archived" || streamStatus === "access-lost") {
        const terminalStatus =
          streamStatus === "archived" ? "archived" : "unavailable";
        terminalScopeRef.current = { scopeKey, status: terminalStatus };
        purgeConversationViews();
        setStatus(terminalStatus);
        return;
      }
      setStatus("loading");
      return;
    }

    let active = true;
    let unregisterAbort: () => void = () => undefined;
    let removeFollow: () => void = () => undefined;
    const controller = new AbortController();
    unregisterAbort = manager.registerAbortController(scope, controller);
    setStatus("connecting");

    const replaceAfterResync = async (): Promise<void> => {
      if (!active || controller.signal.aborted) return;
      setStatus("resyncing");
      const page = await manager.run(scope, () =>
        scope.session.getTimeline({ conversationId, limit: 100 }),
      );
      if (!active || controller.signal.aborted) return;
      const current = queryClient.getQueryData<ConversationCache>(queryKey);
      replaceConversationProjection(
        queryClient,
        queryKey,
        queryPrefix,
        page,
        current?.threadRootMessageId,
      );
      void queryClient.invalidateQueries({ queryKey: streamKey });
      cursorRef.current.cursor = page.highWaterCursor;
    };

    const applyBatch = async (
      frame: Extract<PunksFollowDelivery, { kind: "apply_batch" }>["frame"],
    ): Promise<boolean> => {
      const current = queryClient.getQueryData<ConversationCache>(queryKey);
      if (current === undefined) {
        await replaceAfterResync();
        return false;
      }
      const reduction = applyConversationBatch(current, frame);
      if (reduction.kind === "resync-required") {
        await replaceAfterResync();
        return false;
      }
      // A thread cache is another bounded view of the same Conversation. It
      // receives the same atomic batch when its cursor is contiguous; a page
      // opened later is simply refetched instead of being patched partially.
      const threadUpdates: Array<readonly [QueryKey, ConversationCache]> = [];
      const threadResyncs: QueryKey[] = [];
      for (const [key, cached] of queryClient.getQueriesData<ConversationCache>(
        { queryKey: queryPrefix },
      )) {
        if (cached === undefined || sameQueryKey(key, queryKey)) continue;
        const threadReduction = applyConversationBatch(cached, frame);
        if (threadReduction.kind === "applied") {
          threadUpdates.push([key, threadReduction.state]);
        } else if (threadReduction.kind === "resync-required") {
          threadResyncs.push(key);
        }
      }
      notifyManager.batch(() => {
        if (reduction.kind === "applied") {
          queryClient.setQueryData(queryKey, reduction.state);
        }
        for (const [key, state] of threadUpdates) {
          queryClient.setQueryData(key, state);
        }
        for (const key of threadResyncs) {
          void queryClient.resetQueries({ queryKey: key, exact: true });
        }
      });
      return true;
    };

    const run = async (): Promise<void> => {
      try {
        if (resyncToken > 0) await replaceAfterResync();
        if (!active || controller.signal.aborted || !manager.isCurrent(scope)) {
          return;
        }
        if (cursorRef.current.cursor === null) {
          const current = queryClient.getQueryData<ConversationCache>(queryKey);
          cursorRef.current.cursor = current?.history.highWaterCursor ?? 0;
        }
        let restartFollow = true;
        while (
          restartFollow &&
          active &&
          !controller.signal.aborted &&
          manager.isCurrent(scope)
        ) {
          restartFollow = false;
          const follow = await manager.runResource(
            scope,
            () =>
              scope.session.followConversation(
                conversationId,
                cursorRef.current.cursor ?? 0,
              ),
            (openedFollow) => openedFollow.close(),
          );
          if (!active || controller.signal.aborted) {
            await follow.close();
            return;
          }
          removeFollow = manager.registerFollow(scope, follow);
          await pumpFollow(
            follow,
            () =>
              active && !controller.signal.aborted && manager.isCurrent(scope),
            async (delivery) => {
              if (delivery.kind === "apply_batch") {
                const applied = await applyBatch(delivery.frame);
                if (!applied) {
                  restartFollow = true;
                  return false;
                }
                await follow.confirmBatch(delivery.frame.throughCursor);
                cursorRef.current.cursor = delivery.frame.throughCursor;
                return true;
              }
              if (delivery.kind === "became_live") {
                setStatus("live");
                return true;
              }
              if (delivery.kind === "resync") {
                await replaceAfterResync();
                restartFollow = true;
                return false;
              }
              terminalScopeRef.current = { scopeKey, status: "archived" };
              purgeConversationViews();
              setStatus("archived");
              return false;
            },
          );
          removeFollow();
          removeFollow = () => undefined;
        }
      } catch (error) {
        if (!active || !manager.isCurrent(scope)) return;
        if (
          error instanceof PunksDesktopFailure &&
          (error.kind === "stale_workspace" || error.kind === "cancelled")
        ) {
          return;
        }
        const nextStatus = failureStatus(error);
        if (nextStatus === "unavailable") {
          terminalScopeRef.current = { scopeKey, status: "unavailable" };
          purgeConversationViews();
        }
        setStatus(nextStatus);
      } finally {
        removeFollow();
      }
    };

    void run();
    return () => {
      active = false;
      controller.abort();
      unregisterAbort();
      removeFollow();
    };
  }, [
    conversationId,
    historyReady,
    manager,
    queryClient,
    queryKey,
    queryPrefix,
    scope,
    scopeKey,
    resyncToken,
    streamKey,
    streamStatus,
  ]);

  return status;
}
