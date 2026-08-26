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
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function validScope(scope: WorkspaceGovernanceCursorScope): boolean {
  return (
    uuidPattern.test(scope.workspaceId) &&
    uuidPattern.test(scope.requesterPunkId) &&
    Number.isSafeInteger(scope.limit) &&
    scope.limit >= 1 &&
    scope.limit <= 100
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const word = (first << 16) | (second << 8) | third;
    output += base64Alphabet[(word >> 18) & 63];
    output += base64Alphabet[(word >> 12) & 63];
    output += index + 1 < bytes.length ? base64Alphabet[(word >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? base64Alphabet[word & 63] : "=";
  }
  return output.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new Error(invalidMessage);
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
  if (base64UrlEncode(decoded) !== value) throw new Error(invalidMessage);
  return decoded;
}

async function hmacKey(
  key: Uint8Array,
  usages: readonly ("sign" | "verify")[],
): Promise<CryptoKey> {
  if (key.byteLength < 32) {
    throw new Error(
      "Workspace governance cursor key must contain at least 32 bytes",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages,
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
  return candidate as unknown as CursorPayload;
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
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(body)),
  );
  const signed = `${prefix}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(key, ["sign"]),
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Verifies a continuation for only the exact requesting Punk and Workspace. */
export async function decodeWorkspaceGovernanceCursor(
  encoded: string,
  scope: WorkspaceGovernanceCursorScope,
  key: Uint8Array,
): Promise<WorkspaceGovernanceCursor> {
  const segments = encoded.split(".");
  const [actualPrefix, encodedPayload, encodedSignature] = segments;
  if (
    segments.length !== 3 ||
    actualPrefix !== prefix ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !validScope(scope)
  ) {
    throw new Error(invalidMessage);
  }
  try {
    const signed = `${actualPrefix}.${encodedPayload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(key, ["verify"]),
      Uint8Array.from(base64UrlDecode(encodedSignature)).buffer,
      new TextEncoder().encode(signed),
    );
    if (!valid) throw new Error(invalidMessage);
    const decoded = payload(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          base64UrlDecode(encodedPayload),
        ),
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
