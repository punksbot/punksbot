import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import reactionSchema from "../schemas/message-reaction.schema.json";
import projectionSchema from "../schemas/message-reaction.projection.schema.json";
import addSchema from "../schemas/message.reaction-add.schema.json";
import responseSchema from "../schemas/message.reaction-mutation-response.schema.json";
import removeSchema from "../schemas/message.reaction-remove.schema.json";
import toggleSchema from "../schemas/message.reaction-toggle.schema.json";
import signedEventSchema from "../schemas/nostr.signed-event.schema.json";

const projectionWithSignedEvent = {
  ...projectionSchema,
  properties: {
    ...projectionSchema.properties,
    event: signedEventSchema,
  },
};

const workspaceId = "00000000-0000-8000-8000-000000000101";
const conversationId = "00000000-0000-8000-8000-000000000102";
const messageId = "00000000-0000-8000-8000-000000000103";
const reactionId = "00000000-0000-8000-8000-000000000104";
const punkId = "00000000-0000-8000-8000-000000000105";
const commandId = "00000000-0000-8000-8000-000000000106";
const timestamp = "2026-08-21T10:00:00.000Z";

function validates(schema: object, value: unknown): boolean {
  return new Validator(schema as never, "2020-12", false).validate(value).valid;
}

function command(contract: string, reaction = "🔥") {
  return {
    contract,
    commandId,
    workspaceId,
    conversationId,
    messageId,
    actor: { kind: "punk", punkId },
    payload: { reaction },
  };
}

function activeReaction() {
  return {
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
    createdAt: timestamp,
    reactedAt: timestamp,
    updatedAt: timestamp,
    removedAt: null,
  };
}

describe("Message Reaction JSON contracts", () => {
  it("accepts strict add, remove, and toggle commands for Punks and Bots", () => {
    expect(validates(addSchema, command("message.reaction-add@1"))).toBe(true);
    expect(
      validates(removeSchema, command("message.reaction-remove@1", "")),
    ).toBe(true);
    expect(
      validates(
        toggleSchema,
        command("message.reaction-toggle@1", ":Party_Parrot:"),
      ),
    ).toBe(true);
    expect(
      validates(addSchema, {
        ...command("message.reaction-add@1"),
        actor: {
          kind: "bot",
          installationId: "00000000-0000-8000-8000-000000000112",
        },
      }),
    ).toBe(true);

    expect(
      validates(addSchema, {
        ...command("message.reaction-add@1"),
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      validates(addSchema, command("message.reaction-add@1", "x".repeat(65))),
    ).toBe(false);
    expect(
      validates(addSchema, command("message.reaction-add@1", "🔥".repeat(64))),
    ).toBe(true);
    expect(
      validates(addSchema, command("message.reaction-add@1", "🔥".repeat(65))),
    ).toBe(false);
    expect(
      validates(addSchema, command("message.reaction-add@1", ":party parrot:")),
    ).toBe(false);
    for (const separator of ["\r", "\n", "\u2028", "\u2029"]) {
      for (const reaction of [
        `${separator}ab`,
        `a${separator}b`,
        `ab${separator}`,
      ]) {
        expect(
          validates(addSchema, command("message.reaction-add@1", reaction)),
        ).toBe(false);
        expect(
          validates(
            removeSchema,
            command("message.reaction-remove@1", reaction),
          ),
        ).toBe(false);
        expect(
          validates(
            toggleSchema,
            command("message.reaction-toggle@1", reaction),
          ),
        ).toBe(false);
      }
    }
  });

  it("validates authoritative state and its removed-state invariant", () => {
    expect(validates(reactionSchema, activeReaction())).toBe(true);
    expect(
      validates(reactionSchema, {
        ...activeReaction(),
        status: "removed",
        revision: 2,
        cursor: 42,
        reactedAt: null,
        removedAt: timestamp,
      }),
    ).toBe(true);
    expect(
      validates(reactionSchema, {
        ...activeReaction(),
        status: "removed",
      }),
    ).toBe(false);
    expect(
      validates(reactionSchema, {
        ...activeReaction(),
        reaction: " 🔥 ",
      }),
    ).toBe(false);
  });

  it("keeps public mutation responses free of internal event and crypto fields", () => {
    const view = {
      id: reactionId,
      workspaceId,
      conversationId,
      messageId,
      actor: { kind: "punk", punkId },
      reaction: "🔥",
      reactedAt: timestamp,
    };
    expect(
      validates(responseSchema, {
        reaction: view,
        effect: "added",
        replayed: false,
      }),
    ).toBe(true);
    expect(
      validates(responseSchema, {
        reaction: { ...view, content: "Message plaintext" },
        effect: "added",
        replayed: false,
      }),
    ).toBe(false);
    expect(
      validates(responseSchema, {
        reaction: view,
        effect: "added",
        replayed: false,
        event: { kind: 50210 },
      }),
    ).toBe(false);
    expect(
      validates(responseSchema, {
        reaction: null,
        effect: "added",
        replayed: true,
      }),
    ).toBe(true);
    expect(
      validates(responseSchema, {
        reaction: view,
        effect: "removed",
        replayed: true,
      }),
    ).toBe(true);
  });

  it("requires a signed event on bounded presence deltas and rejects lifecycle overlays", () => {
    const reaction = {
      ...activeReaction(),
      revision: 2,
      cursor: 42,
      updatedAt: timestamp,
    };
    const delta = {
      operation: "upsert",
      reaction: {
        id: reactionId,
        messageId,
        actor: { kind: "punk", punkId },
        reaction: "🔥",
        reactedAt: timestamp,
      },
    };
    const envelope = {
      contract: "message-reaction.projection@1",
      workspaceId,
      conversationId,
      messageId,
      cursor: 42,
      event: {
        id: "1".repeat(64),
        pubkey: "2".repeat(64),
        created_at: 1_787_310_000,
        kind: 50210,
        tags: [
          ["workspace", workspaceId],
          ["conversation", conversationId],
          ["message", messageId],
          ["reaction_entity", reactionId],
          ["cursor", "42"],
          ["contract", "message.reaction-toggle@1"],
          ["actor", "punk", punkId],
        ],
        content: JSON.stringify({
          schemaVersion: 1,
          reaction,
          projectionDelta: delta,
        }),
        sig: "3".repeat(128),
      },
    };
    expect(
      validates(projectionWithSignedEvent, {
        ...envelope,
        delta,
      }),
    ).toBe(true);
    const { event: _signedEvent, ...withoutEvent } = envelope;
    expect(
      validates(projectionWithSignedEvent, {
        ...withoutEvent,
        delta,
      }),
    ).toBe(false);
    expect(
      validates(projectionWithSignedEvent, {
        ...envelope,
        delta: {
          operation: "set-message-visibility",
          messageId,
          visibility: "permanently-hidden",
        },
      }),
    ).toBe(false);
    expect(
      validates(projectionWithSignedEvent, {
        ...envelope,
        delta: {
          operation: "increment",
          reaction: "🔥",
          countDelta: 1,
        },
      }),
    ).toBe(false);
  });
});
