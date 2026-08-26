import type {
  CreateWorkspaceCommand,
  Punk,
  SetWorkspaceMemberRoleCommand,
  RemoveWorkspaceMemberCommand,
  UpdatePunkProfileCommand,
} from "@punks/contracts";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ApiEnv } from "../src/env";
import { route } from "../src/router";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const mergedAliasPunkId = "00000000-0000-8000-8000-000000000003";
const hiddenPunkId = "f0000000-0000-8000-8000-000000000099";
const operatorAuthorization =
  "Bearer operator-test-token-00000000000000000000000000000000000000000000";

function punk(id: string, displayName: string): Punk {
  return {
    id,
    status: "active",
    displayName,
    avatarUrl: null,
    identities: [
      {
        provider: "github",
        subjectHash: "a".repeat(64),
        emailHash: "b".repeat(64),
        verifiedEmail: null,
        username: displayName.toLowerCase(),
        credentialId: null,
        linkedAt: "2026-08-25T12:00:00.000Z",
      },
    ],
    mergedInto: null,
    revision: 1,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
  };
}

async function createWorkspace(
  slug: string,
  commandId: string,
): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { slug, name: "Private Search", visibility: "private" },
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
  expect(response.status).toBe(201);
  const body = (await response.json()) as { workspace: { id: string } };
  return body.workspace.id;
}

async function setMember(
  workspaceId: string,
  commandId: string,
  present: boolean,
  expectedRevision: number,
): Promise<void> {
  const command: SetWorkspaceMemberRoleCommand | RemoveWorkspaceMemberCommand =
    present
      ? {
          contract: "workspace.member-set-role@1",
          commandId,
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: otherPunkId,
            role: "member",
            expectedRevision,
          },
        }
      : {
          contract: "workspace.member-remove@1",
          commandId,
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { targetPunkId: otherPunkId, expectedRevision },
        };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: present ? "PUT" : "DELETE",
      headers: {
        cookie: "__Host-punks_session=session-owner",
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect([200, 201]).toContain(response.status);
}

