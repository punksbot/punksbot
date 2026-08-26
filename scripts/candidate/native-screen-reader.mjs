import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";

const SUPPORTED_PLATFORMS = new Set([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);

function fail(message) {
  throw new Error(`native screen reader rejected: ${message}`);
}

function wait(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function commandStatus(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status;
}

async function waitUntil(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(250);
  }
  fail(message);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    wait(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

function stableExecutable(path) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size < 1) {
    fail("screen reader binary must be one non-empty real regular file");
  }
  return realpathSync(absolute);
}

function readStableLog(path) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size < 1 ||
    status.size > 64 * 1024 * 1024
  ) {
    fail("screen reader log must be one bounded non-empty real regular file");
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail("screen reader log changed while it was read");
    }
    return content;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function nativeScreenReaderInvocation({ platform, binary, log }) {
  if (!SUPPORTED_PLATFORMS.has(platform)) fail("unsupported platform");
  if (typeof binary !== "string" || binary.length === 0) {
    fail("screen reader binary is required");
  }
  if (typeof log !== "string" || log.length === 0) {
    fail("screen reader log is required");
  }
  if (platform === "windows-x64") {
    return {
      technology: "NVDA",
      command: binary,
      args: [
        "--minimal",
        "--disable-addons",
        "--debug-logging",
        `--log-file=${log}`,
      ],
    };
  }
  if (platform === "linux-x64") {
    return {
      technology: "Orca",
      command: binary,
      args: ["--replace", "--enable=speech", "--debug", `--debug-file=${log}`],
    };
  }
  return { technology: "VoiceOver", command: binary, args: [] };
}

const defaultController = Object.freeze({
  async start({ platform, invocation, log }) {
    const command = stableExecutable(invocation.command);
    if (platform === "windows-x64") {
      if (commandStatus(command, ["--check-running"]) === 0) {
        fail("an unrelated NVDA session is already running");
      }
      const child = spawn(command, invocation.args, {
        stdio: "ignore",
        windowsHide: true,
      });
      await waitUntil(
        () => commandStatus(command, ["--check-running"]) === 0,
        "NVDA did not become ready",
      );
      await waitUntil(
        () => existsSync(log) && lstatSync(log).size > 0,
        "NVDA did not create its raw log",
      );
      return {
        async stop() {
          const quitStatus = commandStatus(command, ["--quit"]);
          if (quitStatus !== 0) fail("NVDA refused the reviewed quit command");
          await waitUntil(
            () => commandStatus(command, ["--check-running"]) !== 0,
            "NVDA did not stop",
          );
          await stopChild(child);
        },
      };
    }

    if (platform === "linux-x64") {
      const child = spawn(command, invocation.args, {
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => undefined);
      await waitUntil(() => {
        if (child.exitCode !== null) {
          fail(
            `Orca exited before observing the application (${child.exitCode})`,
          );
        }
        return existsSync(log) && lstatSync(log).size > 0;
      }, "Orca did not create its raw debug log");
      return {
        async stop() {
          await stopChild(child);
        },
      };
    }

    if (commandStatus("/usr/bin/pgrep", ["-x", "VoiceOver"]) === 0) {
      fail("an unrelated VoiceOver session is already running");
    }
    const logDescriptor = openSync(log, "wx", 0o600);
    const collector = spawn(
      "/usr/bin/log",
      [
        "stream",
        "--style",
        "ndjson",
        "--level",
        "debug",
        "--predicate",
        'process == "VoiceOver"',
      ],
      { stdio: ["ignore", logDescriptor, logDescriptor] },
    );
    const voiceOver = spawn(command, invocation.args, {
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
    await waitUntil(
      () => commandStatus("/usr/bin/pgrep", ["-x", "VoiceOver"]) === 0,
      "VoiceOver did not become ready",
    );
    return {
      async stop() {
        const status = commandStatus("/usr/bin/pkill", ["-x", "VoiceOver"]);
        if (status !== 0 && status !== 1)
          fail("VoiceOver could not be stopped");
        await stopChild(voiceOver);
        await stopChild(collector);
        closeSync(logDescriptor);
      },
    };
  },
});

export async function withNativeScreenReader(
  { platform, binary, log, applicationTokens },
  action,
  { controller = defaultController } = {},
) {
  if (existsSync(resolve(log))) fail("screen reader log already exists");
  if (
    !Array.isArray(applicationTokens) ||
    applicationTokens.length === 0 ||
    applicationTokens.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 200 ||
        value.trim() !== value,
    )
  ) {
    fail("bounded installed application tokens are required");
  }
  if (typeof action !== "function") fail("installed action is required");
  const invocation = nativeScreenReaderInvocation({ platform, binary, log });
  const session = await controller.start({ platform, invocation, log });
  if (session === null || typeof session?.stop !== "function") {
    fail("screen reader controller did not return a stoppable session");
  }
  let value;
  try {
    value = await action();
  } finally {
    await session.stop();
  }
  const content = readStableLog(log).toString("utf8");
  const matchingLine = content
    .split(/\r?\n/u)
    .find((line) =>
      applicationTokens.some((token) =>
        line
          .toLocaleLowerCase("en-US")
          .includes(token.toLocaleLowerCase("en-US")),
      ),
    );
  if (matchingLine === undefined) {
    fail("native screen reader did not observe the installed application");
  }
  return {
    value,
    technology: invocation.technology,
    observation: matchingLine.trim().slice(0, 500),
  };
}
