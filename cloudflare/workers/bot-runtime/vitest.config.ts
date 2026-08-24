import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const testWranglerConfig = readFileSync(
  new URL("./wrangler.test.jsonc", import.meta.url),
  "utf8",
);
if (/"ai"\s*:/.test(testWranglerConfig)) {
  throw new Error(
    "wrangler.test.jsonc must not declare a remote Workers AI binding",
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        workers: [
          {
            name: "fake-bot-invocation-issuer",
            modules: true,
            scriptPath: "./test/fixtures/bot-invocation-issuer.mjs",
          },
          {
            name: "fake-bot-action-service",
            modules: true,
            scriptPath: "./test/fixtures/bot-action-service.mjs",
          },
          {
            name: "fake-bot-harness-service",
            modules: true,
            scriptPath: "./test/fixtures/bot-harness-service.mjs",
          },
        ],
        serviceBindings: {
          BOT_INVOCATION_ISSUER: {
            name: "fake-bot-invocation-issuer",
            entrypoint: "BotInvocationIssuer",
            props: {
              role: "punks-bot-runtime",
              environment: "local",
            },
          },
          BOT_ACTION_SERVICE: {
            name: "fake-bot-action-service",
            entrypoint: "BotActionService",
            props: {
              role: "punks-bot-runtime",
              environment: "local",
            },
          },
          BOT_HARNESS_SERVICE: {
            name: "fake-bot-harness-service",
            entrypoint: "BotHarnessService",
            props: {
              role: "punks-bot-runtime",
              environment: "local",
            },
          },
          BOT_HARNESS_TEST_AUDIT: {
            name: "fake-bot-harness-service",
            entrypoint: "BotHarnessAudit",
          },
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
