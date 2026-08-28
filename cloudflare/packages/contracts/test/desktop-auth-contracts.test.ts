import { describe, expect, it } from "vitest";

import registry from "../registry.json";
import { validateContract } from "../src/registry";

const IDS = [
  "desktop-auth.start@1",
  "desktop-auth.status@1",
  "desktop-auth.claim@1",
  "desktop-auth.confirm@1",
  "desktop-auth.cancel@1",
  "desktop-session.renew@1",
  "desktop-session.revoke@1",
] as const;

const UUID = "00000000-0000-8000-8000-000000000054";
const COMMITMENT = "A".repeat(43);
const VERIFIER = "B".repeat(43);

describe("desktop authentication contracts (issue #54)", () => {
  it("replaces the legacy one-shot handoff with exactly seven generated contracts", () => {
    const ids = registry.contracts.map(({ id }) => id);
    for (const id of IDS) {
      expect(ids).toContain(`punks://contracts/${id}`);
    }
    expect(ids).not.toContain("punks://contracts/auth.desktop-start@1");
    expect(ids).not.toContain(
      "punks://contracts/auth.desktop-start-response@1",
    );
    expect(ids).not.toContain("punks://contracts/auth.desktop-delivery@1");
    expect(ids).not.toContain("punks://contracts/auth.passkey-options@1");
    expect(ids).not.toContain("punks://contracts/auth.passkey-finish@1");
    expect(ids).not.toContain(
      "punks://contracts/auth.desktop-session-response@1",
    );
  });

  it("closes start around native commitment and server-selected browser URL", () => {
    const contract = "punks://contracts/desktop-auth.start@1" as const;
    expect(
      validateContract(contract as never, {
        contract: "desktop-auth.start@1",
        message: "request",
        intent: "sign_in",
        method: "google",
        verifierCommitment: COMMITMENT,
      }).valid,
    ).toBe(true);
    expect(
      validateContract(contract as never, {
        contract: "desktop-auth.start@1",
        message: "response",
        flowId: UUID,
        phase: "started",
        intent: "sign_in",
        method: "google",
        browserUrl:
          "https://staging.punks.bot/api/auth/v1/desktop/browser?flow=00000000-0000-8000-8000-000000000054",
        createdAt: "2026-08-25T12:00:00.000Z",
        expiresAt: "2026-08-25T12:10:00.000Z",
      }).valid,
    ).toBe(true);
    expect(
      validateContract(contract as never, {
        contract: "desktop-auth.start@1",
        message: "request",
        intent: "merge",
        method: "google",
        verifierCommitment: COMMITMENT,
      }).valid,
    ).toBe(false);

    expect(
      validateContract(contract as never, {
        contract: "desktop-auth.start@1",
        message: "request",
        intent: "reauthenticate",
        method: "google",
        verifierCommitment: COMMITMENT,
        purpose: "transfer_workspace_ownership",
        workspaceOwnershipTransfer: {
          workspaceId: UUID,
          targetPunkId: "00000000-0000-8000-8000-000000000065",
          expectedRevision: 7,
        },
      }).valid,
    ).toBe(true);
    expect(
      validateContract(contract as never, {
        contract: "desktop-auth.start@1",
        message: "request",
        intent: "reauthenticate",
        method: "google",
        verifierCommitment: COMMITMENT,
        purpose: "transfer_workspace_ownership",
      }).valid,
    ).toBe(true);
  });

  it("refuses retired passkey methods and registration purposes", () => {
    for (const retired of [
      { intent: "sign_in", method: "passkey" },
      { intent: "register_passkey", method: "passkey" },
      {
        intent: "reauthenticate",
        method: "google",
        purpose: "register_passkey",
      },
    ]) {
      expect(
        validateContract("punks://contracts/desktop-auth.start@1", {
          contract: "desktop-auth.start@1",
          message: "request",
          verifierCommitment: COMMITMENT,
          ...retired,
        }).valid,
      ).toBe(false);
    }
  });

  it("keeps verifier-bearing retry requests and all public results closed", () => {
    const samples: Array<[string, unknown, unknown]> = [
      [
        "desktop-auth.status@1",
        {
          contract: "desktop-auth.status@1",
          message: "request",
          flowId: UUID,
          verifierCommitment: COMMITMENT,
        },
        {
          contract: "desktop-auth.status@1",
          message: "response",
          flowId: UUID,
          phase: "ready",
          terminal: false,
          expiresAt: "2026-08-25T12:15:00.000Z",
          result: "success",
          outcomeCode: null,
          decision: {
            oldSessionUsable: false,
            revokePreparedSession: false,
            destroyWorkspaceContext: false,
            retrySameRequest: true,
            freshHumanActionRequired: false,
          },
        },
      ],
      [
        "desktop-auth.claim@1",
        {
          contract: "desktop-auth.claim@1",
          message: "request",
          deliveryKind: "request",
          flowId: UUID,
          verifier: VERIFIER,
        },
        {
          contract: "desktop-auth.claim@1",
          message: "response",
          flowId: UUID,
          phase: "delivering",
          deliveryKind: "session",
          deliveryId: UUID,
          session: {
            sessionId: UUID,
            punkId: UUID,
            authenticatedAt: "2026-08-25T12:00:00.000Z",
            expiresAt: "2026-09-24T12:00:00.000Z",
            recentReauthUntil: null,
            punk: { id: UUID, displayName: "Punk", avatarUrl: null },
          },
          revokeCapability: {
            token: "C".repeat(43),
            expiresAt: "2026-09-24T12:00:00.000Z",
          },
          deliveryExpiresAt: "2026-08-25T12:10:00.000Z",
        },
      ],
      [
        "desktop-auth.confirm@1",
        {
          contract: "desktop-auth.confirm@1",
          message: "request",
          flowId: UUID,
          verifier: VERIFIER,
          deliveryId: UUID,
        },
        {
          contract: "desktop-auth.confirm@1",
          message: "response",
          flowId: UUID,
          phase: "confirmed",
          sessionId: UUID,
          confirmedAt: "2026-08-25T12:00:00.000Z",
        },
      ],
      [
        "desktop-auth.cancel@1",
        {
          contract: "desktop-auth.cancel@1",
          message: "request",
          flowId: UUID,
          verifier: VERIFIER,
        },
        {
          contract: "desktop-auth.cancel@1",
          message: "response",
          flowId: UUID,
          phase: "cancelled",
          cancelledAt: "2026-08-25T12:00:00.000Z",
        },
      ],
      [
        "desktop-session.revoke@1",
        {
          contract: "desktop-session.revoke@1",
          message: "request",
          capability: "D".repeat(43),
        },
        {
          contract: "desktop-session.revoke@1",
          message: "response",
          revoked: true,
          expired: false,
        },
      ],
    ];
    for (const [name, request, response] of samples) {
      const contract = `punks://contracts/${name}`;
      expect(validateContract(contract as never, request).valid, name).toBe(
        true,
      );
      expect(validateContract(contract as never, response).valid, name).toBe(
        true,
      );
      expect(
        validateContract(contract as never, {
          ...(request as Record<string, unknown>),
          unknown: true,
        }).valid,
        name,
      ).toBe(false);
    }
  });

  it("models renewal as an idempotent prepare/confirm rotation", () => {
    const contract = "punks://contracts/desktop-session.renew@1";
    const messages = [
      {
        contract: "desktop-session.renew@1",
        message: "request",
        action: "prepare",
        commandId: UUID,
      },
      {
        contract: "desktop-session.renew@1",
        message: "response",
        action: "prepared",
        commandId: UUID,
        rotationId: UUID,
        session: {
          sessionId: UUID,
          punkId: UUID,
          authenticatedAt: "2026-08-25T12:00:00.000Z",
          expiresAt: "2026-09-24T12:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: UUID, displayName: "Punk", avatarUrl: null },
        },
        revokeCapability: {
          token: "E".repeat(43),
          expiresAt: "2026-09-24T12:00:00.000Z",
        },
        confirmBy: "2026-08-25T12:10:00.000Z",
      },
      {
        contract: "desktop-session.renew@1",
        message: "request",
        action: "confirm",
        commandId: UUID,
        rotationId: UUID,
      },
      {
        contract: "desktop-session.renew@1",
        message: "response",
        action: "confirmed",
        commandId: UUID,
        rotationId: UUID,
        sessionId: UUID,
        confirmedAt: "2026-08-25T12:00:00.000Z",
      },
    ];
    for (const message of messages) {
      expect(validateContract(contract as never, message).valid).toBe(true);
    }
  });
});
