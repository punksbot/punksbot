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
    typeof fetchImpl !== "function" ||
    typeof frontieres?.cloudflare?.lireVerrouillage !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and protected read boundaries are required");
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
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "fixture",
      "authorities",
      "queues",
      "r2Probe",
    ],
    "promotion authority state",
  );
  if (
    authorityEnvelope.schema !== "punks.promotion-operational-state.v1" ||
    authorityEnvelope.sourceSha !== input.sourceSha ||
    authorityEnvelope.stagingDeploymentId !== input.stagingDeploymentId ||
    !Array.isArray(authorityEnvelope.queues) ||
    JSON.stringify(authorityEnvelope.queues.map(({ name }) => name)) !==
      JSON.stringify(QUEUES) ||
    !Array.isArray(authorityEnvelope.authorities) ||
    JSON.stringify(
      authorityEnvelope.authorities.map(({ authority }) => authority),
    ) !== JSON.stringify(["api-workspace", "api-conversation"])
  ) {
    fail("promotion authority state identity is invalid");
  }
  const queues = authorityEnvelope.queues.map((queue, index) => {
    exact(
      queue,
      [
        "name",
        "backlogCount",
        "backlogBytes",
        "oldestMessageTimestampMs",
        "result",
      ],
      `promotion queue ${index}`,
    );
    const backlogCount = safeCounter(
      queue.backlogCount,
      `${queue.name} backlog`,
    );
    const backlogBytes = safeCounter(queue.backlogBytes, `${queue.name} bytes`);
    const oldestMessageTimestampMs = safeCounter(
      queue.oldestMessageTimestampMs,
      `${queue.name} oldest message`,
    );
    const green =
      backlogCount === 0 &&
      backlogBytes === 0 &&
      oldestMessageTimestampMs === 0;
    if (queue.result !== (green ? "vert" : "rouge")) {
      fail(`promotion queue ${index} result is invalid`);
    }
    return {
      name: queue.name,
      backlogCount,
      backlogBytes,
      oldestMessageTimestampMs,
      result: queue.result,
    };
  });
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
  exact(
    authorityEnvelope.r2Probe,
    [
      "objects",
      "chainHeadSha256",
      "objectsValid",
      "duplicateWriteRejected",
      "result",
    ],
    "promotion R2 probe",
  );
  const r2Probe = authorityEnvelope.r2Probe;
  const r2Green =
    r2Probe.objects === 2 &&
    /^[0-9a-f]{64}$/u.test(r2Probe.chainHeadSha256 ?? "") &&
    r2Probe.objectsValid === true &&
    r2Probe.duplicateWriteRejected === true;
  if (r2Probe.result !== (r2Green ? "vert" : "rouge")) {
    fail("promotion R2 probe result is invalid");
  }
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
    r2Probe,
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
