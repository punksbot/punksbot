import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";

/**
 * Reads one bounded regular file without following a final symlink and rejects
 * any inode, size or timestamp change across the read.
 */
export function readStableEvidenceFile(
  path,
  label,
  { minimum = 1, maximum = 64 * 1024 * 1024 } = {},
) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size < minimum ||
    status.size > maximum
  ) {
    throw new Error(`${label} must be one bounded regular file`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      throw new Error(`${label} changed while it was read`);
    }
    return content;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
