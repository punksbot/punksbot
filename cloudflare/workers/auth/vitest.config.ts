import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const receiptFixture = new URL(
  "./test/account-merge-receipt-fixture.mjs",
  import.meta.url,
).pathname;
const workspaceFixture = new URL(
  "./test/account-merge-workspace-fixture.mjs",
  import.meta.url,
).pathname;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AUTH_BASE_URL: "https://auth.punks.test",
          BOT_INVOCATION_CURRENT_SECRET:
            "local-test-bot-invocation-secret-at-least-32-bytes",
          GOOGLE_OAUTH_CLIENT_ID: "google-client-test",
          GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-test",
          GITHUB_OAUTH_CLIENT_ID: "github-client-test",
          GITHUB_OAUTH_CLIENT_SECRET: "github-secret-test",
          PROMOTION_SESSION_ISSUANCE_ENABLED: "true",
          SESSION_TTL_SECONDS: "3600",
        },
        serviceBindings: {
          ACCOUNT_MERGE_RECEIPTS: {
            name: "punks-erasure",
            entrypoint: "AccountMergeReceiptRegistryService",
            props: {
              role: "punks-account-merge-receipt-writer",
              environment: "local",
            },
          },
          ACCOUNT_MERGE_WORKSPACES: {
            name: "punks-api",
            entrypoint: "AccountMergeWorkspaceService",
            props: {
              role: "punks-account-merge-workspace-applicator",
              environment: "local",
            },
          },
        },
        workers: [
          {
            name: "punks-erasure",
            modules: true,
            scriptPath: receiptFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-api",
            modules: true,
            scriptPath: workspaceFixture,
            compatibilityDate: "2026-08-20",
          },
        ],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // This serial pool boots Auth plus two named service fixtures. Allow cold
    // workerd startup without weakening assertions or accepting a flaky run.
    testTimeout: 15_000,
  },
});
