import type { DesktopCompatibilityResponse } from "@punks/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  runtimeFailed: boolean;
  compatibility: DesktopCompatibilityResponse | null;
  available: ReadonlySet<string>;
};

type PunksCapabilityContextValue = PunksCapabilityAvailability & {
  retry(): void;
};

const UNRESOLVED: PunksCapabilityAvailability = {
  resolved: false,
  clientBlocked: false,
  runtimeFailed: false,
  compatibility: null,
  available: new Set(),
};

const PunksCapabilityContext = createContext<PunksCapabilityContextValue>({
  ...UNRESOLVED,
  retry: () => undefined,
});

export function PunksCapabilityProvider({
  client,
  children,
}: {
  client: Pick<PunksAccountClient, "checkCompatibility">;
  children: ReactNode;
}) {
  const [availability, setAvailability] =
    useState<PunksCapabilityAvailability>(UNRESOLVED);
  const requestGeneration = useRef(0);
  const resolve = useCallback(() => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setAvailability(UNRESOLVED);
    void client
      .checkCompatibility()
      .then((compatibility) => {
        if (requestGeneration.current !== generation) return;
        setAvailability({
          resolved: true,
          clientBlocked: !compatibility.compatible,
          runtimeFailed: false,
          compatibility,
          available: intersectPunksCapabilities(
            compatibility.compatible ? compatibility.capabilities : [],
          ),
        });
      })
      .catch(() => {
        if (requestGeneration.current !== generation) return;
        setAvailability({
          resolved: true,
          clientBlocked: false,
          runtimeFailed: true,
          compatibility: null,
          available: new Set(),
        });
      });
  }, [client]);

  useEffect(() => {
    resolve();
    return () => {
      requestGeneration.current += 1;
    };
  }, [resolve]);

  const value = useMemo(
    () => ({ ...availability, retry: resolve }),
    [availability, resolve],
  );

  return (
    <PunksCapabilityContext.Provider value={value}>
      {children}
    </PunksCapabilityContext.Provider>
  );
}

export function usePunksCapabilityAvailability(): PunksCapabilityContextValue {
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
