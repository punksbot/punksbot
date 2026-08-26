import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTHENTICATION_SCENARIO_OUTCOMES,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
} from "../promotion-installed-transcript-lib.mjs";
import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import {
  authenticationFromIpc,
  exerciseInstalledPlatform,
  followScenariosFromIpc,
  traceFromIpc,
} from "./platform-installed-automation.mjs";

test("accepts authentication only from the installed native matrix and active OS Session", (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-auth-conformance-ipc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "ipc.jsonl");
  const punkId = "80000000-0000-8000-8000-000000000058";
  const scenarios = Object.fromEntries(
    Object.entries(AUTHENTICATION_SCENARIO_OUTCOMES).map(([id, outcome]) => [
      id,
      { outcome, observations: [`compiled ceremony: ${id}`] },
    ]),
  );
  writeFileSync(
    path,
    [
      {
        sequence: 1,
        command: "punks_promotion_auth_conformance",
        status: "ok",
        coordinates: { scenarios },
      },
      {
        sequence: 2,
        command: "punks_get_account_session_state",
        status: "ok",
        coordinates: { state: "authenticated", punkId },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  assert.deepEqual(authenticationFromIpc(path, { punkId }), {
    complete: true,
    punkId,
    scenarios,
  });
  assert.throws(
    () =>
      authenticationFromIpc(path, {
        punkId: "90000000-0000-8000-8000-000000000058",
      }),
    /Session belongs to another Punk/i,
  );
});

test("reads FOLLOW adversarial outcomes only from the installed native journal", (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-follow-conformance-ipc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "ipc.jsonl");
  const operationId = "11111111-1111-4111-8111-111111111111";
  const scenarios = Object.fromEntries(
    Object.entries(FOLLOW_SCENARIO_OUTCOMES).map(([id, outcome]) => [
      id,
      { outcome, observations: [`embedded corpus: ${id}`] },
    ]),
  );
  writeFileSync(
    path,
    `${JSON.stringify({
      sequence: 1,
      command: "punks_follow_conversation",
      status: "ok",
      coordinates: { operationId, afterCursor: 0 },
    })}\n${JSON.stringify({
      sequence: 2,
      command: "punks_promotion_live_follow_conformance",
      status: "ok",
      coordinates: { operationId, scenarios },
    })}\n`,
  );
  assert.deepEqual(followScenariosFromIpc(path), scenarios);

  delete scenarios.terminal;
  writeFileSync(
    path,
    `${JSON.stringify({
      sequence: 1,
      command: "punks_follow_conversation",
      status: "ok",
      coordinates: { operationId, afterCursor: 0 },
    })}\n${JSON.stringify({
      sequence: 2,
      command: "punks_promotion_live_follow_conformance",
      status: "ok",
      coordinates: { operationId, scenarios },
    })}\n`,
  );
  assert.throws(() => followScenariosFromIpc(path), /scenario set/i);
});

test("preserves a real live-then-change IPC order in the installed trace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-follow-ipc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "ipc.jsonl");
  const records = [
    {
      sequence: 1,
      command: "punks_follow_conversation",
      status: "ok",
      coordinates: { operationId: "follow-1", afterCursor: 52 },
    },
    {
      sequence: 2,
      command: "punks_follow_next",
      status: "ok",
      coordinates: { operationId: "follow-1", kind: "became_live" },
    },
    {
      sequence: 3,
      command: "punks_follow_next",
      status: "ok",
      coordinates: {
        operationId: "follow-1",
        kind: "apply_batch",
        fromExclusiveCursor: 52,
        throughCursor: 53,
      },
    },
    {
      sequence: 4,
      command: "punks_confirm_follow_batch",
      status: "ok",
      coordinates: { operationId: "follow-1", throughCursor: 53 },
    },
    {
      sequence: 5,
      command: "punks_close_follow",
      status: "ok",
      coordinates: { operationId: "follow-1" },
    },
  ];
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );

  assert.deepEqual(
    traceFromIpc(path).map(({ state }) => state),
    [
      "accepted",
      "ready",
      "live",
      "changes",
      "renderer-confirmed",
      "ack",
      "terminal",
    ],
  );
});

test("rejects a FOLLOW trace assembled from different native operations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-follow-mixed-ipc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "ipc.jsonl");
  const records = [
    {
      sequence: 1,
      command: "punks_follow_conversation",
      status: "ok",
      coordinates: { operationId: "follow-1", afterCursor: 52 },
    },
    {
      sequence: 2,
      command: "punks_follow_next",
      status: "ok",
      coordinates: { operationId: "follow-2", kind: "became_live" },
    },
    {
      sequence: 3,
      command: "punks_follow_next",
      status: "ok",
      coordinates: {
        operationId: "follow-2",
        kind: "apply_batch",
        fromExclusiveCursor: 52,
        throughCursor: 53,
      },
    },
    {
      sequence: 4,
      command: "punks_confirm_follow_batch",
      status: "ok",
      coordinates: { operationId: "follow-2", throughCursor: 53 },
    },
    {
      sequence: 5,
      command: "punks_close_follow",
      status: "ok",
      coordinates: { operationId: "follow-2" },
    },
  ];
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  assert.throws(() => traceFromIpc(path), /same native FOLLOW operation/i);
});

