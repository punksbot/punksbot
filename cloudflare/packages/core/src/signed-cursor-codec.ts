const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

function base64UrlDecode(value: string, invalidMessage: string): Uint8Array {
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
  keyMessage: string,
): Promise<CryptoKey> {
  if (key.byteLength < 32) throw new Error(keyMessage);
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages,
  );
}

export async function encodeSignedCursor(
  prefix: string,
  payload: object,
  key: Uint8Array,
  keyMessage: string,
): Promise<string> {
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signed = `${prefix}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(key, ["sign"], keyMessage),
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function decodeSignedCursor(
  encoded: string,
  expectedPrefix: string,
  key: Uint8Array,
  invalidMessage: string,
  keyMessage: string,
): Promise<unknown> {
  const segments = encoded.split(".");
  const [prefix, encodedPayload, encodedSignature] = segments;
  if (
    segments.length !== 3 ||
    prefix !== expectedPrefix ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    throw new Error(invalidMessage);
  }
  try {
    const signed = `${prefix}.${encodedPayload}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(key, ["verify"], keyMessage),
      Uint8Array.from(base64UrlDecode(encodedSignature, invalidMessage)).buffer,
      new TextEncoder().encode(signed),
    );
    if (!valid) throw new Error(invalidMessage);
    const payload: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64UrlDecode(encodedPayload, invalidMessage),
      ),
    );
    return payload;
  } catch {
    throw new Error(invalidMessage);
  }
}
