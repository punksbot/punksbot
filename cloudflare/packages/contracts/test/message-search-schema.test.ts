import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import { contractSchemas } from "../src/registry";
import messageSearchResponseSchema from "../schemas/message.search-response.schema.json";
import messageSearchSchema from "../schemas/message.search.schema.json";
import messageViewSchema from "../schemas/message.view.schema.json";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const messageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
const punkId = "00000000-0000-8000-8000-000000000002";
const timestamp = "2026-08-20T14:00:00.000Z";
const opaqueCursor = `msc1.${"A".repeat(16)}.${"B".repeat(80)}`;

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
    messageType: "stream-message",
    status: "active",
    content: "Incident response handbook",
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: messageId,
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
    createdCursor: 42,
    cursor: 42,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: null,
    ...overrides,
  };
}

describe("authorized Message search contracts", () => {
  it("requires the query on both the initial and continued bounded search", () => {
    const initialQuery = {
      contract: "message.search@1",
      workspaceId,
      conversationId,
      query: "incident response",
      cursor: null,
      limit: 100,
    };
    const continuedQuery = { ...initialQuery, cursor: opaqueCursor, limit: 25 };

    expect(validates(messageSearchSchema, initialQuery)).toBe(true);
    expect(validates(messageSearchSchema, continuedQuery)).toBe(true);

    const withoutQuery: Record<string, unknown> = { ...continuedQuery };
    delete withoutQuery.query;
    expect(validates(messageSearchSchema, withoutQuery)).toBe(false);
    expect(validates(messageSearchSchema, { ...initialQuery, query: "" })).toBe(
      false,
    );
    expect(
      validates(messageSearchSchema, {
        ...initialQuery,
        query: "q".repeat(513),
      }),
    ).toBe(false);
    const withoutConversation: Record<string, unknown> = { ...initialQuery };
    delete withoutConversation.conversationId;
    expect(validates(messageSearchSchema, withoutConversation)).toBe(false);
    expect(validates(messageSearchSchema, { ...initialQuery, limit: 0 })).toBe(
      false,
    );
    expect(
      validates(messageSearchSchema, { ...initialQuery, limit: 101 }),
    ).toBe(false);
    expect(
      validates(messageSearchSchema, {
        ...continuedQuery,
        cursor: "not-a-cursor",
      }),
    ).toBe(false);
    expect(
      validates(messageSearchSchema, {
        ...continuedQuery,
        cursor: opaqueCursor.replace("msc1", "mhc1"),
      }),
    ).toBe(false);
    expect(
      validates(messageSearchSchema, {
        ...initialQuery,
        workspaceId: "not-a-workspace",
      }),
    ).toBe(false);
    expect(
      validates(messageSearchSchema, { ...initialQuery, score: true }),
    ).toBe(false);
  });

  it("returns only active authorized Message views in stable descending order", () => {
    const response = {
      workspaceId,
      conversationId,
      order: "createdCursor-descending",
      items: [activeMessageView()],
      nextCursor: opaqueCursor,
    };

    expect(
      validates(messageSearchResponseSchema, response, [messageViewSchema]),
    ).toBe(true);
    expect(
      validates(
        messageSearchResponseSchema,
        {
          ...response,
          items: [
            activeMessageView({
              status: "retracted",
              content: null,
              currentVersion: null,
              retractionKind: "author",
              retractedAt: timestamp,
              eraseAfter: "2026-08-27T14:00:00.000Z",
            }),
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(messageSearchResponseSchema, { ...response, score: 0.75 }, [
        messageViewSchema,
      ]),
    ).toBe(false);
    expect(
      validates(
        messageSearchResponseSchema,
        { ...response, order: "bm25-descending" },
        [messageViewSchema],
      ),
    ).toBe(false);
  });

  it("bounds each response independently of the one-mebibyte runtime cap", () => {
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      activeMessageView({
        id: `00000000-0000-8000-8000-${String(index + 1).padStart(12, "0")}`,
        createdCursor: 100 - index,
        cursor: 100,
      }),
    );
    const response = {
      workspaceId,
      conversationId,
      order: "createdCursor-descending",
      items: fullPage,
      nextCursor: null,
    };

    expect(
      validates(messageSearchResponseSchema, response, [messageViewSchema]),
    ).toBe(true);
    expect(
      validates(
        messageSearchResponseSchema,
        { ...response, items: [...fullPage, activeMessageView()] },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        messageSearchResponseSchema,
        { ...response, nextCursor: "not-a-cursor" },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(messageSearchResponseSchema.$comment).toContain("1048576");

    for (const forbidden of ["score", "snippet", "tokens", "nostrEvent"]) {
      expect(
        validates(
          messageSearchResponseSchema,
          { ...response, [forbidden]: "leak" },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
    for (const forbidden of [
      "ciphertextRef",
      "contentKeyId",
      "contentCommitment",
      "nostrEvent",
      "searchTokens",
      "snippet",
      "score",
    ]) {
      expect(
        validates(
          messageSearchResponseSchema,
          {
            ...response,
            items: [activeMessageView({ [forbidden]: "leak" })],
          },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
  });

  it("publishes both Message search contracts through the canonical registry", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/message.search@1",
        "punks://contracts/message.search-response@1",
      ]),
    );
  });
});
