import type {
  BotProjectionEnvelope,
  UnsignedNostrEvent,
} from "@punks/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { attestNostrEvent } from "../../attestation/src/nostr";
import { verifyAttestation } from "../src/attestation";
import worker from "../src/index";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  ATTESTATION_PUBLIC_KEYS_JSON: string;
}

const testEnv = env as TestEnv;
const privateKey = `${"0".repeat(63)}1`;
const botId = "00000000-0000-8000-8000-000000000941";
const actorId = "00000000-0000-8000-8000-000000000942";
const commandId = "00000000-0000-8000-8000-000000000943";

async function projection(
  keyVersion = "local-v1",
  scope: { botId: string; commandId: string } = { botId, commandId },
): Promise<BotProjectionEnvelope> {
  const state: BotProjectionEnvelope["state"] = {
    id: scope.botId,
    slug: "cryptographic-bot",
    name: "Cryptographic Bot",
    description: "Signed fixture",
    status: "published",
    configContractId: "punks://contracts/bot.config.empty@1",
    supportedActionContracts: ["message.reaction-toggle@1"],
    revision: 1,
    cursor: 1,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    suspendedAt: null,
    withdrawnAt: null,
  };
  const unsigned: UnsignedNostrEvent = {
    created_at: 1_776_939_200,
    kind: 50300,
    tags: [
      ["bot", scope.botId],
      ["cursor", "1"],
      ["command", scope.commandId],
      ["contract", "bot.publish@1"],
      ["actor", "punk", actorId],
    ],
    content: JSON.stringify({
      schemaVersion: 1,
      bot: state,
      delta: { operation: "published" },
    }),
  };
  return {
    contract: "bot.projection@1",
    botId: scope.botId,
    cursor: 1,
    event: await attestNostrEvent(unsigned, privateKey, keyVersion),
    state,
  };
}

beforeAll(async () => {
  await Promise.all(
    [
      testEnv.PROJECTION_DB_0,
      testEnv.PROJECTION_DB_1,
      testEnv.PROJECTION_DB_2,
      testEnv.PROJECTION_DB_3,
    ].map((database) => applyD1Migrations(database, testEnv.TEST_MIGRATIONS)),
  );
});

describe("projection Attestation Punks verification", () => {
  it("accepts a real Schnorr fixture only in its exact environment registry", async () => {
    const signed = await projection();
    expect(await verifyAttestation(signed.event, testEnv)).toBe(true);
    expect(
      await verifyAttestation(signed.event, {
        ENVIRONMENT: "staging",
        ATTESTATION_PUBLIC_KEYS_JSON: testEnv.ATTESTATION_PUBLIC_KEYS_JSON,
      }),
    ).toBe(false);
    expect(
      await verifyAttestation(signed.event, {
        ENVIRONMENT: "local",
        ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
          local: { "local-v1": signed.event.pubkey.toUpperCase() },
        }),
      }),
    ).toBe(false);
    expect(
      await verifyAttestation(signed.event, {
        ENVIRONMENT: "local",
        ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
          local: {
            "local-v1": signed.event.pubkey,
            "local-v2": signed.event.pubkey,
          },
        }),
      }),
    ).toBe(false);
  });

  it("rejects a self-consistent Queue mutation not covered by the Schnorr signature", async () => {
    const signed = await projection();
    const state = { ...signed.state, name: "Queue mutation" };
    const body: BotProjectionEnvelope = {
      ...signed,
      state,
      event: {
        ...signed.event,
        content: JSON.stringify({
          schemaVersion: 1,
          bot: state,
          delta: { operation: "published" },
        }),
      },
    };
    const batch = createMessageBatch("punks-projection-local", [
      { id: "mutated-signed-event", timestamp: new Date(), body, attempts: 1 },
    ]);
    const context = createExecutionContext();

    await worker.queue?.(batch, testEnv, context);

    expect(await getQueueResult(batch, context)).toMatchObject({
      explicitAcks: [],
      retryMessages: [{ msgId: "mutated-signed-event" }],
    });
  });

  it("rejects a valid Schnorr signature whose key version is absent from the environment registry", async () => {
    const body = await projection("unknown-v1", {
      botId: "00000000-0000-8000-8000-000000000951",
      commandId: "00000000-0000-8000-8000-000000000952",
    });
    const batch = createMessageBatch("punks-projection-local", [
      {
        id: "unknown-attestation-key",
        timestamp: new Date(),
        body,
        attempts: 1,
      },
    ]);
    const context = createExecutionContext();

    await worker.queue?.(batch, testEnv, context);

    expect(await getQueueResult(batch, context)).toMatchObject({
      explicitAcks: [],
      retryMessages: [{ msgId: "unknown-attestation-key" }],
    });
  });
});
