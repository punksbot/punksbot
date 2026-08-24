import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
} from "@punks/contracts";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ApiEnv } from "../src/env";
import { route } from "../src/router";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const operatorAuthorization =
  "Bearer operator-test-token-00000000000000000000000000000000000000000000";

async function createWorkspace(): Promise<{
  id: string;
  slug: string;
  name: string;
  visibility: "private";
  revision: number;
}> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: "a1000000-0000-8000-8000-000000000001",
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: "desktop-directory",
      name: "Desktop Directory",
      visibility: "private",
    },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        authorization: operatorAuthorization,
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect([200, 201]).toContain(response.status);
  const body = (await response.json()) as {
    workspace: {
      id: string;
      slug: string;
      name: string;
      visibility: "private";
      revision: number;
    };
  };
  return body.workspace;
}

async function createStream(workspaceId: string): Promise<{
  id: string;
  workspaceId: string;
  name: string;
  visibility: "open";
  revision: number;
  cursor: number;
  updatedAt: string;
}> {
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: "a2000000-0000-8000-8000-000000000001",
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { name: "general", type: "stream", visibility: "open" },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        cookie: "__Host-punks_session=session-owner",
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect([200, 201]).toContain(response.status);
  const body = (await response.json()) as {
    conversation: {
      id: string;
      workspaceId: string;
      name: string;
      visibility: "open";
      revision: number;
      cursor: number;
      updatedAt: string;
    };
  };
  return body.conversation;
}

function withDirectory(directory: {
  listWorkspaceCandidates(input: unknown): Promise<unknown>;
  listConversationCandidates(input: unknown): Promise<unknown>;
}): ApiEnv {
  return {
    ...(env as ApiEnv),
    PROJECTION_DIRECTORY: directory,
  } as ApiEnv;
}

