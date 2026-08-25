import type {
  AuthSession,
  ConversationView,
  DesktopCompatibilityResponse,
  ListConversationsResponse,
  ListWorkspacesResponse,
  MessageHistoryResponse,
  ResolveAuthorsResponse,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";
import operationCorpus from "../../contracts/conformance/desktop-social-loop-operations.json";

import { createHttpPunksAccountClient, PunksClientError } from "../src/index";

const origin = "http://127.0.0.1:8787";
const punkId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const secondWorkspaceId = "55555555-5555-4555-8555-555555555555";
const conversationId = "33333333-3333-4333-8333-333333333333";
const now = "2026-08-22T10:00:00.000Z";

const session: AuthSession = {
  sessionId: "99999999-9999-4999-8999-999999999999",
  punkId,
  authenticatedAt: now,
  expiresAt: "2026-09-22T10:00:00.000Z",
  recentReauthUntil: null,
  punk: { id: punkId, displayName: "Mabza", avatarUrl: null },
};

const compatibility: DesktopCompatibilityResponse = {
  contract: "desktop.compatibility-response@1",
  compatible: true,
  profile: "desktop-social-loop@1",
  registryVersion: 1,
  minimumClientVersion: "0.6.0",
  environment: "local",
  origin,
  capabilities: ["stream-list", "message-history", "message-post"],
};

const workspaces: ListWorkspacesResponse = {
  contract: "workspace.list-response@1",
  items: [
    {
      id: workspaceId,
      slug: "alpha",
      name: "Alpha",
      visibility: "private",
      role: "owner",
      revision: 1,
    },
    {
      id: secondWorkspaceId,
      slug: "beta",
      name: "Beta",
      visibility: "private",
      role: "member",
      revision: 1,
    },
  ],
  nextCursor: null,
};

const stream: ConversationView = {
  id: conversationId,
  workspaceId,
  name: "general",
  type: "stream",
  visibility: "open",
  description: null,
  topic: null,
  purpose: null,
  topicRequired: false,
  maxMembers: null,
  ttlSeconds: null,
  ttlDeadline: null,
  status: "active",
  revision: 1,
  cursor: 1,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};

const streams: ListConversationsResponse = {
  contract: "conversation.list-response@1",
  workspaceId,
  items: [
    {
      id: stream.id,
      workspaceId,
      name: stream.name,
      type: "stream",
      visibility: stream.visibility,
      description: stream.description,
      topic: stream.topic,
      purpose: stream.purpose,
      topicRequired: stream.topicRequired,
      ttlSeconds: stream.ttlSeconds,
      ttlDeadline: stream.ttlDeadline,
      revision: stream.revision,
      cursor: stream.cursor,
      updatedAt: stream.updatedAt,
    },
  ],
  nextCursor: null,
};

const emptyHistory: MessageHistoryResponse = {
  workspaceId,
  conversationId,
  highWaterCursor: 1,
  order: "createdCursor-ascending",
  items: [],
  nextCursor: null,
};

const authors: ResolveAuthorsResponse = {
  contract: "author.resolve-response@1",
  workspaceId,
  authors: [
    {
      kind: "punk",
      punkId,
      displayName: "Mabza",
      avatarUrl: null,
    },
  ],
};

function fixtureFetch(requests: Array<{ url: URL; init?: RequestInit }>) {
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.pathname === "/api/v1/desktop/compatibility") {
      return Response.json(compatibility);
    }
    if (url.pathname === "/api/auth/v1/session") {
      return Response.json({ session });
    }
    if (url.pathname === "/api/v1/workspaces") {
      return Response.json(workspaces);
    }
    if (url.pathname === `/api/v1/workspaces/${workspaceId}/conversations`) {
      return Response.json(streams);
    }
    if (
      url.pathname ===
      `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`
    ) {
      return Response.json({ conversation: stream });
    }
    if (
      url.pathname ===
      `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`
    ) {
      return Response.json(emptyHistory);
    }
    if (url.pathname === `/api/v1/workspaces/${workspaceId}/authors/resolve`) {
      return Response.json(authors);
    }
    return Response.json(
      {
        type: "https://punks.bot/problems/not-found",
        title: "Not found",
        status: 404,
        code: "not_found",
        correlationId: "fixture-not-found",
        retry: "never",
      },
      { status: 404 },
    );
  };
  return fetchStub;
}

