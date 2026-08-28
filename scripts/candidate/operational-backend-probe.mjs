import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { parsePromotionSessionBundle } from "./staging-fixture.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ORIGIN = "https://staging.punks.bot";
const ENDPOINTS = Object.freeze([
  Object.freeze({ path: "/api/health", authority: "api-public" }),
  Object.freeze({ path: "/api/auth/v1/session", authority: "auth-session" }),
  Object.freeze({ path: "/api/v1/punk", authority: "auth-punk" }),
]);

function fail(message) {
  throw new Error(`operational backend probe rejected: ${message}`);
}

function validResponse(path, status, document) {
  if (status !== 200 || document === null || typeof document !== "object") {
    return false;
  }
  if (path === "/api/health") {
    return (
      document.service === "punks-api" &&
      document.environment === "staging" &&
      document.status === "ok"
    );
  }
  if (path === "/api/auth/v1/session") {
    return (
      UUID_RE.test(document.session?.sessionId ?? "") &&
      UUID_RE.test(document.session?.punkId ?? "")
    );
  }
  return UUID_RE.test(document.punk?.id ?? "");
}

function histogram(values) {
  const buckets = new Map();
  for (const value of values) {
    const bounded = Math.max(0, Math.ceil(value));
    buckets.set(bounded, (buckets.get(bounded) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, count]) => ({ value, count }));
}

/** Runs actual HTTPS requests against the exact staging before Session loss. */
export async function collectOperationalBackendProbe(
  input,
  {
    fetchImpl = fetch,
    clock = () => performance.now(),
    now = () => new Date(),
  } = {},
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    !Number.isSafeInteger(input?.countPerEndpoint) ||
    input.countPerEndpoint < 1 ||
    input.countPerEndpoint > 100_000 ||
    !Number.isSafeInteger(input?.concurrency) ||
    input.concurrency < 1 ||
    input.concurrency > 256 ||
    typeof fetchImpl !== "function" ||
    typeof clock !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and bounded probe configuration are required");
  }
  const session = parsePromotionSessionBundle(
    JSON.stringify(input.sessionBundle),
    input.sourceSha,
  );
  const tasks = ENDPOINTS.flatMap((endpoint) =>
    Array.from({ length: input.countPerEndpoint }, () => endpoint),
  );
  const observations = new Map(
    ENDPOINTS.map(({ path, authority }) => [
      path,
      { path, authority, total: 0, failures: 0, latencies: [] },
    ]),
  );
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      const endpoint = tasks[index];
      const observation = observations.get(endpoint.path);
      const authenticated = endpoint.path !== "/api/health";
      const started = clock();
      let accepted = false;
      try {
        const response = await fetchImpl(`${ORIGIN}${endpoint.path}`, {
          method: "GET",
          redirect: "error",
          headers: {
            accept: "application/json",
            origin: ORIGIN,
            "sec-punks-desktop-environment": "staging",
            ...(authenticated ? { cookie: session.cookie } : {}),
          },
        });
        let document = null;
        if ((response.headers.get("content-type") ?? "").includes("json")) {
          try {
            document = await response.json();
          } catch {
            document = null;
          }
        }
        accepted = validResponse(endpoint.path, response.status, document);
      } catch {
        accepted = false;
      }
      const finished = clock();
      const latency = finished - started;
      if (!Number.isFinite(latency) || latency < 0) {
        fail("probe clock produced an invalid latency");
      }
      observation.total += 1;
      observation.failures += accepted ? 0 : 1;
      observation.latencies.push(latency);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, tasks.length) }, worker),
  );
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("probe observation clock is invalid");
  }
  const content = {
    schema: "punks.operational-backend-probe.v1",
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    origin: ORIGIN,
    endpoints: ENDPOINTS.map(({ path }) => {
      const value = observations.get(path);
      return {
        path: value.path,
        authority: value.authority,
        total: value.total,
        failures: value.failures,
        histogram: histogram(value.latencies),
      };
    }),
    observedAt: observedAt.toISOString(),
  };
  return { ...content, sha256: canonicalSha256(content) };
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--session-file",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag)) {
      fail("exact CLI arguments are required");
    }
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (flag) => values.get(flag);
}

export async function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  const { readFileSync } = await import("node:fs");
  const report = await collectOperationalBackendProbe({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    sessionBundle: JSON.parse(readFileSync(required("--session-file"), "utf8")),
    countPerEndpoint: 10_000,
    concurrency: 64,
  });
  writeFileSync(resolve(required("--output")), `${JSON.stringify(report)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return report;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
