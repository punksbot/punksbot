import assert from "node:assert/strict";
import test from "node:test";

import { buildIndependentThreadPanel } from "./independentThreadPanel.ts";

const ROOT_ID = "a".repeat(64);
const REPLY_ID = "b".repeat(64);
const EDIT_ID = "c".repeat(64);
const PUBKEY = "1".repeat(64);
const CHANNEL_ID = "channel-1";

function event(id, kind, content, tags, createdAt) {
  return {
    id,
    pubkey: PUBKEY,
    kind,
    created_at: createdAt,
    content,
    tags,
    sig: "sig",
  };
}

test("independent thread panel applies channel-window edits to its root", () => {
  const root = event(
    ROOT_ID,
    9,
    "obsolete root text",
    [["h", CHANNEL_ID]],
    100,
  );
  const edit = event(
    EDIT_ID,
    40003,
    "current root text",
    [
      ["h", CHANNEL_ID],
      ["e", ROOT_ID],
    ],
    101,
  );
  const reply = event(
    REPLY_ID,
    9,
    "reply",
    [
      ["h", CHANNEL_ID],
      ["e", ROOT_ID, "", "reply"],
    ],
    102,
  );

  const panel = buildIndependentThreadPanel(
    [root, edit],
    [reply],
    ROOT_ID,
    ROOT_ID,
    new Set(),
    null,
    PUBKEY,
    null,
    undefined,
    undefined,
    new Map(),
    new Map(),
    null,
    undefined,
  );

  assert.equal(
    panel.messages.find((message) => message.id === ROOT_ID)?.body,
    "current root text",
  );
});
