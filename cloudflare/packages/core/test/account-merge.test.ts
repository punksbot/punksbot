import type {
  AccountMergeFreshProof,
  AccountMergePlan,
  CreateAccountMergePlanCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  prepareAccountMergePlan,
  type AccountMergeAuthoritativeProof,
  type AccountMergePunkSnapshot,
  type PrepareAccountMergePlanInput,
} from "../src";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const SURVIVOR_ID = "11111111-1111-4111-8111-111111111111";
const ABSORBED_ID = "22222222-2222-4222-8222-222222222222";
const INTENT_ID = "33333333-3333-4333-8333-333333333333";
const COMMAND_ID = "44444444-4444-4444-8444-444444444444";
const SURVIVOR_PROOF_ID = "55555555-5555-4555-8555-555555555555";
const ABSORBED_PROOF_ID = "66666666-6666-4666-8666-666666666666";

function digest(character: string): string {
  return character.repeat(64);
}

function indexedDigest(namespace: string, index: number): string {
  return `${namespace}${index.toString(16).padStart(63, "0")}`;
}

function proof(accountRole: "survivor" | "absorbed"): AccountMergeFreshProof {
  const survivor = accountRole === "survivor";
  return {
    contract: "account-merge.fresh-proof@1",
    proofId: survivor ? SURVIVOR_PROOF_ID : ABSORBED_PROOF_ID,
    intentId: INTENT_ID,
    accountRole,
    punkId: survivor ? SURVIVOR_ID : ABSORBED_ID,
    accountRevision: survivor ? 12 : 7,
    holderBindingHash: digest("a"),
    authenticationMethod: survivor ? "github" : "google",
    providerSubjectBindingHash: survivor ? digest("b") : digest("c"),
    authenticatedAt: survivor
      ? "2026-08-24T11:58:00.000Z"
      : "2026-08-24T11:57:00.000Z",
    expiresAt: survivor
      ? "2026-08-24T12:03:00.000Z"
      : "2026-08-24T12:02:00.000Z",
    validForSeconds: 300,
  };
}

function punkSnapshots(): AccountMergePunkSnapshot[] {
  return [
    {
      punkId: SURVIVOR_ID,
      status: "active",
      revision: 12,
      claims: [
        {
          claimBindingHash: digest("d"),
          kind: "verified-email",
          provider: "github",
          punkId: SURVIVOR_ID,
          revision: 4,
        },
        {
          claimBindingHash: digest("e"),
          kind: "provider-subject",
          provider: "google",
          punkId: SURVIVOR_ID,
          revision: 2,
        },
      ],
      rights: [
        {
          rightBindingHash: digest("f"),
          kind: "workspace-membership",
          authorityBindingHash: digest("1"),
          punkId: SURVIVOR_ID,
          role: "member",
          revision: 5,
        },
        {
          rightBindingHash: digest("2"),
          kind: "local-resource-binding",
          authorityBindingHash: digest("3"),
          punkId: SURVIVOR_ID,
          role: null,
          revision: 2,
        },
      ],
      sessions: [
        {
          sessionBindingHash: digest("4"),
          punkId: SURVIVOR_ID,
          clientKind: "desktop",
          authenticatedAt: "2026-08-24T10:00:00.000Z",
          expiresAt: "2026-08-25T10:00:00.000Z",
        },
      ],
      handoffs: [
        {
          handoffBindingHash: digest("5"),
          punkId: SURVIVOR_ID,
          kind: "desktop-auth-flow",
          state: "deliverable",
          expiresAt: "2026-08-24T12:10:00.000Z",
        },
      ],
    },
    {
      punkId: ABSORBED_ID,
      status: "active",
      revision: 7,
      claims: [
        {
          claimBindingHash: digest("d"),
          kind: "verified-email",
          provider: "github",
          punkId: ABSORBED_ID,
          revision: 3,
        },
        {
          claimBindingHash: digest("6"),
          kind: "provider-subject",
          provider: "google",
          punkId: ABSORBED_ID,
          revision: 8,
        },
      ],
      rights: [
        {
          rightBindingHash: digest("7"),
          kind: "workspace-membership",
          authorityBindingHash: digest("1"),
          punkId: ABSORBED_ID,
          role: "moderator",
          revision: 3,
        },
        {
          rightBindingHash: digest("8"),
          kind: "repository-access-proof",
          authorityBindingHash: digest("9"),
          punkId: ABSORBED_ID,
          role: null,
          revision: 1,
        },
      ],
      sessions: [
        {
          sessionBindingHash: digest("0"),
          punkId: ABSORBED_ID,
          clientKind: "browser",
          authenticatedAt: "2026-08-24T09:00:00.000Z",
          expiresAt: "2026-08-25T09:00:00.000Z",
        },
      ],
      handoffs: [
        {
          handoffBindingHash: digest("b"),
          punkId: ABSORBED_ID,
          kind: "account-link",
          state: "prepared",
          expiresAt: "2026-08-24T12:05:00.000Z",
        },
      ],
    },
  ];
}

