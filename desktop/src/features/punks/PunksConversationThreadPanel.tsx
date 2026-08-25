import type { MessageView } from "@punks/contracts";
import type { ReactNode } from "react";

import { ConversationMessageRow } from "./PunksConversationMessageRow";
import { ConversationStatusBanner } from "./PunksConversationStatusBanner";
import type { AuthorSummary, FollowStatus } from "./PunksConversationTypes";
import { reactionFor, type ConversationCache } from "./socialLoop";

export function ConversationThreadPanel({
  authors,
  canMutate,
  canReact,
  conversationId,
  renderMessageActions,
  offline,
  paginationPending,
  reactionForValue,
  reactionPending,
  targetMessageId,
  thread,
  threadStatus,
  onLoadOlder,
  onToggleReaction,
}: {
  authors: ReadonlyMap<string, AuthorSummary>;
  canMutate: boolean;
  canReact?: boolean;
  conversationId: string;
  renderMessageActions(message: MessageView): ReactNode;
  offline: boolean;
  paginationPending: boolean;
  reactionForValue?(
    message: MessageView,
    reaction: string,
  ): ReturnType<typeof reactionFor>;
  reactionPending?: boolean;
  targetMessageId: string | null;
  thread: ConversationCache | undefined;
  threadStatus: FollowStatus | null;
  onLoadOlder(): void;
  onToggleReaction(message: MessageView, reaction: string): void;
}) {
  return (
    <aside
      className="rounded-lg border border-border bg-background p-4"
      data-testid="punks-thread"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Thread</h3>
        <span className="text-xs text-muted-foreground">Selected thread</span>
      </div>
      {threadStatus !== null ? (
        <div className="mt-3">
          <ConversationStatusBanner status={threadStatus} />
        </div>
      ) : thread === undefined ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading thread…</p>
      ) : (
        <div className="mt-3 space-y-3">
          {thread.history.items.map((message) => (
            <div
              key={`${conversationId}:${message.id}`}
              data-testid="punks-thread-message"
            >
              <ConversationMessageRow
                authors={authors}
                canMutate={canMutate}
                canReact={canReact}
                messageActions={renderMessageActions(message)}
                message={message}
                onOpenThread={() => undefined}
                onToggleReaction={(reaction) =>
                  onToggleReaction(message, reaction)
                }
                reaction={reactionFor(thread, message.id, "👍")}
                reactionForValue={(reaction) =>
                  reactionForValue?.(message, reaction) ??
                  reactionFor(thread, message.id, reaction)
                }
                reactionPending={reactionPending}
                target={message.id === targetMessageId}
              />
            </div>
          ))}
          {thread.history.nextCursor !== null ? (
            <button
              className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              disabled={offline || paginationPending}
              onClick={onLoadOlder}
              type="button"
            >
              Load older thread Messages
            </button>
          ) : null}
          {thread.history.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No replies yet.</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
