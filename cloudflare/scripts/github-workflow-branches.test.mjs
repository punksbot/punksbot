import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import YAML from "yaml";

const workflow = YAML.parse(
  readFileSync(".github/workflows/punks-cloudflare.yml", "utf8"),
);

test("the managed Workers gate runs on both canonical repository branches", () => {
  assert.deepEqual(
    workflow.on?.push?.branches,
    ["prod", "staging"],
    "push CI must follow the repository's exact prod/staging branch set",
  );
});

test("active operator guidance targets the transferred repository identity", () => {
  const files = [
    "AGENTS.md",
    "docs/agents/issue-tracker.md",
    "docs/migration/punks-desktop-signing.md",
    "docs/migration/withdrawal-inventory.md",
    "scripts/render-withdrawal-inventory.mjs",
  ];
  const guidance = files
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(guidance, /mabzadev\/punksbot/);
  assert.match(
    guidance,
    /repo:punksbot\/punksbot:environment:punks-staging-promotion/,
  );
});

test("the pre-push skew guard recognizes both canonical branches", () => {
  const guard = readFileSync("scripts/check-branch-skew.sh", "utf8");

  assert.match(guard, /\[ "\$branch" = "prod" \]/);
  assert.match(guard, /\[ "\$branch" = "staging" \]/);
  assert.match(guard, /git fetch --quiet origin prod/);
  assert.doesNotMatch(guard, /origin\/main|refs\/heads\/main/);
});
