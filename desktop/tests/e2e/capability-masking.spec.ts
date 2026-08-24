import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Garde de Disponibilité de capacité (issue #53) : sous une distribution
 * Punks dont aucune surface n'est montée, la découverte, la navigation
 * directe, le clavier et les deeplinks ne divulgent rien et ne chargent
 * aucun code des surfaces masquées.
 */

const PUNKS_ENV_SEED = {
  distribution: "punks",
  mounted: [],
  compatibility: { compatible: true, capabilities: [] },
};

const PUNKS_ENV_BLOCKED_SEED = {
  distribution: "punks",
  mounted: [],
  compatibility: { compatible: false, capabilities: [] },
};

async function installPunksDistribution(
  page: import("@playwright/test").Page,
  seed: unknown = PUNKS_ENV_SEED,
) {
  // Le seed doit être posé AVANT le pont : la disponibilité est lue avant le
  // premier rendu React.
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "buzz-e2e-punks-environment",
      JSON.stringify(value),
    );
  }, seed);
  await installMockBridge(page);
}

test("la découverte ne montre aucune surface non migrée", async ({ page }) => {
  await installPunksDistribution(page);
  await page.goto("/");

  await expect(page.getByTestId("unavailable-terminal")).toBeVisible();

  for (const testId of [
    "open-pulse-view",
    "open-projects-view",
    "open-workflows-view",
    "open-agents-view",
    "sidebar-home-count",
  ]) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
  await expect(page.getByTestId("open-search")).toHaveCount(0);
});

test("une route directe indisponible reste neutre et non divulguante", async ({
  page,
}) => {
  await installPunksDistribution(page);

  const responses = new Map<string, string>();
  page.on("response", (response) => {
    responses.set(response.url(), response.url());
  });

  await page.goto("/#/pulse");
  const terminalPulse = page.getByTestId("unavailable-terminal");
  await expect(terminalPulse).toBeVisible();
  const pulseText = await terminalPulse.textContent();

  await page.goto("/#/workflows");
  await expect(terminalPulse).toBeVisible();
  const workflowsText = await terminalPulse.textContent();

  // Terminal strictement identique : aucun identifiant de surface divulgué.
  expect(pulseText).toBe(workflowsText);
  await expect(terminalPulse).not.toContainText(
    /pulse|workflow|preview|enable|settings/i,
  );

  // Aucun chunk des surfaces masquées n'est chargé (scan du bundle effectif).
  const loadedScripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .join("\\n"),
  );
  expect(loadedScripts).not.toMatch(
    /PulseScreen|WorkflowsRouteScreen|HomeScreen/,
  );

  // Aucun trafic vers l'API Buzz n'est émis depuis les surfaces masquées.
  for (const url of responses.keys()) {
    expect(url).not.toMatch(/ws:\/\/|\/api\/|localhost:3000/);
  }
});

test("Cmd+K et les raccourcis de surfaces masquées ne font rien", async ({
  page,
}) => {
  await installPunksDistribution(page);
  await page.goto("/#/agents");

  await expect(page.getByTestId("unavailable-terminal")).toBeVisible();

  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.press(`${mod}+Shift+k`);
  await page.keyboard.press(`${mod}+Shift+a`);
  await page.waitForTimeout(250);

  // Rien ne s'ouvre, rien ne change, aucune divulgation.
  await expect(page.getByTestId("unavailable-terminal")).toBeVisible();
  await expect(page.getByTestId("unavailable-terminal")).not.toContainText(
    /search|message|home|enable|preview/i,
  );
  await expect(page).toHaveURL(/#\/agents$/);
});

test("une incompatibilité de client bloque avant tout montage de Workspace", async ({
  page,
}) => {
  await installPunksDistribution(page, PUNKS_ENV_BLOCKED_SEED);
  await page.goto("/");

  await expect(page.getByTestId("client-incompatible-gate")).toBeVisible();
  await expect(page.getByTestId("client-incompatible-gate")).not.toContainText(
    /workspace|community|update|upgrade|compatib/i,
  );
});
