/**
 * Canonical Punks desktop coordinates.
 *
 * The route carries human workspace identity for navigation, while the
 * account client resolves and opens the durable workspace id.  No legacy hash
 * route, query string, or alternate origin is accepted by this module.
 */

export type PunksRoute =
  | { kind: "home" }
  | { kind: "workspace"; workspaceSlug: string }
  | {
      kind: "conversation";
      workspaceSlug: string;
      conversationId: string;
    }
  | {
      kind: "message";
      workspaceSlug: string;
      conversationId: string;
      messageId: string;
    };

const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function canonicalSegment(value: string, pattern: RegExp): string | null {
  if (!pattern.test(value)) return null;
  try {
    // A percent-encoded or non-canonical spelling must be redirected by the
    // caller, never treated as a second route for the same resource.
    if (decodeURIComponent(value) !== value) return null;
  } catch {
    return null;
  }
  return value;
}

/** Returns the only accepted path for a Punks route. */
export function canonicalPunksPath(route: PunksRoute): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "workspace":
      return `/w/${route.workspaceSlug}`;
    case "conversation":
      return `/w/${route.workspaceSlug}/conversations/${route.conversationId}`;
    case "message":
      return `/w/${route.workspaceSlug}/conversations/${route.conversationId}/messages/${route.messageId}`;
  }
}

/** Parses a pathname only when it is already canonical. */
export function parsePunksPath(
  pathname: string,
  search = "",
  hash = "",
): PunksRoute | null {
  if (search !== "" || hash !== "") return null;
  if (pathname === "/") return { kind: "home" };
  if (!pathname.startsWith("/") || pathname.endsWith("/")) return null;

  const segments = pathname.slice(1).split("/");
  if (segments[0] !== "w") return null;
  const workspaceSlug = canonicalSegment(segments[1] ?? "", WORKSPACE_SLUG);
  if (workspaceSlug === null) return null;
  if (segments.length === 2) {
    return { kind: "workspace", workspaceSlug };
  }

  if (segments[2] !== "conversations") return null;
  const conversationId = canonicalSegment(segments[3] ?? "", UUID);
  if (conversationId === null) return null;
  if (segments.length === 4) {
    return { kind: "conversation", workspaceSlug, conversationId };
  }

  if (segments[4] !== "messages" || segments.length !== 6) return null;
  const messageId = canonicalSegment(segments[5] ?? "", UUID);
  return messageId === null
    ? null
    : { kind: "message", workspaceSlug, conversationId, messageId };
}

/**
 * Parses a full URL at the native envelope.  `expectedOrigin` is supplied by
 * the compatibility response and is never inferred from an untrusted URL.
 */
export function parsePunksUrl(
  rawUrl: string,
  expectedOrigin: string,
): PunksRoute | null {
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(expectedOrigin);
    actual = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    expected.pathname !== "/" ||
    expected.search !== "" ||
    expected.hash !== "" ||
    actual.origin !== expected.origin ||
    actual.username !== "" ||
    actual.password !== ""
  ) {
    return null;
  }
  return parsePunksPath(actual.pathname, actual.search, actual.hash);
}

/** Builds an absolute canonical URL after checking the configured origin. */
export function canonicalPunksUrl(
  route: PunksRoute,
  expectedOrigin: string,
): string {
  const origin = new URL(expectedOrigin);
  if (
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== ""
  ) {
    throw new Error("Punks origin is not canonical");
  }
  const path = canonicalPunksPath(route);
  if (parsePunksPath(path) === null) {
    throw new Error("Punks route is not canonical");
  }
  return new URL(path, origin).toString();
}

export function isPunksWorkspaceSlug(value: string): boolean {
  return canonicalSegment(value, WORKSPACE_SLUG) !== null;
}

export function isPunksUuid(value: string): boolean {
  return canonicalSegment(value, UUID) !== null;
}
