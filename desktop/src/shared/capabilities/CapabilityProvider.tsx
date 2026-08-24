/**
 * Provider et primitives React de la Disponibilité de capacité (issue #53).
 *
 * - `CapabilityProvider` résout la disponibilité une fois par montée ;
 * - `useCapabilityAvailable` est LA garde consultée par les composants ;
 * - `CapabilityGate` masque une surface sans jamais monter ses enfants ;
 * - `UnavailableScreen` est le terminal neutre des routes directes
 *   indisponibles : sans identifiant, sans indication d'existence, sans
 *   action de relance — identique pour toutes les capacités.
 */
import * as React from "react";

import {
  decideCapabilityAvailability,
  ensureCapabilityAvailability,
  onCapabilityAvailabilityReset,
  type CapabilityAvailability,
} from "./availability";

// Valeur par défaut neutre NON résolue : aucune valeur réelle n'est lue à
// l'évaluation du module — la distribution ne peut pas être figée avant le
// bootstrap applicatif.
const UNRESOLVED: CapabilityAvailability = {
  distribution: "preparation",
  resolved: false,
  clientBlocked: false,
  available: new Set<string>(),
};

const AvailabilityContext =
  React.createContext<CapabilityAvailability>(UNRESOLVED);

export function CapabilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [availability, setAvailability] = React.useState(
    decideCapabilityAvailability,
  );

  React.useEffect(() => {
    let active = true;
    const resolve = () => {
      ensureCapabilityAvailability().then((snapshot) => {
        if (active) {
          setAvailability(snapshot);
        }
      });
    };
    resolve();
    // Un changement de communauté réinitialise le cache : la résolution doit
    // relancer pour la nouvelle origine.
    const unsubscribe = onCapabilityAvailabilityReset(resolve);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <AvailabilityContext.Provider value={availability}>
      {children}
    </AvailabilityContext.Provider>
  );
}

/** Garde unique : false tant que la disponibilité n'est pas établie. */
export function useCapabilityAvailability(): CapabilityAvailability {
  return React.useContext(AvailabilityContext);
}

export function useCapabilityAvailable(capability: string): boolean {
  const availability = useCapabilityAvailability();
  if (availability.distribution === "preparation") {
    return true;
  }
  return availability.resolved && availability.available.has(capability);
}

/** Masque les enfants tant que la capacité n'est pas disponible. */
export function CapabilityGate({
  capability,
  children,
}: {
  capability: string;
  children: React.ReactNode;
}) {
  const available = useCapabilityAvailable(capability);
  if (!available) {
    return null;
  }
  return <>{children}</>;
}

/**
 * Terminal neutre des surfaces indisponibles. Le rendu est strictement
 * identique pour toute capacité : il ne divulgue ni l'existence de la
 * surface, ni son identifiant, et n'offre aucune action de relance.
 */
export function UnavailableScreen() {
  return (
    <div
      data-testid="unavailable-terminal"
      className="flex h-full w-full items-center justify-center bg-app text-muted-foreground"
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

/**
 * Garde de route : rend l'écran neutre AVANT tout montage (et donc avant tout
 * import dynamique de la surface) lorsque la capacité est indisponible.
 */
export function RouteCapabilityBoundary({
  capability,
  children,
}: {
  capability: string;
  children: React.ReactNode;
}) {
  const available = useCapabilityAvailable(capability);
  if (!available) {
    return <UnavailableScreen />;
  }
  return <>{children}</>;
}
