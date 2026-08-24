import { describe, expect, it } from "vitest";

import { contractSchemas, validateContract } from "../src";
import registry from "../registry.json";

const intentId = "11111111-1111-4111-8111-111111111111";
const survivorPunkId = "22222222-2222-4222-8222-222222222222";
const absorbedPunkId = "33333333-3333-4333-8333-333333333333";
const holderBindingHash = "a".repeat(64);

function validates(contractId: (typeof contractIds)[number], value: unknown) {
  return validateContract(contractId as never, value).valid;
}

function freshProof(
  accountRole: "survivor" | "absorbed",
  punkId: string,
  proofId: string,
) {
  return {
    contract: "account-merge.fresh-proof@1",
    proofId,
    intentId,
    accountRole,
    punkId,
    accountRevision: accountRole === "survivor" ? 7 : 11,
    holderBindingHash,
    authenticationMethod: accountRole === "survivor" ? "passkey" : "github",
    providerSubjectBindingHash:
      accountRole === "survivor" ? "b".repeat(64) : "c".repeat(64),
    authenticatedAt: "2026-08-24T09:00:00.000Z",
    expiresAt: "2026-08-24T09:05:00.000Z",
    validForSeconds: 300,
  };
}

function mergePlan() {
  return {
    contract: "account-merge.plan@1",
    schemaVersion: 1,
    planId: "77777777-7777-4777-8777-777777777777",
    intentId,
    planDigest: "d".repeat(64),
    status: "planned",
    generatedAt: "2026-08-24T09:01:00.000Z",
    expiresAt: "2026-08-24T09:05:00.000Z",
    validForSeconds: 240,
    holderBindingHash,
    strategy: "preserve-origin",
    survivorPunkId,
    absorbedPunkId,
    accountRevisions: { survivor: 7, absorbed: 11 },
    proofBindings: {
      survivorProofId: "44444444-4444-4444-8444-444444444444",
      absorbedProofId: "55555555-5555-4555-8555-555555555555",
    },
    claims: [
      {
        claimBindingHash: "e".repeat(64),
        kind: "provider-subject",
        provider: "github",
        origin: "absorbed",
        disposition: "transfer",
        duplicateOfBindingHash: null,
        expectedRevision: 3,
      },
    ],
    rights: [
      {
        rightBindingHash: "f".repeat(64),
        kind: "workspace-membership",
        authorityBindingHash: "1".repeat(64),
        origin: "absorbed",
        originPunkId: absorbedPunkId,
        disposition: "transfer",
        role: "moderator",
        resultingRole: "moderator",
        expectedRevision: 9,
      },
    ],
    sessions: [
      {
        sessionBindingHash: "2".repeat(64),
        origin: "survivor",
        clientKind: "desktop",
        action: "revoke",
        authenticatedAt: "2026-08-24T08:00:00.000Z",
        expiresAt: "2026-08-24T10:00:00.000Z",
      },
    ],
    handoffs: [
      {
        handoffBindingHash: "3".repeat(64),
        origin: "absorbed",
        kind: "desktop-auth-flow",
        state: "pending",
        action: "cancel",
        expiresAt: "2026-08-24T09:04:00.000Z",
      },
    ],
    conflicts: [
      {
        conflictBindingHash: "4".repeat(64),
        kind: "workspace-role",
        authorityBindingHash: "5".repeat(64),
        resolution: "strongest-role",
        blocking: false,
      },
    ],
  };
}

const contractIds = [
  "punks://contracts/account-merge.fresh-proof@1",
  "punks://contracts/account-merge.plan-create@1",
  "punks://contracts/account-merge.plan@1",
  "punks://contracts/account-merge.plan-response@1",
] as const;

