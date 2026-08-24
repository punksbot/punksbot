import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import messageHistoryResponseSchema from "../schemas/message.history-response.schema.json";
import messageHistorySchema from "../schemas/message.history.schema.json";
import messageViewSchema from "../schemas/message.view.schema.json";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const messageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
const punkId = "00000000-0000-8000-8000-000000000002";
const timestamp = "2026-08-20T14:00:00.000Z";
const opaqueCursor =
  "mhc1.eyJ2IjoxLCJ3IjoiNTg5NzVjYTgtM2I3NS00MmM3LWExM2EtNTFjOWQ3MzA2MjAwIiwiYyI6ImUzYTkyZjhkLWYwMTMtNDZiNy05MzcwLTVjYTFjNzliNjI4MCIsImgiOjQyLCJwIjozNywiZCI6Im8ifQ.TaN2K72Zi08GhyREs2E7lYB-cbxpTrCkYp0Cf19xxRw";

function validates(
  schema: object,
  value: unknown,
  dependencies: readonly object[] = [],
): boolean {
  const validator = new Validator(schema as never, "2020-12", false);
  for (const dependency of dependencies) {
    validator.addSchema(dependency as never);
    validator.addSchema(
      dependency as never,
      "punks://contracts/schemas/message.view.schema.json",
    );
  }
  return validator.validate(value).valid;
}

function activeMessageView(overrides: Record<string, unknown> = {}) {
  return {
    id: messageId,
    workspaceId,
    conversationId,
    author: { kind: "punk", punkId },
    messageType: "forum-post",
    status: "active",
    content: "Two Messages may share a timestamp but not a createdCursor.",
    topic: "Stable history",
    mentionedPunkIds: [punkId],
    mediaIds: ["00000000-0000-8000-8000-000000000201"],
    parentMessageId: null,
    threadRootMessageId: messageId,
    threadDepth: 0,
    broadcast: false,
    replyCount: 2,
    descendantCount: 3,
    lastReplyAt: timestamp,
    currentVersion: 2,
    retractionKind: null,
    retractedAt: null,
    eraseAfter: null,
    publicReason: null,
    erasedAt: null,
    revision: 3,
    createdCursor: 10,
    cursor: 15,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: timestamp,
    ...overrides,
  };
}

