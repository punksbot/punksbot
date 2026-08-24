import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { smokeLocal } from "./smoke-local.mjs";

const BACKEND_BASE_URL = "http://127.0.0.1:8787";
const BACKEND_READY_TIMEOUT_MS = 120_000;

export function localDevelopmentCommands() {
  return {
    backend: ["cloudflare:dev"],
    desktop: ["--filter", "@punks/desktop", "tauri:dev"],
  };
}

function startPnpm(args, repoRoot) {
  return spawn("pnpm", args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export async function waitForLocalBackend(
  baseUrl = BACKEND_BASE_URL,
  timeoutMilliseconds = BACKEND_READY_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await smokeLocal(baseUrl);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(
    `local Punks API did not become ready within ${String(timeoutMilliseconds)}ms`,
    { cause: lastError },
  );
}

export async function localBackendIsReady(baseUrl = BACKEND_BASE_URL) {
  try {
    await smokeLocal(baseUrl);
    return true;
  } catch {
    return false;
  }
}

function processExit(child, name) {
  return new Promise((resolvePromise, reject) => {
    const complete = (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `${name} exited with code ${String(code)}`
            : `${name} exited after signal ${signal}`,
        ),
      );
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      complete(child.exitCode, child.signalCode);
      return;
    }
    child.once("error", reject);
    child.once("exit", complete);
  });
}

function registerProcessSignalHandlers(stop) {
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return () => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  };
}

function terminate(child, signal = "SIGTERM") {
  if (
    child !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    child.kill(signal);
  }
}

export async function runLocalApplication(options = {}) {
  const commands = localDevelopmentCommands();
  const repoRoot =
    options.repoRoot ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const startProcess =
    options.startProcess ?? ((args) => startPnpm(args, repoRoot));
  const waitForBackend = options.waitForBackend ?? waitForLocalBackend;
  const backendIsReady = options.backendIsReady ?? localBackendIsReady;
  const registerSignalHandlers =
    options.registerSignalHandlers ?? registerProcessSignalHandlers;

  let backend;
  let desktop;
  let stopping = false;
  const stop = () => {
    stopping = true;
    terminate(desktop, "SIGINT");
    terminate(backend, "SIGINT");
  };
  const unregisterSignals = registerSignalHandlers(stop);

  try {
    if (!(await backendIsReady())) {
      backend = startProcess(commands.backend);
      await Promise.race([
        waitForBackend(),
        processExit(backend, "backend").then(() => {
          if (!stopping)
            throw new Error("backend exited before becoming ready");
        }),
      ]);
    }
    if (stopping) return;

    desktop = startProcess(commands.desktop);
    if (backend === undefined) {
      await processExit(desktop, "desktop");
    } else {
      await Promise.race([
        processExit(desktop, "desktop"),
        processExit(backend, "backend").then(() => {
          if (!stopping)
            throw new Error("backend exited while Tauri was running");
        }),
      ]);
    }
  } finally {
    unregisterSignals();
    terminate(desktop);
    terminate(backend);
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  await runLocalApplication();
}
