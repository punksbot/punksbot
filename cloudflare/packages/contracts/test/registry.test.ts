import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";
import registry from "../registry.json";

describe("contract registry", () => {
  it("has a unique canonical id for every loaded schema", () => {
    const ids = Object.keys(contractSchemas);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, schema] of Object.entries(contractSchemas)) {
      expect(schema.$id).toBe(id);
    }
  });

  it("loads the authorized Message view and bounded history contracts", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([
        "punks://contracts/message.view@1",
        "punks://contracts/message.history@1",
        "punks://contracts/message.history-response@1",
      ]),
    );
  });

  it("validates the registry manifest with its own canonical schema", () => {
    expect(validateContract("punks://contracts/registry@1", registry)).toEqual({
      valid: true,
    });
    expect(registry.contracts.map(({ id }) => id).sort()).toEqual(
      Object.keys(contractSchemas)
        .filter((id) => id !== "punks://contracts/registry@1")
        .sort(),
    );
  });

  it("accepts a valid Workspace create command", () => {
    expect(
      validateContract("punks://contracts/workspace.create@1", {
        contract: "workspace.create@1",
        commandId: "b1f940d5-8e13-49f1-bde3-778ecabbec36",
        actor: { kind: "punk", punkId: "punk_01" },
        payload: {
          slug: "core-team",
          name: "Core Team",
          visibility: "private",
        },
      }),
    ).toEqual({ valid: true });
  });

  it("rejects unknown fields and malformed slugs", () => {
    const result = validateContract("punks://contracts/workspace.create@1", {
      contract: "workspace.create@1",
      commandId: "b1f940d5-8e13-49f1-bde3-778ecabbec36",
      actor: { kind: "punk", punkId: "punk_01" },
      payload: {
        slug: "Core Team",
        name: "Core Team",
        visibility: "private",
        leakedCapability: true,
      },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts an auth start command with a local return path", () => {
    expect(
      validateContract("punks://contracts/auth.start@1", {
        contract: "auth.start@1",
        provider: "github",
        intent: "sign_in",
        returnTo: "/inbox",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects an external auth return URL", () => {
    expect(
      validateContract("punks://contracts/auth.start@1", {
        contract: "auth.start@1",
        provider: "google",
        intent: "sign_in",
        returnTo: "https://attacker.example/phish",
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/auth.start@1", {
        contract: "auth.start@1",
        provider: "github",
        intent: "sign_in",
        returnTo: "/\\attacker.example/phish",
      }).valid,
    ).toBe(false);
  });

  it("validates a Conversation state and its Queue projection envelope", () => {
    const state = {
      id: "e3a92f8d-f013-46b7-9370-5ca1c79b6280",
      workspaceId: "58975ca8-3b75-42c7-a13a-51c9d7306200",
      name: "general",
      type: "stream",
      visibility: "open",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      maxMembers: null,
      ttlSeconds: null,
      ttlDeadline: null,
      ownerPunkId: "punk_owner",
      members: [
        {
          punkId: "punk_owner",
          access: "owner",
          joinedAt: "2026-08-20T13:00:00.000Z",
          invitedByPunkId: null,
        },
      ],
      status: "active",
      revision: 1,
      cursor: 1,
      createdAt: "2026-08-20T13:00:00.000Z",
      updatedAt: "2026-08-20T13:00:00.000Z",
      archivedAt: null,
    };
    expect(validateContract("punks://contracts/conversation@1", state)).toEqual(
      { valid: true },
    );
    expect(
      validateContract("punks://contracts/conversation.projection@1", {
        schemaVersion: 1,
        workspaceId: state.workspaceId,
        conversationId: state.id,
        cursor: 1,
        event: {
          id: "1".repeat(64),
          pubkey: "2".repeat(64),
          created_at: 1_787_230_800,
          kind: 50100,
          tags: [["conversation", state.id]],
          content: JSON.stringify({ schemaVersion: 1, conversation: state }),
          sig: "3".repeat(128),
        },
        state,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts an atomic Conversation metadata command and rejects an empty patch", () => {
    const command = {
      contract: "conversation.update@1",
      commandId: "f2d9dfcb-0a19-4912-8798-6e1b28ad9cf9",
      workspaceId: "58975ca8-3b75-42c7-a13a-51c9d7306200",
      conversationId: "e3a92f8d-f013-46b7-9370-5ca1c79b6280",
      actor: { kind: "punk", punkId: "punk_owner" },
      payload: {
        name: "incidents",
        description: null,
        visibility: "private",
        topic: "Database saturation",
        purpose: "Coordinate mitigation",
        topicRequired: true,
        maxMembers: 25,
        ttlSeconds: 120,
      },
    };
    expect(
      validateContract("punks://contracts/conversation.update@1", command),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/conversation.update@1", {
        ...command,
        payload: {},
      }).valid,
    ).toBe(false);
  });

  it("binds archived Conversation journal segments to their aggregate", () => {
    const archive = {
      schemaVersion: 1,
      workspaceId: "58975ca8-3b75-42c7-a13a-51c9d7306200",
      conversationId: "e3a92f8d-f013-46b7-9370-5ca1c79b6280",
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
      segmentHash: "1".repeat(64),
      events: [
        {
          id: "2".repeat(64),
          pubkey: "3".repeat(64),
          created_at: 1_787_230_800,
          kind: 50100,
          tags: [
            ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
            ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
          ],
          content: "{}",
          sig: "4".repeat(128),
        },
      ],
      seal: {
        id: "5".repeat(64),
        pubkey: "6".repeat(64),
        created_at: 1_787_230_800,
        kind: 50104,
        tags: [
          ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
          ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
        ],
        content: "{}",
        sig: "7".repeat(128),
      },
    };
    expect(
      validateContract(
        "punks://contracts/conversation.journal-segment@1",
        archive,
      ),
    ).toEqual({ valid: true });
    const withoutConversation: Record<string, unknown> = { ...archive };
    delete withoutConversation.conversationId;
    expect(
      validateContract(
        "punks://contracts/conversation.journal-segment@1",
        withoutConversation,
      ).valid,
    ).toBe(false);
  });
});
