import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createTauriPunksAccountClient,
  PunksDesktopFailure,
  type AccountSessionStateView,
  type AuthenticationMethod,
  type PunksAccountClient,
} from "@/shared/api/punksClient";
import type {
  AuthSession,
  DesktopCompatibilityResponse,
  WorkspaceSummary,
} from "@punks/contracts";
import {
  PunksUnavailableScreen,
  usePunksCapabilityAvailable,
} from "@/shared/capabilities/PunksCapabilityProvider";

import {
  canonicalPunksPath,
  canonicalPunksUrl,
  type PunksRoute,
} from "./routes";
import {
  createPunksLocalStore,
  samePunksStorageScope,
  type PunksLocalPreferences,
  type PunksStorageScope,
} from "./storage";
import {
  PunksWorkspaceScopeManager,
  type PunksWorkspaceScope,
} from "./workspaceScope";
import { PunksAccountSwitching } from "./PunksAccountSwitching";
import { PunksRuntimeError } from "./PunksRuntimeError";
import { PunksShell } from "./PunksShell";
import { PunksSignedOut } from "./PunksSignedOut";

const LazyInvitationClaimGate = lazy(() =>
  import("./IdentityGovernanceControls").then((module) => ({
    default: module.InvitationClaimGate,
  })),
);

export type PunksBootstrapStatus =
  | "loading"
  | "signed_out"
  | "switching_account"
  | "ready"
  | "error";

type BootstrapState = {
  status: PunksBootstrapStatus;
  compatibility: DesktopCompatibilityResponse | null;
  accountSessionState: AccountSessionStateView | null;
  session: AuthSession | null;
  workspaces: WorkspaceSummary[];
  error: unknown;
};