function validInput(): PrepareAccountMergePlanInput {
  const proofs = [proof("survivor"), proof("absorbed")] as const;
  const command: CreateAccountMergePlanCommand = {
    contract: "account-merge.plan-create@1",
    commandId: COMMAND_ID,
    intentId: INTENT_ID,
    survivorPunkId: SURVIVOR_ID,
    absorbedPunkId: ABSORBED_ID,
    holderBindingHash: digest("a"),
    proofs: [...proofs] as CreateAccountMergePlanCommand["proofs"],
  };
  return {
    command,
    now: new Date(NOW),
    correlationId: "merge-correlation",
    authoritativeProofs: proofs.map(
      (descriptor): AccountMergeAuthoritativeProof => ({
        descriptor,
        state: "active",
      }),
    ),
    punks: punkSnapshots(),
  };
}

function conflictBoundInput(
  includeClaimConflict: boolean,
): PrepareAccountMergePlanInput {
  const input = validInput();
  const [survivor, absorbed] = input.punks;
  if (survivor === undefined || absorbed === undefined) {
    throw new TypeError("Fixture is incomplete");
  }
  const authorities = Array.from({ length: 256 }, (_, index) =>
    indexedDigest("1", index),
  );
  const claims = includeClaimConflict
    ? [
        {
          claimBindingHash: indexedDigest("4", 0),
          kind: "provider-subject" as const,
          provider: "github" as const,
          revision: 1,
        },
      ]
    : [];
  return {
    ...input,
    punks: [
      {
        ...survivor,
        claims: claims.map((claim) => ({
          ...claim,
          punkId: survivor.punkId,
        })),
        rights: authorities.map((authorityBindingHash, index) => ({
          rightBindingHash: indexedDigest("2", index),
          kind: "workspace-membership" as const,
          authorityBindingHash,
          punkId: survivor.punkId,
          role: "member" as const,
          revision: 1,
        })),
      },
      {
        ...absorbed,
        claims: claims.map((claim) => ({
          ...claim,
          punkId: absorbed.punkId,
        })),
        rights: authorities.map((authorityBindingHash, index) => ({
          rightBindingHash: indexedDigest("3", index),
          kind: "workspace-membership" as const,
          authorityBindingHash,
          punkId: absorbed.punkId,
          role: "moderator" as const,
          revision: 1,
        })),
      },
    ],
  };
}

function expectSuccess(
  response: Awaited<ReturnType<typeof prepareAccountMergePlan>>,
): AccountMergePlan {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new TypeError("Expected a planned response");
  return response.plan;
}

function reverseInventory(input: PrepareAccountMergePlanInput) {
  return {
    ...input,
    authoritativeProofs: [...input.authoritativeProofs].reverse(),
    punks: [...input.punks].reverse().map((punk) => ({
      ...punk,
      claims: [...punk.claims].reverse(),
      rights: [...punk.rights].reverse(),
      sessions: [...punk.sessions].reverse(),
      handoffs: [...punk.handoffs].reverse(),
    })),
    command: {
      ...(input.command as CreateAccountMergePlanCommand),
      proofs: [
        ...(input.command as CreateAccountMergePlanCommand).proofs,
      ].reverse() as CreateAccountMergePlanCommand["proofs"],
    },
  } satisfies PrepareAccountMergePlanInput;
}

