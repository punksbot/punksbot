import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureLocalEnvironment } from "./local-environment.mjs";

export const LOCAL_D1_DATABASES = Object.freeze([
  "punks-projection-local",
  "punks-projection-local-1",
  "punks-projection-local-2",
  "punks-projection-local-3",
]);

const LOCAL_WORKERS = Object.freeze([
  "dev-gateway",
  "api",
  "auth",
  "attestation",
  "erasure",
  "search",
  "projector",
  "bot-runtime",
]);

export function localRuntimeEnvironment(environment = process.env) {
  return {
    ...environment,
    DO_NOT_TRACK: "1",
    WRANGLER_HIDE_BANNER: "true",
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_SEND_METRICS: "false",
  };
}

function localStateDirectory(repoRoot) {
  return join(repoRoot, "cloudflare/.wrangler/local");
}

function workerConfig(repoRoot, worker) {
  return join(repoRoot, `cloudflare/workers/${worker}/wrangler.jsonc`);
}

export function localD1MigrationArguments(repoRoot, database) {
  return [
    "--filter",
    "@punks/projector-worker",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    database,
    "--local",
    "--config",
    workerConfig(repoRoot, "projector"),
    "--persist-to",
    localStateDirectory(repoRoot),
  ];
}

export function localWranglerArguments(repoRoot, port = 8787) {
  const configs = LOCAL_WORKERS.flatMap((worker) => [
    "--config",
    workerConfig(repoRoot, worker),
  ]);
  return [
    "--filter",
    "@punks/dev-gateway-worker",
    "exec",
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    ...configs,
    "--persist-to",
    localStateDirectory(repoRoot),
  ];
}

function runPnpm(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || (signal !== null && options.expectedSignal?.())) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `pnpm exited with code ${String(code)}`
            : `pnpm exited after signal ${signal}`,
        ),
      );
    });
    options.onChild?.(child);
  });
}

export async function prepareLocalEnvironment(repoRoot) {
  const bindings = await ensureLocalEnvironment(repoRoot);
  await mkdir(localStateDirectory(repoRoot), { recursive: true });
  for (const database of LOCAL_D1_DATABASES) {
    await runPnpm(localD1MigrationArguments(repoRoot, database), {
      cwd: repoRoot,
      env: { ...localRuntimeEnvironment(), CI: "1" },
    });
  }
  return bindings;
}

export async function startLocalEnvironment(repoRoot, port = 8787) {
  await prepareLocalEnvironment(repoRoot);
  let child;
  let stopping = false;
  const forward = (signal) => {
    stopping = true;
    child?.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    await runPnpm(localWranglerArguments(repoRoot, port), {
      cwd: repoRoot,
      env: localRuntimeEnvironment(),
      expectedSignal: () => stopping,
      onChild(value) {
        child = value;
      },
    });
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
  }
}

function requestedPort(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return 8787;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return port;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const repoRoot = resolve(dirname(modulePath), "../..");
  if (process.argv.includes("--prepare-only")) {
    await prepareLocalEnvironment(repoRoot);
    process.stdout.write("local environment ready\n");
  } else {
    await startLocalEnvironment(repoRoot, requestedPort(process.argv.slice(2)));
  }
}
