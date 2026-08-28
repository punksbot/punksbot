import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
let response;
let handler;
let calls;

before(() => {
  Object.assign(globalThis, { window: dom.window });
  dom.window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      calls.push({ command, args });
      return structuredClone(
        handler === undefined ? response : handler(command, args),
      );
    },
  };
});

beforeEach(() => {
  calls = [];
  handler = undefined;
  response = undefined;
});

after(() => dom.window.close());

test("Account session state rejects every field outside the sanitized view", async () => {
  const { TauriPunksAccountClient } = await import("./punksTauriClient.ts");
  response = {
    state: "signed_out",
    authentication: { phase: "idle" },
    resumeAvailable: false,
    cookie: "must-never-cross-ipc",
  };

  await assert.rejects(new TauriPunksAccountClient().getAccountSessionState(), {
    kind: "contract_violation",
  });
});

test("semantic authentication methods use only their dedicated typed IPC commands", async () => {
  const session = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    punkId: "22222222-2222-4222-8222-222222222222",
    authenticatedAt: "2026-08-25T10:00:00.000Z",
    expiresAt: "2026-09-25T10:00:00.000Z",
    recentReauthUntil: null,
    punk: {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Typed IPC Punk",
      avatarUrl: null,
    },
  };
  handler = (command, args) => {
    switch (command) {
      case "punks_get_account_session_state":
        return {
          state: "authenticated",
          session,
          authentication: { phase: "idle" },
          resumeAvailable: false,
        };
      case "punks_start_sign_in":
        return { phase: "started", intent: "sign_in", method: args.provider };
      case "punks_start_account_switch":
        return {
          phase: "started",
          intent: "switch_account",
          method: args.provider,
        };
      case "punks_start_reauthentication":
        return {
          phase: "started",
          intent: "reauthenticate",
          method: args.method,
        };
      case "punks_start_identity_link":
        return {
          phase: "started",
          intent: `link_${args.provider}`,
          method: args.provider,
        };
      case "punks_resume_interrupted_authentication":
        return { phase: "ready" };
      case "punks_cancel_authentication":
        return { phase: "cancelled" };
      case "punks_renew_account_session":
        return { phase: "idle" };
      case "punks_sign_out":
        return "queued";
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  };

  const { TauriPunksAccountClient } = await import("./punksTauriClient.ts");
  const client = new TauriPunksAccountClient();
  await client.getAccountSessionState();
  await client.startSignIn("google");
  await client.startAccountSwitch("github");
  await client.startReauthentication("google", "account_merge");
  await client.startIdentityLink("github");
  assert.equal(typeof client.startPasskeyRegistration, "undefined");
  await client.resumeInterruptedAuthentication();
  await client.cancelAuthentication();
  await client.renewAccountSession();
  assert.equal(await client.signOut(), "queued");

  assert.deepEqual(calls, [
    { command: "punks_get_account_session_state", args: {} },
    { command: "punks_start_sign_in", args: { provider: "google" } },
    { command: "punks_start_account_switch", args: { provider: "github" } },
    {
      command: "punks_start_reauthentication",
      args: {
        method: "google",
        purpose: "account_merge",
        workspaceOwnershipTransfer: undefined,
      },
    },
    { command: "punks_start_identity_link", args: { provider: "github" } },
    { command: "punks_resume_interrupted_authentication", args: {} },
    { command: "punks_cancel_authentication", args: {} },
    { command: "punks_renew_account_session", args: {} },
    { command: "punks_sign_out", args: {} },
  ]);
});

test("Workspace resolution sends an explicit durable-id or slug identity", async () => {
  handler = (command) => {
    if (command === "punks_resolve_workspace") return null;
    throw new Error(`Unexpected command: ${command}`);
  };
  const { TauriPunksAccountClient } = await import("./punksTauriClient.ts");
  const client = new TauriPunksAccountClient();

  await client.resolveWorkspace({
    kind: "id",
    workspaceId: "11111111-1111-4111-8111-111111111111",
  });
  await client.resolveWorkspace({ kind: "slug", workspaceSlug: "alpha" });

  assert.deepEqual(calls, [
    {
      command: "punks_resolve_workspace",
      args: {
        identity: {
          kind: "id",
          workspaceId: "11111111-1111-4111-8111-111111111111",
        },
      },
    },
    {
      command: "punks_resolve_workspace",
      args: { identity: { kind: "slug", workspaceSlug: "alpha" } },
    },
  ]);
});

test("the Tauri WorkspaceSession transports a native aggregate beyond one page", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const punkId = "22222222-2222-4222-8222-222222222222";
  const streams = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    workspaceId,
    name: `Stream ${index + 1}`,
    type: "stream",
    visibility: "private",
    description: null,
    topic: null,
    purpose: null,
    topicRequired: false,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: index + 1,
    updatedAt: "2026-08-25T10:00:00.000Z",
  }));
  handler = (command) => {
    if (command === "punks_open_workspace") {
      return {
        origin: "https://staging.punks.bot",
        punkId,
        workspaceId,
        generation: 1,
      };
    }
    if (command === "punks_list_streams") return streams;
    throw new Error(`Unexpected command: ${command}`);
  };
  const { TauriPunksAccountClient } = await import("./punksTauriClient.ts");
  const session = await new TauriPunksAccountClient().openWorkspace(
    workspaceId,
  );

  const listed = await session.listStreams();

  assert.equal(listed.length, 101);
  assert.equal(listed[100].name, "Stream 101");
});

