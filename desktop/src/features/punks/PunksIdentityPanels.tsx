import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { PunksDesktopFailure } from "@/shared/api/punksClient";

import { usePunksAccount, usePunksWorkspace } from "./PunksRuntime";

type IdentityPanel = "profile" | "search";

function profileQueryKey(workspaceId: string, generation: number) {
  return ["punks", "profile", workspaceId, generation] as const;
}

function failureCode(error: unknown): string | null {
  if (
    !(error instanceof PunksDesktopFailure) ||
    typeof error.problem !== "object" ||
    error.problem === null ||
    !("code" in error.problem) ||
    typeof error.problem.code !== "string"
  ) {
    return null;
  }
  return error.problem.code;
}

export function PunksCurrentPunkName({ fallback }: { fallback: string }) {
  const account = usePunksAccount();
  const { scope, manager } = usePunksWorkspace();
  const profile = useQuery({
    queryKey: profileQueryKey(scope.lease.workspaceId, scope.lease.generation),
    queryFn: () => manager.run(scope, () => account.client.getPunkProfile()),
    enabled: false,
  });
  return (
    <span data-testid="punks-current-punk-name">
      {profile.data?.displayName ?? fallback}
    </span>
  );
}

function PanelFrame({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const titleId = `punks-${label.toLocaleLowerCase("en-US").replaceAll(" ", "-")}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold" id={titleId}>
            {label}
          </h2>
          <button
            aria-label="Close"
            className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PunkProfilePanel({ onClose }: { onClose(): void }) {
  const account = usePunksAccount();
  const { scope, manager } = usePunksWorkspace();
  const queryClient = useQueryClient();
  const key = profileQueryKey(scope.lease.workspaceId, scope.lease.generation);
  const profile = useQuery({
    queryKey: key,
    queryFn: () => manager.run(scope, () => account.client.getPunkProfile()),
  });
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data === undefined) return;
    setDisplayName(profile.data.displayName);
    setAvatarUrl(profile.data.avatarUrl ?? "");
  }, [profile.data]);

  const update = useMutation({
    mutationFn: async () => {
      const current = profile.data;
      if (current === undefined) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Punk profile is not loaded",
        );
      }
      return manager.run(scope, () =>
        account.client.updatePunkProfile({
          expectedRevision: current.revision,
          displayName,
          avatarUrl: avatarUrl.trim() === "" ? null : avatarUrl.trim(),
        }),
      );
    },
    retry: false,
    onSuccess: (next) => {
      if (!manager.isCurrent(scope)) return;
      queryClient.setQueryData(key, next);
      setNotice("Profile saved.");
    },
    onError: (error) => {
      if (!manager.isCurrent(scope)) return;
      if (failureCode(error) === "revision_conflict") {
        setNotice("Profile changed elsewhere. Reload it before saving again.");
        void queryClient.invalidateQueries({ queryKey: key });
      } else {
        setNotice("Profile could not be saved.");
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    update.mutate();
  };

  return (
    <PanelFrame label="Punk profile" onClose={onClose}>
      {profile.isPending ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading profile…</p>
      ) : profile.isError || profile.data === undefined ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Profile is unavailable.
        </p>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label
            className="block text-sm font-medium"
            htmlFor="punk-profile-name"
          >
            Display name
          </label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            id="punk-profile-name"
            maxLength={80}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setNotice(null);
            }}
            required
            value={displayName}
          />
          <label
            className="block text-sm font-medium"
            htmlFor="punk-profile-avatar"
          >
            Avatar URL
          </label>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            id="punk-profile-avatar"
            maxLength={2048}
            onChange={(event) => {
              setAvatarUrl(event.target.value);
              setNotice(null);
            }}
            placeholder="https://…"
            type="url"
            value={avatarUrl}
          />
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Linked sign-in methods
            </p>
            <p className="mt-1 text-sm">
              {profile.data.identities
                .map(({ provider }) => provider)
                .filter(
                  (provider, index, providers) =>
                    providers.indexOf(provider) === index,
                )
                .join(", ")}
            </p>
          </div>
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={update.isPending || displayName.trim() === ""}
            type="submit"
          >
            Save profile
          </button>
          {notice !== null ? (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
        </form>
      )}
    </PanelFrame>
  );
}

const punkIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function searchIntent(raw: string) {
  const trimmed = raw.trim();
  if (punkIdPattern.test(trimmed)) {
    return {
      query: { kind: "punk_id" as const, punkId: trimmed },
      limit: 1,
      key: `id:${trimmed}`,
    };
  }
  const prefix = trimmed.normalize("NFKC").toLocaleLowerCase("en-US");
  const significant = [...prefix].filter((scalar) =>
    /[\p{L}\p{N}]/u.test(scalar),
  );
  if (significant.length < 3 || [...prefix].length > 80) return null;
  return {
    query: { kind: "prefix" as const, value: prefix },
    limit: 10,
    key: `prefix:${prefix}`,
  };
}

function PunkSearchPanel({ onClose }: { onClose(): void }) {
  const { scope, manager } = usePunksWorkspace();
  const [rawQuery, setRawQuery] = useState("");
  const intent = useMemo(() => searchIntent(rawQuery), [rawQuery]);
  const search = useInfiniteQuery({
    queryKey: [
      "punks",
      "punk-search",
      scope.lease.workspaceId,
      scope.lease.generation,
      intent?.key ?? "constrained-input-required",
    ],
    queryFn: ({ pageParam }) => {
      if (intent === null) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Punk search requires a constrained query",
        );
      }
      return manager.run(scope, () =>
        scope.session.searchPunks({
          query: intent.query,
          limit: intent.limit,
          cursor: pageParam,
        }),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: intent !== null,
  });
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PanelFrame label="Find a Punk" onClose={onClose}>
      <label
        className="mt-5 block text-sm font-medium"
        htmlFor="punk-search-query"
      >
        Name prefix or Punk ID
      </label>
      <input
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        id="punk-search-query"
        maxLength={80}
        onChange={(event) => setRawQuery(event.target.value)}
        placeholder="At least 3 letters"
        value={rawQuery}
      />
      {intent === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Enter at least three letters or digits, or an exact Punk ID.
        </p>
      ) : search.isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Searching…</p>
      ) : search.isError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          Search is unavailable.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No matching Punk.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((summary) => (
            <li
              className="rounded-md border border-border p-3"
              key={summary.punkId}
            >
              <p className="text-sm font-medium">{summary.displayName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Punk</p>
            </li>
          ))}
        </ul>
      )}
      {search.hasNextPage ? (
        <button
          className="mt-4 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          disabled={search.isFetchingNextPage}
          onClick={() => void search.fetchNextPage()}
          type="button"
        >
          More
        </button>
      ) : null}
    </PanelFrame>
  );
}

export function PunksIdentityPanel({
  panel,
  onClose,
}: {
  panel: IdentityPanel;
  onClose(): void;
}) {
  return panel === "profile" ? (
    <PunkProfilePanel onClose={onClose} />
  ) : (
    <PunkSearchPanel onClose={onClose} />
  );
}
