import {
  checkPunksCapabilities,
  runPnpm,
} from "./check-punks-capabilities.mjs";

checkPunksCapabilities();
runPnpm([
  "exec",
  "playwright",
  "test",
  "--config=playwright.punks-capabilities.config.ts",
]);
