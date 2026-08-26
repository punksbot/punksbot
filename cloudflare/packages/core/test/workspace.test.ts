import type {
  CreateWorkspaceCommand,
  LeaveWorkspaceCommand,
  RemoveWorkspaceMemberCommand,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  TransferWorkspaceOwnershipCommand,
  Workspace,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  decideCreateWorkspace,
  decideLeaveWorkspaceV2,
  decideRemoveWorkspaceMember,
  decideRenameWorkspace,
  decideSetWorkspaceMemberRole,
  decideTransferWorkspaceOwnershipV2,
  PUNKS_EVENT_KINDS,
  WorkspaceDomainError,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const now = new Date("2026-08-20T12:00:00.000Z");
const ownerId = "00000000-0000-8000-8000-000000000001";
const memberId = "00000000-0000-8000-8000-000000000002";

const createCommand: CreateWorkspaceCommand = {
  contract: "workspace.create@1",
  commandId: "1bac3237-dafa-4912-a422-5539e78708b4",
  actor: { kind: "punk", punkId: ownerId },
  payload: { slug: "core-team", name: "Core Team", visibility: "private" },
};

describe("Workspace decisions", () => {
  it("creates an owner membership and a signed-journal draft", () => {
    const decision = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    });

    expect(decision.nextState).toMatchObject({
      id: workspaceId,
      slug: "core-team",
      ownerPunkId: ownerId,
      members: [{ punkId: ownerId, role: "owner" }],
      revision: 1,
      cursor: 1,
    });
    expect(decision.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceCreated);
    expect(decision.event.tags).toContainEqual(["workspace", workspaceId]);
    expect(JSON.parse(decision.event.content)).toEqual({
      schemaVersion: 1,
      workspace: decision.nextState,
    });
  });

  it("allows only a role carrying workspace.rename", () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const memberState: Workspace = {
      ...created,
      members: [
        { punkId: ownerId, role: "owner" },
        { punkId: "punk_member", role: "member" },
      ],
    };
    const command: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "3bf54be2-bde2-4d84-a080-e2a45a4d39e0",
      workspaceId,
      actor: { kind: "punk", punkId: "punk_member" },
      payload: { slug: "renamed-team" },
    };

    expect(() =>
      decideRenameWorkspace(memberState, command, {
        workspaceId,
        cursor: 2,
        now,
      }),
    ).toThrow(WorkspaceDomainError);
  });

  it("renames without changing the stable Workspace id", () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const command: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "3bf54be2-bde2-4d84-a080-e2a45a4d39e0",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { slug: "renamed-team" },
    };
    const decision = decideRenameWorkspace(created, command, {
      workspaceId,
      cursor: 2,
      now: new Date("2026-08-20T12:05:00.000Z"),
    });

    expect(decision.nextState).toMatchObject({
      id: workspaceId,
      slug: "renamed-team",
      revision: 2,
      cursor: 2,
    });
    expect(JSON.parse(decision.event.content)).toMatchObject({
      previousSlug: "core-team",
    });
  });

  it("adds, promotes, and removes a Punk through members.manage", () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    expect(() =>
      decideSetWorkspaceMemberRole(
        created,
        {
          contract: "workspace.member-set-role@1",
          commandId: "47da754e-dcd3-4c39-aeca-8fb1454a57ec",
          workspaceId,
          actor: { kind: "punk", punkId: ownerId },
          payload: {
            targetPunkId: memberId,
            role: "moderator",
            expectedRevision: 1,
          },
        },
        { workspaceId, cursor: 2, now },
      ),
    ).toThrow(WorkspaceDomainError);
    const add: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "47da754e-dcd3-4c39-aeca-8fb1454a57ed",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {
        targetPunkId: memberId,
        role: "member",
        expectedRevision: 1,
      },
    };
    const added = decideSetWorkspaceMemberRole(created, add, {
      workspaceId,
      cursor: 2,
      now,
    });
    expect(added.nextState.members).toContainEqual({
      punkId: memberId,
      role: "member",
    });
    expect(added.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceMemberRoleSet);

    const promote: SetWorkspaceMemberRoleCommand = {
      ...add,
      commandId: "325b9b17-c7a8-4f3c-aa4b-344299a89f2d",
      payload: {
        targetPunkId: memberId,
        role: "moderator",
        expectedRevision: 2,
      },
    };
    const promoted = decideSetWorkspaceMemberRole(added.nextState, promote, {
      workspaceId,
      cursor: 3,
      now,
    });
    expect(promoted.nextState.members).toContainEqual({
      punkId: memberId,
      role: "moderator",
    });

    const remove: RemoveWorkspaceMemberCommand = {
      contract: "workspace.member-remove@1",
      commandId: "7f7fbcb7-e055-4ef0-9bf1-a3c5cfbce103",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: memberId, expectedRevision: 3 },
    };
    const removed = decideRemoveWorkspaceMember(promoted.nextState, remove, {
      workspaceId,
      cursor: 4,
      now,
    });
    expect(removed.nextState.members).not.toContainEqual(
      expect.objectContaining({ punkId: memberId }),
    );
    expect(removed.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceMemberRemoved);
  });

  it("never allows the primary owner to be demoted or removed", () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const demote: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "938d68c6-9ed9-45cb-967b-4cde2bb34dcb",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {
        targetPunkId: ownerId,
        role: "member",
        expectedRevision: 1,
      },
    };
    expect(() =>
      decideSetWorkspaceMemberRole(created, demote, {
        workspaceId,
        cursor: 2,
        now,
      }),
    ).toThrow(WorkspaceDomainError);

    const remove: RemoveWorkspaceMemberCommand = {
      contract: "workspace.member-remove@1",
      commandId: "e2dcf59a-8ffc-481c-8342-a0c7f0ad10e9",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { targetPunkId: ownerId, expectedRevision: 1 },
    };
    expect(() =>
      decideRemoveWorkspaceMember(created, remove, {
        workspaceId,
        cursor: 2,
        now,
      }),
    ).toThrow(WorkspaceDomainError);
  });

  it("lets a non-primary member leave and removes only that Punk", async () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const current: Workspace = {
      ...created,
      members: [
        { punkId: ownerId, role: "owner" },
        { punkId: memberId, role: "member" },
      ],
      revision: 2,
      cursor: 2,
    };
    const leave: LeaveWorkspaceCommand = {
      contract: "workspace.leave@1",
      commandId: "a2dcf59a-8ffc-481c-8342-a0c7f0ad10e9",
      workspaceId,
      actor: { kind: "punk", punkId: memberId },
      payload: {},
    };

    const decision = await decideLeaveWorkspaceV2(current, leave, {
      workspaceId,
      cursor: 3,
      now,
    });

    expect(decision.nextState).toMatchObject({
      ownerPunkId: ownerId,
      members: [{ punkId: ownerId, role: "owner" }],
      revision: 3,
      cursor: 3,
    });
    expect(decision.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceMemberRemoved);
    expect(decision.event.tags).toContainEqual(["target", "punk", memberId]);
    expect(decision.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: memberId, present: false, role: "member" },
    ]);

    await expect(
      decideLeaveWorkspaceV2(
        current,
        {
          ...leave,
          actor: { kind: "punk", punkId: ownerId },
        },
        {
          workspaceId,
          cursor: 3,
          now,
        },
      ),
    ).rejects.toThrow(WorkspaceDomainError);
    await expect(
      decideLeaveWorkspaceV2(
        current,
        {
          ...leave,
          actor: {
            kind: "punk",
            punkId: "00000000-0000-8000-8000-000000000003",
          },
        },
        {
          workspaceId,
          cursor: 3,
          now,
        },
      ),
    ).rejects.toThrow(WorkspaceDomainError);
  });

  it("transfers primary ownership atomically with two bounded role deltas", async () => {
    const created = decideCreateWorkspace(null, createCommand, {
      workspaceId,
      cursor: 1,
      now,
    }).nextState;
    const current: Workspace = {
      ...created,
      members: [
        { punkId: ownerId, role: "owner" },
        { punkId: memberId, role: "moderator" },
      ],
      revision: 2,
      cursor: 2,
    };
    const transfer: TransferWorkspaceOwnershipCommand = {
      contract: "workspace.transfer-ownership@1",
      commandId: "b2dcf59a-8ffc-481c-8342-a0c7f0ad10e9",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {
        targetPunkId: memberId,
        expectedRevision: 2,
        reauthorizationId: "c2dcf59a-8ffc-481c-8342-a0c7f0ad10e9",
      },
    };

    const decision = await decideTransferWorkspaceOwnershipV2(
      current,
      transfer,
      { workspaceId, cursor: 3, now },
    );

    expect(decision.nextState).toMatchObject({
      ownerPunkId: memberId,
      members: [
        { punkId: ownerId, role: "member" },
        { punkId: memberId, role: "owner" },
      ],
      revision: 3,
      cursor: 3,
    });
    expect(decision.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceMemberRoleSet);
    expect(JSON.parse(decision.event.content)).toMatchObject({
      transition: {
        type: "ownership-transferred",
        memberTransitions: [
          {
            type: "member-upserted",
            targetPunkId: ownerId,
            previousRole: "owner",
            role: "member",
          },
          {
            type: "member-upserted",
            targetPunkId: memberId,
            previousRole: "moderator",
            role: "owner",
          },
        ],
      },
    });
    expect(decision.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: ownerId, present: true, role: "member" },
      { punkId: memberId, present: true, role: "owner" },
    ]);

    await expect(
      decideTransferWorkspaceOwnershipV2(
        current,
        { ...transfer, actor: { kind: "punk", punkId: memberId } },
        { workspaceId, cursor: 3, now },
      ),
    ).rejects.toThrow(WorkspaceDomainError);
    await expect(
      decideTransferWorkspaceOwnershipV2(
        current,
        {
          ...transfer,
          payload: {
            ...transfer.payload,
            targetPunkId: "00000000-0000-8000-8000-000000000003",
          },
        },
        { workspaceId, cursor: 3, now },
      ),
    ).rejects.toThrow(WorkspaceDomainError);
  });
});
