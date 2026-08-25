import type { DesktopCompatibilityResponse } from "@punks/contracts";
import { validateDesktopCompatibilityResponse } from "@punks/contracts/desktop-compatibility";

import { PunksDesktopFailure } from "./punksFailure";
import { invokePunks } from "./punksTauriInvoke";

export interface PunksCompatibilityClient {
  checkCompatibility(): Promise<DesktopCompatibilityResponse>;
}

/** Creates the bootstrap-only client; no Account or Workspace command is imported. */
export function createTauriPunksCompatibilityClient(): PunksCompatibilityClient {
  return {
    async checkCompatibility() {
      const response = await invokePunks<unknown>("punks_check_compatibility");
      if (!validateDesktopCompatibilityResponse(response).valid) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Tauri result violated desktop.compatibility-response@1",
        );
      }
      return response as DesktopCompatibilityResponse;
    },
  };
}
