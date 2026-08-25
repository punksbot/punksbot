/** Minimum number of Unicode letters or digits required by a prefix search. */
export const PUNK_SEARCH_MIN_PREFIX_SCALARS = 3;
/** Maximum number of summaries returned by one public search page. */
export const PUNK_SEARCH_MAX_PAGE_SIZE = 20;
/** Maximum number of summaries obtainable from one prefix-search intention. */
export const PUNK_SEARCH_MAX_RESULTS = 40;

const DISPLAY_NAME_MAX_SCALARS = 80;
const cursorPrefix = "psc1";
const invalidCursorMessage = "Invalid Punk search cursor";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const bindingPattern = /^[A-Za-z0-9_-]{43}$/u;
const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const hkdfSalt = new TextEncoder().encode("punks.punk-search-cursor.hkdf.v1");
const cursorAdditionalData = new TextEncoder().encode(cursorPrefix);

/** The complete semantic scope to which a public continuation is bound. */
export interface PunkSearchCursorScope {
  requesterPunkId: string;
  workspaceId: string;
  queryBinding: string;
  limit: number;
}

/** Encrypted continuation state; no position or query metadata is public. */
export interface PunkSearchCursor extends PunkSearchCursorScope {
  version: 1;
  positionPunkId: string;
  remaining: number;
}

interface CursorPayload {
  v: 1;
  p: string;
  w: string;
  q: string;
  l: number;
  a: string;
  r: number;
}

function scalarLength(value: string): number {
  return [...value].length;
}

function hasForbiddenControl(value: string): boolean {
  return [...value].some((scalar) => {
    const codePoint = scalar.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

/** Canonical editable display name stored by the Compte Punks authority. */
export function canonicalPunkDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Punk display name is invalid");
  }
  const canonical = value.trim().normalize("NFC");
  const length = scalarLength(canonical);
  if (
    length < 1 ||
    length > DISPLAY_NAME_MAX_SCALARS ||
    hasForbiddenControl(canonical)
  ) {
    throw new Error("Punk display name is invalid");
  }
  return canonical;
}

/** Canonical HTTPS avatar URI accepted by the initial profile contract. */
export function canonicalPunkAvatarUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error("Punk avatar URL is invalid");
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hostname === ""
    ) {
      throw new Error("Punk avatar URL is invalid");
    }
    const canonical = parsed.href;
    if (canonical.length > 2_048) {
      throw new Error("Punk avatar URL is invalid");
    }
    return canonical;
  } catch {
    throw new Error("Punk avatar URL is invalid");
  }
}

/** Stable case-insensitive projection key derived from an authoritative name. */
export function canonicalPunkSearchKey(displayName: unknown): string {
  return canonicalPunkDisplayName(displayName)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
}

/** Canonical constrained prefix; empty, short and punctuation-only scans fail. */
export function canonicalPunkSearchPrefix(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Punk search prefix is invalid");
  }
  const canonical = value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  const length = scalarLength(canonical);
  const significant = [...canonical].filter((scalar) =>
    /[\p{L}\p{N}]/u.test(scalar),
  );
  if (
    length > DISPLAY_NAME_MAX_SCALARS ||
    significant.length < PUNK_SEARCH_MIN_PREFIX_SCALARS ||
    hasForbiddenControl(canonical)
  ) {
    throw new Error("Punk search prefix is invalid");
  }
  return canonical;
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

async function rootKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength < 32) {
    throw new Error("Punk search cursor key must contain at least 32 bytes");
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function hasValidScope(value: unknown): value is PunkSearchCursorScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const scope = value as Record<string, unknown>;
  return (
    isUuid(scope.requesterPunkId) &&
    isUuid(scope.workspaceId) &&
    typeof scope.queryBinding === "string" &&
    bindingPattern.test(scope.queryBinding) &&
    Number.isSafeInteger(scope.limit) &&
    Number(scope.limit) >= 1 &&
    Number(scope.limit) <= PUNK_SEARCH_MAX_PAGE_SIZE
  );
}

