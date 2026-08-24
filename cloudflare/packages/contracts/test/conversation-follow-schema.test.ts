import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import { contractSchemas } from "../src/registry";
import conversationFollowClientFrameSchema from "../schemas/conversation.follow-client-frame.schema.json";
import conversationFollowServerFrameSchema from "../schemas/conversation.follow-server-frame.schema.json";
import conversationFollowSchema from "../schemas/conversation.follow.schema.json";
import messageViewSchema from "../schemas/message.view.schema.json";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";

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

function activeMessageView() {
  return {
    id: "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974",
    workspaceId,
    conversationId,
    author: {
      kind: "punk",
      punkId: "00000000-0000-8000-8000-000000000002",
    },
    messageType: "stream-message",
    status: "active",
    content: "The public frame carries an authorized view, not an event.",
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974",
    threadDepth: 0,
    broadcast: false,
    replyCount: 2,
    descendantCount: 3,
    lastReplyAt: "2026-08-20T14:00:00.000Z",
    currentVersion: 1,
    retractionKind: null,
    retractedAt: null,
    eraseAfter: null,
    publicReason: null,
    erasedAt: null,
    revision: 3,
    createdCursor: 8,
    cursor: 42,
    createdAt: "2026-08-20T13:00:00.000Z",
    updatedAt: "2026-08-20T14:00:00.000Z",
    editedAt: null,
  };
}

