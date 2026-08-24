import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const WORKSPACE_ID = "10000000-0000-8000-8000-000000000061";
const OWNER_PUNK_ID = "20000000-0000-8000-8000-000000000061";
const MEMBER_PUNK_ID = "30000000-0000-8000-8000-000000000061";

interface RightsIndexFixture {
  resetCalls(): Promise<void>;
  setPhaseAvailable(
    phase: "prepare" | "commit" | "abort",
    value: boolean,
  ): Promise<void>;
  calls(): Promise<
    Array<{
      phase: "prepare" | "commit" | "abort";
      input: {
        operationId: string;
        workspaceId: string;
        punkId: string;
        membership: null | { role: string; revision: number };
      };
    }>
  >;
}

function rightsIndex(): RightsIndexFixture {
  return env.ACCOUNT_MERGE_RIGHTS_INDEX as unknown as RightsIndexFixture;
}

function createCommand(commandId: string) {
  return {
    contract: "workspace.create@1" as const,
    commandId,
    actor: { kind: "punk" as const, punkId: OWNER_PUNK_ID },
    payload: {
      slug: "account-merge-index",
      name: "Account merge index",
      visibility: "private" as const,
    },
  };
}

describe("authoritative account-merge rights indexing", () => {
  beforeEach(async () => {
    await rightsIndex().resetCalls();
  });

  it("keeps a committed Workspace fail-closed until its rights outbox is acknowledged", async () => {
    const workspace = env.WORKSPACES.getByName(WORKSPACE_ID);
    const command = createCommand("40000000-0000-8000-8000-000000000061");
    await rightsIndex().setPhaseAvailable("commit", false);

    expect(await workspace.execute(command)).toEqual({
      ok: false,
      code: "internal",
    });
    expect(
      await workspace.query({
        contract: "workspace.get@1",
        workspaceId: WORKSPACE_ID,
      }),
    ).toMatchObject({ ok: true, state: { id: WORKSPACE_ID, revision: 1 } });

    await rightsIndex().setPhaseAvailable("commit", true);
    expect(await workspace.execute(command)).toMatchObject({
      ok: true,
      replayed: true,
      value: { state: { id: WORKSPACE_ID, revision: 1 } },
    });

    const calls = await rightsIndex().calls();
    expect(calls[0]).toEqual({
      phase: "prepare",
      input: {
        operationId: command.commandId,
        workspaceId: WORKSPACE_ID,
        punkId: OWNER_PUNK_ID,
        membership: { role: "owner", revision: 1 },
      },
    });
    expect(
      calls.filter((call) => call.phase === "commit").length,
    ).toBeGreaterThanOrEqual(2);
    expect(calls.at(-1)).toMatchObject({
      phase: "commit",
      input: { operationId: command.commandId },
    });
  });

  it("prepares and commits the exact Punk changed by a membership command", async () => {
    const workspaceId = "10000000-0000-8000-8000-000000000062";
    const workspace = env.WORKSPACES.getByName(workspaceId);
    expect(
      await workspace.execute(
        createCommand("40000000-0000-8000-8000-000000000062"),
      ),
    ).toMatchObject({ ok: true });
    await rightsIndex().resetCalls();

    const command = {
      contract: "workspace.member-set-role@1" as const,
      commandId: "50000000-0000-8000-8000-000000000062",
      workspaceId,
      actor: { kind: "punk" as const, punkId: OWNER_PUNK_ID },
      payload: { targetPunkId: MEMBER_PUNK_ID, role: "member" as const },
    };
    expect(await workspace.execute(command)).toMatchObject({ ok: true });
    expect(await rightsIndex().calls()).toEqual([
      {
        phase: "prepare",
        input: {
          operationId: command.commandId,
          workspaceId,
          punkId: MEMBER_PUNK_ID,
          membership: { role: "member", revision: 2 },
        },
      },
      {
        phase: "commit",
        input: {
          operationId: command.commandId,
          workspaceId,
          punkId: MEMBER_PUNK_ID,
          membership: { role: "member", revision: 2 },
        },
      },
    ]);
  });
});
