import { decodeSignedCursor, encodeSignedCursor } from "./signed-cursor-codec";

/** Directory and identity boundary to which a continuation is cryptographically bound. */
export interface DirectoryCursorScope {
  kind: "workspaces" | "streams";
  punkId: string;
  workspaceId?: string;
}

/** Stable projection position. The encoded representation is intentionally opaque. */
export interface DirectoryCursor extends DirectoryCursorScope {
  version: 1;
  positionId: string;
}

interface CursorPayload {
  v: 1;
  k: "w" | "s";
  p: string;
  a: string;
  w?: string;
}

const cursorPrefix = "pdc1";
const invalidCursorMessage = "Invalid directory cursor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validScope(scope: DirectoryCursorScope): boolean {
  return (
    (scope.kind === "workspaces" || scope.kind === "streams") &&
    uuidPattern.test(scope.punkId) &&
    (scope.kind === "streams"
      ? typeof scope.workspaceId === "string" &&
        uuidPattern.test(scope.workspaceId)
      : scope.workspaceId === undefined)
  );
}

function cursorPayload(value: unknown): CursorPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const expectedFields =
    candidate.k === "s" ? ["v", "k", "p", "a", "w"] : ["v", "k", "p", "a"];
  if (
    Object.keys(candidate).length !== expectedFields.length ||
    !expectedFields.every((field) => Object.hasOwn(candidate, field)) ||
    candidate.v !== 1 ||
    (candidate.k !== "w" && candidate.k !== "s") ||
    typeof candidate.p !== "string" ||
    !uuidPattern.test(candidate.p) ||
    typeof candidate.a !== "string" ||
    !uuidPattern.test(candidate.a) ||
    (candidate.k === "s"
      ? typeof candidate.w === "string" && uuidPattern.test(candidate.w)
      : candidate.w === undefined) === false
  ) {
    return null;
  }
  if (candidate.k === "s") {
    const workspaceId = candidate.w;
    if (typeof workspaceId !== "string") return null;
    return { v: 1, k: "s", p: candidate.p, a: candidate.a, w: workspaceId };
  }
  return { v: 1, k: "w", p: candidate.p, a: candidate.a };
}

/** Encodes a signed URL-safe continuation without exposing its position. */
export async function encodeDirectoryCursor(
  cursor: DirectoryCursor,
  key: Uint8Array,
): Promise<string> {
  if (
    cursor.version !== 1 ||
    !validScope(cursor) ||
    !uuidPattern.test(cursor.positionId)
  ) {
    throw new Error("Invalid directory cursor input");
  }
  const payload: CursorPayload = {
    v: 1,
    k: cursor.kind === "workspaces" ? "w" : "s",
    p: cursor.positionId,
    a: cursor.punkId,
    ...(cursor.workspaceId === undefined ? {} : { w: cursor.workspaceId }),
  };
  return encodeSignedCursor(
    cursorPrefix,
    payload,
    key,
    "Directory cursor key must contain at least 32 bytes",
  );
}

/** Authenticates and decodes a continuation only for the exact expected scope. */
export async function decodeDirectoryCursor(
  encoded: string,
  expectedScope: DirectoryCursorScope,
  key: Uint8Array,
): Promise<DirectoryCursor> {
  if (!validScope(expectedScope)) {
    throw new Error(invalidCursorMessage);
  }
  try {
    const payload = cursorPayload(
      await decodeSignedCursor(
        encoded,
        cursorPrefix,
        key,
        invalidCursorMessage,
        "Directory cursor key must contain at least 32 bytes",
      ),
    );
    if (
      payload === null ||
      payload.a !== expectedScope.punkId ||
      payload.k !== (expectedScope.kind === "workspaces" ? "w" : "s") ||
      payload.w !== expectedScope.workspaceId
    ) {
      throw new Error(invalidCursorMessage);
    }
    return {
      version: 1,
      kind: expectedScope.kind,
      punkId: payload.a,
      positionId: payload.p,
      ...(payload.w === undefined ? {} : { workspaceId: payload.w }),
    };
  } catch {
    throw new Error(invalidCursorMessage);
  }
}
