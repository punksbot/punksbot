import { describe, expect, it } from "vitest";

import {
  decideEditMessage,
  decideFinalizeMessageErasure,
  decidePostMessage,
  decideRestoreMessage,
  decideRetractMessage,
  MESSAGE_ERASURE_GRACE_MS,
  MESSAGE_EVENT_KINDS,
  MessageDomainError,
  type EditMessageCommand,
  type FinalizeMessageErasureCommand,
  type Message,
  type MessageActor,
  type MessageWriteDecisionContext,
  type PostMessageCommand,
  type RestoreMessageCommand,
  type RetractMessageCommand,
} from "../src/message";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const rootMessageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
const replyMessageId = "b6fa007d-c4bf-4677-b8a5-bc42b795c710";
const nestedMessageId = "fe12da22-cc89-4051-9ab7-faf327dc4c16";
const ownerId = "00000000-0000-8000-8000-000000000001";
const memberId = "00000000-0000-8000-8000-000000000002";
const moderatorId = "00000000-0000-8000-8000-000000000003";
const otherId = "00000000-0000-8000-8000-000000000004";
const installationId = "00000000-0000-8000-8000-000000000101";
const now = new Date("2026-08-20T14:00:00.000Z");

const member: MessageActor = { kind: "punk", punkId: memberId };
const moderator: MessageActor = { kind: "punk", punkId: moderatorId };
const bot: MessageActor = { kind: "bot", installationId };

const rootPost: PostMessageCommand = {
  contract: "message.post@1",
  commandId: "57a0a439-bacc-41a8-ac78-7393b4938fa8",
  workspaceId,
  conversationId,
  actor: member,
  payload: {
    content: "A root message",
    replyToMessageId: null,
    broadcast: false,
    topic: "Migration",
    mentionedPunkIds: [ownerId],
    mediaIds: [],
  },
};

function prepared(version = 1, suffix = "root", topicPresent = true) {
  return {
    version,
    contentCommitment: `${version}`.repeat(64),
    ciphertextRef: `r2://punks-message/${suffix}/${version}`,
    contentKeyId: `message-key-${suffix}-${version}`,
    topicPresent,
  };
}

function context(
  messageId: string,
  overrides: Partial<MessageWriteDecisionContext> = {},
): MessageWriteDecisionContext {
  return {
    messageId,
    cursor: 1,
    now,
    workspaceCursor: 11,
    conversationCursor: 7,
    conversation: {
      type: "stream",
      visibility: "open",
      status: "active",
      topicRequired: false,
    },
    authorization: {
      workspaceRole: "member",
      conversationAccess: "member",
      botCapabilities: new Set(),
    },
    preparedContent: prepared(),
    parentMessage: null,
    threadRootMessage: null,
    ...overrides,
  };
}

function postRoot(
  command: PostMessageCommand = rootPost,
  overrides: Partial<MessageWriteDecisionContext> = {},
): Message {
  return decidePostMessage(null, command, context(rootMessageId, overrides))
    .nextState;
}

function replyPost(parent: Message): PostMessageCommand {
  return {
    ...rootPost,
    commandId: "adf06c80-1e81-453e-8c1b-64c98a9cd7a6",
    payload: {
      ...rootPost.payload,
      content: "A reply",
      replyToMessageId: parent.id,
      topic: null,
      mentionedPunkIds: [],
    },
  };
}

