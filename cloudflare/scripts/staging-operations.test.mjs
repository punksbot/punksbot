import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  assertExactSourceCheckout,
  DEPLOY_ORDER,
  isR2NotEnabledError,
  requiredStagingBindings,
  secretBindingsForWorker,
  stagingDeployArguments,
  STAGING_R2_BUCKETS,
  STAGING_WAKE_QUEUES,
} from "./staging-operations.mjs";

const execFileAsync = promisify(execFile);

const bindings = Object.fromEntries(
  requiredStagingBindings().map((key) => [
    key,
    key === "ATTESTATION_PUBLIC_KEYS_JSON"
      ? JSON.stringify({ staging: { "staging-v1": "a".repeat(64) } })
      : "a".repeat(64),
  ]),
);
const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

test("uploads only the minimum secret set to each Worker", () => {
  assert.deepEqual(
    Object.keys(secretBindingsForWorker("attestation", bindings)),
    ["ATTESTATION_PRIVATE_KEY"],
  );
  assert.deepEqual(
    Object.keys(secretBindingsForWorker("projector", bindings)),
    ["ATTESTATION_PUBLIC_KEYS_JSON"],
  );
  assert.deepEqual(
    Object.keys(secretBindingsForWorker("api", bindings)).sort(),
    [
      "ATTESTATION_PUBLIC_KEYS_JSON",
      "DIRECTORY_CURSOR_KEY",
      "MEDIA_UPLOAD_GRANT_KEY",
      "MESSAGE_HISTORY_CURSOR_KEY",
      "MESSAGE_SEARCH_CURSOR_KEY",
      "MESSAGE_SEARCH_MASTER_KEY",
      "OPERATOR_PROVISIONING_TOKEN",
    ],
  );
  assert.deepEqual(
    Object.keys(secretBindingsForWorker("auth", bindings)).sort(),
    [
      "BOT_INVOCATION_CURRENT_SECRET",
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
    ],
  );
  assert.equal(
    "BOT_INVOCATION_CURRENT_SECRET" in secretBindingsForWorker("api", bindings),
    false,
  );
});

test("deploys private dependencies before API and Bot Runtime", () => {
  assert.deepEqual(
    DEPLOY_ORDER.map(({ worker }) => worker),
    [
      "auth",
      "attestation",
      "erasure",
      "projector",
      "search",
      "api",
      "bot-runtime",
    ],
  );
  const runtime = stagingDeployArguments(
    DEPLOY_ORDER.at(-1),
    false,
    SOURCE_SHA,
  );
  assert.ok(runtime.includes("--env"));
  assert.ok(runtime.includes("staging"));
  assert.ok(!runtime.includes("--dry-run"));
  assert.deepEqual(runtime.slice(-2), [
    "--message",
    `punks-source-sha:${SOURCE_SHA}`,
  ]);
  assert.ok(
    stagingDeployArguments(DEPLOY_ORDER[0], true, SOURCE_SHA).includes(
      "--dry-run",
    ),
  );
});

test("refuses to deploy without an exact lowercase source SHA", () => {
  for (const sourceSha of [
    undefined,
    "",
    "0123456789abcdef0123456789abcdef0123456",
    "0123456789ABCDEF0123456789ABCDEF01234567",
  ]) {
    assert.throws(
      () => stagingDeployArguments(DEPLOY_ORDER[0], false, sourceSha),
      /source SHA must be an exact 40-character lowercase Git SHA/,
    );
  }
});

test("binds a deployment annotation only to the clean checkout HEAD", async (t) => {
  const repository = await mkdtemp(join(tmpdir(), "punks-staging-source-"));
  t.after(() => rm(repository, { force: true, recursive: true }));
  await execFileAsync("git", ["init", "--quiet"], { cwd: repository });
  await execFileAsync("git", ["config", "user.name", "Punks Test"], {
    cwd: repository,
  });
  await execFileAsync("git", ["config", "user.email", "test@punks.bot"], {
    cwd: repository,
  });
  const source = join(repository, "source.txt");
  await writeFile(source, "exact\n", "utf8");
  await execFileAsync("git", ["add", "source.txt"], { cwd: repository });
  await execFileAsync("git", ["commit", "--quiet", "-m", "exact source"], {
    cwd: repository,
  });
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    { cwd: repository, encoding: "utf8" },
  );
  const sourceSha = stdout.trim();

  await assert.doesNotReject(
    assertExactSourceCheckout(repository, sourceSha),
  );
  await assert.rejects(
    assertExactSourceCheckout(repository, "f".repeat(40)),
    /does not match checkout HEAD/,
  );

  await writeFile(source, "dirty\n", "utf8");
  await assert.rejects(
    assertExactSourceCheckout(repository, sourceSha),
    /requires a clean checkout/,
  );
});

test("provisions only resources bound by current staging manifests", () => {
  assert.deepEqual(STAGING_WAKE_QUEUES, [
    "punks-bot-wake-staging-dlq",
    "punks-bot-wake-staging",
  ]);
  assert.deepEqual(STAGING_R2_BUCKETS, [
    "punks-erasure-staging",
    "punks-journal-staging",
    "punks-media-staging",
  ]);
});

test("recognizes the Cloudflare R2 activation blocker", () => {
  assert.equal(
    isR2NotEnabledError(
      new Error(
        "Please enable R2 through the Cloudflare Dashboard. [code: 10042]",
      ),
    ),
    true,
  );
  assert.equal(isR2NotEnabledError(new Error("authentication failed")), false);
});
