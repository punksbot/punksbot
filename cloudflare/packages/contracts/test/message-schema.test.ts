import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import { contractSchemas } from "../src/registry";

import editSchema from "../schemas/message.edit.schema.json";
import finalizeErasureSchema from "../schemas/message.finalize-erasure.schema.json";
import postSchema from "../schemas/message.post.schema.json";
import restoreSchema from "../schemas/message.restore.schema.json";
import retractSchema from "../schemas/message.retract.schema.json";
import messageSchema from "../schemas/message.schema.json";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const messageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
const punkId = "00000000-0000-8000-8000-000000000002";
const commandId = "57a0a439-bacc-41a8-ac78-7393b4938fa8";
const timestamp = "2026-08-20T14:00:00.000Z";

function validates(schema: object, value: unknown): boolean {
  return new Validator(schema as never, "2020-12", false).validate(value).valid;
}

function activeMessage() {
  return {
    id: messageId,
    workspaceId,
    conversationId,
    author: { kind: "punk", punkId },
    messageType: "stream-message",
    status: "active",
    topicPresent: false,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: messageId,
    threadDepth: 0,
    broadcast: false,
    replyCount: 0,
    descendantCount: 0,
    lastReplyAt: null,
    originalContentCommitment: "1".repeat(64),
    currentVersion: 1,
    contentVersions: [
      {
        version: 1,
        contentCommitment: "1".repeat(64),
        ciphertextRef: "r2://punks-message/root/1",
        contentKeyId: "message-key-root-1",
        topicPresent: false,
        createdAt: timestamp,
      },
    ],
    retraction: null,
    erasureMarker: null,
    revision: 1,
    createdCursor: 1,
    cursor: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: null,
  };
}

describe("Message schemas and canonical registry", () => {
  it("publishes the complete Message contract family", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/message@1",
        "punks://contracts/message.post@1",
        "punks://contracts/message.mutation-response@1",
        "punks://contracts/message.edit@1",
        "punks://contracts/message.retract@1",
        "punks://contracts/message.restore@1",
        "punks://contracts/message.finalize-erasure@1",
        "punks://contracts/message.projection@1",
      ]),
    );
  });

  it("accepts active state and enforces a content-free erasure marker", () => {
    expect(validates(messageSchema, activeMessage())).toBe(true);

    const erased = {
      ...activeMessage(),
      status: "erased",
      originalContentCommitment: null,
      currentVersion: null,
      contentVersions: [],
      erasureMarker: {
        erasedAt: timestamp,
        retractedAt: timestamp,
        retractionKind: "author",
        destroyedVersionCount: 1,
      },
      revision: 3,
      cursor: 3,
    };
    expect(validates(messageSchema, erased)).toBe(true);
    expect(
      validates(messageSchema, {
        ...erased,
        contentVersions: activeMessage().contentVersions,
      }),
    ).toBe(false);
  });

  it("accepts Punk and Bot posts but rejects empty posts", () => {
    const post = {
      contract: "message.post@1",
      commandId,
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId },
      payload: {
        content: "hello",
        replyToMessageId: null,
        broadcast: false,
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    expect(validates(postSchema, post)).toBe(true);
    expect(
      validates(postSchema, {
        ...post,
        actor: {
          kind: "bot",
          installationId: "00000000-0000-8000-8000-000000000101",
        },
      }),
    ).toBe(true);
    expect(
      validates(postSchema, {
        ...post,
        payload: { ...post.payload, content: "" },
      }),
    ).toBe(false);
  });

  it("validates edit, retract, restore, and service-only finalization shapes", () => {
    const scoped = {
      commandId,
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId },
    };
    expect(
      validates(editSchema, {
        ...scoped,
        contract: "message.edit@1",
        payload: {
          content: "edited",
          topic: null,
          mentionedPunkIds: [],
          mediaIds: [],
        },
      }),
    ).toBe(true);
    expect(
      validates(retractSchema, {
        ...scoped,
        contract: "message.retract@1",
        payload: { reasonCode: null, publicReason: null },
      }),
    ).toBe(true);
    expect(
      validates(restoreSchema, {
        ...scoped,
        contract: "message.restore@1",
        payload: {},
      }),
    ).toBe(true);
    expect(
      validates(finalizeErasureSchema, {
        ...scoped,
        contract: "message.finalize-erasure@1",
        actor: { kind: "service", service: "crypto-erasure" },
        payload: { expectedRetractionCommandId: commandId },
      }),
    ).toBe(true);
    expect(
      validates(finalizeErasureSchema, {
        ...scoped,
        contract: "message.finalize-erasure@1",
        payload: { expectedRetractionCommandId: commandId },
      }),
    ).toBe(false);
  });

  it("rejects whitespace-only command topics without trimming meaningful ones", () => {
    const edit = {
      contract: "message.edit@1",
      commandId,
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId },
      payload: {
        content: "edited",
        topic: " \t\n ",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };

    expect(validates(editSchema, edit)).toBe(false);
    expect(
      validates(editSchema, {
        ...edit,
        payload: { ...edit.payload, topic: "  Migration  " },
      }),
    ).toBe(true);

    const post = {
      contract: "message.post@1",
      commandId,
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId },
      payload: {
        content: "posted",
        replyToMessageId: null,
        broadcast: false,
        topic: " \t\n ",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    expect(validates(postSchema, post)).toBe(false);
    expect(
      validates(postSchema, {
        ...post,
        payload: { ...post.payload, topic: "  Migration  " },
      }),
    ).toBe(true);
  });
});
