import assert from "node:assert/strict";
import test from "node:test";

import { PUNKS_STORAGE_KEYS, createPunksLocalStore } from "./storage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const workspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";

test("Punks persistence keeps preferences, last Workspace and route coordinates only", () => {
  const storage = memoryStorage();
  const local = createPunksLocalStore(storage);

  local.savePreferences({ theme: "dark", reducedMotion: true });
  local.saveLastWorkspaceId(workspaceId);
  local.saveRouteCoordinates({
    workspaceId,
    conversationId,
    messageId,
  });

  assert.deepEqual(local.loadPreferences(), {
    theme: "dark",
    reducedMotion: true,
  });
  assert.equal(local.loadLastWorkspaceId(), workspaceId);
  assert.deepEqual(local.loadRouteCoordinates(), {
    workspaceId,
    conversationId,
    messageId,
  });
  assert.deepEqual(
    [...storage.values.keys()].sort(),
    Object.values(PUNKS_STORAGE_KEYS).sort(),
  );
});

test("invalid or content-shaped values are ignored and never become Punks state", () => {
  const storage = memoryStorage();
  storage.setItem(
    PUNKS_STORAGE_KEYS.lastWorkspace,
    JSON.stringify("message body"),
  );
  storage.setItem(
    PUNKS_STORAGE_KEYS.route,
    JSON.stringify({ content: "secret", cursor: "mhc1.secret" }),
  );
  storage.setItem(
    PUNKS_STORAGE_KEYS.preferences,
    JSON.stringify({ session: "cookie", cache: ["message"], theme: "dark" }),
  );

  const local = createPunksLocalStore(storage);
  assert.equal(local.loadLastWorkspaceId(), null);
  assert.deepEqual(local.loadRouteCoordinates(), {});
  assert.deepEqual(local.loadPreferences(), { theme: "dark" });
});
