import { env } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";

const authEnv = env as AuthEnv;

interface WorkspaceMembershipChange {
  operationId: string;
  workspaceId: string;
  punkId: string;
  membership: {
    role: "owner" | "moderator" | "member" | "guest";
    revision: number;
  } | null;
}

interface RightsIndexRpc {
  fetch(request: Request): Promise<Response> | Response;
  prepareWorkspaceMembershipChange(input: unknown): Promise<boolean>;
  commitWorkspaceMembershipChange(input: unknown): Promise<boolean>;
  abortWorkspaceMembershipChange(input: unknown): Promise<boolean>;
}

function rightsIndex(props: unknown): RightsIndexRpc {
  const factory =
    workerExports.AccountMergeRightsIndexService as unknown as (options: {
      props: unknown;
    }) => RightsIndexRpc;
  return factory({ props });
}

async function provisionPunk(punkId: string): Promise<void> {
  const now = new Date().toISOString();
  await expect(
    authEnv.PUNKS.getByName(punkId).provision({
      punkId,
      identity: {
        profile: {
          provider: "github",
          subject: `subject-${punkId}`,
          verifiedEmail: `${punkId}@example.test`,
          displayName: "Indexed Punk",
          avatarUrl: null,
          username: "indexed-punk",
        },
        subjectHash: "a".repeat(64),
        emailHash: "b".repeat(64),
      },
      now,
    }),
  ).resolves.toMatchObject({ ok: true });
}

function allowedRightsIndex(): RightsIndexRpc {
  return rightsIndex({
    role: "punks-account-merge-rights-index-writer",
    environment: "local",
  });
}

describe("AccountMergeRightsIndexService", () => {
  it("prepares, commits, and aborts one exact Punk membership change", async () => {
    const punkId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    await provisionPunk(punkId);
    const service = allowedRightsIndex();
    const create: WorkspaceMembershipChange = {
      operationId: crypto.randomUUID(),
      workspaceId,
      punkId,
      membership: { role: "owner", revision: 4 },
    };

    await expect(
      service.prepareWorkspaceMembershipChange(create),
    ).resolves.toBe(true);
    await expect(
      authEnv.PUNKS.getByName(punkId).accountMergeInventory(),
    ).resolves.toMatchObject({ complete: false, rights: [] });
    await expect(service.commitWorkspaceMembershipChange(create)).resolves.toBe(
      true,
    );
    await expect(service.commitWorkspaceMembershipChange(create)).resolves.toBe(
      true,
    );
    await expect(
      authEnv.PUNKS.getByName(punkId).accountMergeInventory(),
    ).resolves.toMatchObject({
      complete: true,
      rights: [{ workspaceId, role: "owner", revision: 4 }],
    });

    const aborted: WorkspaceMembershipChange = {
      operationId: crypto.randomUUID(),
      workspaceId,
      punkId,
      membership: null,
    };
    await expect(
      service.prepareWorkspaceMembershipChange(aborted),
    ).resolves.toBe(true);
    await expect(service.abortWorkspaceMembershipChange(aborted)).resolves.toBe(
      true,
    );
    await expect(service.abortWorkspaceMembershipChange(aborted)).resolves.toBe(
      true,
    );
    await expect(
      service.commitWorkspaceMembershipChange(aborted),
    ).resolves.toBe(false);
    await expect(
      authEnv.PUNKS.getByName(punkId).accountMergeInventory(),
    ).resolves.toMatchObject({
      complete: true,
      rights: [{ workspaceId, role: "owner", revision: 4 }],
    });
  });

  it("requires exact writer props and one exact bounded change", async () => {
    const valid: WorkspaceMembershipChange = {
      operationId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      punkId: crypto.randomUUID(),
      membership: { role: "member", revision: 1 },
    };
    for (const service of [
      rightsIndex(undefined),
      rightsIndex({
        role: "punks-account-merge-rights-index-writer",
        environment: "staging",
      }),
      rightsIndex({
        role: "punks-account-merge-rights-index-writer",
        environment: "local",
        expanded: true,
      }),
    ]) {
      await expect(
        service.prepareWorkspaceMembershipChange(valid),
      ).resolves.toBe(false);
      await expect(
        service.commitWorkspaceMembershipChange(valid),
      ).resolves.toBe(false);
      await expect(service.abortWorkspaceMembershipChange(valid)).resolves.toBe(
        false,
      );
    }

    const service = allowedRightsIndex();
    await expect(
      service.prepareWorkspaceMembershipChange({
        operationId: valid.operationId,
        workspaceId: valid.workspaceId,
        punkId: valid.punkId,
      }),
    ).resolves.toBe(false);
    await expect(
      service.prepareWorkspaceMembershipChange({ ...valid, expanded: true }),
    ).resolves.toBe(false);
    await expect(
      service.prepareWorkspaceMembershipChange({
        ...valid,
        membership: { role: "owner", revision: 2_147_483_648 },
      }),
    ).resolves.toBe(false);
    await expect(
      service.prepareWorkspaceMembershipChange({
        ...valid,
        punkId: [valid.punkId, crypto.randomUUID()],
      }),
    ).resolves.toBe(false);
    await expect(service.prepareWorkspaceMembershipChange(valid)).resolves.toBe(
      false,
    );
  });

  it("keeps the writer capability private over HTTP", async () => {
    const response = await allowedRightsIndex().fetch(
      new Request("https://auth.punks.test/private/rights-index"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
