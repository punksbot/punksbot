import { useEffect, useMemo, useRef, useState } from "react";
import {
  notifyManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { MessageView } from "@punks/contracts";

import {
  PunksDesktopFailure,
  type EditMessageInput,
  type PunksFollowDelivery,
  type RestoreMessageInput,
  type RetractMessageInput,
} from "@/shared/api/punksClient";
import { canonicalPunksReaction } from "@/shared/api/punksReaction";

import {
  applyConversationBatch,
  applyConversationMessage,
  applyConversationReaction,
  createConversationCache,
  reduceConversationPage,
  reactionForCaches,
  replaceConversationPage,
  type ConversationCache,
} from "./socialLoop";
import { ConversationMessageRow } from "./PunksConversationMessageRow";
import { ConversationStatusBanner } from "./PunksConversationStatusBanner";
import { ConversationThreadPanel } from "./PunksConversationThreadPanel";
import { actorKey, type FollowStatus } from "./PunksConversationTypes";
import {
  canRestoreMessage,
  failureStatus,
  pumpFollow,
  sameQueryKey,
} from "./PunksConversationHelpers";
import type { MessageLifecycleActions } from "./MessageLifecycleControls";
import { mutationErrorMessage } from "./punksMutationErrors";
import { usePunksAccount, usePunksWorkspace } from "./PunksRuntime";
import type { PunksRoute } from "./routes";

type AuthorActor = MessageView["author"];
type AuthorActors = [AuthorActor, ...AuthorActor[]];

type MessageKey = readonly [
  "punks",
  "messages",
  string,
  number,
  string,
  ...unknown[],
];

function useConversationFollow({
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
  queryKey: MessageKey;
  queryPrefix: MessageKey;
  resyncToken: number;
  streamKey: readonly unknown[];
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
  const terminalScopeRef = useRef<string | null>(null);

  if (cursorRef.current.scopeKey !== scopeKey) {
    cursorRef.current = { scopeKey, cursor: null };
  }
  if (terminalScopeRef.current !== scopeKey) {
    terminalScopeRef.current = null;
  }

  useEffect(() => {
    const purgeConversationViews = () => {
      queryClient.removeQueries({ queryKey: queryPrefix });
      queryClient.removeQueries({
        queryKey: [
          "punks",
          "authors",
          scope.lease.workspaceId,
          scope.lease.generation,
        ],
      });
    };

    if (!historyReady) {
      if (streamStatus === "archived" || streamStatus === "access-lost") {
        purgeConversationViews();
      }
      setStatus((current) =>
        terminalScopeRef.current === scopeKey &&
        (current === "archived" || current === "unavailable")
          ? current
          : "loading",
      );
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
      notifyManager.batch(() => {
        queryClient.setQueryData(
          queryKey,
          replaceConversationPage(page, current?.threadRootMessageId),
        );
        queryClient.invalidateQueries({ queryKey: queryPrefix });
        queryClient.invalidateQueries({ queryKey: streamKey });
      });
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
      const threadUpdates: Array<
        readonly [readonly unknown[], ConversationCache]
      > = [];
      const threadResyncs: Array<readonly unknown[]> = [];
      for (const [key, cached] of queryClient.getQueriesData<ConversationCache>(
        {
          queryKey: queryPrefix,
        },
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
          queryClient.invalidateQueries({ queryKey: key });
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
          const follow = await manager.run(scope, () =>
            scope.session.followConversation(
              conversationId,
              cursorRef.current.cursor ?? 0,
            ),
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
              terminalScopeRef.current = scopeKey;
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
          terminalScopeRef.current = scopeKey;
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

export function PunksConversation({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string | null;
}) {
  const account = usePunksAccount();
  const { scope, manager, workspace } = usePunksWorkspace();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [topic, setTopic] = useState("");
  const [paginationPending, setPaginationPending] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [threadPaginationPending, setThreadPaginationPending] = useState(false);
  const [resyncToken, setResyncToken] = useState(0);

  const streamKey = useMemo(
    () => [
      "punks",
      "stream",
      scope.lease.workspaceId,
      scope.lease.generation,
      conversationId,
    ],
    [conversationId, scope.lease.generation, scope.lease.workspaceId],
  );
  const historyKey = useMemo<MessageKey>(
    () => [
      "punks",
      "messages",
      scope.lease.workspaceId,
      scope.lease.generation,
      conversationId,
      "timeline",
    ],
    [conversationId, scope.lease.generation, scope.lease.workspaceId],
  );
  const messageQueryPrefix = useMemo<MessageKey>(
    () => [
      "punks",
      "messages",
      scope.lease.workspaceId,
      scope.lease.generation,
      conversationId,
    ],
    [conversationId, scope.lease.generation, scope.lease.workspaceId],
  );

  const streamQuery = useQuery({
    queryKey: streamKey,
    queryFn: () =>
      manager.run(scope, () => scope.session.getStream(conversationId)),
  });
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const page = await manager.run(scope, () =>
        scope.session.getTimeline({ conversationId, limit: 100 }),
      );
      return createConversationCache(page);
    },
    enabled: streamQuery.data?.status === "active",
  });
  const history = historyQuery.data;
  const targetMessage = history?.history.items.find(
    (message) => message.id === messageId,
  );
  const threadRootMessageId =
    targetMessage?.threadRootMessageId ?? messageId ?? null;
  const threadKey = useMemo(
    () => [
      "punks",
      "messages",
      scope.lease.workspaceId,
      scope.lease.generation,
      conversationId,
      "thread",
      threadRootMessageId ?? "none",
    ],
    [
      conversationId,
      scope.lease.generation,
      scope.lease.workspaceId,
      threadRootMessageId,
    ],
  );
  const threadQuery = useQuery({
    queryKey: threadKey,
    queryFn: async () => {
      if (threadRootMessageId === null)
        throw new Error("Thread is not selected");
      const page = await manager.run(scope, () =>
        scope.session.getThread({
          conversationId,
          threadRootMessageId,
          limit: 100,
        }),
      );
      return createConversationCache(page, threadRootMessageId);
    },
    enabled:
      streamQuery.data?.status === "active" &&
      history !== undefined &&
      threadRootMessageId !== null,
  });
  const accessLost =
    (streamQuery.isError &&
      failureStatus(streamQuery.error) === "unavailable") ||
    (historyQuery.isError &&
      failureStatus(historyQuery.error) === "unavailable");
  const streamStatus = accessLost
    ? "access-lost"
    : streamQuery.data?.status === "active"
      ? "active"
      : streamQuery.data === undefined
        ? "unknown"
        : "archived";
  const followStatus = useConversationFollow({
    conversationId,
    historyReady: history !== undefined && streamStatus === "active",
    queryKey: historyKey,
    queryPrefix: messageQueryPrefix,
    resyncToken,
    streamKey,
    streamStatus,
  });

  const visibleMessages = history?.history.items ?? [];
  const threadMessages = threadQuery.data?.history.items ?? [];
  const authorActors = useMemo<AuthorActors | []>(() => {
    const seen = new Set<string>();
    const actors: AuthorActor[] = [];
    for (const message of [...visibleMessages, ...threadMessages]) {
      const key = actorKey(message.author);
      if (seen.has(key)) continue;
      seen.add(key);
      actors.push(message.author);
      if (actors.length === 100) break;
    }
    return actors.length === 0 ? [] : (actors as AuthorActors);
  }, [threadMessages, visibleMessages]);
  const authorQuery = useQuery({
    queryKey: [
      "punks",
      "authors",
      scope.lease.workspaceId,
      scope.lease.generation,
      authorActors.map(actorKey).join(","),
    ],
    queryFn: () => {
      if (authorActors.length === 0) return Promise.resolve([]);
      return manager.run(scope, () =>
        scope.session.resolveAuthors(authorActors as AuthorActors),
      );
    },
    enabled: authorActors.length > 0,
  });
  const authors = useMemo(
    () =>
      new Map(
        (authorQuery.data ?? []).map((author) => [actorKey(author), author]),
      ),
    [authorQuery.data],
  );
  const canMutate =
    followStatus === "live" && streamQuery.data?.status === "active";
  const canReact =
    account.compatibility?.capabilities.includes("unicode-reactions") === true;
  const lifecycleAvailable =
    account.compatibility?.capabilities.includes("message-lifecycle") === true;
  const topicRequired =
    messageId === null && streamQuery.data?.topicRequired === true;
  const topicValid = !topicRequired || topic.trim().length > 0;
  const canModerate =
    workspace.role === "owner" || workspace.role === "moderator";

  const applyMessageAcknowledgement = (message: MessageView) => {
    if (!manager.isCurrent(scope)) return;
    notifyManager.batch(() => {
      for (const [key, cached] of queryClient.getQueriesData<ConversationCache>(
        { queryKey: messageQueryPrefix },
      )) {
        if (cached !== undefined) {
          queryClient.setQueryData(
            key,
            applyConversationMessage(cached, message),
          );
        }
      }
    });
  };
  const currentReactionFor = (messageId: string, requestedReaction = "👍") => {
    return reactionForCaches(
      queryClient.getQueriesData<ConversationCache>({
        queryKey: messageQueryPrefix,
      }),
      messageId,
      requestedReaction,
    );
  };

  const loadOlder = async () => {
    if (followStatus === "offline") return;
    const current = queryClient.getQueryData<ConversationCache>(historyKey);
    if (
      current === undefined ||
      current.history.nextCursor === null ||
      paginationPending
    ) {
      return;
    }
    setPaginationPending(true);
    setPaginationError(null);
    try {
      const page = await manager.run(scope, () =>
        scope.session.getTimeline({
          conversationId,
          limit: 100,
          cursor: current.history.nextCursor ?? undefined,
        }),
      );
      const reduced = reduceConversationPage(current, page, "append");
      if (reduced.kind !== "applied") {
        setPaginationError(
          "The timeline changed while it was loading; refresh required.",
        );
        setResyncToken((value) => value + 1);
      } else {
        queryClient.setQueryData(historyKey, reduced.state);
      }
    } catch (error) {
      const nextStatus = failureStatus(error);
      if (nextStatus === "unavailable" && manager.isCurrent(scope)) {
        setResyncToken((value) => value + 1);
      }
      setPaginationError(
        nextStatus === "offline"
          ? "The Stream is offline. Try again when the connection returns."
          : "The older Messages could not be loaded.",
      );
    } finally {
      setPaginationPending(false);
    }
  };

  const loadOlderThread = async () => {
    if (followStatus === "offline") return;
    const current = queryClient.getQueryData<ConversationCache>(threadKey);
    if (
      current === undefined ||
      current.history.nextCursor === null ||
      threadRootMessageId === null ||
      threadPaginationPending
    ) {
      return;
    }
    setThreadPaginationPending(true);
    try {
      const page = await manager.run(scope, () =>
        scope.session.getThread({
          conversationId,
          threadRootMessageId,
          limit: 100,
          cursor: current.history.nextCursor ?? undefined,
        }),
      );
      const reduced = reduceConversationPage(current, page, "append");
      if (reduced.kind === "applied") {
        queryClient.setQueryData(threadKey, reduced.state);
      } else {
        setResyncToken((value) => value + 1);
      }
    } catch (error) {
      const nextStatus = failureStatus(error);
      if (nextStatus === "unavailable" && manager.isCurrent(scope)) {
        setResyncToken((value) => value + 1);
      }
      setPaginationError(
        nextStatus === "offline"
          ? "The Stream is offline. Try again when the connection returns."
          : "The older thread Messages could not be loaded.",
      );
    } finally {
      setThreadPaginationPending(false);
    }
  };

  const messageMutation = useMutation({
    mutationFn: () => {
      if (!canMutate) {
        throw new PunksDesktopFailure(
          "problem",
          "Messages are blocked until the Stream is live",
        );
      }
      return manager.run(scope, () =>
        scope.session.postMessage({
          conversationId,
          content: content.trim(),
          topic: messageId === null ? topic.trim() || null : null,
          ...(messageId === null ? {} : { replyToMessageId: messageId }),
        }),
      );
    },
    retry: false,
    onSuccess: (message) => {
      applyMessageAcknowledgement(message);
      setContent("");
      if (messageId === null) setTopic("");
    },
  });
  const reactionMutation = useMutation({
    mutationFn: ({
      message,
      reaction,
    }: {
      message: MessageView;
      reaction: string;
    }) => {
      if (!canMutate) {
        throw new PunksDesktopFailure(
          "problem",
          "Reactions are blocked until the Stream is live",
        );
      }
      if (!canReact) {
        throw new PunksDesktopFailure(
          "problem",
          "Unicode reactions are unavailable for this profile",
        );
      }
      const canonicalReaction = canonicalPunksReaction(reaction);
      const currentReaction = currentReactionFor(message.id, canonicalReaction);
      return manager.run(scope, () =>
        currentReaction?.reactedByPunk
          ? scope.session.removeReaction({
              conversationId,
              messageId: message.id,
              reaction: canonicalReaction,
            })
          : scope.session.addReaction({
              conversationId,
              messageId: message.id,
              reaction: canonicalReaction,
            }),
      );
    },
    retry: false,
    onSuccess: (response, { message, reaction }) => {
      if (!manager.isCurrent(scope)) return;
      const canonicalReaction = canonicalPunksReaction(reaction);
      notifyManager.batch(() => {
        for (const [
          key,
          cached,
        ] of queryClient.getQueriesData<ConversationCache>({
          queryKey: messageQueryPrefix,
        })) {
          if (cached === undefined) continue;
          const reduction = applyConversationReaction(
            cached,
            message.id,
            canonicalReaction,
            response,
          );
          if (reduction.kind === "applied" || reduction.kind === "ignored") {
            queryClient.setQueryData(key, reduction.state);
          } else {
            queryClient.invalidateQueries({ queryKey: key });
          }
        }
      });
    },
  });
  const editMutation = useMutation({
    mutationFn: (input: EditMessageInput) => {
      if (!canMutate) {
        throw new PunksDesktopFailure(
          "problem",
          "Message edits are blocked until the Stream is live",
        );
      }
      return manager.run(scope, () => scope.session.editMessage(input));
    },
    retry: false,
    onSuccess: applyMessageAcknowledgement,
  });
  const retractMutation = useMutation({
    mutationFn: (input: RetractMessageInput) => {
      if (!canMutate) {
        throw new PunksDesktopFailure(
          "problem",
          "Message retractions are blocked until the Stream is live",
        );
      }
      return manager.run(scope, () => scope.session.retractMessage(input));
    },
    retry: false,
    onSuccess: applyMessageAcknowledgement,
  });
  const restoreMutation = useMutation({
    mutationFn: (input: RestoreMessageInput) => {
      if (!canMutate) {
        throw new PunksDesktopFailure(
          "problem",
          "Message restoration is blocked until the Stream is live",
        );
      }
      return manager.run(scope, () => scope.session.restoreMessage(input));
    },
    retry: false,
    onSuccess: applyMessageAcknowledgement,
  });
  const lifecycleForMessage = (
    message: MessageView,
  ): MessageLifecycleActions | null => {
    const author =
      message.author.kind === "punk" &&
      message.author.punkId === scope.lease.punkId;
    const active = message.status === "active";
    const canEdit = lifecycleAvailable && canMutate && author && active;
    const canRetract =
      lifecycleAvailable && canMutate && (author || canModerate) && active;
    const canRestore =
      lifecycleAvailable &&
      canMutate &&
      canRestoreMessage(message, author, canModerate);
    if (!canEdit && !canRetract && !canRestore) return null;
    const pending =
      editMutation.isPending ||
      retractMutation.isPending ||
      restoreMutation.isPending;
    return {
      canEdit,
      canRetract,
      canRestore,
      topicRequired:
        streamQuery.data?.topicRequired === true &&
        message.parentMessageId === null,
      pending,
      onEdit: async (nextContent, nextTopic) => {
        await editMutation.mutateAsync({
          conversationId,
          messageId: message.id,
          content: nextContent,
          topic: nextTopic,
        });
      },
      onRetract: async () => {
        await retractMutation.mutateAsync({
          conversationId,
          messageId: message.id,
          reasonCode: author ? "author-request" : "moderation",
          publicReason: null,
        });
      },
      onRestore: async () => {
        await restoreMutation.mutateAsync({
          conversationId,
          messageId: message.id,
        });
      },
    };
  };
  const openThread = (message: MessageView) => {
    const route: PunksRoute = {
      kind: "message",
      workspaceSlug: workspace.slug,
      conversationId,
      messageId: message.id,
    };
    account.navigate(route);
  };

  const mutationError = mutationErrorMessage(
    messageMutation.error ??
      reactionMutation.error ??
      editMutation.error ??
      retractMutation.error ??
      restoreMutation.error,
  );

  useEffect(() => {
    if (!messageId || history === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [history, messageId]);

  if (streamQuery.isPending) {
    return <p className="p-8 text-sm text-muted-foreground">Loading Stream…</p>;
  }
  if (streamQuery.isError || streamQuery.data === undefined) {
    return (
      <section className="p-8">
        <ConversationStatusBanner status={failureStatus(streamQuery.error)} />
      </section>
    );
  }
  if (streamQuery.data.status !== "active") {
    return (
      <section className="p-8" data-testid="punks-stream-archived">
        <h2 className="text-xl font-semibold">{streamQuery.data.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This Stream is archived and no longer accepts new Messages.
        </p>
      </section>
    );
  }
  if (followStatus === "archived" || followStatus === "unavailable") {
    return (
      <section className="p-8" data-testid={`punks-stream-${followStatus}`}>
        <ConversationStatusBanner status={followStatus} />
      </section>
    );
  }
  if (historyQuery.isPending) {
    return (
      <p className="p-8 text-sm text-muted-foreground">Loading timeline…</p>
    );
  }
  if (historyQuery.isError || history === undefined) {
    return (
      <section className="p-8" data-testid="punks-timeline-unavailable">
        <ConversationStatusBanner status={failureStatus(historyQuery.error)} />
      </section>
    );
  }

  return (
    <section
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-8"
      data-testid="punks-conversation"
    >
      <header>
        <p className="text-sm text-muted-foreground">{workspace.name}</p>
        <h2 className="mt-1 text-2xl font-semibold">{streamQuery.data.name}</h2>
        {streamQuery.data.topic ? (
          <p className="mt-2 text-sm font-medium">{streamQuery.data.topic}</p>
        ) : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {streamQuery.data.purpose ?? "Live Workspace conversation"}
        </p>
        <div className="mt-3">
          <ConversationStatusBanner status={followStatus} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <div className="space-y-3" data-testid="punks-message-list">
          {history.history.nextCursor !== null ? (
            <button
              className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              data-testid="punks-load-older"
              disabled={paginationPending || followStatus === "offline"}
              onClick={() => void loadOlder()}
              type="button"
            >
              {paginationPending
                ? "Loading older Messages…"
                : "Load older Messages"}
            </button>
          ) : null}
          {paginationError ? (
            <p className="text-sm text-destructive" role="alert">
              {paginationError}
            </p>
          ) : null}
          {visibleMessages.map((message) => (
            <ConversationMessageRow
              authors={authors}
              canMutate={canMutate}
              canReact={canReact}
              key={message.id}
              lifecycle={lifecycleForMessage(message)}
              message={message}
              onOpenThread={() => openThread(message)}
              onToggleReaction={(reaction) =>
                void reactionMutation.mutateAsync({ message, reaction })
              }
              reaction={currentReactionFor(message.id)}
              reactionForValue={(reaction) =>
                currentReactionFor(message.id, reaction)
              }
              reactionPending={reactionMutation.isPending}
              target={message.id === messageId}
            />
          ))}
          {visibleMessages.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              No Messages yet.
            </p>
          ) : null}
        </div>

        {threadRootMessageId !== null ? (
          <ConversationThreadPanel
            authors={authors}
            canMutate={canMutate}
            canReact={canReact}
            conversationId={conversationId}
            lifecycleForMessage={lifecycleForMessage}
            onLoadOlder={() => void loadOlderThread()}
            onToggleReaction={(message, reaction) =>
              void reactionMutation.mutateAsync({ message, reaction })
            }
            offline={followStatus === "offline"}
            paginationPending={threadPaginationPending}
            reactionForValue={(message, reaction) =>
              currentReactionFor(message.id, reaction)
            }
            reactionPending={reactionMutation.isPending}
            targetMessageId={messageId}
            thread={threadQuery.data}
            threadStatus={
              threadQuery.isError ? failureStatus(threadQuery.error) : null
            }
          />
        ) : null}
      </div>

      <form
        className="sticky bottom-0 rounded-lg border border-border bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            canMutate &&
            topicValid &&
            content.trim() &&
            !messageMutation.isPending
          ) {
            void messageMutation.mutateAsync();
          }
        }}
      >
        {messageId === null ? (
          <div className="mb-2">
            <label
              className="mb-1 block text-xs text-muted-foreground"
              htmlFor="punks-message-topic"
            >
              {topicRequired
                ? "Subject required for a new Message"
                : "Subject (optional)"}
            </label>
            <input
              className="w-full rounded-md border border-border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              data-testid="punks-message-topic"
              disabled={!canMutate}
              id="punks-message-topic"
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Add a subject"
              value={topic}
            />
          </div>
        ) : null}
        <label className="sr-only" htmlFor="punks-message-composer">
          Message
        </label>
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 text-message outline-none focus:ring-2 focus:ring-primary"
          data-testid="punks-message-composer"
          disabled={!canMutate}
          id="punks-message-composer"
          onChange={(event) => setContent(event.target.value)}
          placeholder={
            messageId === null ? "Write a Message" : "Reply in this thread"
          }
          value={content}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <ConversationStatusBanner status={followStatus} />
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={
              !canMutate ||
              !topicValid ||
              !content.trim() ||
              messageMutation.isPending
            }
            type="submit"
          >
            {messageMutation.isPending ? "Sending…" : "Send"}
          </button>
        </div>
        {mutationError !== null ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {mutationError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
