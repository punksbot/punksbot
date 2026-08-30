import assert from "node:assert/strict";
import test from "node:test";

import { switchLocalAccountWithRelaunch } from "./localAccountSwitch.ts";

test("account switching commits before closing the menu and relaunching Tauri", async () => {
  const calls = [];
  const result = await switchLocalAccountWithRelaunch(
    { accountId: "second", expectedGeneration: 4 },
    {
      close: () => calls.push("close"),
      relaunch: async () => calls.push("relaunch"),
      switchAccount: async (accountId, expectedGeneration) => {
        calls.push(`switch:${accountId}:${expectedGeneration}`);
        return { id: accountId, generation: expectedGeneration + 1 };
      },
    },
  );

  assert.deepEqual(calls, ["switch:second:4", "close", "relaunch"]);
  assert.deepEqual(result, { id: "second", generation: 5 });
});

test("a refused account switch never closes or relaunches", async () => {
  const calls = [];
  await assert.rejects(
    switchLocalAccountWithRelaunch(
      { accountId: "missing", expectedGeneration: 4 },
      {
        close: () => calls.push("close"),
        relaunch: async () => calls.push("relaunch"),
        switchAccount: async () => {
          throw new Error("conflict");
        },
      },
    ),
    /conflict/,
  );
  assert.deepEqual(calls, []);
});
