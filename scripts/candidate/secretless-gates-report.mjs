#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_IDS = Object.freeze([
  "workflow-contracts",
  "migration-check",
  "cloudflare-check",
  "workspace-check",
  "candidate-config",
  "frontend-source",
  "playwright-capabilities",
  "rust-graph",
  "tauri-config",
  "cargo-check",
]);

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const MARKER_RE = /^::punks-gate::([a-z0-9-]+)::(start|pass|fail)$/u;
const MAX_LOG_BYTES = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(`secretless gates report rejected: ${message}`);
}

function stableLog(path) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile()) {
    fail("gate log must be one real regular file");
  }
  if (status.size < 1 || status.size > MAX_LOG_BYTES) {
    fail("gate log has an invalid size");
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
      fail("gate log changed while it was read");
    }
    return content;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function observedMarkers(content) {
  return content
    .toString("utf8")
    .split("\n")
    .flatMap((line, index) => {
      const marker = MARKER_RE.exec(line);
      return marker === null
        ? []
        : [{ id: marker[1], state: marker[2], line: index + 1 }];
    });
}

export function buildSecretlessGatesReport({
  sourceSha,
  stagingDeploymentId,
  log,
  output,
}) {
  if (!SHA1_RE.test(sourceSha ?? "")) fail("exact source SHA required");
  if (!DEPLOYMENT_RE.test(stagingDeploymentId ?? "")) {
    fail("exact staging deployment ID required");
  }
  const outputPath = resolve(output);
  if (existsSync(outputPath)) fail("report output already exists");
  const content = stableLog(log);
  const markers = observedMarkers(content);
  const expected = GATE_IDS.flatMap((id) => [
    { id, state: "start" },
    { id, state: "pass" },
  ]);
  for (const marker of markers) {
    if (marker.state === "fail") fail(`${marker.id} recorded a failure`);
  }
  if (
    markers.length !== expected.length ||
    markers.some(
      (marker, index) =>
        marker.id !== expected[index].id ||
        marker.state !== expected[index].state,
    )
  ) {
    const mismatch = expected.find(
      (value, index) =>
        markers[index]?.id !== value.id ||
        markers[index]?.state !== value.state,
    );
    fail(
      `${mismatch?.id ?? "gate sequence"} lacks its ordered ${mismatch?.state ?? "pass"} marker`,
    );
  }
  const gates = GATE_IDS.map((id, index) => ({
    id,
    result: "vert",
    startLine: markers[index * 2].line,
    endLine: markers[index * 2 + 1].line,
  }));
  const report = {
    schema: "punks.secretless-gates-report.v1",
    sourceSha,
    stagingDeploymentId,
    logSha256: createHash("sha256").update(content).digest("hex"),
    gates,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return report;
}

function options(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--log",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    values.set(flag, value);
  }
  if (
    values.size !== expected.size ||
    [...values.keys()].some((flag) => !expected.has(flag))
  ) {
    fail("exact secretless gates report CLI arguments are required");
  }
  return (flag) => {
    const value = values.get(flag);
    if (!value) fail(`${flag} is required`);
    return value;
  };
}

export function run(argv = process.argv.slice(2)) {
  const required = options(argv);
  return buildSecretlessGatesReport({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    log: required("--log"),
    output: required("--output"),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