test("identity governance uses only dedicated typed IPC commands", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const punkId = "22222222-2222-4222-8222-222222222222";
  const targetPunkId = "33333333-3333-4333-8333-333333333333";
  const invitationId = "77777777-7777-4777-8777-777777777777";
  const code = `${workspaceId}.${"A".repeat(43)}`;
  const invitation = {
    contract: "workspace.invitation@1",
    invitationId,
    workspace: { id: workspaceId, slug: "alpha", name: "Alpha" },
    workspaceRevision: 1,
    role: "member",
    status: "issued",
    issuedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-09-02T00:00:00.000Z",
    revokedAt: null,
    maxUses: 1,
    uses: 0,
    usesRemaining: 1,
  };
  const governance = {
    contract: "workspace.governance-view@1",
    id: workspaceId,
    slug: "alpha",
    name: "Alpha",
    visibility: "private",
    status: "active",
    ownerPunkId: punkId,
    memberCount: 2,
    revision: 1,
    cursor: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
  handler = (command) => {
    switch (command) {
      case "punks_open_workspace":
        return {
          origin: "https://staging.punks.bot",
          punkId,
          workspaceId,
          generation: 1,
        };
      case "punks_get_workspace_invitation":
        return invitation;
      case "punks_claim_workspace_invitation":
        return {
          contract: "workspace.invite-claim-response@1",
          result: "joined",
          workspace: {
            id: workspaceId,
            slug: "alpha",
            name: "Alpha",
            visibility: "private",
            role: "member",
            revision: 2,
          },
          replayed: false,
        };
      case "punks_get_workspace_governance":
        return {
          contract: "workspace.governance-response@1",
          workspace: governance,
          members: [
            { punkId, role: "owner" },
            { punkId: targetPunkId, role: "member" },
          ],
          nextCursor: null,
        };
      case "punks_create_workspace_invitation":
        return {
          contract: "workspace.invite-response@1",
          invitation,
          code,
          replayed: false,
        };
      case "punks_revoke_workspace_invitation":
        return {
          contract: "workspace.invite-revoke-response@1",
          invitation: {
            ...invitation,
            status: "revoked",
            revokedAt: "2026-08-26T00:01:00.000Z",
          },
          replayed: false,
        };
      case "punks_set_workspace_member_role":
      case "punks_remove_workspace_member":
        return {
          contract: "workspace.membership-mutation-response@1",
          workspace: governance,
          memberDeltas: [
            {
              punkId: targetPunkId,
              present: command === "punks_set_workspace_member_role",
              role:
                command === "punks_set_workspace_member_role"
                  ? "moderator"
                  : null,
            },
          ],
          replayed: false,
        };
      case "punks_transfer_workspace_ownership":
        return {
          contract: "workspace.membership-lifecycle-response@1",
          workspaceId,
          revision: 2,
          outcome: "ownership_transferred",
          role: "member",
          replayed: false,
        };
      case "punks_leave_workspace":
        return {
          contract: "workspace.membership-lifecycle-response@1",
          workspaceId,
          revision: 3,
          outcome: "left",
          role: null,
          replayed: false,
        };
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  };

  const { TauriPunksAccountClient } = await import("./punksTauriClient.ts");
  const client = new TauriPunksAccountClient();
  await client.getWorkspaceInvitation(code);
  await client.claimWorkspaceInvitation({ code, expectedRevision: 1 });
  const session = await client.openWorkspace(workspaceId);
  await session.getGovernancePage({ limit: 100, cursor: null });
  await session.createInvitation({
    role: "member",
    expectedRevision: 1,
  });
  await session.revokeInvitation({ invitationId, expectedRevision: 1 });
  await session.setMemberRole({
    targetPunkId,
    role: "moderator",
    expectedRevision: 1,
  });
  await session.removeMember({ targetPunkId, expectedRevision: 1 });
  await session.transferOwnership({
    targetPunkId,
    expectedRevision: 1,
  });
  await session.leaveWorkspace();

  assert.deepEqual(
    calls.slice(0, 2).map(({ command, args }) => ({ command, args })),
    [
      { command: "punks_get_workspace_invitation", args: { code } },
      {
        command: "punks_claim_workspace_invitation",
        args: { input: { code, expectedRevision: 1 } },
      },
    ],
  );
  assert.deepEqual(
    calls.slice(3).map(({ command, args }) => ({ command, args })),
    [
      {
        command: "punks_get_workspace_governance",
        args: {
          lease: session.lease,
          input: { limit: 100, cursor: null },
        },
      },
      {
        command: "punks_create_workspace_invitation",
        args: {
          lease: session.lease,
          input: { role: "member", expectedRevision: 1 },
        },
      },
      {
        command: "punks_revoke_workspace_invitation",
        args: {
          lease: session.lease,
          input: { invitationId, expectedRevision: 1 },
        },
      },
      {
        command: "punks_set_workspace_member_role",
        args: {
          lease: session.lease,
          input: { targetPunkId, role: "moderator", expectedRevision: 1 },
        },
      },
      {
        command: "punks_remove_workspace_member",
        args: {
          lease: session.lease,
          input: { targetPunkId, expectedRevision: 1 },
        },
      },
      {
        command: "punks_transfer_workspace_ownership",
        args: {
          lease: session.lease,
          input: { targetPunkId, expectedRevision: 1 },
        },
      },
      {
        command: "punks_leave_workspace",
        args: { lease: session.lease },
      },
    ],
  );
});
