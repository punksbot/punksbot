import type { ConversationFollowServerFrame } from "@punks/contracts";
import { describe, expect, it } from "vitest";

import corpusJson from "../../contracts/conformance/desktop-social-loop-follow.json";

import {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
  type FollowEffect,
  type FollowState,
} from "../src/follow-reducer";

type Expected = {
  phase: FollowState["phase"];
  effect: string;
  appliedCursor: number;
  followCheckpoint: number;
  pendingConfirmationCursor: number | null;
};

type Step =
  | {
      operation: "frame";
      frame: ConversationFollowServerFrame;
      expected: Expected;
    }
  | { operation: "confirm"; throughCursor: number; expected: Expected };

type Corpus = {
  profile: "desktop-social-loop@1";
  operation: "followConversation";
  traces: Array<{
    name: string;
    initialPaginationHighWater: number;
    steps: Step[];
  }>;
};

const corpus = corpusJson as unknown as Corpus;

function effectTrace(effect: FollowEffect): string {
  return effect.kind === "resync"
    ? `${effect.kind}:${effect.reason}`
    : effect.kind;
}

describe("desktop-social-loop@1 common FOLLOW corpus", () => {
  for (const trace of corpus.traces) {
    it(trace.name, () => {
      let state = createFollowState(trace.initialPaginationHighWater);
      for (const step of trace.steps) {
        let effect: string;
        if (step.operation === "frame") {
          const reduction = reduceFollowFrame(state, step.frame);
          state = reduction.state;
          effect = effectTrace(reduction.effect);
        } else {
          const confirmation = confirmFollowBatch(state, step.throughCursor);
          state = confirmation.state;
          effect = confirmation.ack === null ? "none" : "ack";
        }
        expect({
          phase: state.phase,
          effect,
          appliedCursor: state.appliedCursor,
          followCheckpoint: state.followCheckpoint,
          pendingConfirmationCursor: state.pendingConfirmationCursor,
        }).toEqual(step.expected);
      }
    });
  }
});
