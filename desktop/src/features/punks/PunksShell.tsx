import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  CircleUserRound,
  Hash,
  House,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { ConversationSummary } from "@punks/contracts";
import { usePunksCapabilityAvailable } from "@/shared/capabilities/PunksCapabilityProvider";

import { usePunksAccount, usePunksWorkspace } from "./PunksRuntime";
import { PunksConversation } from "./PunksConversation";
import type { PunksRoute } from "./routes";

const LazyPunksIdentityLauncher = lazy(() =>
  import("./PunksIdentityPanels").then((module) => ({
    default: module.PunksIdentityLauncher,
  })),
);

const LazyWorkspaceAccessLaunchers = lazy(() =>
  import("./IdentityGovernanceControls").then((module) => ({
    default: module.WorkspaceAccessLaunchers,
  })),
);

const LazyPunksPresenceRuntime = lazy(() => import("./PunksPresenceRuntime"));
const LazyPunksPresenceControls = lazy(() =>
  import("./PunksPresenceRuntime").then((module) => ({
    default: module.PunksPresenceControls,
  })),
);

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
  const [showAccountSwitch, setShowAccountSwitch] = useState(false);
  const governanceAvailable = usePunksCapabilityAvailable(
    "identity-governance",
  );
  const presenceAvailable = usePunksCapabilityAvailable("presence");
  const searchAvailable = usePunksCapabilityAvailable("search");
  const lifecycleAvailable = usePunksCapabilityAvailable("message-lifecycle");
  const selectedConversationId =
    route?.kind === "conversation" || route?.kind === "message"
      ? route.conversationId
      : null;

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border bg-background shadow-sm"
      data-testid="punks-workspace-sidebar"
    >
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground shadow-sm">
            P
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Punks Bot</p>
            <p className="truncate text-xs text-muted-foreground">
              Local authoritative runtime
            </p>
          </div>
          <ShieldCheck className="size-4 text-emerald-500" aria-hidden="true" />
        </div>
      </div>
      <nav aria-label="Primary" className="border-b border-border p-3">
        <button
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
            route?.kind === "home" || route?.kind === "workspace"
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          }`}
          data-testid="punks-home"
          onClick={() => onNavigate({ kind: "home" })}
          type="button"
        >
          <House className="size-4" aria-hidden="true" />
          Home
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2 px-1">
          {searchAvailable ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <Search className="size-3.5" aria-hidden="true" /> Search
            </div>
          ) : null}
          {presenceAvailable ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <Radio className="size-3.5 text-emerald-500" aria-hidden="true" />
              Live
            </div>
          ) : null}
          {governanceAvailable ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <CircleUserRound className="size-3.5" aria-hidden="true" />
              People
            </div>
          ) : null}
          {lifecycleAvailable ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <Activity className="size-3.5" aria-hidden="true" /> Lifecycle
            </div>
          ) : null}
        </div>
      </nav>
      <nav
        aria-label="Accessible Workspaces"
        className="border-b border-border p-3"
      >
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workspaces
          </p>
          <ChevronDown
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="space-y-1">
          {account.workspaces.map((candidate) => (
            <button
              aria-label={`Workspace ${candidate.slug}`}
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
        <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Streams
        </p>
        <div className="space-y-1">
          {streams.map((stream) => (
            <button
              aria-label={`Stream ${stream.id}`}
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
              <span className="flex items-center gap-2 truncate">
                <Hash
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate">{stream.name}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>
      <div className="m-3 space-y-2 border-t border-border pt-3">
        {presenceAvailable ? (
          <Suspense fallback={null}>
            <LazyPunksPresenceControls />
          </Suspense>
        ) : null}
        {governanceAvailable ? (
          <Suspense fallback={null}>
            <LazyPunksIdentityLauncher />
            <LazyWorkspaceAccessLaunchers />
          </Suspense>
        ) : null}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {(account.session?.punk.displayName ?? "P")
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {account.session?.punk.displayName ?? "Punk"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workspace.workspace.name}
            </p>
          </div>
          <Sparkles
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <button
          aria-expanded={showAccountSwitch}
          className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/60"
          data-testid="punks-switch-account"
          onClick={() => setShowAccountSwitch((visible) => !visible)}
          type="button"
        >
          Switch Account
        </button>
        {showAccountSwitch ? (
          <fieldset
            aria-label="Account switch methods"
            className="grid grid-cols-3 gap-1"
          >
            <legend className="sr-only">Account switch methods</legend>
            {(["google", "github"] as const).map((method) => (
              <button
                className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent/60"
                key={method}
                onClick={() => {
                  setShowAccountSwitch(false);
                  void account.switchAccount(method);
                }}
                type="button"
              >
                {method === "github"
                  ? "GitHub"
                  : `${method[0]?.toUpperCase()}${method.slice(1)}`}
              </button>
            ))}
          </fieldset>
        ) : null}
        <button
          className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent/60"
          data-testid="punks-sign-out"
          onClick={() => void account.logout()}
          type="button"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function PunksHome({ onNavigate }: { onNavigate(route: PunksRoute): void }) {
  const account = usePunksAccount();
  const workspace = usePunksWorkspace();
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <div className="rounded-2xl border border-border bg-background p-7 shadow-sm">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="size-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          {workspace.workspace.name}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every item below is read from the local Punks authorities. Choose a
          Stream to read its persisted history and follow live changes.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {account.workspaces.map((candidate) => (
          <button
            className="rounded-xl border border-border bg-background p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-accent/40 hover:shadow-md"
            data-testid={`punks-home-workspace-${candidate.slug}`}
            key={candidate.id}
            onClick={() =>
              onNavigate({ kind: "workspace", workspaceSlug: candidate.slug })
            }
            type="button"
          >
            <span className="mb-4 flex size-9 items-center justify-center rounded-lg bg-muted">
              <Hash className="size-4" aria-hidden="true" />
            </span>
            <span className="block text-base font-semibold">
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
  const presenceAvailable = usePunksCapabilityAvailable("presence");
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

  const shell = (
    <div
      className="flex h-dvh overflow-hidden bg-muted/30 text-foreground"
      data-testid="punks-workspace-shell"
    >
      <WorkspaceSidebar onNavigate={navigate} streams={streams} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {route?.kind === "conversation" || route?.kind === "message"
                ? (streams.find((stream) => stream.id === route.conversationId)
                    ?.name ?? "Stream")
                : workspace.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {route?.kind === "message" ? "Thread" : "Punks Bot Local"}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" />
            Workers connected
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      </main>
      {streamsQuery.isError ? (
        <div className="sr-only" role="alert">
          Streams are not available.
        </div>
      ) : null}
      <span className="sr-only">{workspace.id}</span>
    </div>
  );
  return presenceAvailable ? (
    <Suspense fallback={shell}>
      <LazyPunksPresenceRuntime>{shell}</LazyPunksPresenceRuntime>
    </Suspense>
  ) : (
    shell
  );
}
