import { describe, expect, it } from "vitest";

import { type ContractId, validateContract } from "../src";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const punkId = "11111111-1111-4111-8111-111111111111";

function validates(contractId: string, value: unknown): boolean {
  return validateContract(contractId as ContractId, value).valid;
}

describe("desktop social loop contracts", () => {
  it("negotiates the exact profile before a Workspace is mounted", () => {
    const request = {
      contract: "desktop.compatibility@1",
      profile: "desktop-social-loop@1",
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    };
    const response = {
      contract: "desktop.compatibility-response@1",
      compatible: true,
      profile: "desktop-social-loop@1",
      registryVersion: 1,
      minimumClientVersion: "0.6.0",
      environment: "local",
      origin: "http://127.0.0.1:8787",
      capabilities: ["message-history", "message-post"],
    };

    expect(
      validates("punks://contracts/desktop.compatibility@1", request),
    ).toBe(true);
    expect(
      validates("punks://contracts/desktop.compatibility-response@1", response),
    ).toBe(true);
    expect(
      validates("punks://contracts/desktop.compatibility@1", {
        ...request,
        backend: "buzz",
      }),
    ).toBe(false);
  });

  it("lists only bounded authorized Workspace summaries", () => {
    const query = {
      contract: "workspace.list@1",
      limit: 50,
      cursor: null,
    };
    const response = {
      contract: "workspace.list-response@1",
      items: [
        {
          id: workspaceId,
          slug: "core-team",
          name: "Core Team",
          visibility: "private",
          role: "member",
          revision: 7,
        },
      ],
      nextCursor: null,
    };

    expect(validates("punks://contracts/workspace.list@1", query)).toBe(true);
    expect(
      validates("punks://contracts/workspace.list-response@1", response),
    ).toBe(true);
    expect(
      validates("punks://contracts/workspace.list-response@1", {
        ...response,
        items: [{ ...response.items[0], members: [punkId] }],
      }),
    ).toBe(false);
  });

  it("lists only active Stream summaries for one Workspace", () => {
    const query = {
      contract: "conversation.list@1",
      workspaceId,
      type: "stream",
      status: "active",
      limit: 50,
      cursor: null,
    };
    const response = {
      contract: "conversation.list-response@1",
      workspaceId,
      items: [
        {
          id: conversationId,
          workspaceId,
          name: "general",
          type: "stream",
          visibility: "open",
          description: null,
          topic: null,
          purpose: null,
          topicRequired: false,
          ttlSeconds: null,
          ttlDeadline: null,
          revision: 3,
          cursor: 9,
          updatedAt: "2026-08-22T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    };

    expect(validates("punks://contracts/conversation.list@1", query)).toBe(
      true,
    );
    expect(
      validates("punks://contracts/conversation.list-response@1", response),
    ).toBe(true);
    expect(
      validates("punks://contracts/conversation.list@1", {
        ...query,
        type: "forum",
      }),
    ).toBe(false);
  });

  it("resolves a bounded author sidecar without exposing a roster", () => {
    const query = {
      contract: "author.resolve@1",
      workspaceId,
      authors: [
        { kind: "punk", punkId },
        {
          kind: "bot",
          installationId: "44444444-4444-4444-8444-444444444444",
        },
      ],
    };
    const response = {
      contract: "author.resolve-response@1",
      workspaceId,
      authors: [
        {
          kind: "punk",
          punkId,
          displayName: "Mabza",
          avatarUrl: null,
        },
        {
          kind: "bot",
          installationId: "44444444-4444-4444-8444-444444444444",
          displayName: "Reviewer",
          avatarUrl: null,
        },
      ],
    };

    expect(validates("punks://contracts/author.resolve@1", query)).toBe(true);
    expect(
      validates("punks://contracts/author.resolve-response@1", response),
    ).toBe(true);
    expect(
      validates("punks://contracts/author.resolve@1", {
        ...query,
        authors: Array.from({ length: 101 }, () => query.authors[0]),
      }),
    ).toBe(false);
  });
});
