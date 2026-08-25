import {
  type DesktopContractId,
  validateDesktopContract,
} from "@punks/contracts/desktop";

import { PunksDesktopFailure } from "./punksFailure";

export { invokePunks } from "./punksTauriInvoke";

export function requireContract<T>(
  contractId: DesktopContractId,
  value: unknown,
): T {
  if (!validateDesktopContract(contractId, value).valid) {
    throw new PunksDesktopFailure(
      "contract_violation",
      `Tauri result violated ${contractId}`,
    );
  }
  return value as T;
}
