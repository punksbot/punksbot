import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildNativeProof, writeNativeProof } from "./native-proof.mjs";

function argumentsMap(values) {
  return new Map(Object.entries(values));
}

test("native proof accepts only complete OS-specific verification evidence", () => {
  const mac = buildNativeProof(
    argumentsMap({
      platform: "macos-arm64",
      identity: "Developer ID Application: Punks Bot (ABCDEFGHIJ)",
      timestamped: "true",
      notarized: "true",
      "team-id": "ABCDEFGHIJ",
    }),
  );
  assert.equal(mac.notarized, true);
  assert.equal(mac.teamId, "ABCDEFGHIJ");

  const windows = buildNativeProof(
    argumentsMap({
      platform: "windows-x64",
      identity: "CN=Punks Bot",
      timestamped: "true",
      thumbprint: "A".repeat(40),
    }),
  );
  assert.equal(windows.thumbprint, "A".repeat(40));

  const linux = buildNativeProof(
    argumentsMap({
      platform: "linux-x64",
      identity: "679E2A9FF88BDB4E33E2CACFD9C8C48D021DCFDB",
      timestamped: "false",
      "embedded-appimage-signature": "true",
      "detached-deb-signature": "true",
    }),
  );
  assert.equal(linux.embeddedAppImageSignature, true);
  assert.equal(linux.detachedDebSignature, true);
});

test("native proof fails closed when an OS-specific guarantee is missing", () => {
  assert.throws(
    () =>
      buildNativeProof(
        argumentsMap({
          platform: "macos-x64",
          identity: "Developer ID Application: Punks Bot (ABCDEFGHIJ)",
          timestamped: "true",
          notarized: "false",
          "team-id": "ABCDEFGHIJ",
        }),
      ),
    /notarization/,
  );
  assert.throws(
    () =>
      buildNativeProof(
        argumentsMap({
          platform: "windows-x64",
          identity: "CN=Punks Bot",
          timestamped: "false",
          thumbprint: "A".repeat(40),
        }),
      ),
    /timestamped/,
  );
  assert.throws(
    () =>
      buildNativeProof(
        argumentsMap({
          platform: "linux-x64",
          identity: "679E2A9FF88BDB4E33E2CACFD9C8C48D021DCFDB",
          timestamped: "false",
          "embedded-appimage-signature": "true",
          "detached-deb-signature": "false",
        }),
      ),
    /Linux proof/,
  );
});

test("native proof output is create-only", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "punks-native-proof-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const output = join(directory, "proof.json");
  const argv = [
    "--platform",
    "windows-x64",
    "--identity",
    "CN=Punks Bot",
    "--thumbprint",
    "A".repeat(40),
    "--timestamped",
    "true",
    "--output",
    output,
  ];

  writeNativeProof(argv);
  assert.equal(JSON.parse(readFileSync(output, "utf8")).verified, true);
  assert.throws(() => writeNativeProof(argv), /already exists/);

  const preexisting = join(directory, "preexisting.json");
  writeFileSync(preexisting, "do not replace\n");
  assert.throws(
    () => writeNativeProof([...argv.slice(0, -1), preexisting]),
    /already exists/,
  );
  assert.equal(readFileSync(preexisting, "utf8"), "do not replace\n");
});