function isExactScope(value: unknown): value is PunkSearchCursorScope {
  return (
    hasValidScope(value) &&
    Object.keys(value).sort().join(",") ===
      "limit,queryBinding,requesterPunkId,workspaceId"
  );
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    Object.keys(payload).sort().join(",") === "a,l,p,q,r,v,w" &&
    payload.v === 1 &&
    isExactScope({
      requesterPunkId: payload.p,
      workspaceId: payload.w,
      queryBinding: payload.q,
      limit: payload.l,
    }) &&
    isUuid(payload.a) &&
    Number.isSafeInteger(payload.r) &&
    Number(payload.r) >= 1 &&
    Number(payload.r) <= PUNK_SEARCH_MAX_RESULTS
  );
}

/** Creates a domain-separated binding for one normalized prefix intention. */
export async function derivePunkSearchQueryBinding(
  input: { requesterPunkId: string; workspaceId: string; prefix: string },
  key: Uint8Array,
): Promise<string> {
  if (
    !isUuid(input.requesterPunkId) ||
    !isUuid(input.workspaceId) ||
    Object.keys(input).sort().join(",") !== "prefix,requesterPunkId,workspaceId"
  ) {
    throw new Error("Invalid Punk search query binding input");
  }
  const prefix = canonicalPunkSearchPrefix(input.prefix);
  const payload = new TextEncoder().encode(
    [
      "punks.punk-search-cursor.query.v1",
      input.requesterPunkId,
      input.workspaceId,
      prefix,
    ].join("\u0000"),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await deriveQueryBindingKey(key),
    payload,
  );
  return base64UrlEncode(new Uint8Array(signature));
}

/** Encrypts one continuation and its remaining public-result budget. */
export async function encodePunkSearchCursor(
  cursor: PunkSearchCursor,
  key: Uint8Array,
): Promise<string> {
  if (
    Object.keys(cursor).sort().join(",") !==
      "limit,positionPunkId,queryBinding,remaining,requesterPunkId,version,workspaceId" ||
    cursor.version !== 1 ||
    !hasValidScope(cursor) ||
    !isUuid(cursor.positionPunkId) ||
    !Number.isSafeInteger(cursor.remaining) ||
    cursor.remaining < 1 ||
    cursor.remaining > PUNK_SEARCH_MAX_RESULTS
  ) {
    throw new Error("Invalid Punk search cursor input");
  }
  const payload: CursorPayload = {
    v: 1,
    p: cursor.requesterPunkId,
    w: cursor.workspaceId,
    q: cursor.queryBinding,
    l: cursor.limit,
    a: cursor.positionPunkId,
    r: cursor.remaining,
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

/** Decrypts a continuation only in its complete current semantic scope. */
export async function decodePunkSearchCursor(
  encoded: string,
  expectedScope: PunkSearchCursorScope,
  key: Uint8Array,
): Promise<PunkSearchCursor> {
  if (
    encoded.length < 50 ||
    encoded.length > 1_024 ||
    !isExactScope(expectedScope)
  ) {
    throw new Error(invalidCursorMessage);
  }
  const [prefix, encodedIv, encodedCiphertext, ...rest] = encoded.split(".");
  if (
    rest.length !== 0 ||
    prefix !== cursorPrefix ||
    encodedIv === undefined ||
    encodedCiphertext === undefined
  ) {
    throw new Error(invalidCursorMessage);
  }
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
      await deriveAeadKey(key),
      Uint8Array.from(ciphertext).buffer,
    );
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
    if (
      !isCursorPayload(decoded) ||
      decoded.p !== expectedScope.requesterPunkId ||
      decoded.w !== expectedScope.workspaceId ||
      decoded.q !== expectedScope.queryBinding ||
      decoded.l !== expectedScope.limit
    ) {
      throw new Error(invalidCursorMessage);
    }
    return {
      version: decoded.v,
      requesterPunkId: decoded.p,
      workspaceId: decoded.w,
      queryBinding: decoded.q,
      limit: decoded.l,
      positionPunkId: decoded.a,
      remaining: decoded.r,
    };
  } catch {
    throw new Error(invalidCursorMessage);
  }
}