describe("desktop-social-loop@1 discovery API", () => {
  it("fails closed on compatibility before any Workspace mount", async () => {
    const unavailable = await SELF.fetch(
      "https://punks.bot/api/v1/desktop/compatibility",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: "desktop.compatibility@1",
          profile: "desktop-social-loop@1",
          clientVersion: "0.6.0",
          distribution: "development",
          platform: "macos-arm64",
        }),
      },
    );
    expect(unavailable.status).toBe(200);
    await expect(unavailable.json()).resolves.toMatchObject({
      contract: "desktop.compatibility-response@1",
      compatible: false,
      profile: "desktop-social-loop@1",
      registryVersion: 1,
      environment: "local",
      origin: "https://punks.bot",
      capabilities: [],
    });

    const compatible = await route(
      new Request("https://punks.bot/api/v1/desktop/compatibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: "desktop.compatibility@1",
          profile: "desktop-social-loop@1",
          clientVersion: "0.6.0",
          distribution: "development",
          platform: "macos-arm64",
        }),
      }),
      {
        ...(env as ApiEnv),
        DESKTOP_SOCIAL_LOOP_ENABLED: "true",
      } as unknown as ApiEnv,
    );
    expect(compatible.status).toBe(200);
    await expect(compatible.json()).resolves.toMatchObject({
      compatible: true,
      capabilities: expect.arrayContaining([
        "workspace-selection",
        "conversation-follow",
      ]),
    });

    const incompatible = await route(
      new Request("https://punks.bot/api/v1/desktop/compatibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract: "desktop.compatibility@1",
          profile: "desktop-social-loop@1",
          clientVersion: "0.5.17",
          distribution: "development",
          platform: "macos-arm64",
        }),
      }),
      {
        ...(env as ApiEnv),
        DESKTOP_SOCIAL_LOOP_ENABLED: "true",
      } as unknown as ApiEnv,
    );
    expect(incompatible.status).toBe(200);
    await expect(incompatible.json()).resolves.toMatchObject({
      compatible: false,
      minimumClientVersion: "0.6.0",
      capabilities: [],
    });
  });

  it("reauthorizes every Workspace candidate and drops stale projections", async () => {
    const workspace = await createWorkspace();
    const runtimeEnv = withDirectory({
      async listWorkspaceCandidates() {
        return [
          {
            workspaceId: workspace.id,
            slug: "forged-slug",
            name: "Forged name",
            visibility: "public",
            role: "guest",
            revision: 999,
          },
          {
            workspaceId: "f0000000-0000-8000-8000-000000000099",
            slug: "stale",
            name: "Stale",
            visibility: "private",
            role: "owner",
            revision: 1,
          },
        ];
      },
      async listConversationCandidates() {
        return [];
      },
    });
    const response = await route(
      new Request("https://punks.bot/api/v1/workspaces?limit=50", {
        headers: { cookie: "__Host-punks_session=session-owner" },
      }),
      runtimeEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contract: "workspace.list-response@1",
      items: [
        {
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          visibility: workspace.visibility,
          role: "owner",
          revision: workspace.revision,
        },
      ],
      nextCursor: null,
    });
  });

  it("does not turn an authority outage into an empty Workspace list", async () => {
    const runtimeEnv = {
      ...withDirectory({
        async listWorkspaceCandidates() {
          return [
            {
              workspaceId: "f0000000-0000-8000-8000-000000000099",
              slug: "candidate",
              name: "Candidate",
              visibility: "private",
              role: "member",
              revision: 1,
            },
          ];
        },
        async listConversationCandidates() {
          return [];
        },
      }),
      WORKSPACES: {
        getByName() {
          return {
            async query() {
              throw new Error("Workspace authority unavailable");
            },
          };
        },
      },
    } as unknown as ApiEnv;
    const response = await route(
      new Request("https://punks.bot/api/v1/workspaces?limit=50", {
        headers: { cookie: "__Host-punks_session=session-owner" },
      }),
      runtimeEnv,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "temporarily_unavailable",
      retry: "later",
    });
  });

  it("binds opaque Workspace continuations to the authenticated Punk", async () => {
    const workspace = await createWorkspace();
    const scannedAfter: unknown[] = [];
    const staleId = "f0000000-0000-8000-8000-000000000099";
    const runtimeEnv = withDirectory({
      async listWorkspaceCandidates(input: unknown) {
        const afterId =
          input !== null && typeof input === "object" && "afterId" in input
            ? (input as { afterId?: unknown }).afterId
            : undefined;
        scannedAfter.push(afterId);
        return afterId === undefined
          ? [
              {
                workspaceId: workspace.id,
                slug: workspace.slug,
                name: workspace.name,
                visibility: workspace.visibility,
                role: "owner",
                revision: workspace.revision,
              },
              {
                workspaceId: staleId,
                slug: "stale",
                name: "Stale",
                visibility: "private",
                role: "owner",
                revision: 1,
              },
            ]
          : [];
      },
      async listConversationCandidates() {
        return [];
      },
    });
    const first = await route(
      new Request("https://punks.bot/api/v1/workspaces?limit=1", {
        headers: { cookie: "__Host-punks_session=session-owner" },
      }),
      runtimeEnv,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toMatch(/^pdc1\./u);

    const second = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
        { headers: { cookie: "__Host-punks_session=session-owner" } },
      ),
      runtimeEnv,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
    expect(scannedAfter).toEqual([undefined, staleId]);

    const tampered = `${firstBody.nextCursor?.slice(0, -1)}${firstBody.nextCursor?.endsWith("A") ? "B" : "A"}`;
    const rejected = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces?limit=1&cursor=${encodeURIComponent(tampered)}`,
        { headers: { cookie: "__Host-punks_session=session-owner" } },
      ),
      runtimeEnv,
    );
    expect(rejected.status).toBe(400);
  });

  it("reauthorizes Stream candidates and never reveals an unknown Conversation", async () => {
    const workspace = await createWorkspace();
    const stream = await createStream(workspace.id);
    const runtimeEnv = withDirectory({
      async listWorkspaceCandidates() {
        return [];
      },
      async listConversationCandidates() {
        return [
          {
            id: stream.id,
            workspaceId: workspace.id,
            name: "forged-name",
            type: "stream",
            visibility: "private",
            description: null,
            topic: null,
            purpose: null,
            topicRequired: false,
            ttlSeconds: null,
            ttlDeadline: null,
            revision: 999,
            cursor: 999,
            updatedAt: stream.updatedAt,
          },
          {
            id: "f0000000-0000-8000-8000-000000000098",
            workspaceId: workspace.id,
            name: "hidden",
            type: "stream",
            visibility: "open",
            description: null,
            topic: null,
            purpose: null,
            topicRequired: false,
            ttlSeconds: null,
            ttlDeadline: null,
            revision: 1,
            cursor: 1,
            updatedAt: stream.updatedAt,
          },
        ];
      },
    });
    const response = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspace.id}/conversations?limit=50`,
        { headers: { cookie: "__Host-punks_session=session-owner" } },
      ),
      runtimeEnv,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toEqual([
      expect.objectContaining({
        id: stream.id,
        workspaceId: workspace.id,
        name: stream.name,
        type: "stream",
        visibility: "open",
        revision: stream.revision,
        cursor: stream.cursor,
      }),
    ]);
  });

  it("requires a Session and rejects unknown pagination input", async () => {
    const unauthenticated = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces?limit=50",
    );
    expect(unauthenticated.status).toBe(401);

    const unsupportedCursor = await SELF.fetch(
      "https://punks.bot/api/v1/workspaces?limit=50&cursor=forged",
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(unsupportedCursor.status).toBe(400);
  });

  it("resolves bounded Punk authors only after Workspace authorization", async () => {
    const workspace = await createWorkspace();
    const response = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspace.id}/authors/resolve`,
      {
        method: "POST",
        headers: {
          cookie: "__Host-punks_session=session-owner",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contract: "author.resolve@1",
          workspaceId: workspace.id,
          authors: [
            { kind: "punk", punkId: ownerPunkId },
            {
              kind: "punk",
              punkId: "f0000000-0000-8000-8000-000000000099",
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contract: "author.resolve-response@1",
      workspaceId: workspace.id,
      authors: [
        {
          kind: "punk",
          punkId: ownerPunkId,
          displayName: "Fixture Punk",
          avatarUrl: null,
        },
      ],
    });
  });
});
