/**
 * The only browser persistence owned by the Punks desktop surface.
 *
 * This store intentionally has no generic `set` method.  A caller can save
 * preferences, the last durable Workspace id, or route coordinates — never a
 * Session, Message body, cursor, Query cache, or mutation intent.
 */

export type PunksThemePreference = "light" | "dark" | "system";

export type PunksLocalPreferences = {
  theme?: PunksThemePreference;
  reducedMotion?: boolean;
};

export type PunksRouteCoordinates = {
  workspaceSlug?: string;
  conversationId?: string;
  messageId?: string;
};

export const PUNKS_STORAGE_KEYS = {
  preferences: "punks.preferences.v1",
  lastWorkspace: "punks.last-workspace.v1",
  route: "punks.route.v1",
} as const;

export interface PunksKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PunksStorageScope = {
  origin: string;
  punkId: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

function parseJson<T>(storage: PunksKeyValueStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function normalizePreferences(value: unknown): PunksLocalPreferences | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const preferences: PunksLocalPreferences = {};
  if (
    record.theme !== undefined &&
    record.theme !== "light" &&
    record.theme !== "dark" &&
    record.theme !== "system"
  ) {
    return null;
  }
  if (
    record.reducedMotion !== undefined &&
    typeof record.reducedMotion !== "boolean"
  ) {
    return null;
  }
  if (record.theme !== undefined) preferences.theme = record.theme;
  if (record.reducedMotion !== undefined) {
    preferences.reducedMotion = record.reducedMotion;
  }
  return preferences;
}

function isRouteCoordinates(value: unknown): value is PunksRouteCoordinates {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["workspaceSlug", "conversationId", "messageId"].includes(key),
    )
  ) {
    return false;
  }
  return (
    (record.workspaceSlug === undefined ||
      (typeof record.workspaceSlug === "string" &&
        SLUG.test(record.workspaceSlug))) &&
    (record.conversationId === undefined ||
      (typeof record.conversationId === "string" &&
        UUID.test(record.conversationId))) &&
    (record.messageId === undefined ||
      (typeof record.messageId === "string" && UUID.test(record.messageId)))
  );
}

function safeWrite(
  storage: PunksKeyValueStorage,
  key: string,
  value: unknown,
): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are best effort and must never block a Punks read or write.
  }
}

/** Creates the restricted local persistence interface for one Punks origin. */
export function createPunksLocalStore(
  storage: PunksKeyValueStorage = window.localStorage,
  scope?: PunksStorageScope,
) {
  const keys = scope
    ? {
        preferences: `${PUNKS_STORAGE_KEYS.preferences}:${scope.origin}:${scope.punkId}`,
        lastWorkspace: `${PUNKS_STORAGE_KEYS.lastWorkspace}:${scope.origin}:${scope.punkId}`,
        route: `${PUNKS_STORAGE_KEYS.route}:${scope.origin}:${scope.punkId}`,
      }
    : PUNKS_STORAGE_KEYS;
  return {
    loadPreferences(): PunksLocalPreferences {
      const value = parseJson<unknown>(storage, keys.preferences);
      return normalizePreferences(value) ?? {};
    },
    savePreferences(preferences: PunksLocalPreferences): void {
      const normalized = normalizePreferences(preferences);
      if (normalized !== null) {
        safeWrite(storage, keys.preferences, normalized);
      }
    },
    loadLastWorkspaceId(): string | null {
      const value = parseJson<unknown>(storage, keys.lastWorkspace);
      return typeof value === "string" && UUID.test(value) ? value : null;
    },
    saveLastWorkspaceId(workspaceId: string): void {
      if (UUID.test(workspaceId)) {
        safeWrite(storage, keys.lastWorkspace, workspaceId);
      }
    },
    loadRouteCoordinates(): PunksRouteCoordinates {
      const value = parseJson<unknown>(storage, keys.route);
      return isRouteCoordinates(value) ? value : {};
    },
    saveRouteCoordinates(coordinates: PunksRouteCoordinates): void {
      if (isRouteCoordinates(coordinates)) {
        safeWrite(storage, keys.route, coordinates);
      }
    },
    removeAll(): void {
      try {
        for (const key of Object.values(keys)) {
          storage.removeItem(key);
        }
      } catch {
        // Local storage can be unavailable in a locked-down WebView.
      }
    },
  };
}
