import type {
  DesktopPresenceDelivery,
  PresenceTypingPatch,
  PresenceView,
} from "@punks/contracts";

export type PresenceMap = ReadonlyMap<string, PresenceView>;
export type TypingMap = ReadonlyMap<string, PresenceTypingPatch>;

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

export function applyPresenceDelivery(
  current: PresenceMap,
  delivery: DesktopPresenceDelivery,
  generation: number,
): SignalReduction<PresenceMap> {
  if (delivery.kind === "realtime_degraded") {
    return { kind: "applied", state: new Map() };
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
    return { kind: "applied", state: next };
  }

  const candidate = delivery.presence;
  const existing = current.get(candidate.punkId);
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
  const next = new Map(current);
  if (candidate.state === "offline") next.delete(candidate.punkId);
  else next.set(candidate.punkId, candidate);
  return { kind: "applied", state: next };
}

export function typingKey(patch: PresenceTypingPatch): string {
  return `${patch.conversationId}:${patch.punkId}`;
}

export function applyTypingPatch(
  current: TypingMap,
  patch: PresenceTypingPatch,
  workspaceId: string,
): SignalReduction<TypingMap> {
  if (patch.workspaceId !== workspaceId) {
    return { kind: "violation", state: current };
  }
  const key = typingKey(patch);
  const existing = current.get(key);
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
  const next = new Map(current);
  if (patch.active) next.set(key, patch);
  else next.delete(key);
  return { kind: "applied", state: next };
}

export function pruneExpiredSignals(
  presences: PresenceMap,
  typing: TypingMap,
  now = Date.now(),
): { presences: PresenceMap; typing: TypingMap } {
  const nextPresences = new Map(
    [...presences].filter(([, presence]) => {
      const expiresAt = Date.parse(presence.expiresAt ?? "");
      return Number.isFinite(expiresAt) && expiresAt > now;
    }),
  );
  const nextTyping = new Map(
    [...typing].filter(([, patch]) => {
      const expiresAt = Date.parse(patch.expiresAt ?? "");
      return patch.active && Number.isFinite(expiresAt) && expiresAt > now;
    }),
  );
  return { presences: nextPresences, typing: nextTyping };
}
