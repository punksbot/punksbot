import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseBindingFile } from "./staging-material.mjs";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const STAGING_WAKE_QUEUES = Object.freeze([
  "punks-bot-wake-staging-dlq",
  "punks-bot-wake-staging",
]);

export const STAGING_R2_BUCKETS = Object.freeze([
  "punks-erasure-staging",
  "punks-journal-staging",
  "punks-media-staging",
]);

export const DEPLOY_ORDER = Object.freeze([
  { worker: "auth", packageName: "@punks/auth-worker" },
  { worker: "attestation", packageName: "@punks/attestation-worker" },
  { worker: "erasure", packageName: "@punks/erasure-worker" },
  { worker: "projector", packageName: "@punks/projector-worker" },
  { worker: "search", packageName: "@punks/search-worker" },
  { worker: "api", packageName: "@punks/api-worker" },
  { worker: "bot-runtime", packageName: "@punks/bot-runtime-worker" },
]);

const SECRET_KEYS = Object.freeze({
  api: Object.freeze([
    "OPERATOR_PROVISIONING_TOKEN",
    "ATTESTATION_PUBLIC_KEYS_JSON",
    "MESSAGE_SEARCH_MASTER_KEY",
    "MESSAGE_SEARCH_CURSOR_KEY",
    "MESSAGE_HISTORY_CURSOR_KEY",
    "DIRECTORY_CURSOR_KEY",
  ]),
  auth: Object.freeze([
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "BOT_INVOCATION_CURRENT_SECRET",
  ]),
  attestation: Object.freeze(["ATTESTATION_PRIVATE_KEY"]),
  projector: Object.freeze(["ATTESTATION_PUBLIC_KEYS_JSON"]),
});

export function requiredStagingBindings() {
  return [...new Set(Object.values(SECRET_KEYS).flat())].sort();
}

export function secretBindingsForWorker(worker, bindings) {
  const keys = SECRET_KEYS[worker];
  if (keys === undefined) return {};
  return Object.fromEntries(keys.map((key) => [key, bindings[key]]));
}

export function validateStagingBindings(bindings) {
  for (const key of requiredStagingBindings()) {
    const value = bindings[key];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(`missing or invalid staging binding: ${key}`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(bindings.ATTESTATION_PRIVATE_KEY)) {
    throw new Error("ATTESTATION_PRIVATE_KEY must be 32 lowercase hex bytes");
  }
  for (const key of [
    "BOT_INVOCATION_CURRENT_SECRET",
    "OPERATOR_PROVISIONING_TOKEN",
    "MESSAGE_SEARCH_MASTER_KEY",
    "MESSAGE_SEARCH_CURSOR_KEY",
    "MESSAGE_HISTORY_CURSOR_KEY",
    "DIRECTORY_CURSOR_KEY",
  ]) {
    if (bindings[key].length < 32) {
      throw new Error(`${key} must contain at least 32 characters`);
    }
  }
  let registry;
  try {
    registry = JSON.parse(bindings.ATTESTATION_PUBLIC_KEYS_JSON);
  } catch {
    throw new Error("ATTESTATION_PUBLIC_KEYS_JSON must be valid JSON");
  }
  if (
    registry === null ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    Object.keys(registry).join(",") !== "staging" ||
    registry.staging === null ||
    typeof registry.staging !== "object" ||
    Array.isArray(registry.staging) ||
    Object.keys(registry.staging).join(",") !== "staging-v1" ||
    !/^[0-9a-f]{64}$/.test(registry.staging["staging-v1"])
  ) {
    throw new Error(
      "ATTESTATION_PUBLIC_KEYS_JSON has an invalid staging registry",
    );
  }
}

export function stagingDeployArguments(entry, dryRun, sourceSha) {
  if (!GIT_SHA_PATTERN.test(sourceSha)) {
    throw new Error(
      "source SHA must be an exact 40-character lowercase Git SHA",
    );
  }
  return [
    "--filter",
    entry.packageName,
    "exec",
    "wrangler",
    "deploy",
    "--env",
    "staging",
    ...(dryRun ? ["--dry-run"] : []),
    "--message",
    `punks-source-sha:${sourceSha}`,
  ];
}

export async function assertExactSourceCheckout(repoRoot, sourceSha) {
  if (!GIT_SHA_PATTERN.test(sourceSha)) {
    throw new Error(
      "source SHA must be an exact 40-character lowercase Git SHA",
    );
  }
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: repoRoot, encoding: "utf8" },
    ),
  ]);
  if (head.trim() !== sourceSha) {
    throw new Error(
      `source SHA ${sourceSha} does not match checkout HEAD ${head.trim()}`,
    );
  }
  if (status !== "") {
    throw new Error(
      "staging deployment requires a clean checkout so its source SHA annotation is exact",
    );
  }
}

export function isR2NotEnabledError(error) {
  const message = String(error);
  return message.includes("enable R2") || message.includes("code: 10042");
}

function runPnpm(args, { cwd, env, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", args, {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = capture ? `\n${stdout}${stderr}` : "";
      reject(
        new Error(
          `${signal === null ? `pnpm exited with code ${String(code)}` : `pnpm exited after signal ${signal}`}${detail}`,
        ),
      );
    });
  });
}

async function cloudflareEnvironment(repoRoot) {
  const inventory = JSON.parse(
    await readFile(join(repoRoot, "cloudflare/staging.resources.json"), "utf8"),
  );
  return {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: inventory.account.id,
  };
}

