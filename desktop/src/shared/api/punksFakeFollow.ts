import {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
  type FollowState,
} from "@punks/client/follow-reducer";
import type {
  ConversationFollowServerFrame,
  ConversationSummary,
  MessageView,
} from "@punks/contracts";

import { PunksDesktopFailure } from "./punksFailure";
import type { PunksFollow } from "./punksClientTypes";

/** Deterministic fake of the exact cursor/ACK protocol used by Rust. */
export function createFakeFollow(input: {
  conversationId: string;
  afterCursor: number;
  streams: readonly ConversationSummary[];
  messages: readonly MessageView[];
  configuredFrames?: readonly ConversationFollowServerFrame[];
  assertCurrent(): void;
}): PunksFollow {
  input.assertCurrent();
  const stream = input.streams.find(
    (candidate) => candidate.id === input.conversationId,
  );
  if (stream === undefined) {
    throw new PunksDesktopFailure("problem", "Stream is not accessible");
  }
  const highWaterCursor = Math.max(
    input.afterCursor,
    stream.cursor,
    input.messages.at(-1)?.cursor ?? 0,
  );
  const pendingMessages = input.messages
    .filter(
      (message) =>
        message.cursor > input.afterCursor && message.cursor <= highWaterCursor,
    )
    .sort((left, right) => left.cursor - right.cursor);
  const defaultChanges: ConversationFollowServerFrame[] = [];
  let changesFrom = input.afterCursor;
  for (let index = 0; index < pendingMessages.length; index += 100) {
    const messages = pendingMessages.slice(index, index + 100);
    const throughCursor = messages.at(-1)?.cursor ?? changesFrom;
    if (throughCursor <= changesFrom) continue;
    defaultChanges.push({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: changesFrom,
      throughCursor,
      messages,
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [],
    });
    changesFrom = throughCursor;
  }
  if (changesFrom < highWaterCursor) {
    defaultChanges.push({
      schemaVersion: 1,
      type: "changes",
      fromExclusiveCursor: changesFrom,
      throughCursor: highWaterCursor,
      messages: [],
      threadPatches: [],
      reactionPatches: [],
      reactionCollectionPatches: [],
    });
  }
  const frames: ConversationFollowServerFrame[] = structuredClone([
    ...(input.configuredFrames ?? [
      {
        schemaVersion: 1 as const,
        type: "accepted" as const,
        resumeAfterCursor: input.afterCursor,
        targetHighWaterCursor: highWaterCursor,
      },
      ...defaultChanges,
      {
        schemaVersion: 1 as const,
        type: "ready" as const,
        highWaterCursor,
      },
    ]),
  ]);
  let state: FollowState = createFollowState(input.afterCursor);
  let closed = false;
  return {
    async nextDelivery() {
      input.assertCurrent();
      if (closed) {
        throw new PunksDesktopFailure(
          "cancelled",
          "Punks FOLLOW operation is closed",
        );
      }
      while (frames.length > 0) {
        const frame = frames.shift();
        if (frame === undefined) break;
        const reduction = reduceFollowFrame(state, frame);
        state = reduction.state;
        input.assertCurrent();
        if (reduction.effect.kind === "none") continue;
        if (reduction.effect.kind === "apply_batch") {
          return { kind: "apply_batch", frame: reduction.effect.frame };
        }
        if (reduction.effect.kind === "became_live") {
          return { kind: "became_live" };
        }
        if (reduction.effect.kind === "typing") {
          return { kind: "typing", patch: reduction.effect.patch };
        }
        if (reduction.effect.kind === "resync") {
          return {
            kind: "resync",
            reason: reduction.effect.reason,
            afterCursor: reduction.effect.afterCursor,
            highWaterCursor: reduction.effect.highWaterCursor,
          };
        }
        return {
          kind: "terminal",
          reason: reduction.effect.reason,
          cursor: reduction.effect.cursor,
        };
      }
      throw new PunksDesktopFailure(
        "transport",
        "Punks FOLLOW fixture has no more frames",
      );
    },
    async confirmBatch(throughCursor) {
      input.assertCurrent();
      const confirmation = confirmFollowBatch(state, throughCursor);
      state = confirmation.state;
      if (confirmation.ack === null) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Punks FOLLOW confirmation is invalid",
        );
      }
    },
    async close() {
      closed = true;
    },
  };
}
