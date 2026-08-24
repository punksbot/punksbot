import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  MessageContentScope,
  StageMessageContentInput,
} from "../src/message-content-do";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";

function fixture(
  messageId: string,
  operationId: string,
  version: number,
  content: string,
  topic: string | null = null,
) {
  return {
    operationId,
    workspaceId,
    conversationId,
    messageId,
    generationId: messageId,
    version,
    payload: { schemaVersion: 1, content, topic },
  } satisfies StageMessageContentInput;
}

function scope(messageId: string): MessageContentScope {
  return {
    workspaceId,
    conversationId,
    messageId,
    generationId: messageId,
  };
}

function objectKey(ciphertextRef: string): string {
  const prefix = "r2://content/";
  expect(ciphertextRef.startsWith(prefix)).toBe(true);
  return ciphertextRef.slice(prefix.length);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function seedTombstone(
  messageId: string,
  erasureCommandId: string,
  expectedContentKeyIds: string[],
): Promise<void> {
  const response = await env.ERASURE_REGISTRY.fetch(
    "https://fixture/__test/tombstone",
    {
      method: "POST",
      body: JSON.stringify({
        ...scope(messageId),
        erasureCommandId,
        expectedContentKeyIds,
      }),
    },
  );
  expect(response.ok).toBe(true);
}

async function setRegistryMode(mode: {
  lookup?: "available" | "unavailable" | "corrupt" | "malformed";
  record?: "available" | "unavailable" | "conflict" | "malformed";
}): Promise<void> {
  const response = await env.ERASURE_REGISTRY.fetch(
    "https://fixture/__test/mode",
    { method: "POST", body: JSON.stringify(mode) },
  );
  expect(response.ok).toBe(true);
}

describe("MessageContentDO", () => {
  beforeEach(async () => {
    await env.ERASURE_REGISTRY.fetch("https://fixture/__test/reset", {
      method: "POST",
    });
  });

  it("refuses staging when the private registry already contains a tombstone", async () => {
    const messageId = "bdac0f11-e756-4428-a805-afda70b4573a";
    const request = fixture(
      messageId,
      "0f4110a7-c94b-4b2f-bd9a-f6b5135cf4d4",
      1,
      "must never be staged after erasure",
      "private title",
    );
    await seedTombstone(messageId, "303cd83f-26f6-4703-897a-630efcc666b8", [
      "64af2981-d700-4929-b4ee-5ced5c6c3054",
    ]);

    await expect(
      env.MESSAGE_CONTENT.getByName(messageId).stage(request),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
    await runInDurableObject(
      env.MESSAGE_CONTENT.getByName(messageId),
      (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM content_versions",
            )
            .one().count,
        ).toBe(0);
      },
    );
    const stored = await env.CONTENT_BUCKET.list({
      prefix: `workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/`,
    });
    expect(stored.objects).toHaveLength(0);
  });

  it("refuses finalizing a staged version once its tombstone exists", async () => {
    const messageId = "c7c51a8a-8c3d-47a8-ae9f-ad7760dd3768";
    const operationId = "00b4cfba-b483-4e7f-a34d-98facbc27d04";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(
      fixture(messageId, operationId, 1, "staged before erasure"),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await seedTombstone(messageId, "dd97a6df-f409-41d8-8c17-5b85d8e8d4ca", [
      staged.prepared.contentKeyId,
    ]);

    await expect(
      stub.finalize({
        ...scope(messageId),
        operationId,
        contentKeyId: staged.prepared.contentKeyId,
      }),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
  });

  it("refuses authorized reads once the registry contains a tombstone", async () => {
    const messageId = "c28ab6dd-cabb-4e9e-a8c7-365428f7745d";
    const operationId = "6e8a3cf5-ad98-4fd8-af5a-c4ecfdc1da77";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(
      fixture(messageId, operationId, 1, "plaintext blocked by tombstone"),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    const finalized = await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });
    expect(finalized.ok).toBe(true);
    await seedTombstone(messageId, "2460d034-bc89-43dc-9529-c1dfcf4e1504", [
      staged.prepared.contentKeyId,
    ]);

    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "display",
      }),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
  });

  it("fails closed without local key destruction when registry recording is unavailable", async () => {
    const messageId = "d056e93a-6e1d-4e17-b459-4b33f398bc87";
    const operationId = "481c2cf7-8329-403a-9a58-ac640cf96afa";
    const destroyOperationId = "18912e61-aef0-49c5-bbd3-d4a449161f8e";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(
      fixture(messageId, operationId, 1, "registry must decide first"),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });
    await setRegistryMode({ record: "unavailable" });

    await expect(
      stub.destroyGeneration({
        ...scope(messageId),
        operationId: destroyOperationId,
        expectedContentKeyIds: [staged.prepared.contentKeyId],
      }),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{
          status: string;
          key_material: ArrayBuffer | null;
          proof_count: number;
        }>(
          `SELECT status, key_material,
             (SELECT COUNT(*) FROM destruction_proofs) AS proof_count
           FROM content_versions WHERE content_key_id = ?`,
          staged.prepared.contentKeyId,
        )
        .one();
      expect(row.status).toBe("finalized");
      expect(row.key_material).not.toBeNull();
      expect(row.proof_count).toBe(0);
    });
  });

  it("rejects a conflicting create-only registry decision without local mutation", async () => {
    const messageId = "ca29d225-b6f4-46f3-8b86-f9dc130a0d2f";
    const operationId = "12353b0d-5786-44f1-b082-c34b13cb7bd1";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(
      fixture(messageId, operationId, 1, "conflict remains encrypted"),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });
    await setRegistryMode({ record: "conflict" });

    await expect(
      stub.destroyGeneration({
        ...scope(messageId),
        operationId: "fa50c587-633a-466e-bfa7-cc607f13dbb2",
        expectedContentKeyIds: [staged.prepared.contentKeyId],
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ status: string; key_material: ArrayBuffer | null }>(
          `SELECT status, key_material FROM content_versions
           WHERE content_key_id = ?`,
          staged.prepared.contentKeyId,
        )
        .one();
      expect(row.status).toBe("finalized");
      expect(row.key_material).not.toBeNull();
    });
  });

  it("fails closed on malformed successful registry RPC outputs", async () => {
    const lookupMessageId = "de54d1a0-a244-4b13-930e-005b4353654d";
    await setRegistryMode({ lookup: "malformed" });
    await expect(
      env.MESSAGE_CONTENT.getByName(lookupMessageId).stage(
        fixture(
          lookupMessageId,
          "0e466423-b902-48ba-970a-a40464dcf535",
          1,
          "malformed lookup must fail closed",
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });

    await setRegistryMode({ lookup: "available", record: "available" });
    const recordMessageId = "9196cf57-c42e-4445-b4f5-558f8bc6156b";
    const operationId = "7cdebbcc-000d-4234-be4d-a2f011305840";
    const stub = env.MESSAGE_CONTENT.getByName(recordMessageId);
    const staged = await stub.stage(
      fixture(
        recordMessageId,
        operationId,
        1,
        "malformed record must preserve this key",
      ),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await setRegistryMode({ record: "malformed" });
    await expect(
      stub.destroyGeneration({
        ...scope(recordMessageId),
        operationId: "8b65efb7-f923-44c0-a092-11a43652e097",
        expectedContentKeyIds: [staged.prepared.contentKeyId],
      }),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ key_material: ArrayBuffer | null }>(
            "SELECT key_material FROM content_versions",
          )
          .one().key_material,
      ).not.toBeNull();
    });
  });

  it.each([
    "corrupt",
    "unavailable",
  ] as const)("fails closed for stage, finalize, and read when lookup is %s", async (lookup) => {
    const finalizedMessageId =
      lookup === "corrupt"
        ? "d2869d56-c126-4f48-bb0a-28ad447284c0"
        : "25369310-5310-4442-bc1d-ec4ecb4667ef";
    const stagedMessageId =
      lookup === "corrupt"
        ? "38366acf-fb79-4375-a782-d52848e98462"
        : "e19fa321-3d6f-492b-873e-661688740a8a";
    const blockedMessageId =
      lookup === "corrupt"
        ? "e33caf63-5b56-4018-98fe-d69268791b57"
        : "dd4ecabe-6882-462f-bd75-588fd2cfdb63";
    const finalizedOperationId =
      lookup === "corrupt"
        ? "4f251816-877a-4aef-9e93-6bed8d21e291"
        : "3b64df82-127f-419b-9a13-83cd50d862b5";
    const stagedOperationId =
      lookup === "corrupt"
        ? "073dfc64-61e9-40e0-b888-b3ae9a545468"
        : "ce36555b-4598-4236-856e-d74fe2106de3";
    const finalizedStub = env.MESSAGE_CONTENT.getByName(finalizedMessageId);
    const stagedStub = env.MESSAGE_CONTENT.getByName(stagedMessageId);
    const finalized = await finalizedStub.stage(
      fixture(
        finalizedMessageId,
        finalizedOperationId,
        1,
        "never read on lookup failure",
      ),
    );
    const staged = await stagedStub.stage(
      fixture(
        stagedMessageId,
        stagedOperationId,
        1,
        "never finalize on lookup failure",
      ),
    );
    expect(finalized.ok && staged.ok).toBe(true);
    if (!finalized.ok || !staged.ok) {
      return;
    }
    await finalizedStub.finalize({
      ...scope(finalizedMessageId),
      operationId: finalizedOperationId,
      contentKeyId: finalized.prepared.contentKeyId,
    });
    await setRegistryMode({ lookup });

    await expect(
      env.MESSAGE_CONTENT.getByName(blockedMessageId).stage(
        fixture(
          blockedMessageId,
          lookup === "corrupt"
            ? "b1b8ea8f-b623-403d-b780-65fe64e1b88b"
            : "f084b56c-48e3-43ba-95f0-83651bd002ad",
          1,
          "not staged",
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
    await expect(
      stagedStub.finalize({
        ...scope(stagedMessageId),
        operationId: stagedOperationId,
        contentKeyId: staged.prepared.contentKeyId,
      }),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
    await expect(
      finalizedStub.readAuthorized({
        ...scope(finalizedMessageId),
        contentKeyId: finalized.prepared.contentKeyId,
        purpose: "display",
      }),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
  });

  it("re-nullifies PITR-resurrected keys and never sends plaintext or keys to the registry", async () => {
    const messageId = "bc720962-f53b-49a3-a26f-bfae5c627191";
    const operationId = "82897d63-5db8-48d8-8f1e-d6f3320160ba";
    const destroyOperationId = "b9540ce3-0ae4-4b21-af88-fea3f4a8f1a6";
    const plaintext = "PITR must not resurrect this exact secret";
    const topic = "PITR private topic";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const request = fixture(messageId, operationId, 1, plaintext, topic);
    const staged = await stub.stage(request);
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });
    let restoredKey = new ArrayBuffer(0);
    let restoredIv = new ArrayBuffer(0);
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ key_material: ArrayBuffer; iv: ArrayBuffer }>(
          `SELECT key_material, iv FROM content_versions
           WHERE content_key_id = ?`,
          staged.prepared.contentKeyId,
        )
        .one();
      restoredKey = row.key_material.slice(0);
      restoredIv = row.iv.slice(0);
    });
    const destroy = {
      ...scope(messageId),
      operationId: destroyOperationId,
      expectedContentKeyIds: [staged.prepared.contentKeyId],
    };
    const destroyed = await stub.destroyGeneration(destroy);
    expect(destroyed.ok).toBe(true);
    if (!destroyed.ok) {
      return;
    }

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE content_versions
         SET key_material = ?, iv = ?, status = 'finalized'
         WHERE content_key_id = ?`,
        restoredKey,
        restoredIv,
        staged.prepared.contentKeyId,
      );
    });
    await expect(stub.stage(request)).resolves.toEqual({
      ok: false,
      code: "generation_destroyed",
    });
    await expect(
      stub.finalize({
        ...scope(messageId),
        operationId,
        contentKeyId: staged.prepared.contentKeyId,
      }),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "moderation",
      }),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
    await expect(stub.destroyGeneration(destroy)).resolves.toEqual({
      ok: true,
      proof: destroyed.proof,
      replayed: true,
    });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{
          key_material: ArrayBuffer | null;
          iv: ArrayBuffer | null;
          status: string;
        }>(
          `SELECT key_material, iv, status FROM content_versions
           WHERE content_key_id = ?`,
          staged.prepared.contentKeyId,
        )
        .one();
      expect(row).toEqual({
        key_material: null,
        iv: null,
        status: "destroyed",
      });
    });

    const callsResponse = await env.ERASURE_REGISTRY.fetch(
      "https://fixture/__test/calls",
    );
    const calls = await callsResponse.json<{
      calls: Array<{ method: "lookup" | "record"; input: object }>;
    }>();
    const serializedCalls = JSON.stringify(calls);
    const rawKey = new Uint8Array(restoredKey);
    const keyHex = [...rawKey]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const keyBase64 = btoa(String.fromCharCode(...rawKey));
    expect(serializedCalls).not.toContain(plaintext);
    expect(serializedCalls).not.toContain(topic);
    expect(serializedCalls).not.toContain(keyHex);
    expect(serializedCalls).not.toContain(keyBase64);
    for (const call of calls.calls) {
      expect(Object.keys(call.input).sort()).toEqual(
        call.method === "lookup"
          ? ["conversationId", "generationId", "messageId", "workspaceId"]
          : [
              "conversationId",
              "erasureCommandId",
              "expectedContentKeyIds",
              "generationId",
              "messageId",
              "workspaceId",
            ],
      );
    }
  });

  it("uses the complete tombstone to re-nullify a PITR-restored version subset", async () => {
    const messageId = "a25d53ee-dade-46c1-9ce1-f1a4a77ae870";
    const firstOperationId = "5e57257f-ef9e-44c8-b3cd-f44d71641245";
    const secondOperationId = "d5f4629d-34b6-410f-88a7-e15f28373b6d";
    const destroyOperationId = "685e9a4d-2296-403f-b693-b4292db5f18e";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const first = await stub.stage(
      fixture(messageId, firstOperationId, 1, "PITR subset version one"),
    );
    const second = await stub.stage(
      fixture(messageId, secondOperationId, 2, "PITR subset version two"),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId: firstOperationId,
      contentKeyId: first.prepared.contentKeyId,
    });
    await stub.finalize({
      ...scope(messageId),
      operationId: secondOperationId,
      contentKeyId: second.prepared.contentKeyId,
    });
    let firstKey = new ArrayBuffer(0);
    let firstIv = new ArrayBuffer(0);
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ key_material: ArrayBuffer; iv: ArrayBuffer }>(
          `SELECT key_material, iv FROM content_versions
           WHERE content_key_id = ?`,
          first.prepared.contentKeyId,
        )
        .one();
      firstKey = row.key_material.slice(0);
      firstIv = row.iv.slice(0);
    });
    const expectedContentKeyIds = [
      first.prepared.contentKeyId,
      second.prepared.contentKeyId,
    ].sort();
    const destroy = {
      ...scope(messageId),
      operationId: destroyOperationId,
      expectedContentKeyIds,
    };
    const original = await stub.destroyGeneration(destroy);
    expect(original.ok).toBe(true);
    if (!original.ok) {
      return;
    }

    const extraKeyId = "655bf796-a303-4eb7-8434-62ecc2c88f66";
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM destruction_proofs");
      state.storage.sql.exec(
        "DELETE FROM content_versions WHERE content_key_id = ?",
        second.prepared.contentKeyId,
      );
      state.storage.sql.exec(
        `UPDATE content_versions
         SET key_material = ?, iv = ?, status = 'finalized',
             content_key_id = ?
         WHERE operation_id = ?`,
        firstKey,
        firstIv,
        extraKeyId,
        firstOperationId,
      );
    });
    await expect(stub.destroyGeneration(destroy)).resolves.toEqual({
      ok: false,
      code: "key_set_mismatch",
    });
    await expect(
      stub.destroyGeneration({
        ...destroy,
        expectedContentKeyIds: [first.prepared.contentKeyId],
      }),
    ).resolves.toEqual({ ok: false, code: "key_set_mismatch" });

    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE content_versions SET content_key_id = ?
         WHERE operation_id = ?`,
        first.prepared.contentKeyId,
        firstOperationId,
      );
    });
    await expect(stub.destroyGeneration(destroy)).resolves.toEqual({
      ok: true,
      proof: original.proof,
      replayed: true,
    });
    await runInDurableObject(stub, (_instance, state) => {
      const rows = state.storage.sql
        .exec<{
          content_key_id: string;
          key_material: ArrayBuffer | null;
          iv: ArrayBuffer | null;
          status: string;
        }>(
          `SELECT content_key_id, key_material, iv, status
           FROM content_versions`,
        )
        .toArray();
      expect(rows).toEqual([
        {
          content_key_id: first.prepared.contentKeyId,
          key_material: null,
          iv: null,
          status: "destroyed",
        },
      ]);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM destruction_proofs",
          )
          .one().count,
      ).toBe(1);
    });
  });

  it("encrypts a version in create-only R2 and only reads it after finalize", async () => {
    const messageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
    const operationId = "57a0a439-bacc-41a8-ac78-7393b4938fa8";
    const plaintext = "Secret UTF-8 payload — jamais dans R2 en clair";
    const topic = "Titre privé — également chiffré";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const request = fixture(messageId, operationId, 1, plaintext, topic);

    const staged = await stub.stage(request);
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    expect(staged.replayed).toBe(false);
    expect(staged.prepared).toMatchObject({ version: 1, topicPresent: true });
    expect(staged.prepared.contentCommitment).not.toBe(
      await sha256Hex(plaintext),
    );
    expect(staged.prepared.contentKeyId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);

    const encrypted = await env.CONTENT_BUCKET.get(
      objectKey(staged.prepared.ciphertextRef),
    );
    expect(encrypted).not.toBeNull();
    expect(encrypted?.customMetadata).toEqual({
      encryption: "AES-256-GCM",
      contentKeyId: staged.prepared.contentKeyId,
      version: "1",
    });
    const ciphertext = await encrypted?.arrayBuffer();
    expect(ciphertext?.byteLength).toBeGreaterThan(
      new TextEncoder().encode(plaintext).byteLength,
    );
    expect(new TextDecoder().decode(ciphertext)).not.toContain(plaintext);
    expect(new TextDecoder().decode(ciphertext)).not.toContain(topic);

    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "display",
      }),
    ).resolves.toEqual({ ok: false, code: "not_finalized" });

    const finalized = await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });
    expect(finalized).toEqual({
      ok: true,
      prepared: staged.prepared,
      replayed: false,
    });
    await expect(
      stub.finalize({
        ...scope(messageId),
        operationId,
        contentKeyId: staged.prepared.contentKeyId,
      }),
    ).resolves.toEqual({
      ok: true,
      prepared: staged.prepared,
      replayed: true,
    });
    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "search",
      }),
    ).resolves.toEqual({
      ok: true,
      payload: request.payload,
      contentCommitment: staged.prepared.contentCommitment,
      version: 1,
    });

    const replay = await stub.stage(request);
    expect(replay).toEqual({
      ok: true,
      prepared: staged.prepared,
      replayed: true,
    });
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_versions SET content_commitment = ?",
        "0".repeat(64),
      );
    });
    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "display",
      }),
    ).resolves.toEqual({ ok: false, code: "integrity_failure" });
  });

  it("rejects scope, byte-limit, idempotency, and version conflicts", async () => {
    const messageId = "3aeed436-1447-41bb-8adf-1cc3dc8cc945";
    const operationId = "c119f166-dd52-4721-b4f8-56fa4f3c803b";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const request = fixture(messageId, operationId, 1, "original");
    const staged = await stub.stage(request);
    expect(staged.ok).toBe(true);

    await expect(
      stub.stage({
        ...request,
        payload: { ...request.payload, content: "different" },
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await expect(
      stub.stage({
        ...request,
        payload: { ...request.payload, topic: "different-topic" },
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await expect(
      stub.stage({
        ...request,
        operationId: "66570436-318e-4ead-bbb2-b436a648281d",
        payload: {
          ...request.payload,
          content: "same version, another command",
        },
      }),
    ).resolves.toEqual({ ok: false, code: "version_conflict" });
    await expect(
      stub.stage({ ...request, generationId: workspaceId }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    await expect(
      stub.stage({
        ...request,
        operationId: "0f55587f-d038-47ec-96ef-d6a417196092",
        version: 2,
        payload: { ...request.payload, content: "é".repeat(32_769) },
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    await expect(
      stub.stage({
        ...request,
        operationId: "e98eafc7-ccce-4808-8764-f5283ab8e69b",
        version: 2,
        payload: {
          schemaVersion: 1,
          content: "a".repeat(65_490),
          topic: "envelope-overflow",
        },
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });

    if (staged.ok) {
      await expect(
        stub.readAuthorized({
          ...scope(messageId),
          conversationId: "6ce8bc5f-0352-4bb7-9e53-f0319eabfd35",
          contentKeyId: staged.prepared.contentKeyId,
          purpose: "display",
        }),
      ).resolves.toEqual({ ok: false, code: "not_found" });
    }
  });

  it("never overwrites an existing R2 object while recovering a preparation", async () => {
    const messageId = "fa77c532-0ddc-42a4-bd68-010899ed584a";
    const operationId = "a4884e3e-b17c-43ae-87ee-fe29d80b46a7";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const request = fixture(messageId, operationId, 1, "immutable ciphertext");
    const staged = await stub.stage(request);
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    const key = objectKey(staged.prepared.ciphertextRef);
    await env.CONTENT_BUCKET.put(key, "externally-corrupted-object");
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_versions SET status = 'preparing' WHERE operation_id = ?",
        operationId,
      );
      await state.storage.deleteAlarm();
    });

    await expect(stub.stage(request)).resolves.toEqual({
      ok: false,
      code: "storage_conflict",
    });
    await expect(
      env.CONTENT_BUCKET.get(key).then((object) => object?.text()),
    ).resolves.toBe("externally-corrupted-object");
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("destroys the canonical historical generation including an orphan key", async () => {
    const messageId = "32a0d8dd-a2a4-45ef-b45a-cb7d33a1def8";
    const firstOperationId = "680c8b4e-b79d-467f-8d52-5bd2c1b399df";
    const secondOperationId = "1007480c-b94f-441d-8438-1d792e7ef990";
    const destroyOperationId = "2dd7b9ed-b6ae-40a8-9127-b55867190d6c";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const first = await stub.stage(
      fixture(messageId, firstOperationId, 1, "version one"),
    );
    const second = await stub.stage(
      fixture(messageId, secondOperationId, 2, "version two"),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    const finalized = await stub.finalize({
      ...scope(messageId),
      operationId: firstOperationId,
      contentKeyId: first.prepared.contentKeyId,
    });
    expect(finalized.ok).toBe(true);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE content_versions
         SET key_material = NULL, iv = NULL, status = 'expired',
             expires_at_ms = NULL
         WHERE operation_id = ?`,
        secondOperationId,
      );
    });
    const allKeys = [
      first.prepared.contentKeyId,
      second.prepared.contentKeyId,
    ].sort();
    const destroy = {
      ...scope(messageId),
      operationId: destroyOperationId,
      expectedContentKeyIds: allKeys,
    };

    await expect(
      stub.destroyGeneration({
        ...destroy,
        expectedContentKeyIds: Array.from(
          { length: 1_001 },
          (_, index) =>
            `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
        ),
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });

    await expect(
      stub.destroyGeneration({
        ...destroy,
        expectedContentKeyIds: [
          ...allKeys,
          "8aeb4df9-86c1-4eaf-933e-3d43557f1652",
        ],
      }),
    ).resolves.toEqual({ ok: false, code: "key_set_mismatch" });

    const destroyed = await stub.destroyGeneration({
      ...destroy,
      expectedContentKeyIds: [first.prepared.contentKeyId],
    });
    expect(destroyed.ok).toBe(true);
    if (!destroyed.ok) {
      return;
    }
    expect(destroyed.replayed).toBe(false);
    expect(destroyed.proof).toMatchObject({
      schemaVersion: 1,
      operationId: destroyOperationId,
      ...scope(messageId),
      destroyedContentKeyIds: allKeys,
    });
    expect(destroyed.proof.proofHash).toMatch(/^[0-9a-f]{64}$/);
    const { proofHash: _proofHash, ...draft } = destroyed.proof;
    expect(destroyed.proof.proofHash).toBe(
      await sha256Hex(JSON.stringify(draft)),
    );

    await runInDurableObject(stub, (_instance, state) => {
      const rows = state.storage.sql
        .exec<{
          content_key_id: string;
          key_material: ArrayBuffer | null;
          iv: ArrayBuffer | null;
          status: string;
        }>(
          `SELECT content_key_id, key_material, iv, status
           FROM content_versions ORDER BY content_key_id`,
        )
        .toArray();
      expect(rows).toEqual(
        allKeys.map((contentKeyId) => ({
          content_key_id: contentKeyId,
          key_material: null,
          iv: null,
          status: "destroyed",
        })),
      );
    });
    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: first.prepared.contentKeyId,
        purpose: "moderation",
      }),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
    expect(
      await env.CONTENT_BUCKET.get(objectKey(first.prepared.ciphertextRef)),
    ).not.toBeNull();
    await expect(stub.destroyGeneration(destroy)).resolves.toEqual({
      ok: true,
      proof: destroyed.proof,
      replayed: true,
    });
    await expect(
      stub.destroyGeneration({
        ...destroy,
        workspaceId: "fcb3a9d6-3210-4bf8-82b7-a39d6f3329bb",
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await expect(
      stub.destroyGeneration({
        ...destroy,
        operationId: "117a7a50-d4a4-47b7-96a5-13407654847d",
      }),
    ).resolves.toEqual({ ok: false, code: "idempotency_conflict" });
    await expect(
      stub.stage(
        fixture(
          messageId,
          "aa2260fc-ab8e-4d2f-a277-f19339ece016",
          3,
          "cannot resurrect",
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "generation_destroyed" });
  });

  it("garbage-collects orphan preparations while preserving finalized versions", async () => {
    const messageId = "a4211768-d921-44bd-a15f-75961b029a72";
    const orphanOperationId = "0a280ce5-6e45-4a86-b0b1-460498319866";
    const finalOperationId = "c564bb44-9527-44ea-a1b1-de5a4c81f4ea";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const orphanRequest = fixture(messageId, orphanOperationId, 1, "orphan");
    const orphan = await stub.stage(orphanRequest);
    const finalized = await stub.stage(
      fixture(messageId, finalOperationId, 2, "retained"),
    );
    expect(orphan.ok && finalized.ok).toBe(true);
    if (!orphan.ok || !finalized.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId: finalOperationId,
      contentKeyId: finalized.prepared.contentKeyId,
    });
    const orphanObjectKey = objectKey(orphan.prepared.ciphertextRef);

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_versions SET expires_at_ms = 0 WHERE operation_id = ?",
        orphanOperationId,
      );
      await state.storage.setAlarm(Date.now());
    });
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });
    await expect(env.CONTENT_BUCKET.get(orphanObjectKey)).resolves.toBeNull();
    await runInDurableObject(stub, (_instance, state) => {
      const expired = state.storage.sql
        .exec<{
          content_key_id: string;
        }>(
          `SELECT content_key_id FROM expired_content_history
           WHERE operation_id = ?`,
          orphanOperationId,
        )
        .one();
      expect(expired).toEqual({
        content_key_id: orphan.prepared.contentKeyId,
      });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM content_versions WHERE operation_id = ?",
            orphanOperationId,
          )
          .one().count,
      ).toBe(0);
    });
    await expect(stub.stage(orphanRequest)).resolves.toEqual({
      ok: false,
      code: "preparation_expired",
    });
    const replacement = await stub.stage(
      fixture(
        messageId,
        "79eb582b-e6e1-4325-b001-03f57ed58a64",
        1,
        "replacement after orphan GC",
      ),
    );
    expect(replacement.ok).toBe(true);
    await expect(
      stub.readAuthorized({
        ...scope(messageId),
        contentKeyId: finalized.prepared.contentKeyId,
        purpose: "bot-context",
      }),
    ).resolves.toEqual({
      ok: true,
      payload: {
        schemaVersion: 1,
        content: "retained",
        topic: null,
      },
      contentCommitment: finalized.prepared.contentCommitment,
      version: 2,
    });
    if (!replacement.ok) {
      return;
    }
    const destroyed = await stub.destroyGeneration({
      ...scope(messageId),
      operationId: "172d8427-ab89-433d-9ba6-5ae3a605b1e2",
      expectedContentKeyIds: [finalized.prepared.contentKeyId],
    });
    expect(destroyed.ok).toBe(true);
    if (destroyed.ok) {
      expect(destroyed.proof.destroyedContentKeyIds).toEqual(
        [
          orphan.prepared.contentKeyId,
          finalized.prepared.contentKeyId,
          replacement.prepared.contentKeyId,
        ].sort(),
      );
    }
  });

  it("resumes an interrupted expiring deletion after Durable Object eviction", async () => {
    const messageId = "0387ad39-8580-4071-a6ce-056aa43d5d91";
    const operationId = "0c919641-4182-44eb-80fa-653477589ac4";
    const request = fixture(
      messageId,
      operationId,
      1,
      "orphan whose first R2 deletion was interrupted",
    );
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(request);
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    const key = objectKey(staged.prepared.ciphertextRef);

    // This is the durable state left by alarm() after an R2 delete failure.
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE content_versions
         SET status = 'expiring', expires_at_ms = 0, gc_attempts = 1
         WHERE operation_id = ?`,
        operationId,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await evictDurableObject(stub);

    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.toSatisfy(
        (alarm: number | null) => alarm !== null && alarm <= Date.now(),
      );
    });
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });

    await expect(env.CONTENT_BUCKET.get(key)).resolves.toBeNull();
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM content_versions
             WHERE operation_id = ? OR key_material IS NOT NULL OR iv IS NOT NULL`,
            operationId,
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ content_key_id: string }>(
            `SELECT content_key_id FROM expired_content_history
             WHERE operation_id = ?`,
            operationId,
          )
          .one(),
      ).toEqual({ content_key_id: staged.prepared.contentKeyId });
    });
    await expect(stub.stage(request)).resolves.toEqual({
      ok: false,
      code: "preparation_expired",
    });
  });

  it("migrates a legacy expired row before reusing its logical version", async () => {
    const messageId = "a2c6adbb-24a2-4ff6-923d-8bacd5ad566e";
    const legacyOperationId = "c20e33bf-897c-445a-8952-bc0236ef37d0";
    const replacementOperationId = "e8647452-5abc-4d8f-88b1-68823c6d9784";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const legacyRequest = fixture(
      messageId,
      legacyOperationId,
      2,
      "legacy orphan",
    );
    const legacy = await stub.stage(legacyRequest);
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) {
      return;
    }

    await env.CONTENT_BUCKET.delete(objectKey(legacy.prepared.ciphertextRef));
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE content_versions
         SET key_material = NULL, iv = NULL, status = 'expired',
             expires_at_ms = NULL
         WHERE operation_id = ?`,
        legacyOperationId,
      );
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM expired_content_history
             WHERE operation_id = ?`,
            legacyOperationId,
          )
          .one().count,
      ).toBe(0);
    });

    await evictDurableObject(stub);
    const replacement = await stub.stage(
      fixture(
        messageId,
        replacementOperationId,
        2,
        "replacement after schema upgrade",
      ),
    );
    expect(replacement.ok).toBe(true);
    await expect(stub.stage(legacyRequest)).resolves.toEqual({
      ok: false,
      code: "preparation_expired",
    });
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ content_key_id: string }>(
            `SELECT content_key_id FROM expired_content_history
             WHERE operation_id = ?`,
            legacyOperationId,
          )
          .one(),
      ).toEqual({ content_key_id: legacy.prepared.contentKeyId });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM content_versions
             WHERE generation_id = ? AND version = 2`,
            messageId,
          )
          .one().count,
      ).toBe(1);
    });
  });

  it("rejects a generation that exhausted its historical key quota before writing R2", async () => {
    const messageId = "41df7216-64d6-4073-89e6-f4f555cf11f3";
    const operationId = "fb4cf919-3410-413c-8374-d9641bb5d43c";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.transactionSync(() => {
        for (let index = 0; index < 1_000; index += 1) {
          const suffix = index.toString(16).padStart(12, "0");
          state.storage.sql.exec(
            `INSERT INTO expired_content_history
              (operation_id, generation_id, workspace_id, conversation_id,
               message_id, version, content_key_id, content_commitment,
               topic_present, ciphertext_hash, object_key, staged_at,
               expired_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            `10000000-0000-4000-8000-${suffix}`,
            messageId,
            workspaceId,
            conversationId,
            messageId,
            (index % 1_000) + 1,
            `20000000-0000-4000-8000-${suffix}`,
            "a".repeat(64),
            "b".repeat(64),
            `historical/${suffix}.aesgcm`,
            "2026-08-20T00:00:00.000Z",
            "2026-08-20T00:15:00.000Z",
          );
        }
      });
    });
    const prefix = `workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/`;
    const before = await env.CONTENT_BUCKET.list({ prefix });

    await expect(
      stub.stage(fixture(messageId, operationId, 1, "must not be encrypted")),
    ).resolves.toEqual({ ok: false, code: "version_conflict" });

    const after = await env.CONTENT_BUCKET.list({ prefix });
    expect(after.objects).toEqual(before.objects);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM content_versions WHERE operation_id = ?",
            operationId,
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("drains an authorized read before confirming generation destruction", async () => {
    const messageId = "3e22b6b1-00bd-4eb5-892a-bb1aca6234ae";
    const operationId = "b7419ff7-4407-4fdc-b4d5-c46190175f14";
    const destroyOperationId = "a400a3d0-9d89-4811-94ca-04e997523826";
    const stub = env.MESSAGE_CONTENT.getByName(messageId);
    const staged = await stub.stage(
      fixture(messageId, operationId, 1, "read-destroy-race", "secret topic"),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) {
      return;
    }
    await stub.finalize({
      ...scope(messageId),
      operationId,
      contentKeyId: staged.prepared.contentKeyId,
    });

    const completionOrder: string[] = [];
    const read = stub
      .readAuthorized({
        ...scope(messageId),
        contentKeyId: staged.prepared.contentKeyId,
        purpose: "display",
      })
      .then((result) => {
        completionOrder.push("read");
        return result;
      });
    const destroy = stub
      .destroyGeneration({
        ...scope(messageId),
        operationId: destroyOperationId,
        expectedContentKeyIds: [staged.prepared.contentKeyId],
      })
      .then((result) => {
        completionOrder.push("destroy");
        return result;
      });
    const [readResult, destroyResult] = await Promise.all([read, destroy]);

    expect(readResult).toMatchObject({
      ok: true,
      payload: {
        content: "read-destroy-race",
        topic: "secret topic",
      },
    });
    expect(destroyResult.ok).toBe(true);
    expect(completionOrder).toEqual(["read", "destroy"]);
  });
});
