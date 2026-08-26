import type {
  CreateWorkspaceCommand,
  LeaveWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  TransferWorkspaceOwnershipCommand,
} from "@punks/contracts";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const operatorAuthorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const invitedPunkId = "00000000-0000-8000-8000-000000000002";
const thirdPunkId = "00000000-0000-8000-8000-000000000003";

async function createWorkspace(slug: string): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { slug, name: "Lifecycle Workspace", visibility: "private" },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorAuthorization,
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { workspace: { id: string } }).workspace
    .id;
}

async function setMemberRole(
  workspaceId: string,
  targetPunkId: string,
  role: "owner" | "moderator" | "member" | "guest",
  expectedRevision: number,
): Promise<Response> {
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId, role, expectedRevision },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${targetPunkId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

async function leaveWorkspace(
  workspaceId: string,
  punkId: string,
  session: string,
  commandId = crypto.randomUUID(),
): Promise<Response> {
  const command: LeaveWorkspaceCommand = {
    contract: "workspace.leave@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {},
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/leave`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${session}`,
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

async function transferWorkspaceOwnership(
  workspaceId: string,
  targetPunkId: string,
  expectedRevision: number,
  reauthorizationId: string,
  commandId = crypto.randomUUID(),
): Promise<Response> {
  const command: TransferWorkspaceOwnershipCommand = {
    contract: "workspace.transfer-ownership@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId, expectedRevision, reauthorizationId },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/transfer-ownership`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

describe("Punks Workspace departure and ownership transfer", () => {
  it("lets a member leave while keeping the primary Owner terminally present", async () => {
    const workspaceId = await createWorkspace(`leave-${crypto.randomUUID()}`);
    const admitted = await setMemberRole(
      workspaceId,
      invitedPunkId,
      "member",
      1,
    );
    expect(admitted.status, await admitted.clone().text()).toBe(200);

    const left = await leaveWorkspace(
      workspaceId,
      invitedPunkId,
      "session-other",
    );
    expect(left.status, await left.clone().text()).toBe(200);
    await expect(left.json()).resolves.toMatchObject({
      contract: "workspace.membership-lifecycle-response@1",
      workspaceId,
      revision: 3,
      outcome: "left",
      role: null,
      replayed: false,
    });
    await expect(
      env.WORKSPACES.getByName(workspaceId).query({
        contract: "workspace.get@1",
        workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        ownerPunkId,
        revision: 3,
        members: [{ punkId: ownerPunkId, role: "owner" }],
      },
    });
    await expect(
      env.WORKSPACES.getByName(workspaceId).authorize({
        workspaceId,
        punkId: invitedPunkId,
        permission: "workspace.read",
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    const ownerCannotLeave = await leaveWorkspace(
      workspaceId,
      ownerPunkId,
      "session-owner",
    );
    expect(ownerCannotLeave.status, await ownerCannotLeave.clone().text()).toBe(
      409,
    );
    await expect(ownerCannotLeave.json()).resolves.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("requires and consumes strong reauthorization for an atomic ownership transfer", async () => {
    const workspaceId = await createWorkspace(
      `transfer-${crypto.randomUUID()}`,
    );
    const admitted = await setMemberRole(
      workspaceId,
      invitedPunkId,
      "member",
      1,
    );
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    const auth =
      env.WORKSPACE_OWNERSHIP_AUTHORITY as typeof env.WORKSPACE_OWNERSHIP_AUTHORITY & {
        issueWorkspaceOwnershipTransferAuthorization(input: {
          authorizationId: string;
          sessionId: string;
          punkId: string;
          workspaceId: string;
          targetPunkId: string;
          expectedRevision: number;
        }): Promise<void>;
      };
    const rightsIndex =
      env.ACCOUNT_MERGE_RIGHTS_INDEX as typeof env.ACCOUNT_MERGE_RIGHTS_INDEX & {
        resetCalls(): Promise<void>;
        calls(): Promise<Array<{ phase: string; input: { punkId: string } }>>;
      };
    await rightsIndex.resetCalls();
    const missingGrant = await transferWorkspaceOwnership(
      workspaceId,
      invitedPunkId,
      2,
      crypto.randomUUID(),
    );
    expect(missingGrant.status, await missingGrant.clone().text()).toBe(403);
    await expect(rightsIndex.calls()).resolves.toEqual([]);

    const reauthorizationId = crypto.randomUUID();
    await auth.issueWorkspaceOwnershipTransferAuthorization({
      authorizationId: reauthorizationId,
      sessionId: "11111111-1111-8111-8111-111111111111",
      punkId: ownerPunkId,
      workspaceId,
      targetPunkId: invitedPunkId,
      expectedRevision: 2,
    });
    const commandId = crypto.randomUUID();
    const transferred = await transferWorkspaceOwnership(
      workspaceId,
      invitedPunkId,
      2,
      reauthorizationId,
      commandId,
    );
    expect(transferred.status, await transferred.clone().text()).toBe(200);
    expect(
      (await rightsIndex.calls()).map(({ phase, input }) => [
        phase,
        input.punkId,
      ]),
    ).toEqual([
      ["prepare", ownerPunkId],
      ["prepare", invitedPunkId],
      ["commit", ownerPunkId],
      ["commit", invitedPunkId],
    ]);
    await expect(transferred.json()).resolves.toMatchObject({
      contract: "workspace.membership-lifecycle-response@1",
      workspaceId,
      revision: 3,
      outcome: "ownership_transferred",
      role: "member",
      replayed: false,
    });
    await expect(
      env.WORKSPACES.getByName(workspaceId).query({
        contract: "workspace.get@1",
        workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        ownerPunkId: invitedPunkId,
        revision: 3,
        members: [
          { punkId: ownerPunkId, role: "member" },
          { punkId: invitedPunkId, role: "owner" },
        ],
      },
    });

    const replay = await transferWorkspaceOwnership(
      workspaceId,
      invitedPunkId,
      2,
      reauthorizationId,
      commandId,
    );
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    const oldOwnerLeft = await leaveWorkspace(
      workspaceId,
      ownerPunkId,
      "session-owner",
    );
    expect(oldOwnerLeft.status, await oldOwnerLeft.clone().text()).toBe(200);
    await expect(oldOwnerLeft.json()).resolves.toMatchObject({
      contract: "workspace.membership-lifecycle-response@1",
      workspaceId,
      revision: 4,
      outcome: "left",
      role: null,
    });
    const lastOwnerCannotLeave = await leaveWorkspace(
      workspaceId,
      invitedPunkId,
      "session-other",
    );
    expect(
      lastOwnerCannotLeave.status,
      await lastOwnerCannotLeave.clone().text(),
    ).toBe(409);
  });

  it("binds ownership reauthorization to the exact Workspace, target and revision", async () => {
    const workspaceId = await createWorkspace(`bind-${crypto.randomUUID()}`);
    const admittedTarget = await setMemberRole(
      workspaceId,
      invitedPunkId,
      "member",
      1,
    );
    expect(admittedTarget.status, await admittedTarget.clone().text()).toBe(
      200,
    );
    const admittedOther = await setMemberRole(
      workspaceId,
      thirdPunkId,
      "member",
      2,
    );
    expect(admittedOther.status, await admittedOther.clone().text()).toBe(200);

    const auth =
      env.WORKSPACE_OWNERSHIP_AUTHORITY as typeof env.WORKSPACE_OWNERSHIP_AUTHORITY & {
        issueWorkspaceOwnershipTransferAuthorization(input: {
          authorizationId: string;
          sessionId: string;
          punkId: string;
          workspaceId: string;
          targetPunkId: string;
          expectedRevision: number;
        }): Promise<void>;
      };
    const reauthorizationId = crypto.randomUUID();
    await auth.issueWorkspaceOwnershipTransferAuthorization({
      authorizationId: reauthorizationId,
      sessionId: "11111111-1111-8111-8111-111111111111",
      punkId: ownerPunkId,
      workspaceId,
      targetPunkId: invitedPunkId,
      expectedRevision: 3,
    });

    const wrongTarget = await transferWorkspaceOwnership(
      workspaceId,
      thirdPunkId,
      3,
      reauthorizationId,
    );
    expect(wrongTarget.status, await wrongTarget.clone().text()).toBe(403);

    const exactTarget = await transferWorkspaceOwnership(
      workspaceId,
      invitedPunkId,
      3,
      reauthorizationId,
    );
    expect(exactTarget.status, await exactTarget.clone().text()).toBe(200);
  });

  it("serializes a target departure racing an ownership transfer", async () => {
    const workspaceId = await createWorkspace(`race-${crypto.randomUUID()}`);
    const admitted = await setMemberRole(
      workspaceId,
      invitedPunkId,
      "member",
      1,
    );
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    const auth =
      env.WORKSPACE_OWNERSHIP_AUTHORITY as typeof env.WORKSPACE_OWNERSHIP_AUTHORITY & {
        issueWorkspaceOwnershipTransferAuthorization(input: {
          authorizationId: string;
          sessionId: string;
          punkId: string;
          workspaceId: string;
          targetPunkId: string;
          expectedRevision: number;
        }): Promise<void>;
      };
    const reauthorizationId = crypto.randomUUID();
    await auth.issueWorkspaceOwnershipTransferAuthorization({
      authorizationId: reauthorizationId,
      sessionId: "11111111-1111-8111-8111-111111111111",
      punkId: ownerPunkId,
      workspaceId,
      targetPunkId: invitedPunkId,
      expectedRevision: 2,
    });

    const [transfer, departure] = await Promise.all([
      transferWorkspaceOwnership(
        workspaceId,
        invitedPunkId,
        2,
        reauthorizationId,
      ),
      leaveWorkspace(workspaceId, invitedPunkId, "session-other"),
    ]);
    expect([transfer.status, departure.status].sort()).toEqual([200, 409]);

    const authority = await env.WORKSPACES.getByName(workspaceId).query({
      contract: "workspace.get@1",
      workspaceId,
    });
    expect(authority.ok).toBe(true);
    if (!authority.ok) {
      throw new TypeError("Workspace authority is unavailable");
    }
    const primaryOwner = authority.state.members.find(
      (member) => member.punkId === authority.state.ownerPunkId,
    );
    expect(primaryOwner).toEqual({
      punkId: authority.state.ownerPunkId,
      role: "owner",
    });
    expect(authority.state.members).toHaveLength(
      authority.state.ownerPunkId === ownerPunkId ? 1 : 2,
    );
  });
});
