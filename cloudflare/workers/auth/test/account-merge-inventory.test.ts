import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { AuthEnv } from "../src/env";

const authEnv = env as AuthEnv;
const LEGACY_SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

function replaceBinding(
  target: object,
  key: PropertyKey,
  replacement: unknown,
): () => void {
  const previous = Reflect.get(target, key);
  if (!Reflect.set(target, key, replacement)) {
    throw new Error(`Workerd refused to replace binding ${String(key)}`);
  }
  return () => {
    if (!Reflect.set(target, key, previous)) {
      throw new Error(`Workerd refused to restore binding ${String(key)}`);
    }
  };
}

function digest(character: string): string {
  return character.repeat(64);
}

async function provisionPunk(punkId: string, now: string) {
  const punk = authEnv.PUNKS.getByName(punkId);
  await expect(
    punk.provision({
      punkId,
      identity: {
        profile: {
          provider: "google",
          subject: `subject-${punkId}`,
          verifiedEmail: `${punkId}@example.test`,
          displayName: "Inventory Punk",
          avatarUrl: null,
          username: "inventory-punk",
        },
        subjectHash: digest("a"),
        emailHash: digest("b"),
      },
      now,
    }),
  ).resolves.toMatchObject({ ok: true, replayed: false });
  return punk;
}

