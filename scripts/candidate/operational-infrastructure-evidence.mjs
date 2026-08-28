import { canonicalSha256 } from "../migration-manifest-lib.mjs";

const QUEUES = [
  "punks-projection-staging",
  "punks-projection-staging-dlq",
  "punks-bot-wake-staging",
  "punks-bot-wake-staging-dlq",
];
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail(message) {
  throw new Error(`operational infrastructure evidence rejected: ${message}`);
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

function instant(value, label) {
  if (typeof value !== "string" || !INSTANT_RE.test(value)) {
    fail(`${label} is not a closed UTC instant`);
  }
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    fail(`${label} is invalid`);
  }
  return milliseconds;
}

/** Validates the closed provider-owned Queue, outbox, archive and lock report. */
export function validateOperationalInfrastructureReport(report, expected) {
  exact(
    report,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "accountId",
      "origin",
      "queues",
      "authorities",
      "r2Probe",
      "locks",
      "observedAt",
      "sha256",
    ],
    "infrastructure proof report",
  );
  const { sha256: digest, ...content } = report;
  if (
    report.schema !== "punks.operational-infrastructure-proof.v1" ||
    report.sourceSha !== expected.sourceSha ||
    report.stagingDeploymentId !== expected.stagingDeploymentId ||
    report.accountId !== "3a391620584c792dbbd8cfa148d7634a" ||
    report.origin !== "https://staging.punks.bot" ||
    digest !== canonicalSha256(content) ||
    !Array.isArray(report.queues) ||
    JSON.stringify(report.queues.map(({ name }) => name)) !==
      JSON.stringify(QUEUES) ||
    !Array.isArray(report.authorities) ||
    JSON.stringify(report.authorities.map(({ authority }) => authority)) !==
      JSON.stringify(["api-workspace", "api-conversation"]) ||
    !Array.isArray(report.locks) ||
    JSON.stringify(report.locks.map(({ role }) => role)) !==
      JSON.stringify(["primaire", "secondaire"]) ||
    !Number.isFinite(
      instant(report.observedAt, "infrastructure proof observedAt"),
    )
  ) {
    fail("infrastructure proof report identity is invalid");
  }
  for (const [index, queue] of report.queues.entries()) {
    exact(
      queue,
      [
        "name",
        "backlogCount",
        "backlogBytes",
        "oldestMessageTimestampMs",
        "result",
      ],
      `infrastructure queue ${index}`,
    );
    const counters = [
      queue.backlogCount,
      queue.backlogBytes,
      queue.oldestMessageTimestampMs,
    ];
    const green = counters.every((value) => value === 0);
    if (
      counters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      queue.result !== (green ? "vert" : "rouge")
    ) {
      fail(`infrastructure queue ${index} state is invalid`);
    }
  }
  exact(
    report.r2Probe,
    [
      "objects",
      "chainHeadSha256",
      "objectsValid",
      "duplicateWriteRejected",
      "result",
    ],
    "infrastructure R2 probe",
  );
  const r2Green =
    report.r2Probe.objects === 2 &&
    /^[0-9a-f]{64}$/u.test(report.r2Probe.chainHeadSha256 ?? "") &&
    report.r2Probe.objectsValid === true &&
    report.r2Probe.duplicateWriteRejected === true;
  if (report.r2Probe.result !== (r2Green ? "vert" : "rouge")) {
    fail("infrastructure R2 probe result is invalid");
  }
  for (const [index, authority] of report.authorities.entries()) {
    exact(
      authority,
      [
        "authority",
        "outboxesPending",
        "pendingArchives",
        "archiveSegments",
        "archiveHeadValid",
        "result",
      ],
      `infrastructure authority ${index}`,
    );
    const counters = [
      authority.outboxesPending,
      authority.pendingArchives,
      authority.archiveSegments,
    ];
    const green =
      authority.outboxesPending === 0 &&
      authority.pendingArchives === 0 &&
      authority.archiveHeadValid === true;
    if (
      counters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      typeof authority.archiveHeadValid !== "boolean" ||
      authority.result !== (green ? "vert" : "rouge")
    ) {
      fail(`infrastructure authority ${index} state is invalid`);
    }
  }
  for (const [index, lock] of report.locks.entries()) {
    exact(
      lock,
      ["role", "bucket", "prefix", "result"],
      `infrastructure R2 lock ${index}`,
    );
    if (
      typeof lock.bucket !== "string" ||
      lock.bucket.length === 0 ||
      typeof lock.prefix !== "string" ||
      !lock.prefix.startsWith(
        `operational-observations/tranche:1/${expected.sourceSha}/`,
      ) ||
      !["vert", "rouge"].includes(lock.result)
    ) {
      fail(`infrastructure R2 lock ${index} is invalid`);
    }
  }
  return report;
}
