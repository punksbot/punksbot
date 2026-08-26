/** Closed failure taxonomy for the Punks desktop boundary. */
export type PunksFailureKind =
  | "problem"
  | "transport"
  | "contract_violation"
  | "cancelled"
  | "stale_workspace"
  | "session_expired"
  | "account_merged"
  | "ambiguous";

/** Stable failure envelope shared by the native and fake Punks adapters. */
export class PunksDesktopFailure extends Error {
  readonly kind: PunksFailureKind;
  readonly problem?: unknown;

  constructor(kind: PunksFailureKind, message: string, problem?: unknown) {
    super(message);
    this.name = "PunksDesktopFailure";
    this.kind = kind;
    if (problem !== undefined) this.problem = problem;
  }
}
