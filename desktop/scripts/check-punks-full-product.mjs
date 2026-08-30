import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const SOURCE_FILES = [
  "index.html",
  "src/app/PunksFullApp.tsx",
  "src/main.tsx",
  "vite.config.ts",
];
const RETIRED_ENTRIES = ["punks-product", "src/punks-main.tsx"];
const previousProduct = ["bu", "zz"].join("");
const FORBIDDEN = [
  previousProduct,
  "nostr",
  "relay",
  `${previousProduct}-media`,
  "native_websocket",
];

function canonicalPath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function filesUnder(root) {
  const files = [];
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const child = resolve(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else files.push(child);
    }
  };
  visit(root);
  return files;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertNoRetiredMarker(path, bytes) {
  const lowerPath = path.toLowerCase();
  const ascii = bytes.toString("latin1").toLowerCase();
  const utf16 = bytes.toString("utf16le").toLowerCase();
  for (const marker of FORBIDDEN) {
    if (
      lowerPath.includes(marker) ||
      ascii.includes(marker) ||
      utf16.includes(marker)
    ) {
      throw new Error(`${path}: retired product marker ${marker}`);
    }
  }
}

function parseArgs(argv) {
  let root = resolve(".");
  let dist = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dist") dist = true;
    else if (argv[index] === "--root" && argv[index + 1]) {
      root = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(
        "usage: check-punks-full-product.mjs [--root <desktop>] [--dist]",
      );
    }
  }
  return { root, dist };
}

export function verifyPunksFullProduct({ root, dist = false }) {
  for (const retired of RETIRED_ENTRIES) {
    if (existsSync(resolve(root, retired))) {
      throw new Error(
        `${retired}: isolated Punks product entry is still present`,
      );
    }
  }
  for (const path of SOURCE_FILES) {
    if (!existsSync(resolve(root, path))) {
      throw new Error(`${path}: rich Punks product source is absent`);
    }
  }
  const rootToScan = dist ? resolve(root, "dist") : root;
  if (dist && !existsSync(rootToScan)) {
    throw new Error("desktop/dist is absent");
  }
  const paths = dist
    ? filesUnder(rootToScan)
    : SOURCE_FILES.map((path) => resolve(root, path));
  const files = paths.map((path) => {
    const bytes = readFileSync(path);
    const name = canonicalPath(root, path);
    assertNoRetiredMarker(name, bytes);
    return { path: name, sha256: digest(bytes) };
  });
  const proof = {
    schemaVersion: 1,
    product: "punks-full-frontend",
    mode: dist ? "dist" : "source",
    files,
  };
  return { ...proof, sha256: digest(Buffer.from(JSON.stringify(proof))) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyPunksFullProduct(parseArgs(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
