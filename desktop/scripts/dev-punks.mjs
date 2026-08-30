#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ORIGIN = "http://127.0.0.1:8787";

export function localDesktopEnvironment(environment = process.env) {
  return {
    ...environment,
    PUNKS_DISTRIBUTION: "development",
    PUNKS_LOCAL_KEYRING_SERVICE: "punks-bot-local-dev-v1",
    PUNKS_ORIGIN: BACKEND_ORIGIN,
    VITE_PUNKS_DISTRIBUTION: "punks",
  };
}

export function localTauriArguments() {
  return ["tauri", "dev", "--config", "src-tauri/tauri.punks.local.conf.json"];
}

function waitForExit(child) {
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolvePromise({ code: code ?? 1, signal });
    });
  });
}

export async function runLocalDesktop(options = {}) {
  const modulePath = options.modulePath ?? fileURLToPath(import.meta.url);
  const desktopRoot = options.desktopRoot ?? resolve(dirname(modulePath), "..");
  const child = (options.spawnProcess ?? spawn)("pnpm", localTauriArguments(), {
    cwd: desktopRoot,
    env: localDesktopEnvironment(options.environment),
    stdio: "inherit",
  });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    return await waitForExit(child);
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  if (process.argv.length !== 2) throw new Error("usage: dev-punks.mjs");
  const result = await runLocalDesktop({ modulePath });
  process.exit(result.signal === null ? result.code : 1);
}
