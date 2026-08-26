import { describe, expect, it } from "vitest";

import {
  decodeMessageSearchCursor,
  deriveMessageSearchCursorQueryBinding,
  encodeMessageSearchCursor,
  MESSAGE_SEARCH_NORMALIZATION,
  type MessageSearchCursor,
  type MessageSearchCursorScope,
} from "../src/message-search-cursor";

const punkId = "ad39a29e-5a47-4f4a-a1f8-18e535edb338";
const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const messageId = "2a105f2b-ac75-48ae-a687-e4191715143a";
const threadRootMessageId = "44444444-4444-4444-8444-444444444444";
const cursorKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const firstToken = `h2_${"A".repeat(43)}`;
const secondToken = `h2_${"-_".repeat(21)}-`;
const tokens = [firstToken, secondToken];

function scope(
  queryBinding: string,
  threadRoot: string | null = null,
): MessageSearchCursorScope {
  return {
    punkId,
    workspaceId,
    conversationId,
    threadRootMessageId: threadRoot,
    algorithm: "hmac-sha256-conversation-v2",
    normalization: MESSAGE_SEARCH_NORMALIZATION,
    queryBinding,
    limit: 25,
  };
}

describe("opaque Message search cursors", () => {
  it("round-trips a total D1 candidate position without exposing query material", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const cursor: MessageSearchCursor = {
      version: 1,
      ...scope(queryBinding),
      position: [73, conversationId, messageId],
    };

    const encoded = await encodeMessageSearchCursor(cursor, cursorKey);

    expect(encoded).toMatch(/^msc1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u);
    expect(queryBinding).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(
      decodeMessageSearchCursor(encoded, scope(queryBinding), cursorKey),
    ).resolves.toEqual(cursor);
    for (const secret of [
      punkId,
      workspaceId,
      conversationId,
      queryBinding,
      firstToken,
    ]) {
      expect(encoded).not.toContain(secret);
    }
    await expect(
      encodeMessageSearchCursor(cursor, cursorKey),
    ).resolves.not.toBe(encoded);
  });

  it("canonicalizes token order when deriving the keyed query binding", async () => {
    const forward = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const reverse = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [...tokens].reverse(),
      },
      cursorKey,
    );

    expect(reverse).toBe(forward);
    await expect(
      deriveMessageSearchCursorQueryBinding(
        {
          punkId: "723246f7-742e-4853-967c-0a310f315e62",
          workspaceId,
          conversationId,
          algorithm: "hmac-sha256-conversation-v2",
          tokens,
        },
        cursorKey,
      ),
    ).resolves.not.toBe(forward);
  });

  it("binds continuations to the Punk, Workspace, query, limit, and versions", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const encoded = await encodeMessageSearchCursor(
      {
        version: 1,
        ...scope(queryBinding),
        position: [73, conversationId, messageId],
      },
      cursorKey,
    );
    const mismatches: MessageSearchCursorScope[] = [
      {
        ...scope(queryBinding),
        punkId: "723246f7-742e-4853-967c-0a310f315e62",
      },
      {
        ...scope(queryBinding),
        workspaceId: "20f14f9b-7669-4c1e-94b7-4ad3332a992c",
      },
      {
        ...scope(queryBinding),
        conversationId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
      },
      scope(queryBinding, threadRootMessageId),
      { ...scope(queryBinding), queryBinding: "B".repeat(43) },
      { ...scope(queryBinding), limit: 26 },
      {
        ...scope(queryBinding),
        normalization:
          "future-normalization" as typeof MESSAGE_SEARCH_NORMALIZATION,
      },
      {
        ...scope(queryBinding),
        algorithm: "future-algorithm" as "hmac-sha256-conversation-v2",
      },
    ];

    for (const mismatch of mismatches) {
      await expect(
        decodeMessageSearchCursor(encoded, mismatch, cursorKey),
      ).rejects.toThrow("Invalid Message search cursor");
    }
  });

  it("encrypts the Fil scope and refuses the same cursor at Conversation scope", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const threadScope = scope(queryBinding, threadRootMessageId);
    const encoded = await encodeMessageSearchCursor(
      {
        version: 1,
        ...threadScope,
        position: [73, conversationId, messageId],
      },
      cursorKey,
    );

    expect(encoded).not.toContain(threadRootMessageId);
    await expect(
      decodeMessageSearchCursor(encoded, threadScope, cursorKey),
    ).resolves.toMatchObject({ threadRootMessageId });
    await expect(
      decodeMessageSearchCursor(encoded, scope(queryBinding), cursorKey),
    ).rejects.toThrow("Invalid Message search cursor");
  });

  it("fails closed when framing, payload, or signature is altered", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const encoded = await encodeMessageSearchCursor(
      {
        version: 1,
        ...scope(queryBinding),
        position: [73, conversationId, messageId],
      },
      cursorKey,
    );
    const [prefix, iv, ciphertext] = encoded.split(".") as [
      string,
      string,
      string,
    ];
    const changedIv = `${iv[0] === "A" ? "B" : "A"}${iv.slice(1)}`;
    const changedCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;

    for (const candidate of [
      `msc2.${iv}.${ciphertext}`,
      `${prefix}.${changedIv}.${ciphertext}`,
      `${prefix}.${iv}.${changedCiphertext}`,
      `${encoded}.extra`,
      `msc1.${"A".repeat(16)}.${"B".repeat(2_000)}`,
    ]) {
      await expect(
        decodeMessageSearchCursor(candidate, scope(queryBinding), cursorKey),
      ).rejects.toThrow("Invalid Message search cursor");
    }
  });

  it("bounds an encrypted maximum-safe position for the public contract", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const cursor: MessageSearchCursor = {
      version: 1,
      ...scope(queryBinding),
      position: [Number.MAX_SAFE_INTEGER, conversationId, messageId],
    };

    const encoded = await encodeMessageSearchCursor(cursor, cursorKey);

    expect(encoded.length).toBeLessThanOrEqual(1_024);
    await expect(
      decodeMessageSearchCursor(encoded, scope(queryBinding), cursorKey),
    ).resolves.toEqual(cursor);
  });

  it("rejects weak keys and malformed bindings or positions", async () => {
    const queryBinding = await deriveMessageSearchCursorQueryBinding(
      {
        punkId,
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens,
      },
      cursorKey,
    );
    const valid: MessageSearchCursor = {
      version: 1,
      ...scope(queryBinding),
      position: [73, conversationId, messageId],
    };
    const shortKey = new TextEncoder().encode("too-short");

    await expect(
      deriveMessageSearchCursorQueryBinding(
        {
          punkId,
          workspaceId,
          conversationId,
          algorithm: "hmac-sha256-conversation-v2",
          tokens,
        },
        shortKey,
      ),
    ).rejects.toThrow("at least 32 bytes");
    await expect(encodeMessageSearchCursor(valid, shortKey)).rejects.toThrow(
      "at least 32 bytes",
    );
    for (const invalid of [
      { ...valid, version: 2 },
      { ...valid, limit: 0 },
      { ...valid, queryBinding: "not-a-binding" },
      { ...valid, position: [0, conversationId, messageId] },
      { ...valid, position: [73.5, conversationId, messageId] },
      { ...valid, position: [73, "not-a-uuid", messageId] },
      { ...valid, position: [73, conversationId, "not-a-uuid"] },
    ]) {
      await expect(
        encodeMessageSearchCursor(
          invalid as unknown as MessageSearchCursor,
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message search cursor input");
    }
  });

  it("rejects empty, duplicate, malformed, or oversized query-token sets", async () => {
    const invalidSets = [
      [],
      [firstToken, firstToken],
      ["plaintext"],
      Array.from(
        { length: 33 },
        (_, index) => `h2_${index.toString().padStart(43, "A")}`,
      ),
    ];

    for (const invalidTokens of invalidSets) {
      await expect(
        deriveMessageSearchCursorQueryBinding(
          {
            punkId,
            workspaceId,
            conversationId,
            algorithm: "hmac-sha256-conversation-v2",
            tokens: invalidTokens,
          },
          cursorKey,
        ),
      ).rejects.toThrow("Invalid Message search query binding input");
    }
  });
});
