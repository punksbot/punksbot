import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
              local: {
                "local-v1":
                  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
              },
            }),
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
    },
  };
});
