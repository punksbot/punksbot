import { useState, type ReactNode } from "react";

import type { MessageView, PresenceView } from "@punks/contracts";

import type { AuthorSummary } from "./PunksConversationTypes";
import { actorKey } from "./PunksConversationTypes";
import type { reactionFor } from "./socialLoop";

function fallbackAuthorName(actor: MessageView["author"]): string {
  return actor.kind === "punk" ? "Punk" : "Bot";
}

function authorName(
  message: MessageView,
  authors: ReadonlyMap<string, AuthorSummary>,
): string {
  return (
    authors.get(actorKey(message.author))?.displayName ??
    fallbackAuthorName(message.author)
  );
}

function isActiveMessage(message: MessageView): boolean {
  return message.status === "active";
}

export function ConversationMessageRow({
  authors,
  canMutate,
  canReact = true,
  messageActions,
  message,
  presence,
  reaction,
  reactionForValue,
  reactionPending = false,
  target = false,
  onOpenThread,
  onToggleReaction,
}: {
  authors: ReadonlyMap<string, AuthorSummary>;
  canMutate: boolean;
  canReact?: boolean;
  messageActions?: ReactNode;
  message: MessageView;
  presence?: PresenceView;
  reaction: ReturnType<typeof reactionFor>;
  reactionForValue?(reaction: string): ReturnType<typeof reactionFor>;
  reactionPending?: boolean;
  target?: boolean;
  onOpenThread(): void;
  onToggleReaction(reaction: string): void;
}) {
  const [reactionInput, setReactionInput] = useState("👍");
  const active = isActiveMessage(message);
  const threadCount = message.descendantCount || message.replyCount;
  const selectedReaction = reactionInput.trim().normalize("NFC") || "+";
  const selectedReactionView =
    reactionForValue?.(selectedReaction) ??
    (selectedReaction === "👍" ? reaction : null);
  return (
    <article
      aria-label={`Message ${message.id}`}
      className={`rounded-lg border border-border p-3 ${target ? "ring-2 ring-primary" : ""}`}
      data-message-id={message.id}
      data-message-status={message.status}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
          {presence !== undefined ? (
            <span
              aria-label={`${authorName(message, authors)} is ${presence.state}`}
              className={`size-2 shrink-0 rounded-full ${
                presence.state === "online"
                  ? "bg-success"
                  : presence.state === "away"
                    ? "bg-warning"
                    : "bg-muted-foreground"
              }`}
              data-testid={`punks-presence-${message.author.kind === "punk" ? message.author.punkId : "bot"}`}
              role="img"
              title={presence.status ?? presence.state}
            />
          ) : null}
          <span className="truncate">{authorName(message, authors)}</span>
        </span>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={message.createdAt}
        >
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      {active && message.topic !== null ? (
        <h3
          aria-label={`Message subject ${message.id}`}
          className="mt-2 text-sm font-semibold"
          data-testid={`punks-message-topic-${message.id}`}
        >
          {message.topic}
        </h3>
      ) : null}
      <p className="mt-2 whitespace-pre-wrap text-message">
        {active
          ? (message.content ?? "")
          : message.status === "erased"
            ? "Message permanently erased."
            : "Message retracted."}
      </p>
      {!active && message.publicReason ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Reason: {message.publicReason}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <label
          className="sr-only"
          htmlFor={`punks-reaction-input-${message.id}`}
        >
          Reaction
        </label>
        <input
          aria-label="Reaction"
          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary"
          data-testid={`punks-reaction-input-${message.id}`}
          disabled={!canReact || !canMutate || !active || reactionPending}
          id={`punks-reaction-input-${message.id}`}
          onChange={(event) => setReactionInput(event.target.value)}
          placeholder="👍 or :party:"
          value={reactionInput}
        />
        <button
          aria-label={`Reaction ${message.id} thumbs up`}
          className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`punks-reaction-${message.id}-thumbs-up`}
          disabled={!canReact || !canMutate || !active || reactionPending}
          onClick={() => onToggleReaction(selectedReaction)}
          type="button"
        >
          {selectedReactionView?.reactedByPunk ? "Remove" : "Add"}{" "}
          {selectedReaction} {selectedReactionView?.count ?? 0}
        </button>
        {threadCount > 0 ? (
          <button
            aria-label={`Thread ${message.id}`}
            className="rounded-md px-2 py-1 hover:bg-accent"
            data-testid={`punks-thread-${message.id}`}
            onClick={onOpenThread}
            type="button"
          >
            {threadCount} {threadCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
        {message.editedAt !== null ? <span>Edited</span> : null}
      </div>
      {messageActions}
    </article>
  );
}
