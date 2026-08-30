import assert from "node:assert/strict";
import test from "node:test";

import { migratePunksStorage } from "./punksStorageMigration.ts";

function memoryStorage(entries) {
  const values = new Map(entries);
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test("migratePunksStorage preserves prior product state without overwriting Punks state", () => {
  const previous = ["bu", "zz"].join("");
  const storage = memoryStorage([
    [`${previous}:lastReminderCheck:alice`, "42"],
    [`${previous}-communities`, "old"],
    ["punks-communities", "current"],
    ["unrelated", "keep"],
  ]);
  migratePunksStorage(storage);
  assert.equal(storage.getItem("punks:lastReminderCheck:alice"), "42");
  assert.equal(storage.getItem("punks-communities"), "current");
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(storage.getItem(`${previous}:lastReminderCheck:alice`), null);
  assert.equal(storage.getItem(`${previous}-communities`), null);
});
