import assert from "node:assert/strict";
import test from "node:test";

import { PunksWorkspaceScopeManager } from "./workspaceScope.ts";

const origin = "https://staging.punks.bot";
const punkId = "11111111-1111-4111-8111-111111111111";
const firstWorkspaceId = "22222222-2222-4222-8222-222222222222";
const secondWorkspaceId = "55555555-5555-4555-8555-555555555555";

function accountFixture() {
  let generation = 0;
  const sessions = [];
  return {
    sessions,
    async openWorkspace(workspaceId) {
      generation += 1;
      const lease = {
        origin,
        punkId,
        workspaceId,
        generation,
      };
      const session = {
        lease,
        closed: false,
        async close() {
          session.closed = true;
        },
      };
      sessions.push(session);
      return session;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("switching Workspace invalidates callbacks, closes FOLLOW and clears the scoped QueryClient", async () => {
  const account = accountFixture();
  const manager = new PunksWorkspaceScopeManager();
  const first = await manager.open(account, firstWorkspaceId);
  const controller = new AbortController();
  manager.registerAbortController(first, controller);
  manager.registerLocalBody(first, "composer-draft");
  first.queryClient.setQueryData(["messages"], [{ content: "volatile" }]);

  let followClosed = false;
  manager.registerFollow(first, {
    async nextDelivery() {
      return { kind: "became_live" };
    },
    async confirmBatch() {},
    async close() {
      followClosed = true;
    },
  });

  const second = await manager.open(account, secondWorkspaceId);

  assert.equal(controller.signal.aborted, true);
  assert.equal(followClosed, true);
  assert.equal(first.queryClient.getQueryData(["messages"]), undefined);
  assert.equal(account.sessions[0].closed, true);
  assert.equal(manager.isCurrent(first), false);
  assert.equal(manager.isCurrent(second), true);
  await assert.rejects(
    manager.run(first, async () => "must not publish"),
    { kind: "stale_workspace" },
  );
});

test("a close invalidates the generation before native cleanup resolves", async () => {
  const account = accountFixture();
  const manager = new PunksWorkspaceScopeManager();
  const scope = await manager.open(account, firstWorkspaceId);
  const pending = manager.invalidate();

  assert.equal(manager.isCurrent(scope), false);
  await pending;
  assert.equal(account.sessions[0].closed, true);
});

test("a new Workspace waits for the previous teardown before starting native I/O", async () => {
  const teardown = deferred();
  const openedWorkspaceIds = [];
  let generation = 0;
  const account = {
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      generation += 1;
      return {
        lease: {
          origin,
          punkId,
          workspaceId,
          generation,
        },
        async close() {
          if (workspaceId === firstWorkspaceId) await teardown.promise;
        },
      };
    },
  };
  const manager = new PunksWorkspaceScopeManager();
  await manager.open(account, firstWorkspaceId);

  const invalidation = manager.invalidate();
  const opening = manager.open(account, secondWorkspaceId);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(openedWorkspaceIds, [firstWorkspaceId]);
  teardown.resolve();
  await invalidation;
  const second = await opening;
  assert.deepEqual(openedWorkspaceIds, [firstWorkspaceId, secondWorkspaceId]);
  assert.equal(manager.isCurrent(second), true);
});

test("a superseded Workspace opening cannot replace the latest request", async () => {
  const firstOpening = deferred();
  const openedWorkspaceIds = [];
  let generation = 0;
  const account = {
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      if (workspaceId === firstWorkspaceId) await firstOpening.promise;
      generation += 1;
      const session = {
        lease: {
          origin,
          punkId,
          workspaceId,
          generation,
        },
        closed: false,
        async close() {
          session.closed = true;
        },
      };
      return session;
    },
  };
  const manager = new PunksWorkspaceScopeManager();
  const first = manager.open(account, firstWorkspaceId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = manager.open(account, secondWorkspaceId);
  firstOpening.resolve();

  await assert.rejects(first, { kind: "stale_workspace" });
  const current = await second;
  assert.deepEqual(openedWorkspaceIds, [firstWorkspaceId, secondWorkspaceId]);
  assert.equal(current.lease.workspaceId, secondWorkspaceId);
  assert.equal(manager.isCurrent(current), true);
});

test("a rejected native close blocks the next Workspace I/O", async () => {
  const openedWorkspaceIds = [];
  let generation = 0;
  const account = {
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      generation += 1;
      return {
        lease: { origin, punkId, workspaceId, generation },
        async close() {
          if (workspaceId === firstWorkspaceId) {
            throw new Error("native Workspace close failed");
          }
        },
      };
    },
  };
  const manager = new PunksWorkspaceScopeManager();
  await manager.open(account, firstWorkspaceId);

  await assert.rejects(manager.open(account, secondWorkspaceId), {
    message: "native Workspace close failed",
  });
  assert.deepEqual(openedWorkspaceIds, [firstWorkspaceId]);
});

test("a cleanup-caught close failure is retried before remount I/O", async () => {
  const openedWorkspaceIds = [];
  let generation = 0;
  let closeAttempts = 0;
  const account = {
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      generation += 1;
      return {
        lease: { origin, punkId, workspaceId, generation },
        async close() {
          closeAttempts += 1;
          throw new Error("persistent native close failure");
        },
      };
    },
  };
  const manager = new PunksWorkspaceScopeManager();
  const first = await manager.open(account, firstWorkspaceId);
  await manager.close(first).catch(() => undefined);

  await assert.rejects(manager.open(account, secondWorkspaceId), {
    message: "persistent native close failure",
  });
  assert.equal(closeAttempts, 2);
  assert.deepEqual(openedWorkspaceIds, [firstWorkspaceId]);
});
