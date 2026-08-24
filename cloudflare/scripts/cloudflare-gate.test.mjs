import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCloudflareGatePlan,
  runCloudflareGate,
} from "./cloudflare-gate.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function outputCollector() {
  let output = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    read: () => output,
  };
}

test("reports a public contract divergence and stops the gate", async () => {
  const stdout = outputCollector();
  const stderr = outputCollector();
  const result = await runCloudflareGate({
    cwd: process.cwd(),
    stdout: stdout.stream,
    stderr: stderr.stream,
    heartbeatMilliseconds: 1_000,
    steps: [
      {
        id: "contracts",
        label: "public contracts",
        target: "@punks/contracts",
        command: process.execPath,
        args: [
          "--eval",
          "process.stderr.write('Generated contract is stale: desktop-social-loop.ts\\n'); process.exit(9);",
        ],
        timeoutMilliseconds: 1_000,
      },
      {
        id: "api",
        label: "API Worker",
        target: "@punks/api-worker",
        command: process.execPath,
        args: ["--eval", "process.stdout.write('API SHOULD NOT RUN\\n')"],
        timeoutMilliseconds: 1_000,
      },
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.failedStep?.id, "contracts");
  assert.match(
    stderr.read(),
    /Generated contract is stale: desktop-social-loop\.ts/,
  );
  assert.match(
    stderr.read(),
    /FAIL 1\/2 public contracts \(@punks\/contracts\): exited with code 9/,
  );
  assert.doesNotMatch(stdout.read(), /API SHOULD NOT RUN/);
});

test("covers every Cloudflare package in one deterministic order", async () => {
  const plan = await createCloudflareGatePlan(repositoryRoot);
  const packageSteps = plan.filter((step) => step.kind === "package");
  const discoveredNames = [];
  for (const parent of ["packages", "workers"]) {
    const parentPath = join(repositoryRoot, "cloudflare", parent);
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        await readFile(join(parentPath, entry.name, "package.json"), "utf8"),
      );
      discoveredNames.push(manifest.name);
    }
  }

  assert.deepEqual(
    packageSteps.map((step) => step.target),
    [
      "@punks/contracts",
      "@punks/core",
      "@punks/client",
      "@punks/auth-worker",
      "@punks/attestation-worker",
      "@punks/erasure-worker",
      "@punks/projector-worker",
      "@punks/search-worker",
      "@punks/api-worker",
      "@punks/bot-runtime-worker",
      "@punks/dev-gateway-worker",
    ],
  );
  assert.deepEqual(
    packageSteps.map((step) => step.target).toSorted(),
    discoveredNames.toSorted(),
  );
  for (const step of packageSteps) {
    assert.equal(step.command, "pnpm");
    assert.deepEqual(step.args, ["--filter", step.target, "check"]);
  }
  assert.equal(
    packageSteps.find((step) => step.target === "@punks/contracts")
      ?.timeoutMilliseconds,
    360_000,
  );
  assert.equal(
    packageSteps.find((step) => step.target === "@punks/api-worker")
      ?.timeoutMilliseconds,
    360_000,
  );
});

test("runs the managed-only boundary before tooling or Worker checks", async () => {
  const plan = await createCloudflareGatePlan(repositoryRoot);

  assert.equal(plan[0]?.kind, "boundary");
  assert.equal(plan[0]?.id, "managed-boundary");
});

test("gates the Rust client on the common conformance corpus", async () => {
  const plan = await createCloudflareGatePlan(repositoryRoot);
  const rustStep = plan.find((step) => step.id === "rust-client-conformance");

  assert.equal(rustStep?.kind, "conformance");
  assert.equal(rustStep?.command, join(repositoryRoot, "bin", "cargo"));
  assert.deepEqual(rustStep?.args, [
    "test",
    "--manifest-path",
    "desktop/src-tauri/Cargo.toml",
    "--package",
    "punks-account-client",
  ]);
  assert.ok(
    plan.findIndex((step) => step.id === "rust-client-conformance") <
      plan.findIndex((step) => step.id === "api-worker"),
  );
});

test("reports progress and times out a stalled Worker step", async () => {
  const stdout = outputCollector();
  const stderr = outputCollector();
  const result = await runCloudflareGate({
    cwd: process.cwd(),
    stdout: stdout.stream,
    stderr: stderr.stream,
    heartbeatMilliseconds: 20,
    steps: [
      {
        id: "api-worker",
        label: "API Worker",
        target: "@punks/api-worker",
        command: process.execPath,
        args: ["--eval", "setTimeout(() => process.exit(0), 250)"],
        timeoutMilliseconds: 80,
      },
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.failedStep?.id, "api-worker");
  assert.match(stdout.read(), /WAIT 1\/1 API Worker \(@punks\/api-worker\)/);
  assert.match(
    stderr.read(),
    /FAIL 1\/1 API Worker \(@punks\/api-worker\): timed out after 80ms/,
  );
});

test("routes the public backend command through the deterministic gate", async () => {
  const rootPackage = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(
    rootPackage.scripts["cloudflare:check"],
    "node cloudflare/scripts/cloudflare-gate.mjs",
  );
  assert.equal(
    rootPackage.scripts["cloudflare:check-bindings"],
    "node cloudflare/scripts/check-worker-bindings.mjs",
  );
});

test("isolates API workerd files while keeping their execution serial", async () => {
  const apiPackage = JSON.parse(
    await readFile(
      join(repositoryRoot, "cloudflare/workers/api/package.json"),
      "utf8",
    ),
  );

  assert.equal(apiPackage.scripts.test, "vitest run --max-workers=1");
});
