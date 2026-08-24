import { useQuery } from "@tanstack/react-query";

import type { ConversationSummary } from "@punks/contracts";

import { usePunksAccount, usePunksWorkspace } from "./PunksRuntime";
import { PunksConversation } from "./PunksConversation";
import type { PunksRoute } from "./routes";

function routeForConversation(
  workspaceSlug: string,
  conversation: ConversationSummary,
): PunksRoute {
  return {
    kind: "conversation",
    workspaceSlug,
    conversationId: conversation.id,
  };
}

function WorkspaceSidebar({
  streams,
  onNavigate,
}: {
  streams: ConversationSummary[];
  onNavigate(route: PunksRoute): void;
}) {
  const account = usePunksAccount();
  const workspace = usePunksWorkspace();
  const route = account.route;
  const selectedConversationId =
    route?.kind === "conversation" || route?.kind === "message"
      ? route.conversationId
      : null;

  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r border-border bg-background"
      data-testid="punks-workspace-sidebar"
    >
      <div className="border-b border-border p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Punks Bot
        </p>
        <h1 className="mt-1 truncate text-base font-semibold">
          {workspace.workspace.name}
        </h1>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {account.session?.punk.displayName ?? "Punk"}
        </p>
      </div>
      <nav
        aria-label="Accessible Workspaces"
        className="border-b border-border p-3"
      >
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Workspaces
        </p>
        <div className="space-y-1">
          {account.workspaces.map((candidate) => (
            <button
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                candidate.id === workspace.workspace.id
                  ? "bg-accent font-medium"
                  : "hover:bg-accent/60"
              }`}
              data-testid={`punks-workspace-${candidate.slug}`}
              key={candidate.id}
              onClick={() =>
                onNavigate({ kind: "workspace", workspaceSlug: candidate.slug })
              }
              type="button"
            >
              <span className="block truncate">{candidate.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {candidate.role}
              </span>
            </button>
          ))}
        </div>
      </nav>
      <nav aria-label="Streams" className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Streams
        </p>
        <div className="space-y-1">
          {streams.map((stream) => (
            <button
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                selectedConversationId === stream.id
                  ? "bg-accent font-medium"
                  : "hover:bg-accent/60"
              }`}
              data-testid={`punks-stream-${stream.id}`}
              key={stream.id}
              onClick={() =>
                onNavigate(
                  routeForConversation(workspace.workspace.slug, stream),
                )
              }
              type="button"
            >
              <span className="block truncate"># {stream.name}</span>
            </button>
          ))}
        </div>
      </nav>
      <button
        className="m-3 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/60"
        data-testid="punks-sign-out"
        onClick={() => void account.logout()}
        type="button"
      >
        Sign out
      </button>
    </aside>
  );
}

function PunksHome({ onNavigate }: { onNavigate(route: PunksRoute): void }) {
  const account = usePunksAccount();
  const workspace = usePunksWorkspace();
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <div>
        <p className="text-sm text-muted-foreground">Workspace</p>
        <h2 className="mt-1 text-2xl font-semibold">
          {workspace.workspace.name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a stream to read its current history and follow live changes.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {account.workspaces.map((candidate) => (
          <button
            className="rounded-lg border border-border p-4 text-left hover:bg-accent/60"
            data-testid={`punks-home-workspace-${candidate.slug}`}
            key={candidate.id}
            onClick={() =>
              onNavigate({ kind: "workspace", workspaceSlug: candidate.slug })
            }
            type="button"
          >
            <span className="block text-base font-medium">
              {candidate.name}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {candidate.role} · {candidate.visibility}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PunksShell() {
  const account = usePunksAccount();
  const { scope, manager, workspace } = usePunksWorkspace();
  const streamsQuery = useQuery({
    queryKey: [
      "punks",
      "streams",
      scope.lease.workspaceId,
      scope.lease.generation,
    ],
    queryFn: () => manager.run(scope, () => scope.session.listStreams()),
  });
  const streams = streamsQuery.data ?? [];
  const navigate = (route: PunksRoute) => account.navigate(route);
  const route = account.route;

  let content = <PunksHome onNavigate={navigate} />;
  if (route?.kind === "conversation" || route?.kind === "message") {
    content = (
      <PunksConversation
        conversationId={route.conversationId}
        messageId={route.kind === "message" ? route.messageId : null}
      />
    );
  }

  return (
    <div
      className="flex min-h-dvh bg-app text-foreground"
      data-testid="punks-workspace-shell"
    >
      <WorkspaceSidebar onNavigate={navigate} streams={streams} />
      <main className="min-w-0 flex-1 overflow-y-auto">{content}</main>
      {streamsQuery.isError ? (
        <div className="sr-only" role="alert">
          Streams are not available.
        </div>
      ) : null}
      <span className="sr-only">{workspace.id}</span>
    </div>
  );
}
