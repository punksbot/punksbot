import type {
  AuthSession,
  Conversation,
  MessageView,
  Workspace,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  createHttpPunksClient,
  createMemoryPunksClient,
  PunksClientError,
} from "../src/index";

const now = "2026-08-21T12:00:00.000Z";

const session: AuthSession = {
  sessionId: "55555555-5555-4555-8555-555555555555",
  punkId: "11111111-1111-4111-8111-111111111111",
  authenticatedAt: now,
  expiresAt: "2026-08-22T12:00:00.000Z",
  recentReauthUntil: null,
  punk: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Local Punk",
    avatarUrl: null,
  },
};

const workspace: Workspace = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "local",
  name: "Local Punks",
  visibility: "private",
  status: "active",
  ownerPunkId: session.punkId,
  members: [{ punkId: session.punkId, role: "owner" }],
  revision: 1,
  cursor: 1,
  createdAt: now,
  updatedAt: now,
};

const conversation: Conversation = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId: workspace.id,
  name: "General",
  type: "stream",
  visibility: "open",
  description: "Local development",
  topic: null,
  purpose: null,
  topicRequired: false,
  maxMembers: null,
  ttlSeconds: null,
  ttlDeadline: null,
  ownerPunkId: session.punkId,
  members: [
    {
      punkId: session.punkId,
      access: "owner",
      joinedAt: now,
      invitedByPunkId: null,
    },
  ],
  status: "active",
  revision: 1,
  cursor: 1,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};

const welcomeMessage: MessageView = {
  id: "44444444-4444-4444-8444-444444444444",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  author: { kind: "punk", punkId: session.punkId },
  messageType: "stream-message",
  status: "active",
  content: "Bienvenue sur Punks Bot.",
  topic: null,
  mentionedPunkIds: [],
  mediaIds: [],
  parentMessageId: null,
  threadRootMessageId: "44444444-4444-4444-8444-444444444444",
  threadDepth: 0,
  broadcast: false,
  replyCount: 0,
  descendantCount: 0,
  lastReplyAt: null,
  currentVersion: 1,
  retractionKind: null,
  retractedAt: null,
  eraseAfter: null,
  publicReason: null,
  erasedAt: null,
  revision: 1,
  createdCursor: 1,
  cursor: 1,
  createdAt: now,
  updatedAt: now,
  editedAt: null,
};

