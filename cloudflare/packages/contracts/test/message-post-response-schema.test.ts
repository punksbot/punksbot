import { describe, expect, it } from "vitest";

import { validateContract } from "../src";

const message = {
  id: "00000000-0000-8000-8000-000000000101",
  workspaceId: "00000000-0000-8000-8000-000000000102",
  conversationId: "00000000-0000-8000-8000-000000000103",
  author: {
    kind: "punk",
    punkId: "00000000-0000-8000-8000-000000000104",
  },
  messageType: "stream-message",
  status: "active",
  content: "hello",
  topic: null,
  mentionedPunkIds: [],
  mediaIds: [],
  parentMessageId: null,
  threadRootMessageId: "00000000-0000-8000-8000-000000000101",
  threadDepth: 0,
  broadcast: false,
  replyCount: 0,
  descendantCount: 0,
  lastReplyAt: null,
  currentVersion: 1,
  retractionKind: null,
  retractedAt: null,
  eraseAfter: null,
  publicReason: null,
  erasedAt: null,
  revision: 1,
  createdCursor: 2,
  cursor: 2,
  createdAt: "2026-08-20T13:00:00.000Z",
  updatedAt: "2026-08-20T13:00:00.000Z",
  editedAt: null,
};

describe("message.post-response@1", () => {
  it("accepts only the complete public POST envelope", () => {
    expect(
      validateContract("punks://contracts/message.post-response@1", {
        message,
        replayed: false,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/message.post-response@1", {
        message,
        replayed: false,
        event: { kind: 50200 },
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/message.post-response@1", {
        message: { ...message, contentKeyId: crypto.randomUUID() },
        replayed: true,
      }).valid,
    ).toBe(false);
  });
});
