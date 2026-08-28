import { useEffect, useState } from "react";

import type {
  AccountSessionStateView,
  AuthenticationMethod,
  CeremonyPhaseView,
  PunksAccountClient,
} from "@/shared/api/punksClient";

/** Drives explicit sign-in and recovery without exposing native secrets. */
export function PunksSignedOut({
  client,
  accountState,
  onStarted,
}: {
  client: PunksAccountClient;
  accountState: Extract<AccountSessionStateView, { state: "signed_out" }>;
  onStarted(): Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [authentication, setAuthentication] = useState<CeremonyPhaseView>(
    accountState.authentication,
  );
  const [resumeAvailable, setResumeAvailable] = useState(
    accountState.resumeAvailable,
  );
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (polling) return;
    setAuthentication(accountState.authentication);
    setResumeAvailable(accountState.resumeAvailable);
  }, [accountState, polling]);

  useEffect(() => {
    if (!polling) return;
    let active = true;
    let timer: number | undefined;
    let attempts = 0;

    const poll = async () => {
      try {
        const state = await client.getAccountSessionState();
        if (!active) return;
        setAuthentication(state.authentication);
        setResumeAvailable(state.resumeAvailable);
        if (
          state.state === "authenticated" ||
          state.authentication.phase === "confirmed"
        ) {
          setPolling(false);
          await onStarted();
          return;
        }
        if (
          state.authentication.phase === "cancelled" ||
          state.authentication.phase === "expired" ||
          state.authentication.phase === "failed"
        ) {
          setPolling(false);
          return;
        }
        attempts += 1;
        if (attempts >= 800) {
          setFailure(new Error("Desktop authentication status timed out"));
          setPolling(false);
          return;
        }
        timer = window.setTimeout(() => void poll(), 750);
      } catch (error) {
        if (!active) return;
        setFailure(error);
        setPolling(false);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, onStarted, polling]);

  const continueAfter = async (phase: CeremonyPhaseView) => {
    setAuthentication(phase);
    setResumeAvailable(false);
    if (phase.phase === "confirmed") {
      await onStarted();
    } else if (
      phase.phase !== "cancelled" &&
      phase.phase !== "expired" &&
      phase.phase !== "failed"
    ) {
      setPolling(true);
    }
  };

  const start = async (provider: AuthenticationMethod) => {
    setBusy(provider);
    setFailure(null);
    try {
      await continueAfter(await client.startSignIn(provider));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    setBusy("resume");
    setFailure(null);
    try {
      await continueAfter(await client.resumeInterruptedAuthentication());
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setFailure(null);
    setPolling(false);
    try {
      const phase = await client.cancelAuthentication();
      setAuthentication(phase);
      setResumeAvailable(false);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };

  const canCancel =
    resumeAvailable ||
    !["idle", "cancelled", "expired", "failed", "confirmed"].includes(
      authentication.phase,
    );

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-foreground"
      data-testid="punks-signed-out"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in to Punks Bot</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Continue in your system browser to authorize this desktop session.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            data-testid="punks-sign-in-google"
            disabled={busy !== null || polling}
            onClick={() => void start("google")}
            type="button"
          >
            {busy === "google" ? "Opening…" : "Google"}
          </button>
          <button
            className="rounded-md border border-border px-3 py-2 text-sm"
            data-testid="punks-sign-in-github"
            disabled={busy !== null || polling}
            onClick={() => void start("github")}
            type="button"
          >
            {busy === "github" ? "Opening…" : "GitHub"}
          </button>
        </div>
        {resumeAvailable && !polling ? (
          <button
            className="mt-3 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            data-testid="punks-finish-sign-in"
            disabled={busy !== null}
            onClick={() => void resume()}
            type="button"
          >
            Finish sign-in
          </button>
        ) : null}
        {canCancel ? (
          <button
            className="mt-3 ml-2 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="punks-cancel-sign-in"
            disabled={busy !== null}
            onClick={() => void cancel()}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        {polling ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Finish authorization in your system browser…
          </p>
        ) : null}
        {authentication.phase === "failed" &&
        authentication.code === "account_merged" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            This Account was merged. Sign in again to continue with the
            surviving Account.
          </p>
        ) : null}
        {failure ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            The sign-in ceremony could not be started.
          </p>
        ) : null}
      </div>
    </div>
  );
}
