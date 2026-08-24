import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: { PUNKS_UI_ORIGIN: "http://localhost:1420" },
        workers: [
          {
            name: "fake-api",
            modules: true,
            scriptPath: "./test/fixtures/api.mjs",
          },
          {
            name: "fake-auth",
            modules: true,
            scriptPath: "./test/fixtures/auth.mjs",
          },
          {
            name: "fake-wake-trigger",
            modules: true,
            scriptPath: "./test/fixtures/wake-trigger.mjs",
          },
          {
            name: "fake-auth-bootstrap",
            modules: true,
            scriptPath: "./test/fixtures/auth-bootstrap.mjs",
          },
          {
            name: "fake-api-bootstrap",
            modules: true,
            scriptPath: "./test/fixtures/api-bootstrap.mjs",
          },
        ],
        serviceBindings: {
          API: { name: "fake-api" },
          AUTH: { name: "fake-auth" },
          AUTH_DEV_BOOTSTRAP: {
            name: "fake-auth-bootstrap",
            entrypoint: "LocalDevAuthBootstrapService",
          },
          API_DEV_BOOTSTRAP: {
            name: "fake-api-bootstrap",
            entrypoint: "LocalDevApiBootstrapService",
          },
          BOT_WAKE_TRIGGER: {
            name: "fake-wake-trigger",
            entrypoint: "BotWakeTriggerService",
            props: {
              role: "punks-bot-wake-trigger",
              environment: "local",
            },
          },
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
