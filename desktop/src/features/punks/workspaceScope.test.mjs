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
