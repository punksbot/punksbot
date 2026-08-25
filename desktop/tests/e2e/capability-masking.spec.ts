import { expect, test, type Page } from "@playwright/test";
import { DESKTOP_SOCIAL_LOOP_CAPABILITIES } from "@punks/contracts/desktop-profile";

const ORIGIN = "http://127.0.0.1:4174";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PUNK_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const ALL_CAPABILITY_CHUNKS =
  /PunksRuntime|punksTauriTransport|MessageLifecycleControls|punksMessageLifecycleTauri/u;
const LIFECYCLE_CHUNKS = /MessageLifecycleControls|punksMessageLifecycleTauri/u;

const T1_CAPABILITIES = DESKTOP_SOCIAL_LOOP_CAPABILITIES;

type PunksSeed = {
  compatible: boolean;
  capabilities: readonly string[];
  compatibilityFailures?: number;
  workspaces?: readonly {
    id: string;
    slug: string;
    name: string;
    visibility: "open" | "private" | "hidden";
    role: "owner" | "moderator" | "member";
    revision: number;
  }[];
};

async function installPunksTauriBoundary(
  page: Page,
  seed: PunksSeed = {
    compatible: true,
    capabilities: T1_CAPABILITIES,
  },
) {
  const workspaces = seed.workspaces ?? [
    {
      id: WORKSPACE_ID,
      slug: "capability-test",
      name: "Capability Test",
      visibility: "private" as const,
      role: "owner" as const,
      revision: 1,
    },
  ];
  await page.addInitScript(
    ({ compatibilitySeed, origin, punkId, sessionId, workspaceSeed }) => {
      const commands: string[] = [];
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      let compatibilityFailures = compatibilitySeed.compatibilityFailures ?? 0;
      let generation = 0;
      let switchStarted = false;
      Object.assign(window, {
        __PUNKS_CAPABILITY_COMMANDS__: commands,
        __PUNKS_CAPABILITY_CALLS__: calls,
      });

      const invoke = async (
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        commands.push(command);
        calls.push({ command, args: structuredClone(args) });
        switch (command) {
          case "punks_check_compatibility":
            if (compatibilityFailures > 0) {
              compatibilityFailures -= 1;
              throw {
                kind: "transport",
                message: "temporary compatibility transport failure",
              };
            }
            return {
              contract: "desktop.compatibility-response@1",
              compatible: compatibilitySeed.compatible,
              profile: "desktop-social-loop@1",
              registryVersion: 1,
              minimumClientVersion: "0.6.0",
              environment: "staging",
              origin,
              capabilities: [...compatibilitySeed.capabilities],
            };
          case "punks_get_account_session_state":
            if (switchStarted) {
              return {
                state: "signed_out",
                authentication: {
                  phase: "started",
                  intent: "switch_account",
                  method: "github",
                },
                resumeAvailable: false,
              };
            }
            return {
              state: "authenticated",
              authentication: { phase: "idle" },
              resumeAvailable: false,
              session: {
                sessionId,
                punkId,
                authenticatedAt: "2026-08-25T10:00:00.000Z",
                expiresAt: "2026-08-26T10:00:00.000Z",
                recentReauthUntil: null,
                punk: {
                  id: punkId,
                  displayName: "Capability Test Punk",
                  avatarUrl: null,
                },
              },
            };
          case "punks_list_workspaces":
            return structuredClone(workspaceSeed);
          case "punks_validate_navigation":
            return {
              kind: "workspace",
              path: new URL(String(args.url)).pathname,
            };
          case "punks_open_workspace": {
            generation += 1;
            return {
              origin,
              punkId,
              workspaceId: String(args.workspaceId),
              generation,
            };
          }
          case "punks_list_streams":
            return [];
          case "punks_close_workspace":
            return null;
          case "punks_start_account_switch":
            switchStarted = true;
            return {
              phase: "started",
              intent: "switch_account",
              method: String(args.provider),
            };
          case "punks_cancel_authentication":
            switchStarted = false;
            return { phase: "cancelled" };
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
      compatibilitySeed: seed,
      origin: ORIGIN,
      punkId: PUNK_ID,
      sessionId: SESSION_ID,
      workspaceSeed: workspaces,
    },
  );
}

async function invokedCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __PUNKS_CAPABILITY_COMMANDS__?: string[];
        }
      ).__PUNKS_CAPABILITY_COMMANDS__ ?? [],
  );
}

async function invokedCalls(
  page: Page,
): Promise<{ command: string; args: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __PUNKS_CAPABILITY_CALLS__?: {
            command: string;
            args: Record<string, unknown>;
          }[];
        }
      ).__PUNKS_CAPABILITY_CALLS__ ?? [],
  );
}

async function loadedResources(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
}