describe("Punk account-merge inventory coverage", () => {
  it("locks both account roles and applies the survivor plus inert alias idempotently", async () => {
    const survivorPunkId = crypto.randomUUID();
    const absorbedPunkId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    const planId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const survivor = await provisionPunk(survivorPunkId, now);
    const absorbed = authEnv.PUNKS.getByName(absorbedPunkId);
    await expect(
      absorbed.provision({
        punkId: absorbedPunkId,
        identity: {
          profile: {
            provider: "github",
            subject: "absorbed-subject",
            verifiedEmail: "absorbed@example.test",
            displayName: "Absorbed Punk",
            avatarUrl: null,
            username: "absorbed-punk",
          },
          subjectHash: digest("c"),
          emailHash: digest("d"),
        },
        now,
      }),
    ).resolves.toMatchObject({ ok: true, replayed: false });
    const absorbedBeforeFence = await absorbed.readForResolution();
    if (absorbedBeforeFence === null) {
      throw new TypeError("Absorbed Punk is missing");
    }

    const coordinate = {
      intentId,
      planId,
      receiptId,
      survivorPunkId,
      absorbedPunkId,
    };
    await expect(
      survivor.prepareAccountMerge({
        ...coordinate,
        accountRole: "survivor",
        expectedRevision: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      absorbed.prepareAccountMerge({
        ...coordinate,
        accountRole: "absorbed",
        expectedRevision: 1,
      }),
    ).resolves.toBe(true);
    await expect(survivor.query()).resolves.toMatchObject({ ok: true });
    await expect(absorbed.query()).resolves.toEqual({
      ok: false,
      code: "inactive",
    });
    await expect(absorbed.readForResolution()).resolves.toBeNull();
    await expect(
      survivor.recordAccountMergeSession({
        sessionId: "10000000-0000-8000-8000-000000000061",
        punkId: survivorPunkId,
        clientKind: "desktop",
        authenticatedAt: now,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe(false);

    await expect(
      survivor.applyAccountMergeWorkspaceRight({
        ...coordinate,
        workspaceId: "20000000-0000-8000-8000-000000000061",
        membership: { role: "owner", revision: 8 },
      }),
    ).resolves.toBe(true);
    expect(absorbedBeforeFence.identities).toHaveLength(1);
    await expect(
      survivor.applyAccountMergeAsSurvivor({
        ...coordinate,
        expectedRevision: 1,
        absorbedIdentities: absorbedBeforeFence.identities,
        appliedAt: "2032-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      absorbed.applyAccountMergeAsAbsorbed({
        ...coordinate,
        expectedRevision: 1,
        appliedAt: "2032-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      absorbed.applyAccountMergeAsAbsorbed({
        ...coordinate,
        expectedRevision: 1,
        appliedAt: "2032-01-01T00:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.recordAccountMergeReceipt({
        receiptId,
        intentId,
        planId,
        planDigest: digest("e"),
        commitCommandId: crypto.randomUUID(),
        survivorPunkId,
        absorbedPunkId,
        accountRevisions: { survivor: 1, absorbed: 1 },
        recoveryDescriptor: "{}",
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(survivor.query()).resolves.toMatchObject({
      ok: true,
      state: {
        status: "active",
        revision: 2,
        identities: expect.arrayContaining([
          expect.objectContaining({ provider: "google" }),
          expect.objectContaining({ provider: "github" }),
        ]),
      },
    });
    await expect(absorbed.query()).resolves.toEqual({
      ok: false,
      code: "inactive",
    });
    await expect(absorbed.readForResolution()).resolves.toMatchObject({
      id: absorbedPunkId,
      status: "merged",
      mergedInto: survivorPunkId,
      revision: 2,
    });
    await expect(survivor.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      rights: [
        {
          workspaceId: "20000000-0000-8000-8000-000000000061",
          role: "owner",
          revision: 8,
        },
      ],
    });
  });

  it("is complete immediately for a Punk provisioned with the inventory index", async () => {
    const punk = await provisionPunk(
      crypto.randomUUID(),
      new Date().toISOString(),
    );

    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      rights: [],
      sessions: [],
      handoffs: [],
    });
  });

  it("keeps a legacy Punk incomplete for one persistent 30-day Session window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const migrationStartedAt = new Date("2032-01-01T00:00:00.000Z");
      vi.setSystemTime(migrationStartedAt);
      const punkId = crypto.randomUUID();
      const punk = await provisionPunk(
        punkId,
        migrationStartedAt.toISOString(),
      );
      await runInDurableObject(punk, (_instance, state) => {
        state.storage.sql.exec(
          "DELETE FROM account_merge_session_inventory_coverage WHERE singleton = 1",
        );
      });

      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: false,
      });
      await evictDurableObject(punk);

      vi.setSystemTime(
        new Date(migrationStartedAt.getTime() + LEGACY_SESSION_WINDOW_MS - 1),
      );
      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: false,
      });
      await evictDurableObject(punk);

      vi.setSystemTime(
        new Date(migrationStartedAt.getTime() + LEGACY_SESSION_WINDOW_MS),
      );
      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps legacy rights coverage incomplete until an explicit backfill", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const migrationStartedAt = new Date("2032-01-01T00:00:00.000Z");
      vi.setSystemTime(migrationStartedAt);
      const punkId = crypto.randomUUID();
      const punk = await provisionPunk(
        punkId,
        migrationStartedAt.toISOString(),
      );
      await runInDurableObject(punk, (_instance, state) => {
        state.storage.sql.exec(
          "DELETE FROM account_merge_rights_inventory_coverage WHERE singleton = 1",
        );
      });

      const workspaceId = crypto.randomUUID();
      const operation = {
        operationId: crypto.randomUUID(),
        workspaceId,
        punkId,
      };
      await expect(
        punk.prepareAccountMergeRightsChange(operation),
      ).resolves.toBe(true);
      await expect(
        punk.commitAccountMergeRightsChange({
          ...operation,
          membership: { role: "guest", revision: 1 },
        }),
      ).resolves.toBe(true);

      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: false,
        rights: [{ workspaceId, role: "guest", revision: 1 }],
      });
      await evictDurableObject(punk);
      vi.setSystemTime(new Date("2042-01-01T00:00:00.000Z"));
      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: false,
        rights: [{ workspaceId, role: "guest", revision: 1 }],
      });

      await runInDurableObject(punk, (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO account_merge_rights_inventory_coverage (singleton) VALUES (1)",
        );
      });
      await expect(punk.accountMergeInventory()).resolves.toMatchObject({
        complete: true,
        rights: [{ workspaceId, role: "guest", revision: 1 }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies one prepared Workspace membership change idempotently", async () => {
    const punkId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date().toISOString());
    const coordinate = { operationId, workspaceId, punkId };

    await expect(
      punk.prepareAccountMergeRightsChange(coordinate),
    ).resolves.toBe(true);
    await expect(
      punk.prepareAccountMergeRightsChange(coordinate),
    ).resolves.toBe(true);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: false,
      rights: [],
    });

    const commit = {
      ...coordinate,
      membership: { role: "owner" as const, revision: 7 },
    };
    await expect(punk.commitAccountMergeRightsChange(commit)).resolves.toBe(
      true,
    );
    await expect(punk.commitAccountMergeRightsChange(commit)).resolves.toBe(
      true,
    );
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      rights: [{ workspaceId, role: "owner", revision: 7 }],
    });
  });

  it("serializes one pending change per Workspace and aborts it idempotently", async () => {
    const punkId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date().toISOString());
    const first = {
      operationId: crypto.randomUUID(),
      workspaceId,
      punkId,
    };
    const second = { ...first, operationId: crypto.randomUUID() };

    await expect(punk.prepareAccountMergeRightsChange(first)).resolves.toBe(
      true,
    );
    await expect(punk.prepareAccountMergeRightsChange(second)).resolves.toBe(
      false,
    );
    await expect(punk.abortAccountMergeRightsChange(first)).resolves.toBe(true);
    await expect(punk.abortAccountMergeRightsChange(first)).resolves.toBe(true);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...first,
        membership: { role: "member", revision: 2 },
      }),
    ).resolves.toBe(false);
    await expect(punk.prepareAccountMergeRightsChange(second)).resolves.toBe(
      true,
    );
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: false,
    });
  });

  it("updates and removes an indexed Workspace membership", async () => {
    const punkId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date().toISOString());
    const create = {
      operationId: crypto.randomUUID(),
      workspaceId,
      punkId,
    };
    await punk.prepareAccountMergeRightsChange(create);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...create,
        membership: { role: "member", revision: 2 },
      }),
    ).resolves.toBe(true);

    const update = { ...create, operationId: crypto.randomUUID() };
    await punk.prepareAccountMergeRightsChange(update);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...update,
        membership: { role: "moderator", revision: 3 },
      }),
    ).resolves.toBe(true);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      rights: [{ workspaceId, role: "moderator", revision: 3 }],
    });

    const remove = { ...create, operationId: crypto.randomUUID() };
    await punk.prepareAccountMergeRightsChange(remove);
    await expect(
      punk.commitAccountMergeRightsChange({ ...remove, membership: null }),
    ).resolves.toBe(true);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      rights: [],
    });
  });

  it("rejects malformed, expanded, stale, and out-of-bound rights changes", async () => {
    const punkId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date().toISOString());
    const coordinate = {
      operationId: crypto.randomUUID(),
      workspaceId,
      punkId,
    };
    await expect(
      punk.prepareAccountMergeRightsChange({
        ...coordinate,
        expanded: true,
      } as never),
    ).resolves.toBe(false);
    await expect(
      punk.prepareAccountMergeRightsChange({
        ...coordinate,
        operationId: "not-an-operation",
      }),
    ).resolves.toBe(false);
    await expect(
      punk.prepareAccountMergeRightsChange({
        ...coordinate,
        punkId: crypto.randomUUID(),
      }),
    ).resolves.toBe(false);

    await expect(
      punk.prepareAccountMergeRightsChange(coordinate),
    ).resolves.toBe(true);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...coordinate,
        membership: { role: "administrator", revision: 1 },
      } as never),
    ).resolves.toBe(false);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...coordinate,
        membership: { role: "owner", revision: 2_147_483_648 },
      }),
    ).resolves.toBe(false);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...coordinate,
        membership: { role: "owner", revision: 1 },
        expanded: true,
      } as never),
    ).resolves.toBe(false);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...coordinate,
        membership: { role: "owner", revision: 3 },
      }),
    ).resolves.toBe(true);

    const stale = { ...coordinate, operationId: crypto.randomUUID() };
    await punk.prepareAccountMergeRightsChange(stale);
    await expect(
      punk.commitAccountMergeRightsChange({
        ...stale,
        membership: { role: "owner", revision: 2 },
      }),
    ).resolves.toBe(false);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: false,
      rights: [{ workspaceId, role: "owner", revision: 3 }],
    });
  });

  it("returns a bounded rights inventory and fails closed on overflow", async () => {
    const punk = await provisionPunk(
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    await runInDurableObject(punk, (_instance, state) => {
      for (let index = 0; index < 257; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO account_merge_rights_inventory
            (workspace_id, role, revision) VALUES (?, 'member', 1)`,
          `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        );
      }
    });

    const inventory = await punk.accountMergeInventory();
    expect(inventory.complete).toBe(false);
    expect(inventory.rights).toHaveLength(256);
  });

  it("bounds concurrent pending membership operations", async () => {
    const punkId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date().toISOString());
    for (let index = 0; index < 64; index += 1) {
      await expect(
        punk.prepareAccountMergeRightsChange({
          operationId: crypto.randomUUID(),
          workspaceId: `10000000-0000-4000-8000-${index
            .toString()
            .padStart(12, "0")}`,
          punkId,
        }),
      ).resolves.toBe(true);
    }
    await expect(
      punk.prepareAccountMergeRightsChange({
        operationId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        punkId,
      }),
    ).resolves.toBe(false);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: false,
    });
  });
});