test("drives every social-loop story through one installed browser session", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-browser-driver-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const browser = {
    async exerciseAuthenticationCeremonies() {
      calls.push(["authentication-ceremonies"]);
      return { complete: true };
    },
    async waitVisible(selector) {
      calls.push(["visible", selector]);
    },
    async click(selector) {
      calls.push(["click", selector]);
    },
    async replace(selector, value) {
      calls.push(["replace", selector, value]);
    },
    async messageIdForText(value) {
      calls.push(["message", value]);
      return value.includes("Reply")
        ? "66666666-6666-4666-8666-666666666666"
        : "55555555-5555-4555-8555-555555555555";
    },
    async screenshot(story) {
      calls.push(["screenshot", story]);
      return Buffer.from(`png:${story}`);
    },
    async auditAccessibility() {
      calls.push(["accessibility"]);
      return Object.fromEntries(
        MATRICE_ACCESSIBILITE.map((criterion) => [
          criterion,
          {
            automated: [
              {
                tool: "axe-core",
                exitCode: 0,
                observation: `${criterion} automated`,
              },
            ],
          },
        ]),
      );
    },
    async exerciseFollowScenarios() {
      calls.push(["follow-scenarios"]);
      return Object.fromEntries(
        Object.entries(FOLLOW_SCENARIO_OUTCOMES).map(([id, outcome]) => [
          id,
          { outcome, observations: [`${id} observed in installed WebView`] },
        ]),
      );
    },
    async exerciseFaultMatrix() {
      calls.push(["fault-matrix"]);
      return { scenarios: [] };
    },
    async followTrace() {
      return [
        { state: "accepted", cursor: "cursor-52" },
        {
          state: "changes",
          previousCursor: "cursor-52",
          cursor: "cursor-53",
          batchId: "batch-53",
          atomic: true,
        },
        { state: "renderer-confirmed", cursor: "cursor-53" },
        { state: "ack", cursor: "cursor-53" },
        { state: "ready", cursor: "cursor-53" },
        { state: "live", cursor: "cursor-53" },
        { state: "terminal", cursor: "cursor-53" },
      ];
    },
    async close() {
      calls.push(["browser-close"]);
    },
  };

  const outputs = {
    screenReaderLog: join(root, "screen-reader.log"),
  };
  const result = await exerciseInstalledPlatform(
    {
      platform: "linux-x64",
      nativeBinary: "/opt/punks/punks-bot-staging",
      screenReaderBinary: "/usr/bin/orca",
      outputs,
      fixture: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        sessionRevocationId: "77777777-7777-4777-8777-777777777777",
        punkId: "55555555-5555-4555-8555-555555555555",
        workspaceId: "66666666-6666-4666-8666-666666666666",
        workspaceSlug: "promotion-fixture",
        conversationId: "22222222-2222-4222-8222-222222222222",
        seedMessageIds: [
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
        ],
      },
    },
    {
      async withScreenReader(input, action) {
        calls.push(["screen-reader-start", input.binary]);
        const value = await action();
        writeFileSync(
          input.log,
          "ORCA DEBUG application=Punks Bot Staging role=web-view\n",
          { flag: "wx" },
        );
        calls.push(["screen-reader-stop"]);
        return {
          value,
          technology: "Orca",
          observation: "application=Punks Bot Staging role=web-view",
        };
      },
      async browserFactory() {
        return browser;
      },
    },
  );

  assert.deepEqual(
    result.ui.map(({ story }) => story),
    REQUIRED_STORIES,
  );
  assert.deepEqual(
    Object.keys(result.screenshots).sort(),
    [...REQUIRED_STORIES].sort(),
  );
  assert.equal(result.installed.bundleId, "bot.punks.desktop.staging");
  assert.equal("manual" in result.accessibility["lecteur-ecran"], false);
  assert.equal(result.accessibility["lecteur-ecran"].technology, "Orca");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.follow.scenarios).map(([id, value]) => [
        id,
        value.outcome,
      ]),
    ),
    FOLLOW_SCENARIO_OUTCOMES,
  );
  assert.ok(
    calls.some(
      (entry) =>
        entry[0] === "click" &&
        entry[1] ===
          '[data-testid="punks-reaction-55555555-5555-4555-8555-555555555555-thumbs-up"]',
    ),
  );
  assert.ok(
    calls.some(
      (entry) =>
        entry[0] === "click" &&
        entry[1] ===
          '[data-testid="punks-thread-44444444-4444-4444-8444-444444444444"]',
    ),
  );
  assert.equal(calls[0][0], "screen-reader-start");
  assert.ok(calls.some(([kind]) => kind === "authentication-ceremonies"));
  assert.ok(calls.some(([kind]) => kind === "fault-matrix"));
  assert.equal(calls.at(-1)[0], "screen-reader-stop");
});
