import type { DesktopPresenceDelivery } from "@punks/contracts";

import type { PunksPresence, WorkspaceLease } from "./punksClientTypes";
import { invokePunks, requireContract } from "./punksTauriTransport";

class TauriPunksPresence implements PunksPresence {
  constructor(private readonly operationId: string) {}

  async nextDelivery(): Promise<DesktopPresenceDelivery> {
    return requireContract<DesktopPresenceDelivery>(
      "punks://contracts/desktop.presence-delivery@1",
      await invokePunks("punks_presence_next", {
        operationId: this.operationId,
      }),
    );
  }

  async setStatus(status: string | null): Promise<void> {
    await invokePunks("punks_set_presence_status", {
      operationId: this.operationId,
      status,
    });
  }

  async signalTyping(conversationId: string, active: boolean): Promise<void> {
    await invokePunks("punks_signal_presence_typing", {
      operationId: this.operationId,
      conversationId,
      active,
    });
  }

  async close(): Promise<void> {
    await invokePunks("punks_close_presence", {
      operationId: this.operationId,
    });
  }
}

/** Opens the dedicated native Presence channel; raw invoke stays isolated. */
export async function holdPresence(
  lease: WorkspaceLease,
): Promise<PunksPresence> {
  const operationId = await invokePunks<string>("punks_hold_presence", {
    lease,
  });
  return new TauriPunksPresence(operationId);
}
