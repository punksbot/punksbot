import type {
  ArchiveConversationCommand,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  JoinConversationCommand,
  MembershipJournalSegmentArchiveV2,
  RestoreConversationCommand,
  SetConversationMemberAccessCommand,
  SetWorkspaceMemberRoleCommand,
  UpdateConversationCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { deriveOpaqueUuid } from "@punks/core";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const authorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";

function createCommand(options: {
  commandId: string;
  slug: string;
  visibility?: "private" | "punks" | "public";
}): CreateWorkspaceCommand {
  return {
    contract: "workspace.create@1",
    commandId: options.commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: options.slug,
      name: "Core Team",
      visibility: options.visibility ?? "private",
    },
  };
}

async function create(command: CreateWorkspaceCommand) {
  return SELF.fetch("https://punks.bot/api/internal/v1/workspaces", {
    method: "POST",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function addWorkspaceMember(
  workspaceId: string,
  commandId: string,
  targetPunkId = otherPunkId,
  role: SetWorkspaceMemberRoleCommand["payload"]["role"] = "member",
) {
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId, role },
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

async function createConversation(
  command: CreateConversationCommand,
  session = "session-owner",
) {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${command.workspaceId}/conversations`,
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

describe("Punks Workspace API", () => {
  it("requires explicit Operator authentication", async () => {
    const command = createCommand({
      commandId: "cfb85ecb-363a-4d06-a1aa-d00481cf5124",
      slug: "operator-auth",
    });
    const response = await SELF.fetch(
      "https://punks.bot/api/internal/v1/workspaces",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": command.commandId,
        },
        body: JSON.stringify(command),
      },
    );
    expect(response.status).toBe(401);
  });

  it("creates exactly one Workspace for an idempotent command", async () => {
    const command = createCommand({
      commandId: "537dc710-324c-4d4a-b8dc-a1fd8c177537",
      slug: "idempotent-core",
    });
    const first = await create(command);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      workspace: { id: string; slug: string; cursor: number };
      event: { id: string; kind: number };
      replayed: boolean;
    };
    expect(firstBody).toMatchObject({
      workspace: { slug: "idempotent-core", cursor: 1 },
      event: { kind: 50000 },
      replayed: false,
    });
    expect(firstBody.event.id).toMatch(/^[0-9a-f]{64}$/);

    const replay = await create(command);
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as typeof firstBody;
    expect(replayBody.workspace.id).toBe(firstBody.workspace.id);
    expect(replayBody.event.id).toBe(firstBody.event.id);
    expect(replayBody.replayed).toBe(true);
  });

  it("rejects an idempotency key reused with another payload", async () => {
    const commandId = "bca18b94-41d2-4c90-b7b3-30b0783a9a01";
    const original = createCommand({ commandId, slug: "payload-lock" });
    expect((await create(original)).status).toBe(201);

    const changed = {
      ...original,
      payload: { ...original.payload, name: "Changed after commit" },
    };
    const response = await create(changed);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const moved = {
      ...original,
      payload: { ...original.payload, slug: "payload-lock-other" },
    };
    const movedResponse = await create(moved);
    expect(movedResponse.status).toBe(409);
    await expect(movedResponse.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const releasedSlug = await create(
      createCommand({
        commandId: "9d9ab700-8589-4ab6-bd6b-4e4e0694d789",
        slug: "payload-lock-other",
      }),
    );
    expect(releasedSlug.status).toBe(201);
  });

  it("resumes the same pending command after a transient attestation failure", async () => {
    const command = createCommand({
      commandId: "eeb7e223-5bcc-4daa-9697-fc7c3a7d31c7",
      slug: "retry-attestation",
    });
    const failed = await create(command);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      code: "attestation_failed",
      retry: "same_command",
    });

    const resumed = await create(command);
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      workspace: { slug: "retry-attestation", cursor: 1 },
      replayed: true,
    });
  });

  it("keeps a Workspace command pending when Attestation returns a schema-valid false signature", async () => {
    const command = createCommand({
      commandId: "90000000-0000-8000-8000-000000000001",
      slug: "false-workspace-signature",
    });
    const response = await create(command);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "attestation_failed",
      retry: "same_command",
    });

    const workspaceId = await deriveOpaqueUuid(
      "punks.workspace.v1",
      command.commandId,
    );
    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_command",
            )
            .one().count,
        ).toBe(1);
        for (const table of [
          "workspace_state",
          "journal",
          "command_results",
          "outbox",
        ]) {
          expect(
            state.storage.sql
              .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
              .one().count,
          ).toBe(0);
        }
      },
    );
  });

  it.each([
    [
      "a signed event that differs from the requested unsigned event",
      "90000000-0000-8000-8000-000000000002",
      "mutated-workspace-attestation",
    ],
    [
      "a response key version that differs from its final attestation tag",
      "90000000-0000-8000-8000-000000000003",
      "mismatched-workspace-key-version",
    ],
  ])("keeps a Workspace command pending for %s", async (_case, commandId, slug) => {
    const command = createCommand({ commandId, slug });
    const response = await create(command);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "attestation_failed",
      retry: "same_command",
    });

    const workspaceId = await deriveOpaqueUuid(
      "punks.workspace.v1",
      command.commandId,
    );
    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
            .one().count,
        ).toBe(0);
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
        ).toBe(0);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_command",
            )
            .one().count,
        ).toBe(1);
      },
    );
  });

  it("enforces globally unique Workspace slugs", async () => {
    expect(
      (
        await create(
          createCommand({
            commandId: "1acaa6fd-2e3a-4214-8a2c-e032b8ce322d",
            slug: "unique-workspace",
          }),
        )
      ).status,
    ).toBe(201);
    const conflict = await create(
      createCommand({
        commandId: "30fbf2fc-f902-47ee-b637-36786170d8fd",
        slug: "unique-workspace",
      }),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "slug_claimed",
    });
  });

  it("keeps private Workspaces limited to members and the Operator", async () => {
    const command = createCommand({
      commandId: "b19b70da-64bb-4f5f-995c-0a34c0f05a13",
      slug: "private-core",
    });
    expect((await create(command)).status).toBe(201);

    const anonymous = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/private-core",
    );
    expect(anonymous.status).toBe(401);

    const operator = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/private-core",
      {
        headers: authorization,
      },
    );
    expect(operator.status).toBe(200);

    const owner = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/private-core",
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(owner.status).toBe(200);
    await expect(owner.json()).resolves.toMatchObject({
      workspace: {
        ownerPunkId,
        members: [{ punkId: ownerPunkId, role: "owner" }],
      },
    });

    const otherPunk = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/private-core",
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(otherPunk.status).toBe(403);
  });

  it("lets any authenticated Punk read a redacted punks-visible Workspace", async () => {
    const command = createCommand({
      commandId: "b12473bc-a252-4ea2-a29a-02ff111b0c88",
      slug: "all-punks",
      visibility: "punks",
    });
    expect((await create(command)).status).toBe(201);

    const anonymous = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/all-punks",
    );
    expect(anonymous.status).toBe(401);

    const punk = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/all-punks",
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(punk.status).toBe(200);
    const body = (await punk.json()) as { workspace: Record<string, unknown> };
    expect(body.workspace).toMatchObject({
      slug: "all-punks",
      visibility: "punks",
    });
    expect(body.workspace).not.toHaveProperty("ownerPunkId");
    expect(body.workspace).not.toHaveProperty("members");
  });

  it("lets an Owner manage roles without trusting a spoofed actor", async () => {
    const created = await create(
      createCommand({
        commandId: "5ba8ec94-009e-49dd-b7e2-3d85e71ef136",
        slug: "membership-core",
      }),
    );
    const createdBody = (await created.json()) as { workspace: { id: string } };
    const workspaceId = createdBody.workspace.id;
    const setRole: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "fc33ed62-27ec-4e0b-bb46-8904faf226d3",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: otherPunkId, role: "member" },
    };
    const memberUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`;
    const put = (
      command: SetWorkspaceMemberRoleCommand,
      cookie = "session-owner",
    ) =>
      SELF.fetch(memberUrl, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `__Host-punks_session=${cookie}`,
          "idempotency-key": command.commandId,
        },
        body: JSON.stringify(command),
      });

    const added = await put(setRole);
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({
      workspace: {
        members: expect.arrayContaining([
          { punkId: otherPunkId, role: "member" },
        ]),
      },
      replayed: false,
    });
    const replay = await put(setRole);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    const memberRead = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/membership-core",
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(memberRead.status).toBe(200);

    const spoofed = await put(
      {
        ...setRole,
        commandId: "94525c2f-4b18-4dec-8c3d-26a822e7cbaa",
        payload: { targetPunkId: otherPunkId, role: "moderator" },
      },
      "session-other",
    );
    expect(spoofed.status).toBe(403);

    const remove = {
      contract: "workspace.member-remove@1",
      commandId: "09e49917-f18a-417e-b3d4-175b3d34ed62",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: otherPunkId },
    } as const;
    const removed = await SELF.fetch(memberUrl, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": remove.commandId,
      },
      body: JSON.stringify(remove),
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.not.toHaveProperty("event");

    const formerMember = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/membership-core",
      { headers: { cookie: "__Host-punks_session=session-other" } },
    );
    expect(formerMember.status).toBe(403);
  });

  it("refuses to add a nonexistent Punk to a Workspace", async () => {
    const created = await create(
      createCommand({
        commandId: "a243f7d7-ddbe-4667-b07e-5aa21ad1ea25",
        slug: "known-punks-only",
      }),
    );
    const createdBody = (await created.json()) as { workspace: { id: string } };
    const workspaceId = createdBody.workspace.id;
    const missingPunkId = "00000000-0000-8000-8000-000000000003";
    const command = {
      contract: "workspace.member-set-role@1",
      commandId: "9f9accd8-bb81-42bb-a3a1-a0158536947f",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: missingPunkId, role: "guest" },
    };
    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${missingPunkId}`,
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
    expect(response.status).toBe(400);
  });

  it("renames through a new slug claim and preserves the stable id", async () => {
    const created = await create(
      createCommand({
        commandId: "0e458a1d-9232-454a-a8cc-b5a36cf6b608",
        slug: "before-rename",
        visibility: "public",
      }),
    );
    const createdBody = (await created.json()) as { workspace: { id: string } };
    const workspaceId = createdBody.workspace.id;
    const rename = {
      contract: "workspace.rename@1",
      commandId: "6d43ccb7-e999-4583-ac53-94b60318956c",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "after-rename" },
    } as const;

    const response = await SELF.fetch(
      `https://punks.bot/api/internal/v1/workspaces/${workspaceId}/slug`,
      {
        method: "PATCH",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": rename.commandId,
        },
        body: JSON.stringify(rename),
      },
    );
    expect(response.status).toBe(200);
    const renamed = (await response.json()) as {
      workspace: { id: string; slug: string; cursor: number };
    };
    expect(renamed.workspace).toEqual({
      ...renamed.workspace,
      id: workspaceId,
      slug: "after-rename",
      cursor: 2,
    });

    const oldSlug = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/before-rename",
      {
        redirect: "manual",
      },
    );
    expect(oldSlug.status).toBe(308);
    expect(oldSlug.headers.get("location")).toBe(
      "/api/v1/workspaces/after-rename",
    );

    const newSlug = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/after-rename",
    );
    expect(newSlug.status).toBe(200);
    const publicBody = (await newSlug.json()) as {
      workspace: Record<string, unknown>;
      canonicalPath: string;
    };
    expect(publicBody).toMatchObject({
      workspace: { id: workspaceId, slug: "after-rename", cursor: 2 },
      canonicalPath: "/w/after-rename",
    });
    expect(publicBody.workspace).not.toHaveProperty("ownerPunkId");
    expect(publicBody.workspace).not.toHaveProperty("members");

    const workspace = env.WORKSPACES.getByName(workspaceId);
    await runInDurableObject(workspace, async (instance) => {
      expect(instance.alarm).toBeTypeOf("function");
      await instance.alarm?.();
    });
    const archived = await env.JOURNAL_ARCHIVE_BUCKET.list({
      prefix: `workspaces/${workspaceId}/journal/`,
    });
    expect(archived.objects).toHaveLength(1);
    const archivedObject = await env.JOURNAL_ARCHIVE_BUCKET.get(
      archived.objects[0]?.key ?? "",
    );
    expect(archivedObject).not.toBeNull();
    const segment =
      (await archivedObject?.json()) as MembershipJournalSegmentArchiveV2;
    expect(
      validateContract("punks://contracts/journal.segment@2", segment),
    ).toEqual({
      valid: true,
    });
    expect(segment).toMatchObject({
      workspaceId,
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
      entries: [
        expect.objectContaining({
          cursor: 1,
          chunks: [expect.objectContaining({ schemaVersion: 2 })],
        }),
      ],
      seal: { kind: 50002 },
    });

    const counts = await runInDurableObject(workspace, (_instance, state) => ({
      hot: state.storage.sql
        .exec<Record<"count", number>>("SELECT COUNT(*) AS count FROM journal")
        .one().count,
      archived: state.storage.sql
        .exec<Record<"count", number>>(
          "SELECT COUNT(*) AS count FROM archive_segments",
        )
        .one().count,
    }));
    expect(counts).toEqual({ hot: 1, archived: 1 });
  });

  it("finishes the slug saga when a rename was committed by alarm recovery", async () => {
    const created = await create(
      createCommand({
        commandId: "c256dc46-693c-4701-8324-533bab028f8f",
        slug: "rename-recovery-before",
        visibility: "public",
      }),
    );
    const createdBody = (await created.json()) as { workspace: { id: string } };
    const workspaceId = createdBody.workspace.id;
    const rename = {
      contract: "workspace.rename@1",
      commandId: "faea0a26-8012-4659-a360-e27aa3a7a103",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "retry-rename" },
    } as const;
    const requestRename = () =>
      SELF.fetch(
        `https://punks.bot/api/internal/v1/workspaces/${workspaceId}/slug`,
        {
          method: "PATCH",
          headers: {
            ...authorization,
            "content-type": "application/json",
            "idempotency-key": rename.commandId,
          },
          body: JSON.stringify(rename),
        },
      );

    expect((await requestRename()).status).toBe(503);
    const workspace = env.WORKSPACES.getByName(workspaceId);
    await runInDurableObject(workspace, async (instance) => {
      expect(instance.alarm).toBeTypeOf("function");
      await instance.alarm?.();
    });

    const recovered = await requestRename();
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({
      workspace: { id: workspaceId, slug: "retry-rename", cursor: 2 },
      replayed: true,
    });
    const previous = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces/rename-recovery-before",
      { redirect: "manual" },
    );
    expect(previous.status).toBe(308);
    expect(previous.headers.get("location")).toBe(
      "/api/v1/workspaces/retry-rename",
    );
  });

  it("creates, redacts, joins, and reveals an open Conversation with strong Workspace authorization", async () => {
    const createdWorkspace = await create(
      createCommand({
        commandId: "352bdaf2-c9c3-4cdb-81ac-5f1c4c137af7",
        slug: "conversation-authority",
      }),
    );
    const workspaceId = (
      (await createdWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    expect(
      (
        await addWorkspaceMember(
          workspaceId,
          "58af3e52-cd1b-4e26-9c16-0f7272be942c",
        )
      ).status,
    ).toBe(200);

    const command: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: "f4f52955-4a69-488e-b8f0-f4c329708ce3",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { name: "# general", type: "stream", visibility: "open" },
    };
    const created = await createConversation(command);
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      conversation: { id: string; name: string; cursor: number };
      replayed: boolean;
    };
    expect(body).toMatchObject({
      conversation: { name: "general", cursor: 1 },
      replayed: false,
    });

    const url = `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${body.conversation.id}`;
    const beforeJoin = await SELF.fetch(url, {
      headers: { cookie: "__Host-punks_session=session-other" },
    });
    expect(beforeJoin.status).toBe(200);
    const redacted = (await beforeJoin.json()) as {
      conversation: Record<string, unknown>;
    };
    expect(redacted.conversation).not.toHaveProperty("members");
    expect(redacted.conversation).not.toHaveProperty("ownerPunkId");

    const join: JoinConversationCommand = {
      contract: "conversation.join@1",
      commandId: "b0cdf8f1-2093-479d-8acb-c0a746597aab",
      workspaceId,
      conversationId: body.conversation.id,
      actor: { kind: "punk", punkId: otherPunkId },
      payload: {},
    };
    const joined = await SELF.fetch(`${url}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": join.commandId,
      },
      body: JSON.stringify(join),
    });
    expect(joined.status).toBe(200);
    await expect(joined.json()).resolves.toMatchObject({
      conversation: {
        cursor: 2,
        members: expect.arrayContaining([
          expect.objectContaining({ punkId: otherPunkId, access: "member" }),
        ]),
      },
    });

    const afterJoin = await SELF.fetch(url, {
      headers: { cookie: "__Host-punks_session=session-other" },
    });
    expect(afterJoin.status).toBe(200);
    await expect(afterJoin.json()).resolves.toMatchObject({
      conversation: {
        members: expect.arrayContaining([
          expect.objectContaining({ punkId: otherPunkId }),
        ]),
      },
    });
  });

  it("keeps a private Conversation hidden until an authorized invitation", async () => {
    const createdWorkspace = await create(
      createCommand({
        commandId: "bbedee3e-d0ae-423b-bea0-17a1eb996142",
        slug: "private-conversation",
        visibility: "public",
      }),
    );
    const workspaceId = (
      (await createdWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    expect(
      (
        await addWorkspaceMember(
          workspaceId,
          "45fa4e70-e9ed-4cd4-938f-2de8e254c839",
        )
      ).status,
    ).toBe(200);
    const createPrivate: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: "85eb0c1c-2532-4161-a225-842ea7323255",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        name: "incident-room",
        type: "stream",
        visibility: "private",
      },
    };
    const created = await createConversation(createPrivate);
    const conversationId = (
      (await created.json()) as { conversation: { id: string } }
    ).conversation.id;
    const url = `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`;
    expect((await SELF.fetch(url)).status).toBe(403);
    expect(
      (
        await SELF.fetch(url, {
          headers: { cookie: "__Host-punks_session=session-other" },
        })
      ).status,
    ).toBe(403);

    const invite: SetConversationMemberAccessCommand = {
      contract: "conversation.member-set-access@1",
      commandId: "f443da37-d9dc-45a4-9fe7-91f0f5fa6d18",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: otherPunkId, access: "guest" },
    };
    const invited = await SELF.fetch(`${url}/members/${otherPunkId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": invite.commandId,
      },
      body: JSON.stringify(invite),
    });
    expect(invited.status).toBe(200);
    await expect(invited.json()).resolves.toMatchObject({});
    expect(
      (
        await SELF.fetch(url, {
          headers: { cookie: "__Host-punks_session=session-other" },
        })
      ).status,
    ).toBe(200);

    const spoofed = await SELF.fetch(`${url}/members/${ownerPunkId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-other",
        "idempotency-key": "5876fec6-8059-46ec-a532-a09eb441ad1d",
      },
      body: JSON.stringify({
        ...invite,
        commandId: "5876fec6-8059-46ec-a532-a09eb441ad1d",
        payload: { targetPunkId: ownerPunkId, access: "manager" },
      }),
    });
    expect(spoofed.status).toBe(403);
  });

  it("deduplicates direct Conversations by the unordered participant set", async () => {
    const createdWorkspace = await create(
      createCommand({
        commandId: "c85b8d98-cec9-418e-ae86-a84aaf8a986e",
        slug: "direct-conversation",
      }),
    );
    const workspaceId = (
      (await createdWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    expect(
      (
        await addWorkspaceMember(
          workspaceId,
          "5047e6d4-9a5c-4284-b577-0acfe47032f1",
        )
      ).status,
    ).toBe(200);
    const firstCommand: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: "f8ca1974-0cbe-4dbd-84b4-b0c923f713bd",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        name: "ignored-by-dm",
        type: "dm",
        visibility: "private",
        participantPunkIds: [otherPunkId],
      },
    };
    const first = await createConversation(firstCommand);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      conversation: { id: string; name: string; type: string };
    };
    expect(firstBody.conversation).toMatchObject({ name: "DM", type: "dm" });

    const duplicate = await createConversation({
      ...firstCommand,
      commandId: "4975929c-a8da-4ee1-bf06-bfdbba9a49ed",
      payload: { ...firstCommand.payload, name: "another ignored name" },
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      conversation: { id: firstBody.conversation.id, type: "dm" },
      existing: true,
      replayed: false,
    });
  });

  it("derives Conversation identities from both Workspace and command id", async () => {
    const commandId = "c6746fa8-ec50-4d20-ae3d-f1ddbbd7841f";
    const firstWorkspace = await create(
      createCommand({
        commandId: "eb419e62-0302-4911-9f6b-f4db9e25c727",
        slug: "conversation-tenant-a",
      }),
    );
    const secondWorkspace = await create(
      createCommand({
        commandId: "e2eff79b-3ca9-48be-ad00-cf33ba437e5d",
        slug: "conversation-tenant-b",
      }),
    );
    const firstWorkspaceId = (
      (await firstWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const secondWorkspaceId = (
      (await secondWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const makeCommand = (workspaceId: string): CreateConversationCommand => ({
      contract: "conversation.create@1",
      commandId,
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { name: "same-command", type: "stream", visibility: "open" },
    });
    const first = await createConversation(makeCommand(firstWorkspaceId));
    const second = await createConversation(makeCommand(secondWorkspaceId));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { conversation: { id: string } })
      .conversation.id;
    const secondId = ((await second.json()) as { conversation: { id: string } })
      .conversation.id;
    expect(firstId).not.toBe(secondId);
  });

  it("updates metadata atomically, archives, rejects archived mutation, and restores", async () => {
    const createdWorkspace = await create(
      createCommand({
        commandId: "5e1d909a-6c1f-4b97-802e-b99c951ac9e8",
        slug: "conversation-lifecycle",
      }),
    );
    const workspaceId = (
      (await createdWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const createConversationCommand: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: "d233b0e3-80e4-4fb4-8d2a-941c2b630af2",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { name: "operations", type: "stream", visibility: "open" },
    };
    const created = await createConversation(createConversationCommand);
    const conversationId = (
      (await created.json()) as { conversation: { id: string } }
    ).conversation.id;
    const baseUrl = `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`;
    const update: UpdateConversationCommand = {
      contract: "conversation.update@1",
      commandId: "f2d9dfcb-0a19-4912-8798-6e1b28ad9cf9",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        name: "incidents",
        description: "Production response",
        visibility: "private",
        topic: "Database saturation",
        purpose: "Coordinate mitigation",
        topicRequired: true,
        maxMembers: 25,
        ttlSeconds: 120,
      },
    };
    const updated = await SELF.fetch(baseUrl, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": update.commandId,
      },
      body: JSON.stringify(update),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      conversation: {
        name: "incidents",
        description: "Production response",
        visibility: "private",
        topic: "Database saturation",
        purpose: "Coordinate mitigation",
        topicRequired: true,
        maxMembers: 25,
        ttlSeconds: 120,
        ttlDeadline: expect.any(String),
        cursor: 2,
      },
    });

    const archive: ArchiveConversationCommand = {
      contract: "conversation.archive@1",
      commandId: "dbca4023-17a8-4431-8780-46c09236dcb8",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { cause: "manual" },
    };
    const archived = await SELF.fetch(`${baseUrl}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": archive.commandId,
      },
      body: JSON.stringify(archive),
    });
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({
      conversation: { status: "archived", ttlDeadline: null, cursor: 3 },
    });

    const blockedUpdate = { ...update, commandId: crypto.randomUUID() };
    const blocked = await SELF.fetch(baseUrl, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": blockedUpdate.commandId,
      },
      body: JSON.stringify(blockedUpdate),
    });
    expect(blocked.status).toBe(409);

    const restore: RestoreConversationCommand = {
      contract: "conversation.restore@1",
      commandId: "682ce246-2a27-4f51-b038-8823dbc7f0b1",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {},
    };
    const restored = await SELF.fetch(`${baseUrl}/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": restore.commandId,
      },
      body: JSON.stringify(restore),
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      conversation: {
        status: "active",
        archivedAt: null,
        ttlDeadline: expect.any(String),
        cursor: 4,
      },
    });
  });

  it("archives an expired TTL exactly through the Conversation authority alarm", async () => {
    const createdWorkspace = await create(
      createCommand({
        commandId: "4f7644eb-e63f-41b6-8314-edc6b82f1bb4",
        slug: "conversation-ttl",
      }),
    );
    const workspaceId = (
      (await createdWorkspace.json()) as { workspace: { id: string } }
    ).workspace.id;
    const command: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: "1069cc84-0ec9-4b5b-945f-a2c2929b87d9",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        name: "ephemeral",
        type: "stream",
        visibility: "open",
        ttlSeconds: 1,
      },
    };
    const created = await createConversation(command);
    const conversationId = (
      (await created.json()) as { conversation: { id: string } }
    ).conversation.id;
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const stub = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });

    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conversation: {
        status: "archived",
        archivedAt: expect.any(String),
        ttlDeadline: null,
        cursor: 2,
      },
    });
  });
});
