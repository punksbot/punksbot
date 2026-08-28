import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { parsePromotionSessionBundle } from "./staging-fixture.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const ORIGIN = "https://staging.punks.bot";
const ENDPOINTS = Object.freeze([
  Object.freeze({ path: "/api/health", authority: "api-public" }),
  Object.freeze({ path: "/api/auth/v1/session", authority: "auth-session" }),
  Object.freeze({ path: "/api/v1/punk", authority: "auth-punk" }),
]);

function fail(message) {
  throw new Error(`operational backend probe rejected: ${message}`);
}

function validResponse(path, status, document, expectedSession) {
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
      document.session?.sessionId === expectedSession.sessionId &&
      document.session?.punkId === expectedSession.punkId
    );
  }
  return document.punk?.id === expectedSession.punkId;
}

/** Proves each closed public authority once against the exact staging state. */
export async function collectOperationalBackendProbe(
  input,
  { fetchImpl = fetch, now = () => new Date() } = {},
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and probe boundaries are required");
  }
  const session = parsePromotionSessionBundle(
    JSON.stringify(input.sessionBundle),
    input.sourceSha,
  );
  const expectedSession = {
    sessionId: session.metadata.session_id,
    punkId: session.metadata.punk_id,
  };
  const observations = await Promise.all(
    ENDPOINTS.map(async (endpoint) => {
      const authenticated = endpoint.path !== "/api/health";
      let status = null;
      let document = null;
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
        status = response.status;
        if ((response.headers.get("content-type") ?? "").includes("json")) {
          try {
            document = await response.json();
          } catch {
            document = null;
          }
        }
      } catch {
        status = null;
        document = null;
      }
      const accepted = validResponse(
        endpoint.path,
        status,
        document,
        expectedSession,
      );
      return {
        path: endpoint.path,
        authority: endpoint.authority,
        status,
        result: accepted ? "vert" : "rouge",
        responseSha256: document === null ? null : canonicalSha256(document),
      };
    }),
  );
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("probe observation clock is invalid");
  }
  const content = {
    schema: "punks.operational-backend-proof.v2",
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    origin: ORIGIN,
    endpoints: observations,
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
