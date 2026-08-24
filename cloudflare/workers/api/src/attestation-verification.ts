import { schnorr } from "@noble/curves/secp256k1.js";
import type {
  AttestationResponse,
  SignedNostrEvent,
  UnsignedNostrEvent,
} from "@punks/contracts";

import type { ApiEnv } from "./env";

const hex64 = /^[0-9a-f]{64}$/;
const hex128 = /^[0-9a-f]{128}$/;
const keyVersionPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function currentRegistry(env: ApiEnv): Readonly<Record<string, string>> | null {
  try {
    const parsed = JSON.parse(env.ATTESTATION_PUBLIC_KEYS_JSON) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const environmentNames = Object.keys(parsed);
    if (
      environmentNames.length < 1 ||
      environmentNames.some(
        (environment) => environment !== "local" && environment !== "staging",
      )
    ) {
      return null;
    }
    for (const environment of environmentNames) {
      const versions = parsed[environment];
      if (!isRecord(versions) || Object.keys(versions).length < 1) {
        return null;
      }
      const publicKeys = new Set<string>();
      for (const [keyVersion, pubkey] of Object.entries(versions)) {
        if (
          !keyVersionPattern.test(keyVersion) ||
          typeof pubkey !== "string" ||
          !hex64.test(pubkey) ||
          publicKeys.has(pubkey)
        ) {
          return null;
        }
        publicKeys.add(pubkey);
      }
    }
    const current = parsed[env.ENVIRONMENT];
    return isRecord(current) ? (current as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** Verifies NIP-01 identity and BIP-340 against the environment key registry. */
export async function verifyAttestation(
  event: SignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  const attestationTags = event.tags.filter(([name]) => name === "attestation");
  const attestation = attestationTags[0];
  if (
    attestationTags.length !== 1 ||
    event.tags.at(-1) !== attestation ||
    attestation?.length !== 2 ||
    !keyVersionPattern.test(attestation[1] ?? "") ||
    !hex64.test(event.id) ||
    !hex64.test(event.pubkey) ||
    !hex128.test(event.sig)
  ) {
    return false;
  }
  const registeredPubkey = currentRegistry(env)?.[attestation[1] ?? ""];
  if (registeredPubkey === undefined || registeredPubkey !== event.pubkey) {
    return false;
  }
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const idBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)),
  );
  if (bytesToHex(idBytes) !== event.id) {
    return false;
  }
  try {
    return schnorr.verify(
      hexToBytes(event.sig),
      idBytes,
      hexToBytes(event.pubkey),
    );
  } catch {
    return false;
  }
}

/** Verifies a response and binds its signed event to the exact requested event. */
export async function verifyAttestationResponse(
  response: AttestationResponse,
  expected: UnsignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  const signed = response.event;
  const attestation = signed.tags.at(-1);
  return (
    attestation?.length === 2 &&
    attestation[0] === "attestation" &&
    attestation[1] === response.keyVersion &&
    signed.created_at === expected.created_at &&
    signed.kind === expected.kind &&
    signed.content === expected.content &&
    signed.tags.length === expected.tags.length + 1 &&
    JSON.stringify(signed.tags.slice(0, -1)) ===
      JSON.stringify(expected.tags) &&
    (await verifyAttestation(signed, env))
  );
}
