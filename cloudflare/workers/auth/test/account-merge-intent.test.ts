import type {
  AccountMergeCommitResponse,
  AccountMergeFreshProof,
  AccountMergePlanResponse,
  CommitAccountMergeCommand,
  CreateAccountMergePlanCommand,
} from "@punks/contracts";
import {
  canonicalJson,
  deriveOpaqueUuid,
  type AccountMergePunkSnapshot,
} from "@punks/core";
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { AuthEnv } from "../src/env";

const authEnv = env as AuthEnv;

function digest(character: string): string {
  return character.repeat(64);
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function opaqueUuid(): string {
  const value = crypto.randomUUID();
  return `${value.slice(0, 14)}8${value.slice(15)}`;
}

function fixture(now = Date.now()) {
  const intentId = crypto.randomUUID();
  const survivorPunkId = crypto.randomUUID();
  const absorbedPunkId = crypto.randomUUID();
  const survivorSessionId = opaqueUuid();
  const absorbedSessionId = opaqueUuid();
  const survivorProof: AccountMergeFreshProof = {
    contract: "account-merge.fresh-proof@1",
    proofId: opaqueUuid(),
    intentId,
    accountRole: "survivor",
    punkId: survivorPunkId,
    accountRevision: 1,
    holderBindingHash: digest("a"),
    authenticationMethod: "github",
    providerSubjectBindingHash: digest("b"),
    authenticatedAt: timestamp(now - 60_000),
    expiresAt: timestamp(now + 240_000),
    validForSeconds: 300,
  };
  const absorbedProof: AccountMergeFreshProof = {
    contract: "account-merge.fresh-proof@1",
    proofId: opaqueUuid(),
    intentId,
    accountRole: "absorbed",
    punkId: absorbedPunkId,
    accountRevision: 1,
    holderBindingHash: digest("a"),
    authenticationMethod: "google",
    providerSubjectBindingHash: digest("c"),
    authenticatedAt: timestamp(now - 120_000),
    expiresAt: timestamp(now + 180_000),
    validForSeconds: 300,
  };
  const command = (
    commandId: string = crypto.randomUUID(),
  ): CreateAccountMergePlanCommand => ({
    contract: "account-merge.plan-create@1",
    commandId,
    intentId,
    survivorPunkId,
    absorbedPunkId,
    holderBindingHash: digest("a"),
    proofs: [
      survivorProof,
      absorbedProof,
    ] as CreateAccountMergePlanCommand["proofs"],
  });
  const punks: AccountMergePunkSnapshot[] = [
    {
      punkId: survivorPunkId,
      status: "active",
      revision: 1,
      claims: [],
      rights: [
        {
          rightBindingHash: digest("d"),
          kind: "workspace-membership",
          authorityBindingHash: digest("e"),
          punkId: survivorPunkId,
          role: "member",
          revision: 2,
        },
      ],
      sessions: [],
      handoffs: [],
    },
    {
      punkId: absorbedPunkId,
      status: "active",
      revision: 1,
      claims: [],
      rights: [
        {
          rightBindingHash: digest("f"),
          kind: "workspace-membership",
          authorityBindingHash: digest("e"),
          punkId: absorbedPunkId,
          role: "moderator",
          revision: 7,
        },
      ],
      sessions: [],
      handoffs: [],
    },
  ];
  return {
    intentId,
    survivorProof,
    absorbedProof,
    survivorSessionId,
    absorbedSessionId,
    command,
    punks,
  };
}

async function seedAuthorities(value: ReturnType<typeof fixture>) {
  for (const [proof, sessionId] of [
    [value.survivorProof, value.survivorSessionId],
    [value.absorbedProof, value.absorbedSessionId],
  ] as const) {
    await authEnv.PUNKS.getByName(proof.punkId).provision({
      punkId: proof.punkId,
      identity: {
        profile: {
          provider: proof.authenticationMethod as "github" | "google",
          subject: `${proof.accountRole}-subject`,
          verifiedEmail: `${proof.accountRole}@example.test`,
          displayName: proof.accountRole,
          avatarUrl: null,
          username: proof.accountRole,
        },
        subjectHash: proof.providerSubjectBindingHash,
        emailHash: digest(proof.accountRole === "survivor" ? "7" : "8"),
      },
      now: proof.authenticatedAt,
    });
    const session = authEnv.SESSIONS.getByName(sessionId);
    await session.create({
      sessionId,
      punkId: proof.punkId,
      authenticatedAt: timestamp(Date.now() - 3_600_000),
      expiresAt: timestamp(Date.now() + 86_400_000),
      recentReauthUntil: null,
    });
    await session.markReauthenticated({
      sessionId,
      punkId: proof.punkId,
      until: proof.expiresAt,
      authenticationMethod: proof.authenticationMethod as "github" | "google",
      providerSubjectBindingHash: proof.providerSubjectBindingHash,
    });
    await session.claimAccountMergeProof({
      intentId: proof.intentId,
      accountRole: proof.accountRole,
    });
  }
}

function sourceSession(
  value: ReturnType<typeof fixture>,
  proof: AccountMergeFreshProof,
) {
  return {
    sourceSessionId:
      proof.accountRole === "survivor"
        ? value.survivorSessionId
        : value.absorbedSessionId,
  };
}

function stub(intentId: string) {
  return authEnv.ACCOUNT_MERGE_INTENTS.getByName(intentId);
}

function failure(correlationId: string): AccountMergePlanResponse {
  return {
    contract: "account-merge.plan-response@1",
    ok: false,
    code: "plan_unavailable",
    correlationId,
  };
}

function planner(props: unknown) {
  type PlannerRpc = {
    recordAccountMergeFreshProof(
      input: unknown,
    ): Promise<AccountMergeFreshProof | null>;
    revokeAccountMergeFreshProof(input: unknown): Promise<boolean>;
    prepareAccountMergePlan(input: unknown): Promise<AccountMergePlanResponse>;
    readAccountMergePlan(intentId: string): Promise<unknown>;
  };
  const factory = workerExports.AccountMergePlanningService as (options: {
    props: unknown;
  }) => PlannerRpc;
  return factory({ props });
}

describe("AccountMergeIntentDO", () => {
  it("atomically consumes both proofs and persists one immutable Plan", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await expect(
      authority.recordFreshProof(
        value.survivorProof,
        sourceSession(value, value.survivorProof),
      ),
    ).resolves.toBe(true);
    await expect(
      authority.recordFreshProof(
        value.absorbedProof,
        sourceSession(value, value.absorbedProof),
      ),
    ).resolves.toBe(true);

    const command = value.command();
    const response = await authority.preparePlan({
      command,
      correlationId: "first",
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new TypeError("Expected the Plan to be prepared");
    expect(response.plan.rights).toEqual([]);
    await expect(authority.readPlan(response.plan.planId)).resolves.toEqual(
      response.plan,
    );
    await expect(authority.readPlan()).resolves.toEqual(response.plan);
    await expect(
      authority.preparePlan({
        command,
        correlationId: "replay",
      }),
    ).resolves.toEqual(failure("replay"));
  });

  it("rolls a committed receipt forward until the absorbed Punk is an inert alias", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const absorbedBeforeMerge = await authEnv.PUNKS.getByName(
      value.absorbedProof.punkId,
    ).readForResolution();
    if (absorbedBeforeMerge === null) {
      throw new TypeError("Absorbed Punk fixture is missing");
    }
    const workspaceId = crypto.randomUUID();
    for (const [punkId, role, revision] of [
      [value.survivorProof.punkId, "member", 2],
      [value.absorbedProof.punkId, "moderator", 7],
    ] as const) {
      const operationId = crypto.randomUUID();
      const punk = authEnv.PUNKS.getByName(punkId);
      await expect(
        punk.prepareAccountMergeRightsChange({
          operationId,
          workspaceId,
          punkId,
        }),
      ).resolves.toBe(true);
      await expect(
        punk.commitAccountMergeRightsChange({
          operationId,
          workspaceId,
          punkId,
          membership: { role, revision },
        }),
      ).resolves.toBe(true);
    }
    const reauthorizationId = crypto.randomUUID();
    const reauthorizationExpiresAt = timestamp(Date.now() + 120_000);
    await expect(
      authEnv.DESKTOP_REAUTH_GRANTS.getByName(reauthorizationId).create({
        authorizationId: reauthorizationId,
        sessionId: value.absorbedSessionId,
        punkId: value.absorbedProof.punkId,
        targetMethod: "link_github",
        handoffId: crypto.randomUUID(),
        expiresAt: reauthorizationExpiresAt,
      }),
    ).resolves.toBe(true);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    const planned = await authority.preparePlan({
      command: value.command(),
      correlationId: "commit-plan",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new TypeError("Expected a merge Plan");
    const command: CommitAccountMergeCommand = {
      contract: "account-merge.commit@1",
      commandId: crypto.randomUUID(),
      intentId: planned.plan.intentId,
      planId: planned.plan.planId,
      planDigest: planned.plan.planDigest,
      survivorPunkId: planned.plan.survivorPunkId,
      absorbedPunkId: planned.plan.absorbedPunkId,
      accountRevisions: planned.plan.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };

    let committed = (await authority.commitPlan({
      command,
      callerSessionId: value.survivorSessionId,
      correlationId: "commit",
    })) as AccountMergeCommitResponse;
    expect(committed).toMatchObject({
      ok: true,
      state: {
        status: "applying",
        receipt: { contract: "account-merge.receipt@1" },
      },
    });
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (committed.ok && committed.state.status === "completed") break;
      expect(await runDurableObjectAlarm(authority)).toBe(true);
      committed = (await authority.readMergeState({
        planId: planned.plan.planId,
        callerPunkId: value.survivorProof.punkId,
      })) as AccountMergeCommitResponse;
    }

    expect(committed).toMatchObject({
      ok: true,
      state: {
        status: "completed",
        survivorPunkId: value.survivorProof.punkId,
        absorbedPunkId: value.absorbedProof.punkId,
        receipt: {
          contract: "account-merge.receipt@1",
          planId: planned.plan.planId,
        },
      },
    });
    await expect(
      authEnv.PUNKS.getByName(value.absorbedProof.punkId).readForResolution(),
    ).resolves.toMatchObject({
      status: "merged",
      mergedInto: value.survivorProof.punkId,
    });
    await expect(
      authEnv.PUNKS.getByName(value.survivorProof.punkId).query(),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        identities: expect.arrayContaining([
          expect.objectContaining({ provider: "github" }),
          expect.objectContaining({ provider: "google" }),
        ]),
      },
    });
    await expect(
      authEnv.PUNKS.getByName(
        value.survivorProof.punkId,
      ).accountMergeInventory(),
    ).resolves.toMatchObject({
      rights: [{ workspaceId, role: "moderator", revision: 8 }],
    });
    await expect(
      authEnv.PUNKS.getByName(
        value.absorbedProof.punkId,
      ).accountMergeInventory(),
    ).resolves.toMatchObject({ rights: [] });
    await expect(
      authEnv.SESSIONS.getByName(value.absorbedSessionId).get(),
    ).resolves.toBeNull();
    await expect(
      authEnv.DESKTOP_REAUTH_GRANTS.getByName(
        reauthorizationId,
      ).readForAccountMerge(),
    ).resolves.toBeNull();
    await expect(
      authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "replay",
      }),
    ).resolves.toMatchObject({ ok: true, replayed: true });

    const absorbed = authEnv.PUNKS.getByName(value.absorbedProof.punkId);
    await runInDurableObject(absorbed, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(absorbedBeforeMerge),
      );
    });
    await expect(absorbed.query()).resolves.toEqual({
      ok: false,
      code: "inactive",
    });
    await expect(absorbed.readForResolution()).resolves.toMatchObject({
      status: "merged",
      mergedInto: value.survivorProof.punkId,
    });
  });

  it("rolls forward a receipt-backed retry after the Plan expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2042-01-01T00:00:00.000Z"));
      const value = fixture();
      await seedAuthorities(value);
      const authority = stub(value.intentId);
      await authority.recordFreshProof(
        value.survivorProof,
        sourceSession(value, value.survivorProof),
      );
      await authority.recordFreshProof(
        value.absorbedProof,
        sourceSession(value, value.absorbedProof),
      );
      const planned = await authority.preparePlan({
        command: value.command(),
        correlationId: "expiring-plan",
      });
      if (!planned.ok) throw new TypeError("Expected a merge Plan");
      const command: CommitAccountMergeCommand = {
        contract: "account-merge.commit@1",
        commandId: crypto.randomUUID(),
        intentId: planned.plan.intentId,
        planId: planned.plan.planId,
        planDigest: planned.plan.planDigest,
        survivorPunkId: planned.plan.survivorPunkId,
        absorbedPunkId: planned.plan.absorbedPunkId,
        accountRevisions: planned.plan.accountRevisions,
        confirmation: "merge_accounts_irreversibly",
      };

      const committed = await authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "initial-commit",
      });
      expect(committed).toMatchObject({
        ok: true,
        state: {
          status: "applying",
          receipt: { planId: planned.plan.planId },
        },
      });

      vi.setSystemTime(new Date(Date.parse(planned.plan.expiresAt) + 1));
      let retried = (await authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "expired-retry",
      })) as AccountMergeCommitResponse;
      expect(retried).toMatchObject({
        ok: true,
        replayed: true,
        state: {
          receipt: { planId: planned.plan.planId },
          lastFailure: null,
        },
      });

      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (retried.ok && retried.state.status === "completed") break;
        expect(await runDurableObjectAlarm(authority)).toBe(true);
        retried = (await authority.readMergeState({
          planId: planned.plan.planId,
          callerPunkId: value.survivorProof.punkId,
        })) as AccountMergeCommitResponse;
      }
      expect(retried).toMatchObject({
        ok: true,
        state: {
          status: "completed",
          receipt: { planId: planned.plan.planId },
          lastFailure: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconstructs missing authority fences from the terminal receipt", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    const planned = await authority.preparePlan({
      command: value.command(),
      correlationId: "restored-plan",
    });
    if (!planned.ok) throw new TypeError("Expected a merge Plan");
    const command: CommitAccountMergeCommand = {
      contract: "account-merge.commit@1",
      commandId: crypto.randomUUID(),
      intentId: planned.plan.intentId,
      planId: planned.plan.planId,
      planDigest: planned.plan.planDigest,
      survivorPunkId: planned.plan.survivorPunkId,
      absorbedPunkId: planned.plan.absorbedPunkId,
      accountRevisions: planned.plan.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };
    const receiptId = await deriveOpaqueUuid(
      "punks.account-merge-receipt.v1",
      canonicalJson({
        planId: planned.plan.planId,
        planDigest: planned.plan.planDigest,
      }),
    );
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.recordAccountMergeReceipt({
        receiptId,
        intentId: planned.plan.intentId,
        planId: planned.plan.planId,
        planDigest: planned.plan.planDigest,
        commitCommandId: command.commandId,
        survivorPunkId: planned.plan.survivorPunkId,
        absorbedPunkId: planned.plan.absorbedPunkId,
        accountRevisions: planned.plan.accountRevisions,
        recoveryDescriptor: canonicalJson({
          authorityManifest: {},
          plan: planned.plan,
          schemaVersion: 1,
        }),
      }),
    ).resolves.toMatchObject({ ok: true, replayed: false });

    let state = (await authority.commitPlan({
      command,
      callerSessionId: value.survivorSessionId,
      correlationId: "receipt-restored",
    })) as AccountMergeCommitResponse;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (state.ok && state.state.status === "completed") break;
      expect(await runDurableObjectAlarm(authority)).toBe(true);
      state = (await authority.readMergeState({
        planId: planned.plan.planId,
        callerPunkId: value.survivorProof.punkId,
      })) as AccountMergeCommitResponse;
    }

    expect(state).toMatchObject({
      ok: true,
      state: {
        status: "completed",
        receipt: { receiptId, planId: planned.plan.planId },
        lastFailure: null,
      },
    });
    await expect(
      authEnv.PUNKS.getByName(value.absorbedProof.punkId).query(),
    ).resolves.toEqual({ ok: false, code: "inactive" });
  });

  it("recovers the Plan and manifest after intent storage is restored", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const survivor = authEnv.PUNKS.getByName(value.survivorProof.punkId);
    const absorbed = authEnv.PUNKS.getByName(value.absorbedProof.punkId);
    const survivorBefore = await survivor.readForResolution();
    const absorbedBefore = await absorbed.readForResolution();
    if (survivorBefore === null || absorbedBefore === null) {
      throw new TypeError("Expected both Punk authorities before the merge");
    }
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    const planned = await authority.preparePlan({
      command: value.command(),
      correlationId: "cold-recovery-plan",
    });
    if (!planned.ok) throw new TypeError("Expected a merge Plan");
    const command: CommitAccountMergeCommand = {
      contract: "account-merge.commit@1",
      commandId: crypto.randomUUID(),
      intentId: planned.plan.intentId,
      planId: planned.plan.planId,
      planDigest: planned.plan.planDigest,
      survivorPunkId: planned.plan.survivorPunkId,
      absorbedPunkId: planned.plan.absorbedPunkId,
      accountRevisions: planned.plan.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };
    await expect(
      authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "cold-recovery-commit",
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: { receipt: { planId: planned.plan.planId } },
    });

    await runInDurableObject(authority, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM account_merge_saga");
      state.storage.sql.exec("DELETE FROM account_merge_plan");
      state.storage.sql.exec("DELETE FROM account_merge_proof");
    });
    for (const [punk, snapshot] of [
      [survivor, survivorBefore],
      [absorbed, absorbedBefore],
    ] as const) {
      await runInDurableObject(punk, (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(snapshot),
        );
        state.storage.sql.exec("DELETE FROM account_merge_operation");
      });
    }

    let recovered = (await authority.commitPlan({
      command,
      callerSessionId: value.survivorSessionId,
      correlationId: "cold-recovery-retry",
    })) as AccountMergeCommitResponse;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (recovered.ok && recovered.state.status === "completed") break;
      expect(await runDurableObjectAlarm(authority)).toBe(true);
      recovered = (await authority.readMergeState({
        planId: planned.plan.planId,
        callerPunkId: value.survivorProof.punkId,
      })) as AccountMergeCommitResponse;
    }

    expect(recovered).toMatchObject({
      ok: true,
      state: {
        status: "completed",
        planId: planned.plan.planId,
        receipt: { planId: planned.plan.planId },
        lastFailure: null,
      },
    });
  });

  it("refuses a stale account revision before writing the terminal receipt", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    const planned = await authority.preparePlan({
      command: value.command(),
      correlationId: "stale-plan",
    });
    if (!planned.ok) throw new TypeError("Expected a merge Plan");
    await expect(
      authEnv.PUNKS.getByName(value.survivorProof.punkId).updateProfile({
        contract: "punk.update@1",
        commandId: crypto.randomUUID(),
        expectedRevision: 1,
        displayName: "Changed after planning",
        avatarUrl: null,
      }),
    ).resolves.toMatchObject({ ok: true });
    const command: CommitAccountMergeCommand = {
      contract: "account-merge.commit@1",
      commandId: crypto.randomUUID(),
      intentId: planned.plan.intentId,
      planId: planned.plan.planId,
      planDigest: planned.plan.planDigest,
      survivorPunkId: planned.plan.survivorPunkId,
      absorbedPunkId: planned.plan.absorbedPunkId,
      accountRevisions: planned.plan.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };

    await expect(
      authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "stale-commit",
      }),
    ).resolves.toEqual({
      contract: "account-merge.commit-response@1",
      ok: false,
      code: "revision_conflict",
      correlationId: "stale-commit",
    });
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.lookupAccountMergeReceipt({
        absorbedPunkId: value.absorbedProof.punkId,
      }),
    ).resolves.toEqual({ ok: true, receipt: null });
    await expect(
      authEnv.PUNKS.getByName(value.absorbedProof.punkId).query(),
    ).resolves.toMatchObject({ ok: true });
  });

  it("types a missing proof Session as authority unavailable", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    const planned = await authority.preparePlan({
      command: value.command(),
      correlationId: "authority-plan",
    });
    if (!planned.ok) throw new TypeError("Expected a merge Plan");
    await expect(
      authEnv.SESSIONS.getByName(value.absorbedSessionId).revoke(),
    ).resolves.toBe(true);
    const command: CommitAccountMergeCommand = {
      contract: "account-merge.commit@1",
      commandId: crypto.randomUUID(),
      intentId: planned.plan.intentId,
      planId: planned.plan.planId,
      planDigest: planned.plan.planDigest,
      survivorPunkId: planned.plan.survivorPunkId,
      absorbedPunkId: planned.plan.absorbedPunkId,
      accountRevisions: planned.plan.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };

    await expect(
      authority.commitPlan({
        command,
        callerSessionId: value.survivorSessionId,
        correlationId: "missing-proof-session",
      }),
    ).resolves.toEqual({
      contract: "account-merge.commit-response@1",
      ok: false,
      code: "authority_unavailable",
      correlationId: "missing-proof-session",
    });
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.lookupAccountMergeReceipt({
        absorbedPunkId: value.absorbedProof.punkId,
      }),
    ).resolves.toEqual({ ok: true, receipt: null });
  });

  it("allows exactly one winner between concurrent preparation calls", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );

    const responses = await Promise.all([
      authority.preparePlan({
        command: value.command(opaqueUuid()),
        correlationId: "concurrent-a",
      }),
      authority.preparePlan({
        command: value.command(opaqueUuid()),
        correlationId: "concurrent-b",
      }),
    ]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(responses.filter((response) => !response.ok)).toHaveLength(1);
  });

  it("does not consume the first proof when the pair cannot commit", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );

    await expect(
      authority.preparePlan({
        command: value.command(),
        correlationId: "incomplete",
      }),
    ).resolves.toEqual(failure("incomplete"));

    await expect(
      authority.recordFreshProof(
        value.absorbedProof,
        sourceSession(value, value.absorbedProof),
      ),
    ).resolves.toBe(true);
    const completed = await authority.preparePlan({
      command: value.command(),
      correlationId: "complete",
    });
    expect(completed.ok).toBe(true);
  });

  it("deletes an abandoned incomplete intent when its alarm fires", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await expect(runDurableObjectAlarm(authority)).resolves.toBe(true);
    await expect(
      authority.recordFreshProof(
        { ...value.survivorProof, proofId: opaqueUuid() },
        sourceSession(value, value.survivorProof),
      ),
    ).resolves.toBe(true);
  });

  it("uses one non-enumerating failure for invalid proof and Punk states", async () => {
    const expired = fixture(Date.now() - 600_000);
    await seedAuthorities(expired);
    const expiredAuthority = stub(expired.intentId);
    await expiredAuthority.recordFreshProof(
      expired.survivorProof,
      sourceSession(expired, expired.survivorProof),
    );
    await expiredAuthority.recordFreshProof(
      expired.absorbedProof,
      sourceSession(expired, expired.absorbedProof),
    );

    const wrongIntent = fixture();
    await seedAuthorities(wrongIntent);
    const wrongIntentAuthority = stub(wrongIntent.intentId);
    await wrongIntentAuthority.recordFreshProof(
      wrongIntent.survivorProof,
      sourceSession(wrongIntent, wrongIntent.survivorProof),
    );
    await wrongIntentAuthority.recordFreshProof(
      wrongIntent.absorbedProof,
      sourceSession(wrongIntent, wrongIntent.absorbedProof),
    );
    const wrongCommand = valueWithIntent(
      wrongIntent.command(),
      crypto.randomUUID(),
    );

    const unavailablePunk = fixture();
    await seedAuthorities(unavailablePunk);
    const unavailableAuthority = stub(unavailablePunk.intentId);
    await unavailableAuthority.recordFreshProof(
      unavailablePunk.survivorProof,
      sourceSession(unavailablePunk, unavailablePunk.survivorProof),
    );
    await unavailableAuthority.recordFreshProof(
      unavailablePunk.absorbedProof,
      sourceSession(unavailablePunk, unavailablePunk.absorbedProof),
    );
    await authEnv.PUNKS.getByName(
      unavailablePunk.survivorProof.punkId,
    ).linkIdentity({
      identity: {
        profile: {
          provider: "google",
          subject: "changed-subject",
          verifiedEmail: "changed@example.test",
          displayName: "changed",
          avatarUrl: null,
          username: "changed",
        },
        subjectHash: digest("9"),
        emailHash: digest("0"),
      },
      now: new Date().toISOString(),
    });

    const responses = await Promise.all([
      expiredAuthority.preparePlan({
        command: expired.command(),
        correlationId: "generic",
      }),
      wrongIntentAuthority.preparePlan({
        command: wrongCommand,
        correlationId: "generic",
      }),
      unavailableAuthority.preparePlan({
        command: unavailablePunk.command(),
        correlationId: "generic",
      }),
    ]);
    expect(responses).toEqual([
      failure("generic"),
      failure("generic"),
      failure("generic"),
    ]);
  });

  it("mints proofs only through the exact private capability and canonical intent", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = planner({
      role: "punks-account-merge-planner",
      environment: "local",
    });
    const holderBindingToken = "h".repeat(64);
    const survivorProof = await authority.recordAccountMergeFreshProof({
      intentId: value.intentId,
      accountRole: "survivor",
      sessionId: value.survivorSessionId,
      holderBindingToken,
    });
    const absorbedProof = await authority.recordAccountMergeFreshProof({
      intentId: value.intentId,
      accountRole: "absorbed",
      sessionId: value.absorbedSessionId,
      holderBindingToken,
    });
    expect(survivorProof).not.toBeNull();
    expect(absorbedProof).not.toBeNull();
    if (survivorProof === null || absorbedProof === null) {
      throw new TypeError("Fresh proof authority fixture failed");
    }
    expect(survivorProof.holderBindingHash).toBe(
      absorbedProof.holderBindingHash,
    );
    await expect(
      authority.recordAccountMergeFreshProof({
        intentId: crypto.randomUUID(),
        accountRole: "survivor",
        sessionId: value.survivorSessionId,
        holderBindingToken,
      }),
    ).resolves.toBeNull();
    const command: CreateAccountMergePlanCommand = {
      contract: "account-merge.plan-create@1",
      commandId: crypto.randomUUID(),
      intentId: value.intentId,
      survivorPunkId: survivorProof.punkId,
      absorbedPunkId: absorbedProof.punkId,
      holderBindingHash: survivorProof.holderBindingHash,
      proofs: [
        survivorProof,
        absorbedProof,
      ] as CreateAccountMergePlanCommand["proofs"],
    };
    const response = await authority.prepareAccountMergePlan({
      intentId: value.intentId,
      command,
      correlationId: "private-capability",
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new TypeError("Expected private Plan preparation");
    await expect(
      authority.readAccountMergePlan(value.intentId),
    ).resolves.toEqual(response.plan);

    await expect(
      planner(undefined).recordAccountMergeFreshProof({
        intentId: value.intentId,
        accountRole: "survivor",
        sessionId: value.survivorSessionId,
        holderBindingToken,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed after an authority revokes either fresh proof", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    await expect(
      authority.revokeFreshProof(value.absorbedProof.proofId),
    ).resolves.toBe(true);
    await expect(
      authority.preparePlan({
        command: value.command(),
        correlationId: "revoked",
      }),
    ).resolves.toEqual(failure("revoked"));
  });

  it("fails closed when a source Session is revoked before preparation", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );
    await authEnv.SESSIONS.getByName(value.survivorSessionId).revoke();

    await expect(
      authority.preparePlan({
        command: value.command(),
        correlationId: "revoked-session",
      }),
    ).resolves.toEqual(failure("revoked-session"));
  });

  it("derives all Sessions and handoffs from authoritative server indexes", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const extraSessionId = opaqueUuid();
    await expect(
      authEnv.SESSIONS.getByName(extraSessionId).create(
        {
          sessionId: extraSessionId,
          punkId: value.survivorProof.punkId,
          authenticatedAt: timestamp(Date.now() - 3_600_000),
          expiresAt: timestamp(Date.now() + 86_400_000),
          recentReauthUntil: null,
        },
        "desktop",
      ),
    ).resolves.toBe(true);
    const handoffId = crypto.randomUUID();
    const handoffExpiresAt = timestamp(Date.now() + 300_000);
    await expect(
      authEnv.AUTH_TRANSACTIONS.getByName(handoffId).create({
        provider: "google",
        intent: "reauthenticate",
        returnTo: "/settings/identity",
        browserBindingHash: digest("d"),
        codeVerifier: "oauth-code-verifier",
        currentPunkId: value.survivorProof.punkId,
        currentSessionId: value.survivorSessionId,
        createdAt: timestamp(Date.now()),
        expiresAt: handoffExpiresAt,
      }),
    ).resolves.toBe(true);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );

    const response = await authority.preparePlan({
      command: value.command(),
      correlationId: "server-indexes",
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new TypeError("Expected indexed Plan");
    expect(response.plan.sessions).toHaveLength(3);
    expect(response.plan.sessions).toContainEqual(
      expect.objectContaining({ clientKind: "desktop", action: "revoke" }),
    );
    expect(response.plan.handoffs).toHaveLength(3);
    expect(response.plan.handoffs).toContainEqual(
      expect.objectContaining({
        kind: "oauth-transaction",
        state: "pending",
        action: "cancel",
      }),
    );
  });

  it("revalidates a desktop reauthentication grant before planning its cancellation", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const authorizationId = crypto.randomUUID();
    const expiresAt = timestamp(Date.now() + 300_000);
    await expect(
      authEnv.DESKTOP_REAUTH_GRANTS.getByName(authorizationId).create({
        authorizationId,
        sessionId: value.survivorSessionId,
        punkId: value.survivorProof.punkId,
        targetMethod: "link_github",
        handoffId: crypto.randomUUID(),
        expiresAt,
      }),
    ).resolves.toBe(true);
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );

    const response = await authority.preparePlan({
      command: value.command(),
      correlationId: "desktop-reauth-grant",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new TypeError("Expected indexed Plan");
    expect(response.plan.handoffs).toContainEqual(
      expect.objectContaining({
        origin: "survivor",
        kind: "reauth-authorization",
        state: "deliverable",
        action: "cancel",
        expiresAt,
      }),
    );
  });

  it("includes an in-flight desktop Session rotation in the immutable Plan", async () => {
    const value = fixture();
    await seedAuthorities(value);
    const rotationId = crypto.randomUUID();
    const rotation = await authEnv.SESSION_ROTATIONS.getByName(
      rotationId,
    ).create({
      commandId: crypto.randomUUID(),
      oldSessionId: value.survivorSessionId,
      punkId: value.survivorProof.punkId,
    });
    expect(rotation).not.toBeNull();
    if (rotation === null) throw new TypeError("Expected Session rotation");
    const authority = stub(value.intentId);
    await authority.recordFreshProof(
      value.survivorProof,
      sourceSession(value, value.survivorProof),
    );
    await authority.recordFreshProof(
      value.absorbedProof,
      sourceSession(value, value.absorbedProof),
    );

    const response = await authority.preparePlan({
      command: value.command(),
      correlationId: "session-renewal",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new TypeError("Expected indexed Plan");
    expect(response.plan.handoffs).toContainEqual(
      expect.objectContaining({
        origin: "survivor",
        kind: "session-renewal",
        state: "pending",
        action: "cancel",
        expiresAt: rotation.confirmBy,
      }),
    );
  });

  it("rejects expanded planner RPC input", async () => {
    const value = fixture();
    await seedAuthorities(value);
    await expect(
      planner({
        role: "punks-account-merge-planner",
        environment: "local",
      }).prepareAccountMergePlan({
        intentId: value.intentId,
        command: value.command(),
        correlationId: "expanded-input",
        punks: [],
      }),
    ).resolves.toEqual(failure("account-merge"));
  });
});

function valueWithIntent(
  command: CreateAccountMergePlanCommand,
  intentId: string,
): CreateAccountMergePlanCommand {
  return {
    ...command,
    intentId,
    proofs: command.proofs.map((proof) => ({
      ...proof,
      intentId,
    })) as CreateAccountMergePlanCommand["proofs"],
  };
}
