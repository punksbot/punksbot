import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  type DesktopContractId,
  validateDesktopContract,
} from "@punks/contracts/desktop";

import { PunksDesktopFailure, type PunksFailureKind } from "./punksFailure";

const failureKinds = new Set<PunksFailureKind>([
  "problem",
  "transport",
  "contract_violation",
  "cancelled",
  "stale_workspace",
  "session_expired",
  "ambiguous",
]);

function normalizeFailure(error: unknown): PunksDesktopFailure {
  if (error instanceof PunksDesktopFailure) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string" &&
    failureKinds.has(error.kind as PunksFailureKind) &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new PunksDesktopFailure(
      error.kind as PunksFailureKind,
      error.message,
      "problem" in error ? error.problem : undefined,
    );
  }
  return new PunksDesktopFailure(
    "contract_violation",
    "Tauri returned an invalid Punks failure",
  );
}

export async function invokePunks<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw normalizeFailure(error);
  }
}

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
