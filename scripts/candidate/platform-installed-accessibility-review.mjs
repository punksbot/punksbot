import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { withNativeScreenReader } from "./native-screen-reader.mjs";
import { createSeleniumBrowser } from "./platform-installed-automation.mjs";

function fail(message) {
  throw new Error(
    `independent installed accessibility review rejected: ${message}`,
  );
}

function records(accessibility, technology) {
  return Object.fromEntries(
    MATRICE_ACCESSIBILITE.map((criterion) => {
      const observations = accessibility?.[criterion]?.automated;
      if (
        !Array.isArray(observations) ||
        observations.length === 0 ||
        observations.some(
          (entry) =>
            entry === null ||
            typeof entry !== "object" ||
            typeof entry.observation !== "string" ||
            entry.observation.trim() === "",
        )
      ) {
        fail(`second-pass ${criterion} observation is missing`);
      }
      return [
        criterion,
        {
          tool: "independent-tauri-driver",
          reviewer: "independent-platform-review-process",
          observation:
            `${criterion}: ${observations.map(({ observation }) => observation).join(" | ")}; ` +
            `native-screen-reader=${technology}`,
        },
      ];
    }),
  );
}

async function reviewWithTauriDriver(
  input,
  {
    withScreenReader = withNativeScreenReader,
    browserFactory = createSeleniumBrowser,
  } = {},
) {
  const session = await withScreenReader(
    {
      platform: input.platform,
      binary: input.screenReaderBinary,
      log: input.outputs.screenReaderLog,
      applicationTokens: [
        "Punks Bot Staging",
        "punks-bot-staging",
        "bot.punks.desktop.staging",
      ],
    },
    async () => {
      const browser = await browserFactory(input);
      try {
        await browser.waitVisible("[data-testid='punks-workspace-shell']");
        return await browser.auditAccessibility();
      } finally {
        await browser.close();
      }
    },
  );
  return records(session.value, session.technology);
}

/**
 * Runs a second installed application and native screen-reader process over
 * the already-installed bytes. This process never reuses the first driver.
 */
export async function reviewInstalledAccessibility(input, dependencies = {}) {
  if (input.platform.startsWith("macos-")) {
    const { reviewMacosInstalledAccessibility } = await import(
      "./platform-macos-xctest.mjs"
    );
    return reviewMacosInstalledAccessibility(input, dependencies);
  }
  if (!["linux-x64", "windows-x64"].includes(input.platform)) {
    fail("unsupported platform");
  }
  return reviewWithTauriDriver(input, dependencies);
}
