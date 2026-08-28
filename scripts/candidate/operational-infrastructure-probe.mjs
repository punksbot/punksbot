import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { creerFrontiereLectureR2 } from "../promotion-frontiers.mjs";
import { operationalBudgetManifestPrefix } from "./operational-budget-fetch.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT_ID = "3a391620584c792dbbd8cfa148d7634a";
const ORIGIN = "https://staging.punks.bot";
const QUEUES = Object.freeze([
  "punks-projection-staging",
  "punks-projection-staging-dlq",
  "punks-bot-wake-staging",
  "punks-bot-wake-staging-dlq",
]);

function fail(message) {
  throw new Error(`operational infrastructure proof rejected: ${message}`);
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

async function jsonResponse(response, label) {
  if (
    !response.ok ||
    !(response.headers.get("content-type") ?? "").includes("json")
  ) {
    fail(`${label} returned HTTP ${response.status} or non-JSON`);
  }
  try {
    return await response.json();
  } catch {
    fail(`${label} returned invalid JSON`);
  }
}

async function cloudflareGet(fetchImpl, apiToken, path, label) {
  return jsonResponse(
    await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method: "GET",
      redirect: "error",
      headers: { authorization: `Bearer ${apiToken}` },
    }),
    label,
  );
}

function safeCounter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} is invalid`);
  return value;
}

function destination(role, value) {
  const match = /^([0-9a-f]{32})\/([a-z0-9][a-z0-9-]{1,62})$/u.exec(
    value ?? "",
  );
  if (match === null || match[1] !== ACCOUNT_ID) {
    fail(`${role} R2 destination is invalid`);
  }
  return { role, compte: match[1], bucket: match[2] };
}

/** Collects exact queue, outbox, archive and lock state after installed T1. */
export async function collectOperationalInfrastructureProof(
  input,
  { fetchImpl = fetch, frontieres, now = () => new Date() } = {},
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    typeof input?.operatorToken !== "string" ||
    input.operatorToken.length < 32 ||
    input.operatorToken.length > 4_096 ||
    /\s/u.test(input.operatorToken) ||
    typeof input?.cloudflareApiToken !== "string" ||
    input.cloudflareApiToken.length < 16 ||
    typeof fetchImpl !== "function" ||
    typeof frontieres?.cloudflare?.lireVerrouillage !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and protected read boundaries are required");
  }
  const listed = await cloudflareGet(
    fetchImpl,
    input.cloudflareApiToken,
    `/accounts/${ACCOUNT_ID}/queues?per_page=100`,
    "queue inventory",
  );
  if (listed?.success !== true || !Array.isArray(listed.result)) {
    fail("queue inventory envelope is invalid");
  }
  const queues = [];
  for (const name of QUEUES) {
    const matches = listed.result.filter((entry) => entry?.queue_name === name);
    const queueId = matches[0]?.queue_id;
    if (matches.length !== 1 || typeof queueId !== "string" || queueId === "") {
      fail(`queue ${name} is absent or ambiguous`);
    }
    const envelope = await cloudflareGet(
      fetchImpl,
      input.cloudflareApiToken,
      `/accounts/${ACCOUNT_ID}/queues/${encodeURIComponent(queueId)}/metrics`,
      `queue ${name} metrics`,
    );
    const metrics = envelope?.result;
    if (
      envelope?.success !== true ||
      metrics === null ||
      typeof metrics !== "object"
    ) {
      fail(`queue ${name} metrics envelope is invalid`);
    }
    const backlogCount = safeCounter(metrics.backlog_count, `${name} backlog`);
    const backlogBytes = safeCounter(metrics.backlog_bytes, `${name} bytes`);
    const oldestMessageTimestampMs = safeCounter(
      metrics.oldest_message_timestamp_ms,
      `${name} oldest message`,
    );
    queues.push({
      name,
      queueId,
      backlogCount,
      backlogBytes,
      oldestMessageTimestampMs,
      result:
        backlogCount === 0 &&
        backlogBytes === 0 &&
        oldestMessageTimestampMs === 0
          ? "vert"
          : "rouge",
    });
  }
  const authorityEnvelope = await jsonResponse(
    await fetchImpl(`${ORIGIN}/api/internal/v1/promotion/operational-state`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${input.operatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "promotion.operational-state@1",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
      }),
    }),
    "promotion authority state",
  );
  exact(
    authorityEnvelope,
    ["schema", "sourceSha", "stagingDeploymentId", "fixture", "authorities"],
    "promotion authority state",
  );
  if (
    authorityEnvelope.schema !== "punks.promotion-operational-state.v1" ||
    authorityEnvelope.sourceSha !== input.sourceSha ||
    authorityEnvelope.stagingDeploymentId !== input.stagingDeploymentId ||
    !Array.isArray(authorityEnvelope.authorities) ||
    JSON.stringify(
      authorityEnvelope.authorities.map(({ authority }) => authority),
    ) !== JSON.stringify(["api-workspace", "api-conversation"])
  ) {
    fail("promotion authority state identity is invalid");
  }
  const authorities = authorityEnvelope.authorities.map((authority, index) => {
    exact(
      authority,
      [
        "authority",
        "outboxesPending",
        "pendingArchives",
        "archiveSegments",
        "archiveHeadValid",
      ],
      `promotion authority ${index}`,
    );
    const outboxesPending = safeCounter(
      authority.outboxesPending,
      `${authority.authority} outboxes`,
    );
    const pendingArchives = safeCounter(
      authority.pendingArchives,
      `${authority.authority} archives`,
    );
    const archiveSegments = safeCounter(
      authority.archiveSegments,
      `${authority.authority} archive segments`,
    );
    if (typeof authority.archiveHeadValid !== "boolean") {
      fail(`${authority.authority} archive head is invalid`);
    }
    return {
      authority: authority.authority,
      outboxesPending,
      pendingArchives,
      archiveSegments,
      archiveHeadValid: authority.archiveHeadValid,
      result:
        outboxesPending === 0 &&
        pendingArchives === 0 &&
        authority.archiveHeadValid
          ? "vert"
          : "rouge",
    };
  });
  const prefix = operationalBudgetManifestPrefix(
    input.sourceSha,
    input.stagingDeploymentId,
  );
  const locks = [];
  for (const target of input.destinations) {
    const lock = await frontieres.cloudflare.lireVerrouillage({
      ...target,
      cle: prefix,
    });
    locks.push({
      role: target.role,
      bucket: target.bucket,
      prefix,
      result:
        lock?.mode === "compliance" && lock.actif === true ? "vert" : "rouge",
    });
  }
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("infrastructure observation clock is invalid");
  }
  const content = {
    schema: "punks.operational-infrastructure-proof.v1",
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    accountId: ACCOUNT_ID,
    origin: ORIGIN,
    queues,
    authorities,
    locks,
    observedAt: observedAt.toISOString(),
  };
  return { ...content, sha256: canonicalSha256(content) };
}

function parseArgs(argv) {
  const names = [
    "--source-sha",
    "--staging-deployment-id",
    "--operator-token-file",
    "--r2-primary",
    "--r2-recovery",
    "--output",
  ];
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (
      !names.includes(argv[index]) ||
      !argv[index + 1] ||
      values.has(argv[index])
    ) {
      fail("exact CLI arguments are required");
    }
    values.set(argv[index], argv[index + 1]);
  }
  if (values.size !== names.length) fail("exact CLI arguments are required");
  return (name) => values.get(name);
}

export async function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  const destinations = [
    destination("primaire", required("--r2-primary")),
    destination("secondaire", required("--r2-recovery")),
  ];
  const report = await collectOperationalInfrastructureProof(
    {
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      operatorToken: readStableEvidenceFile(
        required("--operator-token-file"),
        "operator token",
      )
        .toString("utf8")
        .trim(),
      cloudflareApiToken: process.env.PUNKS_CLOUDFLARE_API_TOKEN,
      destinations,
    },
    { frontieres: creerFrontiereLectureR2({ r2: destinations }) },
  );
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
