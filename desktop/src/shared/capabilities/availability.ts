/**
 * Disponibilité de capacité — la source unique consultée par tous les points
 * de découverte et de navigation du desktop riche (issue #53, spec #47).
 *
 * Une capacité n'est disponible que si :
 *   - cette distribution du client a réellement monté sa surface
 *     (CLIENT_MOUNTED_CAPABILITIES, fixé au build) ;
 *   - ET l'environnement Punks l'autorise pour cette version du client
 *     (réponse de compatibilité du déploiement).
 *
 * La distribution historique de préparation (build sans
 * `VITE_PUNKS_DISTRIBUTION=punks`) conserve ses surfaces pour préparer les
 * tranches suivantes : elle n'est pas une distribution produit et n'ouvre
 * aucune session Punks. Toute autre situation échoue fermé : une disponibilité
 * non établie masque tout, une incompatibilité de client bloque avant le
 * montage de tout Workspace.
 */
import type { DesktopCompatibilityResponse } from "@punks/contracts";
import { createTauriPunksAccountClient } from "@/shared/api/punksClient";
import { SURFACE_CAPABILITIES, capabilityForRoutePath } from "./surfaces";

export type DistributionMode = "preparation" | "punks";

export type CapabilityAvailability = {
  distribution: DistributionMode;
  resolved: boolean;
  /** Incompatibilité de client : tout montage de Workspace est bloqué. */
  clientBlocked: boolean;
  available: ReadonlySet<string>;
};

/**
 * Capabilities mounted by the Punks desktop social loop.  The preparation
 * distribution ignores this list and keeps the historical surfaces available;
 * the product distribution intersects it with the server Compatibility reply
 * before the first Workspace subtree is mounted.
 */
export const CLIENT_MOUNTED_CAPABILITIES: readonly string[] = [
  "home",
  "compatibility",
  "account-session",
  "authentication",
  "workspace-selection",
  "punk-profile",
  "bounded-punk-summaries",
  "private-punk-search",
  "stream-list",
  "message-history",
  "threads",
  "bounded-authors",
  "conversation-follow",
  "message-post",
  "unicode-reactions",
];

const ALL_SURFACES: ReadonlySet<string> = new Set(SURFACE_CAPABILITIES);
const NOTHING: ReadonlySet<string> = new Set();

/** Seam d'exécution E2E : définie uniquement par le pont de test e2e. */
type PunksE2eEnvironment = {
  distribution: "preparation" | "punks";
  mounted?: string[];
  compatibility?: {
    compatible: boolean;
    capabilities: string[];
  };
};
declare global {
  interface Window {
    __PUNKS_E2E_ENVIRONMENT__?: PunksE2eEnvironment;
  }
}

function compiledPunksDistribution(): boolean {
  // `import.meta.env` n'existe que dans les builds Vite : les tests Node qui
  // importent ce module transitivement n'en disposent pas.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_PUNKS_DISTRIBUTION === "punks";
}

function readDistribution(): DistributionMode {
  if (typeof window !== "undefined") {
    const seam = window.__PUNKS_E2E_ENVIRONMENT__;
    if (seam?.distribution) {
      return seam.distribution;
    }
  }
  return compiledPunksDistribution() ? "punks" : "preparation";
}

function initialSnapshot(): CapabilityAvailability {
  return {
    distribution: readDistribution(),
    resolved: false,
    clientBlocked: false,
    available: NOTHING,
  };
}

// Initialisation paresseuse : le graphe de modules statiques s'évalue avant
// le bootstrap applicatif (pont E2E, distribution compilée). Un premier
// accès prématuré ne doit jamais figer une distribution par défaut : la
// décision est donc relue tant que le snapshot n'est pas résolu.
let snapshot: CapabilityAvailability | null = null;
let resolving: Promise<CapabilityAvailability> | null = null;

function currentSnapshot(): CapabilityAvailability {
  snapshot ??= initialSnapshot();
  return snapshot;
}

/** La garde ne masque que les distributions produit Punks. */
export function isCapabilityGatingActive(): boolean {
  return getCapabilityAvailability().distribution === "punks";
}

