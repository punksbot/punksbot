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

  it("closes Workspace role mutation acknowledgements", () => {
    expect(
      validateContract(
        "punks://contracts/workspace.membership-mutation-response@1" as never,
        {
          contract: "workspace.membership-mutation-response@1",
          workspace: {
            id: workspaceId,
            slug: "core-team",
            name: "Core Team",
            visibility: "private",
            status: "active",
            ownerPunkId: ownerId,
            members: [{ punkId: ownerId, role: "owner" }],
            revision: 7,
            cursor: 7,
            createdAt: "2026-08-25T10:00:00.000Z",
            updatedAt: "2026-08-25T10:00:00.000Z",
          },
          replayed: false,
        },
      ),
    ).toEqual({ valid: true });
  });
});
