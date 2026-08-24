import { describe, expect, it } from "vitest";

import {
  canonicalMessageReaction,
  decideAddMessageReaction,
  decideRemoveMessageReaction,
  decideToggleMessageReaction,
  MESSAGE_REACTION_EVENT_KINDS,
  projectVisibleMessageReactionCount,
  type AddMessageReactionCommand,
  type MessageReactionDecisionContext,
  type RemoveMessageReactionCommand,
  type ToggleMessageReactionCommand,
} from "../src/message-reaction";

const workspaceId = "00000000-0000-8000-8000-000000000101";
const conversationId = "00000000-0000-8000-8000-000000000102";
const messageId = "00000000-0000-8000-8000-000000000103";
const reactionId = "00000000-0000-8000-8000-000000000104";
const punkId = "00000000-0000-8000-8000-000000000105";
const commandId = "00000000-0000-8000-8000-000000000106";
const installationId = "00000000-0000-8000-8000-000000000112";
const admissionId = "00000000-0000-8000-8000-000000000117";
const actionId = "00000000-0000-8000-8000-000000000118";
const actionDigest = "ab".repeat(32);

function addCommand(
  overrides: Partial<AddMessageReactionCommand> = {},
): AddMessageReactionCommand {
  return {
    contract: "message.reaction-add@1",
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction: "🔥" },
    ...overrides,
  };
}

function context(
  overrides: Partial<MessageReactionDecisionContext> = {},
): MessageReactionDecisionContext {
  return {
    reactionId,
    cursor: 41,
    authority: { kind: "workspace", workspaceCursor: 7 },
    conversationCursor: 41,
    now: new Date("2026-08-21T10:00:00.000Z"),
    targetMessage: {
      id: messageId,
      workspaceId,
      conversationId,
      status: "active",
    },
    conversation: { status: "active", visibility: "open" },
    authorization: {
      workspaceRole: "member",
      conversationAccess: "member",
      botCapabilities: new Set(),
    },
    priorCommand: null,
    ...overrides,
  };
}

function removeCommand(
  overrides: Partial<RemoveMessageReactionCommand> = {},
): RemoveMessageReactionCommand {
  return {
    contract: "message.reaction-remove@1",
    commandId: "00000000-0000-8000-8000-000000000107",
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction: "🔥" },
    ...overrides,
  };
}

function toggleCommand(
  commandId: string,
  overrides: Partial<ToggleMessageReactionCommand> = {},
): ToggleMessageReactionCommand {
  return {
    contract: "message.reaction-toggle@1",
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction: "🔥" },
    ...overrides,
  };
}

