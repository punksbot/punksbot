import { QueryClient } from "@tanstack/react-query";

import {
  PunksDesktopFailure,
  type PunksAccountClient,
  type PunksFollow,
  type PunksWorkspaceSession,
  type WorkspaceLease,
} from "@/shared/api/punksClient";

export type PunksWorkspaceScope = {
  readonly lease: WorkspaceLease;
  readonly session: PunksWorkspaceSession;
  readonly queryClient: QueryClient;
  readonly epoch: number;
};

type ActiveScope = PunksWorkspaceScope & {
  follows: Set<PunksFollow>;
  abortControllers: Set<AbortController>;
  localBodies: Set<string>;
};

function staleScope(): PunksDesktopFailure {
  return new PunksDesktopFailure(
    "stale_workspace",
    "WorkspaceSession lease is no longer current",
  );
}

function createPunksQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        networkMode: "always",
        gcTime: 0,
      },
      mutations: {
        retry: false,
        networkMode: "always",
      },
    },
  });
}

/** Owns exactly one WorkspaceSession and all of its volatile work. */
export class PunksWorkspaceScopeManager {
  private epoch = 0;
  private active: ActiveScope | null = null;

  /** Invalidates callbacks before closing any native or WebSocket resource. */
  async invalidate(): Promise<void> {
    const active = this.active;
    this.active = null;
    this.epoch += 1;
    if (active === null) return;

    for (const controller of active.abortControllers) controller.abort();
    active.abortControllers.clear();
    active.localBodies.clear();
    await active.queryClient.cancelQueries();
    active.queryClient.clear();

    const follows = [...active.follows];
    active.follows.clear();
    await Promise.allSettled(follows.map((follow) => follow.close()));
    await Promise.allSettled([active.session.close()]);
  }

  /** Opens a new generation only after the previous one is inert locally. */
  async open(
    account: PunksAccountClient,
    workspaceId: string,
  ): Promise<PunksWorkspaceScope> {
    await this.invalidate();
    const openingEpoch = this.epoch;
    const session = await account.openWorkspace(workspaceId);
    if (openingEpoch !== this.epoch) {
      await session.close().catch(() => undefined);
      throw staleScope();
    }

    const scope: ActiveScope = {
      lease: session.lease,
      session,
      queryClient: createPunksQueryClient(),
      epoch: openingEpoch,
      follows: new Set(),
      abortControllers: new Set(),
      localBodies: new Set(),
    };
    this.active = scope;
    return scope;
  }

  isCurrent(scope: PunksWorkspaceScope): boolean {
    return this.active === scope && this.epoch === scope.epoch;
  }

  async run<T>(
    scope: PunksWorkspaceScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.isCurrent(scope)) throw staleScope();
    const result = await operation();
    if (!this.isCurrent(scope)) throw staleScope();
    return result;
  }

  registerFollow(scope: PunksWorkspaceScope, follow: PunksFollow): () => void {
    if (!this.isCurrent(scope)) {
      void follow.close();
      return () => undefined;
    }
    const active = this.active;
    if (active === null) {
      void follow.close();
      return () => undefined;
    }
    active.follows.add(follow);
    return () => {
      active.follows.delete(follow);
      void follow.close();
    };
  }

  registerAbortController(
    scope: PunksWorkspaceScope,
    controller: AbortController,
  ): () => void {
    if (!this.isCurrent(scope)) {
      controller.abort();
      return () => undefined;
    }
    const active = this.active;
    if (active === null) {
      controller.abort();
      return () => undefined;
    }
    active.abortControllers.add(controller);
    return () => active.abortControllers.delete(controller);
  }

  registerLocalBody(scope: PunksWorkspaceScope, bodyId: string): () => void {
    const active = this.active;
    if (!this.isCurrent(scope) || active === null) return () => undefined;
    active.localBodies.add(bodyId);
    return () => active.localBodies.delete(bodyId);
  }
}
