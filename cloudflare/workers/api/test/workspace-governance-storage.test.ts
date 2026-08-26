import type {
  CreateWorkspaceCommand,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
} from "@punks/contracts";
import {
  env,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const operatorAuthorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

async function createWorkspace(): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: `governance-${crypto.randomUUID()}`,
      name: "Large Governance Workspace",
      visibility: "private",
    },
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

function punkId(index: number): string {
  return `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`;
}

describe("normalized Workspace governance storage", () => {
  it("migrates one legacy full roster snapshot atomically on restart", async () => {
    const workspaceId = await createWorkspace();
    const stub = env.WORKSPACES.getByName(workspaceId);
    const legacy = await stub.query({
      contract: "workspace.get@1",
      workspaceId,
    });
    if (!legacy.ok) throw new TypeError("Legacy Workspace fixture is absent");
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.transactionSync(() => {
        state.storage.sql.exec("DELETE FROM workspace_members");
        state.storage.sql.exec(
          "UPDATE workspace_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(legacy.state),
        );
      });
    });
    await evictDurableObject(stub);

    const restarted = env.WORKSPACES.getByName(workspaceId);
    await expect(
      restarted.queryGovernancePage({
        workspaceId,
        punkId: ownerPunkId,
        limit: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      workspace: { memberCount: 1 },
      members: [{ punkId: ownerPunkId, role: "owner" }],
    });
    const stored = await runInDurableObject(
      restarted,
      (_instance, state) =>
        state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM workspace_state WHERE singleton = 1",
          )
          .one().state_json,
    );
    expect(JSON.parse(stored)).not.toHaveProperty("members");
  });

  it("keeps 10,001 members out of the state snapshot and reads only bounded SQL pages", async () => {
    const workspaceId = await createWorkspace();
    const stub = env.WORKSPACES.getByName(workspaceId);

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 2; index <= 10_001; index += 1) {
          state.storage.sql.exec(
            "INSERT INTO workspace_members (punk_id, role) VALUES (?, 'member')",
            punkId(index),
          );
        }
        const row = state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM workspace_state WHERE singleton = 1",
          )
          .one();
        const metadata = JSON.parse(row.state_json) as Record<string, unknown>;
        metadata.memberCount = 10_001;
        state.storage.sql.exec(
          "UPDATE workspace_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(metadata),
        );
      });
    });

    const observed = await runInDurableObject(stub, (instance, state) => {
      const stored = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM workspace_state WHERE singleton = 1",
        )
        .one().state_json;
      const count = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM workspace_members",
        )
        .one().count;
      const afterThousand = instance.queryGovernancePage({
        workspaceId,
        punkId: ownerPunkId,
        limit: 100,
        afterPunkId: punkId(1_000),
        authorityCursor: 1,
      });
      const afterTenThousand = instance.queryGovernancePage({
        workspaceId,
        punkId: ownerPunkId,
        limit: 100,
        afterPunkId: punkId(10_000),
        authorityCursor: 1,
      });
      return { stored, count, afterThousand, afterTenThousand };
    });

    expect(JSON.parse(observed.stored)).toMatchObject({ memberCount: 10_001 });
    expect(JSON.parse(observed.stored)).not.toHaveProperty("members");
    expect(observed.count).toBe(10_001);
    expect(observed.afterThousand.ok).toBe(true);
    if (!observed.afterThousand.ok) {
      throw new TypeError("The 1,000-member page was unavailable");
    }
    expect(observed.afterThousand.workspace.memberCount).toBe(10_001);
    expect(observed.afterThousand.members).toHaveLength(100);
    expect(observed.afterThousand.nextPositionPunkId).toBe(punkId(1_100));

    expect(observed.afterTenThousand.ok).toBe(true);
    if (!observed.afterTenThousand.ok) {
      throw new TypeError("The 10,000-member page was unavailable");
    }
    expect(observed.afterTenThousand.workspace.memberCount).toBe(10_001);
    expect(observed.afterTenThousand.members).toEqual([
      { punkId: punkId(10_001), role: "member" },
    ]);
    expect(observed.afterTenThousand.nextPositionPunkId).toBeNull();

    const mutation: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: punkId(10_001),
        role: "guest",
        expectedRevision: 1,
      },
    };
    const changed = await stub.executeAuthorized(mutation, {
      sessionId: "11111111-1111-8111-8111-111111111111",
      punkId: ownerPunkId,
    });
    expect(changed).toMatchObject({ ok: true, replayed: false });
    await expect(
      stub.queryGovernancePage({
        workspaceId,
        punkId: ownerPunkId,
        limit: 1,
        afterPunkId: punkId(10_000),
        authorityCursor: 2,
      }),
    ).resolves.toMatchObject({
      ok: true,
      members: [{ punkId: punkId(10_001), role: "guest" }],
      workspace: { revision: 2, memberCount: 10_001 },
    });

    const rename: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: `renamed-${crypto.randomUUID()}` },
    };
    const renamed = await stub.execute(rename);
    expect(renamed).toMatchObject({ ok: true, replayed: false });
    if (!renamed.ok) throw new TypeError("Large Workspace rename failed");
    expect(renamed.value.state).toMatchObject({
      slug: rename.payload.slug,
      memberCount: 10_001,
      revision: 3,
    });
  });
});