describe("account-bound handoff inventory", () => {
  it("keeps a successful OAuth begin prepared until its alarm", async () => {
    const now = Date.now();
    const punkId = crypto.randomUUID();
    const punk = await provisionPunk(punkId, new Date(now).toISOString());
    const expiresAt = new Date(now + 5 * 60_000).toISOString();
    const transactionId = crypto.randomUUID();
    const transaction = authEnv.AUTH_TRANSACTIONS.getByName(transactionId);
    await expect(
      transaction.create({
        provider: "google",
        intent: "reauthenticate",
        returnTo: "/settings/identity",
        browserBindingHash: digest("c"),
        codeVerifier: "oauth-code-verifier",
        currentPunkId: punkId,
        currentSessionId: null,
        createdAt: new Date(now).toISOString(),
        expiresAt,
      }),
    ).resolves.toBe(true);
    await expect(transaction.begin(digest("c"))).resolves.toMatchObject({
      ok: true,
    });
    await expect(transaction.begin(digest("c"))).resolves.toEqual({
      ok: false,
      code: "consumed",
    });

    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      handoffs: expect.arrayContaining([
        expect.objectContaining({
          handoffId: transactionId,
          kind: "oauth-transaction",
          state: "prepared",
        }),
      ]),
    });

    await expect(runDurableObjectAlarm(transaction)).resolves.toBe(true);
    await expect(punk.accountMergeInventory()).resolves.toMatchObject({
      complete: true,
      handoffs: [],
    });
  });

  it("deletes the OAuth source when handoff indexing throws", async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 5 * 60_000).toISOString();
    const punkId = crypto.randomUUID();
    const failingPunks = {
      getByName: () => ({
        recordAccountMergeHandoff: async () => {
          throw new Error("ambiguous handoff index failure");
        },
      }),
    };

    const transaction = authEnv.AUTH_TRANSACTIONS.getByName(
      crypto.randomUUID(),
    );
    let restoreTransactionBinding: (() => void) | undefined;
    await runInDurableObject(transaction, (instance) => {
      restoreTransactionBinding = replaceBinding(
        Reflect.get(instance, "env") as object,
        "PUNKS",
        failingPunks,
      );
    });
    try {
      await expect(
        transaction.create({
          provider: "google",
          intent: "reauthenticate",
          returnTo: "/settings/identity",
          browserBindingHash: digest("e"),
          codeVerifier: "oauth-code-verifier",
          currentPunkId: punkId,
          currentSessionId: null,
          createdAt: new Date(now).toISOString(),
          expiresAt,
        }),
      ).resolves.toBe(false);
    } finally {
      restoreTransactionBinding?.();
    }
    await expect(transaction.begin(digest("e"))).resolves.toEqual({
      ok: false,
      code: "missing",
    });
  });
});
