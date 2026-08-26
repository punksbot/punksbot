import type { ConversationFollowServerFrame } from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
} from "../src/follow-reducer";

const accepted: ConversationFollowServerFrame = {
  schemaVersion: 1,
  type: "accepted",
  resumeAfterCursor: 4,
  targetHighWaterCursor: 6,
};

const changes: ConversationFollowServerFrame = {
  schemaVersion: 1,
  type: "changes",
  fromExclusiveCursor: 4,
  throughCursor: 6,
  messages: [],
  threadPatches: [],
  reactionPatches: [],
  reactionCollectionPatches: [],
};

describe("FOLLOW reducer", () => {
  it("keeps an ephemeral typing signal outside durable cursor state", () => {
    const state = reduceFollowFrame(createFollowState(4), accepted).state;
    const reduction = reduceFollowFrame(state, {
      schemaVersion: 1,
      type: "typing",
      patch: {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        conversationId: "33333333-3333-4333-8333-333333333333",
        punkId: "11111111-1111-4111-8111-111111111111",
        active: true,
        leaseGeneration: 7,
        sequence: 3,
        expiresAt: "2026-08-26T10:00:05.000Z",
      },
    });

    expect(reduction).toEqual({
      state,
      effect: {
        kind: "typing",
        patch: {
          workspaceId: "22222222-2222-4222-8222-222222222222",
          conversationId: "33333333-3333-4333-8333-333333333333",
          punkId: "11111111-1111-4111-8111-111111111111",
          active: true,
          leaseGeneration: 7,
          sequence: 3,
          expiresAt: "2026-08-26T10:00:05.000Z",
        },
      },
    });
  });

  it("does not expose an ACK until the renderer confirms one atomic batch", () => {
    const opened = reduceFollowFrame(createFollowState(4), accepted);
    const delivery = reduceFollowFrame(opened.state, changes);

    expect(delivery.effect).toEqual({ kind: "apply_batch", frame: changes });
    expect(delivery.state.appliedCursor).toBe(6);
    expect(delivery.state.followCheckpoint).toBe(4);
    expect(delivery.state.pendingConfirmationCursor).toBe(6);

    const confirmed = confirmFollowBatch(delivery.state, 6);
    expect(confirmed.ack).toEqual({
      schemaVersion: 1,
      type: "ack",
      throughCursor: 6,
    });
    expect(confirmed.state.followCheckpoint).toBe(6);
    expect(confirmed.state.pendingConfirmationCursor).toBeNull();
  });

  it("ignores an exact duplicate but resyncs for a gap or divergence", () => {
    const opened = reduceFollowFrame(createFollowState(4), accepted);
    const delivery = reduceFollowFrame(opened.state, changes);
    const duplicate = reduceFollowFrame(
      delivery.state,
      structuredClone(changes),
    );
    expect(duplicate.effect).toEqual({ kind: "none" });

    const confirmed = confirmFollowBatch(delivery.state, 6);
    const gap = reduceFollowFrame(confirmed.state, {
      ...changes,
      fromExclusiveCursor: 7,
      throughCursor: 8,
    });
    expect(gap.state.phase).toBe("resync_required");
    expect(gap.effect).toMatchObject({ kind: "resync", reason: "cursor_gap" });

    const divergent = reduceFollowFrame(confirmed.state, {
      ...changes,
      fromExclusiveCursor: 4,
      throughCursor: 7,
    });
    expect(divergent.state.phase).toBe("resync_required");
    expect(divergent.effect).toMatchObject({
      kind: "resync",
      reason: "cursor_divergence",
    });
  });

  it("becomes live only after the accepted high-water is fully applied", () => {
    const opened = reduceFollowFrame(createFollowState(4), accepted);
    const premature = reduceFollowFrame(opened.state, {
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 6,
    });
    expect(premature.state.phase).toBe("resync_required");

    const delivered = reduceFollowFrame(opened.state, changes);
    const confirmed = confirmFollowBatch(delivered.state, 6);
    const ready = reduceFollowFrame(confirmed.state, {
      schemaVersion: 1,
      type: "ready",
      highWaterCursor: 6,
    });
    expect(ready.state.phase).toBe("live");
    expect(ready.effect).toEqual({ kind: "became_live" });
  });

  it("maps server resync and terminal frames without exposing partial data", () => {
    const opened = reduceFollowFrame(createFollowState(4), accepted);
    const resync = reduceFollowFrame(opened.state, {
      schemaVersion: 1,
      type: "resync-required",
      reason: "slow_consumer",
      afterCursor: 4,
      highWaterCursor: 10,
    });
    expect(resync.state.phase).toBe("resync_required");
    expect(resync.effect).toEqual({
      kind: "resync",
      reason: "slow_consumer",
      afterCursor: 4,
      highWaterCursor: 10,
    });

    const terminal = reduceFollowFrame(opened.state, {
      schemaVersion: 1,
      type: "conversation-unavailable",
      reason: "archived",
      cursor: 7,
    });
    expect(terminal.state.phase).toBe("terminal");
    expect(terminal.effect).toEqual({
      kind: "terminal",
      reason: "archived",
      cursor: 7,
    });
  });
});
