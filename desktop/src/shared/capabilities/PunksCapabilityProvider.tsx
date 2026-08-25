import type { DesktopCompatibilityResponse } from "@punks/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { PunksAccountClient } from "@/shared/api/punksClient";
import {
  hasCompletePunksCapabilitySet,
  intersectPunksCapabilities,
} from "./punksProfile";

export { PUNKS_MOUNTED_CAPABILITIES } from "./punksProfile";

type PunksCapabilityAvailability = {
  resolved: boolean;
  clientBlocked: boolean;
  compatibility: DesktopCompatibilityResponse | null;
  available: ReadonlySet<string>;
};

const UNRESOLVED: PunksCapabilityAvailability = {
  resolved: false,
  clientBlocked: false,
  compatibility: null,
  available: new Set(),
};

const PunksCapabilityContext =
  createContext<PunksCapabilityAvailability>(UNRESOLVED);

export function PunksCapabilityProvider({
  client,
  children,
}: {
  client: Pick<PunksAccountClient, "checkCompatibility">;
  children: ReactNode;
}) {
  const [availability, setAvailability] =
    useState<PunksCapabilityAvailability>(UNRESOLVED);

  useEffect(() => {
    let active = true;
    void client
      .checkCompatibility()
      .then((compatibility) => {
        if (!active) return;
        setAvailability({
          resolved: true,
          clientBlocked: !compatibility.compatible,
          compatibility,
          available: intersectPunksCapabilities(
            compatibility.compatible ? compatibility.capabilities : [],
          ),
        });
      })
      .catch(() => {
        if (!active) return;
        setAvailability({
          resolved: true,
          clientBlocked: true,
          compatibility: null,
          available: new Set(),
        });
      });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <PunksCapabilityContext.Provider value={availability}>
      {children}
    </PunksCapabilityContext.Provider>
  );
}

export function usePunksCapabilityAvailability(): PunksCapabilityAvailability {
  return useContext(PunksCapabilityContext);
}

export function usePunksCapabilityAvailable(capability: string): boolean {
  const availability = usePunksCapabilityAvailability();
  return availability.resolved && availability.available.has(capability);
}

export function useCompletePunksCapabilitySet(): boolean {
  const availability = usePunksCapabilityAvailability();
  return useMemo(
    () =>
      availability.resolved &&
      !availability.clientBlocked &&
      hasCompletePunksCapabilitySet(availability.available),
    [availability],
  );
}

export function PunksUnavailableScreen({
  testId = "unavailable-terminal",
}: {
  testId?: string;
}) {
  return (
    <div
      className="flex min-h-dvh w-full items-center justify-center bg-app text-muted-foreground"
      data-testid={testId}
    >
      <div className="max-w-md px-6 text-center">
        <h1 className="text-message font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm">
          Nothing is available at this address in this version of the app.
        </p>
      </div>
    </div>
  );
}
