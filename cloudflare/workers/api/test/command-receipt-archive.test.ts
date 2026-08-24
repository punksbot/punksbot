import { canonicalJson, sha256Hex } from "@punks/core";
import { describe, expect, it } from "vitest";

import {
  type CommandReceiptArchiveError,
  commandReceiptCoordinate,
  prepareCommandReceiptArchive,
  readCommandReceiptArchive,
  writeCommandReceiptArchive,
} from "../src/command-receipt-archive";

const botId = "51000000-0000-4000-8000-000000000001";
const commandId = "51000000-0000-4000-8000-000000000002";
const payloadHash = "ab".repeat(32);

class MemoryBucket {
  readonly objects = new Map<
    string,
    {
      body: string;
      httpMetadata: R2HTTPMetadata;
      customMetadata: Record<string, string>;
    }
  >();
  unavailable = false;

  async get(key: string): Promise<R2ObjectBody | null> {
    if (this.unavailable) {
      throw new Error("R2 unavailable");
    }
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }
    return {
      key,
      version: "1",
      size: new TextEncoder().encode(value.body).byteLength,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: new Date(0),
      storageClass: "Standard",
      checksums: { toJSON: () => ({}) },
      httpMetadata: value.httpMetadata,
      customMetadata: value.customMetadata,
      range: undefined,
      body: new Response(value.body).body as ReadableStream,
      bodyUsed: false,
      arrayBuffer: async () => new TextEncoder().encode(value.body).buffer,
      bytes: () => Promise.resolve(new TextEncoder().encode(value.body)),
      text: () => Promise.resolve(value.body),
      json: <T>() => Promise.resolve(JSON.parse(value.body) as T),
      blob: () => Promise.resolve(new Blob([value.body])),
      writeHttpMetadata: () => undefined,
    } as unknown as R2ObjectBody;
  }

  async put(
    key: string,
    value: string,
    options: R2PutOptions,
  ): Promise<R2Object | null> {
    if (this.unavailable) {
      throw new Error("R2 unavailable");
    }
    if (this.objects.has(key)) {
      return null;
    }
    const httpMetadata =
      options.httpMetadata instanceof Headers
        ? {}
        : { ...(options.httpMetadata ?? {}) };
    this.objects.set(key, {
      body: value,
      httpMetadata,
      customMetadata: { ...(options.customMetadata ?? {}) },
    });
    return {
      key,
      version: "1",
      size: new TextEncoder().encode(value).byteLength,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: new Date(0),
      storageClass: "Standard",
      checksums: { toJSON: () => ({}) },
      httpMetadata,
      customMetadata: options.customMetadata,
      writeHttpMetadata: () => undefined,
    } as unknown as R2Object;
  }
}

async function fixture() {
  const coordinate = await commandReceiptCoordinate({
    aggregate: "bot",
    aggregateId: botId,
    commandId,
  });
  const bodyValue = {
    schemaVersion: 1,
    aggregate: "bot",
    botId,
    commandId,
    payloadHash,
    terminal: { kind: "committed", value: { unicode: "réaction 🤖" } },
  };
  return {
    coordinate,
    bodyValue,
    prepared: await prepareCommandReceiptArchive(
      coordinate,
      payloadHash,
      bodyValue,
    ),
  };
}

describe("command receipt cold archive", () => {
  it("derives an opaque deterministic coordinate without leaking ids", async () => {
    const first = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: botId,
      commandId,
    });
    const second = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: botId,
      commandId,
    });

    expect(first).toEqual(second);
    expect(first.key).toMatch(
      /^command-receipts\/v1\/bot\/[0-9a-f]{64}\/[0-9a-f]{64}\.json$/,
    );
    expect(first.key).not.toContain(botId);
    expect(first.key).not.toContain(commandId);
    expect(first.key).not.toContain(payloadHash);
  });

  it("writes create-only canonical UTF-8 and reaccepts only the exact object", async () => {
    const bucket = new MemoryBucket();
    const { coordinate, bodyValue, prepared } = await fixture();

    await expect(
      writeCommandReceiptArchive(bucket as unknown as R2Bucket, prepared),
    ).resolves.toBe("created");
    expect(bucket.objects.get(coordinate.key)?.body).toBe(
      canonicalJson(bodyValue),
    );
    expect(prepared.bodyBytes).toBe(
      new TextEncoder().encode(canonicalJson(bodyValue)).byteLength,
    );
    await expect(
      writeCommandReceiptArchive(bucket as unknown as R2Bucket, prepared),
    ).resolves.toBe("existing");
    await expect(
      readCommandReceiptArchive(bucket as unknown as R2Bucket, coordinate),
    ).resolves.toMatchObject({ status: "found", value: bodyValue });
  });

  it("rejects corrupt, substituted, and non-canonical existing objects", async () => {
    const { coordinate, prepared } = await fixture();
    for (const mutate of [
      (object: NonNullable<ReturnType<MemoryBucket["objects"]["get"]>>) => {
        object.body = `${object.body} `;
      },
      (object: NonNullable<ReturnType<MemoryBucket["objects"]["get"]>>) => {
        object.customMetadata.bodyHash = "00".repeat(32);
      },
      (object: NonNullable<ReturnType<MemoryBucket["objects"]["get"]>>) => {
        object.customMetadata.commandHash = "00".repeat(32);
      },
      (object: NonNullable<ReturnType<MemoryBucket["objects"]["get"]>>) => {
        object.httpMetadata.contentType = "text/plain";
      },
    ]) {
      const bucket = new MemoryBucket();
      await writeCommandReceiptArchive(bucket as unknown as R2Bucket, prepared);
      const object = bucket.objects.get(coordinate.key);
      expect(object).toBeDefined();
      mutate(object as NonNullable<typeof object>);
      await expect(
        readCommandReceiptArchive(bucket as unknown as R2Bucket, coordinate),
      ).rejects.toMatchObject({ code: "corrupt" });
      await expect(
        writeCommandReceiptArchive(bucket as unknown as R2Bucket, prepared),
      ).rejects.toMatchObject({ code: "corrupt" });
    }
  });

  it("fails closed on R2 outage and rejects over-cap multibyte bodies", async () => {
    const bucket = new MemoryBucket();
    bucket.unavailable = true;
    const { coordinate, prepared } = await fixture();

    await expect(
      readCommandReceiptArchive(bucket as unknown as R2Bucket, coordinate),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommandReceiptArchiveError>>({
        code: "unavailable",
      }),
    );
    await expect(
      writeCommandReceiptArchive(bucket as unknown as R2Bucket, prepared),
    ).rejects.toMatchObject({ code: "unavailable" });

    const oversized = { text: "🤖".repeat(32_769) };
    expect(canonicalJson(oversized).length).toBeLessThan(131_072);
    await expect(
      prepareCommandReceiptArchive(coordinate, payloadHash, oversized),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("binds metadata bodyHash to the exact canonical bytes", async () => {
    const { prepared } = await fixture();
    await expect(sha256Hex(prepared.body)).resolves.toBe(
      prepared.metadata.bodyHash,
    );
    expect(Object.keys(prepared.metadata).sort()).toEqual([
      "aggregate",
      "aggregateHash",
      "bodyHash",
      "commandHash",
      "payloadHash",
      "schemaVersion",
      "terminal",
    ]);
  });
});
