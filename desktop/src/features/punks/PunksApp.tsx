import { createTauriPunksAccountClient } from "@/shared/api/punksClient";
import {
  PunksCapabilityProvider,
  PunksUnavailableScreen,
  useCompletePunksCapabilitySet,
  usePunksCapabilityAvailability,
} from "@/shared/capabilities/PunksCapabilityProvider";
import { isPunksRouteMounted } from "@/shared/capabilities/punksProfile";
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";

import { parsePunksPath, type PunksRoute } from "./routes";

const LazyPunksRuntime = lazy(() =>
  import("./PunksRuntime").then((module) => ({
    default: module.PunksRuntime,
  })),
);

function readLocation(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function useCurrentPunksRoute(): PunksRoute | null {
  const rawLocation = useSyncExternalStore(
    subscribeToLocation,
    readLocation,
    () => "/",
  );
  return useMemo(() => {
    const location = new URL(rawLocation, "https://route.invalid");
    const route = parsePunksPath(
      location.pathname,
      location.search,
      location.hash,
    );
    return route !== null && isPunksRouteMounted(route) ? route : null;
  }, [rawLocation]);
}

function PunksCapabilityLoading() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app text-muted-foreground"
      data-testid="punks-capability-loading"
      role="status"
    >
      <p className="text-sm">Checking availability…</p>
    </div>
  );
}

function PunksCapabilityError({ onRetry }: { onRetry(): void }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-app px-6 text-foreground"
      data-testid="punks-capability-error"
      role="alert"
    >
      <div className="max-w-md text-center">
        <h1 className="text-message font-semibold">Connection unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Punks Bot could not reach the service. Try again when the connection
          is available.
        </p>
        <button
          className="mt-4 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function PunksProduct({
  client,
  route,
}: {
  client: ReturnType<typeof createTauriPunksAccountClient>;
  route: PunksRoute;
}) {
  const availability = usePunksCapabilityAvailability();
  const completeCapabilitySet = useCompletePunksCapabilitySet();

  if (!availability.resolved) return <PunksCapabilityLoading />;
  if (availability.runtimeFailed) {
    return <PunksCapabilityError onRetry={availability.retry} />;
  }
  if (availability.clientBlocked) {
    return <PunksUnavailableScreen testId="client-incompatible-gate" />;
  }
  if (availability.compatibility === null || !completeCapabilitySet) {
    return <PunksUnavailableScreen />;
  }
  return (
    <Suspense fallback={<PunksCapabilityLoading />}>
      <LazyPunksRuntime
        client={client}
        compatibility={availability.compatibility}
        route={route}
      />
    </Suspense>
  );
}

function PunksAvailableRoute({ route }: { route: PunksRoute }) {
  const [client] = useState(createTauriPunksAccountClient);
  return (
    <PunksCapabilityProvider client={client}>
      <PunksProduct client={client} route={route} />
    </PunksCapabilityProvider>
  );
}

/** Entry point for the product Punks distribution. */
export default function PunksApp() {
  const route = useCurrentPunksRoute();
  if (route === null) return <PunksUnavailableScreen />;
  return <PunksAvailableRoute route={route} />;
}
