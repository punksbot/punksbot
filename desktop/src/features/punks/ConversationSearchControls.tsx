import { useEffect, useRef, useState, type FormEvent } from "react";

import type { MessageSearchResponse } from "@punks/contracts";

import { usePunksWorkspace } from "./PunksRuntime";

const PAGE_SIZE = 25;

type SearchPageState = Pick<
  MessageSearchResponse,
  "completeness" | "partialReason" | "nextCursor"
> & {
  items: MessageSearchResponse["items"];
};

const EMPTY_PAGE: SearchPageState = {
  completeness: "complete",
  partialReason: null,
  items: [],
  nextCursor: null,
};

function partialMessage(reason: MessageSearchResponse["partialReason"]) {
  return reason === "index_lagging"
    ? "Search results are partial because the index is still catching up."
    : "Search results are partial because the index is temporarily unavailable.";
}

export function ConversationSearchLauncher({
  conversationId,
  threadRootMessageId,
  onOpenMessage,
}: {
  conversationId: string;
  threadRootMessageId: string | null;
  onOpenMessage(messageId: string): Promise<boolean>;
}) {
  const { manager, scope } = usePunksWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<SearchPageState>(EMPTY_PAGE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeQuery = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const queryInput = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      queryInput.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const close = () => {
    requestGeneration.current += 1;
    activeQuery.current = null;
    setOpen(false);
    setQuery("");
    setPage(EMPTY_PAGE);
    setPending(false);
    setError(null);
    window.requestAnimationFrame(() => launcher.current?.focus());
  };

  const runSearch = async (searchQuery: string, cursor: string | null) => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setPending(true);
    setError(null);
    try {
      const response = await manager.run(scope, () =>
        scope.session.searchMessages({
          conversationId,
          threadRootMessageId,
          query: searchQuery,
          cursor,
          limit: PAGE_SIZE,
        }),
      );
      if (
        requestGeneration.current !== generation ||
        !manager.isCurrent(scope)
      ) {
        return;
      }
      setPage((current) => ({
        completeness: response.completeness,
        partialReason: response.partialReason,
        items:
          cursor === null
            ? response.items
            : [
                ...current.items,
                ...response.items.filter(
                  (candidate) =>
                    !current.items.some((item) => item.id === candidate.id),
                ),
              ],
        nextCursor: response.nextCursor,
      }));
    } catch {
      if (
        requestGeneration.current === generation &&
        manager.isCurrent(scope)
      ) {
        setError("Message search is unavailable.");
      }
    } finally {
      if (requestGeneration.current === generation) setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitted = query.trim();
    if (submitted.length === 0 || pending) return;
    activeQuery.current = submitted;
    setPage(EMPTY_PAGE);
    void runSearch(submitted, null);
  };

  return (
    <div>
      <button
        aria-expanded={open}
        className="mt-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/60"
        data-testid="punks-open-message-search"
        onClick={() => (open ? close() : setOpen(true))}
        ref={launcher}
        type="button"
      >
        Search Messages
      </button>
      {open ? (
        <search
          aria-label="Search Messages"
          className="mt-3 rounded-lg border border-border bg-background p-3"
        >
          <form className="flex flex-wrap gap-2" onSubmit={submit}>
            <label className="sr-only" htmlFor="punks-message-search-query">
              Search terms
            </label>
            <input
              className="min-w-48 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              id="punks-message-search-query"
              maxLength={512}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                threadRootMessageId === null
                  ? "Search this Conversation"
                  : "Search this thread"
              }
              ref={queryInput}
              value={query}
            />
            <button
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={pending || query.trim().length === 0}
              type="submit"
            >
              {pending ? "Searching…" : "Search"}
            </button>
            <button
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/60"
              onClick={close}
              type="button"
            >
              Close
            </button>
          </form>

          {page.completeness === "partial" ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {partialMessage(page.partialReason)}
            </p>
          ) : null}
          {error !== null ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {activeQuery.current !== null &&
          !pending &&
          error === null &&
          page.completeness === "complete" &&
          page.items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              No authorized Messages matched this search.
            </p>
          ) : null}

          {page.items.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {page.items.map((message) => (
                <li key={message.id}>
                  <button
                    className="w-full rounded-md border border-border p-3 text-left hover:bg-accent/60"
                    onClick={() => {
                      void onOpenMessage(message.id)
                        .then((navigated) => {
                          if (navigated) close();
                          else setError("This Message cannot be opened.");
                        })
                        .catch(() =>
                          setError("This Message cannot be opened."),
                        );
                    }}
                    type="button"
                  >
                    {message.topic !== null ? (
                      <span className="block text-sm font-medium">
                        {message.topic}
                      </span>
                    ) : null}
                    <span className="block text-sm text-foreground">
                      {message.content}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {page.nextCursor !== null &&
          page.partialReason !== "index_unavailable" &&
          activeQuery.current !== null ? (
            <button
              className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                const submitted = activeQuery.current;
                if (submitted !== null)
                  void runSearch(submitted, page.nextCursor);
              }}
              type="button"
            >
              {pending ? "Loading…" : "Load more results"}
            </button>
          ) : null}
        </search>
      ) : null}
    </div>
  );
}
