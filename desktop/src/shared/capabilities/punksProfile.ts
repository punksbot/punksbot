import { DESKTOP_SOCIAL_LOOP_CAPABILITIES } from "@punks/contracts/desktop-profile";

/** Exact capability set compiled into the current Punks desktop product. */
export const PUNKS_MOUNTED_CAPABILITIES: readonly string[] =
  DESKTOP_SOCIAL_LOOP_CAPABILITIES;

/** Intersects environment capabilities with code actually mounted by this build. */
export function intersectPunksCapabilities(
  environmentCapabilities: readonly string[],
): Set<string> {
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
