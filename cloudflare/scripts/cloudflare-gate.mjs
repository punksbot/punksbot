import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ORDER = Object.freeze([
  ["@punks/contracts", "public contracts"],
  ["@punks/core", "domain core"],
  ["@punks/client", "semantic client"],
  ["@punks/auth-worker", "Auth Worker"],
  ["@punks/attestation-worker", "Attestation Worker"],
  ["@punks/erasure-worker", "Erasure Worker"],
  ["@punks/projector-worker", "Projector Worker"],
  ["@punks/search-worker", "Search Worker"],
  ["@punks/api-worker", "API Worker"],
  ["@punks/bot-runtime-worker", "Bot Runtime Worker"],
  ["@punks/dev-gateway-worker", "development gateway Worker"],
]);

async function cloudflarePackageManifests(repositoryRoot) {
  const manifests = new Map();
  for (const parent of ["packages", "workers"]) {
    const parentPath = join(repositoryRoot, "cloudflare", parent);
    const entries = await readdir(parentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(parentPath, entry.name, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest.name !== "string") {
        throw new Error(`${manifestPath} has no package name`);
      }
      if (typeof manifest.scripts?.check !== "string") {
        throw new Error(`${manifest.name} has no check script`);
      }
      if (manifests.has(manifest.name)) {
        throw new Error(`duplicate Cloudflare package ${manifest.name}`);
      }
      manifests.set(manifest.name, manifestPath);
    }
  }
  return manifests;
}

export async function createCloudflareGatePlan(repositoryRoot) {
  const manifests = await cloudflarePackageManifests(repositoryRoot);
  const plannedNames = PACKAGE_ORDER.map(([name]) => name);
  const missing = plannedNames.filter((name) => !manifests.has(name));
  const unexpected = [...manifests.keys()].filter(
    (name) => !plannedNames.includes(name),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Cloudflare package inventory mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }

  const toolingTests = (
    await readdir(join(repositoryRoot, "cloudflare/scripts"))
  )
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `cloudflare/scripts/${file}`);
  if (toolingTests.length === 0) {
    throw new Error("Cloudflare tooling test inventory is empty");
  }

  return [
    {
      kind: "boundary",
      id: "managed-boundary",
      label: "managed-only boundary",
      target: "active workflows and package scripts",
      command: process.execPath,
      args: ["cloudflare/scripts/check-managed-only-boundary.mjs"],
      timeoutMilliseconds: 30_000,
    },
    {
      kind: "tooling",
      id: "tooling",
      label: "gate tooling",
      target: "cloudflare/scripts",
      command: process.execPath,
      args: ["--test", "--test-concurrency=1", ...toolingTests],
      timeoutMilliseconds: 60_000,
    },
    {
      kind: "bindings",
      id: "worker-bindings",
      label: "Worker binding graph",
      target: "local and staging manifests",
      command: process.execPath,
      args: ["cloudflare/scripts/check-worker-bindings.mjs"],
      timeoutMilliseconds: 30_000,
    },
    {
      kind: "types",
      id: "runtime-types",
      label: "generated runtime bindings",
      target: "worker-runtime.d.ts",
      command: "pnpm",
      args: [
        "--filter",
        "@punks/api-worker",
        "exec",
        "wrangler",
        "types",
        "../../worker-runtime.d.ts",
        "--include-env",
        "false",
        "--check",
      ],
      timeoutMilliseconds: 60_000,
    },
    ...PACKAGE_ORDER.map(([target, label]) => {
      return {
        kind: "package",
        id: target.slice("@punks/".length),
        label,
        target,
        command: "pnpm",
        args: ["--filter", target, "check"],
        timeoutMilliseconds:
          target === "@punks/api-worker" || target === "@punks/contracts"
            ? 360_000
            : 180_000,
      };
    }),
  ];
}

function runStep(step, options) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      resolvePromise(result);
    };
    const killChild = (signal) => {
      if (child.pid === undefined) return;
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The group may already be gone while the direct child is closing.
        }
      }
      child.kill(signal);
    };
    const child = spawn(step.command, step.args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(options.stdout, { end: false });
    child.stderr.pipe(options.stderr, { end: false });
    const heartbeatTimer = setInterval(() => {
      const elapsedSeconds = Math.max(
        1,
        Math.floor((Date.now() - startedAt) / 1_000),
      );
      options.stdout.write(
        `[cloudflare:check] WAIT ${options.position} ${step.label} (${step.target}) still running after ${String(elapsedSeconds)}s\n`,
      );
    }, options.heartbeatMilliseconds);
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChild("SIGTERM");
      forceKillTimer = setTimeout(() => killChild("SIGKILL"), 2_000);
    }, step.timeoutMilliseconds);
    child.once("error", (error) => {
      settle({ ok: false, reason: `could not start: ${error.message}` });
    });
    child.once("close", (code, signal) => {
      if (timedOut) {
        settle({
          ok: false,
          reason: `timed out after ${String(step.timeoutMilliseconds)}ms`,
        });
        return;
      }
      if (code === 0) {
        settle({ ok: true });
        return;
      }
      settle({
        ok: false,
        reason:
          signal === null
            ? `exited with code ${String(code)}`
            : `exited after signal ${signal}`,
      });
    });
  });
}

function deterministicEnvironment(source) {
  const environment = { ...source };
  delete environment.FORCE_COLOR;
  environment.CI = "1";
  environment.NO_COLOR = "1";
  environment.WRANGLER_SEND_METRICS = "false";
  return environment;
}

export async function runCloudflareGate({
  steps,
  cwd,
  env = deterministicEnvironment(process.env),
  stdout = process.stdout,
  stderr = process.stderr,
  heartbeatMilliseconds = 30_000,
}) {
  for (const [index, step] of steps.entries()) {
    const position = `${String(index + 1)}/${String(steps.length)}`;
    stdout.write(
      `[cloudflare:check] RUN ${position} ${step.label} (${step.target})\n`,
    );
    const result = await runStep(step, {
      cwd,
      env,
      stdout,
      stderr,
      position,
      heartbeatMilliseconds,
    });
    if (!result.ok) {
      stderr.write(
        `[cloudflare:check] FAIL ${position} ${step.label} (${step.target}): ${result.reason}\n`,
      );
      return { exitCode: 1, failedStep: step };
    }
    stdout.write(
      `[cloudflare:check] PASS ${position} ${step.label} (${step.target})\n`,
    );
  }
  return { exitCode: 0 };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const repositoryRoot = resolve(dirname(modulePath), "../..");
  try {
    const steps = await createCloudflareGatePlan(repositoryRoot);
    const result = await runCloudflareGate({
      steps,
      cwd: repositoryRoot,
    });
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(
      `[cloudflare:check] FAIL configuration: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
