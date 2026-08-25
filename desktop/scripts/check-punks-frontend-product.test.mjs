import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const checker = join(import.meta.dirname, "check-punks-frontend-product.mjs");

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-frontend-product-"));
  write(
    root,
    "vite.config.ts",
    `import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const punks = process.env.VITE_PUNKS_DISTRIBUTION === "punks";
  return {
    root: punks ? path.resolve(__dirname, "punks-product") : undefined,
    publicDir: punks ? false : "public",
    build: punks
      ? { outDir: path.resolve(__dirname, "dist") }
      : undefined,
  };
});
`,
  );
  write(
    root,
    "punks-product/index.html",
    `<!doctype html>
<html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>
`,
  );
  write(root, "punks-product/main.tsx", `import "@/punks-main";\n`);
  write(
    root,
    "src/punks-main.tsx",
    `import React from "react";
import PunksApp from "@/features/punks/PunksApp";
void React;
void PunksApp;
`,
  );
  return root;
}

function createValidDist(root) {
  write(
    root,
    "dist/index.html",
    `<!doctype html>
<html><head><link rel="stylesheet" href="/assets/app-a1.css"></head>
<body><div id="root"></div><script type="module" src="/assets/app-a1.js"></script></body></html>
`,
  );
  write(root, "dist/assets/app-a1.js", `console.info("Punks frontend");\n`);
  write(root, "dist/assets/app-a1.css", `:root { color: #111; }\n`);
  write(
    root,
    "dist/assets/fonts/inter-a1.woff2",
    Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]),
  );
}

function runChecker(root, ...args) {
  return spawnSync(process.execPath, [checker, "--root", root, ...args], {
    encoding: "utf8",
  });
}

function mutate(root, relativePath, from, to) {
  const path = join(root, relativePath);
  const source = readFileSync(path, "utf8");
  const present =
    from instanceof RegExp ? from.test(source) : source.includes(from);
  if (from instanceof RegExp) from.lastIndex = 0;
  assert.ok(present, `fixture mutation source not found: ${from}`);
  writeFileSync(path, source.replace(from, to));
}

