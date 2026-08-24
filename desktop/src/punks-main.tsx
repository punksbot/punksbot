import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";

import PunksApp from "@/features/punks/PunksApp";
import "@/punks.css";

type BoundaryState = { error: Error | null };

class PunksRootErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(
      "[PunksRootErrorBoundary] uncaught render error",
      error,
      info,
    );
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <section className="max-w-md text-center" role="alert">
          <h1 className="text-base font-semibold">Punks Bot could not start</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reload the application. If the problem continues, contact support.
          </p>
          <button
            className="mt-5 rounded-md border border-border px-3 py-2 text-sm"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload
          </button>
        </section>
      </main>
    );
  }
}

const root = document.getElementById("root");
if (root === null) throw new Error("Punks root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PunksRootErrorBoundary>
      <PunksApp />
    </PunksRootErrorBoundary>
  </React.StrictMode>,
);
