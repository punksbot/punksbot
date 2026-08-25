import { useEffect, useState } from "react";

import type {
  AccountSessionStateView,
  PunksAccountClient,
} from "@/shared/api/punksClient";

type SignedOutAccountState = Extract<
  AccountSessionStateView,
  { state: "signed_out" }
>;

/** Tracks one explicit Account switch without remounting the old Account. */
export function PunksAccountSwitching({
  client,
  accountState,
  onFinished,
}: {
  client: PunksAccountClient;
  accountState: SignedOutAccountState;
  onFinished(): Promise<void>;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (failure !== null) return;
    let active = true;
    let timer: number | undefined;
    let attempts = 0;

    const poll = async () => {
      try {
        const state = await client.getAccountSessionState();
        if (!active) return;
        if (
          state.state === "authenticated" ||
          state.authentication.phase === "confirmed"
        ) {
          await onFinished();
          return;
        }
        if (
          state.authentication.phase === "cancelled" ||
          state.authentication.phase === "expired"
        ) {
          await onFinished();
          return;
        }
        if (state.authentication.phase === "failed") {
          setFailure(new Error("Account switch failed"));
          return;
        }
        attempts += 1;
        if (attempts >= 800) {
          setFailure(new Error("Account switch status timed out"));
          return;
        }
        timer = window.setTimeout(() => void poll(), 750);
      } catch (error) {
        if (active) setFailure(error);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, failure, onFinished]);

  const cancel = async () => {
    setCancelling(true);
    setFailure(null);
    try {
      await client.cancelAuthentication();
      await onFinished();
    } catch (error) {
      setFailure(error);
      setCancelling(false);
    }
  };

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app px-6 text-foreground"
      data-testid="punks-account-switching"
      role="status"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Switching Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Finish authorization in your system browser. The previous Workspace is
          already closed on this device.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Ceremony state: {accountState.authentication.phase}
        </p>
        {failure === null ? null : (
          <div className="mt-4" role="alert">
            <p className="text-sm text-destructive">
              The Account switch could not be completed.
            </p>
            <button
              className="mt-3 rounded-md border border-border px-3 py-2 text-sm"
              onClick={() => {
                setFailure(null);
              }}
              type="button"
            >
              Check again
            </button>
          </div>
        )}
        <button
          className="mt-4 rounded-md border border-border px-3 py-2 text-sm"
          disabled={cancelling}
          onClick={() => void cancel()}
          type="button"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