describe("authorized Message history contracts", () => {
  it("accepts an ephemeral authorized active Message view", () => {
    expect(validates(messageViewSchema, activeMessageView())).toBe(true);
  });

  it("makes retracted and erased views content-free and rejects every storage secret field", () => {
    const tombstones = [
      activeMessageView({
        status: "retracted",
        content: null,
        topic: null,
        currentVersion: null,
        mediaIds: [],
        retractionKind: "author",
        retractedAt: timestamp,
        eraseAfter: "2026-08-27T14:00:00.000Z",
        publicReason: "Withdrawn by its author",
      }),
      activeMessageView({
        status: "erased",
        content: null,
        topic: null,
        currentVersion: null,
        mediaIds: [],
        retractionKind: "moderation",
        retractedAt: timestamp,
        eraseAfter: null,
        publicReason: null,
        erasedAt: "2026-08-27T14:00:00.000Z",
      }),
    ];

    for (const tombstone of tombstones) {
      expect(validates(messageViewSchema, tombstone)).toBe(true);
      expect(
        validates(messageViewSchema, { ...tombstone, content: "leaked" }),
      ).toBe(false);
      expect(
        validates(messageViewSchema, { ...tombstone, topic: "leaked" }),
      ).toBe(false);
      expect(
        validates(messageViewSchema, {
          ...tombstone,
          mediaIds: ["00000000-0000-8000-8000-000000000201"],
        }),
      ).toBe(false);
      for (const forbidden of [
        "ciphertextRef",
        "contentKeyId",
        "contentCommitment",
        "originalContentCommitment",
        "reasonCode",
        "commandId",
      ]) {
        expect(
          validates(messageViewSchema, { ...tombstone, [forbidden]: "a" }),
        ).toBe(false);
      }
    }

    const serializedSchema = JSON.stringify(messageViewSchema);
    expect(serializedSchema).not.toContain("ciphertextRef");
    expect(serializedSchema).not.toContain("contentKeyId");
    expect(serializedSchema).not.toContain("contentCommitment");
  });

  it("uses direction only on the initial bounded history query, then trusts the opaque cursor", () => {
    const initialQuery = {
      contract: "message.history@1",
      workspaceId,
      conversationId,
      threadRootMessageId: messageId,
      cursor: null,
      limit: 100,
      direction: "older",
    };
    const continuedQuery = {
      contract: "message.history@1",
      workspaceId,
      conversationId,
      cursor: opaqueCursor,
      limit: 50,
    };

    expect(validates(messageHistorySchema, initialQuery)).toBe(true);
    expect(
      validates(messageHistorySchema, { ...initialQuery, direction: "newer" }),
    ).toBe(true);
    expect(validates(messageHistorySchema, continuedQuery)).toBe(true);
    expect(
      validates(messageHistorySchema, {
        ...continuedQuery,
        direction: "newer",
      }),
    ).toBe(false);
    expect(
      validates(messageHistorySchema, {
        contract: initialQuery.contract,
        workspaceId,
        conversationId,
        threadRootMessageId: messageId,
        cursor: null,
        limit: 100,
      }),
    ).toBe(false);
    expect(
      validates(messageHistorySchema, { ...initialQuery, limit: 101 }),
    ).toBe(false);
    expect(
      validates(messageHistorySchema, {
        ...continuedQuery,
        cursor: "not-a-cursor",
      }),
    ).toBe(false);
  });

  it("requires valid scope IDs and rejects unknown fields at every boundary", () => {
    const query = {
      contract: "message.history@1",
      workspaceId,
      conversationId,
      cursor: null,
      limit: 25,
      direction: "older",
    };
    const response = {
      workspaceId,
      conversationId,
      highWaterCursor: 15,
      order: "createdCursor-ascending",
      items: [activeMessageView()],
      nextCursor: null,
    };

    expect(
      validates(messageViewSchema, {
        ...activeMessageView(),
        workspaceId: "wrong-scope",
      }),
    ).toBe(false);
    expect(
      validates(messageHistorySchema, {
        ...query,
        conversationId: "wrong-scope",
      }),
    ).toBe(false);
    expect(validates(messageHistorySchema, { ...query, unknown: true })).toBe(
      false,
    );
    expect(
      validates(
        messageHistoryResponseSchema,
        { ...response, workspaceId: "wrong-scope" },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(messageHistoryResponseSchema, { ...response, unknown: true }, [
        messageViewSchema,
      ]),
    ).toBe(false);
  });

  it("bounds responses to 100 items ordered by stable createdCursor at one high-water mark", () => {
    const sameTimestampItems = [
      activeMessageView({
        id: "00000000-0000-8000-8000-000000000009",
        createdCursor: 9,
      }),
      activeMessageView({
        id: "00000000-0000-8000-8000-000000000010",
        createdCursor: 10,
      }),
    ];
    const response = {
      workspaceId,
      conversationId,
      highWaterCursor: 15,
      order: "createdCursor-ascending",
      items: sameTimestampItems,
      nextCursor: opaqueCursor,
    };
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      activeMessageView({
        id: `00000000-0000-8000-8000-${String(index + 1).padStart(12, "0")}`,
        createdCursor: index + 1,
        cursor: 100,
      }),
    );

    expect(
      sameTimestampItems.map(({ createdCursor }) => createdCursor),
    ).toEqual([9, 10]);
    expect(
      validates(messageHistoryResponseSchema, response, [messageViewSchema]),
    ).toBe(true);
    expect(
      validates(
        messageHistoryResponseSchema,
        { ...response, highWaterCursor: 100, items: fullPage },
        [messageViewSchema],
      ),
    ).toBe(true);
    expect(
      validates(
        messageHistoryResponseSchema,
        {
          ...response,
          highWaterCursor: 101,
          items: [...fullPage, activeMessageView()],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        messageHistoryResponseSchema,
        { ...response, nextCursor: null },
        [messageViewSchema],
      ),
    ).toBe(true);
    expect(
      validates(
        messageHistoryResponseSchema,
        { ...response, nextCursor: "not-a-cursor" },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        messageHistoryResponseSchema,
        { ...response, order: "timestamp-descending" },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(messageHistoryResponseSchema.$comment).toContain("1048576");
  });
});
