/**
 * Table de correspondance entre les capacités Punks du profil commun
 * (`desktop-social-loop@1`) et les surfaces du desktop riche : routes,
 * raccourcis clavier et cibles de navigation.
 *
 * Une capacité absente de cette table n'a pas de point de découverte direct
 * dans le client ; ses surfaces ne peuvent donc pas y être atteintes.
 * La liste des capacités elles-mêmes vit dans le profil canonique et sa
 * fermeture est vérifiée côté disponibilité (voir availability.ts).
 */

export type CapabilityId = string;

/** Capacités pilotant au moins une surface de découverte ou de navigation. */
export const SURFACE_CAPABILITIES: readonly CapabilityId[] = [
  "home",
  "search",
  "command-palette",
  "direct-conversations",
  "conversation-management",
  "forum",
  "bots",
  "workflows",
  "repositories",
  "pulse",
  "huddles",
  "stream-list",
];

type RouteCapabilityRule = {
  /** Préfixe exact du chemin (segments complets uniquement). */
  prefix: string;
  capability: CapabilityId;
};

/**
 * Routes du client riche vers leur capacité. Toute route absente de cette
 * table est une surface neutre (mécanisme client sans capacité produit).
 */
const ROUTE_CAPABILITY_RULES: readonly RouteCapabilityRule[] = [
  { prefix: "/", capability: "home" },
  { prefix: "/channels/", capability: "stream-list" },
  { prefix: "/agents", capability: "bots" },
  { prefix: "/pulse", capability: "pulse" },
  { prefix: "/projects", capability: "repositories" },
  { prefix: "/workflows", capability: "workflows" },
  { prefix: "/messages/new", capability: "direct-conversations" },
];

/** Le fil de forum est une sous-route de canal portée par la capacité forum. */
const FORUM_POST_PATTERN = /^\/channels\/[^/]+\/posts(?:\/|$)/;

/** Raccourcis clavier vers leur capacité. */
export const SHORTCUT_CAPABILITIES = {
  "search-current-channel": "search",
  "search-everything": "command-palette",
  "new-message": "direct-conversations",
  "create-channel": "conversation-management",
  "browse-channels": "conversation-management",
  "go-home": "home",
  "start-huddle": "huddles",
} as const;

export type ShortcutId = keyof typeof SHORTCUT_CAPABILITIES;

/** Capacité pilotant ce chemin de route, ou null pour une surface neutre. */
export function capabilityForRoutePath(pathname: string): CapabilityId | null {
  if (FORUM_POST_PATTERN.test(pathname)) {
    return "forum";
  }
  if (pathname === "/") {
    return "home";
  }
  const rule = ROUTE_CAPABILITY_RULES.find((r) => {
    if (r.prefix === "/") {
      return false;
    }
    // Un préfixe déjà terminé par « / » (sous-arbre de canal) s'apparie
    // directement ; les autres s'apparient au segment près.
    if (r.prefix.endsWith("/")) {
      return pathname.startsWith(r.prefix);
    }
    return pathname === r.prefix || pathname.startsWith(`${r.prefix}/`);
  });
  return rule?.capability ?? null;
}

/** Capacité pilotant ce raccourci clavier. */
export function capabilityForShortcut(id: ShortcutId): CapabilityId {
  return SHORTCUT_CAPABILITIES[id];
}
