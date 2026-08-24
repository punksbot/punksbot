export {
  CapabilityGate,
  CapabilityProvider,
  RouteCapabilityBoundary,
  UnavailableScreen,
  useCapabilityAvailable,
  useCapabilityAvailability,
} from "./CapabilityProvider";
export {
  CLIENT_MOUNTED_CAPABILITIES,
  decideCapabilityAvailability,
  ensureCapabilityAvailability,
  getCapabilityAvailability,
  isCapabilityAvailable,
  isCapabilityGatingActive,
  isRoutePathAllowed,
  onCapabilityAvailabilityReset,
  resetCapabilityAvailability,
  type CapabilityAvailability,
  type DistributionMode,
} from "./availability";
export {
  SHORTCUT_CAPABILITIES,
  SURFACE_CAPABILITIES,
  capabilityForRoutePath,
  capabilityForShortcut,
  type CapabilityId,
  type ShortcutId,
} from "./surfaces";
