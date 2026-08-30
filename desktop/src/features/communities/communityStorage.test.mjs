import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCommunityStorage,
  initFirstCommunity,
  loadCommunities,
  loadCommunityDiscoveryAfterLeave,
  markCommunityDiscoveryAfterLeave,
  migrateLegacyCommunityStorage,
  saveCommunities,
  shouldAutoConnectDefaultRelay,
} from "./communityStorage.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("migrateLegacyCommunityStorage promotes current Punks workspace state", () => {
  const storage = createMemoryStorage({
    "punks-workspaces": '[{"id":"current"}]',
    "punks-active-workspace-id": "current",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("punks-communities"), '[{"id":"current"}]');
  assert.equal(storage.getItem("punks-active-community-id"), "current");
});

test("migrateLegacyCommunityStorage does not overwrite new community state", () => {
  const storage = createMemoryStorage({
    "punks-communities": '[{"id":"new"}]',
    "punks-active-community-id": "new",
    "punks-workspaces": '[{"id":"old"}]',
    "punks-active-workspace-id": "old",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("punks-communities"), '[{"id":"new"}]');
  assert.equal(storage.getItem("punks-active-community-id"), "new");
});

test("signed-build relay defaults auto-connect during first-run onboarding", () => {
  assert.equal(
    shouldAutoConnectDefaultRelay("wss://punks.block.builderlab.xyz"),
    true,
  );
  assert.equal(shouldAutoConnectDefaultRelay("ws://localhost:3000"), false);
  assert.equal(shouldAutoConnectDefaultRelay("ws://127.0.0.1:3000"), false);
  assert.equal(shouldAutoConnectDefaultRelay("ws://[::1]:3000"), false);
  assert.equal(shouldAutoConnectDefaultRelay("ws://0.0.0.0:3000"), false);
  assert.equal(shouldAutoConnectDefaultRelay("http://localhost:3000"), false);
  assert.equal(
    shouldAutoConnectDefaultRelay("https://relay.example.com"),
    false,
  );
  assert.equal(shouldAutoConnectDefaultRelay("relay.example.com"), false);
  assert.equal(shouldAutoConnectDefaultRelay("not a valid relay"), false);
});

test("failed first-community write preserves existing community data", () => {
  const storage = createMemoryStorage({
    "punks-communities": '[{"id":"existing"}]',
    "punks-workspaces": '[{"id":"legacy"}]',
    "punks-active-workspace-id": "legacy",
  });
  storage.setItem = (key, value) => {
    if (key === "punks-communities") {
      throw new Error("QuotaExceededError");
    }
    storage.values.set(key, String(value));
  };
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };

  assert.equal(initFirstCommunity("wss://relay.example.com", "pubkey"), null);
  assert.equal(storage.getItem("punks-communities"), '[{"id":"existing"}]');
  assert.equal(storage.getItem("punks-active-community-id"), null);
  assert.equal(storage.getItem("punks-workspaces"), '[{"id":"legacy"}]');
  assert.equal(storage.getItem("punks-active-workspace-id"), "legacy");
});

test("loading an existing community clears stale final-leave discovery", () => {
  const storage = createMemoryStorage({
    "punks-communities": '[{"id":"joined"}]',
    "punks-community-discovery-after-leave": "1",
  });
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };

  assert.deepEqual(loadCommunities(), [{ id: "joined" }]);
  assert.equal(loadCommunityDiscoveryAfterLeave(storage), false);
});

test("Workspace subdomains remain local instead of being classified as hosted", () => {
  assert.equal(
    shouldAutoConnectDefaultRelay(
      "ws://9f601569-d786-4e2f-bfc1-b9411f5bb399.localhost:18787",
    ),
    false,
  );
});

test("completed final leave persists discovery until a community is saved", () => {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };

  assert.equal(markCommunityDiscoveryAfterLeave(storage), true);
  assert.equal(loadCommunityDiscoveryAfterLeave(storage), true);

  assert.equal(saveCommunities([{ id: "joined" }]), true);
  assert.equal(loadCommunityDiscoveryAfterLeave(storage), false);
});

test("clearCommunityStorage preserves completed final-leave discovery", () => {
  const storage = createMemoryStorage({
    "punks-communities": "new",
    "punks-active-community-id": "new",
    "punks-workspaces": "old",
    "punks-active-workspace-id": "old",
    "punks-community-discovery-after-leave": "1",
  });

  clearCommunityStorage(storage);
  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.length, 1);
  assert.equal(loadCommunityDiscoveryAfterLeave(storage), true);
});
