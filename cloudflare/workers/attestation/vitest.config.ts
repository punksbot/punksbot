import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ATTESTATION_PRIVATE_KEY:
            "0000000000000000000000000000000000000000000000000000000000000001",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
