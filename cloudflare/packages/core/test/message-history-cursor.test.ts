import { describe, expect, it } from "vitest";

import {
  decodeMessageHistoryCursor,
  encodeMessageHistoryCursor,
  type MessageHistoryCursor,
  type MessageHistoryCursorScope,
} from "../src/message-history-cursor";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const cursorKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const goldenCursor =
  "mhc1.eyJ2IjoxLCJ3IjoiNTg5NzVjYTgtM2I3NS00MmM3LWExM2EtNTFjOWQ3MzA2MjAwIiwiYyI6ImUzYTkyZjhkLWYwMTMtNDZiNy05MzcwLTVjYTFjNzliNjI4MCIsImgiOjQyLCJwIjozNywiZCI6Im8ifQ.TaN2K72Zi08GhyREs2E7lYB-cbxpTrCkYp0Cf19xxRw";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function signRawPayload(payload: string): Promise<string> {
  const prefix = "mhc1";
  const encodedPayload = base64Url(new TextEncoder().encode(payload));
  const signed = `${prefix}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    cursorKey,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

describe("opaque Message history cursors", () => {
  it("round-trips a stable authoritative position as a URL-safe golden cursor", async () => {
    const cursor = {
      version: 1 as const,
      workspaceId,
      conversationId,
      highWaterCursor: 42,
      positionCursor: 37,
      direction: "older" as const,
    };

    const encoded = await encodeMessageHistoryCursor(cursor, cursorKey);

    expect(encoded).toBe(goldenCursor);
    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/u);
    await expect(
      decodeMessageHistoryCursor(
        encoded,
        { workspaceId, conversationId },
        cursorKey,
      ),
    ).resolves.toEqual(cursor);
  });

  it("fails closed when any token segment or its framing is altered", async () => {
    const [prefix, payload, signature] = goldenCursor.split(".") as [
      string,
      string,
      string,
    ];
    const altered = [
      `mhc2.${payload}.${signature}`,
      `${prefix}.A${payload.slice(1)}.${signature}`,
      `${prefix}.${payload}.A${signature.slice(1)}`,
      `${goldenCursor}.extra`,
    ];

    for (const candidate of altered) {
      await expect(
        decodeMessageHistoryCursor(
          candidate,
          { workspaceId, conversationId },
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message history cursor");
    }
  });

  it("rejects signing and verification keys shorter than 32 bytes", async () => {
    const cursor = {
      version: 1 as const,
      workspaceId,
      conversationId,
      highWaterCursor: 42,
      positionCursor: 37,
      direction: "older" as const,
    };
    const shortKey = new TextEncoder().encode("too-short");

    await expect(encodeMessageHistoryCursor(cursor, shortKey)).rejects.toThrow(
      "Message history cursor key must contain at least 32 bytes",
    );
    await expect(
      decodeMessageHistoryCursor(
        goldenCursor,
        { workspaceId, conversationId },
        shortKey,
      ),
    ).rejects.toThrow(
      "Message history cursor key must contain at least 32 bytes",
    );
  });

  it("rejects invalid authoritative cursor positions before signing", async () => {
    const invalidPositions = [
      { highWaterCursor: 0, positionCursor: 1 },
      { highWaterCursor: 42, positionCursor: 0 },
      { highWaterCursor: 42, positionCursor: 43 },
      { highWaterCursor: 1.5, positionCursor: 1 },
      { highWaterCursor: Number.MAX_SAFE_INTEGER + 1, positionCursor: 1 },
    ];

    for (const position of invalidPositions) {
      await expect(
        encodeMessageHistoryCursor(
          {
            version: 1,
            workspaceId,
            conversationId,
            ...position,
            direction: "older",
          },
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message history cursor input");
    }
  });

  it("rejects authentic but unknown, malformed, or invalid cursor payloads", async () => {
    const invalidPayloads = [
      { v: 2, w: workspaceId, c: conversationId, h: 42, p: 37, d: "o" },
      { v: 1, w: workspaceId, c: conversationId, h: 0, p: 1, d: "o" },
      { v: 1, w: workspaceId, c: conversationId, h: 42, p: 43, d: "o" },
      { v: 1, w: workspaceId, c: conversationId, h: 42.5, p: 37, d: "o" },
      {
        v: 1,
        w: workspaceId,
        c: conversationId,
        h: Number.MAX_SAFE_INTEGER + 1,
        p: 37,
        d: "o",
      },
      {
        v: 1,
        w: workspaceId,
        c: conversationId,
        h: 42,
        p: 37,
        d: "sideways",
      },
      {
        v: 1,
        w: workspaceId,
        c: conversationId,
        h: 42,
        p: 37,
        d: "o",
        unexpected: true,
      },
    ];
    const candidates = await Promise.all([
      ...invalidPayloads.map((payload) =>
        signRawPayload(JSON.stringify(payload)),
      ),
      signRawPayload("{"),
    ]);

    for (const candidate of candidates) {
      await expect(
        decodeMessageHistoryCursor(
          candidate,
          { workspaceId, conversationId },
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message history cursor");
    }
  });

  it("binds identical positions to both Workspace and Conversation scopes", async () => {
    const otherWorkspaceId = "20f14f9b-7669-4c1e-94b7-4ad3332a992c";
    const otherConversationId = "d86a1021-24dd-4e2d-bf0a-5ba340637bbc";
    const commonPosition = {
      version: 1 as const,
      highWaterCursor: 42,
      positionCursor: 37,
      direction: "older" as const,
    };
    const otherWorkspaceCursor = await encodeMessageHistoryCursor(
      {
        ...commonPosition,
        workspaceId: otherWorkspaceId,
        conversationId,
      },
      cursorKey,
    );
    const otherConversationCursor = await encodeMessageHistoryCursor(
      {
        ...commonPosition,
        workspaceId,
        conversationId: otherConversationId,
      },
      cursorKey,
    );

    expect(otherWorkspaceCursor).not.toBe(goldenCursor);
    expect(otherConversationCursor).not.toBe(goldenCursor);
    await expect(
      decodeMessageHistoryCursor(
        goldenCursor,
        { workspaceId: otherWorkspaceId, conversationId },
        cursorKey,
      ),
    ).rejects.toMatchObject({ message: "Invalid Message history cursor" });
    await expect(
      decodeMessageHistoryCursor(
        goldenCursor,
        { workspaceId, conversationId: otherConversationId },
        cursorKey,
      ),
    ).rejects.toMatchObject({ message: "Invalid Message history cursor" });
  });

  it("binds a continuation cursor to its optional thread filter", async () => {
    const threadRootMessageId = "00000000-0000-8000-8000-000000000042";
    const filtered = await encodeMessageHistoryCursor(
      {
        version: 1,
        workspaceId,
        conversationId,
        threadRootMessageId,
        highWaterCursor: 42,
        positionCursor: 37,
        direction: "older",
      },
      cursorKey,
    );

    await expect(
      decodeMessageHistoryCursor(
        filtered,
        { workspaceId, conversationId, threadRootMessageId },
        cursorKey,
      ),
    ).resolves.toMatchObject({ threadRootMessageId });
    await expect(
      decodeMessageHistoryCursor(
        filtered,
        { workspaceId, conversationId },
        cursorKey,
      ),
    ).rejects.toThrow("Invalid Message history cursor");
    await expect(
      decodeMessageHistoryCursor(
        goldenCursor,
        { workspaceId, conversationId, threadRootMessageId },
        cursorKey,
      ),
    ).rejects.toThrow("Invalid Message history cursor");
  });

  it("refuses to sign an empty Workspace or Conversation scope", async () => {
    for (const scope of [
      { workspaceId: " ", conversationId },
      { workspaceId, conversationId: "\t" },
    ]) {
      await expect(
        encodeMessageHistoryCursor(
          {
            version: 1,
            ...scope,
            highWaterCursor: 42,
            positionCursor: 37,
            direction: "older",
          },
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message history cursor input");
    }
  });

  it("refuses unknown runtime versions and directions instead of coercing them", async () => {
    const validCursor = {
      version: 1,
      workspaceId,
      conversationId,
      highWaterCursor: 42,
      positionCursor: 37,
      direction: "older",
    };
    const invalidRuntimeInputs = [
      { ...validCursor, version: 2 },
      { ...validCursor, direction: "sideways" },
    ];

    for (const input of invalidRuntimeInputs) {
      await expect(
        encodeMessageHistoryCursor(
          input as unknown as MessageHistoryCursor,
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message history cursor input");
    }
  });

  it("rejects an absent or empty expected decode scope uniformly", async () => {
    const invalidScopes = [
      undefined,
      { workspaceId: "", conversationId },
      { workspaceId, conversationId: " " },
    ];

    for (const scope of invalidScopes) {
      await expect(
        decodeMessageHistoryCursor(
          goldenCursor,
          scope as unknown as MessageHistoryCursorScope,
          cursorKey,
        ),
      ).rejects.toMatchObject({ message: "Invalid Message history cursor" });
    }
  });

  it("paginates same-time Messages by stable createdCursor instead of timestamp", async () => {
    const firstPage = await encodeMessageHistoryCursor(
      {
        version: 1,
        workspaceId,
        conversationId,
        highWaterCursor: 100,
        positionCursor: 75,
        direction: "older",
      },
      cursorKey,
    );
    const secondPage = await encodeMessageHistoryCursor(
      {
        version: 1,
        workspaceId,
        conversationId,
        highWaterCursor: 100,
        positionCursor: 74,
        direction: "older",
      },
      cursorKey,
    );
    const forwardPage = await encodeMessageHistoryCursor(
      {
        version: 1,
        workspaceId,
        conversationId,
        highWaterCursor: 100,
        positionCursor: 75,
        direction: "newer",
      },
      cursorKey,
    );

    expect(new Set([firstPage, secondPage, forwardPage])).toHaveLength(3);
    await expect(
      decodeMessageHistoryCursor(
        secondPage,
        { workspaceId, conversationId },
        cursorKey,
      ),
    ).resolves.toMatchObject({
      highWaterCursor: 100,
      positionCursor: 74,
      direction: "older",
    });
    await expect(
      decodeMessageHistoryCursor(
        forwardPage,
        { workspaceId, conversationId },
        cursorKey,
      ),
    ).resolves.toMatchObject({
      highWaterCursor: 100,
      positionCursor: 75,
      direction: "newer",
    });
  });
});
