import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const RETAINED_PATHS = [
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
  "docs/punks-entity-links.md",
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

test("the consolidated Full Local mechanisms remain physically present", () => {
  for (const path of RETAINED_PATHS) {
    assert.equal(
      containsFilesystemEntry(path),
      true,
      `${path} must remain available to Full Local`,
    );
  }
  assert.equal(containsFilesystemEntry("punks-desktop"), false);
});

test("the consolidated E2E targets remain while the isolated mini-package is absent", () => {
  const justfile = readFileSync("Justfile", "utf8");
  for (const target of [
    "desktop-e2e-integration",
    "desktop-e2e-seed",
    "desktop-e2e-pre-push",
  ]) {
    assert.match(
      justfile,
      new RegExp(`^${target}:`, "mu"),
      `${target} must remain callable`,
    );
  }

  assert.doesNotMatch(
    readFileSync("pnpm-workspace.yaml", "utf8"),
    /^\s*-\s*["']?punks-desktop["']?\s*$/mu,
  );
});
