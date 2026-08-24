import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FORBIDDEN_PUNKS_NATIVE_MARKERS,
  verifyPunksNativeArtifact,
} from "./punks-native-artifact.mjs";

function fixture(t, name, contents) {
  const directory = mkdtempSync(join(tmpdir(), "punks-native-artifact-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

test("accepts a neutral real native artifact and returns its digest", (t) => {
  const path = fixture(t, "punks-bot-staging", Buffer.from([0, 1, 2, 3]));
  const proof = verifyPunksNativeArtifact(path);
  assert.equal(proof.name, "punks-bot-staging");
  assert.equal(proof.size, 4);
  assert.match(proof.sha256, /^[0-9a-f]{64}$/);
});

test("rejects every forbidden marker in ASCII native content", (t) => {
  for (const marker of FORBIDDEN_PUNKS_NATIVE_MARKERS) {
    const path = fixture(t, `native-${marker}`, "neutral");
    assert.throws(
      () => verifyPunksNativeArtifact(path),
      /filename contains forbidden marker/,
    );

    const contentPath = fixture(t, "punks-bot-staging", `prefix-${marker}-suffix`);
    assert.throws(
      () => verifyPunksNativeArtifact(contentPath),
      /contains forbidden marker/,
    );
  }
});

test("rejects UTF-16LE and UTF-16BE forbidden markers", (t) => {
  const littleEndian = fixture(
    t,
    "punks-bot-staging",
    Buffer.from("neutral-NOSTR", "utf16le"),
  );
  assert.throws(
    () => verifyPunksNativeArtifact(littleEndian),
    /forbidden marker nostr/,
  );

  const utf16le = Buffer.from("neutral-RELAY", "utf16le");
  const bigEndian = Buffer.allocUnsafe(utf16le.length);
  for (let index = 0; index < utf16le.length; index += 2) {
    bigEndian[index] = utf16le[index + 1];
    bigEndian[index + 1] = utf16le[index];
  }
  const bigEndianPath = fixture(t, "punks-bot-staging", bigEndian);
  assert.throws(
    () => verifyPunksNativeArtifact(bigEndianPath),
    /forbidden marker relay/,
  );

  const oddOffsetPath = fixture(
    t,
    "punks-bot-staging",
    Buffer.concat([Buffer.from([0xff]), Buffer.from("prefix-HUDDLE", "utf16le")]),
  );
  assert.throws(
    () => verifyPunksNativeArtifact(oddOffsetPath),
    /forbidden marker huddle/,
  );
});

test("rejects a symbolic-link artifact", (t) => {
  const target = fixture(t, "punks-bot-staging", "neutral");
  const link = `${target}-link`;
  symlinkSync(target, link);
  assert.throws(
    () => verifyPunksNativeArtifact(link),
    /must be one real regular file/,
  );
});
