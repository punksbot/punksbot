import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  PunksDesktopFailure,
  type PunksAccountClient,
} from "@/shared/api/punksClient";
import type {
  AuthSession,
  DesktopCompatibilityResponse,
  WorkspaceSummary,
} from "@punks/contracts";

import {
  canonicalPunksPath,
  canonicalPunksUrl,
  type PunksRoute,
} from "./routes";
import {
  createPunksLocalStore,
  type PunksLocalPreferences,
  type PunksStorageScope,
} from "./storage";
import {
  PunksWorkspaceScopeManager,
  type PunksWorkspaceScope,
} from "./workspaceScope";
import { PunksShell } from "./PunksShell";

export type PunksBootstrapStatus = "loading" | "signed_out" | "ready" | "error";

type BootstrapState = {
  status: PunksBootstrapStatus;
  compatibility: DesktopCompatibilityResponse | null;
  session: AuthSession | null;
  workspaces: WorkspaceSummary[];
  error: unknown;
};

export type PunksAccountRuntime = {
  client: PunksAccountClient;
  status: PunksBootstrapStatus;
  compatibility: DesktopCompatibilityResponse | null;
  session: AuthSession | null;
  workspaces: WorkspaceSummary[];
  route: PunksRoute | null;
  navigate(route: PunksRoute, replace?: boolean): void;
  localStore: ReturnType<typeof createPunksLocalStore> | null;
  scopeManager: PunksWorkspaceScopeManager;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  preferences: PunksLocalPreferences;
  savePreferences(preferences: PunksLocalPreferences): void;
  error: unknown;
};

export type PunksWorkspaceRuntime = {
  scope: PunksWorkspaceScope;
  manager: PunksWorkspaceScopeManager;
  workspace: WorkspaceSummary;
};

const AccountContext = createContext<PunksAccountRuntime | null>(null);
const WorkspaceContext = createContext<PunksWorkspaceRuntime | null>(null);

function navigatePunks(route: PunksRoute, replace = false): void {
  const path = canonicalPunksPath(route);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof PunksDesktopFailure &&
    (error.kind === "session_expired" || error.kind === "problem")
  );
}

function routeWithWorkspaceSlug(
  route: Exclude<PunksRoute, { kind: "home" }>,
  workspaceSlug: string,
): PunksRoute {
  return { ...route, workspaceSlug };
}

function workspaceForRoute(
  route: PunksRoute,
  workspaces: WorkspaceSummary[],
): WorkspaceSummary | null {
  if (route.kind === "home") return null;
  return (
    workspaces.find(
      (workspace) =>
        workspace.slug === route.workspaceSlug ||
        workspace.id === route.workspaceSlug,
    ) ?? null
  );
}

function PunksCompatibilityGate({
  message = "Nothing is available at this address in this version of the app.",
}: {
  message?: string;
}) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-muted-foreground"
      data-testid="punks-compatibility-gate"
      role="status"
    >
      <div className="max-w-md px-6 text-center">
        <h1 className="text-message font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm">{message}</p>
      </div>
    </div>
  );
}

function PunksUnavailableScreen() {
  return (
    <div
      className="flex min-h-dvh w-full items-center justify-center bg-app text-muted-foreground"
      data-testid="unavailable-terminal"
    >
      <div className="max-w-md px-6 text-center">
        <h1 className="text-message font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm">
          Nothing is available at this address in this version of the app.
        </p>
      </div>
    </div>
  );
}

