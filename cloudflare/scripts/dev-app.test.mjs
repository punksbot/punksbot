import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { localDevelopmentCommands, runLocalApplication } from "./dev-app.mjs";

function childProcessDouble() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killedWith = [];
  child.once("exit", (code, signal) => {
    child.exitCode = code;
    child.signalCode = signal;
  });
  child.kill = (signal) => {
    child.killedWith.push(signal);
    return true;
  };
  return child;
}

test("describes the managed Punks backend and Tauri commands", () => {
  assert.deepEqual(localDevelopmentCommands(), {
    backend: ["cloudflare:dev"],
    desktop: ["punks:dev"],
  });
});

test("the desktop command resolves to a checked-in package script", () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../package.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "punksbot-workspace");
  assert.equal(typeof manifest.scripts?.["punks:dev"], "string");
});

test("starts Tauri only after the local Punks API is healthy", async () => {
  const backend = childProcessDouble();
  const desktop = childProcessDouble();
  const events = [];
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  const running = runLocalApplication({
    backendIsReady: async () => false,
    startProcess(args) {
      events.push(`start:${args.join(" ")}`);
      return args[0] === "cloudflare:dev" ? backend : desktop;
    },
    async waitForBackend() {
      events.push("wait:backend");
      await ready;
      events.push("ready:backend");
    },
    registerSignalHandlers() {
      return () => {};
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["start:cloudflare:dev", "wait:backend"]);

  markReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    "start:cloudflare:dev",
    "wait:backend",
    "ready:backend",
    "start:punks:dev",
  ]);

  desktop.emit("exit", 0, null);
  await running;
  assert.deepEqual(backend.killedWith, ["SIGTERM"]);
});

test("does not start Tauri when the backend exits before becoming ready", async () => {
  const backend = childProcessDouble();
  const starts = [];
  const running = runLocalApplication({
    backendIsReady: async () => false,
    startProcess(args) {
      starts.push(args);
      return backend;
    },
    waitForBackend: () => new Promise(() => {}),
    registerSignalHandlers() {
      return () => {};
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  backend.emit("exit", 1, null);

  await assert.rejects(running, /backend exited with code 1/);
  assert.deepEqual(starts, [["cloudflare:dev"]]);
});

test("reuses a healthy local backend without taking ownership of it", async () => {
  const desktop = childProcessDouble();
  const starts = [];
  const running = runLocalApplication({
    backendIsReady: async () => true,
    startProcess(args) {
      starts.push(args);
      return desktop;
    },
    registerSignalHandlers() {
      return () => {};
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, [["punks:dev"]]);

  desktop.emit("exit", 0, null);
  await running;
  assert.deepEqual(desktop.killedWith, []);
});
