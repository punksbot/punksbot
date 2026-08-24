/** Workspace and Conversation boundary to which a history cursor is bound. */
export interface MessageHistoryCursorScope {
  workspaceId: string;
  conversationId: string;
  /** Optional thread filter; when present it is part of the signed scope. */
  threadRootMessageId?: string;
}

/** Stable position inside one authoritative Conversation history snapshot. */
export interface MessageHistoryCursor extends MessageHistoryCursorScope {
  version: 1;
  /** Conversation cursor captured when the first page is read. */
  highWaterCursor: number;
  /** Stable Message `createdCursor`; edits and retractions never replace it. */
  positionCursor: number;
  /** Traversal relative to `positionCursor` inside the frozen snapshot. */
  direction: "older" | "newer";
}

interface CursorPayload {
  v: 1;
  w: string;
  c: string;
  h: number;
  p: number;
  d: "o" | "n";
  t?: string;
}

const cursorPrefix = "mhc1";
const invalidCursorMessage = "Invalid Message history cursor";
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function hasValidPosition(
  highWaterCursor: number,
  positionCursor: number,
): boolean {
  return (
    Number.isSafeInteger(highWaterCursor) &&
    highWaterCursor >= 1 &&
    Number.isSafeInteger(positionCursor) &&
    positionCursor >= 1 &&
    positionCursor <= highWaterCursor
  );
}

function hasValidScope(
  scope: MessageHistoryCursorScope | null | undefined,
): boolean {
  return (
    typeof scope === "object" &&
    scope !== null &&
    typeof scope.workspaceId === "string" &&
    scope.workspaceId.trim().length > 0 &&
    typeof scope.conversationId === "string" &&
    scope.conversationId.trim().length > 0 &&
    (scope.threadRootMessageId === undefined ||
      (typeof scope.threadRootMessageId === "string" &&
        scope.threadRootMessageId.trim().length > 0))
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
    throw new Error(
      "Message history cursor key must contain at least 32 bytes",
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

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const expectedFields = ["v", "w", "c", "h", "p", "d"];
  const actualFields = Object.keys(candidate);
  return (
    (actualFields.length === expectedFields.length ||
      (actualFields.length === expectedFields.length + 1 &&
        Object.hasOwn(candidate, "t"))) &&
    expectedFields.every((field) => Object.hasOwn(candidate, field)) &&
    candidate.v === 1 &&
    typeof candidate.w === "string" &&
    candidate.w.trim().length > 0 &&
    typeof candidate.c === "string" &&
    candidate.c.trim().length > 0 &&
    typeof candidate.h === "number" &&
    typeof candidate.p === "number" &&
    hasValidPosition(candidate.h, candidate.p) &&
    (candidate.d === "o" || candidate.d === "n") &&
    (candidate.t === undefined ||
      (typeof candidate.t === "string" && candidate.t.trim().length > 0))
  );
}

/** Encodes a signed, URL-safe Message history position. */
export async function encodeMessageHistoryCursor(
  cursor: MessageHistoryCursor,
  key: Uint8Array,
): Promise<string> {
  if (
    cursor.version !== 1 ||
    (cursor.direction !== "older" && cursor.direction !== "newer") ||
    !hasValidScope(cursor) ||
    !hasValidPosition(cursor.highWaterCursor, cursor.positionCursor)
  ) {
    throw new Error("Invalid Message history cursor input");
  }
  const payload: CursorPayload = {
    v: cursor.version,
    w: cursor.workspaceId,
    c: cursor.conversationId,
    h: cursor.highWaterCursor,
    p: cursor.positionCursor,
    d: cursor.direction === "older" ? "o" : "n",
    ...(cursor.threadRootMessageId === undefined
      ? {}
      : { t: cursor.threadRootMessageId }),
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

/**
 * Authenticates and decodes a Message history position for the expected scope.
 */
export async function decodeMessageHistoryCursor(
  encoded: string,
  expectedScope: MessageHistoryCursorScope,
  key: Uint8Array,
): Promise<MessageHistoryCursor> {
  const segments = encoded.split(".");
  const [prefix, encodedPayload, encodedSignature] = segments;
  if (
    segments.length !== 3 ||
    prefix !== cursorPrefix ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !hasValidScope(expectedScope)
  ) {
    throw new Error(invalidCursorMessage);
  }
  const verificationKey = await hmacKey(key, ["verify"]);
  try {
    const signed = `${prefix}.${encodedPayload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      verificationKey,
      Uint8Array.from(base64UrlDecode(encodedSignature)).buffer,
      new TextEncoder().encode(signed),
    );
    if (!valid) {
      throw new Error(invalidCursorMessage);
    }
    const decodedPayload: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlDecode(encodedPayload),
      ),
    );
    if (
      !isCursorPayload(decodedPayload) ||
      decodedPayload.w !== expectedScope.workspaceId ||
      decodedPayload.c !== expectedScope.conversationId ||
      decodedPayload.t !== expectedScope.threadRootMessageId
    ) {
      throw new Error(invalidCursorMessage);
    }
    return {
      version: decodedPayload.v,
      workspaceId: decodedPayload.w,
      conversationId: decodedPayload.c,
      highWaterCursor: decodedPayload.h,
      positionCursor: decodedPayload.p,
      direction: decodedPayload.d === "o" ? "older" : "newer",
      ...(decodedPayload.t === undefined
        ? {}
        : { threadRootMessageId: decodedPayload.t }),
    };
  } catch {
    throw new Error(invalidCursorMessage);
  }
}
