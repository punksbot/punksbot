import { expect, test, type Page } from "@playwright/test";
import { DESKTOP_SOCIAL_LOOP_CAPABILITIES } from "@punks/contracts/desktop-profile";
import type { Punk, PunkPublicSummary } from "@punks/contracts";

const ORIGIN = "http://127.0.0.1:4174";
const PUNK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PUNK_ID = "55555555-5555-4555-8555-555555555555";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_WORKSPACE_ID = "66666666-6666-4666-8666-666666666666";

async function installIdentityBoundary(page: Page) {
  await page.addInitScript(
    ({
      capabilitySeed,
      origin,
      punkId,
      workspaceId,
      secondWorkspaceId,
      otherPunkId,
    }) => {
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      let generation = 0;
      let profile: Punk = {
        id: punkId,
        status: "active",
        displayName: "Marta",
        avatarUrl: null,
        identities: [
          {
            provider: "github",
            subjectHash: "a".repeat(64),
            emailHash: "b".repeat(64),
            verifiedEmail: null,
            username: "marta",
            credentialId: null,
            linkedAt: "2026-08-25T12:00:00.000Z",
          },
        ],
        mergedInto: null,
        revision: 1,
        createdAt: "2026-08-25T12:00:00.000Z",
        updatedAt: "2026-08-25T12:00:00.000Z",
      };
      const summaries: PunkPublicSummary[] = [
        { punkId, displayName: "Marta", avatarUrl: null },
        { punkId: otherPunkId, displayName: "Marie", avatarUrl: null },
      ];
      Object.assign(window, { __PUNKS_IDENTITY_CALLS__: calls });

      const invoke = async (
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        calls.push({ command, args: structuredClone(args) });
        switch (command) {
          case "punks_check_compatibility":
            return {
              contract: "desktop.compatibility-response@1",
              compatible: true,
              profile: "desktop-social-loop@1",
              registryVersion: 1,
              minimumClientVersion: "0.6.0",
              environment: "staging",
              origin,
              capabilities: [...capabilitySeed],
            };
          case "punks_get_account_session_state":
            return {
              state: "authenticated",
              authentication: { phase: "idle" },
              resumeAvailable: false,
              session: {
                sessionId: "33333333-3333-4333-8333-333333333333",
                punkId,
                authenticatedAt: "2026-08-25T12:00:00.000Z",
                expiresAt: "2026-09-25T12:00:00.000Z",
                recentReauthUntil: null,
                punk: {
                  id: punkId,
                  displayName: profile.displayName,
                  avatarUrl: profile.avatarUrl,
                },
              },
            };
          case "punks_list_workspaces":
            return [
              {
                id: workspaceId,
                slug: "identity-test",
                name: "Identity Test",
                visibility: "private",
                role: "owner",
                revision: 1,
              },
              {
                id: secondWorkspaceId,
                slug: "second",
                name: "Second Workspace",
                visibility: "private",
                role: "member",
                revision: 1,
              },
            ];
          case "punks_validate_navigation":
            return {
              kind: "workspace",
              path: new URL(String(args.url)).pathname,
            };
          case "punks_open_workspace":
            generation += 1;
            return {
              origin,
              punkId,
              workspaceId: String(args.workspaceId),
              generation,
            };
          case "punks_close_workspace":
            return null;
          case "punks_list_streams":
            return [];
          case "punks_get_punk_profile":
            return structuredClone(profile);
          case "punks_update_punk_profile": {
            const input = args.input as {
              expectedRevision: number;
              displayName: string;
              avatarUrl: string | null;
            };
            profile = {
              ...profile,
              displayName: input.displayName,
              avatarUrl: input.avatarUrl,
              revision: profile.revision + 1,
              updatedAt: "2026-08-25T12:01:00.000Z",
            };
            return structuredClone(profile);
          }
          case "punks_search_punks": {
            const input = args.input as {
              query:
                | { kind: "prefix"; value: string }
                | { kind: "punk_id"; punkId: string };
              limit: number;
            };
            const items =
              input.query.kind === "punk_id"
                ? summaries.filter(
                    (summary) => summary.punkId === input.query.punkId,
                  )
                : summaries.filter((summary) =>
                    summary.displayName
                      .toLocaleLowerCase("en-US")
                      .startsWith(input.query.value),
                  );
            return {
              items: structuredClone(items.slice(0, input.limit)),
              nextCursor: null,
            };
          }
          case "punks_get_punk_summaries":
            return structuredClone(summaries);
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
    },
    {
      capabilitySeed: DESKTOP_SOCIAL_LOOP_CAPABILITIES,
      origin: ORIGIN,
      punkId: PUNK_ID,
      workspaceId: WORKSPACE_ID,
      secondWorkspaceId: SECOND_WORKSPACE_ID,
      otherPunkId: OTHER_PUNK_ID,
    },
  );
}

async function identityCalls(
  page: Page,
): Promise<{ command: string; args: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __PUNKS_IDENTITY_CALLS__?: {
            command: string;
            args: Record<string, unknown>;
          }[];
        }
      ).__PUNKS_IDENTITY_CALLS__ ?? [],
  );
}

test("un Punk lit et modifie uniquement son nom et son avatar à la révision courante", async ({
  page,
}) => {
  await installIdentityBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByTestId("punks-open-profile").click();
  const dialog = page.getByRole("dialog", { name: "Punk profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Marta");
  await dialog.getByLabel("Display name").fill("Mélanie");
  await dialog
    .getByLabel("Avatar URL")
    .fill("https://images.example/melanie.png");
  await dialog.getByRole("button", { name: "Save profile" }).click();

  await expect(dialog.getByRole("status")).toHaveText("Profile saved.");
  await expect(page.getByTestId("punks-current-punk-name")).toHaveText(
    "Mélanie",
  );
  const update = (await identityCalls(page)).find(
    ({ command }) => command === "punks_update_punk_profile",
  );
  expect(update?.args.input).toEqual({
    expectedRevision: 1,
    displayName: "Mélanie",
    avatarUrl: "https://images.example/melanie.png",
  });
  expect(JSON.stringify(update)).not.toMatch(
    /subjectHash|emailHash|credentialId/u,
  );
});

test("la recherche privée attend un préfixe contraint et purge au changement de génération", async ({
  page,
}) => {
  await installIdentityBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByTestId("punks-open-punk-search").click();
  const dialog = page.getByRole("dialog", { name: "Find a Punk" });
  const input = dialog.getByLabel("Name prefix or Punk ID");
  await input.fill("ma");
  await page.waitForTimeout(100);
  expect(
    (await identityCalls(page)).filter(
      ({ command }) => command === "punks_search_punks",
    ),
  ).toHaveLength(0);

  await input.fill("mar");
  await expect(dialog.getByText("Marta", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Marie", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/total|members? found|roster/i);
  const search = (await identityCalls(page)).find(
    ({ command }) => command === "punks_search_punks",
  );
  expect(search?.args.input).toEqual({
    query: { kind: "prefix", value: "mar" },
    limit: 10,
    cursor: null,
  });

  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("punks-workspace-second").click();
  await expect(
    page.getByRole("heading", { name: "Second Workspace" }).first(),
  ).toBeVisible();
  await page.getByTestId("punks-open-punk-search").click();
  const freshDialog = page.getByRole("dialog", { name: "Find a Punk" });
  await expect(freshDialog.getByLabel("Name prefix or Punk ID")).toHaveValue(
    "",
  );
  await expect(freshDialog.getByText("Marie", { exact: true })).toHaveCount(0);
});
