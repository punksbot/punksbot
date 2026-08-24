import assert from "node:assert/strict";
import test from "node:test";

import {
  isPunksDistribution,
  renderPunksIndexHtml,
} from "./punks-product-entry.mjs";

test("selects the isolated product graph only for the exact Punks distribution", () => {
  assert.equal(isPunksDistribution({ VITE_PUNKS_DISTRIBUTION: "punks" }), true);
  assert.equal(
    isPunksDistribution({ VITE_PUNKS_DISTRIBUTION: "preparation" }),
    false,
  );
  assert.equal(isPunksDistribution({}), false);
});

test("renders an index that has no Buzz bootstrap or entrypoint", () => {
  const html = renderPunksIndexHtml();

  assert.match(html, /<title>Punks Bot<\/title>/);
  assert.match(html, /src="\/main\.tsx"/);
  assert.doesNotMatch(html, /src\/main\.tsx/);
  assert.doesNotMatch(html, /buzz(?:\.svg|-theme-cache| onboarding| failed)/i);
  assert.doesNotMatch(html, /nostr|relay/i);
});
