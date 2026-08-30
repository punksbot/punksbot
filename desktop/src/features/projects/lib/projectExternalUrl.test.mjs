import assert from "node:assert/strict";
import { test } from "node:test";

import { projectExternalRefUrl } from "./projectExternalUrl.ts";

test("opens the selected GitHub branch", () => {
  assert.equal(
    projectExternalRefUrl(
      "https://github.com/punksbot/punksbot",
      "fix/agent-profile-about-preserve",
    ),
    "https://github.com/punksbot/punksbot/tree/fix%2Fagent-profile-about-preserve",
  );
});

test("normalizes clone URLs before adding the selected ref", () => {
  assert.equal(
    projectExternalRefUrl("https://github.com/punksbot/punksbot.git/", "main"),
    "https://github.com/punksbot/punksbot/tree/main",
  );
});

test("keeps unsupported and unscoped URLs unchanged", () => {
  assert.equal(
    projectExternalRefUrl("https://gitlab.com/punksbot/punksbot", "main"),
    "https://gitlab.com/punksbot/punksbot",
  );
  assert.equal(
    projectExternalRefUrl("https://github.com/punksbot/punksbot", null),
    "https://github.com/punksbot/punksbot",
  );
  assert.equal(projectExternalRefUrl("not a URL", "main"), "not a URL");
});
