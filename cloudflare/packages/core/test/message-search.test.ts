import { describe, expect, it, vi } from "vitest";

import {
  deriveMessageSearchDocument,
  deriveMessageSearchQuery,
  MESSAGE_SEARCH_ALGORITHM,
  messageSearchPlaintextMatchesQuery,
} from "../src/message-search";

const firstWorkspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const secondWorkspaceId = "20f14f9b-7669-4c1e-94b7-4ad3332a992c";
const firstConversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const secondConversationId = "d86a1021-24dd-4e2d-bf0a-5ba340637bbc";
const searchMasterKey = new TextEncoder().encode(
  "fixed-message-search-test-key-32-bytes-minimum",
);

describe("opaque Message lexical search tokens", () => {
  it("matches normalized terms without correlating Workspaces or Conversations", async () => {
    const firstDocument = await deriveMessageSearchDocument(
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "  Déploiement CLOUDFLARE, déploiement!  ",
      },
      searchMasterKey,
    );
    const firstQuery = await deriveMessageSearchQuery(
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "déploiement",
      },
      searchMasterKey,
    );
    const repeatedDocument = await deriveMessageSearchDocument(
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "  Déploiement CLOUDFLARE, déploiement!  ",
      },
      searchMasterKey,
    );
    const secondQuery = await deriveMessageSearchQuery(
      {
        workspaceId: secondWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "déploiement",
      },
      searchMasterKey,
    );
    const secondConversationQuery = await deriveMessageSearchQuery(
      {
        workspaceId: firstWorkspaceId,
        conversationId: secondConversationId,
        plaintext: "déploiement",
      },
      searchMasterKey,
    );

    expect(firstDocument).toEqual({
      algorithm: MESSAGE_SEARCH_ALGORITHM,
      tokens: [firstQuery.tokens[0], expect.any(String)],
    });
    expect(repeatedDocument).toEqual(firstDocument);
    expect(
      firstDocument.tokens.every((token) =>
        /^h2_[A-Za-z0-9_-]{43}$/.test(token),
      ),
    ).toBe(true);
    expect(JSON.stringify(firstDocument)).not.toContain("déploiement");
    expect(firstQuery.tokens[0]).not.toBe(secondQuery.tokens[0]);
    expect(firstQuery.tokens[0]).not.toBe(secondConversationQuery.tokens[0]);
  });

  it("emits unique document and query tokens without frequency expansion", async () => {
    const document = await deriveMessageSearchDocument(
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "Bot bot BOT",
      },
      searchMasterKey,
    );
    const query = await deriveMessageSearchQuery(
      {
        workspaceId: firstWorkspaceId,
        conversationId: firstConversationId,
        plaintext: "Bot bot BOT",
      },
      searchMasterKey,
    );

    expect(document.tokens).toHaveLength(1);
    expect(query.tokens).toEqual(document.tokens);
  });

  it("bounds document work and rejects a query above 32 terms before HMAC", async () => {
    const signatureSpy = vi
      .spyOn(crypto.subtle, "sign")
      .mockImplementation(async () => {
        const signature = new Uint8Array(32);
        new DataView(signature.buffer).setUint32(
          0,
          signatureSpy.mock.calls.length,
        );
        return signature.buffer;
      });
    const uniqueTerms = Array.from(
      { length: 1_024 },
      (_, index) => `term${index}`,
    );
    const plaintext = Array.from({ length: 32 }, (_, repetition) =>
      uniqueTerms
        .map((term) => (repetition % 2 === 0 ? term : term.toUpperCase()))
        .join(" "),
    ).join(" ");

    try {
      const document = await deriveMessageSearchDocument(
        {
          workspaceId: firstWorkspaceId,
          conversationId: firstConversationId,
          plaintext,
        },
        searchMasterKey,
      );

      expect(signatureSpy).toHaveBeenCalledTimes(1_024);
      expect(document.tokens).toHaveLength(1_024);
      expect(new Set(document.tokens).size).toBe(1_024);

      signatureSpy.mockClear();
      await expect(
        deriveMessageSearchQuery(
          {
            workspaceId: firstWorkspaceId,
            conversationId: firstConversationId,
            plaintext,
          },
          searchMasterKey,
        ),
      ).rejects.toThrow("between 1 and 32 unique terms");
      expect(signatureSpy).not.toHaveBeenCalled();

      const exactQuery = await deriveMessageSearchQuery(
        {
          workspaceId: firstWorkspaceId,
          conversationId: firstConversationId,
          plaintext: uniqueTerms.slice(0, 32).join(" "),
        },
        searchMasterKey,
      );
      expect(signatureSpy).toHaveBeenCalledTimes(32);
      expect(exactQuery.tokens).toHaveLength(32);
    } finally {
      signatureSpy.mockRestore();
    }
  });

  it("rejects a query without a lexical term before doing WebCrypto work", async () => {
    const signatureSpy = vi.spyOn(crypto.subtle, "sign");
    try {
      await expect(
        deriveMessageSearchQuery(
          {
            workspaceId: firstWorkspaceId,
            conversationId: firstConversationId,
            plaintext: " — !!! \t ",
          },
          searchMasterKey,
        ),
      ).rejects.toThrow("between 1 and 32 unique terms");
      expect(signatureSpy).not.toHaveBeenCalled();
    } finally {
      signatureSpy.mockRestore();
    }
  });

  it("rechecks the current decrypted content and topic with identical normalization", () => {
    const current = {
      content: "Guide de DÉPLOIEMENT Cloudflare",
      topic: "Réponse à incident",
    };

    expect(
      messageSearchPlaintextMatchesQuery(current, "déploiement INCIDENT"),
    ).toBe(true);
    expect(
      messageSearchPlaintextMatchesQuery(
        { content: "Guide réécrit", topic: "Réponse à incident" },
        "déploiement incident",
      ),
    ).toBe(false);
    expect(messageSearchPlaintextMatchesQuery(current, "!!!")).toBe(false);
  });

  it("refuses to derive unscoped tokens", async () => {
    await expect(
      deriveMessageSearchDocument(
        {
          workspaceId: " ",
          conversationId: firstConversationId,
          plaintext: "contenu confidentiel",
        },
        searchMasterKey,
      ),
    ).rejects.toThrow("Workspace scope is required");
    await expect(
      deriveMessageSearchDocument(
        {
          workspaceId: firstWorkspaceId,
          conversationId: " ",
          plaintext: "contenu confidentiel",
        },
        searchMasterKey,
      ),
    ).rejects.toThrow("Conversation scope is required");
  });
});
