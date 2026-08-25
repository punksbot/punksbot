import {
  DESKTOP_SOCIAL_LOOP_CAPABILITIES,
  type DesktopSocialLoopCapability,
} from "@punks/contracts/desktop-profile";

/** Exact capability set compiled into the current Punks desktop product. */
export const PUNKS_MOUNTED_CAPABILITIES = DESKTOP_SOCIAL_LOOP_CAPABILITIES;

/** Intersects environment capabilities with code actually mounted by this build. */
export function intersectPunksCapabilities(
  environmentCapabilities: readonly string[],
): Set<DesktopSocialLoopCapability> {
  const enabled = new Set(environmentCapabilities);
  return new Set(
    PUNKS_MOUNTED_CAPABILITIES.filter((capability) => enabled.has(capability)),
  );
}

/** T1 is atomic: a partial profile never mounts a partial Workspace. */
export function hasCompletePunksCapabilitySet(
  available: ReadonlySet<string>,
): boolean {
  return PUNKS_MOUNTED_CAPABILITIES.every((capability) =>
    available.has(capability),
  );
}

type PunksRouteShape = {
  kind: "home" | "workspace" | "conversation" | "message";
};

const ROUTE_REQUIREMENTS: Readonly<
  Record<PunksRouteShape["kind"], readonly DesktopSocialLoopCapability[]>
> = {
  home: ["account-session", "authentication", "workspace-selection"],
  workspace: ["workspace-selection", "stream-list"],
  conversation: [
    "stream-list",
    "message-history",
    "bounded-authors",
    "conversation-follow",
    "message-post",
    "unicode-reactions",
  ],
  message: ["message-history", "threads", "conversation-follow"],
};

/** Rejects routes whose public surface is not compiled into this client profile. */
export function isPunksRouteMounted(route: PunksRouteShape): boolean {
  return ROUTE_REQUIREMENTS[route.kind].every((capability) =>
    PUNKS_MOUNTED_CAPABILITIES.includes(capability),
  );
}
