import assert from "node:assert/strict";
import { test } from "node:test";

import { projectExternalRefUrl } from "./projectExternalUrl.ts";

test("opens the selected GitHub branch", () => {
  assert.equal(
    projectExternalRefUrl(
      "https://github.com/block/punks",
      "fix/agent-profile-about-preserve",
    ),
    "https://github.com/block/punks/tree/fix%2Fagent-profile-about-preserve",
  );
});

test("normalizes clone URLs before adding the selected ref", () => {
  assert.equal(
    projectExternalRefUrl("https://github.com/block/punks.git/", "main"),
    "https://github.com/block/punks/tree/main",
  );
});

test("keeps unsupported and unscoped URLs unchanged", () => {
  assert.equal(
    projectExternalRefUrl("https://gitlab.com/block/punks", "main"),
    "https://gitlab.com/block/punks",
  );
  assert.equal(
    projectExternalRefUrl("https://github.com/block/punks", null),
    "https://github.com/block/punks",
  );
  assert.equal(projectExternalRefUrl("not a URL", "main"), "not a URL");
});
