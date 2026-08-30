import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const desktopRoot = resolve(import.meta.dirname, "..");

function read(relativePath) {
  return readFileSync(resolve(desktopRoot, relativePath), "utf8");
}

test("the Punks product uses the rich desktop document and React entry", () => {
  const vite = read("vite.config.ts");
  const index = read("index.html");

  assert.doesNotMatch(vite, /root:\s*punks\s*\?/u);
  assert.doesNotMatch(vite, /punks-product/u);
  assert.match(index, /src="\/src\/main\.tsx"/u);
  assert.match(index, /<title>Punks Bot<\/title>/u);
});

test("the Punks product has no isolated mini-client entry", () => {
  const manifest = JSON.parse(read("package.json"));

  assert.equal(manifest.scripts?.["check:punks-product"], undefined);
  assert.equal(manifest.scripts?.["check:punks-product-dist"], undefined);
  assert.throws(() => read("punks-product/main.tsx"), /ENOENT/u);
  assert.throws(() => read("src/punks-main.tsx"), /ENOENT/u);
});

test("the Punks build typechecks the rich entry graph", () => {
  const config = JSON.parse(read("tsconfig.punks.json"));

  assert.deepEqual(config.files, ["src/main.tsx", "src/vite-env.d.ts"]);
});
