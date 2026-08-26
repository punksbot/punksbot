import { mediaUploadGrantClaims } from "@punks/core";

import type { MediaUploadInternalSnapshot } from "./media-upload-state";

const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}=`;
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey | null> {
  if (encoder.encode(secret).byteLength < 32) return null;
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signedPayload(
  snapshot: MediaUploadInternalSnapshot,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `${snapshot.expiresAtMs}.${mediaUploadGrantClaims(snapshot)}`,
  );
}

export async function mintMediaUploadGrantToken(
  secret: string,
  snapshot: MediaUploadInternalSnapshot,
): Promise<string | null> {
  try {
    const key = await hmacKey(secret);
    if (key === null) return null;
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      signedPayload(snapshot),
    );
    return `mug1.${snapshot.expiresAtMs}.${base64Url(signature)}`;
  } catch {
    return null;
  }
}

export async function verifyMediaUploadGrantToken(
  secret: string,
  snapshot: MediaUploadInternalSnapshot,
  token: string,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    const match = /^mug1\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/u.exec(token);
    const encodedExpiry = match?.[1];
    const encodedSignature = match?.[2];
    if (
      encodedExpiry === undefined ||
      encodedSignature === undefined ||
      Number(encodedExpiry) !== snapshot.expiresAtMs
    ) {
      return false;
    }
    if (snapshot.expiresAtMs <= nowMs) return false;
    const signature = decodeBase64Url(encodedSignature);
    const key = await hmacKey(secret);
    if (signature === null || key === null) return false;
    return crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      signedPayload(snapshot),
    );
  } catch {
    return false;
  }
}

export function mediaUploadGrantToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("PunksUpload ")) {
    return null;
  }
  const token = authorization.slice("PunksUpload ".length);
  return token.length <= 80 ? token : null;
}