function PunksSignedOut({
  client,
  onStarted,
}: {
  client: PunksAccountClient;
  onStarted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);

  useEffect(() => {
    if (!waitingForBrowser) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const phase = await client.ceremonyStatus();
        if (!active) return;
        if (phase.phase === "confirmed") {
          setWaitingForBrowser(false);
          await onStarted();
          return;
        }
        if (
          phase.phase === "cancelled" ||
          phase.phase === "expired" ||
          phase.phase === "failed"
        ) {
          setWaitingForBrowser(false);
          return;
        }
        timer = window.setTimeout(() => void poll(), 750);
      } catch (error) {
        if (!active) return;
        setFailure(error);
        setWaitingForBrowser(false);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, onStarted, waitingForBrowser]);

  const start = async (provider: "google" | "github") => {
    setBusy(provider);
    setFailure(null);
    try {
      await client.ceremonyStart(provider);
      setWaitingForBrowser(true);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-foreground"
      data-testid="punks-signed-out"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in to Punks Bot</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Continue in your system browser to authorize this desktop session.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            data-testid="punks-sign-in-google"
            disabled={busy !== null || waitingForBrowser}
            onClick={() => void start("google")}
            type="button"
          >
            {busy === "google" ? "Opening…" : "Google"}
          </button>
          <button
            className="rounded-md border border-border px-3 py-2 text-sm"
            data-testid="punks-sign-in-github"
            disabled={busy !== null || waitingForBrowser}
            onClick={() => void start("github")}
            type="button"
          >
            {busy === "github" ? "Opening…" : "GitHub"}
          </button>
        </div>
        {waitingForBrowser ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Finish authorization in your system browser…
          </p>
        ) : null}
        {failure ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            The sign-in ceremony could not be started.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PunksNoWorkspace() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-muted-foreground"
      data-testid="punks-no-workspace"
    >
      <p className="text-sm">No Workspace is available for this Account.</p>
    </div>
  );
}

function PunksAccountProvider({
  client,
  compatibility,
  route,
  children,
}: {
  client: PunksAccountClient;
  compatibility: DesktopCompatibilityResponse;
  route: PunksRoute;
  children: ReactNode;
}) {
  const [state, setState] = useState<BootstrapState>({
    status: "loading",
    compatibility,
    session: null,
    workspaces: [],
    error: null,
  });
  const [scopeManager] = useState(() => new PunksWorkspaceScopeManager());

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const session = await client.getSession();
      const workspaces = await client.listWorkspaces();
      setState({
        status: "ready",
        compatibility,
        session,
        workspaces,
        error: null,
      });
    } catch (error) {
      if (isSessionExpired(error)) {
        setState((current) => ({
          ...current,
          status: "signed_out",
          session: null,
          workspaces: [],
          error: null,
        }));
      } else {
        setState((current) => ({ ...current, status: "error", error }));
      }
    }
  }, [client, compatibility]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => void scopeManager.invalidate(), [scopeManager]);

  const localStore = useMemo(() => {
    if (state.compatibility === null || state.session === null) return null;
    const scope: PunksStorageScope = {
      origin: state.compatibility.origin,
      punkId: state.session.punkId,
    };
    return createPunksLocalStore(window.localStorage, scope);
  }, [state.compatibility, state.session]);
  const [preferences, setPreferences] = useState<PunksLocalPreferences>({});
  const restoredRouteScope = useRef<string | null>(null);

  useEffect(() => {
    if (localStore !== null) setPreferences(localStore.loadPreferences());
  }, [localStore]);

  const savePreferences = useCallback(
    (next: PunksLocalPreferences) => {
      localStore?.savePreferences(next);
      setPreferences(next);
    },
    [localStore],
  );

  const logout = useCallback(async () => {
    await scopeManager.invalidate();
    try {
      await client.logout();
    } finally {
      setState((current) => ({
        ...current,
        status: "signed_out",
        session: null,
        workspaces: [],
      }));
    }
  }, [client, scopeManager]);

  const navigate = useCallback(
    (next: PunksRoute, replace = false) => {
      let url: string;
      try {
        url = canonicalPunksUrl(
          next,
          state.compatibility?.origin ?? window.location.origin,
        );
      } catch {
        return;
      }
      const validateNavigation = client.validateNavigation;
      if (validateNavigation !== undefined) {
        void validateNavigation
          .call(client, url)
          .then(() => navigatePunks(next, replace))
          .catch(() => undefined);
        return;
      }
      navigatePunks(next, replace);
    },
    [client, state.compatibility],
  );

  useEffect(() => {
    if (
      state.status !== "ready" ||
      state.compatibility === null ||
      state.session === null ||
      localStore === null ||
      route === null
    ) {
      return;
    }
    const scopeKey = `${state.compatibility.origin}:${state.session.punkId}`;
    if (restoredRouteScope.current === scopeKey) return;
    restoredRouteScope.current = scopeKey;
    if (route.kind !== "home") return;

    const saved = localStore.loadRouteCoordinates();
    if (saved.workspaceSlug === undefined) return;
    const workspace = state.workspaces.find(
      (candidate) =>
        candidate.slug === saved.workspaceSlug ||
        candidate.id === saved.workspaceSlug,
    );
    if (workspace === undefined) return;

    const restored: PunksRoute =
      saved.conversationId === undefined
        ? { kind: "workspace", workspaceSlug: workspace.slug }
        : saved.messageId === undefined
          ? {
              kind: "conversation",
              workspaceSlug: workspace.slug,
              conversationId: saved.conversationId,
            }
          : {
              kind: "message",
              workspaceSlug: workspace.slug,
              conversationId: saved.conversationId,
              messageId: saved.messageId,
            };
    navigate(restored, true);
  }, [
    localStore,
    navigate,
    route,
    state.compatibility,
    state.session,
    state.status,
    state.workspaces,
  ]);

  const value: PunksAccountRuntime = {
    client,
    status: state.status,
    compatibility: state.compatibility,
    session: state.session,
    workspaces: state.workspaces,
    route,
    navigate,
    localStore,
    scopeManager,
    logout,
    refresh,
    preferences,
    savePreferences,
    error: state.error,
  };

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

function PunksWorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceSummary;
  children: ReactNode;
}) {
  const account = usePunksAccount();
  const [state, setState] = useState<
    | { phase: "opening" }
    | { phase: "ready"; scope: PunksWorkspaceScope }
    | { phase: "error"; error: unknown }
  >({ phase: "opening" });
  const workspaceId = workspace.id;

  useEffect(() => {
    let current = true;
    setState({ phase: "opening" });
    void account.scopeManager
      .open(account.client, workspaceId)
      .then((scope) => {
        if (!current) {
          void account.scopeManager.invalidate();
          return;
        }
        account.localStore?.saveLastWorkspaceId(workspaceId);
        setState({ phase: "ready", scope });
      })
      .catch((error) => {
        if (current) setState({ phase: "error", error });
      });
    return () => {
      current = false;
      void account.scopeManager.invalidate();
    };
  }, [account.client, account.localStore, account.scopeManager, workspaceId]);

  if (state.phase === "opening") {
    return <PunksCompatibilityGate message="Opening Workspace…" />;
  }
  if (state.phase === "error") return <PunksUnavailableScreen />;

  const runtime: PunksWorkspaceRuntime = {
    scope: state.scope,
    manager: account.scopeManager,
    workspace,
  };
  return (
    <WorkspaceContext.Provider value={runtime}>
      <QueryClientProvider client={state.scope.queryClient}>
        {children}
      </QueryClientProvider>
    </WorkspaceContext.Provider>
  );
}

