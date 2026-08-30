import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const environment = {
  ...process.env,
  VITE_PUNKS_DISTRIBUTION: "punks",
};

export function runPnpm(args) {
  const result = spawnSync(pnpm, args, {
    cwd: desktopRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function checkPunksCapabilities() {
  runPnpm([
    "exec",
    "node",
    "--import",
    "./test-loader.mjs",
    "--experimental-strip-types",
    "--test",
    "src/shared/capabilities/availability.test.mjs",
    "src/shared/capabilities/punksNativeCommandBoundary.test.mjs",
  ]);
  runPnpm(["exec", "tsc", "--project", "tsconfig.punks.json"]);
  runPnpm(["exec", "vite", "build"]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkPunksCapabilities();
}
