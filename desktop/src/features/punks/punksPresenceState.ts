import type {
  DesktopPresenceDelivery,
  PresenceTypingPatch,
  PresenceView,
} from "@punks/contracts";

export type PresenceMap = ReadonlyMap<string, PresenceView>;
export type TypingMap = ReadonlyMap<string, PresenceTypingPatch>;

export interface PresenceSignalState {
  visible: PresenceMap;
  latest: PresenceMap;
}

export interface TypingSignalState {
  visible: TypingMap;
  latest: TypingMap;
}

export type SignalReduction<T> = {
  kind: "applied" | "ignored" | "violation";
  state: T;
};

function newerThan(
  candidate: { leaseGeneration: number; sequence: number },
  current: { leaseGeneration: number; sequence: number },
): -1 | 0 | 1 {
  if (candidate.leaseGeneration !== current.leaseGeneration) {
    return candidate.leaseGeneration > current.leaseGeneration ? 1 : -1;
  }
  if (candidate.sequence === current.sequence) return 0;
  return candidate.sequence > current.sequence ? 1 : -1;
}

function sameSignal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function emptyPresenceSignalState(): PresenceSignalState {
  return { visible: new Map(), latest: new Map() };
}

export function emptyTypingSignalState(): TypingSignalState {
  return { visible: new Map(), latest: new Map() };
}

export function applyPresenceDelivery(
  current: PresenceSignalState,
  delivery: DesktopPresenceDelivery,
  generation: number,
): SignalReduction<PresenceSignalState> {
  if (delivery.kind === "realtime_degraded") {
    return { kind: "applied", state: emptyPresenceSignalState() };
  }
  if (delivery.kind === "accepted") {
    if (delivery.clientGeneration !== generation) {
      return { kind: "violation", state: current };
    }
    const next = new Map<string, PresenceView>();
    for (const presence of delivery.presences) {
      if (presence.state === "offline" || next.has(presence.punkId)) {
        return { kind: "violation", state: current };
      }
      next.set(presence.punkId, presence);
    }
    return {
      kind: "applied",
      state: { visible: next, latest: new Map(next) },
    };
  }

  const candidate = delivery.presence;
  const existing = current.latest.get(candidate.punkId);
  if (existing !== undefined) {
    const order = newerThan(candidate, existing);
    if (order < 0) return { kind: "ignored", state: current };
    if (order === 0) {
      return {
        kind: sameSignal(candidate, existing) ? "ignored" : "violation",
        state: current,
      };
    }
  }
  const visible = new Map(current.visible);
  if (candidate.state === "offline") visible.delete(candidate.punkId);
  else visible.set(candidate.punkId, candidate);
  const latest = new Map(current.latest);
  latest.set(candidate.punkId, candidate);
  return { kind: "applied", state: { visible, latest } };
}

export function typingKey(patch: PresenceTypingPatch): string {
  return `${patch.conversationId}:${patch.punkId}`;
}

export function applyTypingPatch(
  current: TypingSignalState,
  patch: PresenceTypingPatch,
  workspaceId: string,
): SignalReduction<TypingSignalState> {
  if (patch.workspaceId !== workspaceId) {
    return { kind: "violation", state: current };
  }
  const key = typingKey(patch);
  const existing = current.latest.get(key);
  if (existing !== undefined) {
    const order = newerThan(patch, existing);
    if (order < 0) return { kind: "ignored", state: current };
    if (order === 0) {
      return {
        kind: sameSignal(patch, existing) ? "ignored" : "violation",
        state: current,
      };
    }
  }
  const visible = new Map(current.visible);
  if (patch.active) visible.set(key, patch);
  else visible.delete(key);
  const latest = new Map(current.latest);
  latest.set(key, patch);
  return { kind: "applied", state: { visible, latest } };
}

export function pruneExpiredSignals(
  presences: PresenceSignalState,
  typing: TypingSignalState,
  now = Date.now(),
): { presences: PresenceSignalState; typing: TypingSignalState } {
  const nextPresences = new Map(
    [...presences.visible].filter(([, presence]) => {
      const expiresAt = Date.parse(presence.expiresAt ?? "");
      return Number.isFinite(expiresAt) && expiresAt > now;
    }),
  );
  const nextTyping = new Map(
    [...typing.visible].filter(([, patch]) => {
      const expiresAt = Date.parse(patch.expiresAt ?? "");
      return patch.active && Number.isFinite(expiresAt) && expiresAt > now;
    }),
  );
  return {
    presences: { visible: nextPresences, latest: presences.latest },
    typing: { visible: nextTyping, latest: typing.latest },
  };
}
