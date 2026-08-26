import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
// @ts-expect-error JavaScript fixture intentionally executes as a Node service.
import attestationWorker from "./test/attestation-fixture.mjs";

const authFixture = new URL("./test/auth-fixture.mjs", import.meta.url)
  .pathname;
const erasureFixture = new URL("./test/erasure-fixture.mjs", import.meta.url)
  .pathname;
const searchFixture = new URL("./test/search-fixture.mjs", import.meta.url)
  .pathname;
const directoryFixture = new URL(
  "./test/directory-fixture.mjs",
  import.meta.url,
).pathname;
const runtimeIdentityFixture = new URL(
  "./test/runtime-identity-fixture.mjs",
  import.meta.url,
).pathname;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          OPERATOR_PROVISIONING_TOKEN:
            "operator-test-token-00000000000000000000000000000000000000000000",
          PROMOTION_FAULTS_ENABLED: "true",
          PROMOTION_SESSION_ISSUANCE_ENABLED: "true",
          MESSAGE_SEARCH_MASTER_KEY:
            "message-search-test-key-000000000000000000000000000000000000",
          MESSAGE_SEARCH_CURSOR_KEY:
            "message-search-cursor-test-key-000000000000000000000000000000",
          MESSAGE_HISTORY_CURSOR_KEY:
            "message-history-cursor-test-key-000000000000000000000000000000",
          DIRECTORY_CURSOR_KEY:
            "directory-cursor-test-key-000000000000000000000000000000000",
          MEDIA_UPLOAD_GRANT_KEY:
            "media-upload-grant-test-key-00000000000000000000000000000000",
          JOURNAL_HOT_EVENTS: "1",
          JOURNAL_SEGMENT_EVENTS: "1",
          ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
            local: {
              "test-v1":
                "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
            },
          }),
        },
        serviceBindings: {
          ATTESTATION: (request: Request) => attestationWorker.fetch(request),
          TEST_RUNTIME_IDENTITY_FAILURE: {
            name: "punks-auth",
            entrypoint: "RuntimeIdentityFailureService",
          },
          TEST_RUNTIME_IDENTITY_INVALID: {
            name: "punks-auth",
            entrypoint: "RuntimeIdentityInvalidService",
          },
          BOT_ACTION_SERVICE: {
            name: "punks-api",
            entrypoint: "BotActionService",
            props: { role: "punks-bot-runtime", environment: "local" },
          },
          BOT_ACTION_WRONG_ENV: {
            name: "punks-api",
            entrypoint: "BotActionService",
            props: { role: "punks-bot-runtime", environment: "staging" },
          },
          BOT_ACTION_NO_PROPS: {
            name: "punks-api",
            entrypoint: "BotActionService",
          },
          BOT_HARNESS_SERVICE: {
            name: "punks-api",
            entrypoint: "BotHarnessService",
            props: { role: "punks-bot-runtime", environment: "local" },
          },
          BOT_HARNESS_WRONG_ENV: {
            name: "punks-api",
            entrypoint: "BotHarnessService",
            props: { role: "punks-bot-runtime", environment: "staging" },
          },
          BOT_HARNESS_NO_PROPS: {
            name: "punks-api",
            entrypoint: "BotHarnessService",
          },
          BOT_HARNESS_EXTRA_PROPS: {
            name: "punks-api",
            entrypoint: "BotHarnessService",
            props: {
              role: "punks-bot-runtime",
              environment: "local",
              capability: "messages.read-context",
            },
          },
          ACCOUNT_MERGE_RIGHTS_INDEX: {
            name: "punks-auth",
            entrypoint: "AccountMergeRightsIndexService",
            props: {
              role: "punks-account-merge-rights-index-writer",
              environment: "local",
            },
          },
          WORKSPACE_OWNERSHIP_AUTHORITY: {
            name: "punks-auth",
            entrypoint: "WorkspaceOwnershipAuthorizationService",
            props: {
              role: "punks-workspace-ownership-authorizer",
              environment: "local",
            },
          },
          BOT_WAKE_TRIGGER_SERVICE: {
            name: "punks-api",
            entrypoint: "BotWakeTriggerService",
            props: { role: "punks-bot-wake-trigger", environment: "local" },
          },
          BOT_WAKE_TRIGGER_WRONG_ENV: {
            name: "punks-api",
            entrypoint: "BotWakeTriggerService",
            props: { role: "punks-bot-wake-trigger", environment: "staging" },
          },
          BOT_WAKE_TRIGGER_NO_PROPS: {
            name: "punks-api",
            entrypoint: "BotWakeTriggerService",
          },
          BOT_WAKE_TRIGGER_EXTRA_PROPS: {
            name: "punks-api",
            entrypoint: "BotWakeTriggerService",
            props: {
              role: "punks-bot-wake-trigger",
              environment: "local",
              discover: true,
            },
          },
        },
        workers: [
          {
            name: "punks-attestation",
            modules: true,
            scriptPath: runtimeIdentityFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-auth",
            modules: true,
            scriptPath: authFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-erasure",
            modules: true,
            scriptPath: erasureFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-search",
            modules: true,
            scriptPath: searchFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-projector",
            modules: true,
            scriptPath: directoryFixture,
            compatibilityDate: "2026-08-20",
          },
          {
            name: "punks-bot-runtime",
            modules: true,
            scriptPath: runtimeIdentityFixture,
            compatibilityDate: "2026-08-20",
          },
        ],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
