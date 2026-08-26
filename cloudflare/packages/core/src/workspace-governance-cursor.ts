import { decodeSignedCursor, encodeSignedCursor } from "./signed-cursor-codec";

/** Request scope cryptographically bound into a governance roster cursor. */
export interface WorkspaceGovernanceCursorScope {
  workspaceId: string;
  requesterPunkId: string;
  limit: number;
}

/** Decoded governance continuation tied to one authority revision and Punk. */
export interface WorkspaceGovernanceCursor
  extends WorkspaceGovernanceCursorScope {
  version: 1;
  authorityCursor: number;
  positionPunkId: string;
}

interface CursorPayload {
  v: 1;
  w: string;
  a: string;
  l: number;
  c: number;
  p: string;
}

const prefix = "pmc1";
const invalidMessage = "Invalid Workspace governance cursor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validScope(scope: WorkspaceGovernanceCursorScope): boolean {
  return (
    uuidPattern.test(scope.workspaceId) &&
    uuidPattern.test(scope.requesterPunkId) &&
    Number.isSafeInteger(scope.limit) &&
    scope.limit >= 1 &&
    scope.limit <= 100
  );
}

function payload(value: unknown): CursorPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "a,c,l,p,v,w" ||
    candidate.v !== 1 ||
    typeof candidate.w !== "string" ||
    !uuidPattern.test(candidate.w) ||
    typeof candidate.a !== "string" ||
    !uuidPattern.test(candidate.a) ||
    !Number.isSafeInteger(candidate.l) ||
    Number(candidate.l) < 1 ||
    Number(candidate.l) > 100 ||
    !Number.isSafeInteger(candidate.c) ||
    Number(candidate.c) < 1 ||
    typeof candidate.p !== "string" ||
    !uuidPattern.test(candidate.p)
  ) {
    return null;
  }
  return {
    v: 1,
    w: candidate.w,
    a: candidate.a,
    l: Number(candidate.l),
    c: Number(candidate.c),
    p: candidate.p,
  };
}

/** Signs a roster position together with the exact authoritative cursor. */
export async function encodeWorkspaceGovernanceCursor(
  cursor: WorkspaceGovernanceCursor,
  key: Uint8Array,
): Promise<string> {
  if (
    cursor.version !== 1 ||
    !validScope(cursor) ||
    !Number.isSafeInteger(cursor.authorityCursor) ||
    cursor.authorityCursor < 1 ||
    !uuidPattern.test(cursor.positionPunkId)
  ) {
    throw new Error("Invalid Workspace governance cursor input");
  }
  const body: CursorPayload = {
    v: 1,
    w: cursor.workspaceId,
    a: cursor.requesterPunkId,
    l: cursor.limit,
    c: cursor.authorityCursor,
    p: cursor.positionPunkId,
  };
  return encodeSignedCursor(
    prefix,
    body,
    key,
    "Workspace governance cursor key must contain at least 32 bytes",
  );
}

/** Verifies a continuation for only the exact requesting Punk and Workspace. */
export async function decodeWorkspaceGovernanceCursor(
  encoded: string,
  scope: WorkspaceGovernanceCursorScope,
  key: Uint8Array,
): Promise<WorkspaceGovernanceCursor> {
  if (!validScope(scope)) {
    throw new Error(invalidMessage);
  }
  try {
    const decoded = payload(
      await decodeSignedCursor(
        encoded,
        prefix,
        key,
        invalidMessage,
        "Workspace governance cursor key must contain at least 32 bytes",
      ),
    );
    if (
      decoded === null ||
      decoded.w !== scope.workspaceId ||
      decoded.a !== scope.requesterPunkId ||
      decoded.l !== scope.limit
    ) {
      throw new Error(invalidMessage);
    }
    return {
      version: 1,
      workspaceId: decoded.w,
      requesterPunkId: decoded.a,
      limit: decoded.l,
      authorityCursor: decoded.c,
      positionPunkId: decoded.p,
    };
  } catch {
    throw new Error(invalidMessage);
  }
}