describe("Message and thread decisions", () => {
  it("posts an encrypted-reference root without putting plaintext in the journal", () => {
    const decision = decidePostMessage(null, rootPost, context(rootMessageId));

    expect(decision.outcome).toBe("applied");
    expect(decision.nextState).toMatchObject({
      id: rootMessageId,
      workspaceId,
      conversationId,
      author: member,
      messageType: "stream-message",
      status: "active",
      parentMessageId: null,
      threadRootMessageId: rootMessageId,
      threadDepth: 0,
      replyCount: 0,
      descendantCount: 0,
      currentVersion: 1,
      contentVersions: [
        expect.objectContaining({
          version: 1,
          ciphertextRef: "r2://punks-message/root/1",
          contentKeyId: "message-key-root-1",
        }),
      ],
    });
    expect(decision.event?.kind).toBe(MESSAGE_EVENT_KINDS.messagePosted);
    expect(decision.event?.tags).toContainEqual(["workspace", workspaceId]);
    expect(decision.event?.tags).toContainEqual([
      "conversation",
      conversationId,
    ]);
    expect(decision.event?.tags).toContainEqual(["message", rootMessageId]);
    expect(decision.event?.content).not.toContain("A root message");
    const eventBody = JSON.parse(decision.event?.content ?? "null") as {
      message: Record<string, unknown>;
      versionDelta: { operation: string; version: { version: number } };
    };
    expect(eventBody.message).not.toHaveProperty("contentVersions");
    expect(eventBody.message).not.toHaveProperty("topic");
    expect(eventBody.versionDelta).toMatchObject({
      operation: "upsert",
      version: { version: 1 },
    });
    expect(decision.threadDeltas).toEqual([]);
  });

  it("derives nested ancestry and emits exact direct/descendant counter deltas", () => {
    const root = postRoot();
    const direct = decidePostMessage(
      null,
      replyPost(root),
      context(replyMessageId, {
        cursor: 2,
        preparedContent: prepared(1, "reply", false),
        parentMessage: root,
        threadRootMessage: root,
      }),
    );

    expect(direct.nextState).toMatchObject({
      parentMessageId: rootMessageId,
      threadRootMessageId: rootMessageId,
      threadDepth: 1,
    });
    expect(direct.threadDeltas).toEqual([
      { messageId: rootMessageId, replyCountDelta: 1 },
      { messageId: rootMessageId, descendantCountDelta: 1 },
    ]);

    const nested = decidePostMessage(
      null,
      replyPost(direct.nextState),
      context(nestedMessageId, {
        cursor: 3,
        preparedContent: prepared(1, "nested", false),
        parentMessage: direct.nextState,
        threadRootMessage: root,
      }),
    );
    expect(nested.nextState).toMatchObject({
      parentMessageId: replyMessageId,
      threadRootMessageId: rootMessageId,
      threadDepth: 2,
    });
    expect(nested.threadDeltas).toEqual([
      { messageId: replyMessageId, replyCountDelta: 1 },
      { messageId: rootMessageId, descendantCountDelta: 1 },
    ]);
    expect(nested.event?.tags).toContainEqual(["parent", replyMessageId]);
    expect(nested.event?.tags).toContainEqual(["root", rootMessageId]);
  });

  it("rejects replies across Conversation boundaries and depth beyond Punks's limit", () => {
    const root = postRoot();
    const wrongConversation = {
      ...root,
      conversationId: "a7fe9b41-6db2-4b10-b0bd-eaaf63ffb296",
    };
    expect(() =>
      decidePostMessage(
        null,
        replyPost(wrongConversation),
        context(replyMessageId, {
          parentMessage: wrongConversation,
          threadRootMessage: wrongConversation,
        }),
      ),
    ).toThrow(MessageDomainError);

    const depth100 = { ...root, threadDepth: 100 };
    expect(() =>
      decidePostMessage(
        null,
        replyPost(depth100),
        context(replyMessageId, {
          parentMessage: depth100,
          threadRootMessage: root,
        }),
      ),
    ).toThrowError(/depth limit/i);
  });

  it("evaluates contextual Punk access and denies Bots unless explicitly capable", () => {
    expect(() =>
      decidePostMessage(
        null,
        rootPost,
        context(rootMessageId, {
          conversation: {
            type: "stream",
            visibility: "private",
            status: "active",
            topicRequired: false,
          },
          authorization: {
            workspaceRole: "member",
            conversationAccess: null,
            botCapabilities: new Set(),
          },
        }),
      ),
    ).toThrowError(/Conversation access/i);

    expect(() =>
      decidePostMessage(
        null,
        rootPost,
        context(rootMessageId, {
          authorization: {
            workspaceRole: "guest",
            conversationAccess: "member",
            botCapabilities: new Set(),
          },
        }),
      ),
    ).toThrowError(/permission/i);

    const botCommand: PostMessageCommand = { ...rootPost, actor: bot };
    expect(() =>
      decidePostMessage(null, botCommand, context(rootMessageId)),
    ).toThrowError(/capability/i);

    expect(
      decidePostMessage(
        null,
        botCommand,
        context(rootMessageId, {
          authorization: {
            workspaceRole: null,
            conversationAccess: "member",
            botCapabilities: new Set(["messages.write"]),
          },
        }),
      ).nextState.author,
    ).toEqual(bot);
  });

  it("makes an identical post retry a no-op and rejects a conflicting reuse", () => {
    const current = postRoot();
    const retried = decidePostMessage(
      current,
      rootPost,
      context(rootMessageId),
    );
    expect(retried).toMatchObject({
      outcome: "idempotent",
      event: null,
      nextState: current,
      threadDeltas: [],
    });

    expect(() =>
      decidePostMessage(
        current,
        { ...rootPost, payload: { ...rootPost.payload, topic: "Other" } },
        context(rootMessageId, {
          preparedContent: {
            ...prepared(),
            contentCommitment: "f".repeat(64),
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "idempotency_conflict" }));
  });

  it("edits only the author's active message and treats equal content as idempotent", () => {
    const current = postRoot();
    const command: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "56f7dbef-b959-4994-b48d-ed3a0f524b17",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: member,
      payload: {
        content: "Edited",
        topic: "Migration",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const edited = decideEditMessage(current, command, {
      ...context(rootMessageId),
      cursor: 2,
      preparedContent: prepared(2, "root"),
    });
    expect(edited.nextState).toMatchObject({
      currentVersion: 2,
      revision: 2,
      editedAt: now.toISOString(),
    });
    expect(edited.nextState.contentVersions).toHaveLength(2);
    expect(edited.event?.kind).toBe(MESSAGE_EVENT_KINDS.messageEdited);

    expect(() =>
      decideEditMessage(
        current,
        { ...command, payload: { ...command.payload, topic: null } },
        {
          ...context(rootMessageId, {
            preparedContent: { ...prepared(2, "root"), topicPresent: false },
          }),
          conversation: {
            ...context(rootMessageId).conversation,
            topicRequired: true,
          },
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_transition" }));

    expect(() =>
      decideEditMessage(
        {
          ...current,
          currentVersion: 1_000,
          contentVersions: [
            {
              ...(current.contentVersions[0] ?? {
                ...prepared(),
                createdAt: now.toISOString(),
              }),
              version: 1_000,
            },
          ],
        },
        command,
        {
          ...context(rootMessageId),
          preparedContent: prepared(1_001, "root"),
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_transition" }));

    const equal = decideEditMessage(edited.nextState, command, {
      ...context(rootMessageId),
      cursor: 3,
      preparedContent: prepared(2, "different-encryption-retry"),
    });
    expect(equal.outcome).toBe("idempotent");
    expect(equal.event).toBeNull();

    expect(() =>
      decideEditMessage(
        current,
        { ...command, actor: { kind: "punk", punkId: otherId } },
        { ...context(rootMessageId), preparedContent: prepared(2, "other") },
      ),
    ).toThrowError(/author/i);
  });

  it("rejects a whitespace-only topic when editing a root that requires one", () => {
    const current = postRoot();
    const command: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "ad2a3172-11da-4e05-bf25-6499aa45aa16",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: member,
      payload: {
        content: "Edited",
        topic: " \t\n ",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const editContext = {
      ...context(rootMessageId),
      cursor: 2,
      conversation: {
        ...context(rootMessageId).conversation,
        topicRequired: true,
      },
      preparedContent: prepared(2, "root"),
    };

    expect(() => decideEditMessage(current, command, editContext)).toThrowError(
      expect.objectContaining({ code: "invalid_transition" }),
    );
    expect(() =>
      decideEditMessage(
        current,
        {
          ...command,
          payload: { ...command.payload, topic: "  Migration  " },
        },
        editContext,
      ),
    ).not.toThrow();
  });

  it("retracts immediately, schedules seven-day erasure, and decrements thread counts once", () => {
    const root = postRoot();
    const reply = decidePostMessage(
      null,
      replyPost(root),
      context(replyMessageId, {
        preparedContent: prepared(1, "reply", false),
        parentMessage: root,
        threadRootMessage: root,
      }),
    ).nextState;
    const command: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "589433da-5c94-45e1-851a-737c9b09c1c1",
      workspaceId,
      conversationId,
      messageId: reply.id,
      actor: member,
      payload: { reasonCode: "author-request", publicReason: null },
    };
    const retracted = decideRetractMessage(
      reply,
      command,
      context(replyMessageId),
    );
    expect(retracted.nextState).toMatchObject({
      status: "retracted",
      retraction: {
        kind: "author",
        requestedAt: now.toISOString(),
        eraseAfter: new Date(
          now.getTime() + MESSAGE_ERASURE_GRACE_MS,
        ).toISOString(),
      },
    });
    expect(retracted.event?.kind).toBe(MESSAGE_EVENT_KINDS.messageRetracted);
    expect(retracted.threadDeltas).toEqual([
      { messageId: rootMessageId, replyCountDelta: -1 },
      { messageId: rootMessageId, descendantCountDelta: -1 },
    ]);

    expect(() =>
      decideRetractMessage(
        retracted.nextState,
        { ...command, commandId: "f6f2b13d-d2e7-47a6-a1d9-2ccf4d2f6e1f" },
        context(replyMessageId, { cursor: 4 }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_transition",
        message: expect.stringMatching(/already retracted/i),
      }),
    );
  });

  it("keeps a moderation retraction restorable only by a current moderator", () => {
    const current = postRoot();
    const retract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "3e13076f-5b68-4c7d-aa1a-fb27176de204",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: moderator,
      payload: {
        reasonCode: "workspace-rules",
        publicReason: "Workspace rules",
      },
    };
    const retracted = decideRetractMessage(current, retract, {
      ...context(rootMessageId),
      authorization: {
        workspaceRole: "moderator",
        conversationAccess: null,
        botCapabilities: new Set(),
      },
    }).nextState;
    expect(retracted.retraction?.kind).toBe("moderation");

    const restore: RestoreMessageCommand = {
      contract: "message.restore@1",
      commandId: "839568fc-7c86-43ed-937b-b2901035607d",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: member,
      payload: {},
    };
    expect(() =>
      decideRestoreMessage(retracted, restore, context(rootMessageId)),
    ).toThrowError(/moderation/i);

    const restored = decideRestoreMessage(
      retracted,
      { ...restore, actor: moderator },
      {
        ...context(rootMessageId),
        authorization: {
          workspaceRole: "moderator",
          conversationAccess: null,
          botCapabilities: new Set(),
        },
      },
    );
    expect(restored.nextState).toMatchObject({
      status: "active",
      retraction: null,
    });
    expect(restored.event?.kind).toBe(MESSAGE_EVENT_KINDS.messageRestored);
  });

  it("restores an author retraction before, but never at or after, the deadline", () => {
    const current = postRoot();
    const retract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "c69701b8-4ce3-481f-8527-c9130db74dfa",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: member,
      payload: { reasonCode: null, publicReason: null },
    };
    const retracted = decideRetractMessage(
      current,
      retract,
      context(rootMessageId),
    ).nextState;
    const restore: RestoreMessageCommand = {
      contract: "message.restore@1",
      commandId: "a4d917ab-7f27-4c06-8535-e7ded6e1c72a",
      workspaceId,
      conversationId,
      messageId: current.id,
      actor: member,
      payload: {},
    };

    expect(
      decideRestoreMessage(retracted, restore, {
        ...context(rootMessageId),
        now: new Date(now.getTime() + MESSAGE_ERASURE_GRACE_MS - 1),
      }).nextState.status,
    ).toBe("active");
    expect(() =>
      decideRestoreMessage(retracted, restore, {
        ...context(rootMessageId),
        now: new Date(now.getTime() + MESSAGE_ERASURE_GRACE_MS),
      }),
    ).toThrowError(expect.objectContaining({ code: "grace_expired" }));
  });

  it("finalizes erasure only after every version key is confirmed destroyed", () => {
    const original = postRoot();
    const edit: EditMessageCommand = {
      contract: "message.edit@1",
      commandId: "5a10d365-41cd-415a-ab51-3567e5790653",
      workspaceId,
      conversationId,
      messageId: original.id,
      actor: member,
      payload: {
        content: "Edited",
        topic: "Migration",
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const edited = decideEditMessage(original, edit, {
      ...context(rootMessageId),
      preparedContent: prepared(2, "root"),
      cursor: 2,
    }).nextState;
    const retract: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: "e252d4d2-3f45-4734-bd88-021518ace492",
      workspaceId,
      conversationId,
      messageId: original.id,
      actor: member,
      payload: { reasonCode: null, publicReason: null },
    };
    const retracted = decideRetractMessage(edited, retract, {
      ...context(rootMessageId),
      cursor: 3,
    }).nextState;
    const finalize: FinalizeMessageErasureCommand = {
      contract: "message.finalize-erasure@1",
      commandId: "012584f4-04a9-4ef0-a080-d480368cc42f",
      workspaceId,
      conversationId,
      messageId: original.id,
      actor: { kind: "service", service: "crypto-erasure" },
      payload: { expectedRetractionCommandId: retract.commandId },
    };
    const due = new Date(now.getTime() + MESSAGE_ERASURE_GRACE_MS);

    expect(() =>
      decideFinalizeMessageErasure(retracted, finalize, {
        cursor: 4,
        now: new Date(due.getTime() - 1),
        destroyedContentKeyIds: ["message-key-root-1", "message-key-root-2"],
      }),
    ).toThrowError(/not due/i);
    expect(() =>
      decideFinalizeMessageErasure(retracted, finalize, {
        cursor: 4,
        now: due,
        destroyedContentKeyIds: ["message-key-root-2"],
      }),
    ).toThrowError(/every content key/i);

    const erased = decideFinalizeMessageErasure(retracted, finalize, {
      cursor: 4,
      now: due,
      destroyedContentKeyIds: ["message-key-root-2", "message-key-root-1"],
    });
    expect(erased.nextState).toMatchObject({
      status: "erased",
      originalContentCommitment: null,
      currentVersion: null,
      contentVersions: [],
      retraction: null,
      erasureMarker: {
        erasedAt: due.toISOString(),
        retractedAt: now.toISOString(),
        destroyedVersionCount: 2,
      },
    });
    expect(erased.event?.kind).toBe(MESSAGE_EVENT_KINDS.messageErasureMarked);
    expect(erased.event?.content).not.toContain("ciphertextRef");
    expect(erased.event?.content).not.toContain("contentKeyId");

    expect(
      decideFinalizeMessageErasure(retracted, finalize, {
        cursor: 4,
        now: due,
        destroyedContentKeyIds: [
          "message-key-root-1",
          "message-key-root-2",
          "orphaned-edit-key",
        ],
      }).nextState.erasureMarker?.destroyedVersionCount,
    ).toBe(2);

    const repeated = decideFinalizeMessageErasure(erased.nextState, finalize, {
      cursor: 5,
      now: due,
      destroyedContentKeyIds: [],
    });
    expect(repeated.outcome).toBe("idempotent");
    expect(repeated.event).toBeNull();
  });
});