function command(packageName, ...args) {
  return ["--filter", packageName, "exec", "wrangler", ...args];
}

export async function provisionStagingResources(repoRoot) {
  const env = await cloudflareEnvironment(repoRoot);
  const created = [];
  const queueList = await runPnpm(
    command("@punks/api-worker", "queues", "list"),
    { cwd: repoRoot, env, capture: true },
  );
  for (const name of STAGING_WAKE_QUEUES) {
    if (!queueList.stdout.includes(name)) {
      await runPnpm(
        command(
          "@punks/api-worker",
          "queues",
          "create",
          name,
          "--message-retention-period-secs",
          "1209600",
        ),
        { cwd: repoRoot, env },
      );
      created.push(name);
    }
  }

  let bucketList;
  try {
    bucketList = await runPnpm(
      command("@punks/api-worker", "r2", "bucket", "list"),
      { cwd: repoRoot, env, capture: true },
    );
  } catch (error) {
    if (isR2NotEnabledError(error)) {
      throw new Error(
        "R2 is not enabled on the Punks account; enable it in the Cloudflare dashboard first",
      );
    }
    throw error;
  }
  for (const name of STAGING_R2_BUCKETS) {
    if (!bucketList.stdout.includes(name)) {
      await runPnpm(
        command("@punks/api-worker", "r2", "bucket", "create", name),
        { cwd: repoRoot, env },
      );
      created.push(name);
    }
  }
  return created;
}

export async function uploadStagingSecrets(repoRoot, bindingFile) {
  const bindings = parseBindingFile(await readFile(bindingFile, "utf8"));
  validateStagingBindings(bindings);
  const env = await cloudflareEnvironment(repoRoot);
  const directory = await mkdtemp(join(tmpdir(), "punks-staging-secrets-"));
  try {
    for (const worker of Object.keys(SECRET_KEYS)) {
      const path = join(directory, `${worker}.json`);
      await writeFile(
        path,
        JSON.stringify(secretBindingsForWorker(worker, bindings)),
        { encoding: "utf8", mode: 0o600 },
      );
      const packageName = DEPLOY_ORDER.find(
        (entry) => entry.worker === worker,
      )?.packageName;
      if (packageName === undefined)
        throw new Error(`unknown Worker: ${worker}`);
      await runPnpm(
        command(packageName, "secret", "bulk", path, "--env", "staging"),
        { cwd: repoRoot, env },
      );
      process.stdout.write(`staging secrets uploaded: ${worker}\n`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function deployStaging(repoRoot, dryRun, sourceSha) {
  await assertExactSourceCheckout(repoRoot, sourceSha);
  const env = await cloudflareEnvironment(repoRoot);
  for (const entry of DEPLOY_ORDER) {
    await runPnpm(stagingDeployArguments(entry, dryRun, sourceSha), {
      cwd: repoRoot,
      env,
    });
  }
}

export async function showStagingStatus(repoRoot) {
  const env = await cloudflareEnvironment(repoRoot);
  const checks = [
    {
      kind: "queues",
      args: command("@punks/api-worker", "queues", "list"),
    },
    {
      kind: "r2",
      args: command("@punks/api-worker", "r2", "bucket", "list"),
    },
    {
      kind: "workflows",
      args: command(
        "@punks/bot-runtime-worker",
        "workflows",
        "list",
        "--env",
        "staging",
      ),
    },
  ];
  let r2Disabled = false;
  for (const check of checks) {
    try {
      const result = await runPnpm(check.args, {
        cwd: repoRoot,
        env,
        capture: true,
      });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    } catch (error) {
      if (check.kind === "r2" && isR2NotEnabledError(error)) {
        r2Disabled = true;
        process.stderr.write(
          "R2: not enabled on the Punks account; enable it in the Cloudflare dashboard before provisioning staging buckets.\n",
        );
        continue;
      }
      throw error;
    }
  }
  if (r2Disabled) {
    throw new Error("staging is not ready: R2 is not enabled");
  }
}

const modulePath = fileURLToPath(import.meta.url);
async function main() {
  const repoRoot = resolve(dirname(modulePath), "../..");
  const operation = process.argv[2];
  switch (operation) {
    case "provision": {
      const created = await provisionStagingResources(repoRoot);
      process.stdout.write(
        created.length === 0
          ? "staging resources already present\n"
          : `staging resources created: ${created.join(", ")}\n`,
      );
      break;
    }
    case "secrets":
      await uploadStagingSecrets(
        repoRoot,
        resolve(process.argv[3] ?? "cloudflare/.dev.vars.staging"),
      );
      break;
    case "dry-run":
      if (process.argv[3] !== "--source-sha" || process.argv.length !== 5) {
        throw new Error(
          "usage: staging-operations.mjs dry-run --source-sha <sha>",
        );
      }
      await deployStaging(repoRoot, true, process.argv[4]);
      break;
    case "deploy":
      if (process.argv[3] !== "--source-sha" || process.argv.length !== 5) {
        throw new Error(
          "usage: staging-operations.mjs deploy --source-sha <sha>",
        );
      }
      await deployStaging(repoRoot, false, process.argv[4]);
      break;
    case "status":
      await showStagingStatus(repoRoot);
      break;
    default:
      throw new Error(
        "usage: staging-operations.mjs provision|secrets|status or dry-run|deploy --source-sha <sha>",
      );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
