import {
  MESSAGE_SEARCH_ALGORITHM,
  MESSAGE_SEARCH_NORMALIZATION,
} from "./message-search";

export { MESSAGE_SEARCH_NORMALIZATION } from "./message-search";

export interface MessageSearchCursorQueryTokens {
  punkId: string;
  workspaceId: string;
  conversationId: string;
  algorithm: typeof MESSAGE_SEARCH_ALGORITHM;
  tokens: string[];
}

/** Security and semantic scope that every public continuation is bound to. */
export interface MessageSearchCursorScope {
  punkId: string;
  workspaceId: string;
  conversationId: string;
  threadRootMessageId: string | null;
  algorithm: typeof MESSAGE_SEARCH_ALGORITHM;
  normalization: typeof MESSAGE_SEARCH_NORMALIZATION;
  /** Domain-separated keyed binding stored only inside the encrypted payload. */
  queryBinding: string;
  limit: number;
}

export type MessageSearchCandidatePosition = readonly [
  createdCursor: number,
  conversationId: string,
  messageId: string,
];

export interface MessageSearchCursor extends MessageSearchCursorScope {
  version: 1;
  position: MessageSearchCandidatePosition;
}

interface CursorPayload {
  v: 1;
  p: string;
  w: string;
  c: string;
  r: string | null;
  n: typeof MESSAGE_SEARCH_NORMALIZATION;
  a: typeof MESSAGE_SEARCH_ALGORITHM;
  q: string;
  l: number;
  t: MessageSearchCandidatePosition;
}

const cursorPrefix = "msc1";
const invalidCursorMessage = "Invalid Message search cursor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenPattern = /^h2_[A-Za-z0-9_-]{43}$/u;
const bindingPattern = /^[A-Za-z0-9_-]{43}$/u;
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const hkdfSalt = new TextEncoder().encode(
  "punks.message-search-cursor.hkdf.v1",
);
const cursorAdditionalData = new TextEncoder().encode(cursorPrefix);

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

async function rootKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength < 32) {
    throw new Error("Message search cursor key must contain at least 32 bytes");
  }
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key).buffer,
    "HKDF",
    false,
    ["deriveKey"],
  );
}

async function deriveAeadKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hkdfSalt,
      info: new TextEncoder().encode("cursor-aead"),
    },
    await rootKey(key),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveQueryBindingKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hkdfSalt,
      info: new TextEncoder().encode("query-binding"),
    },
    await rootKey(key),
    { hash: "SHA-256", name: "HMAC", length: 256 },
    false,
    ["sign"],
  );
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function hasValidScope(value: unknown): value is MessageSearchCursorScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const scope = value as Record<string, unknown>;
  return (
    isValidUuid(scope.punkId) &&
    isValidUuid(scope.workspaceId) &&
    isValidUuid(scope.conversationId) &&
    (scope.threadRootMessageId === null ||
      isValidUuid(scope.threadRootMessageId)) &&
    scope.algorithm === MESSAGE_SEARCH_ALGORITHM &&
    scope.normalization === MESSAGE_SEARCH_NORMALIZATION &&
    typeof scope.queryBinding === "string" &&
    bindingPattern.test(scope.queryBinding) &&
    Number.isSafeInteger(scope.limit) &&
    (scope.limit as number) >= 1 &&
    (scope.limit as number) <= 100
  );
}

function isExactScope(value: unknown): value is MessageSearchCursorScope {
  return (
    hasValidScope(value) &&
    Object.keys(value).sort().join(",") ===
      "algorithm,conversationId,limit,normalization,punkId,queryBinding,threadRootMessageId,workspaceId"
  );
}

function isValidPosition(
  value: unknown,
): value is MessageSearchCandidatePosition {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    Number.isSafeInteger(value[0]) &&
    value[0] >= 1 &&
    isValidUuid(value[1]) &&
    isValidUuid(value[2])
  );
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    Object.keys(payload).sort().join(",") === "a,c,l,n,p,q,r,t,v,w" &&
    payload.v === 1 &&
    isExactScope({
      punkId: payload.p,
      workspaceId: payload.w,
      conversationId: payload.c,
      threadRootMessageId: payload.r,
      algorithm: payload.a,
      normalization: payload.n,
      queryBinding: payload.q,
      limit: payload.l,
    }) &&
    isValidPosition(payload.t) &&
    payload.t[1] === payload.c
  );
}

/**
 * Binds one Punk's semantic AND-query to a Conversation without exposing its
 * plaintext or opaque index tokens. Token order is irrelevant to the query.
 */