describe("account merge Plan", () => {
  it("returns exactly the canonical generated contract without mutating authority", async () => {
    const input = validInput();
    const before = structuredClone(input);
    const response = await prepareAccountMergePlan(input);
    const plan = expectSuccess(response);

    expect(
      validateContract("punks://contracts/account-merge.plan@1", plan).valid,
    ).toBe(true);
    expect(
      validateContract(
        "punks://contracts/account-merge.plan-response@1",
        response,
      ).valid,
    ).toBe(true);
    expect(plan.contract).toBe("account-merge.plan@1");
    expect(plan.planId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(plan.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.expiresAt).toBe("2026-08-24T12:02:00.000Z");
    expect(plan.validForSeconds).toBe(120);
    expect(plan.proofBindings).toEqual({
      survivorProofId: SURVIVOR_PROOF_ID,
      absorbedProofId: ABSORBED_PROOF_ID,
    });
    expect(plan.claims).toContainEqual(
      expect.objectContaining({
        claimBindingHash: digest("d"),
        origin: "absorbed",
        disposition: "deduplicate",
        duplicateOfBindingHash: digest("d"),
      }),
    );
    expect(plan.claims).toContainEqual(
      expect.objectContaining({
        claimBindingHash: digest("6"),
        origin: "absorbed",
        disposition: "transfer",
      }),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("f"),
        disposition: "preserve",
        role: "member",
        resultingRole: "moderator",
      }),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("7"),
        disposition: "deduplicate",
        role: "moderator",
        resultingRole: "moderator",
      }),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("2"),
        disposition: "invalidate",
      }),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("8"),
        disposition: "invalidate",
      }),
    );
    expect(plan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "identical-claim",
          resolution: "deduplicate",
          blocking: false,
        }),
        expect.objectContaining({
          kind: "workspace-role",
          resolution: "strongest-role",
          blocking: false,
        }),
      ]),
    );
    expect("preparedAtMs" in plan).toBe(false);
    expect("proofs" in plan).toBe(false);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(input).toEqual(before);
  });

  it("keeps plan identity, digest and arrays deterministic", async () => {
    const input = validInput();
    const first = expectSuccess(await prepareAccountMergePlan(input));
    const second = expectSuccess(
      await prepareAccountMergePlan(reverseInventory(input)),
    );

    expect(second).toEqual(first);
  });

  it("keeps invitation and owned-resource effects aligned with conflicts", async () => {
    const input = validInput();
    const [survivor, absorbed] = input.punks;
    if (survivor === undefined || absorbed === undefined) {
      throw new TypeError("Fixture is incomplete");
    }
    const withStrategyRights: PrepareAccountMergePlanInput = {
      ...input,
      punks: [
        {
          ...survivor,
          rights: [
            ...survivor.rights,
            {
              rightBindingHash: digest("c"),
              kind: "workspace-invitation",
              authorityBindingHash: digest("d"),
              punkId: survivor.punkId,
              role: null,
              revision: 1,
            },
            {
              rightBindingHash: digest("a"),
              kind: "account-owned-resource",
              authorityBindingHash: digest("6"),
              punkId: survivor.punkId,
              role: null,
              revision: 1,
            },
          ],
        },
        {
          ...absorbed,
          rights: [
            ...absorbed.rights,
            {
              rightBindingHash: digest("e"),
              kind: "workspace-invitation",
              authorityBindingHash: digest("d"),
              punkId: absorbed.punkId,
              role: null,
              revision: 2,
            },
            {
              rightBindingHash: digest("f"),
              kind: "account-owned-resource",
              authorityBindingHash: digest("6"),
              punkId: absorbed.punkId,
              role: null,
              revision: 2,
            },
          ],
        },
      ],
    };
    const plan = expectSuccess(
      await prepareAccountMergePlan(withStrategyRights),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("e"),
        disposition: "retarget",
      }),
    );
    expect(plan.rights).toContainEqual(
      expect.objectContaining({
        rightBindingHash: digest("f"),
        disposition: "transfer",
      }),
    );
    expect(plan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate-invitation",
          resolution: "retarget-invitation",
          blocking: false,
        }),
        expect.objectContaining({
          kind: "account-owned-resource",
          resolution: "requires-adapter",
          blocking: true,
        }),
      ]),
    );
  });

  it("cross-binds role, Punk, intent, holder, descriptor and revisions", async () => {
    const cases: PrepareAccountMergePlanInput[] = [];
    const mutateCommandProof = (
      patch: Partial<AccountMergeFreshProof>,
    ): PrepareAccountMergePlanInput => {
      const input = validInput();
      const command = input.command as CreateAccountMergePlanCommand;
      return {
        ...input,
        command: {
          ...command,
          proofs: [
            { ...command.proofs[0], ...patch },
            command.proofs[1],
          ] as CreateAccountMergePlanCommand["proofs"],
        },
      };
    };
    cases.push(
      mutateCommandProof({ accountRole: "absorbed" }),
      mutateCommandProof({ punkId: ABSORBED_ID }),
      mutateCommandProof({ intentId: COMMAND_ID }),
      mutateCommandProof({ holderBindingHash: digest("f") }),
      mutateCommandProof({ accountRevision: 11 }),
      mutateCommandProof({ expiresAt: NOW.toISOString() }),
    );
    const consumed = validInput();
    cases.push({
      ...consumed,
      authoritativeProofs: consumed.authoritativeProofs.map((item, index) =>
        index === 0 ? { ...item, state: "consumed" as const } : item,
      ),
    });
    const differentDescriptor = validInput();
    cases.push({
      ...differentDescriptor,
      authoritativeProofs: differentDescriptor.authoritativeProofs.map(
        (item, index) =>
          index === 0
            ? {
                ...item,
                descriptor: {
                  ...item.descriptor,
                  providerSubjectBindingHash: digest("0"),
                },
              }
            : item,
      ),
    });
    const overlongProof = validInput();
    const overlongCommand =
      overlongProof.command as CreateAccountMergePlanCommand;
    const overlongDescriptor = {
      ...overlongCommand.proofs[0],
      expiresAt: "2026-08-24T12:03:01.000Z",
      validForSeconds: 301,
    } as unknown as AccountMergeFreshProof;
    cases.push({
      ...overlongProof,
      command: {
        ...overlongCommand,
        proofs: [
          overlongDescriptor,
          overlongCommand.proofs[1],
        ] as CreateAccountMergePlanCommand["proofs"],
      },
      authoritativeProofs: overlongProof.authoritativeProofs.map(
        (item, index) =>
          index === 0 ? { ...item, descriptor: overlongDescriptor } : item,
      ),
    });

    for (const input of cases) {
      await expect(prepareAccountMergePlan(input)).resolves.toEqual({
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        correlationId: "merge-correlation",
      });
    }
  });

  it("fails closed for unavailable Punks and unknown right strategies", async () => {
    const unavailable = validInput();
    const unknown = validInput();
    const first = unknown.punks[0];
    if (first === undefined) throw new TypeError("Fixture is incomplete");
    const firstRight = first.rights[0];
    if (firstRight === undefined) throw new TypeError("Fixture is incomplete");
    const unknownRight = {
      ...firstRight,
      kind: "future-right",
    } as unknown as (typeof first.rights)[number];
    const duplicateAuthority = {
      ...firstRight,
      rightBindingHash: digest("a"),
    };

    for (const input of [
      {
        ...unavailable,
        punks: unavailable.punks.map((punk, index) =>
          index === 0 ? { ...punk, status: "merged" as const } : punk,
        ),
      },
      {
        ...unknown,
        punks: [
          { ...first, rights: [unknownRight] },
          ...(unknown.punks.slice(1) as AccountMergePunkSnapshot[]),
        ],
      },
      {
        ...unknown,
        punks: [
          {
            ...first,
            rights: [...first.rights, duplicateAuthority],
          },
          ...(unknown.punks.slice(1) as AccountMergePunkSnapshot[]),
        ],
      },
    ]) {
      await expect(prepareAccountMergePlan(input)).resolves.toEqual({
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        correlationId: "merge-correlation",
      });
    }
  });

  it("rejects overbound authority inventories before traversing them", async () => {
    const limits = [
      ["claims", 65],
      ["rights", 513],
      ["sessions", 129],
      ["handoffs", 65],
    ] as const;
    for (const [collection, count] of limits) {
      const input = validInput();
      const first = input.punks[0];
      if (first === undefined || first[collection][0] === undefined) {
        throw new TypeError("Fixture is incomplete");
      }
      const oversized = {
        ...first,
        [collection]: Array.from({ length: count }, () => first[collection][0]),
      } as AccountMergePunkSnapshot;
      await expect(
        prepareAccountMergePlan({
          ...input,
          punks: [oversized, input.punks[1] as AccountMergePunkSnapshot],
        }),
      ).resolves.toEqual({
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        correlationId: "merge-correlation",
      });
    }
  });

  it("accepts exactly 256 conflicts", async () => {
    const plan = expectSuccess(
      await prepareAccountMergePlan(conflictBoundInput(false)),
    );

    expect(plan.conflicts).toHaveLength(256);
  });

  it("rejects a 257th conflict before hashing conflicts", async () => {
    const digestSpy = vi.spyOn(crypto.subtle, "digest");
    try {
      await expect(
        prepareAccountMergePlan(conflictBoundInput(true)),
      ).resolves.toEqual({
        contract: "account-merge.plan-response@1",
        ok: false,
        code: "plan_unavailable",
        correlationId: "merge-correlation",
      });
      expect(digestSpy).not.toHaveBeenCalled();
    } finally {
      digestSpy.mockRestore();
    }
  });
});