describe("PunksClient", () => {
  it("exposes the seeded local vertical slice through its public interface", async () => {
    const client = createMemoryPunksClient({
      session,
      workspace,
      conversation,
      messages: [welcomeMessage],
    });

    const bootstrap = await client.bootstrapLocal();

    expect(bootstrap).toEqual({
      session,
      workspace,
      conversation,
      messages: [welcomeMessage],
    });
    await expect(client.getSession()).resolves.toEqual(session);
    await expect(client.getWorkspace("local")).resolves.toEqual(workspace);
    await expect(
      client.getConversation({
        workspaceId: workspace.id,
        conversationId: conversation.id,
      }),
    ).resolves.toEqual(conversation);
    await expect(
      client.getMessageHistory({
        workspaceId: workspace.id,
        conversationId: conversation.id,
      }),
    ).resolves.toMatchObject({
      items: [welcomeMessage],
      hasMore: false,
    });
  });

  it("posts a Message as the authenticated Punk and makes it readable", async () => {
    const client = createMemoryPunksClient({
      session,
      workspace,
      conversation,
      messages: [welcomeMessage],
    });

    const posted = await client.postMessage({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      content: "Premier Message depuis la Punks UI.",
    });

    expect(posted).toMatchObject({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      author: { kind: "punk", punkId: session.punkId },
      messageType: "stream-message",
      status: "active",
      content: "Premier Message depuis la Punks UI.",
      createdCursor: 2,
      cursor: 2,
    });
    const history = await client.getMessageHistory({
      workspaceId: workspace.id,
      conversationId: conversation.id,
    });
    expect(history.items).toHaveLength(2);
    expect(history.items[1]).toEqual(posted);
    expect(history.hasMore).toBe(false);
    await expect(history.nextPage()).resolves.toBeNull();
  });

  it("toggles one authoritative Reaction presence", async () => {
    const client = createMemoryPunksClient({
      session,
      workspace,
      conversation,
      messages: [welcomeMessage],
    });
    const input = {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      messageId: welcomeMessage.id,
      reaction: "🔥",
    };

    const added = await client.toggleReaction(input);
    const removed = await client.toggleReaction(input);

    expect(added).toMatchObject({
      effect: "added",
      replayed: false,
      reaction: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: welcomeMessage.id,
        actor: { kind: "punk", punkId: session.punkId },
        reaction: "🔥",
      },
    });
    expect(removed).toEqual({
      effect: "removed",
      replayed: false,
      reaction: null,
    });
  });

  it("bootstraps locally and then exercises the authoritative read path", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/__dev/bootstrap") {
        return Response.json({
          session,
          coordinates: {
            workspaceSlug: workspace.slug,
            workspaceId: workspace.id,
            conversationId: conversation.id,
          },
        });
      }
      if (path === `/api/v1/workspaces/${workspace.slug}`) {
        return Response.json({
          workspace,
          canonicalPath: `/w/${workspace.slug}`,
        });
      }
      if (
        path ===
        `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}`
      ) {
        return Response.json({
          conversation,
          canonicalPath: `/w/${workspace.id}/conversations/${conversation.id}`,
        });
      }
      if (
        path ===
        `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}/messages`
      ) {
        return Response.json({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          highWaterCursor: 1,
          order: "createdCursor-ascending",
          items: [welcomeMessage],
          nextCursor: null,
        });
      }
      return Response.json({ unexpected: path }, { status: 500 });
    };
    const client = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchStub,
    });

    await expect(client.bootstrapLocal()).resolves.toEqual({
      session,
      workspace,
      conversation,
      messages: [welcomeMessage],
    });
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/__dev/bootstrap",
      `/api/v1/workspaces/${workspace.slug}`,
      `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}`,
      `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}/messages`,
    ]);
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    expect(requests.every(({ init }) => init?.credentials === "include")).toBe(
      true,
    );
  });

  it("posts over HTTP without exposing session or idempotency details", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const postedMessage: MessageView = {
      ...welcomeMessage,
      id: "66666666-6666-4666-8666-666666666666",
      content: "Message HTTP",
      threadRootMessageId: "66666666-6666-4666-8666-666666666666",
      createdCursor: 2,
      cursor: 2,
    };
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (new URL(url).pathname === "/api/auth/v1/session") {
        return Response.json({ session });
      }
      return Response.json(
        { message: postedMessage, replayed: false },
        { status: 201 },
      );
    };
    const client = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchStub,
    });

    await expect(
      client.postMessage({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: "Message HTTP",
      }),
    ).resolves.toEqual(postedMessage);

    expect(requests).toHaveLength(2);
    const mutation = requests[1];
    expect(new URL(mutation?.url ?? "").pathname).toBe(
      `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}/messages`,
    );
    const command = JSON.parse(String(mutation?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(command).toMatchObject({
      contract: "message.post@1",
      workspaceId: workspace.id,
      conversationId: conversation.id,
      actor: { kind: "punk", punkId: session.punkId },
      payload: {
        content: "Message HTTP",
        replyToMessageId: null,
        broadcast: false,
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    });
    expect(command.commandId).toEqual(expect.any(String));
    const headers = new Headers(mutation?.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe(command.commandId);
    expect(mutation?.init?.credentials).toBe("include");
  });

  it("toggles a Reaction over HTTP without exposing command details", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const response = {
      reaction: {
        id: "77777777-7777-4777-8777-777777777777",
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: welcomeMessage.id,
        actor: { kind: "punk" as const, punkId: session.punkId },
        reaction: "🔥",
        reactedAt: now,
      },
      effect: "added" as const,
      replayed: false,
    };
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (new URL(url).pathname === "/api/auth/v1/session") {
        return Response.json({ session });
      }
      return Response.json(response, { status: 201 });
    };
    const client = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchStub,
    });

    await expect(
      client.toggleReaction({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: welcomeMessage.id,
        reaction: "🔥",
      }),
    ).resolves.toEqual(response);

    const mutation = requests[1];
    expect(new URL(mutation?.url ?? "").pathname).toBe(
      `/api/v1/workspaces/${workspace.id}/conversations/${conversation.id}/messages/${welcomeMessage.id}/reactions/toggle`,
    );
    const command = JSON.parse(String(mutation?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(command).toMatchObject({
      contract: "message.reaction-toggle@1",
      workspaceId: workspace.id,
      conversationId: conversation.id,
      messageId: welcomeMessage.id,
      actor: { kind: "punk", punkId: session.punkId },
      payload: { reaction: "🔥" },
    });
    const headers = new Headers(mutation?.init?.headers);
    expect(headers.get("idempotency-key")).toBe(command.commandId);
  });

  it("never replays a mutation after an ambiguous backend response", async () => {
    const attempts: RequestInit[] = [];
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/api/auth/v1/session") {
        return Response.json({ session });
      }
      attempts.push(init ?? {});
      return Response.json(
        {
          type: "https://punks.bot/problems/temporarily-unavailable",
          title: "Command outcome is unknown",
          status: 503,
          code: "temporarily_unavailable",
          correlationId: "ambiguous-correlation",
          retry: "same_command",
        },
        { status: 503 },
      );
    };
    const client = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchStub,
    });

    await expect(
      client.postMessage({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: "Intention unique",
      }),
    ).rejects.toMatchObject({
      problem: {
        correlationId: "ambiguous-correlation",
        retry: "same_command",
      },
    });

    expect(attempts).toHaveLength(1);
  });

  it("surfaces structured Punks problems through either adapter", async () => {
    const problem = {
      type: "https://punks.bot/problems/not-found",
      title: "Workspace not found",
      status: 404,
      code: "not_found" as const,
      correlationId: "missing-workspace",
      retry: "never" as const,
    };
    const memory = createMemoryPunksClient({
      session,
      workspace,
      conversation,
    });
    const http = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: async () => Response.json(problem, { status: 404 }),
    });

    for (const client of [memory, http]) {
      try {
        await client.getWorkspace("missing");
        throw new Error("Expected getWorkspace to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(PunksClientError);
        expect((error as PunksClientError).problem).toMatchObject({
          status: 404,
          code: "not_found",
          retry: "never",
        });
      }
    }
  });

  it("keeps opaque history cursors behind nextPage", async () => {
    const requests: string[] = [];
    const secondMessage: MessageView = {
      ...welcomeMessage,
      id: "99999999-9999-4999-8999-999999999999",
      content: "Page suivante",
      threadRootMessageId: "99999999-9999-4999-8999-999999999999",
      createdCursor: 2,
      cursor: 2,
    };
    const fetchStub: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const cursor = new URL(url).searchParams.get("cursor");
      return Response.json({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        highWaterCursor: 2,
        order: "createdCursor-ascending",
        items: cursor === null ? [welcomeMessage] : [secondMessage],
        nextCursor: cursor === null ? `mhc1.payload.${"a".repeat(43)}` : null,
      });
    };
    const client = createHttpPunksClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: fetchStub,
    });

    const first = await client.getMessageHistory({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      limit: 1,
    });
    const second = await first.nextPage();

    expect(first).toMatchObject({ items: [welcomeMessage], hasMore: true });
    expect(first).not.toHaveProperty("nextCursor");
    expect(second).toMatchObject({ items: [secondMessage], hasMore: false });
    await expect(second?.nextPage()).resolves.toBeNull();
    expect(new URL(requests[1] ?? "").searchParams.get("cursor")).toBe(
      `mhc1.payload.${"a".repeat(43)}`,
    );
  });
});