describe("Message Reaction domain", () => {
  it("normalizes Buzz-compatible reactions to one bounded canonical value", () => {
    expect(canonicalMessageReaction("")).toBe("+");
    expect(canonicalMessageReaction("  e\u0301  ")).toBe("é");
    expect(canonicalMessageReaction(":Party_Parrot:")).toBe(":party_parrot:");
    expect(() => canonicalMessageReaction("x".repeat(65))).toThrowError(
      /64 Unicode scalar values/,
    );
    expect(() => canonicalMessageReaction(":party parrot:")).toThrowError(
      /custom Reaction shortcode/,
    );
    for (const separator of ["\r", "\n", "\u2028", "\u2029"]) {
      expect(() => canonicalMessageReaction(`${separator}ab`)).toThrowError(
        /line separators/,
      );
      expect(() => canonicalMessageReaction(`a${separator}b`)).toThrowError(
        /line separators/,
      );
      expect(() => canonicalMessageReaction(`ab${separator}`)).toThrowError(
        /line separators/,
      );
    }
  });

  it("adds one active Reaction through a bounded internal event and idempotent projection delta", () => {
    const decision = decideAddMessageReaction(null, addCommand(), context());

    expect(decision.outcome).toBe("applied");
    expect(decision.effect).toBe("added");
    expect(decision.nextState).toMatchObject({
      id: reactionId,
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId },
      reaction: "🔥",
      status: "active",
      revision: 1,
      createdCursor: 41,
      cursor: 41,
      reactedAt: "2026-08-21T10:00:00.000Z",
    });
    expect(decision.event?.kind).toBe(
      MESSAGE_REACTION_EVENT_KINDS.reactionAdded,
    );
    expect(decision.event?.tags).toEqual(
      expect.arrayContaining([
        ["workspace_cursor", "7"],
        ["conversation_cursor", "41"],
      ]),
    );
    expect(decision.projectionDelta).toEqual({
      operation: "upsert",
      reaction: {
        id: reactionId,
        messageId,
        actor: { kind: "punk", punkId },
        reaction: "🔥",
        reactedAt: "2026-08-21T10:00:00.000Z",
      },
    });
    expect(decision.event?.content).not.toContain("contentKey");
    expect(decision.event?.content).not.toContain("ciphertext");
  });

  it("records a Bot Installation authority cursor without claiming a Workspace cursor", () => {
    const botContext = {
      ...context({
        authorization: {
          workspaceRole: null,
          conversationAccess: "member",
          botCapabilities: new Set(["messages.react"]),
        },
      }),
      authority: {
        kind: "bot-installation",
        installationCursor: 17,
        admissionId,
        actionId,
        actionDigest,
      },
    } as unknown as MessageReactionDecisionContext;
    const decision = decideAddMessageReaction(
      null,
      addCommand({ actor: { kind: "bot", installationId } }),
      botContext,
    );

    expect(decision.event?.tags).toEqual([
      ["workspace", workspaceId],
      ["conversation", conversationId],
      ["message", messageId],
      ["reaction_entity", reactionId],
      ["cursor", "41"],
      ["installation_cursor", "17"],
      ["admission", admissionId],
      ["action", actionId, actionDigest],
      ["conversation_cursor", "41"],
      ["command", commandId],
      ["contract", "message.reaction-add@1"],
      ["actor", "bot", installationId],
    ]);
    expect(decision.event?.tags).not.toContainEqual([
      "workspace_cursor",
      expect.any(String),
    ]);
  });

  it("replays the same add command without a second event and rejects commandId reuse", () => {
    const first = decideAddMessageReaction(null, addCommand(), context());
    const replay = decideAddMessageReaction(
      first.nextState,
      addCommand(),
      context({ priorCommand: first.commandRecord, cursor: 42 }),
    );

    expect(replay).toMatchObject({
      outcome: "idempotent",
      effect: "added",
      event: null,
      projectionDelta: null,
      nextState: first.nextState,
    });
    expect(
      decideAddMessageReaction(
        first.nextState,
        addCommand(),
        context({
          priorCommand: first.commandRecord,
          cursor: 43,
          conversation: { status: "archived", visibility: "open" },
          targetMessage: {
            id: messageId,
            workspaceId,
            conversationId,
            status: "retracted",
          },
        }),
      ),
    ).toMatchObject({
      outcome: "idempotent",
      effect: "added",
      event: null,
      projectionDelta: null,
    });

    expect(() =>
      decideAddMessageReaction(
        first.nextState,
        addCommand({ payload: { reaction: "👍" } }),
        context({ priorCommand: first.commandRecord, cursor: 42 }),
      ),
    ).toThrowError(/commandId is already bound/);
  });

  it("removes and toggles the unique actor-Message-Reaction coordinate idempotently", () => {
    const added = decideAddMessageReaction(null, addCommand(), context());
    const removed = decideRemoveMessageReaction(
      added.nextState,
      removeCommand(),
      context({ cursor: 42 }),
    );

    expect(removed).toMatchObject({
      outcome: "applied",
      effect: "removed",
      nextState: {
        id: reactionId,
        status: "removed",
        revision: 2,
        cursor: 42,
        reactedAt: null,
        removedAt: "2026-08-21T10:00:00.000Z",
      },
      projectionDelta: {
        operation: "remove",
        reactionId,
        messageId,
        actor: { kind: "punk", punkId },
        reaction: "🔥",
      },
    });
    expect(removed.event?.kind).toBe(
      MESSAGE_REACTION_EVENT_KINDS.reactionRemoved,
    );
    expect(
      decideRemoveMessageReaction(
        removed.nextState,
        removeCommand(),
        context({ cursor: 43, priorCommand: removed.commandRecord }),
      ),
    ).toMatchObject({
      outcome: "idempotent",
      effect: "removed",
      event: null,
      projectionDelta: null,
    });

    const restored = decideToggleMessageReaction(
      removed.nextState,
      toggleCommand("00000000-0000-8000-8000-000000000108"),
      context({
        cursor: 43,
        now: new Date("2026-08-21T11:00:00.000Z"),
      }),
    );
    expect(restored).toMatchObject({
      effect: "added",
      nextState: {
        status: "active",
        revision: 3,
        createdCursor: 41,
        cursor: 43,
        reactedAt: "2026-08-21T11:00:00.000Z",
        removedAt: null,
      },
      projectionDelta: {
        operation: "upsert",
        reaction: { reactedAt: "2026-08-21T11:00:00.000Z" },
      },
    });
    expect(
      decideToggleMessageReaction(
        restored.nextState,
        toggleCommand("00000000-0000-8000-8000-000000000108"),
        context({ cursor: 44, priorCommand: restored.commandRecord }),
      ),
    ).toMatchObject({
      outcome: "idempotent",
      effect: "added",
      event: null,
      projectionDelta: null,
    });

    const toggledOff = decideToggleMessageReaction(
      restored.nextState,
      toggleCommand("00000000-0000-8000-8000-000000000109"),
      context({ cursor: 44 }),
    );
    expect(toggledOff).toMatchObject({
      effect: "removed",
      nextState: { status: "removed", revision: 4, cursor: 44 },
      projectionDelta: { operation: "remove" },
    });

    const secondRemove = decideRemoveMessageReaction(
      toggledOff.nextState,
      removeCommand({
        commandId: "00000000-0000-8000-8000-000000000110",
      }),
      context({ cursor: 45 }),
    );
    expect(secondRemove).toMatchObject({
      outcome: "idempotent",
      effect: "unchanged",
      event: null,
      projectionDelta: null,
      nextState: toggledOff.nextState,
    });
  });

  it("binds a remove no-op receipt to the derived Reaction identity", () => {
    const command = removeCommand({
      commandId: "00000000-0000-8000-8000-000000000116",
    });
    const noOp = decideRemoveMessageReaction(null, command, context());

    expect(noOp).toMatchObject({
      outcome: "idempotent",
      effect: "unchanged",
      commandRecord: { reactionId },
    });
    expect(() =>
      decideRemoveMessageReaction(
        null,
        command,
        context({
          priorCommand: noOp.commandRecord,
          reactionId: "00000000-0000-8000-8000-000000000115",
        }),
      ),
    ).toThrowError(/commandId is already bound/);
  });

  it("hides a Message's Reaction collection with one absolute lifecycle delta", () => {
    const punkReaction = decideAddMessageReaction(
      null,
      addCommand(),
      context(),
    ).nextState;
    const botReaction = decideAddMessageReaction(
      null,
      addCommand({
        commandId: "00000000-0000-8000-8000-000000000111",
        actor: {
          kind: "bot",
          installationId: "00000000-0000-8000-8000-000000000112",
        },
      }),
      context({
        reactionId: "00000000-0000-8000-8000-000000000113",
        authorization: {
          workspaceRole: null,
          conversationAccess: "member",
          botCapabilities: new Set(["messages.react"]),
        },
        authority: {
          kind: "bot-installation",
          installationCursor: 17,
          admissionId,
          actionId,
          actionDigest,
        },
      }),
    ).nextState;
    expect(punkReaction).not.toBeNull();
    expect(botReaction).not.toBeNull();
    const activeTarget = context().targetMessage;
    if (activeTarget === null) {
      throw new Error("test target must exist");
    }

    expect(projectVisibleMessageReactionCount(2, activeTarget)).toBe(2);

    const retracted = { ...activeTarget, status: "retracted" as const };
    expect(projectVisibleMessageReactionCount(2, retracted)).toBe(0);

    expect(
      projectVisibleMessageReactionCount(2, {
        ...retracted,
        status: "active",
      }),
    ).toBe(2);

    const erased = { ...activeTarget, status: "erased" as const };
    expect(projectVisibleMessageReactionCount(2, erased)).toBe(0);
  });

  it("fails closed for Bots, guests, foreign coordinates, and non-active Messages", () => {
    const botCommand = addCommand({
      actor: {
        kind: "bot",
        installationId: "00000000-0000-8000-8000-000000000112",
      },
    });
    expect(() =>
      decideAddMessageReaction(null, botCommand, context()),
    ).toThrowError(/messages.react capability/);
    expect(() =>
      decideAddMessageReaction(
        null,
        addCommand(),
        context({
          authorization: {
            workspaceRole: "guest",
            conversationAccess: "guest",
            botCapabilities: new Set(),
          },
        }),
      ),
    ).toThrowError(/writable Conversation access/);
    expect(() =>
      decideAddMessageReaction(
        null,
        addCommand(),
        context({
          targetMessage: {
            id: messageId,
            workspaceId,
            conversationId,
            status: "retracted",
          },
        }),
      ),
    ).toThrowError(/only an active Message/);
    expect(() =>
      decideAddMessageReaction(
        null,
        addCommand(),
        context({
          conversation: { status: "archived", visibility: "open" },
        }),
      ),
    ).toThrowError(/Conversation is not active/);

    expect(
      decideAddMessageReaction(
        null,
        addCommand(),
        context({
          authorization: {
            workspaceRole: "member",
            conversationAccess: null,
            botCapabilities: new Set(),
          },
        }),
      ).effect,
    ).toBe("added");

    const existing = decideAddMessageReaction(
      null,
      addCommand(),
      context(),
    ).nextState;
    expect(() =>
      decideAddMessageReaction(
        existing,
        addCommand({
          commandId: "00000000-0000-8000-8000-000000000114",
        }),
        context({
          reactionId: "00000000-0000-8000-8000-000000000115",
        }),
      ),
    ).toThrowError(/different unique coordinate/);
  });
});
