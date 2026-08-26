import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:4174";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const rootId = "44444444-4444-4444-8444-444444444444";
const replyId = "66666666-6666-4666-8666-666666666666";
const punkId = "11111111-1111-4111-8111-111111111111";
const capabilities = [
  "compatibility",
  "account-session",
  "authentication",
  "workspace-selection",
  "stream-list",
  "message-history",
  "threads",
  "bounded-authors",
  "conversation-follow",
  "message-post",
  "unicode-reactions",
  "search",
];

function message(
  id: string,
  content: string,
  createdCursor: number,
  threadRootMessageId = id,
  parentMessageId: string | null = null,
) {
  return {
    id,
    workspaceId,
    conversationId,
    author: { kind: "punk" as const, punkId },
    messageType: "stream-message" as const,
    status: "active" as const,
    content,
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId,
    threadRootMessageId,
    threadDepth: parentMessageId === null ? 0 : 1,
    broadcast: false,
    replyCount: parentMessageId === null ? 1 : 0,
    descendantCount: parentMessageId === null ? 1 : 0,
    lastReplyAt: parentMessageId === null ? "2026-08-26T10:01:00.000Z" : null,
    currentVersion: 1,
    retractionKind: null,
    retractedAt: null,
    eraseAfter: null,
    publicReason: null,
    erasedAt: null,
    revision: 1,
    createdCursor,
    cursor: createdCursor,
    createdAt: `2026-08-26T10:0${createdCursor}:00.000Z`,
    updatedAt: `2026-08-26T10:0${createdCursor}:00.000Z`,
    editedAt: null,
  };
}

async function installSearchBoundary(
  page: Page,
  completeness: "complete" | "partial" = "complete",
  searchEnabled = true,
) {
  const timeline = [
    message(rootId, "Incident root", 1),
    message(replyId, "Incident response handbook", 2, rootId, rootId),
  ];
  await page.addInitScript(
    ({
      capabilitySeed,
      completenessSeed,
      conversation,
      messages,
      originSeed,
      punk,
      root,
      workspace,
    }) => {
      const searchCalls: unknown[] = [];
      let followDelivered = false;
      Object.assign(window, {
        __PUNKS_E2E_ENVIRONMENT__: {
          distribution: "punks",
          mounted: [...capabilitySeed],
          compatibility: {
            compatible: true,
            capabilities: [...capabilitySeed],
          },
        },
        __PUNKS_SEARCH_CALLS__: searchCalls,
      });
      const invoke = async (
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        switch (command) {
          case "punks_check_compatibility":
            return {
              contract: "desktop.compatibility-response@1",
              compatible: true,
              profile: "desktop-social-loop@1",
              registryVersion: 1,
              minimumClientVersion: "0.6.0",
              environment: "staging",
              origin: originSeed,
              capabilities: [...capabilitySeed],
            };
          case "punks_get_account_session_state":
            return {
              state: "authenticated",
              authentication: { phase: "idle" },
              resumeAvailable: false,
              session: {
                sessionId: "99999999-9999-4999-8999-999999999999",
                punkId: punk,
                authenticatedAt: "2026-08-26T10:00:00.000Z",
                expiresAt: "2026-09-26T10:00:00.000Z",
                recentReauthUntil: null,
                punk: { id: punk, displayName: "Search Punk", avatarUrl: null },
              },
            };
          case "punks_list_workspaces":
            return [
              {
                id: workspace,
                slug: "search-test",
                name: "Search Test",
                visibility: "private",
                role: "owner",
                revision: 1,
              },
            ];
          case "punks_open_workspace":
            return {
              origin: originSeed,
              punkId: punk,
              workspaceId: workspace,
              generation: 1,
            };
          case "punks_list_streams":
            return [
              {
                id: conversation,
                workspaceId: workspace,
                name: "incidents",
                type: "stream",
                visibility: "open",
                description: null,
                topic: "Incident response",
                purpose: "Keep the response handbook current",
                topicRequired: false,
                ttlSeconds: null,
                ttlDeadline: null,
                revision: 1,
                cursor: 2,
                updatedAt: "2026-08-26T10:02:00.000Z",
              },
            ];
          case "punks_get_stream":
            return {
              id: conversation,
              workspaceId: workspace,
              name: "incidents",
              type: "stream",
              visibility: "open",
              description: null,
              topic: "Incident response",
              purpose: "Keep the response handbook current",
              topicRequired: false,
              maxMembers: null,
              ttlSeconds: null,
              ttlDeadline: null,
              status: "active",
              revision: 1,
              cursor: 2,
              createdAt: "2026-08-26T10:00:00.000Z",
              updatedAt: "2026-08-26T10:02:00.000Z",
              archivedAt: null,
            };
          case "punks_get_timeline":
            return {
              workspaceId: workspace,
              conversationId: conversation,
              highWaterCursor: 2,
              order: "createdCursor-ascending",
              items: structuredClone(messages),
              nextCursor: null,
            };
          case "punks_get_thread":
            return {
              workspaceId: workspace,
              conversationId: conversation,
              highWaterCursor: 2,
              order: "createdCursor-ascending",
              items: structuredClone(messages),
              nextCursor: null,
            };
          case "punks_resolve_authors":
            return [
              {
                kind: "punk",
                punkId: punk,
                displayName: "Search Punk",
                avatarUrl: null,
              },
            ];
          case "punks_follow_conversation":
            return "search-follow";
          case "punks_follow_next":
            if (!followDelivered) {
              followDelivered = true;
              return { kind: "became_live" };
            }
            return new Promise(() => undefined);
          case "punks_search_messages": {
            const input = structuredClone(
              (args as { input: Record<string, unknown> }).input,
            );
            searchCalls.push(input);
            return {
              workspaceId: workspace,
              conversationId: conversation,
              threadRootMessageId: input.threadRootMessageId,
              order: "createdCursor-descending",
              completeness: completenessSeed,
              partialReason:
                completenessSeed === "partial" ? "index_lagging" : null,
              items: [structuredClone(messages[1])],
              nextCursor: null,
            };
          }
          case "punks_validate_navigation": {
            const path = new URL(String(args.url)).pathname;
            return {
              kind: path.includes("/messages/") ? "message" : "conversation",
              path,
            };
          }
          case "punks_close_follow":
          case "punks_close_workspace":
            return null;
          default:
            throw new Error(`Unexpected Punks command: ${command}`);
        }
      };
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          ...(
            window as typeof window & {
              __TAURI_INTERNALS__?: Record<string, unknown>;
            }
          ).__TAURI_INTERNALS__,
          invoke,
        },
      });
      void root;
    },
    {
      capabilitySeed: searchEnabled
        ? capabilities
        : capabilities.filter((capability) => capability !== "search"),
      completenessSeed: completeness,
      conversation: conversationId,
      messages: timeline,
      originSeed: origin,
      punk: punkId,
      root: rootId,
      workspace: workspaceId,
    },
  );
}

