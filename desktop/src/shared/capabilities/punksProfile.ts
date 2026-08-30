import { DESKTOP_SOCIAL_LOOP_CAPABILITIES } from "@punks/contracts/desktop-profile";

/** Capabilities backed by real local authorities in the rich desktop graph. */
export const PUNKS_MOUNTED_CAPABILITIES = [
  ...DESKTOP_SOCIAL_LOOP_CAPABILITIES,
  "message-lifecycle",
  "identity-governance",
  "presence",
  "search",
] as const;

type PunksMountedCapability = (typeof PUNKS_MOUNTED_CAPABILITIES)[number];

/** Intersects environment capabilities with code actually mounted by this build. */
export function intersectPunksCapabilities(
  environmentCapabilities: readonly string[],
): Set<string> {
  const enabled = new Set(environmentCapabilities);
  const e2eMounted =
    typeof window === "undefined"
      ? undefined
      : (
          window as typeof window & {
            __PUNKS_E2E_ENVIRONMENT__?: { mounted?: string[] };
          }
        ).__PUNKS_E2E_ENVIRONMENT__?.mounted;
  const mounted = e2eMounted ?? PUNKS_MOUNTED_CAPABILITIES;
  return new Set(mounted.filter((capability) => enabled.has(capability)));
}

/** The compiled profile is atomic: a partial reply never mounts a Workspace. */
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
  Record<PunksRouteShape["kind"], readonly PunksMountedCapability[]>
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
