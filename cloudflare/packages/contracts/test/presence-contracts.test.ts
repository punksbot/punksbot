import { describe, expect, it } from "vitest";

import desktopProfile from "../profiles/desktop-social-loop@1.json";
import registry from "../registry.json";
import { validateDesktopContract } from "../src/desktop";
import { validateContract } from "../src/registry";

const workspaceId = "00000000-0000-8000-8000-000000000001";
const conversationId = "00000000-0000-8000-8000-000000000002";
const punkId = "00000000-0000-8000-8000-000000000003";
const deviceId = "00000000-0000-8000-8000-000000000004";
const holdId = "00000000-0000-8000-8000-000000000005";
const leaseToken = `pls1.${"A".repeat(43)}`;
const generationTargets = ["typescript", "rust", "dart", "openapi"];

function valid(contract: string, value: unknown): boolean {
  return validateContract(contract as never, value).valid;
}

describe("ephemeral Punks Presence contracts", () => {
  it("registers the closed cross-SDK surface without activating T8", () => {
    const ids = [
      "punks://contracts/presence.hold@1",
      "punks://contracts/presence.status.set@1",
      "punks://contracts/presence.typing.signal@1",
      "punks://contracts/presence.view@1",
      "punks://contracts/presence.hold-server-frame@1",
      "punks://contracts/presence.typing.patch@1",
      "punks://contracts/desktop.presence-delivery@1",
    ];
    const entries = registry.contracts.filter(({ id }) =>
      ids.includes(id),
    ) as Array<{ id: string; generationTargets?: string[] }>;

    expect(entries.map(({ id }) => id)).toEqual(ids);
    for (const entry of entries) {
      expect(entry.generationTargets, entry.id).toEqual(generationTargets);
    }
    expect(desktopProfile.capabilities).not.toContain("presence");
    expect(desktopProfile.unavailableCapabilities).toContain("presence");
    expect(desktopProfile.operations.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "holdPresence",
        "setPresenceStatus",
        "signalPresenceTyping",
      ]),
    );
  });

  it("closes hold and heartbeat around one short-lived opaque lease token", () => {
    expect(
      valid("punks://contracts/presence.hold@1", {
        contract: "presence.hold@1",
        type: "hold",
        workspaceId,
        deviceId,
        clientGeneration: 7,
        holdId,
      }),
    ).toBe(true);
    expect(
      valid("punks://contracts/presence.hold@1", {
        contract: "presence.hold@1",
        type: "heartbeat",
        leaseToken,
        sequence: 2,
      }),
    ).toBe(true);
    expect(
      valid("punks://contracts/presence.hold@1", {
        contract: "presence.hold@1",
        type: "heartbeat",
        leaseToken: "session-cookie-must-not-cross",
        sequence: 2,
      }),
    ).toBe(false);
  });

  it("bounds status and scopes loss-tolerant typing to one Conversation", () => {
    expect(
      valid("punks://contracts/presence.status.set@1", {
        contract: "presence.status.set@1",
        leaseToken,
        sequence: 3,
        status: "Reviewing the release",
      }),
    ).toBe(true);
    expect(
      valid("punks://contracts/presence.status.set@1", {
        contract: "presence.status.set@1",
        leaseToken,
        sequence: 4,
        status: "x".repeat(81),
      }),
    ).toBe(false);
    expect(
      valid("punks://contracts/presence.typing.signal@1", {
        contract: "presence.typing.signal@1",
        leaseToken,
        sequence: 5,
        workspaceId,
        conversationId,
        active: true,
      }),
    ).toBe(true);
    expect(
      valid("punks://contracts/presence.typing.signal@1", {
        contract: "presence.typing.signal@1",
        leaseToken,
        sequence: 5,
        workspaceId,
        active: true,
      }),
    ).toBe(false);
  });

  it("delivers only bounded public views and cursor-free typing patches", () => {
    const presence = {
      punkId,
      state: "online",
      status: "Reviewing the release",
      leaseGeneration: 9,
      sequence: 4,
      expiresAt: "2026-08-26T12:00:45.000Z",
    };
    expect(valid("punks://contracts/presence.view@1", presence)).toBe(true);
    expect(
      valid("punks://contracts/presence.hold-server-frame@1", {
        schemaVersion: 1,
        type: "accepted",
        leaseToken,
        leaseGeneration: 9,
        clientGeneration: 7,
        heartbeatIntervalMs: 15_000,
        awayAfterMs: 30_000,
        expiresAfterMs: 60_000,
        presences: [presence],
      }),
    ).toBe(true);
    const rendererDelivery = {
      kind: "accepted",
      clientGeneration: 7,
      leaseGeneration: 9,
      heartbeatIntervalMs: 15_000,
      awayAfterMs: 30_000,
      expiresAfterMs: 60_000,
      presences: [presence],
    };
    expect(
      valid("punks://contracts/desktop.presence-delivery@1", rendererDelivery),
    ).toBe(true);
    expect(
      validateDesktopContract(
        "punks://contracts/desktop.presence-delivery@1",
        rendererDelivery,
      ).valid,
    ).toBe(true);
    expect(
      valid("punks://contracts/desktop.presence-delivery@1", {
        ...rendererDelivery,
        leaseToken,
      }),
    ).toBe(false);

    const typingPatch = {
      workspaceId,
      conversationId,
      punkId,
      active: true,
      leaseGeneration: 9,
      sequence: 6,
      expiresAt: "2026-08-26T12:00:05.000Z",
    };
    expect(
      valid("punks://contracts/presence.typing.patch@1", typingPatch),
    ).toBe(true);
    expect(
      valid("punks://contracts/conversation.follow-server-frame@1", {
        schemaVersion: 1,
        type: "typing",
        patch: typingPatch,
      }),
    ).toBe(true);
    expect(
      valid("punks://contracts/conversation.follow-server-frame@1", {
        schemaVersion: 1,
        type: "typing",
        patch: { ...typingPatch, sessionId: "must-not-leak" },
      }),
    ).toBe(false);
  });
});
