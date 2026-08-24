import type { SignedNostrEvent } from "@punks/contracts";

import { attestNostrEvent } from "../../attestation/src/nostr";

const localPrivateKey = `${"0".repeat(63)}1`;

export async function signProjectionEnvelope<
  Projection extends { event: SignedNostrEvent },
>(projection: Projection): Promise<Projection> {
  const { id: _id, pubkey: _pubkey, sig: _sig, ...event } = projection.event;
  return {
    ...projection,
    event: await attestNostrEvent(
      {
        ...event,
        tags: event.tags.filter(([name]) => name !== "attestation"),
      },
      localPrivateKey,
      "local-v1",
    ),
  };
}

export function cryptographicMutations<
  Projection extends { event: SignedNostrEvent },
>(projection: Projection): Projection[] {
  const mutatedId = structuredClone(projection);
  mutatedId.event.id = `${projection.event.id[0] === "0" ? "1" : "0"}${projection.event.id.slice(1)}`;

  const mutatedTags = structuredClone(projection);
  mutatedTags.event.tags = [
    ...mutatedTags.event.tags,
    ["projection-test", "mutated"],
  ];

  const mutatedContent = structuredClone(projection);
  mutatedContent.event.content = `${mutatedContent.event.content} `;

  const mutatedSignature = structuredClone(projection);
  mutatedSignature.event.sig = `${projection.event.sig[0] === "0" ? "1" : "0"}${projection.event.sig.slice(1)}`;

  const mutatedKeyVersion = structuredClone(projection);
  mutatedKeyVersion.event.tags = mutatedKeyVersion.event.tags.map((tag) =>
    tag[0] === "attestation" ? ["attestation", "unknown-v1"] : tag,
  );

  return [
    mutatedId,
    mutatedTags,
    mutatedContent,
    mutatedSignature,
    mutatedKeyVersion,
  ];
}

export function withAttestationRegistry<Environment extends object>(
  environment: Environment,
  registry: string | undefined,
): Environment {
  return new Proxy(environment, {
    get(target, property, receiver) {
      return property === "ATTESTATION_PUBLIC_KEYS_JSON"
        ? registry
        : Reflect.get(target, property, receiver);
    },
  });
}
