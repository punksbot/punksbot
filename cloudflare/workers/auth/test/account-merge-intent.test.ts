import type {
  AccountMergeFreshProof,
  AccountMergePlanResponse,
  CreateAccountMergePlanCommand,
} from "@punks/contracts";
import type { AccountMergePunkSnapshot } from "@punks/core";
import { env, runDurableObjectAlarm } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
