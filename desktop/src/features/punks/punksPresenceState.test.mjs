import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPresenceDelivery,
  applyTypingPatch,
  emptyPresenceSignalState,
  emptyTypingSignalState,
  pruneExpiredSignals,
} from "./punksPresenceState.ts";

const workspaceId = "00000000-0000-8000-8000-000000000001";
const conversationId = "00000000-0000-8000-8000-000000000002";
const punkId = "00000000-0000-8000-8000-000000000003";

test("Presence replaces atomically then rejects stale lease generations", () => {
  const accepted = applyPresenceDelivery(
    emptyPresenceSignalState(),
    {
      kind: "accepted",
      clientGeneration: 4,
      leaseGeneration: 1,
      heartbeatIntervalMs: 15_000,
      awayAfterMs: 30_000,
      expiresAfterMs: 60_000,
      presences: [
        {
          punkId,
          state: "online",
          status: null,
          leaseGeneration: 2,
          sequence: 3,
          expiresAt: "2032-01-01T00:01:00.000Z",
        },
      ],
    },
    4,
  );
  assert.equal(accepted.kind, "applied");
  assert.equal(accepted.state.visible.get(punkId)?.state, "online");

  const stale = applyPresenceDelivery(
    accepted.state,
    {
      kind: "presence",
      presence: {
        punkId,
        state: "away",
        status: "stale",
        leaseGeneration: 1,
        sequence: 99,
        expiresAt: "2032-01-01T00:02:00.000Z",
      },
    },
    4,
  );
  assert.equal(stale.kind, "ignored");
  assert.equal(stale.state.visible.get(punkId)?.state, "online");

  const offline = applyPresenceDelivery(
    stale.state,
    {
      kind: "presence",
      presence: {
        punkId,
        state: "offline",
        status: null,
        leaseGeneration: 2,
        sequence: 4,
        expiresAt: null,
      },
    },
    4,
  );
  assert.equal(offline.kind, "applied");
  assert.equal(offline.state.visible.has(punkId), false);

  const delayedOnline = applyPresenceDelivery(
    offline.state,
    {
      kind: "presence",
      presence: {
        punkId,
        state: "online",
        status: "delayed",
        leaseGeneration: 2,
        sequence: 3,
        expiresAt: "2032-01-01T00:03:00.000Z",
      },
    },
    4,
  );
  assert.equal(delayedOnline.kind, "ignored");
  assert.equal(delayedOnline.state.visible.has(punkId), false);
});

test("typing is scoped, monotone and expires locally without replay", () => {
  const active = applyTypingPatch(
    emptyTypingSignalState(),
    {
      workspaceId,
      conversationId,
      punkId,
      active: true,
      leaseGeneration: 2,
      sequence: 3,
      expiresAt: "2032-01-01T00:00:05.000Z",
    },
    workspaceId,
  );
  assert.equal(active.kind, "applied");
  assert.equal(active.state.visible.size, 1);

  const stale = applyTypingPatch(
    active.state,
    {
      workspaceId,
      conversationId,
      punkId,
      active: true,
      leaseGeneration: 1,
      sequence: 99,
      expiresAt: "2032-01-01T00:00:10.000Z",
    },
    workspaceId,
  );
  assert.equal(stale.kind, "ignored");
  assert.equal(stale.state.visible.size, 1);

  const expired = pruneExpiredSignals(
    emptyPresenceSignalState(),
    stale.state,
    Date.parse("2032-01-01T00:00:06.000Z"),
  );
  assert.equal(expired.typing.visible.size, 0);

  const stopped = applyTypingPatch(
    active.state,
    {
      workspaceId,
      conversationId,
      punkId,
      active: false,
      leaseGeneration: 2,
      sequence: 4,
      expiresAt: null,
    },
    workspaceId,
  );
  assert.equal(stopped.kind, "applied");
  assert.equal(stopped.state.visible.size, 0);
  const delayed = applyTypingPatch(
    stopped.state,
    {
      workspaceId,
      conversationId,
      punkId,
      active: true,
      leaseGeneration: 2,
      sequence: 3,
      expiresAt: "2032-01-01T00:00:10.000Z",
    },
    workspaceId,
  );
  assert.equal(delayed.kind, "ignored");
  assert.equal(delayed.state.visible.size, 0);
});