describe("Account Merge Plan contracts", () => {
  it("registers the complete versioned preview surface", () => {
    expect(Object.keys(contractSchemas)).toEqual(
      expect.arrayContaining([...contractIds]),
    );
  });

  it("marks every preview contract for TypeScript, Rust, Dart and OpenAPI generation", () => {
    const entries = registry.contracts.filter(({ id }) =>
      contractIds.includes(id as (typeof contractIds)[number]),
    ) as Array<{ id: string; generationTargets?: string[] }>;

    expect(entries).toHaveLength(contractIds.length);
    for (const entry of entries) {
      expect(entry.generationTargets, entry.id).toEqual([
        "typescript",
        "rust",
        "dart",
        "openapi",
      ]);
    }
  });

  it("binds two independent five-minute proofs to one explicit survivor choice", () => {
    const survivorProof = freshProof(
      "survivor",
      survivorPunkId,
      "44444444-4444-4444-8444-444444444444",
    );
    const absorbedProof = freshProof(
      "absorbed",
      absorbedPunkId,
      "55555555-5555-4555-8555-555555555555",
    );
    const command = {
      contract: "account-merge.plan-create@1",
      commandId: "66666666-6666-4666-8666-666666666666",
      intentId,
      survivorPunkId,
      absorbedPunkId,
      holderBindingHash,
      proofs: [survivorProof, absorbedProof],
    };

    expect(
      validateContract(
        "punks://contracts/account-merge.fresh-proof@1" as never,
        survivorProof,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/account-merge.plan-create@1" as never,
        command,
      ),
    ).toEqual({ valid: true });
  });

  it("accepts a bounded immutable Plan with preserve-origin effects", () => {
    expect(
      validateContract(
        "punks://contracts/account-merge.plan@1" as never,
        mergePlan(),
      ),
    ).toEqual({ valid: true });
  });

  it("returns a closed success/failure union without disclosing the other account", () => {
    const success = {
      contract: "account-merge.plan-response@1",
      ok: true,
      status: "planned",
      plan: mergePlan(),
    };
    const failure = {
      contract: "account-merge.plan-response@1",
      ok: false,
      code: "plan_unavailable",
      correlationId: "merge-plan-correlation",
    };

    expect(
      validateContract(
        "punks://contracts/account-merge.plan-response@1" as never,
        success,
      ),
    ).toEqual({ valid: true });
    expect(
      validates("punks://contracts/account-merge.plan-response@1", {
        ...success,
        replayed: false,
      }),
    ).toBe(false);
    for (const code of [
      "proof_expired",
      "proof_replayed",
      "proof_wrong_account",
      "holder_binding_mismatch",
      "account_unavailable",
      "account_revision_conflict",
    ]) {
      expect(
        validates("punks://contracts/account-merge.plan-response@1", {
          ...failure,
          code,
        }),
      ).toBe(false);
    }
    expect(
      validateContract(
        "punks://contracts/account-merge.plan-response@1" as never,
        failure,
      ),
    ).toEqual({ valid: true });
  });

  it("rejects raw secrets, open enums, oversized inventories and unknown fields", () => {
    const proof = freshProof(
      "survivor",
      survivorPunkId,
      "44444444-4444-4444-8444-444444444444",
    );
    const plan = mergePlan();
    const oversizedClaims = Array.from({ length: 65 }, (_, index) => ({
      ...plan.claims[0],
      claimBindingHash: index.toString(16).padStart(64, "0"),
    }));

    expect(
      validates("punks://contracts/account-merge.fresh-proof@1", {
        ...proof,
        accessToken: "raw-provider-token",
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.fresh-proof@1", {
        ...proof,
        validForSeconds: 301,
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan@1", {
        ...plan,
        strategy: "rewrite-history",
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan@1", {
        ...plan,
        validForSeconds: 301,
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan@1", {
        ...plan,
        rights: [{ ...plan.rights[0], resultingRole: "administrator" }],
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan@1", {
        ...plan,
        claims: oversizedClaims,
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan@1", {
        ...plan,
        sessions: [{ ...plan.sessions[0], sessionToken: "raw-session-token" }],
      }),
    ).toBe(false);
    expect(
      validates("punks://contracts/account-merge.plan-response@1", {
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        retry: "fresh_proofs",
        correlationId: "merge-plan-correlation",
        otherPunkId: absorbedPunkId,
      }),
    ).toBe(false);
  });

  it("requires exactly one proof for each explicit account role", () => {
    const first = freshProof(
      "survivor",
      survivorPunkId,
      "44444444-4444-4444-8444-444444444444",
    );
    const second = freshProof(
      "survivor",
      absorbedPunkId,
      "55555555-5555-4555-8555-555555555555",
    );

    expect(
      validates("punks://contracts/account-merge.plan-create@1", {
        contract: "account-merge.plan-create@1",
        commandId: "66666666-6666-4666-8666-666666666666",
        intentId,
        survivorPunkId,
        absorbedPunkId,
        holderBindingHash,
        proofs: [first, second],
      }),
    ).toBe(false);
  });
});