test("une route directe indisponible s'arrête avant toute commande", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/pulse");

  const terminal = page.getByTestId("unavailable-terminal");
  await expect(terminal).toBeVisible();
  await expect(terminal).not.toContainText(
    /pulse|workspace|community|preview|enable|settings/i,
  );
  expect(await invokedCommands(page)).toEqual([]);
  expect(
    requests.filter(
      (url) => new URL(url).pathname.startsWith("/api/") || /^wss?:/u.test(url),
    ),
  ).toEqual([]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("la découverte et le clavier n'exposent aucune capacité ultérieure", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  for (const testId of [
    "open-pulse-view",
    "open-projects-view",
    "open-workflows-view",
    "open-agents-view",
    "open-search",
    "sidebar-home-count",
  ]) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }

  const before = await invokedCommands(page);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  for (const shortcut of [
    `${modifier}+k`,
    `${modifier}+f`,
    `${modifier}+Shift+k`,
    `${modifier}+Shift+n`,
    `${modifier}+Shift+o`,
    `${modifier}+Shift+a`,
    "Control+Shift+Space",
  ]) {
    await page.keyboard.press(shortcut);
  }
  await page.waitForTimeout(100);

  await expect(page).toHaveURL(`${ORIGIN}/`);
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();
  expect(await invokedCommands(page)).toEqual(before);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    LIFECYCLE_CHUNKS,
  );
});

test("deux routes indisponibles rendent le même terminal non divulguant", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);

  await page.goto("/pulse");
  const terminal = page.getByTestId("unavailable-terminal");
  await expect(terminal).toBeVisible();
  const pulseText = await terminal.textContent();

  await page.goto("/workflows");
  await expect(terminal).toBeVisible();
  expect(await terminal.textContent()).toBe(pulseText);
  await expect(terminal).not.toContainText(
    /pulse|workflow|workspace|community|preview|enable|settings/i,
  );
  expect(await invokedCommands(page)).toEqual([]);
});

test("une réponse compatible mais incomplète échoue fermée", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES.filter(
      (capability) => capability !== "unicode-reactions",
    ),
  });
  await page.goto("/");

  await expect(page.getByTestId("unavailable-terminal")).toBeVisible();
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("une incompatibilité bloque avant tout montage de Workspace", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: false,
    capabilities: [],
  });
  await page.goto("/");

  const gate = page.getByTestId("client-incompatible-gate");
  await expect(gate).toBeVisible();
  await expect(gate).not.toContainText(
    /workspace|community|update|upgrade|compatib/i,
  );
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("une panne de compatibilité reste un état runtime récupérable", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    compatibilityFailures: 1,
  });
  await page.goto("/");

  const error = page.getByTestId("punks-capability-error");
  await expect(error).toBeVisible();
  await expect(page.getByTestId("client-incompatible-gate")).toHaveCount(0);
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );

  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();
  expect(await invokedCommands(page)).toEqual([
    "punks_check_compatibility",
    "punks_check_compatibility",
    "punks_get_account_session_state",
    "punks_list_workspaces",
    "punks_open_workspace",
    "punks_list_streams",
  ]);
});

test("changer de Workspace ferme l'ancienne génération avant la nouvelle I/O", async ({
  page,
}) => {
  const secondWorkspaceId = "44444444-4444-4444-8444-444444444444";
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    workspaces: [
      {
        id: WORKSPACE_ID,
        slug: "capability-test",
        name: "Capability Test",
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
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByTestId("punks-workspace-second").click();
  await expect(
    page.getByRole("heading", { name: "Second Workspace" }).first(),
  ).toBeVisible();

  const calls = await invokedCalls(page);
  const closeIndex = calls.findIndex(
    ({ command }) => command === "punks_close_workspace",
  );
  const secondOpenIndex = calls.findIndex(
    ({ command, args }) =>
      command === "punks_open_workspace" &&
      args.workspaceId === secondWorkspaceId,
  );
  expect(closeIndex).toBeGreaterThan(-1);
  expect(secondOpenIndex).toBeGreaterThan(closeIndex);
  expect(
    calls.filter(({ command }) => command === "punks_open_workspace"),
  ).toHaveLength(2);
});

test("changer de Compte ferme le Workspace avant la cérémonie", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByRole("button", { name: "Switch Account" }).click();
  await page.getByRole("button", { name: "GitHub" }).click();
  await expect(page.getByTestId("punks-account-switching")).toBeVisible();
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);

  const commands = await invokedCommands(page);
  const closeIndex = commands.indexOf("punks_close_workspace");
  const switchIndex = commands.indexOf("punks_start_account_switch");
  expect(closeIndex).toBeGreaterThan(-1);
  expect(switchIndex).toBeGreaterThan(closeIndex);
});
