import { createTauriPunksAccountClient } from "@/shared/api/punksClient";
import {
  PunksCapabilityProvider,
  PunksUnavailableScreen,
  useCompletePunksCapabilitySet,
  usePunksCapabilityAvailability,
} from "@/shared/capabilities/PunksCapabilityProvider";
import { useMemo, useState, useSyncExternalStore } from "react";

import { PunksRuntime } from "./PunksRuntime";
import { parsePunksPath, type PunksRoute } from "./routes";

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
    return parsePunksPath(location.pathname, location.search, location.hash);
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
  if (availability.clientBlocked) {
    return <PunksUnavailableScreen testId="client-incompatible-gate" />;
  }
  if (availability.compatibility === null || !completeCapabilitySet) {
    return <PunksUnavailableScreen />;
  }
  return (
    <PunksRuntime
      client={client}
      compatibility={availability.compatibility}
      route={route}
    />
  );
}

/** Entry point for the product Punks distribution. */
export default function PunksApp() {
  const [client] = useState(createTauriPunksAccountClient);
  const route = useCurrentPunksRoute();
  if (route === null) return <PunksUnavailableScreen />;
  return (
    <PunksCapabilityProvider client={client}>
      <PunksProduct client={client} route={route} />
    </PunksCapabilityProvider>
  );
}
