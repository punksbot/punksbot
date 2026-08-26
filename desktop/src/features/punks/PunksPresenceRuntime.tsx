import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PresenceTypingPatch } from "@punks/contracts";
import type { PunksPresence } from "@/shared/api/punksClient";

import {
  PunksRealtimeSignalsContext,
  usePunksRealtimeSignals,
  type PunksRealtimeStatus,
} from "./PunksRealtimeSignals";
import {
  applyPresenceDelivery,
  applyTypingPatch as reduceTypingPatch,
  emptyPresenceSignalState,
  emptyTypingSignalState,
  pruneExpiredSignals,
} from "./punksPresenceState";
import { usePunksWorkspace } from "./PunksRuntime";

/** Owns one native Presence resource for the mounted Workspace generation. */
export default function PunksPresenceRuntime({
  children,
}: {
  children: ReactNode;
}) {
  const { scope, manager } = usePunksWorkspace();
  const [status, setRealtimeStatus] =
    useState<PunksRealtimeStatus>("connecting");
  const [presenceState, setPresenceState] = useState(emptyPresenceSignalState);
  const [typingState, setTypingState] = useState(emptyTypingSignalState);
  const presences = presenceState.visible;
  const typing = typingState.visible;
  const presenceRef = useRef<PunksPresence | null>(null);
  const presenceStateRef = useRef(presenceState);

  useEffect(() => {
    let active = true;
    let opened: PunksPresence | null = null;

    const clearSignals = () => {
      const emptyPresences = emptyPresenceSignalState();
      presenceStateRef.current = emptyPresences;
      setPresenceState(emptyPresences);
      setTypingState(emptyTypingSignalState());
    };

    const run = async () => {
      setRealtimeStatus("connecting");
      try {
        opened = await manager.runResource(
          scope,
          () => scope.session.holdPresence(),
          (presence) => presence.close(),
        );
        presenceRef.current = opened;
        while (active && manager.isCurrent(scope)) {
          const delivery = await opened.nextDelivery();
          if (!active || !manager.isCurrent(scope)) break;
          if (delivery.kind === "realtime_degraded") {
            clearSignals();
            setRealtimeStatus("degraded");
            continue;
          }
          const reduction = applyPresenceDelivery(
            presenceStateRef.current,
            delivery,
            scope.lease.generation,
          );
          if (reduction.kind === "violation") {
            clearSignals();
            setRealtimeStatus("degraded");
            break;
          }
          if (reduction.kind === "applied") {
            presenceStateRef.current = reduction.state;
            setPresenceState(reduction.state);
          }
          if (delivery.kind === "accepted") setRealtimeStatus("live");
        }
      } catch {
        if (active && manager.isCurrent(scope)) {
          clearSignals();
          setRealtimeStatus("degraded");
        }
      } finally {
        presenceRef.current = null;
        if (opened !== null) await opened.close().catch(() => undefined);
      }
    };

    void run();
    return () => {
      active = false;
      presenceRef.current = null;
      if (opened !== null) void opened.close().catch(() => undefined);
    };
  }, [manager, scope]);

  useEffect(() => {
    presenceStateRef.current = presenceState;
  }, [presenceState]);

  useEffect(() => {
    const deadlines = [
      ...[...presences.values()].flatMap((presence) =>
        presence.expiresAt === null ? [] : [Date.parse(presence.expiresAt)],
      ),
      ...[...typing.values()].flatMap((patch) =>
        patch.expiresAt === null ? [] : [Date.parse(patch.expiresAt)],
      ),
    ].filter(Number.isFinite);
    const nextDeadline = Math.min(...deadlines);
    if (!Number.isFinite(nextDeadline)) return;
    const timer = window.setTimeout(
      () => {
        const pruned = pruneExpiredSignals(presenceState, typingState);
        presenceStateRef.current = pruned.presences;
        setPresenceState(pruned.presences);
        setTypingState(pruned.typing);
      },
      Math.max(0, nextDeadline - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [presenceState, presences, typing, typingState]);

  const setStatus = useCallback(
    async (nextStatus: string | null) => {
      const presence = presenceRef.current;
      if (presence === null || status !== "live") return;
      try {
        await manager.run(scope, () => presence.setStatus(nextStatus));
      } catch {
        if (manager.isCurrent(scope)) setRealtimeStatus("degraded");
      }
    },
    [manager, scope, status],
  );

  const signalTyping = useCallback(
    async (conversationId: string, active: boolean) => {
      const presence = presenceRef.current;
      if (presence === null || status !== "live") return;
      try {
        await manager.run(scope, () =>
          presence.signalTyping(conversationId, active),
        );
      } catch {
        if (manager.isCurrent(scope)) setRealtimeStatus("degraded");
      }
    },
    [manager, scope, status],
  );

  const applyTypingPatch = useCallback(
    (patch: PresenceTypingPatch) => {
      setTypingState((current) => {
        const reduction = reduceTypingPatch(
          current,
          patch,
          scope.lease.workspaceId,
        );
        return reduction.kind === "applied" ? reduction.state : current;
      });
    },
    [scope.lease.workspaceId],
  );

  const value = useMemo(
    () => ({
      status,
      presences,
      typing,
      setStatus,
      signalTyping,
      applyTypingPatch,
    }),
    [applyTypingPatch, presences, setStatus, signalTyping, status, typing],
  );

  return (
    <PunksRealtimeSignalsContext.Provider value={value}>
      {children}
    </PunksRealtimeSignalsContext.Provider>
  );
}

/** Accessible, non-authoritative status controls for the current Punk. */
export function PunksPresenceControls() {
  const realtime = usePunksRealtimeSignals();
  const [status, setStatus] = useState("");
  const label =
    realtime.status === "live"
      ? "Realtime live"
      : realtime.status === "connecting"
        ? "Realtime connecting"
        : "Realtime unavailable";
  return (
    <form
      className="rounded-md border border-border p-2"
      data-testid="punks-presence-controls"
      onSubmit={(event) => {
        event.preventDefault();
        void realtime.setStatus(status.trim() || null);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium" htmlFor="punks-presence-status">
          Status
        </label>
        <span
          className="text-xs text-muted-foreground"
          data-testid="punks-realtime-status"
          role="status"
        >
          {label}
        </span>
      </div>
      <div className="mt-2 flex gap-1">
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          disabled={realtime.status !== "live"}
          id="punks-presence-status"
          maxLength={80}
          onChange={(event) => setStatus(event.target.value)}
          placeholder="Optional status"
          value={status}
        />
        <button
          className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
          disabled={realtime.status !== "live"}
          type="submit"
        >
          Set
        </button>
      </div>
    </form>
  );
}
