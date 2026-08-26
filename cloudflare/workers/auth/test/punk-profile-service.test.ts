import { exports as workerExports } from "cloudflare:workers";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";

const authEnv = env as AuthEnv;

async function provision(punkId: string, displayName: string): Promise<void> {
  const result = await authEnv.PUNKS.getByName(punkId).provision({
    punkId,
    identity: {
      profile: {
        provider: "github",
        subject: `subject-${punkId}`,
        verifiedEmail: `${punkId}@example.com`,
        displayName,
        avatarUrl: null,
        username: displayName.toLowerCase(),
      },
      subjectHash: "a".repeat(64),
      emailHash: "b".repeat(64),
    },
    now: "2026-08-25T12:00:00.000Z",
  });
  expect(result.ok).toBe(true);
}

describe("PunkSessionService profile authority", () => {
  it("reads and atomically updates only the active Punk profile", async () => {
    const punkId = "a1000000-0000-8000-8000-000000000001";
    await provision(punkId, "Initial Punk");

    await expect(
      workerExports.PunkSessionService.getPunkProfile(punkId),
    ).resolves.toMatchObject({
      id: punkId,
      displayName: "Initial Punk",
      revision: 1,
      identities: [expect.objectContaining({ provider: "github" })],
    });

    const command = {
      contract: "punk.update@1",
      commandId: "a2000000-0000-4000-8000-000000000002",
      expectedRevision: 1,
      displayName: "  Me\u0301lanie  ",
      avatarUrl: "https://images.example/avatar.png",
    };
    await expect(
      workerExports.PunkSessionService.updatePunkProfile(punkId, command),
    ).resolves.toMatchObject({
      ok: true,
      replayed: false,
      state: {
        id: punkId,
        displayName: "Mélanie",
        avatarUrl: "https://images.example/avatar.png",
        revision: 2,
        updatedAt: expect.any(String),
      },
    });
    await expect(
      workerExports.PunkSessionService.updatePunkProfile(punkId, command),
    ).resolves.toMatchObject({
      ok: true,
      replayed: true,
      state: { displayName: "Mélanie", revision: 2 },
    });
  });

  it("distinguishes revision and command-identity conflicts without mutation", async () => {
    const punkId = "b1000000-0000-8000-8000-000000000001";
    await provision(punkId, "Conflict Punk");
    const command = {
      contract: "punk.update@1",
      commandId: "b2000000-0000-4000-8000-000000000002",
      expectedRevision: 1,
      displayName: "First update",
      avatarUrl: null,
    };
    await expect(
      workerExports.PunkSessionService.updatePunkProfile(punkId, command),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      workerExports.PunkSessionService.updatePunkProfile(punkId, {
        ...command,
        displayName: "Divergent replay",
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await expect(
      workerExports.PunkSessionService.updatePunkProfile(punkId, {
        ...command,
        commandId: "b3000000-0000-4000-8000-000000000003",
        displayName: "Stale revision",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "revision_conflict",
      currentRevision: 2,
    });
    await expect(
      workerExports.PunkSessionService.getPunkProfile(punkId),
    ).resolves.toMatchObject({
      displayName: "First update",
      revision: 2,
    });
  });

  it("resolves a merged alias only to its active survivor", async () => {
    const aliasId = "c1000000-0000-8000-8000-000000000001";
    const survivorId = "c2000000-0000-8000-8000-000000000002";
    await provision(aliasId, "Historical Punk");
    await provision(survivorId, "Surviving Punk");
    const alias = authEnv.PUNKS.getByName(aliasId);
    await runInDurableObject(alias, async (_instance, state) => {
      const row = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM punk_state WHERE singleton = 1",
        )
        .one();
      state.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify({
          ...JSON.parse(row.state_json),
          status: "merged",
          mergedInto: survivorId,
          revision: 2,
          updatedAt: "2026-08-25T12:01:00.000Z",
        }),
      );
    });
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.recordAccountMergeReceipt({
        receiptId: "c3000000-0000-8000-8000-000000000003",
        intentId: "c4000000-0000-8000-8000-000000000004",
        planId: "c5000000-0000-8000-8000-000000000005",
        planDigest: "c".repeat(64),
        commitCommandId: "c6000000-0000-8000-8000-000000000006",
        survivorPunkId: survivorId,
        absorbedPunkId: aliasId,
        accountRevisions: { survivor: 1, absorbed: 1 },
        recoveryDescriptor: "{}",
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      workerExports.PunkSessionService.resolvePunkSummary(aliasId),
    ).resolves.toEqual({
      id: survivorId,
      displayName: "Surviving Punk",
      avatarUrl: null,
      revision: 1,
      updatedAt: "2026-08-25T12:00:00.000Z",
    });
  });
});
