import type {
  ConversationFollowClientFrame,
  ConversationFollowServerFrame,
} from "@punks/contracts";

type ChangesFrame = Extract<ConversationFollowServerFrame, { type: "changes" }>;
type TypingFrame = Extract<ConversationFollowServerFrame, { type: "typing" }>;

export type FollowPhase =
  | "awaiting_acceptance"
  | "catching_up"
  | "live"
  | "resync_required"
  | "terminal";

/** Monotone local authority for one Conversation FOLLOW generation. */
export type FollowState = {
  phase: FollowPhase;
  paginationHighWater: number;
  followCheckpoint: number;
  appliedCursor: number;
  targetHighWaterCursor: number | null;
  pendingConfirmationCursor: number | null;
  lastBatchSignature: string | null;
};

export type FollowEffect =
  | { kind: "none" }
  | { kind: "apply_batch"; frame: ChangesFrame }
  | { kind: "typing"; patch: TypingFrame["patch"] }
  | { kind: "became_live" }
  | {
      kind: "resync";
      reason:
        | "cursor_gap"
        | "cursor_divergence"
        | "protocol_violation"
        | "history_required"
        | "slow_consumer";
      afterCursor: number;
      highWaterCursor: number;
    }
  | { kind: "terminal"; reason: "archived"; cursor: number };

export type FollowReduction = {
  state: FollowState;
  effect: FollowEffect;
};

export type FollowConfirmation = {
  state: FollowState;
  ack: ConversationFollowClientFrame | null;
};

export function createFollowState(paginationHighWater: number): FollowState {
  return {
    phase: "awaiting_acceptance",
    paginationHighWater,
    followCheckpoint: paginationHighWater,
    appliedCursor: paginationHighWater,
    targetHighWaterCursor: null,
    pendingConfirmationCursor: null,
    lastBatchSignature: null,
  };
}

function resync(
  state: FollowState,
  reason: Extract<FollowEffect, { kind: "resync" }>["reason"],
  highWaterCursor = state.appliedCursor,
): FollowReduction {
  const next = { ...state, phase: "resync_required" as const };
  return {
    state: next,
    effect: {
      kind: "resync",
      reason,
      afterCursor: state.followCheckpoint,
      highWaterCursor,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nestedCursorsAreBounded(frame: ChangesFrame): boolean {
  return (
    frame.messages.every((message) => message.cursor <= frame.throughCursor) &&
    frame.threadPatches.every((patch) => patch.cursor <= frame.throughCursor) &&
    frame.reactionPatches.every(
      (patch) => patch.cursor <= frame.throughCursor,
    ) &&
    frame.reactionCollectionPatches.every(
      (patch) => patch.cursor <= frame.throughCursor,
    )
  );
}

/**
 * Reduces one already schema-validated server frame. A `changes` frame is
 * emitted as one indivisible renderer effect and never acknowledged here.
 */
export function reduceFollowFrame(
  state: FollowState,
  frame: ConversationFollowServerFrame,
): FollowReduction {
  if (state.phase === "resync_required" || state.phase === "terminal") {
    return { state, effect: { kind: "none" } };
  }

  if (frame.type === "resync-required") {
    return resync(state, frame.reason, frame.highWaterCursor);
  }
  if (frame.type === "conversation-unavailable") {
    return {
      state: { ...state, phase: "terminal" },
      effect: { kind: "terminal", reason: frame.reason, cursor: frame.cursor },
    };
  }
  if (frame.type === "accepted") {
    if (
      state.phase !== "awaiting_acceptance" ||
      frame.resumeAfterCursor !== state.appliedCursor ||
      frame.targetHighWaterCursor < frame.resumeAfterCursor
    ) {
      return resync(state, "protocol_violation", frame.targetHighWaterCursor);
    }
    return {
      state: {
        ...state,
        phase: "catching_up",
        targetHighWaterCursor: frame.targetHighWaterCursor,
      },
      effect: { kind: "none" },
    };
  }
  if (frame.type === "ready") {
    if (
      state.phase !== "catching_up" ||
      state.pendingConfirmationCursor !== null ||
      frame.highWaterCursor !== state.targetHighWaterCursor ||
      frame.highWaterCursor !== state.appliedCursor
    ) {
      return resync(state, "protocol_violation", frame.highWaterCursor);
    }
    return {
      state: { ...state, phase: "live" },
      effect: { kind: "became_live" },
    };
  }
  if (frame.type === "typing") {
    return { state, effect: { kind: "typing", patch: frame.patch } };
  }

  if (state.phase !== "catching_up" && state.phase !== "live") {
    return resync(state, "protocol_violation", frame.throughCursor);
  }
  const signature = canonical(frame);
  if (signature === state.lastBatchSignature) {
    return { state, effect: { kind: "none" } };
  }
  if (
    state.pendingConfirmationCursor !== null ||
    frame.fromExclusiveCursor < state.appliedCursor
  ) {
    return resync(state, "cursor_divergence", frame.throughCursor);
  }
  if (frame.fromExclusiveCursor > state.appliedCursor) {
    return resync(state, "cursor_gap", frame.throughCursor);
  }
  if (
    frame.throughCursor <= frame.fromExclusiveCursor ||
    !nestedCursorsAreBounded(frame) ||
    (state.phase === "catching_up" &&
      state.targetHighWaterCursor !== null &&
      frame.throughCursor > state.targetHighWaterCursor)
  ) {
    return resync(state, "protocol_violation", frame.throughCursor);
  }
  return {
    state: {
      ...state,
      appliedCursor: frame.throughCursor,
      pendingConfirmationCursor: frame.throughCursor,
      lastBatchSignature: signature,
    },
    effect: { kind: "apply_batch", frame },
  };
}

/** Produces the ACK only after the renderer confirms the exact atomic batch. */
export function confirmFollowBatch(
  state: FollowState,
  throughCursor: number,
): FollowConfirmation {
  if (
    state.pendingConfirmationCursor !== throughCursor ||
    state.appliedCursor !== throughCursor
  ) {
    return {
      state: { ...state, phase: "resync_required" },
      ack: null,
    };
  }
  return {
    state: {
      ...state,
      followCheckpoint: throughCursor,
      pendingConfirmationCursor: null,
    },
    ack: { schemaVersion: 1, type: "ack", throughCursor },
  };
}