export type PunksAccountRuntime = {
  client: PunksAccountClient;
  status: PunksBootstrapStatus;
  compatibility: DesktopCompatibilityResponse | null;
  accountSessionState: AccountSessionStateView | null;
  session: AuthSession | null;
  workspaces: WorkspaceSummary[];
  route: PunksRoute | null;
  navigate(route: PunksRoute, replace?: boolean): Promise<boolean>;
  localStore: ReturnType<typeof createPunksLocalStore> | null;
  scopeManager: PunksWorkspaceScopeManager;
  switchAccount(provider: AuthenticationMethod): Promise<void>;
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

function requiresFreshSignIn(error: unknown): boolean {
  return (
    error instanceof PunksDesktopFailure &&
    (error.kind === "session_expired" || error.kind === "account_merged")
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
    workspaces.find((workspace) => workspace.slug === route.workspaceSlug) ??
    null
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

function PunksNoWorkspace() {
  const governanceAvailable = usePunksCapabilityAvailable(
    "identity-governance",
  );
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-muted-foreground"
      data-testid="punks-no-workspace"
    >
      {governanceAvailable ? (
        <Suspense
          fallback={<p className="text-sm">Loading invitation tools…</p>}
        >
          <LazyInvitationClaimGate />
        </Suspense>
      ) : (
        <p className="text-sm">No Workspace is available for this Account.</p>
      )}
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
    accountSessionState: null,
    session: null,
    workspaces: [],
    error: null,
  });
  const [scopeManager] = useState(() => new PunksWorkspaceScopeManager());
  const bootstrapGeneration = useRef(0);
  const navigationGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = bootstrapGeneration.current + 1;
    bootstrapGeneration.current = generation;
    navigationGeneration.current += 1;
    setState((current) => ({ ...current, status: "loading", error: null }));
    await scopeManager.invalidate();
    if (bootstrapGeneration.current !== generation) return;
    try {
      const accountSessionState = await client.getAccountSessionState();
      if (bootstrapGeneration.current !== generation) return;
      if (accountSessionState.state === "signed_out") {
        setState({
          status: "signed_out",
          compatibility,
          accountSessionState,
          session: null,
          workspaces: [],
          error: null,
        });
        return;
      }
      const workspaces = await client.listWorkspaces();
      if (bootstrapGeneration.current !== generation) return;
      setState({
        status: "ready",
        compatibility,
        accountSessionState,
        session: accountSessionState.session,
        workspaces,
        error: null,
      });
    } catch (error) {
      if (bootstrapGeneration.current !== generation) return;
      if (requiresFreshSignIn(error)) {
        navigatePunks({ kind: "home" }, true);
        setState((current) => ({
          ...current,
          status: "signed_out",
          accountSessionState: {
            state: "signed_out",
            authentication: { phase: "idle" },
            resumeAvailable: false,
          },
          session: null,
          workspaces: [],
          error: null,
        }));
      } else {
        setState((current) => ({ ...current, status: "error", error }));
      }
    }
  }, [client, compatibility, scopeManager]);

  useEffect(() => {
    void refresh();
    return () => {
      bootstrapGeneration.current += 1;
      navigationGeneration.current += 1;
      void scopeManager.invalidate().catch(() => undefined);
    };
  }, [refresh, scopeManager]);

  const renewalInFlight = useRef(false);
  useEffect(() => {
    if (state.status !== "ready") return;
    const renewOnForeground = () => {
      if (document.visibilityState !== "visible" || renewalInFlight.current) {
        return;
      }
      renewalInFlight.current = true;
      void client
        .renewAccountSession()
        .catch(() => undefined)
        .finally(() => {
          renewalInFlight.current = false;
        });
    };
    window.addEventListener("focus", renewOnForeground);
    document.addEventListener("visibilitychange", renewOnForeground);
    return () => {
      window.removeEventListener("focus", renewOnForeground);
      document.removeEventListener("visibilitychange", renewOnForeground);
    };
  }, [client, state.status]);

  const localStore = useMemo(() => {
    if (state.compatibility === null || state.session === null) return null;
    const scope: PunksStorageScope = {
      origin: state.compatibility.origin,
      punkId: state.session.punkId,
    };
    return createPunksLocalStore(window.localStorage, scope);
  }, [state.compatibility, state.session]);
  const [preferences, setPreferences] = useState<PunksLocalPreferences>({});

  useEffect(() => {
    setPreferences(localStore?.loadPreferences() ?? {});
  }, [localStore]);

  const savePreferences = useCallback(
    (next: PunksLocalPreferences) => {
      localStore?.savePreferences(next);
      setPreferences(next);
    },
    [localStore],
  );

  const switchAccount = useCallback(
    async (provider: AuthenticationMethod) => {
      const generation = bootstrapGeneration.current + 1;
      bootstrapGeneration.current = generation;
      navigationGeneration.current += 1;
      setState((current) => ({
        ...current,
        status: "loading",
        accountSessionState: null,
        session: null,
        workspaces: [],
        error: null,
      }));
      try {
        await scopeManager.invalidate();
        if (bootstrapGeneration.current !== generation) return;
        navigatePunks({ kind: "home" }, true);
        const phase = await client.startAccountSwitch(provider);
        if (bootstrapGeneration.current !== generation) return;
        setState({
          status: "switching_account",
          compatibility,
          accountSessionState: {
            state: "signed_out",
            authentication: phase,
            resumeAvailable: false,
          },
          session: null,
          workspaces: [],
          error: null,
        });
      } catch (error) {
        if (bootstrapGeneration.current !== generation) return;
        setState((current) => ({ ...current, status: "error", error }));
      }
    },
    [client, compatibility, scopeManager],
  );

  const logout = useCallback(async () => {
    bootstrapGeneration.current += 1;
    navigationGeneration.current += 1;
    setState((current) => ({
      ...current,
      status: "loading",
      accountSessionState: null,
      session: null,
      workspaces: [],
      error: null,
    }));
    try {
      await scopeManager.invalidate();
      navigatePunks({ kind: "home" }, true);
      await client.signOut();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        accountSessionState: null,
        session: null,
        workspaces: [],
        error,
      }));
      return;
    }
    setState((current) => ({
      ...current,
      status: "signed_out",
      accountSessionState: {
        state: "signed_out",
        authentication: { phase: "idle" },
        resumeAvailable: false,
      },
      session: null,
      workspaces: [],
      error: null,
    }));
  }, [client, scopeManager]);

  const navigate = useCallback(
    async (next: PunksRoute, replace = false): Promise<boolean> => {
      const generation = navigationGeneration.current + 1;
      navigationGeneration.current = generation;
      let url: string;
      try {
        url = canonicalPunksUrl(
          next,
          state.compatibility?.origin ?? window.location.origin,
        );
      } catch {
        return false;
      }
      const validateNavigation = client.validateNavigation;
      if (validateNavigation !== undefined) {
        try {
          await validateNavigation.call(client, url);
        } catch {
          return false;
        }
      }
      if (navigationGeneration.current !== generation) return false;
      navigatePunks(next, replace);
      return true;
    },
    [client, state.compatibility],
  );

  const value: PunksAccountRuntime = {
    client,
    status: state.status,
    compatibility: state.compatibility,
    accountSessionState: state.accountSessionState,
    session: state.session,
    workspaces: state.workspaces,
    route,
    navigate,
    localStore,
    scopeManager,
    switchAccount,
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
    let openedScope: PunksWorkspaceScope | null = null;
    setState({ phase: "opening" });
    void account.scopeManager
      .open(account.client, workspaceId)
      .then((scope) => {
        openedScope = scope;
        if (!current) {
          void account.scopeManager.close(scope).catch(() => undefined);
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
      if (openedScope === null) {
        void account.scopeManager.invalidate().catch(() => undefined);
      } else {
        void account.scopeManager.close(openedScope).catch(() => undefined);
      }
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
  const scopeManager = account.scopeManager;
  const route = account.route;
  const [resolvedWorkspace, setResolvedWorkspace] =
    useState<WorkspaceSummary | null>(null);
  const [routeResolutionPending, setRouteResolutionPending] = useState(false);
  const [restoredAccountScope, setRestoredAccountScope] =
    useState<PunksStorageScope | null>(null);

  const accountScope = useMemo<PunksStorageScope | null>(
    () =>
      account.compatibility === null || account.session === null
        ? null
        : {
            origin: account.compatibility.origin,
            punkId: account.session.punkId,
          },
    [account.compatibility, account.session],
  );
  const routeRestored = samePunksStorageScope(
    restoredAccountScope,
    accountScope,
  );

  useEffect(() => {
    if (
      accountScope === null ||
      routeRestored ||
      account.localStore === null ||
      route === null
    ) {
      return;
    }
    let active = true;
    const reconcileAndRestore = async () => {
      const lastWorkspaceId = account.localStore?.loadLastWorkspaceId();
      if (
        lastWorkspaceId !== null &&
        !account.workspaces.some(
          (workspace) => workspace.id === lastWorkspaceId,
        )
      ) {
        account.localStore?.clearLastWorkspaceId();
      }

      const saved = account.localStore?.loadRouteCoordinates() ?? {};
      const savedWorkspace =
        saved.workspaceId === undefined
          ? undefined
          : account.workspaces.find(
              (workspace) => workspace.id === saved.workspaceId,
            );
      if (saved.workspaceId !== undefined && savedWorkspace === undefined) {
        account.localStore?.clearRouteCoordinates();
      } else if (route.kind === "home" && savedWorkspace !== undefined) {
        const restored: PunksRoute =
          saved.conversationId === undefined
            ? { kind: "workspace", workspaceSlug: savedWorkspace.slug }
            : saved.messageId === undefined
              ? {
                  kind: "conversation",
                  workspaceSlug: savedWorkspace.slug,
                  conversationId: saved.conversationId,
                }
              : {
                  kind: "message",
                  workspaceSlug: savedWorkspace.slug,
                  conversationId: saved.conversationId,
                  messageId: saved.messageId,
                };
        await account.navigate(restored, true);
      }
      if (active) setRestoredAccountScope(accountScope);
    };
    void reconcileAndRestore();
    return () => {
      active = false;
    };
  }, [
    account.localStore,
    account.navigate,
    account.workspaces,
    accountScope,
    routeRestored,
    route,
  ]);

  const directWorkspace = route
    ? workspaceForRoute(route, account.workspaces)
    : null;
  const routeResolvedWorkspace =
    route !== null && resolvedWorkspace !== null && route.kind !== "home"
      ? resolvedWorkspace.slug === route.workspaceSlug
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
    void (async () => {
      await scopeManager.invalidate();
      if (!active) return;
      const workspace = await account.client.resolveWorkspace({
        kind: "slug",
        workspaceSlug: route.workspaceSlug,
      });
      if (!active) return;
      setRouteResolutionPending(false);
      if (workspace !== null) {
        setResolvedWorkspace(workspace);
        await account.navigate(
          routeWithWorkspaceSlug(route, workspace.slug),
          true,
        );
      }
    })().catch(() => {
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
    scopeManager,
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
    void account.navigate(
      routeWithWorkspaceSlug(route, directWorkspace.slug),
      true,
    );
  }, [account.navigate, directWorkspace, route]);

  useEffect(() => {
    if (
      route !== null &&
      account.localStore !== null &&
      routeRestored &&
      (route.kind === "home" || selectedWorkspace !== null)
    ) {
      account.localStore.saveRouteCoordinates(
        route.kind === "home"
          ? {}
          : {
              workspaceId: selectedWorkspace?.id,
              ...(route.kind === "conversation" || route.kind === "message"
                ? { conversationId: route.conversationId }
                : {}),
              ...(route.kind === "message"
                ? { messageId: route.messageId }
                : {}),
            },
      );
    }
  }, [account.localStore, routeRestored, route, selectedWorkspace]);

  if (route === null) return <PunksUnavailableScreen />;
  if (!routeRestored) {
    return <PunksCompatibilityGate message="Restoring Workspace…" />;
  }
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

/** Lazily loaded Account/Workspace client for the resolved product profile. */
export function TauriPunksRuntime({
  compatibility,
  route,
}: {
  compatibility: DesktopCompatibilityResponse;
  route: PunksRoute;
}) {
  const [client] = useState(createTauriPunksAccountClient);
  return (
    <PunksRuntime client={client} compatibility={compatibility} route={route} />
  );
}

function PunksAccountGate({ client }: { client: PunksAccountClient }) {
  const account = usePunksAccount();
  if (account.status === "loading") {
    return <PunksCompatibilityGate message="Checking Punks compatibility…" />;
  }
  if (account.status === "switching_account") {
    const accountState = account.accountSessionState;
    if (accountState === null || accountState.state !== "signed_out") {
      return <PunksCompatibilityGate />;
    }
    return (
      <PunksAccountSwitching
        accountState={accountState}
        client={client}
        onFinished={account.refresh}
      />
    );
  }
  if (account.status === "signed_out") {
    const accountState = account.accountSessionState;
    if (accountState === null || accountState.state !== "signed_out") {
      return <PunksCompatibilityGate />;
    }
    return (
      <PunksSignedOut
        accountState={accountState}
        client={client}
        onStarted={account.refresh}
      />
    );
  }
  if (account.status === "error") {
    return <PunksRuntimeError onRetry={account.refresh} />;
  }
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
