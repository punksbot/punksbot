import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { reviewInstalledAccessibility } from "./platform-installed-accessibility-review.mjs";

test("reviews the same installed artifact in a second native process", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-independent-a11y-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputs = {
    platformLog: join(root, "review.log"),
    screenReaderLog: join(root, "reader.log"),
    ipc: join(root, "ipc.jsonl"),
    network: join(root, "network.jsonl"),
    embeddedAssets: join(root, "assets.json"),
  };
  const calls = [];
  const result = await reviewInstalledAccessibility(
    {
      platform: "linux-x64",
      artifactSha256: "ab".repeat(32),
      nativeBinary: "/installed/punks-bot-staging",
      screenReaderBinary: "/usr/bin/orca",
      outputs,
    },
    {
      async withScreenReader(input, action) {
        calls.push("screen-reader-start");
        writeFileSync(input.log, "Orca reviewed the second process\n", {
          flag: "wx",
        });
        const value = await action();
        calls.push("screen-reader-stop");
        return { value, technology: "Orca" };
      },
      async browserFactory(input) {
        calls.push("second-browser-start");
        writeFileSync(input.outputs.platformLog, "second tauri-driver\n", {
          flag: "wx",
        });
        writeFileSync(input.outputs.ipc, "second process ipc\n", {
          flag: "wx",
        });
        writeFileSync(input.outputs.network, "second process network\n", {
          flag: "wx",
        });
        writeFileSync(input.outputs.embeddedAssets, "second process assets\n", {
          flag: "wx",
        });
        return {
          async waitVisible() {
            calls.push("second-ui-visible");
          },
          async auditAccessibility() {
            calls.push("second-interaction-pass");
            return Object.fromEntries(
              MATRICE_ACCESSIBILITE.map((criterion) => [
                criterion,
                {
                  automated: [
                    {
                      tool: "second-driver-audit",
                      exitCode: 0,
                      observation: `${criterion} independently observed`,
                    },
                  ],
                },
              ]),
            );
          },
          async close() {
            calls.push("second-browser-stop");
          },
        };
      },
    },
  );
  assert.deepEqual(calls, [
    "screen-reader-start",
    "second-browser-start",
    "second-ui-visible",
    "second-interaction-pass",
    "second-browser-stop",
    "screen-reader-stop",
  ]);
  assert.deepEqual(Object.keys(result), [...MATRICE_ACCESSIBILITE]);
  for (const record of Object.values(result)) {
    assert.equal(record.reviewer, "independent-platform-review-process");
    assert.match(record.observation, /native-screen-reader=Orca/);
  }
});