export async function deriveMessageSearchCursorQueryBinding(
  input: MessageSearchCursorQueryTokens,
  key: Uint8Array,
): Promise<string> {
  if (
    !isValidUuid(input.punkId) ||
    !isValidUuid(input.workspaceId) ||
    !isValidUuid(input.conversationId) ||
    input.algorithm !== MESSAGE_SEARCH_ALGORITHM ||
    !Array.isArray(input.tokens) ||
    input.tokens.length < 1 ||
    input.tokens.length > 32 ||
    !input.tokens.every((token) => tokenPattern.test(token)) ||
    new Set(input.tokens).size !== input.tokens.length
  ) {
    throw new Error("Invalid Message search query binding input");
  }
  const canonicalTokens = [...input.tokens].sort();
  const payload = new TextEncoder().encode(
    [
      "punks.message-search-cursor.query.v1",
      input.punkId,
      input.workspaceId,
      input.conversationId,
      input.algorithm,
      ...canonicalTokens,
    ].join("\u0000"),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await deriveQueryBindingKey(key),
    payload,
  );
  return base64UrlEncode(new Uint8Array(signature));
}

/** Encrypts and authenticates a continuation for one Punk and Conversation. */
export async function encodeMessageSearchCursor(
  cursor: MessageSearchCursor,
  key: Uint8Array,
): Promise<string> {
  if (
    cursor.version !== 1 ||
    Object.keys(cursor).sort().join(",") !==
      "algorithm,conversationId,limit,normalization,position,punkId,queryBinding,threadRootMessageId,version,workspaceId" ||
    !hasValidScope(cursor) ||
    !isValidPosition(cursor.position) ||
    cursor.position[1] !== cursor.conversationId
  ) {
    throw new Error("Invalid Message search cursor input");
  }
  const payload: CursorPayload = {
    v: 1,
    p: cursor.punkId,
    w: cursor.workspaceId,
    c: cursor.conversationId,
    r: cursor.threadRootMessageId,
    n: cursor.normalization,
    a: cursor.algorithm,
    q: cursor.queryBinding,
    l: cursor.limit,
    t: cursor.position,
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: cursorAdditionalData,
      tagLength: 128,
    },
    await deriveAeadKey(key),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${cursorPrefix}.${base64UrlEncode(iv)}.${base64UrlEncode(
    new Uint8Array(ciphertext),
  )}`;
}

/** Decrypts a continuation and requires its complete expected current scope. */
export async function decodeMessageSearchCursor(
  encoded: string,
  expectedScope: MessageSearchCursorScope,
  key: Uint8Array,
): Promise<MessageSearchCursor> {
  if (encoded.length < 50 || encoded.length > 1_024) {
    throw new Error(invalidCursorMessage);
  }
  const segments = encoded.split(".");
  const [prefix, encodedIv, encodedCiphertext] = segments;
  if (
    segments.length !== 3 ||
    prefix !== cursorPrefix ||
    encodedIv === undefined ||
    encodedCiphertext === undefined ||
    !isExactScope(expectedScope)
  ) {
    throw new Error(invalidCursorMessage);
  }
  const aeadKey = await deriveAeadKey(key);
  try {
    const iv = base64UrlDecode(encodedIv);
    const ciphertext = base64UrlDecode(encodedCiphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new Error(invalidCursorMessage);
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(iv).buffer,
        additionalData: cursorAdditionalData,
        tagLength: 128,
      },
      aeadKey,
      Uint8Array.from(ciphertext).buffer,
    );
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
    if (
      !isCursorPayload(decoded) ||
      decoded.p !== expectedScope.punkId ||
      decoded.w !== expectedScope.workspaceId ||
      decoded.c !== expectedScope.conversationId ||
      decoded.r !== expectedScope.threadRootMessageId ||
      decoded.n !== expectedScope.normalization ||
      decoded.a !== expectedScope.algorithm ||
      decoded.q !== expectedScope.queryBinding ||
      decoded.l !== expectedScope.limit
    ) {
      throw new Error(invalidCursorMessage);
    }
    return {
      version: decoded.v,
      punkId: decoded.p,
      workspaceId: decoded.w,
      conversationId: decoded.c,
      threadRootMessageId: decoded.r,
      normalization: decoded.n,
      algorithm: decoded.a,
      queryBinding: decoded.q,
      limit: decoded.l,
      position: decoded.t,
    };
  } catch {
    throw new Error(invalidCursorMessage);
  }
}