function PunksWorkspaceRouter() {
  const account = usePunksAccount();
  const route = account.route;
  const [resolvedWorkspace, setResolvedWorkspace] =
    useState<WorkspaceSummary | null>(null);
  const [routeResolutionPending, setRouteResolutionPending] = useState(false);

  const directWorkspace = route
    ? workspaceForRoute(route, account.workspaces)
    : null;
  const routeResolvedWorkspace =
    route !== null && resolvedWorkspace !== null && route.kind !== "home"
      ? resolvedWorkspace.slug === route.workspaceSlug ||
        resolvedWorkspace.id === route.workspaceSlug
        ? resolvedWorkspace
        : null
      : null;
  const selectedWorkspace =
    directWorkspace ??
    routeResolvedWorkspace ??
    (route?.kind === "home"
      ? (account.workspaces.find(
          (workspace) =>
            workspace.id === account.localStore?.loadLastWorkspaceId(),
        ) ?? account.workspaces[0])
      : null);

  useEffect(() => {
    setResolvedWorkspace(null);
    if (
      route === null ||
      route.kind === "home" ||
      directWorkspace !== null ||
      account.status !== "ready"
    ) {
      setRouteResolutionPending(false);
      return;
    }
    let active = true;
    setRouteResolutionPending(true);
    void account.client
      .resolveWorkspace(route.workspaceSlug)
      .then((workspace) => {
        if (!active) return;
        setRouteResolutionPending(false);
        if (workspace !== null) {
          setResolvedWorkspace(workspace);
          account.navigate(routeWithWorkspaceSlug(route, workspace.slug), true);
        }
      })
      .catch(() => {
        if (active) setRouteResolutionPending(false);
      });
    return () => {
      active = false;
    };
  }, [
    account.client,
    account.navigate,
    account.status,
    directWorkspace,
    route,
  ]);

  useEffect(() => {
    if (
      route === null ||
      route.kind === "home" ||
      directWorkspace === null ||
      directWorkspace.slug === route.workspaceSlug
    ) {
      return;
    }
    account.navigate(routeWithWorkspaceSlug(route, directWorkspace.slug), true);
  }, [account.navigate, directWorkspace, route]);

  useEffect(() => {
    if (route !== null && account.localStore !== null) {
      account.localStore.saveRouteCoordinates(
        route.kind === "home"
          ? {}
          : {
              workspaceSlug: route.workspaceSlug,
              ...(route.kind === "conversation" || route.kind === "message"
                ? { conversationId: route.conversationId }
                : {}),
              ...(route.kind === "message"
                ? { messageId: route.messageId }
                : {}),
            },
      );
    }
  }, [account.localStore, route]);

  if (route === null) return <PunksUnavailableScreen />;
  if (account.workspaces.length === 0) return <PunksNoWorkspace />;
  if (routeResolutionPending || selectedWorkspace === undefined) {
    return <PunksCompatibilityGate message="Resolving Workspace…" />;
  }
  if (selectedWorkspace === null) return <PunksUnavailableScreen />;

  return (
    <PunksWorkspaceProvider
      key={selectedWorkspace.id}
      workspace={selectedWorkspace}
    >
      <PunksShell />
    </PunksWorkspaceProvider>
  );
}

export function PunksRuntime({
  client,
  compatibility,
  route,
}: {
  client: PunksAccountClient;
  compatibility: DesktopCompatibilityResponse;
  route: PunksRoute;
}) {
  return (
    <PunksAccountProvider
      client={client}
      compatibility={compatibility}
      route={route}
    >
      <PunksAccountGate client={client} />
    </PunksAccountProvider>
  );
}

function PunksAccountGate({ client }: { client: PunksAccountClient }) {
  const account = usePunksAccount();
  if (account.status === "loading") {
    return <PunksCompatibilityGate message="Checking Punks compatibility…" />;
  }
  if (account.status === "signed_out") {
    return <PunksSignedOut client={client} onStarted={account.refresh} />;
  }
  if (account.status === "error") return <PunksCompatibilityGate />;
  return <PunksWorkspaceRouter />;
}

export function usePunksAccount(): PunksAccountRuntime {
  const context = useContext(AccountContext);
  if (context === null) {
    throw new Error(
      "usePunksAccount must be called inside PunksAccountProvider",
    );
  }
  return context;
}

export function usePunksWorkspace(): PunksWorkspaceRuntime {
  const context = useContext(WorkspaceContext);
  if (context === null) {
    throw new Error(
      "usePunksWorkspace must be called inside PunksWorkspaceProvider",
    );
  }
  return context;
}