function profileEnvironment() {
  const profiles = new Map<string, Punk>([
    [ownerPunkId, punk(ownerPunkId, "Marta")],
    [otherPunkId, punk(otherPunkId, "Marie")],
    [hiddenPunkId, punk(hiddenPunkId, "Marina")],
  ]);
  const projected: unknown[] = [];
  const workspaceAuthorizationCalls = { count: 0 };
  let projectionHook:
    | ((input: { punkId?: string }) => Promise<void> | void)
    | null = null;
  const auth = {
    resolveSessionCookie(cookie: string) {
      const punkId = cookie.includes("session-owner")
        ? ownerPunkId
        : cookie.includes("session-other")
          ? otherPunkId
          : null;
      if (punkId === null) return null;
      const profile = profiles.get(punkId);
      return profile === undefined
        ? null
        : {
            sessionId: `${punkId.slice(0, 8)}-0000-8000-8000-000000000001`,
            punkId,
            authenticatedAt: "2026-08-25T12:00:00.000Z",
            expiresAt: "2099-08-25T12:00:00.000Z",
            recentReauthUntil: null,
            punk: {
              id: punkId,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            },
          };
    },
    getPunkProfile(punkId: string) {
      return structuredClone(profiles.get(punkId) ?? null);
    },
    updatePunkProfile(punkId: string, command: UpdatePunkProfileCommand) {
      const current = profiles.get(punkId);
      if (current === undefined) return { ok: false, code: "not_found" };
      if (command.expectedRevision !== current.revision) {
        return {
          ok: false,
          code: "revision_conflict",
          currentRevision: current.revision,
        };
      }
      const next: Punk = {
        ...current,
        displayName: command.displayName.trim().normalize("NFC"),
        avatarUrl: command.avatarUrl,
        revision: current.revision + 1,
        updatedAt: "2026-08-25T12:01:00.000Z",
      };
      profiles.set(punkId, next);
      return { ok: true, state: structuredClone(next), replayed: false };
    },
    resolvePunkSummary(punkId: string) {
      const profile = profiles.get(
        punkId === mergedAliasPunkId ? otherPunkId : punkId,
      );
      return profile === undefined
        ? null
        : {
            id: profile.id,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            revision: profile.revision,
            updatedAt: profile.updatedAt,
          };
    },
    punkExists(punkId: string) {
      return profiles.has(punkId);
    },
    resolveSessionId() {
      return null;
    },
  };
  const directory = {
    listWorkspaceCandidates() {
      return [];
    },
    listConversationCandidates() {
      return [];
    },
    async upsertPunkProfile(input: unknown) {
      projected.push(structuredClone(input));
      await projectionHook?.(input as { punkId?: string });
      return true;
    },
    searchPunkCandidates(input: { prefix: string; afterPunkId?: string }) {
      return [...profiles.values()]
        .filter((profile) =>
          profile.displayName
            .toLocaleLowerCase("en-US")
            .startsWith(input.prefix),
        )
        .filter(
          (profile) =>
            input.afterPunkId === undefined || profile.id > input.afterPunkId,
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((profile) => ({
          punkId: profile.id,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          revision: profile.revision,
        }));
    },
  };
  return {
    env: {
      ...(env as ApiEnv),
      AUTH_SERVICE: auth,
      PROJECTION_DIRECTORY: directory,
      WORKSPACES: {
        getByName(name: string) {
          const workspace = env.WORKSPACES.getByName(name);
          return {
            authorize(input: unknown) {
              workspaceAuthorizationCalls.count += 1;
              return workspace.authorize(input);
            },
          };
        },
      },
    } as unknown as ApiEnv,
    profiles,
    projected,
    workspaceAuthorizationCalls,
    setProjectionHook(
      hook: ((input: { punkId?: string }) => Promise<void> | void) | null,
    ) {
      projectionHook = hook;
    },
  };
}

describe("Punk profile and private search API", () => {
  it("reads and updates only the authenticated profile with explicit conflicts", async () => {
    const runtime = profileEnvironment();
    const read = await route(
      new Request("https://punks.bot/api/v1/punk", {
        headers: { cookie: "__Host-punks_session=session-owner" },
      }),
      runtime.env,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      id: ownerPunkId,
      displayName: "Marta",
      revision: 1,
    });

    const command: UpdatePunkProfileCommand = {
      contract: "punk.update@1",
      commandId: "d1000000-0000-4000-8000-000000000001",
      expectedRevision: 1,
      displayName: "Mélanie",
      avatarUrl: "https://images.example/avatar.png",
    };
    const updated = await route(
      new Request("https://punks.bot/api/v1/punk", {
        method: "PATCH",
        headers: {
          cookie: "__Host-punks_session=session-owner",
          "content-type": "application/json",
          "idempotency-key": command.commandId,
        },
        body: JSON.stringify(command),
      }),
      runtime.env,
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      id: ownerPunkId,
      displayName: "Mélanie",
      revision: 2,
    });
    expect(runtime.projected).toEqual([
      expect.objectContaining({
        punkId: ownerPunkId,
        displayName: "Marta",
        revision: 1,
      }),
      expect.objectContaining({
        punkId: ownerPunkId,
        displayName: "Mélanie",
        revision: 2,
      }),
    ]);

    const stale = await route(
      new Request("https://punks.bot/api/v1/punk", {
        method: "PATCH",
        headers: {
          cookie: "__Host-punks_session=session-owner",
          "content-type": "application/json",
          "idempotency-key": "d2000000-0000-4000-8000-000000000002",
        },
        body: JSON.stringify({
          ...command,
          commandId: "d2000000-0000-4000-8000-000000000002",
        }),
      }),
      runtime.env,
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "revision_conflict",
      retry: "never",
    });
  });

  it("reauthorizes summaries and binds bounded prefix pagination to its scope", async () => {
    const workspaceId = await createWorkspace(
      "punk-private-search",
      "e1000000-0000-4000-8000-000000000001",
    );
    await setMember(
      workspaceId,
      "e2000000-0000-4000-8000-000000000002",
      true,
      1,
    );
    const runtime = profileEnvironment();

    const summaries = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/summaries`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.summary-batch@1",
            workspaceId,
            punkIds: [ownerPunkId, otherPunkId, hiddenPunkId],
          }),
        },
      ),
      runtime.env,
    );
    expect(summaries.status).toBe(200);
    await expect(summaries.json()).resolves.toEqual({
      contract: "punk.summary-batch-response@1",
      workspaceId,
      items: [
        { punkId: ownerPunkId, displayName: "Marta", avatarUrl: null },
        { punkId: otherPunkId, displayName: "Marie", avatarUrl: null },
      ],
    });

    const search = (cookie: string, cursor: string | null) =>
      route(
        new Request(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
          {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              contract: "punk.search@1",
              workspaceId,
              query: { kind: "prefix", value: "mar" },
              limit: 1,
              cursor,
            }),
          },
        ),
        runtime.env,
      );
    const first = await search("__Host-punks_session=session-owner", null);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: unknown[];
      nextCursor: string | null;
      total?: number;
    };
    expect(firstBody.items).toEqual([
      { punkId: ownerPunkId, displayName: "Marta", avatarUrl: null },
    ]);
    expect(firstBody.nextCursor).toMatch(/^psc1\./u);
    expect(firstBody.total).toBeUndefined();

    const transplanted = await search(
      "__Host-punks_session=session-other",
      firstBody.nextCursor,
    );
    expect(transplanted.status).toBe(400);

    const second = await search(
      "__Host-punks_session=session-owner",
      firstBody.nextCursor,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      contract: "punk.search-response@1",
      workspaceId,
      items: [{ punkId: otherPunkId, displayName: "Marie", avatarUrl: null }],
      nextCursor: null,
    });

    const aliasLookup = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.search@1",
            workspaceId,
            query: { kind: "punk_id", punkId: mergedAliasPunkId },
            limit: 1,
            cursor: null,
          }),
        },
      ),
      runtime.env,
    );
    expect(aliasLookup.status).toBe(200);
    await expect(aliasLookup.json()).resolves.toMatchObject({
      items: [{ punkId: otherPunkId, displayName: "Marie" }],
    });

    const aliasAuthor = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/authors/resolve`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "author.resolve@1",
            workspaceId,
            authors: [{ kind: "punk", punkId: mergedAliasPunkId }],
          }),
        },
      ),
      runtime.env,
    );
    expect(aliasAuthor.status).toBe(200);
    await expect(aliasAuthor.json()).resolves.toMatchObject({
      authors: [{ kind: "punk", punkId: otherPunkId, displayName: "Marie" }],
    });

    await setMember(
      workspaceId,
      "e3000000-0000-4000-8000-000000000003",
      false,
      2,
    );
    const exactAfterRevocation = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.search@1",
            workspaceId,
            query: { kind: "punk_id", punkId: otherPunkId },
            limit: 1,
            cursor: null,
          }),
        },
      ),
      runtime.env,
    );
    expect(exactAfterRevocation.status).toBe(200);
    await expect(exactAfterRevocation.json()).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects a punctuation-only scan with a typed non-enumeration problem", async () => {
    const workspaceId = await createWorkspace(
      "punk-short-search",
      "f1000000-0000-4000-8000-000000000001",
    );
    const runtime = profileEnvironment();
    const response = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.search@1",
            workspaceId,
            query: { kind: "prefix", value: "---" },
            limit: 10,
            cursor: null,
          }),
        },
      ),
      runtime.env,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "query_too_short",
      retry: "never",
    });
  });

  it("drops summaries and exact results revoked during projection delivery", async () => {
    const workspaceId = await createWorkspace(
      "punk-delivery-fence",
      "f2000000-0000-4000-8000-000000000001",
    );
    await setMember(
      workspaceId,
      "f2000000-0000-4000-8000-000000000002",
      true,
      1,
    );
    const runtime = profileEnvironment();
    let removed = false;
    runtime.setProjectionHook(async ({ punkId }) => {
      if (punkId !== otherPunkId || removed) return;
      removed = true;
      await setMember(
        workspaceId,
        "f2000000-0000-4000-8000-000000000003",
        false,
        2,
      );
    });
    const summaries = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/summaries`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.summary-batch@1",
            workspaceId,
            punkIds: [otherPunkId],
          }),
        },
      ),
      runtime.env,
    );
    expect(summaries.status).toBe(200);
    await expect(summaries.json()).resolves.toMatchObject({ items: [] });

    await setMember(
      workspaceId,
      "f2000000-0000-4000-8000-000000000004",
      true,
      3,
    );
    removed = false;
    runtime.setProjectionHook(async ({ punkId }) => {
      if (punkId !== otherPunkId || removed) return;
      removed = true;
      await setMember(
        workspaceId,
        "f2000000-0000-4000-8000-000000000005",
        false,
        4,
      );
    });
    const exact = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
        {
          method: "POST",
          headers: {
            cookie: "__Host-punks_session=session-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contract: "punk.search@1",
            workspaceId,
            query: { kind: "punk_id", punkId: otherPunkId },
            limit: 1,
            cursor: null,
          }),
        },
      ),
      runtime.env,
    );
    expect(exact.status).toBe(200);
    await expect(exact.json()).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
  });

  it("uses the same Workspace authorization shape for missing and inaccessible exact IDs", async () => {
    const workspaceId = await createWorkspace(
      "punk-exact-oracle",
      "f3000000-0000-4000-8000-000000000001",
    );
    const runtime = profileEnvironment();
    const exact = (punkId: string) =>
      route(
        new Request(
          `https://punks.bot/api/v1/workspaces/${workspaceId}/punks/search`,
          {
            method: "POST",
            headers: {
              cookie: "__Host-punks_session=session-owner",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              contract: "punk.search@1",
              workspaceId,
              query: { kind: "punk_id", punkId },
              limit: 1,
              cursor: null,
            }),
          },
        ),
        runtime.env,
      );

    runtime.workspaceAuthorizationCalls.count = 0;
    const inaccessible = await exact(hiddenPunkId);
    const inaccessibleCalls = runtime.workspaceAuthorizationCalls.count;
    runtime.workspaceAuthorizationCalls.count = 0;
    const missing = await exact("f0000000-0000-8000-8000-000000000098");
    const missingCalls = runtime.workspaceAuthorizationCalls.count;

    expect(inaccessible.status).toBe(200);
    expect(missing.status).toBe(200);
    await expect(inaccessible.json()).resolves.toMatchObject({ items: [] });
    await expect(missing.json()).resolves.toMatchObject({ items: [] });
    expect(inaccessibleCalls).toBe(missingCalls);
    expect(inaccessibleCalls).toBeGreaterThan(0);
  });
});