/** Snapshot synchronne courant (fermé tant que non résolu). */
export function getCapabilityAvailability(): CapabilityAvailability {
  return currentSnapshot();
}

/**
 * Décision synchrone initiale : relit la distribution tant qu'aucune
 * résolution n'a eu lieu, puis résout la préparation en place (ouverte).
 * Retourne l'état à exposer au premier rendu.
 */
export function decideCapabilityAvailability(): CapabilityAvailability {
  if (snapshot?.resolved) {
    return snapshot;
  }
  snapshot = initialSnapshot();
  if (snapshot.distribution === "preparation") {
    snapshot = {
      distribution: "preparation",
      resolved: true,
      clientBlocked: false,
      available: ALL_SURFACES,
    };
  }
  return snapshot;
}

/** Résout la disponibilité une fois par montée (et après chaque reset). */
export async function ensureCapabilityAvailability(): Promise<CapabilityAvailability> {
  if (snapshot?.resolved) {
    return snapshot;
  }
  // Un accès prématuré peut avoir figé « preparation » avant le bootstrap :
  // la distribution est relue tant que rien n'est résolu.
  const distribution = readDistribution();
  if (distribution === "preparation") {
    snapshot = {
      distribution: "preparation",
      resolved: true,
      clientBlocked: false,
      available: ALL_SURFACES,
    };
    resolving = null;
    return snapshot;
  }
  if (snapshot === null || snapshot.distribution !== distribution) {
    snapshot = initialSnapshot();
  }
  resolving ??= resolveAvailability();
  return resolving;
}

async function resolveAvailability(): Promise<CapabilityAvailability> {
  const seam = window.__PUNKS_E2E_ENVIRONMENT__;
  if (seam) {
    // Pont de test : distribution et réponse de compatibilité injectées.
    snapshot = conclude(
      seam.compatibility ?? {
        compatible: false,
        capabilities: [],
      },
      seam.mounted ?? [...CLIENT_MOUNTED_CAPABILITIES],
    );
    return snapshot;
  }
  try {
    const compatibility: DesktopCompatibilityResponse =
      await createTauriPunksAccountClient().checkCompatibility();
    snapshot = conclude(compatibility, CLIENT_MOUNTED_CAPABILITIES);
  } catch {
    // Fail-closed : indisponibilité de la réponse = rien n'est disponible et
    // le montage de Workspace reste bloqué.
    snapshot = {
      distribution: "punks",
      resolved: true,
      clientBlocked: true,
      available: NOTHING,
    };
  }
  return snapshot;
}

function conclude(
  compatibility: Pick<
    DesktopCompatibilityResponse,
    "compatible" | "capabilities"
  >,
  mounted: readonly string[],
): CapabilityAvailability {
  const environmentEnabled = new Set(
    compatibility.compatible ? compatibility.capabilities : [],
  );
  const available = new Set(
    mounted.filter((capability) => environmentEnabled.has(capability)),
  );
  return {
    distribution: "punks",
    resolved: true,
    clientBlocked: !compatibility.compatible,
    available,
  };
}

/** Une capacité donnée est-elle disponible ? Fermé tant que non résolu. */
export function isCapabilityAvailable(capability: string): boolean {
  const current = currentSnapshot();
  if (current.distribution === "preparation") {
    return true;
  }
  return current.resolved && current.available.has(capability);
}

/** Un chemin de route est-il autorisé ? (null = surface neutre, autorisée) */
export function isRoutePathAllowed(pathname: string): boolean {
  const capability = capabilityForRoutePath(pathname);
  return capability === null || isCapabilityAvailable(capability);
}

/**
 * Réinitialise le cache de disponibilité. La réponse dépend de l'origine de
 * l'environnement : ce reset est branché au changement de communauté et
 * notifie les abonnés (provider) pour relancer la résolution.
 */
export function resetCapabilityAvailability(): void {
  snapshot = null;
  resolving = null;
  for (const listener of [...listeners]) {
    listener();
  }
}

const listeners = new Set<() => void>();

/**
 * S'abonne aux réinitialisations de disponibilité (changement de communauté).
 * Retourne la fonction de désabonnement.
 */
export function onCapabilityAvailabilityReset(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
