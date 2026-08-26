import { describe, expect, it } from "vitest";

import { validateContract } from "../src/registry";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const ownerId = "00000000-0000-8000-8000-000000000001";
const invitationId = "018f6f4e-8f50-7c4a-8d2d-5d4f2d8a6301";
const code = `${workspaceId}.${"A".repeat(43)}`;

function validCreateCommand() {
  return {
    contract: "workspace.invite@1",
    commandId: "2a2e9e5e-bf3f-4f29-8f37-03ed6bb08001",
    workspaceId,
    actor: { kind: "punk", punkId: ownerId },
    payload: {
      role: "member",
      expectedRevision: 7,
      ttlSeconds: 604_800,
      maxUses: 1,
    },
  };
}

function validInvitation() {
  return {
    contract: "workspace.invitation@1",
    invitationId,
    workspace: {
      id: workspaceId,
      slug: "core-team",
      name: "Core Team",
    },
    workspaceRevision: 7,
    role: "member",
    status: "issued",
    issuedAt: "2026-08-25T10:00:00.000Z",
    expiresAt: "2026-09-01T10:00:00.000Z",
    revokedAt: null,
    maxUses: 1,
    uses: 0,
    usesRemaining: 1,
  };
}

describe("Workspace invitation contracts", () => {
  it("closes voluntary departure and strong ownership transfer commands", () => {
    const workspaceId = "00000000-0000-8000-8000-000000000001";
    const ownerId = "00000000-0000-8000-8000-000000000002";
    const targetId = "00000000-0000-8000-8000-000000000003";
    const commandId = "00000000-0000-8000-8000-000000000004";
    const reauthorizationId = "00000000-0000-8000-8000-000000000005";

    const leave = {
      contract: "workspace.leave@1",
      commandId,
      workspaceId,
      actor: { kind: "punk", punkId: targetId },
      payload: {},
    };
    expect(
      validateContract("punks://contracts/workspace.leave@1" as never, leave)
        .valid,
    ).toBe(true);
    expect(
      validateContract("punks://contracts/workspace.leave@1" as never, {
        ...leave,
        payload: { targetPunkId: targetId },
      }).valid,
    ).toBe(false);

    const transfer = {
      contract: "workspace.transfer-ownership@1",
      commandId,
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: {
        targetPunkId: targetId,
        expectedRevision: 7,
        reauthorizationId,
      },
    };
    expect(
      validateContract(
        "punks://contracts/workspace.transfer-ownership@1" as never,
        transfer,
      ).valid,
    ).toBe(true);
    expect(
      validateContract(
        "punks://contracts/workspace.transfer-ownership@1" as never,
        {
          ...transfer,
          payload: { targetPunkId: targetId, expectedRevision: 7 },
        },
      ).valid,
    ).toBe(false);

    for (const response of [
      {
        contract: "workspace.membership-lifecycle-response@1",
        workspaceId,
        revision: 8,
        outcome: "left",
        role: null,
        replayed: false,
      },
      {
        contract: "workspace.membership-lifecycle-response@1",
        workspaceId,
        revision: 8,
        outcome: "ownership_transferred",
        role: "member",
        replayed: true,
      },
    ]) {
      expect(
        validateContract(
          "punks://contracts/workspace.membership-lifecycle-response@1" as never,
          response,
        ).valid,
      ).toBe(true);
      expect(response).not.toHaveProperty("members");
      expect(response).not.toHaveProperty("ownerPunkId");
    }
  });

  it("requires an optimistic revision fence on every membership mutation", () => {
    const base = {
      commandId: "2a2e9e5e-bf3f-4f29-8f37-03ed6bb08009",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
    };
    const setRole = {
      ...base,
      contract: "workspace.member-set-role@1",
      payload: {
        targetPunkId: "00000000-0000-8000-8000-000000000002",
        role: "member",
        expectedRevision: 7,
      },
    };
    const remove = {
      ...base,
      contract: "workspace.member-remove@1",
      payload: {
        targetPunkId: "00000000-0000-8000-8000-000000000002",
        expectedRevision: 7,
      },
    };

    for (const [contract, command] of [
      ["punks://contracts/workspace.member-set-role@1", setRole],
      ["punks://contracts/workspace.member-remove@1", remove],
    ] as const) {
      expect(validateContract(contract as never, command).valid).toBe(true);
      const { expectedRevision: _, ...unfencedPayload } = command.payload;
      expect(
        validateContract(contract as never, {
          ...command,
          payload: unfencedPayload,
        }).valid,
      ).toBe(false);
    }
  });

  it("accepts only bounded member or guest promises", () => {
    expect(
      validateContract(
        "punks://contracts/workspace.invite@1" as never,
        validCreateCommand(),
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/workspace.invite@1" as never, {
        ...validCreateCommand(),
        payload: {
          role: "guest",
          expectedRevision: 7,
        },
      }),
    ).toEqual({ valid: true });

    for (const payload of [
      { role: "moderator", expectedRevision: 7 },
      { role: "owner", expectedRevision: 7 },
      { role: "member", expectedRevision: 0 },
      { role: "member", expectedRevision: 7, ttlSeconds: 59 },
      { role: "member", expectedRevision: 7, ttlSeconds: 2_592_001 },
      { role: "member", expectedRevision: 7, maxUses: 0 },
      { role: "member", expectedRevision: 7, maxUses: 101 },
    ]) {
      expect(
        validateContract("punks://contracts/workspace.invite@1" as never, {
          ...validCreateCommand(),
          payload,
        }).valid,
        JSON.stringify(payload),
      ).toBe(false);
    }
  });

  it("exposes a bounded invitation view without roster or issuer identity", () => {
    expect(
      validateContract(
        "punks://contracts/workspace.invitation@1" as never,
        validInvitation(),
      ),
    ).toEqual({ valid: true });
    for (const status of ["issued", "revoked", "expired", "exhausted"]) {
      expect(
        validateContract("punks://contracts/workspace.invitation@1" as never, {
          ...validInvitation(),
          status,
          revokedAt: status === "revoked" ? "2026-08-26T10:00:00.000Z" : null,
        }).valid,
        status,
      ).toBe(true);
    }
    expect(
      validateContract("punks://contracts/workspace.invitation@1" as never, {
        ...validInvitation(),
        members: [{ punkId: ownerId, role: "owner" }],
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/workspace.invitation@1" as never, {
        ...validInvitation(),
        issuerPunkId: ownerId,
      }).valid,
    ).toBe(false);
  });

  it("closes consultation, revocation, claim and mutation responses", () => {
    expect(
      validateContract("punks://contracts/workspace.invite-get@1" as never, {
        contract: "workspace.invite-get@1",
        code,
      }),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/workspace.invite-response@1" as never,
        {
          contract: "workspace.invite-response@1",
          invitation: validInvitation(),
          code,
          replayed: false,
        },
      ),
    ).toEqual({ valid: true });

    const revoke = {
      contract: "workspace.invite-revoke@1",
      commandId: "2a2e9e5e-bf3f-4f29-8f37-03ed6bb08002",
      workspaceId,
      actor: { kind: "punk", punkId: ownerId },
      payload: { invitationId, expectedRevision: 7 },
    };
    expect(
      validateContract(
        "punks://contracts/workspace.invite-revoke@1" as never,
        revoke,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/workspace.invite-revoke-response@1" as never,
        {
          contract: "workspace.invite-revoke-response@1",
          invitation: {
            ...validInvitation(),
            status: "revoked",
            revokedAt: "2026-08-26T10:00:00.000Z",
          },
          replayed: false,
        },
      ),
    ).toEqual({ valid: true });

    const claim = {
      contract: "workspace.invite-claim@1",
      commandId: "2a2e9e5e-bf3f-4f29-8f37-03ed6bb08003",
      workspaceId,
      actor: {
        kind: "punk",
        punkId: "00000000-0000-8000-8000-000000000002",
      },
      payload: { code, expectedRevision: 7 },
    };
    expect(
      validateContract(
        "punks://contracts/workspace.invite-claim@1" as never,
        claim,
      ),
    ).toEqual({ valid: true });
    for (const result of ["joined", "already_member"]) {
      expect(
        validateContract(
          "punks://contracts/workspace.invite-claim-response@1" as never,
          {
            contract: "workspace.invite-claim-response@1",
            result,
            workspace: {
              id: workspaceId,
              slug: "core-team",
              name: "Core Team",
              visibility: "private",
              role: "member",
              revision: 8,
            },
            replayed: false,
          },
        ).valid,
        result,
      ).toBe(true);
    }
  });

  it("keeps invitation failures inside the closed Punks problem union", () => {
    for (const code of [
      "invite_invalid",
      "invite_expired",
      "invite_exhausted",
      "invite_revoked",
      "invite_role_forbidden",
    ]) {
      expect(
        validateContract("punks://contracts/problem@1", {
          type: `https://punks.bot/problems/${code.replaceAll("_", "-")}`,
          title: "Invitation cannot be used",
          status: 409,
          code,
          correlationId: "test-correlation",
          retry: "never",
        }).valid,
        code,
      ).toBe(true);
    }
  });

  it("paginates the authoritative roster without embedding it in Workspace detail", () => {
    const summary = {
      contract: "workspace.governance-view@1",
      id: workspaceId,
      slug: "core-team",
      name: "Core Team",
      visibility: "private",
      status: "active",
      ownerPunkId: ownerId,
      memberCount: 101,
      revision: 7,
      cursor: 7,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    };
    const query = {
      contract: "workspace.governance@1",
      workspaceId,
      limit: 100,
      cursor: null,
    };
    expect(
      validateContract(
        "punks://contracts/workspace.governance@1" as never,
        query,
      ),
    ).toEqual({ valid: true });
    const page = {
      contract: "workspace.governance-response@1",
      workspace: summary,
      members: Array.from({ length: 100 }, (_, index) => ({
        punkId: `00000000-0000-8000-8000-${String(index + 1).padStart(12, "0")}`,
        role: index === 0 ? "owner" : "member",
      })),
      nextCursor: `pmc1.${"A".repeat(16)}.${"A".repeat(43)}`,
    };
    expect(
      validateContract(
        "punks://contracts/workspace.governance-response@1" as never,
        page,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/workspace.governance-response@1" as never,
        { ...page, members: [...page.members, page.members[0]] },
      ).valid,
    ).toBe(false);
    expect(page.workspace).not.toHaveProperty("members");
  });

  it("closes Workspace role mutation acknowledgements to bounded deltas", () => {
    expect(
      validateContract(
        "punks://contracts/workspace.membership-mutation-response@1" as never,
        {
          contract: "workspace.membership-mutation-response@1",
          workspace: {
            contract: "workspace.governance-view@1",
            id: workspaceId,
            slug: "core-team",
            name: "Core Team",
            visibility: "private",
            status: "active",
            ownerPunkId: ownerId,
            memberCount: 1,
            revision: 7,
            cursor: 7,
            createdAt: "2026-08-25T10:00:00.000Z",
            updatedAt: "2026-08-25T10:00:00.000Z",
          },
          memberDeltas: [{ punkId: ownerId, present: true, role: "owner" }],
          replayed: false,
        },
      ),
    ).toEqual({ valid: true });
  });
});
