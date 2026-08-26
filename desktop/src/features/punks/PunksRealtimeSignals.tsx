import { createContext, useContext } from "react";

import type { PresenceTypingPatch, PresenceView } from "@punks/contracts";

export type PunksRealtimeStatus =
  | "unavailable"
  | "connecting"
  | "live"
  | "degraded";

export interface PunksRealtimeSignalsValue {
  status: PunksRealtimeStatus;
  presences: ReadonlyMap<string, PresenceView>;
  typing: ReadonlyMap<string, PresenceTypingPatch>;
  setStatus(status: string | null): Promise<void>;
  signalTyping(conversationId: string, active: boolean): Promise<void>;
  applyTypingPatch(patch: PresenceTypingPatch): void;
}

const EMPTY_SIGNALS: PunksRealtimeSignalsValue = {
  status: "unavailable",
  presences: new Map(),
  typing: new Map(),
  setStatus: () => Promise.resolve(),
  signalTyping: () => Promise.resolve(),
  applyTypingPatch: () => undefined,
};

export const PunksRealtimeSignalsContext =
  createContext<PunksRealtimeSignalsValue>(EMPTY_SIGNALS);

export function usePunksRealtimeSignals(): PunksRealtimeSignalsValue {
  return useContext(PunksRealtimeSignalsContext);
}
