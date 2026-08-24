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
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
    throw new Error(invalidCursorMessage);
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
  if (base64UrlEncode(decoded) !== value) {
    throw new Error(invalidCursorMessage);
  }
  return decoded;
}

async function hmacKey(
  key: Uint8Array,
  usages: readonly ("sign" | "verify")[],
): Promise<CryptoKey> {
  if (key.byteLength < 32) {
    throw new Error("Directory cursor key must contain at least 32 bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages,
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
  return candidate as unknown as CursorPayload;
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
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signed = `${cursorPrefix}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(key, ["sign"]),
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Authenticates and decodes a continuation only for the exact expected scope. */
export async function decodeDirectoryCursor(
  encoded: string,
  expectedScope: DirectoryCursorScope,
  key: Uint8Array,
): Promise<DirectoryCursor> {
  const segments = encoded.split(".");
  const [prefix, encodedPayload, encodedSignature] = segments;
  if (
    segments.length !== 3 ||
    prefix !== cursorPrefix ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !validScope(expectedScope)
  ) {
    throw new Error(invalidCursorMessage);
  }
  try {
    const signed = `${prefix}.${encodedPayload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(key, ["verify"]),
      Uint8Array.from(base64UrlDecode(encodedSignature)).buffer,
      new TextEncoder().encode(signed),
    );
    if (!valid) throw new Error(invalidCursorMessage);
    const payload = cursorPayload(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          base64UrlDecode(encodedPayload),
        ),
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
