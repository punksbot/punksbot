import type {
  ArchiveConversationCommand,
  Conversation,
  CreateConversationCommand,
  JoinConversationCommand,
  RemoveConversationMemberCommand,
  RestoreConversationCommand,
  SetConversationMemberAccessCommand,
  UpdateConversationCommand,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_EVENT_KINDS,
  ConversationDomainError,
  decideArchiveConversation,
  decideCreateConversation,
  decideJoinConversation,
  decideRemoveConversationMember,
  decideRestoreConversation,
  decideSetConversationMemberAccess,
  decideUpdateConversation,
  type WorkspaceRole,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const ownerId = "00000000-0000-8000-8000-000000000001";
const memberId = "00000000-0000-8000-8000-000000000002";
const now = new Date("2026-08-20T13:00:00.000Z");

const createCommand: CreateConversationCommand = {
  contract: "conversation.create@1",
  commandId: "786ed512-b403-4aab-b397-f5c4eab4d797",
  workspaceId,
  actor: { kind: "punk", punkId: ownerId },
  payload: {
    name: "  ### general  ",
    type: "stream",
    visibility: "open",
  },
};

function context(cursor: number, workspaceRole: WorkspaceRole = "owner") {
  return {
    conversationId,
    cursor,
    now,
    workspaceCursor: 7,
    workspaceRole,
  };
}

describe("Conversation decisions", () => {
  it("creates a scoped Conversation and records the Workspace authorization cursor", () => {
    const result = decideCreateConversation(null, createCommand, context(1));
    expect(result.nextState).toMatchObject({
      id: conversationId,
      workspaceId,
      name: "general",
      type: "stream",
      visibility: "open",
      ownerPunkId: ownerId,
      members: [expect.objectContaining({ punkId: ownerId, access: "owner" })],
      cursor: 1,
    });
    expect(result.event.kind).toBe(
      CONVERSATION_EVENT_KINDS.conversationCreated,
    );
    expect(result.event.tags).toContainEqual(["workspace", workspaceId]);
    expect(result.event.tags).toContainEqual(["conversation", conversationId]);
    expect(result.event.tags).toContainEqual(["workspace_cursor", "7"]);
    expect(JSON.parse(result.event.content).conversation).not.toHaveProperty(
      "members",
    );
  });

  it("keeps the signed create event below the attestation ceiling for a large roster", () => {
    const participantPunkIds = Array.from(
      { length: 999 },
      (_, index) => `punk_${String(index).padStart(4, "0")}_${"x".repeat(110)}`,
    );
    const result = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: {
          ...createCommand.payload,
          participantPunkIds,
          maxMembers: 1_000,
        },
      },
      context(1),
    );
    const content = JSON.parse(result.event.content) as {
      conversation: Record<string, unknown>;
      initialMembers: unknown[];
    };
    expect(content.conversation).not.toHaveProperty("members");
    expect(content.initialMembers).toHaveLength(1_000);
    expect(
      new TextEncoder().encode(result.event.content).byteLength,
    ).toBeLessThan(300_000);
  });

  it("preserves Buzz DM participant-set constraints", () => {
    const dm = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: {
          name: "ignored",
          type: "dm",
          visibility: "private",
          participantPunkIds: [memberId],
        },
      },
      context(1),
    );
    expect(dm.nextState).toMatchObject({
      name: "DM",
      maxMembers: 2,
      members: [
        expect.objectContaining({ punkId: ownerId, access: "member" }),
        expect.objectContaining({ punkId: memberId, access: "member" }),
      ],
    });

    expect(() =>
      decideCreateConversation(
        null,
        {
          ...createCommand,
          payload: {
            name: "invalid",
            type: "dm",
            visibility: "open",
            participantPunkIds: [memberId],
          },
        },
        context(1),
      ),
    ).toThrow(ConversationDomainError);
  });

  it("allows a Workspace writer to join an open Conversation", () => {
    const created = decideCreateConversation(
      null,
      createCommand,
      context(1),
    ).nextState;
    const command: JoinConversationCommand = {
      contract: "conversation.join@1",
      commandId: "73035d22-91df-4a54-8ffd-16cb757787da",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: memberId },
      payload: {},
    };
    const joined = decideJoinConversation(
      created,
      command,
      context(2, "member"),
    );
    expect(joined.nextState.members).toContainEqual(
      expect.objectContaining({ punkId: memberId, access: "member" }),
    );
    expect(joined.event.kind).toBe(
      CONVERSATION_EVENT_KINDS.conversationMemberJoined,
    );
  });

  it("refuses open self-join to a Workspace guest", () => {
    const created = decideCreateConversation(
      null,
      createCommand,
      context(1),
    ).nextState;
    const command: JoinConversationCommand = {
      contract: "conversation.join@1",
      commandId: "5abca7b1-11a1-46d5-8ef2-d6a5c74355a0",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: memberId },
      payload: {},
    };
    expect(() =>
      decideJoinConversation(created, command, context(2, "guest")),
    ).toThrow(ConversationDomainError);
  });

  it("lets the owner invite, change, and remove Conversation access", () => {
    const created = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: { ...createCommand.payload, visibility: "private" },
      },
      context(1),
    ).nextState;
    const add: SetConversationMemberAccessCommand = {
      contract: "conversation.member-set-access@1",
      commandId: "110eed81-843e-459a-b882-4e804543797e",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, access: "guest" },
    };
    const added = decideSetConversationMemberAccess(created, add, context(2));
    expect(added.nextState.members).toContainEqual(
      expect.objectContaining({ punkId: memberId, access: "guest" }),
    );

    const remove: RemoveConversationMemberCommand = {
      contract: "conversation.member-remove@1",
      commandId: "a79277f9-31f9-4b3b-a834-9e79abe10123",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId },
    };
    const removed = decideRemoveConversationMember(
      added.nextState,
      remove,
      context(3),
    );
    expect(removed.nextState.members).not.toContainEqual(
      expect.objectContaining({ punkId: memberId }),
    );
  });

  it("keeps DM participant sets immutable", () => {
    const dm = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: {
          name: "ignored",
          type: "dm",
          visibility: "private",
          participantPunkIds: [memberId],
        },
      },
      context(1),
    ).nextState;
    const remove: RemoveConversationMemberCommand = {
      contract: "conversation.member-remove@1",
      commandId: "52ac2ec7-9679-4057-9cf0-e34d6840a219",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId },
    };
    expect(() =>
      decideRemoveConversationMember(dm, remove, context(2)),
    ).toThrow(ConversationDomainError);
  });

  it("updates all Conversation metadata atomically for a Conversation manager", () => {
    const created = decideCreateConversation(
      null,
      createCommand,
      context(1),
    ).nextState;
    const command: UpdateConversationCommand = {
      contract: "conversation.update@1",
      commandId: "c9a2a53a-1c26-4a28-9218-3b454a6f038b",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {
        name: " # incidents ",
        description: "  Production response  ",
        visibility: "private",
        topic: "  Database saturation  ",
        purpose: "  Coordinate mitigation  ",
        topicRequired: true,
        maxMembers: 20,
        ttlSeconds: 3_600,
      },
    };
    const updated = decideUpdateConversation(created, command, context(2));
    expect(updated.nextState).toMatchObject({
      name: "incidents",
      description: "Production response",
      visibility: "private",
      topic: "Database saturation",
      purpose: "Coordinate mitigation",
      topicRequired: true,
      maxMembers: 20,
      ttlSeconds: 3_600,
      ttlDeadline: "2026-08-20T14:00:00.000Z",
      cursor: 2,
      revision: 2,
    });
    expect(updated.event.kind).toBe(
      CONVERSATION_EVENT_KINDS.conversationMetadataUpdated,
    );
  });

  it("allows Workspace moderation but rejects an ordinary non-manager", () => {
    const created = decideCreateConversation(
      null,
      createCommand,
      context(1),
    ).nextState;
    const command: UpdateConversationCommand = {
      contract: "conversation.update@1",
      commandId: "1f146854-e52a-4146-8fab-b39346759996",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: memberId },
      payload: { topic: "Moderated topic" },
    };
    expect(
      decideUpdateConversation(created, command, context(2, "moderator"))
        .nextState.topic,
    ).toBe("Moderated topic");
    expect(() =>
      decideUpdateConversation(created, command, context(2, "member")),
    ).toThrow(ConversationDomainError);

    const managed: Conversation = {
      ...created,
      members: [
        ...created.members,
        {
          punkId: memberId,
          access: "manager",
          joinedAt: now.toISOString(),
          invitedByPunkId: ownerId,
        },
      ] as Conversation["members"],
    };
    expect(
      decideUpdateConversation(managed, command, context(2, "member")).nextState
        .topic,
    ).toBe("Moderated topic");
  });

  it("archives, blocks ordinary mutation, and restores with a renewed TTL", () => {
    const created = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: { ...createCommand.payload, ttlSeconds: 60 },
      },
      context(1),
    ).nextState;
    const archive: ArchiveConversationCommand = {
      contract: "conversation.archive@1",
      commandId: "a694bf8d-8d9c-4019-a0c3-b6e53ba80f45",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { cause: "manual" },
    };
    const archived = decideArchiveConversation(created, archive, context(2));
    expect(archived.nextState).toMatchObject({
      status: "archived",
      archivedAt: now.toISOString(),
      ttlDeadline: null,
    });
    expect(archived.event.kind).toBe(
      CONVERSATION_EVENT_KINDS.conversationArchived,
    );
    expect(() =>
      decideUpdateConversation(
        archived.nextState,
        {
          contract: "conversation.update@1",
          commandId: "baf8a9bb-7d24-4bce-892a-9745f50421c0",
          workspaceId,
          conversationId,
          actor: { kind: "punk", punkId: ownerId },
          payload: { topic: "blocked" },
        },
        context(3),
      ),
    ).toThrow(ConversationDomainError);

    const restore: RestoreConversationCommand = {
      contract: "conversation.restore@1",
      commandId: "5575978e-e5a4-4f95-a040-f20eb0a4e280",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {},
    };
    const restored = decideRestoreConversation(
      archived.nextState,
      restore,
      context(3),
    );
    expect(restored.nextState).toMatchObject({
      status: "active",
      archivedAt: null,
      ttlDeadline: "2026-08-20T13:01:00.000Z",
    });
    expect(restored.event.kind).toBe(
      CONVERSATION_EVENT_KINDS.conversationRestored,
    );
  });

  it("keeps DM identity metadata immutable while allowing descriptive metadata", () => {
    const dm = decideCreateConversation(
      null,
      {
        ...createCommand,
        payload: {
          name: "ignored",
          type: "dm",
          visibility: "private",
          participantPunkIds: [memberId],
        },
      },
      context(1),
    ).nextState;
    const base: UpdateConversationCommand = {
      contract: "conversation.update@1",
      commandId: "1a738a11-e23f-43f5-9963-48c8a7cb91af",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { topic: "Private coordination" },
    };
    expect(decideUpdateConversation(dm, base, context(2)).nextState.topic).toBe(
      "Private coordination",
    );
    expect(() =>
      decideUpdateConversation(
        dm,
        { ...base, payload: { visibility: "open" } },
        context(2),
      ),
    ).toThrow(ConversationDomainError);
  });
});
