/** Recoverable Account/bootstrap failure distinct from incompatibility. */
export function PunksRuntimeError({ onRetry }: { onRetry(): Promise<void> }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app px-6 text-foreground"
      data-testid="punks-runtime-error"
      role="alert"
    >
      <div className="max-w-md text-center">
        <h1 className="text-message font-semibold">Connection unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Punks Bot could not load the Account. Try again when the connection is
          available.
        </p>
        <button
          className="mt-4 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          onClick={() => void onRetry()}
          type="button"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
