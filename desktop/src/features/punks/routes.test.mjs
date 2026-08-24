import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPunksPath,
  canonicalPunksUrl,
  parsePunksPath,
  parsePunksUrl,
} from "./routes.ts";

const workspaceSlug = "alpha";
const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const origin = "https://staging.punks.bot";

test("Punks routes have one canonical home, Workspace, Conversation and Message form", () => {
  const routes = [
    { kind: "home" },
    { kind: "workspace", workspaceSlug },
    { kind: "conversation", workspaceSlug, conversationId },
    { kind: "message", workspaceSlug, conversationId, messageId },
  ];

  for (const route of routes) {
    const path = canonicalPunksPath(route);
    assert.deepEqual(parsePunksPath(path), route);
    assert.equal(canonicalPunksUrl(route, origin), `${origin}${path}`);
    assert.deepEqual(parsePunksUrl(`${origin}${path}`, origin), route);
  }
});

test("the native envelope rejects foreign origins and every legacy spelling", () => {
  const invalid = [
    "https://other.punks.bot/w/alpha",
    "http://staging.punks.bot/w/alpha",
    `${origin}/#/w/alpha`,
    `${origin}/w/alpha?conversation=${conversationId}`,
    `${origin}/workspace/alpha`,
    `${origin}/w/alpha/`,
    `${origin}/w/ALPHA`,
    `${origin}/w/alpha/conversations/not-a-uuid`,
  ];

  for (const url of invalid) {
    assert.equal(parsePunksUrl(url, origin), null, url);
  }
});
