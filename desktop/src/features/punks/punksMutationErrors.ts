import { PunksDesktopFailure } from "@/shared/api/punksClient";

export function mutationErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (!(error instanceof PunksDesktopFailure)) {
    return "The Message action failed. Submit a new explicit intent.";
  }
  switch (error.kind) {
    case "problem":
      return error.message;
    case "transport":
      return "The Stream could not be reached. No mutation was retried; try again when it is online.";
    case "contract_violation":
      return "The Stream returned an invalid mutation response. Refresh the Workspace before trying again.";
    case "cancelled":
      return "The Message action was cancelled. Submit a new explicit intent if it is still needed.";
    case "stale_workspace":
      return "The Workspace changed while the action was running. Reopen the current Workspace before trying again.";
    case "session_expired":
    case "account_merged":
      return "The Punk session expired before the action completed. Sign in again before retrying.";
    case "ambiguous":
      return "The mutation result is ambiguous. Do not retry automatically; refresh the Message state first.";
  }
}
