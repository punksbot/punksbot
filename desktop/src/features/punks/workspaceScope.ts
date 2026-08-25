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
  private latestOpenRequest = 0;
  private teardown: Promise<void> = Promise.resolve();
  private openQueue: Promise<void> = Promise.resolve();
  private failedTeardown: ActiveScope | null = null;

  private detachActive(): Promise<void> {
    const active = this.active ?? this.failedTeardown;
    this.active = null;
    this.failedTeardown = null;
    this.epoch += 1;
    if (active === null) return this.teardown;

    for (const controller of active.abortControllers) controller.abort();
    active.abortControllers.clear();
    active.localBodies.clear();

    const follows = [...active.follows];
    active.follows.clear();
    const previousTeardown = this.teardown.catch(() => undefined);
    const teardown = previousTeardown.then(async () => {
      const results = await Promise.allSettled([
        active.queryClient.cancelQueries(),
        ...follows.map((follow) => follow.close()),
        active.session.close(),
      ]);
      active.queryClient.clear();
      const criticalFailure = [results[0], results.at(-1)].find(
        (result) => result?.status === "rejected",
      );
      if (criticalFailure?.status === "rejected") {
        throw criticalFailure.reason;
      }
    });
    this.teardown = teardown;
    void teardown.then(
      () => {
        if (this.failedTeardown === active) this.failedTeardown = null;
      },
      () => {
        if (this.active === null) this.failedTeardown = active;
      },
    );
    return teardown;
  }

  /** Invalidates callbacks before closing any native or WebSocket resource. */
  async invalidate(): Promise<void> {
    this.latestOpenRequest += 1;
    const pendingOpen = this.openQueue;
    const teardown = this.detachActive();
    await Promise.all([pendingOpen, teardown]);
  }

  /** Opens a new generation only after the previous one is inert locally. */
  async open(
    account: PunksAccountClient,
    workspaceId: string,
  ): Promise<PunksWorkspaceScope> {
    const request = this.latestOpenRequest + 1;
    this.latestOpenRequest = request;
    const teardown = this.detachActive();
    const previousOpen = this.openQueue;
    const opening = (async () => {
      await Promise.all([previousOpen, teardown]);
      if (request !== this.latestOpenRequest) throw staleScope();

      const openingEpoch = this.epoch;
      const session = await account.openWorkspace(workspaceId);
      if (request !== this.latestOpenRequest || openingEpoch !== this.epoch) {
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
    })();
    this.openQueue = opening.then(
      () => undefined,
      () => undefined,
    );
    return opening;
  }

  /** Closes this scope only when it is still the mounted generation. */
  async close(scope: PunksWorkspaceScope): Promise<void> {
    if (!this.isCurrent(scope)) return;
    await this.invalidate();
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

  /**
   * Runs an operation that returns an owned resource. If the generation turns
   * stale while the resource is opening, ownership never escapes this method:
   * the resource is closed before the stale result is reported.
   */
  async runResource<T>(
    scope: PunksWorkspaceScope,
    operation: () => Promise<T>,
    close: (resource: T) => Promise<void>,
  ): Promise<T> {
    if (!this.isCurrent(scope)) throw staleScope();
    const resource = await operation();
    if (!this.isCurrent(scope)) {
      await close(resource);
      throw staleScope();
    }
    return resource;
  }

  registerFollow(scope: PunksWorkspaceScope, follow: PunksFollow): () => void {
    if (!this.isCurrent(scope)) {
      void follow.close().catch(() => undefined);
      return () => undefined;
    }
    const active = this.active;
    if (active === null) {
      void follow.close().catch(() => undefined);
      return () => undefined;
    }
    active.follows.add(follow);
    return () => {
      active.follows.delete(follow);
      void follow.close().catch(() => undefined);
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
