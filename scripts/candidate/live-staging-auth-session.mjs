import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://staging.punks.bot";
const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const METHODS = ["google", "github"];

function fail(message) {
  throw new Error(`live staging Auth Session rejected: ${message}`);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function pkce(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function json(fetchImpl, path, body, extraHeaders = {}) {
  const response = await fetchImpl(`${ORIGIN}${path}`, {
    method: "POST",
    redirect: "error",
    headers: {
      origin: ORIGIN,
      "sec-punks-desktop-environment": "staging",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  let document;
  try {
    document = await response.json();
  } catch {
    fail(`${path} returned non-JSON`);
  }
  return { response, document };
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") ?? "";
  const cookie = header.split(";", 1)[0];
  if (!/^__Host-punks_session=[^;\s]{32,256}$/u.test(cookie)) {
    fail("claim response did not deliver one private Session cookie");
  }
  return cookie;
}

export async function createLiveStagingAuthSession(
  { sourceSha, stagingDeploymentId, method = "github", pollLimit = 300 },
  {
    fetchImpl = fetch,
    wait = (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    onBrowserUrl = () => undefined,
  } = {},
) {
  if (
    !SHA1_RE.test(sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "") ||
    !METHODS.includes(method) ||
    !Number.isSafeInteger(pollLimit) ||
    pollLimit < 1
  ) {
    fail("exact source SHA and bounded polling are required");
  }
  const verifier = base64url(randomBytes(32));
  const verifierCommitment = pkce(verifier);
  const started = await json(
    fetchImpl,
    "/api/auth/v1/desktop/start",
    {
      contract: "desktop-auth.start@1",
      message: "request",
      intent: "sign_in",
      method,
      verifierCommitment,
    },
    {
      "x-punks-promotion-source-sha": sourceSha,
      "x-punks-promotion-staging-deployment-id": stagingDeploymentId,
    },
  );
  if (
    started.response.status !== 201 ||
    !UUID_RE.test(started.document?.flowId ?? "") ||
    typeof started.document?.browserUrl !== "string" ||
    !started.document.browserUrl.startsWith(
      `${ORIGIN}/api/auth/v1/desktop/browser?`,
    )
  ) {
    fail("desktop Auth start failed");
  }
  const flowId = started.document.flowId;
  onBrowserUrl(started.document.browserUrl, flowId);
  let ready = false;
  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    const status = await json(fetchImpl, "/api/auth/v1/desktop/status", {
      contract: "desktop-auth.status@1",
      message: "request",
      flowId,
      verifierCommitment,
    });
    if (status.response.status !== 200) fail("desktop Auth status failed");
    if (status.document?.phase === "ready") {
      ready = true;
      break;
    }
    if (
      ["cancelled", "expired", "confirmed"].includes(status.document?.phase)
    ) {
      fail(
        `desktop Auth became terminal in phase ${String(status.document.phase)}`,
      );
    }
    await wait(2_000);
  }
  if (!ready) fail("desktop Auth browser completion timed out");
  const claimed = await json(fetchImpl, "/api/auth/v1/desktop/claim", {
    contract: "desktop-auth.claim@1",
    message: "request",
    deliveryKind: "request",
    flowId,
    verifier,
  });
  if (
    claimed.response.status !== 200 ||
    claimed.document?.deliveryKind !== "session" ||
    !UUID_RE.test(claimed.document?.deliveryId ?? "") ||
    !UUID_RE.test(claimed.document?.session?.sessionId ?? "") ||
    !UUID_RE.test(claimed.document?.session?.punkId ?? "")
  ) {
    fail("desktop Auth claim did not deliver a Session");
  }
  const cookie = cookieFrom(claimed.response);
  const confirmed = await json(fetchImpl, "/api/auth/v1/desktop/confirm", {
    contract: "desktop-auth.confirm@1",
    message: "request",
    flowId,
    verifier,
    deliveryId: claimed.document.deliveryId,
  });
  if (
    confirmed.response.status !== 200 ||
    confirmed.document?.phase !== "confirmed" ||
    confirmed.document?.sessionId !== claimed.document.session.sessionId
  ) {
    fail("desktop Auth confirmation failed");
  }
  const expiresAtSeconds = Math.floor(
    Date.parse(claimed.document.session.expiresAt) / 1_000,
  );
  const revokeExpiresAtSeconds = Math.floor(
    Date.parse(claimed.document.revokeCapability?.expiresAt) / 1_000,
  );
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= Math.floor(Date.now() / 1_000) + 300 ||
    revokeExpiresAtSeconds !== expiresAtSeconds ||
    typeof claimed.document.revokeCapability?.token !== "string"
  ) {
    fail("desktop Auth Session expiry/capability is invalid");
  }
  return {
    flowId,
    bundle: {
      source_sha: sourceSha,
      cookie,
      metadata: {
        session_id: claimed.document.session.sessionId,
        punk_id: claimed.document.session.punkId,
        expires_at_seconds: expiresAtSeconds,
        last_renewed_at_seconds: null,
      },
      revoke_capability: claimed.document.revokeCapability.token,
      revoke_expires_at_seconds: revokeExpiresAtSeconds,
    },
  };
}

export async function createLiveStagingAuthCancellation(
  { sourceSha, stagingDeploymentId, method },
  { fetchImpl = fetch, browserFetch = fetch } = {},
) {
  if (
    !SHA1_RE.test(sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "") ||
    !METHODS.includes(method) ||
    typeof fetchImpl !== "function" ||
    typeof browserFetch !== "function"
  ) {
    fail("exact source, staging and provider method are required");
  }
  const verifier = base64url(randomBytes(32));
  const verifierCommitment = pkce(verifier);
  const started = await json(
    fetchImpl,
    "/api/auth/v1/desktop/start",
    {
      contract: "desktop-auth.start@1",
      message: "request",
      intent: "sign_in",
      method,
      verifierCommitment,
    },
    {
      "x-punks-promotion-source-sha": sourceSha,
      "x-punks-promotion-staging-deployment-id": stagingDeploymentId,
    },
  );
  if (
    started.response.status !== 201 ||
    !UUID_RE.test(started.document?.flowId ?? "") ||
    typeof started.document?.browserUrl !== "string" ||
    !started.document.browserUrl.startsWith(
      `${ORIGIN}/api/auth/v1/desktop/browser?`,
    )
  ) {
    fail("desktop Auth cancellation start failed");
  }
  const flowId = started.document.flowId;
  const launched = await browserFetch(started.document.browserUrl, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "Punks-Promotion-Cancellation/1" },
  });
  const expectedLaunch = launched.status >= 300 && launched.status < 400;
  if (!expectedLaunch) {
    fail(`desktop ${method} browser launch returned HTTP ${launched.status}`);
  }
  const cancelled = await json(fetchImpl, "/api/auth/v1/desktop/cancel", {
    contract: "desktop-auth.cancel@1",
    message: "request",
    flowId,
    verifier,
  });
  if (
    cancelled.response.status !== 200 ||
    cancelled.document?.flowId !== flowId ||
    cancelled.document?.phase !== "cancelled" ||
    !Number.isFinite(Date.parse(cancelled.document?.cancelledAt ?? ""))
  ) {
    fail(`desktop ${method} cancellation failed`);
  }
  return {
    flowId,
    method,
    cancelledAt: cancelled.document.cancelledAt,
  };
}

function cliArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  if (
    values.size !== 5 ||
    !values.has("--source-sha") ||
    !values.has("--staging-deployment-id") ||
    !values.has("--method") ||
    !values.has("--bundle-output") ||
    !values.has("--flow-output")
  ) {
    fail("exact CLI arguments are required");
  }
  return (name) => values.get(name);
}

export async function run(argv = process.argv.slice(2)) {
  const required = cliArgs(argv);
  const result = await createLiveStagingAuthSession(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      method: required("--method"),
    },
    {
      onBrowserUrl(url, flowId) {
        console.log(`BROWSER_URL=${url}`);
        console.log(`FLOW_ID=${flowId}`);
      },
    },
  );
  writeFileSync(
    resolve(required("--bundle-output")),
    `${JSON.stringify(result.bundle)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(resolve(required("--flow-output")), `${result.flowId}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log("LIVE_AUTH_SESSION=ready");
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