describe("Conversation realtime contracts", () => {
  it("starts following one authorized Conversation after a total cursor", () => {
    const query = {
      contract: "conversation.follow@1",
      workspaceId,
      conversationId,
      afterCursor: 0,
    };

    expect(validates(conversationFollowSchema, query)).toBe(true);
    expect(
      validates(conversationFollowSchema, { ...query, afterCursor: 42 }),
    ).toBe(true);
    expect(
      validates(conversationFollowSchema, { ...query, afterCursor: -1 }),
    ).toBe(false);
    expect(
      validates(conversationFollowSchema, {
        ...query,
        workspaceId: "wrong-scope",
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowSchema, { ...query, unexpected: true }),
    ).toBe(false);
  });

  it("accepts only a bounded acknowledgement from the client", () => {
    const acknowledgement = {
      schemaVersion: 1,
      type: "ack",
      throughCursor: 42,
    };

    expect(
      validates(conversationFollowClientFrameSchema, acknowledgement),
    ).toBe(true);
    expect(
      validates(conversationFollowClientFrameSchema, {
        ...acknowledgement,
        throughCursor: -1,
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowClientFrameSchema, {
        ...acknowledgement,
        type: "message",
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowClientFrameSchema, {
        ...acknowledgement,
        content: "clients cannot publish over the follow socket",
      }),
    ).toBe(false);
  });

  it("opens catch-up with an accepted frame bound to one target high-water", () => {
    const accepted = {
      schemaVersion: 1,
      type: "accepted",
      resumeAfterCursor: 7,
      targetHighWaterCursor: 42,
    };

    expect(validates(conversationFollowServerFrameSchema, accepted)).toBe(true);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...accepted,
        targetHighWaterCursor: -1,
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...accepted,
        event: { kind: 50200 },
      }),
    ).toBe(false);
  });

  it("delivers only authorized Message views and absolute thread patches", () => {
    const changes = {
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 7,
      throughCursor: 42,
      messages: [activeMessageView()],
      threadPatches: [
        {
          messageId: "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974",
          replyCount: 2,
          descendantCount: 3,
          lastReplyAt: "2026-08-20T14:00:00.000Z",
          revision: 3,
          cursor: 42,
        },
      ],
      reactionPatches: [],
      reactionCollectionPatches: [],
    };

    expect(
      validates(conversationFollowServerFrameSchema, changes, [
        messageViewSchema,
      ]),
    ).toBe(true);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          messages: [
            { ...activeMessageView(), ciphertextRef: "secret/object" },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        { ...changes, event: { kind: 50200 } },
        [messageViewSchema],
      ),
    ).toBe(false);
  });

  it("delivers bounded absolute Reaction counts without an actor roster", () => {
    const reactionPatch = {
      messageId: "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974",
      reaction: "🔥",
      count: 2_147_483_647,
      reactedByPunk: true,
      cursor: Number.MAX_SAFE_INTEGER,
    };
    const changes = {
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 7,
      throughCursor: Number.MAX_SAFE_INTEGER,
      messages: [],
      threadPatches: [],
      reactionPatches: [reactionPatch],
      reactionCollectionPatches: [],
    };

    expect(
      validates(conversationFollowServerFrameSchema, changes, [
        messageViewSchema,
      ]),
    ).toBe(true);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionPatches: [{ ...reactionPatch, count: 0, cursor: 1 }],
        },
        [messageViewSchema],
      ),
    ).toBe(true);
    for (const count of [-1, 0.5, 2_147_483_648]) {
      expect(
        validates(
          conversationFollowServerFrameSchema,
          {
            ...changes,
            reactionPatches: [{ ...reactionPatch, count }],
          },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionPatches: [
            { ...reactionPatch, cursor: Number.MAX_SAFE_INTEGER + 1 },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    for (const reaction of [
      " leading",
      "trailing ",
      ":Upper:",
      "line\nbreak",
    ]) {
      expect(
        validates(
          conversationFollowServerFrameSchema,
          {
            ...changes,
            reactionPatches: [{ ...reactionPatch, reaction }],
          },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
    const boundedReactionPatches = Array.from({ length: 100 }, (_, index) => ({
      ...reactionPatch,
      messageId: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      cursor: index + 1,
    }));
    expect(
      validates(
        conversationFollowServerFrameSchema,
        { ...changes, reactionPatches: boundedReactionPatches },
        [messageViewSchema],
      ),
    ).toBe(true);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionPatches: [
            ...boundedReactionPatches,
            {
              ...reactionPatch,
              messageId: "a0000000-0000-4000-8000-000000000100",
              cursor: 101,
            },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    for (const forbidden of [
      { punkId: "00000000-0000-8000-8000-000000000002" },
      {
        actor: { kind: "punk", punkId: "00000000-0000-8000-8000-000000000002" },
      },
      { actors: [] },
      { reactionIds: [] },
      { event: { kind: 7 } },
      { contentKeyId: "secret" },
    ]) {
      expect(
        validates(
          conversationFollowServerFrameSchema,
          {
            ...changes,
            reactionPatches: [{ ...reactionPatch, ...forbidden }],
          },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
    const { reactionPatches: _reactionPatches, ...withoutReactionPatches } =
      changes;
    expect(
      validates(conversationFollowServerFrameSchema, withoutReactionPatches, [
        messageViewSchema,
      ]),
    ).toBe(false);
  });

  it("delivers bounded Reaction collection visibility without identities", () => {
    const collectionPatch = {
      messageId: "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974",
      visibility: "temporarily-hidden",
      cursor: Number.MAX_SAFE_INTEGER,
      refreshRequired: true,
    };
    const changes = {
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 7,
      throughCursor: Number.MAX_SAFE_INTEGER,
      messages: [],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [collectionPatch],
    };

    for (const visibility of [
      "visible",
      "temporarily-hidden",
      "permanently-hidden",
    ]) {
      expect(
        validates(
          conversationFollowServerFrameSchema,
          {
            ...changes,
            reactionCollectionPatches: [{ ...collectionPatch, visibility }],
          },
          [messageViewSchema],
        ),
      ).toBe(true);
    }
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionCollectionPatches: [
            { ...collectionPatch, visibility: "removed" },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionCollectionPatches: [
            { ...collectionPatch, cursor: Number.MAX_SAFE_INTEGER + 1 },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionCollectionPatches: [{ ...collectionPatch, cursor: 0 }],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    const boundedCollectionPatches = Array.from(
      { length: 100 },
      (_, index) => ({
        ...collectionPatch,
        messageId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        cursor: index + 1,
      }),
    );
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionCollectionPatches: boundedCollectionPatches,
        },
        [messageViewSchema],
      ),
    ).toBe(true);
    expect(
      validates(
        conversationFollowServerFrameSchema,
        {
          ...changes,
          reactionCollectionPatches: [
            ...boundedCollectionPatches,
            {
              ...collectionPatch,
              messageId: "d0000000-0000-4000-8000-000000000100",
              cursor: 101,
            },
          ],
        },
        [messageViewSchema],
      ),
    ).toBe(false);
    for (const forbidden of [
      { punkId: "00000000-0000-8000-8000-000000000002" },
      { actorIds: [] },
      { roster: [] },
      { event: { kind: 50204 } },
      { contentCommitment: "0".repeat(64) },
    ]) {
      expect(
        validates(
          conversationFollowServerFrameSchema,
          {
            ...changes,
            reactionCollectionPatches: [{ ...collectionPatch, ...forbidden }],
          },
          [messageViewSchema],
        ),
      ).toBe(false);
    }
    const {
      reactionCollectionPatches: _reactionCollectionPatches,
      ...withoutReactionCollectionPatches
    } = changes;
    expect(
      validates(
        conversationFollowServerFrameSchema,
        withoutReactionCollectionPatches,
        [messageViewSchema],
      ),
    ).toBe(false);
  });

  it("may advance the public cursor across a transition with no visible Message payload", () => {
    const cursorAdvance = {
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: 42,
      throughCursor: 43,
      messages: [],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [],
    };

    expect(
      validates(conversationFollowServerFrameSchema, cursorAdvance, [
        messageViewSchema,
      ]),
    ).toBe(true);
  });

  it("marks the exact high-water at which catch-up becomes live", () => {
    const ready = {
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 42,
    };

    expect(validates(conversationFollowServerFrameSchema, ready)).toBe(true);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...ready,
        highWaterCursor: -1,
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...ready,
        rawOutbox: true,
      }),
    ).toBe(false);
  });

  it("requires an explicit resumable resync when hot history or backpressure is exhausted", () => {
    const historyResync = {
      schemaVersion: 1,
      type: "resync-required",
      reason: "history_required",
      afterCursor: 7,
      highWaterCursor: 42,
    };

    expect(validates(conversationFollowServerFrameSchema, historyResync)).toBe(
      true,
    );
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...historyResync,
        reason: "slow_consumer",
      }),
    ).toBe(true);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...historyResync,
        reason: "internal_error",
      }),
    ).toBe(false);
  });

  it("terminates every follower with one content-free frame when the Conversation is archived", () => {
    const unavailable = {
      schemaVersion: 1,
      type: "conversation-unavailable",
      reason: "archived",
      cursor: 43,
    };

    expect(validates(conversationFollowServerFrameSchema, unavailable)).toBe(
      true,
    );
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...unavailable,
        reason: "revoked",
      }),
    ).toBe(false);
    expect(
      validates(conversationFollowServerFrameSchema, {
        ...unavailable,
        message: activeMessageView(),
      }),
    ).toBe(false);
  });

  it("publishes every realtime seam through the language-independent registry", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/conversation.follow@1",
        "punks://contracts/conversation.follow-client-frame@1",
        "punks://contracts/conversation.follow-server-frame@1",
      ]),
    );
  });
});
