import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  nativeScreenReaderInvocation,
  withNativeScreenReader,
} from "./native-screen-reader.mjs";

test("uses the reviewed native command line for every platform", () => {
  assert.deepEqual(
    nativeScreenReaderInvocation({
      platform: "windows-x64",
      binary: "C:\\nvda\\nvda.exe",
      log: "C:\\evidence\\screen-reader.log",
    }),
    {
      technology: "NVDA",
      command: "C:\\nvda\\nvda.exe",
      args: [
        "--minimal",
        "--disable-addons",
        "--debug-logging",
        "--log-file=C:\\evidence\\screen-reader.log",
      ],
    },
  );
  assert.deepEqual(
    nativeScreenReaderInvocation({
      platform: "linux-x64",
      binary: "/usr/bin/orca",
      log: "/evidence/screen-reader.log",
    }),
    {
      technology: "Orca",
      command: "/usr/bin/orca",
      args: [
        "--replace",
        "--enable=speech",
        "--debug",
        "--debug-file=/evidence/screen-reader.log",
      ],
    },
  );
  assert.deepEqual(
    nativeScreenReaderInvocation({
      platform: "macos-arm64",
      binary:
        "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOver",
      log: "/evidence/screen-reader.log",
    }),
    {
      technology: "VoiceOver",
      command:
        "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOver",
      args: [],
    },
  );
});

test("keeps the native reader alive around the installed action and validates its raw log", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-screen-reader-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, "screen-reader.log");
  const events = [];

  const result = await withNativeScreenReader(
    {
      platform: "linux-x64",
      binary: "/usr/bin/orca",
      log,
      applicationTokens: ["Punks Bot Staging", "punks-bot-staging"],
    },
    async () => {
      events.push("action");
      return "installed result";
    },
    {
      controller: {
        async start({ invocation, log: selectedLog }) {
          events.push(`start:${invocation.technology}`);
          assert.equal(selectedLog, log);
          return {
            async stop() {
              events.push("stop");
              writeFileSync(
                log,
                "ORCA DEBUG focus event application=Punks Bot Staging role=web-view\n",
                { flag: "wx" },
              );
            },
          };
        },
      },
    },
  );

  assert.equal(result.value, "installed result");
  assert.equal(result.technology, "Orca");
  assert.deepEqual(events, ["start:Orca", "action", "stop"]);
  assert.match(result.observation, /Punks Bot Staging/u);
});

test("rejects a pre-existing or unrelated screen-reader log", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-screen-reader-reject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const existing = join(root, "existing.log");
  writeFileSync(existing, "old evidence\n");
  const input = {
    platform: "linux-x64",
    binary: "/usr/bin/orca",
    log: existing,
    applicationTokens: ["Punks Bot Staging"],
  };
  await assert.rejects(
    withNativeScreenReader(input, async () => undefined, {
      controller: {
        async start() {
          throw new Error("must not start");
        },
      },
    }),
    /already exists/i,
  );

  const unrelated = join(root, "unrelated.log");
  await assert.rejects(
    withNativeScreenReader(
      { ...input, log: unrelated },
      async () => undefined,
      {
        controller: {
          async start() {
            return {
              async stop() {
                writeFileSync(
                  unrelated,
                  "screen reader started and stopped\n",
                  {
                    flag: "wx",
                  },
                );
              },
            };
          },
        },
      },
    ),
    /did not observe the installed application/i,
  );
});
