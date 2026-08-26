import { env } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const workspaceId = "10000000-0000-8000-8000-000000000061";
const absorbedPunkId = "00000000-0000-8000-8000-000000000001";
const survivorPunkId = "00000000-0000-8000-8000-000000000002";
const ownerSessionId = "11111111-1111-8111-8111-111111111111";

function service(props: unknown) {
  type Rpc = {
    prepare(input: unknown): Promise<unknown>;
    apply(input: unknown): Promise<unknown>;
  };
  const factory = workerExports.AccountMergeWorkspaceService as (options: {
    props: unknown;
  }) => Rpc;
  return factory({ props });
}

describe("AccountMergeWorkspaceService", () => {
  it("fences the current Workspace when the account index revision is older", async () => {
    const workspace = env.WORKSPACES.getByName(workspaceId);
    await expect(
      workspace.execute({
        contract: "workspace.create@1",
        commandId: crypto.randomUUID(),
        actor: { kind: "punk", punkId: absorbedPunkId },
        payload: {
          slug: "account-merge-application",
          name: "Account Merge Application",
          visibility: "private",
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      workspace.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: crypto.randomUUID(),
          workspaceId,
          actor: { kind: "punk", punkId: absorbedPunkId },
          payload: {
            targetPunkId: survivorPunkId,
            role: "member",
            expectedRevision: 1,
          },
        },
        { sessionId: ownerSessionId, punkId: absorbedPunkId },
      ),
    ).resolves.toMatchObject({ ok: true });

    const input = {
      workspaceId,
      planId: "20000000-0000-8000-8000-000000000061",
      receiptId: "30000000-0000-8000-8000-000000000061",
      commitCommandId: "40000000-0000-8000-8000-000000000061",
      survivorPunkId,
      absorbedPunkId,
      expectedRevision: 1,
      survivorRole: "member",
      absorbedRole: "owner",
      resultingRole: "owner",
    };
    const authority = service({
      role: "punks-account-merge-workspace-applicator",
      environment: "local",
    });
    await expect(authority.prepare({ workspaces: [input] })).resolves.toEqual({
      ok: true,
      results: [
        {
          ok: true,
          workspaceId,
          role: "owner",
          revision: 3,
          replayed: false,
        },
      ],
    });
    await expect(
      workspace.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: crypto.randomUUID(),
          workspaceId,
          actor: { kind: "punk", punkId: absorbedPunkId },
          payload: {
            targetPunkId: survivorPunkId,
            role: "guest",
            expectedRevision: 2,
          },
        },
        { sessionId: ownerSessionId, punkId: absorbedPunkId },
      ),
    ).resolves.toEqual({ ok: false, code: "command_in_progress" });

    await expect(authority.apply({ workspaces: [input] })).resolves.toEqual({
      ok: true,
      results: [
        {
          ok: true,
          workspaceId,
          role: "owner",
          revision: 3,
          replayed: false,
        },
      ],
    });
    await expect(authority.apply({ workspaces: [input] })).resolves.toEqual({
      ok: true,
      results: [
        {
          ok: true,
          workspaceId,
          role: "owner",
          revision: 3,
          replayed: true,
        },
      ],
    });
    await expect(
      workspace.query({ contract: "workspace.get@1", workspaceId }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        ownerPunkId: survivorPunkId,
        members: [{ punkId: survivorPunkId, role: "owner" }],
        revision: 3,
      },
    });
  });

  it("fails closed when caller props are absent or widened", async () => {
    const input = { workspaces: [{ workspaceId }] };
    for (const props of [
      undefined,
      {},
      {
        role: "punks-account-merge-workspace-applicator",
        environment: "staging",
      },
      {
        role: "punks-account-merge-workspace-applicator",
        environment: "local",
        discover: true,
      },
    ]) {
      await expect(service(props).prepare(input)).resolves.toMatchObject({
        ok: false,
        code: "invalid_request",
      });
    }
  });
});