describe("PunksAccountClient", () => {
  it("checks Compatibility before opening a generation-bound WorkspaceSession", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fixtureFetch(requests),
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });

    await expect(account.checkCompatibility()).resolves.toEqual(compatibility);
    await expect(account.getSession()).resolves.toEqual(session);
    await expect(account.listWorkspaces()).resolves.toEqual(workspaces.items);
    const workspace = await account.openWorkspace(workspaceId);

    expect(workspace.lease).toEqual({
      origin,
      punkId,
      workspaceId,
      generation: 1,
    });
    await expect(workspace.listStreams()).resolves.toEqual(streams.items);
    await expect(workspace.getStream(conversationId)).resolves.toEqual(stream);
    await expect(
      workspace.getTimeline({ conversationId }),
    ).resolves.toMatchObject({ items: [], hasMore: false });
    await expect(
      workspace.resolveAuthors([{ kind: "punk", punkId }]),
    ).resolves.toEqual(authors.authors);
    expect(requests[0]?.init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      contract: "desktop.compatibility@1",
      profile: "desktop-social-loop@1",
      clientVersion: "0.6.0",
    });
  });

  it("prefers durable Workspace identity over a UUID-shaped slug", async () => {
    const collisionDirectory: ListWorkspacesResponse = {
      contract: "workspace.list-response@1",
      items: [
        {
          id: secondWorkspaceId,
          slug: "durable-target",
          name: "Durable target",
          visibility: "private",
          role: "member",
          revision: 1,
        },
        {
          id: workspaceId,
          slug: secondWorkspaceId,
          name: "UUID-shaped slug",
          visibility: "private",
          role: "owner",
          revision: 1,
        },
      ],
      nextCursor: null,
    };
    const fetchStub: typeof globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/v1/desktop/compatibility") {
        return Response.json(compatibility);
      }
      if (path === "/api/auth/v1/session") {
        return Response.json({ session });
      }
      if (path === "/api/v1/workspaces") {
        return Response.json(collisionDirectory);
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();

    await expect(
      account.resolveWorkspace({
        kind: "id",
        workspaceId: secondWorkspaceId,
      }),
    ).resolves.toMatchObject({
      id: secondWorkspaceId,
      slug: "durable-target",
    });
    await expect(
      account.resolveWorkspace({
        kind: "slug",
        workspaceSlug: secondWorkspaceId,
      }),
    ).resolves.toMatchObject({
      id: workspaceId,
      slug: secondWorkspaceId,
    });
    await expect(
      account.openWorkspace(secondWorkspaceId),
    ).resolves.toMatchObject({
      lease: { workspaceId: secondWorkspaceId },
    });
  });

  it("invalidates an old lease before I/O when another Workspace opens", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    let directoryCalls = 0;
    let streamCalls = 0;
    let announceDirectoryRead: (() => void) | undefined;
    let releaseDirectoryRead: (() => void) | undefined;
    const directoryReadStarted = new Promise<void>((resolve) => {
      announceDirectoryRead = resolve;
    });
    const directoryReadReleased = new Promise<void>((resolve) => {
      releaseDirectoryRead = resolve;
    });
    const baseFetch = fixtureFetch(requests);
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/workspaces") {
        directoryCalls += 1;
        if (directoryCalls === 1) {
          return Response.json({
            ...workspaces,
            items: [workspaces.items[0]],
          });
        }
        announceDirectoryRead?.();
        await directoryReadReleased;
        return Response.json({
          ...workspaces,
          items: [workspaces.items[1]],
        });
      }
      if (url.pathname === `/api/v1/workspaces/${workspaceId}/conversations`) {
        streamCalls += 1;
      }
      return baseFetch(input, init);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();
    const first = await account.openWorkspace(workspaceId);
    const openingSecond = account.openWorkspace(secondWorkspaceId);
    await directoryReadStarted;
    const oldRead = await first.listStreams().then(
      () => null,
      (error: unknown) => error,
    );
    releaseDirectoryRead?.();
    const second = await openingSecond;
    const requestCount = requests.length;

    expect(second.lease.generation).toBe(2);
    expect(oldRead).toMatchObject({ kind: "stale_workspace" });
    expect(streamCalls).toBe(0);
    await expect(first.listStreams()).rejects.toMatchObject({
      kind: "stale_workspace",
    });
    expect(requests).toHaveLength(requestCount);
  });

  it("closes a WorkspaceSession before any later operation can perform I/O", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fixtureFetch(requests),
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();
    const workspace = await account.openWorkspace(workspaceId);
    workspace.close();
    const requestCount = requests.length;

    try {
      await workspace.getStream(conversationId);
      throw new Error("Expected stale WorkspaceSession");
    } catch (error) {
      expect(error).toBeInstanceOf(PunksClientError);
      expect(error).toMatchObject({ kind: "stale_workspace" });
    }
    expect(requests).toHaveLength(requestCount);
  });

  it("rejects a response when its lease becomes stale while I/O is pending", async () => {
    let releaseStreams: (() => void) | undefined;
    const streamsReleased = new Promise<void>((resolve) => {
      releaseStreams = resolve;
    });
    const baseFetch = fixtureFetch([]);
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/api/v1/workspaces/${workspaceId}/conversations`) {
        await streamsReleased;
      }
      return baseFetch(input, init);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();
    const first = await account.openWorkspace(workspaceId);
    const pending = first.listStreams();

    await account.openWorkspace(secondWorkspaceId);
    releaseStreams?.();

    await expect(pending).rejects.toMatchObject({ kind: "stale_workspace" });
  });

  it("reports an ambiguous mutation exactly once after a network cut", async () => {
    let mutationCalls = 0;
    const baseFetch = fixtureFetch([]);
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && init?.method === "POST") {
        mutationCalls += 1;
        throw new TypeError("connection ended after request upload");
      }
      return baseFetch(input, init);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();
    const workspace = await account.openWorkspace(workspaceId);

    await expect(
      workspace.postMessage({ conversationId, content: "one intent" }),
    ).rejects.toMatchObject({ kind: "ambiguous" });
    expect(mutationCalls).toBe(1);
  });

  it("distinguishes cancellation before emission from an in-flight mutation", async () => {
    const postCases = operationCorpus.operations.find(
      ({ operation }) => operation === "postMessage",
    )?.cases;
    const inFlightCase = postCases?.find(
      ({ stimulus }) => stimulus === "cancel_in_flight",
    );
    const beforeEmitCase = postCases?.find(
      ({ stimulus }) => stimulus === "cancel_before_emit",
    );
    expect(inFlightCase?.events.map(({ type }) => type)).toEqual([
      "emit",
      "cancel",
    ]);
    let mutationCalls = 0;
    const inFlight = new AbortController();
    const baseFetch = fixtureFetch([]);
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && init?.method === "POST") {
        mutationCalls += 1;
        expect(init.signal).toBe(inFlight.signal);
        inFlight.abort();
        throw new DOMException("cancelled after upload", "AbortError");
      }
      return baseFetch(input, init);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();
    await account.listWorkspaces();
    const workspace = await account.openWorkspace(workspaceId);

    await expect(
      workspace.postMessage({
        conversationId,
        content: "cancel after emit",
        signal: inFlight.signal,
      }),
    ).rejects.toMatchObject({ kind: inFlightCase?.expect.failureKind });
    expect(mutationCalls).toBe(1);

    const beforeEmit = new AbortController();
    beforeEmit.abort();
    await expect(
      workspace.postMessage({
        conversationId,
        content: "cancel before emit",
        signal: beforeEmit.signal,
      }),
    ).rejects.toMatchObject({ kind: beforeEmitCase?.expect.failureKind });
    expect(mutationCalls).toBe(1);
  });

  it("fails closed instead of following a repeated directory cursor", async () => {
    let directoryCalls = 0;
    const baseFetch = fixtureFetch([]);
    const fetchStub: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/workspaces") {
        directoryCalls += 1;
        if (directoryCalls > 2) {
          throw new TypeError("repeated cursor loop");
        }
        return Response.json({ ...workspaces, nextCursor: "repeat" });
      }
      return baseFetch(input, init);
    };
    const account = createHttpPunksAccountClient({
      baseUrl: origin,
      fetch: fetchStub,
      clientVersion: "0.6.0",
      distribution: "development",
      platform: "macos-arm64",
    });
    await account.checkCompatibility();
    await account.getSession();

    await expect(account.listWorkspaces()).rejects.toMatchObject({
      kind: "contract_violation",
    });
    expect(directoryCalls).toBe(2);
  });
});
