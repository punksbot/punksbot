import { schnorr } from "@noble/curves/secp256k1.js";
import type { SignedNostrEvent, UnsignedNostrEvent } from "@punks/contracts";

const hexPattern = /^[0-9a-f]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array {
  if (!hexPattern.test(value)) {
    throw new TypeError(
      "Attestation private key must be 32 lowercase hexadecimal bytes",
    );
  }
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

export function serializeNostrEvent(
  pubkey: string,
  event: UnsignedNostrEvent,
): string {
  return JSON.stringify([
    0,
    pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

export async function attestNostrEvent(
  unsigned: UnsignedNostrEvent,
  privateKeyHex: string,
  keyVersion: string,
): Promise<SignedNostrEvent> {
  if (unsigned.tags.some(([name]) => name === "attestation")) {
    throw new TypeError("Caller cannot supply an attestation tag");
  }

  const privateKey = hexToBytes(privateKeyHex);
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey));
  const eventWithVersion: UnsignedNostrEvent = {
    ...unsigned,
    tags: [...unsigned.tags, ["attestation", keyVersion]],
  };
  const serialized = serializeNostrEvent(pubkey, eventWithVersion);
  const idBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)),
  );
  const signature = schnorr.sign(idBytes, privateKey);

  return {
    ...eventWithVersion,
    id: bytesToHex(idBytes),
    pubkey,
    sig: bytesToHex(signature),
  };
}
