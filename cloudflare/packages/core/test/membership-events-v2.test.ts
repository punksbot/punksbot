import {
  type CreateConversationCommand,
  type CreateWorkspaceCommand,
  type JoinConversationCommand,
  type RemoveConversationMemberCommand,
  type RemoveWorkspaceMemberCommand,
  type RenameWorkspaceCommand,
  type SetConversationMemberAccessCommand,
  type SetWorkspaceMemberRoleCommand,
  type UpdateConversationCommand,
  validateContract,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  decideCreateConversation,
  decideCreateConversationV2,
  decideCreateWorkspace,
  decideCreateWorkspaceV2,
  decideRemoveConversationMemberV2,
  decideRemoveWorkspaceMemberV2,
  decideRenameWorkspaceV2,
  decideSetConversationMemberAccess,
  decideSetConversationMemberAccessV2,
  decideSetWorkspaceMemberRole,
  decideSetWorkspaceMemberRoleV2,
  decideJoinConversationV2,
  decideUpdateConversationV2,
  type WorkspaceRole,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const ownerId = "00000000-0000-8000-8000-000000000001";
const memberId = "00000000-0000-8000-8000-000000000002";
const now = new Date("2026-08-21T10:00:00.000Z");

const createWorkspace: CreateWorkspaceCommand = {
  contract: "workspace.create@1",
  commandId: "1bac3237-dafa-4912-a422-5539e78708b4",
  actor: { kind: "punk", punkId: ownerId },
  payload: { slug: "core-team", name: "Core Team", visibility: "private" },
};

const createConversation: CreateConversationCommand = {
  contract: "conversation.create@1",
  commandId: "786ed512-b403-4aab-b397-f5c4eab4d797",
  workspaceId,
  actor: { kind: "punk", punkId: ownerId },
  payload: { name: "General", type: "stream", visibility: "private" },
};

function conversationContext(
  cursor: number,
  workspaceRole: WorkspaceRole = "owner",
) {
  return {
    conversationId,
    cursor,
    now,
    workspaceCursor: 7,
    workspaceRole,
  };
}

describe("membership event v2 decisions", () => {
  it("creates one bounded Workspace event committed to its owner delta", async () => {
    const result = await decideCreateWorkspaceV2(null, createWorkspace, {
      workspaceId,
      cursor: 1,
      now,
    });
    const content = JSON.parse(result.event.content);

    expect(content).toMatchObject({
      schemaVersion: 2,
      workspace: { id: workspaceId, memberCount: 1 },
      transition: { type: "created" },
      membershipCommitment: result.membershipProjection.commitment,
    });
    expect(content.workspace).not.toHaveProperty("members");
    expect(
      validateContract("punks://contracts/workspace.event@2", content),
    ).toEqual({ valid: true });
    expect(result.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: ownerId, present: true, role: "owner" },
    ]);
    expect(result.event.tags.at(-1)).toEqual([
      "delta",
      "sha256",
      result.membershipProjection.commitment.deltaDigest,
      "1",
      "1",
    ]);
  });

  it("emits an autosufficient Workspace removal tombstone", async () => {
    const created = decideCreateWorkspace(null, createWorkspace, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const add: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "47da754e-dcd3-4c39-aeca-8fb1454a57ed",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, role: "guest" },
    };
    const added = decideSetWorkspaceMemberRole(created, add, {
      workspaceId,
      cursor: 2,
      now,
    }).nextState;
    const remove: RemoveWorkspaceMemberCommand = {
      contract: "workspace.member-remove@1",
      commandId: "7f7fbcb7-e055-4ef0-9bf1-a3c5cfbce103",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId },
    };

    const removed = await decideRemoveWorkspaceMemberV2(added, remove, {
      workspaceId,
      cursor: 3,
      now,
    });
    expect(removed.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: memberId, present: false, role: "guest" },
    ]);
    expect(JSON.parse(removed.event.content).transition).toEqual({
      type: "member-removed",
      targetPunkId: memberId,
      previousRole: "guest",
    });
  });

  it("creates 1000 Conversation deltas without a roster snapshot", async () => {
    const participantPunkIds = Array.from(
      { length: 999 },
      (_, index) => `punk_${String(index).padStart(4, "0")}_${"🧑".repeat(35)}`,
    );
    const result = await decideCreateConversationV2(
      null,
      {
        ...createConversation,
        payload: {
          ...createConversation.payload,
          participantPunkIds,
          maxMembers: 1000,
        },
      },
      conversationContext(1),
    );
    const content = JSON.parse(result.event.content);

    expect(result.membershipProjection.commitment.deltaCount).toBe(1000);
    expect(
      result.membershipProjection.commitment.chunkCount,
    ).toBeLessThanOrEqual(64);
    expect(content.conversation).not.toHaveProperty("members");
    expect(content).not.toHaveProperty("initialMembers");
    expect(content.transition).toEqual({ type: "created" });
    expect(
      validateContract("punks://contracts/conversation.event@2", content),
    ).toEqual({ valid: true });
    expect(
      result.membershipProjection.chunks
        .flatMap((chunk) => chunk.memberDeltas)
        .slice(0, 2),
    ).toEqual([
      {
        punkId: ownerId,
        present: true,
        access: "owner",
        joinedAt: now.toISOString(),
        invitedByPunkId: null,
      },
      {
        punkId: participantPunkIds[0],
        present: true,
        access: "member",
        joinedAt: now.toISOString(),
        invitedByPunkId: ownerId,
      },
    ]);
  });

  it("preserves join facts on access changes and removal tombstones", async () => {
    const created = decideCreateConversation(
      null,
      createConversation,
      conversationContext(1),
    ).nextState;
    const add: SetConversationMemberAccessCommand = {
      contract: "conversation.member-set-access@1",
      commandId: "110eed81-843e-459a-b882-4e804543797e",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, access: "guest" },
    };
    const added = await decideSetConversationMemberAccessV2(
      created,
      add,
      conversationContext(2),
    );
    const initialDelta = added.membershipProjection.chunks[0]?.memberDeltas[0];
    expect(initialDelta).toEqual({
      punkId: memberId,
      present: true,
      access: "guest",
      joinedAt: now.toISOString(),
      invitedByPunkId: ownerId,
    });

    const promote = await decideSetConversationMemberAccessV2(
      added.nextState,
      {
        ...add,
        commandId: "210eed81-843e-459a-b882-4e804543797e",
        payload: { targetPunkId: memberId, access: "member" },
      },
      conversationContext(3),
    );
    expect(promote.membershipProjection.chunks[0]?.memberDeltas[0]).toEqual({
      ...initialDelta,
      access: "member",
    });

    const remove: RemoveConversationMemberCommand = {
      contract: "conversation.member-remove@1",
      commandId: "a79277f9-31f9-4b3b-a834-9e79abe10123",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId },
    };
    const removed = await decideRemoveConversationMemberV2(
      promote.nextState,
      remove,
      conversationContext(4),
    );
    expect(removed.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      {
        punkId: memberId,
        present: false,
        access: "member",
        joinedAt: now.toISOString(),
        invitedByPunkId: ownerId,
      },
    ]);
  });

  it("derives a self-join without an inviter", async () => {
    const created = decideCreateConversation(
      null,
      {
        ...createConversation,
        payload: { ...createConversation.payload, visibility: "open" },
      },
      conversationContext(1),
    ).nextState;
    const join: JoinConversationCommand = {
      contract: "conversation.join@1",
      commandId: "73035d22-91df-4a54-8ffd-16cb757787da",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: memberId },
      payload: {},
    };
    const joined = await decideJoinConversationV2(
      created,
      join,
      conversationContext(2, "member"),
    );
    expect(joined.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      {
        punkId: memberId,
        present: true,
        access: "member",
        joinedAt: now.toISOString(),
        invitedByPunkId: null,
      },
    ]);
  });

  it("commits one empty chunk for scalar-only transitions", async () => {
    const workspace = decideCreateWorkspace(null, createWorkspace, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const rename: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "3bf54be2-bde2-4d84-a080-e2a45a4d39e0",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { slug: "renamed-team" },
    };
    const renamed = await decideRenameWorkspaceV2(workspace, rename, {
      workspaceId,
      cursor: 2,
      now,
    });
    expect(renamed.membershipProjection.chunks).toHaveLength(1);
    expect(renamed.membershipProjection.chunks[0]?.memberDeltas).toEqual([]);

    const conversation = decideCreateConversation(
      null,
      createConversation,
      conversationContext(1),
    ).nextState;
    const update: UpdateConversationCommand = {
      contract: "conversation.update@1",
      commandId: "c9a2a53a-1c26-4a28-9218-3b454a6f038b",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { topic: "Bounded projection" },
    };
    const updated = await decideUpdateConversationV2(
      conversation,
      update,
      conversationContext(2),
    );
    expect(updated.membershipProjection.chunks[0]?.memberDeltas).toEqual([]);
    const content = JSON.parse(updated.event.content);
    expect(content.transition).toEqual({
      type: "metadata-updated",
      changedFields: ["topic"],
      previousMetadata: { topic: null },
    });
    expect(
      validateContract("punks://contracts/conversation.event@2", content),
    ).toEqual({ valid: true });
  });

  it("keeps legacy decisions on their unchanged v1 content", () => {
    const workspace = decideCreateWorkspace(null, createWorkspace, {
      workspaceId,
      cursor: 1,
      now,
    });
    const conversation = decideCreateConversation(
      null,
      createConversation,
      conversationContext(1),
    );
    expect(JSON.parse(workspace.event.content).schemaVersion).toBe(1);
    expect(JSON.parse(conversation.event.content).schemaVersion).toBe(1);
  });

  it("keeps the legacy access decision callable during rollout", () => {
    const created = decideCreateConversation(
      null,
      createConversation,
      conversationContext(1),
    ).nextState;
    const command: SetConversationMemberAccessCommand = {
      contract: "conversation.member-set-access@1",
      commandId: "310eed81-843e-459a-b882-4e804543797e",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, access: "guest" },
    };
    expect(
      decideSetConversationMemberAccess(
        created,
        command,
        conversationContext(2),
      ).nextState.members,
    ).toContainEqual(expect.objectContaining({ punkId: memberId }));
  });

  it("builds a Workspace upsert delta without changing the v1 decision", async () => {
    const created = decideCreateWorkspace(null, createWorkspace, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const command: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "57da754e-dcd3-4c39-aeca-8fb1454a57ed",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, role: "member" },
    };
    const v2 = await decideSetWorkspaceMemberRoleV2(created, command, {
      workspaceId,
      cursor: 2,
      now,
    });
    expect(v2.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: memberId, present: true, role: "member" },
    ]);
  });
});
