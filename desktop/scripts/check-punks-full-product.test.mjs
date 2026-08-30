import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { verifyPunksFullProduct } from "./check-punks-full-product.mjs";

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-full-product-"));
  write(
    root,
    "index.html",
    '<script type="module" src="/src/main.tsx"></script>',
  );
  write(
    root,
    "src/main.tsx",
    'import App from "@/app/PunksFullApp"; void App;',
  );
  write(
    root,
    "src/app/PunksFullApp.tsx",
    "export default function PunksFullApp() { return null; }",
  );
  write(root, "vite.config.ts", "export default { publicDir: false };");
  return root;
}

test("proves the single rich Punks source graph", () => {
  const root = fixture();
  try {
    const proof = verifyPunksFullProduct({ root });
    assert.equal(proof.product, "punks-full-frontend");
    assert.deepEqual(
      proof.files.map(({ path }) => path),
      [
        "index.html",
        "src/app/PunksFullApp.tsx",
        "src/main.tsx",
        "vite.config.ts",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an isolated entry and retired product markers", () => {
  const isolated = fixture();
  write(isolated, "punks-product/main.tsx", "export {};");
  assert.throws(
    () => verifyPunksFullProduct({ root: isolated }),
    /isolated Punks product entry/u,
  );
  rmSync(isolated, { recursive: true, force: true });

  const marked = fixture();
  write(marked, "src/main.tsx", "const retired = 'Punks'; void retired;");
  assert.throws(
    () => verifyPunksFullProduct({ root: marked }),
    /retired product marker/u,
  );
  rmSync(marked, { recursive: true, force: true });
});
