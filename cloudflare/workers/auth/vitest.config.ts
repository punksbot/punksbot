import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
          SESSION_TTL_SECONDS: "3600",
          WEBAUTHN_RP_ID: "auth.punks.test",
          WEBAUTHN_RP_NAME: "Punks Bot",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
