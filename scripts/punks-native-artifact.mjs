import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const FORBIDDEN_PUNKS_NATIVE_MARKERS = Object.freeze([
  "buzz-media",
  "native_websocket",
  "buzz",
  "nostr",
  "relay",
  "huddle",
]);

function matchingMarker(value) {
  const representations = [];
  if (Buffer.isBuffer(value)) {
    representations.push(value.toString("latin1"));
    for (const offset of [0, 1]) {
      const aligned = value.subarray(offset);
      const evenLength = aligned.length - (aligned.length % 2);
      if (evenLength === 0) continue;
      const evenBytes = aligned.subarray(0, evenLength);
      representations.push(evenBytes.toString("utf16le"));
      const byteSwapped = Buffer.allocUnsafe(evenLength);
      for (let index = 0; index < evenLength; index += 2) {
        byteSwapped[index] = evenBytes[index + 1];
        byteSwapped[index + 1] = evenBytes[index];
      }
      representations.push(byteSwapped.toString("utf16le"));
    }
  } else {
    representations.push(value);
  }
  for (const representation of representations) {
    const lower = representation.toLowerCase();
    const marker = FORBIDDEN_PUNKS_NATIVE_MARKERS.find((candidate) =>
      lower.includes(candidate),
    );
    if (marker) return marker;
  }
  return undefined;
}

export function verifyPunksNativeArtifact(path) {
  const absolutePath = resolve(path);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Punks native artifact must be one real regular file");
  }
  const nameMarker = matchingMarker(basename(absolutePath));
  if (nameMarker) {
    throw new Error(
      `Punks native artifact filename contains forbidden marker ${nameMarker}`,
    );
  }
  const contents = readFileSync(absolutePath);
  const contentMarker = matchingMarker(contents);
  if (contentMarker) {
    throw new Error(
      `Punks native artifact contains forbidden marker ${contentMarker}`,
    );
  }
  return {
    name: basename(absolutePath),
    size: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}
