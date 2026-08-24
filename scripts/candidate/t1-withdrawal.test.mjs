import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const REMOVED_PATHS = [
  "desktop/src/shared/deep-link.ts",
  "desktop/src/shared/deep-link.test.mjs",
  "desktop/src/shared/useAppDeepLinks.ts",
  "desktop/src/shared/useEntityDeepLinks.ts",
  "desktop/src/shared/useMessageDeepLinks.ts",
  "desktop/src/features/onboarding",
  "desktop/tests/helpers/seedRelay.ts",
  "desktop/tests/helpers/seed.ts",
  "desktop/tests/helpers/onboarding.ts",
  "desktop/playwright.live.config.ts",
  "test-fixtures/entity-links.json",
  "desktop/src-tauri/src/deep_link.rs",
  "desktop/src-tauri/src/deep_link_tests.rs",
  "scripts/setup-desktop-test-data.sh",
  "docs/buzz-entity-links.md",
  "punks-desktop",
];

function containsFilesystemEntry(path) {
  if (!existsSync(path)) return false;
  const status = lstatSync(path);
  if (!status.isDirectory()) return true;
  return readdirSync(path).some(
    (name) =>
      name !== "node_modules" && containsFilesystemEntry(`${path}/${name}`),
  );
}

test("the exact tranche 1 withdrawal is physically absent", () => {
  for (const path of REMOVED_PATHS) {
    assert.equal(
      containsFilesystemEntry(path),
      false,
      `${path} must be removed in T1`,
    );
  }
});

test("qualified T1 legacy edges are removed without deleting their containers", () => {
  const justfile = readFileSync("Justfile", "utf8");
  for (const target of [
    "desktop-e2e-integration",
    "desktop-e2e-seed",
    "desktop-e2e-pre-push",
  ]) {
    assert.doesNotMatch(
      justfile,
      new RegExp(`^${target}:`, "mu"),
      `${target} must not remain callable`,
    );
  }

  assert.doesNotMatch(
    readFileSync(".env.example", "utf8"),
    /VITE_BUZZ_FORCE_FRESH_ONBOARDING/u,
  );
  assert.doesNotMatch(
    readFileSync("pnpm-workspace.yaml", "utf8"),
    /^\s*-\s*["']?punks-desktop["']?\s*$/mu,
  );
});