test("the public checker proves the isolated Punks source entry graph", () => {
  const root = createSourceFixture();
  try {
    const first = runChecker(root);
    assert.equal(first.status, 0, first.stderr);
    const second = runChecker(root);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);

    const proof = JSON.parse(first.stdout);
    assert.equal(proof.schemaVersion, 1);
    assert.equal(proof.product, "punks-frontend");
    assert.equal(proof.mode, "source");
    assert.deepEqual(
      proof.files.map(({ path }) => path),
      [
        "punks-product/index.html",
        "punks-product/main.tsx",
        "src/punks-main.tsx",
        "vite.config.ts",
      ],
    );
    assert.ok(proof.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
    assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the public checker rejects a second legacy HTML entry", () => {
  const root = createSourceFixture();
  write(
    root,
    "punks-product/index.html",
    `<!doctype html>
<html><body><div id="root"></div>
<script type="module" src="/main.tsx"></script>
<script src="/src/main.tsx"></script>
</body></html>
`,
  );
  try {
    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must load only \/main\.tsx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const mutation of [
  {
    name: "a Vite root other than punks-product",
    path: "vite.config.ts",
    from: 'path.resolve(__dirname, "punks-product")',
    to: 'path.resolve(__dirname, "legacy-product")',
    error: /select punks-product/,
  },
  {
    name: "a public directory in the Punks branch",
    path: "vite.config.ts",
    from: 'punks ? false : "public"',
    to: 'punks ? "public" : "public"',
    error: /publicDir=false/,
  },
  {
    name: "a Punks output directory outside desktop dist",
    path: "vite.config.ts",
    from: 'path.resolve(__dirname, "dist")',
    to: 'path.resolve(__dirname, "dist-punks")',
    error: /desktop\/dist/,
  },
]) {
  test(`the public checker rejects ${mutation.name}`, () => {
    const root = createSourceFixture();
    mutate(root, mutation.path, mutation.from, mutation.to);
    try {
      const result = runChecker(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mutation.error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("the public checker ignores a valid-looking dead Vite configuration", () => {
  const root = createSourceFixture();
  write(
    root,
    "vite.config.ts",
    `import path from "node:path";
import { defineConfig } from "vite";
const punks = true;
const ignored = {
  root: punks ? path.resolve(__dirname, "punks-product") : undefined,
  publicDir: punks ? false : "public",
  build: punks ? { outDir: path.resolve(__dirname, "dist") } : undefined,
};
void ignored;
export default defineConfig(() => ({}));
`,
  );
  try {
    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conditional Punks root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the public checker rejects unreachable Punks configuration branches", () => {
  const root = createSourceFixture();
  mutate(root, "vite.config.ts", /punks\s+\?/gu, "false ?");
  try {
    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Punks predicate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const forbiddenImport of [
  "@/main",
  "@/app/App",
  "@/capabilities/client",
  "@/features/communities/state",
  "@/features/huddle/session",
  "@/shared/relay/client",
  "@/shared/nostr/event",
]) {
  test(`the public checker rejects the ${forbiddenImport} import`, () => {
    const root = createSourceFixture();
    write(
      root,
      "src/punks-main.tsx",
      `import LegacyProduct from "${forbiddenImport}";\nvoid LegacyProduct;\n`,
    );
    try {
      const result = runChecker(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /imports forbidden product code/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("the public checker rejects a legacy TypeScript import-equals entry", () => {
  const root = createSourceFixture();
  write(
    root,
    "src/punks-main.tsx",
    `import LegacyApp = require("@/app/App");\nvoid LegacyApp;\n`,
  );
  try {
    const result = runChecker(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /imports forbidden product code/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist mode recursively proves one closed Punks frontend bundle", () => {
  const root = createSourceFixture();
  createValidDist(root);
  try {
    const result = runChecker(root, "--dist");
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.mode, "dist");
    assert.deepEqual(
      proof.files.map(({ path }) => path),
      [
        "dist/assets/app-a1.css",
        "dist/assets/app-a1.js",
        "dist/assets/fonts/inter-a1.woff2",
        "dist/index.html",
        "punks-product/index.html",
        "punks-product/main.tsx",
        "src/punks-main.tsx",
        "vite.config.ts",
      ],
    );
    assert.equal(
      proof.files.find(({ path }) => path === "dist/assets/app-a1.js")?.sha256,
      "ec12e2d81d34698c3541adb0db5b46947cd4027f4d37a138d22cc76ac4fac8d5",
    );
    assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist mode rejects an absent or empty distribution", async (t) => {
  await t.test("absent dist", () => {
    const root = createSourceFixture();
    try {
      const result = runChecker(root, "--dist");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /desktop\/dist is absent/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("empty dist", () => {
    const root = createSourceFixture();
    mkdirSync(join(root, "dist"));
    try {
      const result = runChecker(root, "--dist");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /desktop\/dist is empty/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("dist mode rejects files outside index.html and assets", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(root, "dist/latest.json", "{}\n");
  try {
    const result = runChecker(root, "--dist");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly index\.html and the assets directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist mode rejects unavailable capability code in the eager entry", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(
    root,
    "dist/assets/app-a1.js",
    `console.info("Punks frontend");\nconst command = "punks_edit_message";\nvoid command;\n`,
  );
  try {
    const result = runChecker(root, "--dist");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unavailable capability message-lifecycle/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist mode accepts an isolated capability chunk not referenced by HTML", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(
    root,
    "dist/assets/MessageLifecycleControls-a1.js",
    `export const command = "punks_edit_message";\n`,
  );
  try {
    const result = runChecker(root, "--dist");
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [extension, contents] of [
  ["js", `export const extra = true;\n`],
  ["css", `.extra { display: block; }\n`],
]) {
  test(`dist mode rejects a second ${extension.toUpperCase()} asset`, () => {
    const root = createSourceFixture();
    createValidDist(root);
    write(root, `dist/assets/extra.${extension}`, contents);
    try {
      const result = runChecker(root, "--dist");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exactly one JavaScript and one CSS file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("dist mode rejects a forbidden marker in a nested asset name", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(root, "dist/assets/icons/BuZz-banner.bin", Buffer.from([1, 2, 3]));
  try {
    const result = runChecker(root, "--dist");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /file name contains forbidden marker buzz/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const marker of [
  "Buzz",
  "Nostr",
  "relay",
  "huddle",
  "buzz-media",
  "native_websocket",
]) {
  test(`dist mode rejects ${marker} in binary content`, () => {
    const root = createSourceFixture();
    createValidDist(root);
    write(
      root,
      "dist/assets/native.bin",
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from(marker),
        Buffer.from([3]),
      ]),
    );
    try {
      const result = runChecker(root, "--dist");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /content contains forbidden marker/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("dist mode rejects a forbidden UTF-16LE marker in binary content", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(
    root,
    "dist/assets/native.bin",
    Buffer.from("native_websocket", "utf16le"),
  );
  try {
    const result = runChecker(root, "--dist");
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /content contains forbidden marker native_websocket/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the proof uses locale-independent canonical path ordering", () => {
  const root = createSourceFixture();
  createValidDist(root);
  write(root, "dist/assets/Z.bin", Buffer.from([1]));
  write(root, "dist/assets/a.bin", Buffer.from([2]));
  try {
    const result = runChecker(root, "--dist");
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.deepEqual(
      proof.files.slice(0, 3).map(({ path }) => path),
      ["dist/assets/Z.bin", "dist/assets/a.bin", "dist/assets/app-a1.css"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
