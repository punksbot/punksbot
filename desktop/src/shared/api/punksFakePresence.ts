import type { DesktopPresenceDelivery } from "@punks/contracts";

import { PunksDesktopFailure } from "./punksFailure";
import type { PunksPresence, WorkspaceLease } from "./punksClientTypes";

/** Deterministic in-memory implementation of the native volatile seam. */
export function createFakePresence(input: {
  lease: WorkspaceLease;
  punkId: string;
  assertCapability(): void;
  assertCurrent(): void;
}): PunksPresence {
  input.assertCapability();
  input.assertCurrent();
  let closed = false;
  let sequence = 1;
  const queued: DesktopPresenceDelivery[] = [
    {
      kind: "accepted",
      clientGeneration: input.lease.generation,
      leaseGeneration: 1,
      heartbeatIntervalMs: 15_000,
      awayAfterMs: 30_000,
      expiresAfterMs: 60_000,
      presences: [
        {
          punkId: input.punkId,
          state: "online",
          status: null,
          leaseGeneration: 1,
          sequence,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    },
  ];
  const waiters: Array<(delivery: DesktopPresenceDelivery) => void> = [];
  const publish = (delivery: DesktopPresenceDelivery) => {
    const waiter = waiters.shift();
    if (waiter === undefined) queued.push(delivery);
    else waiter(delivery);
  };
  return {
    async nextDelivery() {
      input.assertCurrent();
      if (closed) {
        throw new PunksDesktopFailure(
          "cancelled",
          "Punks Presence operation is closed",
        );
      }
      const delivery = queued.shift();
      return (
        delivery ??
        new Promise<DesktopPresenceDelivery>((resolve) => waiters.push(resolve))
      );
    },
    async setStatus(status) {
      input.assertCurrent();
      sequence += 1;
      publish({
        kind: "presence",
        presence: {
          punkId: input.punkId,
          state: "online",
          status,
          leaseGeneration: 1,
          sequence,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    },
    async signalTyping() {
      input.assertCurrent();
    },
    async close() {
      closed = true;
      for (const resolve of waiters.splice(0)) {
        resolve({
          kind: "realtime_degraded",
          reason: "capacity_unavailable",
        });
      }
    },
  };
}