test("an unavailable search capability loads no search chunk or command", async ({
  page,
}) => {
  await installSearchBoundary(page, "complete", false);
  await page.goto(`/w/search-test/conversations/${conversationId}`);
  await expect(page.getByTestId("punks-conversation")).toBeVisible();

  await expect(page.getByTestId("punks-open-message-search")).toHaveCount(0);
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .join("\n"),
  );
  expect(resources).not.toMatch(
    /ConversationSearchControls|punksConversationSearchTauri/u,
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __PUNKS_SEARCH_CALLS__?: unknown[] })
          .__PUNKS_SEARCH_CALLS__,
    ),
  ).toEqual([]);
});

test("Conversation search opens an authorized result at its canonical HTTPS route", async ({
  page,
}) => {
  await installSearchBoundary(page);
  await page.goto(`/w/search-test/conversations/${conversationId}`);
  await expect(page.getByTestId("punks-conversation")).toBeVisible();

  await page.getByTestId("punks-open-message-search").click();
  const search = page.getByRole("search", { name: "Search Messages" });
  const input = search.getByLabel("Search terms");
  await expect(input).toBeFocused();
  await input.fill("incident response");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(search.getByText("Incident response handbook")).toBeVisible();
  await search.getByText("Incident response handbook").click();

  await expect(page).toHaveURL(
    `${origin}/w/search-test/conversations/${conversationId}/messages/${replyId}`,
  );
  const calls = await page.evaluate(
    () =>
      (window as typeof window & { __PUNKS_SEARCH_CALLS__?: unknown[] })
        .__PUNKS_SEARCH_CALLS__,
  );
  expect(calls).toEqual([
    {
      conversationId,
      threadRootMessageId: null,
      query: "incident response",
      cursor: null,
      limit: 25,
    },
  ]);
});

test("Fil search carries its root and renders an honest partial state", async ({
  page,
}) => {
  await installSearchBoundary(page, "partial");
  await page.goto(
    `/w/search-test/conversations/${conversationId}/messages/${replyId}`,
  );
  await expect(page.getByTestId("punks-thread")).toBeVisible();

  await page.getByTestId("punks-open-message-search").click();
  const search = page.getByRole("search", { name: "Search Messages" });
  await search.getByLabel("Search terms").fill("incident response");
  await search.getByRole("button", { name: "Search" }).click();

  await expect(search.getByRole("status")).toContainText(
    "index is still catching up",
  );
  const calls = await page.evaluate(
    () =>
      (window as typeof window & { __PUNKS_SEARCH_CALLS__?: unknown[] })
        .__PUNKS_SEARCH_CALLS__,
  );
  expect(calls).toEqual([
    expect.objectContaining({ threadRootMessageId: rootId }),
  ]);
});
