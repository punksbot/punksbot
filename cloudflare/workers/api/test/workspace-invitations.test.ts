import type {
  ClaimWorkspaceInvitationCommand,
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceCommand,
  CreateWorkspaceInvitationCommand,
  CreateWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationCommand,
  RevokeWorkspaceInvitationResponse,
  SetWorkspaceMemberRoleCommand,
  WorkspaceGovernanceResponse,
  WorkspaceInvitationView,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { encodeWorkspaceGovernanceCursor } from "@punks/core";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

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
    payload: { slug, name: "Invitation Workspace", visibility: "private" },
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

async function createInvitation(
  workspaceId: string,
  overrides: Partial<CreateWorkspaceInvitationCommand["payload"]> = {},
  issuer: { punkId: string; session: string } = {
    punkId: ownerPunkId,
    session: "session-owner",
  },
): Promise<CreateWorkspaceInvitationResponse> {
  const command: CreateWorkspaceInvitationCommand = {
    contract: "workspace.invite@1",
    commandId: crypto.randomUUID(),
    workspaceId,
    actor: { kind: "punk", punkId: issuer.punkId },
    payload: {
      role: "member",
      expectedRevision: 1,
      ...overrides,
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/invitations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${issuer.session}`,
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as CreateWorkspaceInvitationResponse;
  expect(
    validateContract("punks://contracts/workspace.invite-response@1", body),
  ).toEqual({ valid: true });
  return body;
}

async function claimInvitation(
  workspaceId: string,
  code: string,
  commandId = crypto.randomUUID(),
  expectedRevision = 1,
  claimant: { punkId: string; session: string } = {
    punkId: invitedPunkId,
    session: "session-other",
  },
): Promise<Response> {
  const command: ClaimWorkspaceInvitationCommand = {
    contract: "workspace.invite-claim@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: claimant.punkId },
    payload: { code, expectedRevision },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspace-invitations/${encodeURIComponent(code)}/claim`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-punks_session=${claimant.session}`,
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
  commandId = crypto.randomUUID(),
): Promise<Response> {
  const command: RevokeWorkspaceInvitationCommand = {
    contract: "workspace.invite-revoke@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { invitationId, expectedRevision: 1 },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/invitations/${invitationId}`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

describe("Punks Workspace invitations", () => {
  it("creates, consults and idempotently claims one bounded invitation", async () => {
    const workspaceId = await createWorkspace(`invite-${crypto.randomUUID()}`);
    const created = await createInvitation(workspaceId);

    expect(created.replayed).toBe(false);
    expect(created.invitation).toMatchObject({
      contract: "workspace.invitation@1",
      workspace: { id: workspaceId, name: "Invitation Workspace" },
      workspaceRevision: 1,
      role: "member",
      status: "issued",
      maxUses: 1,
      uses: 0,
      usesRemaining: 1,
    });
    expect(created.invitation).not.toHaveProperty("members");
    expect(created.invitation).not.toHaveProperty("issuerPunkId");

    const consultedResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspace-invitations/${encodeURIComponent(created.code)}`,
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(
      consultedResponse.status,
      await consultedResponse.clone().text(),
    ).toBe(200);
    const consulted =
      (await consultedResponse.json()) as WorkspaceInvitationView;
    expect(
      validateContract("punks://contracts/workspace.invitation@1", consulted),
    ).toEqual({ valid: true });
    expect(consulted).toEqual(created.invitation);

    const commandId = crypto.randomUUID();
    const firstClaim = await claimInvitation(
      workspaceId,
      created.code,
      commandId,
    );
    expect(firstClaim.status, await firstClaim.clone().text()).toBe(200);
    const joined =
      (await firstClaim.json()) as ClaimWorkspaceInvitationResponse;
    expect(
      validateContract(
        "punks://contracts/workspace.invite-claim-response@1",
        joined,
      ),
    ).toEqual({ valid: true });
    expect(joined).toMatchObject({
      result: "joined",
      workspace: { id: workspaceId, role: "member", revision: 2 },
      replayed: false,
    });

    const replay = await claimInvitation(workspaceId, created.code, commandId);
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      result: "joined",
      replayed: true,
    });

    const duplicate = await claimInvitation(
      workspaceId,
      created.code,
      crypto.randomUUID(),
      2,
    );
    expect(duplicate.status, await duplicate.clone().text()).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      result: "already_member",
      workspace: { role: "member", revision: 2 },
      replayed: false,
    });
  });

  it("revokes idempotently and makes every later claim fail closed", async () => {
    const workspaceId = await createWorkspace(`revoke-${crypto.randomUUID()}`);
    const created = await createInvitation(workspaceId);
    const commandId = crypto.randomUUID();

    const revokedResponse = await revokeInvitation(
      workspaceId,
      created.invitation.invitationId,
      commandId,
    );
    expect(revokedResponse.status, await revokedResponse.clone().text()).toBe(
      200,
    );
    const revoked =
      (await revokedResponse.json()) as RevokeWorkspaceInvitationResponse;
    expect(
      validateContract(
        "punks://contracts/workspace.invite-revoke-response@1",
        revoked,
      ),
    ).toEqual({ valid: true });
    expect(revoked).toMatchObject({
      invitation: {
        invitationId: created.invitation.invitationId,
        status: "revoked",
        revokedAt: expect.any(String),
      },
      replayed: false,
    });

    const replay = await revokeInvitation(
      workspaceId,
      created.invitation.invitationId,
      commandId,
    );
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      invitation: { status: "revoked" },
      replayed: true,
    });

    const consulted = await SELF.fetch(
      `https://punks.bot/api/v1/workspace-invitations/${encodeURIComponent(created.code)}`,
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(consulted.status, await consulted.clone().text()).toBe(200);
    await expect(consulted.json()).resolves.toMatchObject({
      status: "revoked",
      uses: 0,
      usesRemaining: 1,
    });

    const claim = await claimInvitation(workspaceId, created.code);
    expect(claim.status, await claim.clone().text()).toBe(410);
    await expect(claim.json()).resolves.toMatchObject({
      code: "invite_revoked",
      retry: "never",
    });
  });

  it("rechecks Session revocation immediately before a role commit", async () => {
    const slug = `fence-${crypto.randomUUID()}`;
    const workspaceId = await createWorkspace(slug);
    const admitMember: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: invitedPunkId,
        role: "member",
        expectedRevision: 1,
      },
    };
    const admitResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${invitedPunkId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": admitMember.commandId,
        },
        body: JSON.stringify(admitMember),
      },
    );
    expect(admitResponse.status, await admitResponse.clone().text()).toBe(200);
    const promoteOwner: SetWorkspaceMemberRoleCommand = {
      ...admitMember,
      commandId: crypto.randomUUID(),
      payload: {
        targetPunkId: invitedPunkId,
        role: "owner",
        expectedRevision: 2,
      },
    };
    const promoteResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${invitedPunkId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": promoteOwner.commandId,
        },
        body: JSON.stringify(promoteOwner),
      },
    );
    expect(promoteResponse.status, await promoteResponse.clone().text()).toBe(
      200,
    );

    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    const revocableSessionId = "33333333-3333-8333-8333-333333333333";
    await auth.setSessionRevoked(revocableSessionId, true);
    try {
      const demote = {
        contract: "workspace.member-set-role@1",
        commandId: crypto.randomUUID(),
        workspaceId,
        actor: { kind: "punk", punkId: invitedPunkId },
        payload: {
          targetPunkId: invitedPunkId,
          role: "moderator",
          expectedRevision: 3,
        },
      } as unknown as SetWorkspaceMemberRoleCommand;
      const denied = await SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${invitedPunkId}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: "__Host-punks_session=session-revocable",
            "idempotency-key": demote.commandId,
          },
          body: JSON.stringify(demote),
        },
      );
      expect(denied.status, await denied.clone().text()).toBe(403);

      const read = await SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${slug}`,
        { headers: { cookie: "__Host-punks_session=session-owner" } },
      );
      expect(read.status, await read.clone().text()).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        workspace: {
          revision: 3,
          members: expect.arrayContaining([
            { punkId: invitedPunkId, role: "owner" },
          ]),
        },
      });
    } finally {
      await auth.setSessionRevoked(revocableSessionId, false);
    }
  });

  it("exhausts a single-use invitation before admitting another Punk", async () => {
    const workspaceId = await createWorkspace(`uses-${crypto.randomUUID()}`);
    const created = await createInvitation(workspaceId, { maxUses: 1 });
    const joined = await claimInvitation(workspaceId, created.code);
    expect(joined.status, await joined.clone().text()).toBe(200);

    const consulted = await SELF.fetch(
      `https://punks.bot/api/v1/workspace-invitations/${encodeURIComponent(created.code)}`,
      { headers: { cookie: "__Host-punks_session=session-third" } },
    );
    expect(consulted.status, await consulted.clone().text()).toBe(200);
    await expect(consulted.json()).resolves.toMatchObject({
      status: "exhausted",
      uses: 1,
      usesRemaining: 0,
    });

    const exhausted = await claimInvitation(
      workspaceId,
      created.code,
      crypto.randomUUID(),
      2,
      { punkId: thirdPunkId, session: "session-third" },
    );
    expect(exhausted.status, await exhausted.clone().text()).toBe(409);
    await expect(exhausted.json()).resolves.toMatchObject({
      code: "invite_exhausted",
      retry: "never",
    });
  });

  it("expires against the authoritative clock and refuses a late claim", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace(
        `expire-${crypto.randomUUID()}`,
      );
      const created = await createInvitation(workspaceId, { ttlSeconds: 60 });

      vi.setSystemTime(new Date("2032-01-01T00:01:01.000Z"));
      const consulted = await SELF.fetch(
        `https://punks.bot/api/v1/workspace-invitations/${encodeURIComponent(created.code)}`,
        { headers: { cookie: "__Host-punks_session=session-other" } },
      );
      expect(consulted.status, await consulted.clone().text()).toBe(200);
      await expect(consulted.json()).resolves.toMatchObject({
        status: "expired",
        uses: 0,
      });

      const claim = await claimInvitation(workspaceId, created.code);
      expect(claim.status, await claim.clone().text()).toBe(410);
      await expect(claim.json()).resolves.toMatchObject({
        code: "invite_expired",
        retry: "never",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies role loss immediately while preserving issuer revocation", async () => {
    const workspaceId = await createWorkspace(`roles-${crypto.randomUUID()}`);
    const admitMember: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: invitedPunkId,
        role: "member",
        expectedRevision: 1,
      },
    };
    const memberUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${invitedPunkId}`;
    const added = await SELF.fetch(memberUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": admitMember.commandId,
      },
      body: JSON.stringify(admitMember),
    });
    expect(added.status, await added.clone().text()).toBe(200);

    const promoteOwner: SetWorkspaceMemberRoleCommand = {
      ...admitMember,
      commandId: crypto.randomUUID(),
      payload: {
        targetPunkId: invitedPunkId,
        role: "owner",
        expectedRevision: 2,
      },
    };
    const promoted = await SELF.fetch(memberUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": promoteOwner.commandId,
      },
      body: JSON.stringify(promoteOwner),
    });
    expect(promoted.status, await promoted.clone().text()).toBe(200);

    const issued = await createInvitation(
      workspaceId,
      { expectedRevision: 3 },
      { punkId: invitedPunkId, session: "session-other" },
    );
    const demote: SetWorkspaceMemberRoleCommand = {
      ...promoteOwner,
      commandId: crypto.randomUUID(),
      payload: {
        targetPunkId: invitedPunkId,
        role: "moderator",
        expectedRevision: 3,
      },
    };
    const demoted = await SELF.fetch(memberUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": demote.commandId,
      },
      body: JSON.stringify(demote),
    });
    expect(demoted.status, await demoted.clone().text()).toBe(200);

    const forbiddenCommand: CreateWorkspaceInvitationCommand = {
      contract: "workspace.invite@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: invitedPunkId },
      payload: { role: "guest", expectedRevision: 4 },
    };
    const forbidden = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-other",
          "idempotency-key": forbiddenCommand.commandId,
        },
        body: JSON.stringify(forbiddenCommand),
      },
    );
    expect(forbidden.status, await forbidden.clone().text()).toBe(403);

    const revokeAsIssuer: RevokeWorkspaceInvitationCommand = {
      contract: "workspace.invite-revoke@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: invitedPunkId },
      payload: {
        invitationId: issued.invitation.invitationId,
        expectedRevision: 4,
      },
    };
    const revoked = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/invitations/${issued.invitation.invitationId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-other",
          "idempotency-key": revokeAsIssuer.commandId,
        },
        body: JSON.stringify(revokeAsIssuer),
      },
    );
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({
      invitation: { status: "revoked" },
    });

    const stale = {
      ...demote,
      commandId: crypto.randomUUID(),
      payload: {
        targetPunkId: invitedPunkId,
        role: "member",
        expectedRevision: 2,
      },
    } satisfies SetWorkspaceMemberRoleCommand;
    const staleResponse = await SELF.fetch(memberUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": stale.commandId,
      },
      body: JSON.stringify(stale),
    });
    expect(staleResponse.status, await staleResponse.clone().text()).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      code: "revision_conflict",
    });
  });

  it("rejects membership mutations through the unprivileged Durable Object RPC", async () => {
    const workspaceId = await createWorkspace(`direct-${crypto.randomUUID()}`);
    const command: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: invitedPunkId,
        role: "member",
        expectedRevision: 1,
      },
    };

    await expect(
      env.WORKSPACES.getByName(workspaceId).execute(command),
    ).resolves.toEqual({ ok: false, code: "invalid_contract" });
    await expect(
      env.WORKSPACES.getByName(workspaceId).query({
        contract: "workspace.get@1",
        workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: { revision: 1, members: [{ punkId: ownerPunkId, role: "owner" }] },
    });
  });

  it("reads the authoritative roster only for a current member manager", async () => {
    const workspaceId = await createWorkspace(`roster-${crypto.randomUUID()}`);
    const ownerRead = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(ownerRead.status, await ownerRead.clone().text()).toBe(200);
    const workspace = (await ownerRead.json()) as WorkspaceGovernanceResponse;
    expect(
      validateContract(
        "punks://contracts/workspace.governance-response@1",
        workspace,
      ),
    ).toEqual({ valid: true });
    expect(workspace).toMatchObject({
      contract: "workspace.governance-response@1",
      workspace: { id: workspaceId, memberCount: 1 },
      members: [{ punkId: ownerPunkId, role: "owner" }],
      nextCursor: null,
    });

    const invitation = await createInvitation(workspaceId);
    const claim = await claimInvitation(workspaceId, invitation.code);
    expect(claim.status, await claim.clone().text()).toBe(200);
    const member = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance`,
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(member.status, await member.clone().text()).toBe(403);
    await expect(member.json()).resolves.toMatchObject({ code: "forbidden" });

    const outsider = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance`,
      { headers: { cookie: "__Host-punks_session=session-third" } },
    );
    expect(outsider.status, await outsider.clone().text()).toBe(403);
    await expect(outsider.json()).resolves.toMatchObject({ code: "forbidden" });
  });

  it("serves a stable authority-bound roster in pages of at most one hundred", async () => {
    const workspaceId = await createWorkspace(`pages-${crypto.randomUUID()}`);
    const authority = env.WORKSPACES.getByName(workspaceId);
    let revision = 1;
    for (let index = 2; index <= 102; index += 1) {
      const targetPunkId = `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`;
      const command: SetWorkspaceMemberRoleCommand = {
        contract: "workspace.member-set-role@1",
        commandId: crypto.randomUUID(),
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { targetPunkId, role: "member", expectedRevision: revision },
      };
      const result = await authority.executeAuthorized(command, {
        sessionId: "11111111-1111-8111-8111-111111111111",
        punkId: ownerPunkId,
      });
      expect(result.ok, `member ${index}`).toBe(true);
      revision += 1;
    }
    const directPage = await authority.queryGovernancePage({
      workspaceId,
      punkId: ownerPunkId,
      limit: 100,
    });
    expect(directPage.ok).toBe(true);
    if (!directPage.ok || directPage.nextPositionPunkId === null) {
      throw new TypeError("Roster page did not expose its bounded position");
    }
    await expect(
      encodeWorkspaceGovernanceCursor(
        {
          version: 1,
          workspaceId,
          requesterPunkId: ownerPunkId,
          limit: 100,
          authorityCursor: directPage.authorityCursor,
          positionPunkId: directPage.nextPositionPunkId,
        },
        new TextEncoder().encode(env.DIRECTORY_CURSOR_KEY),
      ),
    ).resolves.toEqual(expect.any(String));

    const first = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance?limit=100`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const firstPage = (await first.json()) as WorkspaceGovernanceResponse;
    expect(firstPage.members).toHaveLength(100);
    expect(firstPage.workspace).toMatchObject({
      memberCount: 102,
      revision,
      cursor: revision,
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const second = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance?limit=100&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const secondPage = (await second.json()) as WorkspaceGovernanceResponse;
    expect(secondPage.members).toHaveLength(2);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set(
        [...firstPage.members, ...secondPage.members].map(
          ({ punkId }) => punkId,
        ),
      ).size,
    ).toBe(102);

    const nextPunkId = "00000000-0000-8000-8000-000000000103";
    const mutation: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: nextPunkId,
        role: "member",
        expectedRevision: revision,
      },
    };
    expect(
      (
        await authority.executeAuthorized(mutation, {
          sessionId: "11111111-1111-8111-8111-111111111111",
          punkId: ownerPunkId,
        })
      ).ok,
    ).toBe(true);
    const stale = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance?limit=100&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(stale.status, await stale.clone().text()).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "revision_conflict",
    });
  });

  it("admits at most one Punk when two claims race on one revision", async () => {
    const workspaceId = await createWorkspace(`race-${crypto.randomUUID()}`);
    const created = await createInvitation(workspaceId, { maxUses: 1 });
    const [other, third] = await Promise.all([
      claimInvitation(workspaceId, created.code),
      claimInvitation(workspaceId, created.code, crypto.randomUUID(), 1, {
        punkId: thirdPunkId,
        session: "session-third",
      }),
    ]);
    expect([other.status, third.status].sort()).toEqual([200, 409]);
    const rejected = other.status === 409 ? other : third;
    await expect(rejected.json()).resolves.toMatchObject({
      code: expect.stringMatching(
        /^(?:command_in_progress|invite_exhausted|revision_conflict)$/u,
      ),
    });

    const governance = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/governance`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(governance.status, await governance.clone().text()).toBe(200);
    const state = (await governance.json()) as WorkspaceGovernanceResponse;
    expect(state.members).toHaveLength(2);
  });
});
