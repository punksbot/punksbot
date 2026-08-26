import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  validateOperationalBudgetVerdicts,
  validateOperationalTopology,
} from "../release-graph-lib.mjs";
import { operationalEvidenceDigests } from "./operational-release-evidence.mjs";
import { validateOperationalBudgetEvidence } from "./operational-budget-evidence.mjs";
import { buildOperationalTopology } from "./operational-topology.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY = "punksbot/punksbot";
const WORKFLOW_PATH = ".github/workflows/punks-desktop-candidate.yml";
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const TOKEN_RE = /^[A-Za-z0-9_=-]{20,512}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

const STEP_BINDINGS = Object.freeze([
  Object.freeze({
    step: "E0",
    jobName: "Secretless candidate gates",
    stepName: "Execute every secretless Punks candidate gate",
  }),
  Object.freeze({
    step: "E1",
    jobName: "Bind the exact remote staging deployment",
    stepName: "Reobserve all seven Workers through the Cloudflare API",
  }),
  Object.freeze({
    step: "E2",
    jobName: "Bind the exact remote staging deployment",
    stepName: "Prove distributed FOLLOW against the exact staging",
  }),
  Object.freeze({
    step: "E3",
    jobName: "Bind the exact remote staging deployment",
    stepName:
      "Prove real provider authentication against the exact Auth Worker",
  }),
  Object.freeze({
    step: "E4",
    jobName: "Bind the exact remote staging deployment",
    stepName: "Upload the exact remote staging proof",
  }),
  Object.freeze({
    step: "A0",
    jobName: "Aggregate four verified legs",
    stepName: "Download all four attested platform legs",
  }),
  Object.freeze({
    step: "A1",
    jobName: "Aggregate four verified legs",
    stepName: "Build closed aggregate and immutable staging latest.json",
  }),
  Object.freeze({
    step: "A2",
    jobName: "Aggregate four verified legs",
    stepName: "Complete the content-addressed promotion evidence",
  }),
  Object.freeze({
    step: "A3",
    jobName: "Aggregate four verified legs",
    stepName: "Validate the promotion dossier and emit its local pair",
  }),
  Object.freeze({
    step: "A4",
    jobName: "Publish immutable T1 proofs and activate the verified candidate",
    stepName: "Publish the immutable attestation and Receipt",
  }),
]);
const STEP_NAMES = Object.freeze(STEP_BINDINGS.map(({ step }) => step));

function fail(message) {
  throw new Error(`GitHub cadence observation rejected: ${message}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is invalid`);
  return value;
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function instant(value, label) {
  const milliseconds = Date.parse(value ?? "");
  if (!Number.isFinite(milliseconds)) fail(`${label} is invalid`);
  return { milliseconds, canonical: new Date(milliseconds).toISOString() };
}

function sampleCounts(dossier, publicationResult) {
  const accessibility = Array.isArray(dossier?.accessibilite)
    ? dossier.accessibilite.reduce(
        (count, platform) =>
          count + Object.keys(platform?.matrice ?? {}).length,
        0,
      )
    : 0;
  const values = {
    E0: Object.keys(dossier?.gates ?? {}).length,
    E1: dossier?.liaison?.staging?.workers?.length ?? 0,
    E2: dossier?.parcours?.executions?.length ?? 0,
    E3: accessibility,
    E4:
      (dossier?.recuperation?.scenarios?.length ?? 0) +
      (dossier?.retrait?.["verdicts-executes"] ?? 0),
    A0: dossier?.liaison?.artefacts?.length ?? 0,
    A1: dossier?.parcours?.executions?.length ?? 0,
    A2: dossier?.fautes?.length ?? 0,
    A3:
      Object.keys(dossier?.scans ?? {}).length +
      (dossier?.goldens?.length ?? 0),
    A4: publicationResult?.objets?.length ?? 0,
  };
  for (const [step, value] of Object.entries(values)) {
    positiveInteger(value, `${step} sample count`);
  }
  return values;
}

function exactRun(input, run) {
  if (
    run?.id !== input.runId ||
    run.run_attempt !== input.runAttempt ||
    run.event !== "workflow_dispatch" ||
    run.head_sha !== input.sourceSha ||
    run.path !== WORKFLOW_PATH ||
    !["in_progress", "completed"].includes(run.status) ||
    (run.status === "completed" && run.conclusion !== "success") ||
    (run.status === "in_progress" && run.conclusion !== null) ||
    run.html_url !==
      `https://github.com/${input.repository}/actions/runs/${input.runId}`
  ) {
    fail("current workflow run identity or state diverges");
  }
}

function actionStep(input, jobs, binding) {
  const matchingJobs = jobs.filter(({ name }) => name === binding.jobName);
  if (matchingJobs.length !== 1) {
    fail(`${binding.step} Actions job is missing or ambiguous`);
  }
  const job = matchingJobs[0];
  if (
    job.run_attempt !== input.runAttempt ||
    !Number.isSafeInteger(job.id) ||
    typeof job.html_url !== "string" ||
    !job.html_url.startsWith(
      `https://github.com/${input.repository}/actions/runs/${input.runId}/job/`,
    )
  ) {
    fail(`${binding.step} Actions job identity diverges`);
  }
  const matches = (job.steps ?? []).filter(
    ({ name }) => name === binding.stepName,
  );
  if (matches.length !== 1) {
    fail(`${binding.step} Actions step is missing or ambiguous`);
  }
  const selected = matches[0];
  if (
    selected.status !== "completed" ||
    selected.conclusion !== "success" ||
    !Number.isSafeInteger(selected.number) ||
    selected.number < 1
  ) {
    fail(`${binding.step} Actions step is not completed successfully`);
  }
  const started = instant(selected.started_at, `${binding.step} start`);
  const completed = instant(selected.completed_at, `${binding.step} end`);
  if (completed.milliseconds <= started.milliseconds) {
    fail(`${binding.step} Actions step has no positive observed segment`);
  }
  return {
    milliseconds: { start: started.milliseconds, end: completed.milliseconds },
    reference: {
      runId: input.runId,
      runAttempt: input.runAttempt,
      jobId: job.id,
      jobName: job.name,
      jobUrl: job.html_url,
      stepNumber: selected.number,
      stepName: selected.name,
      conclusion: selected.conclusion,
      startedAt: started.canonical,
      completedAt: completed.canonical,
    },
  };
}

function validateBudgetObservation(value, expected, budgetExportRoot) {
  if (
    !exactKeys(value, [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "connectionMethods",
      "verdicts",
      "bookmarks",
      "dlq",
      "outboxes",
      "incidents",
      "observedAt",
      "sha256",
    ]) ||
    value.schema !== "punks.operational-budget-observation.v1" ||
    value.sourceSha !== expected.sourceSha ||
    value.stagingDeploymentId !== expected.stagingDeploymentId ||
    JSON.stringify(value.connectionMethods) !==
      JSON.stringify(expected.connectionMethods) ||
    !Array.isArray(value.bookmarks) ||
    value.bookmarks.length < 1 ||
    value.bookmarks.some(
      (bookmark) =>
        !exactKeys(bookmark, ["autorite", "valeur"]) ||
        typeof bookmark.autorite !== "string" ||
        bookmark.autorite.length === 0 ||
        typeof bookmark.valeur !== "string" ||
        bookmark.valeur.length === 0,
    ) ||
    !exactKeys(value.dlq, ["messages", "export-sha256"]) ||
    value.dlq.messages !== 0 ||
    !SHA256_RE.test(value.dlq["export-sha256"] ?? "") ||
    !exactKeys(value.outboxes, ["en-attente", "export-sha256"]) ||
    value.outboxes["en-attente"] !== 0 ||
    !SHA256_RE.test(value.outboxes["export-sha256"] ?? "") ||
    !Array.isArray(value.incidents) ||
    value.incidents.length !== 0 ||
    !Number.isFinite(Date.parse(value.observedAt ?? ""))
  ) {
    fail("exact operational budget observation is required");
  }
  const { sha256, ...content } = value;
  if (
    !SHA256_RE.test(sha256 ?? "") ||
    sha256 !== canonicalSha256(content) ||
    validateOperationalBudgetVerdicts(value.verdicts, {
      connectionMethods: value.connectionMethods,
    }).length !== 0
  ) {
    fail("all 36 canonical operational budgets must be observed green");
  }
  try {
    validateOperationalBudgetEvidence({
      observation: value,
      root: budgetExportRoot,
      candidateRoot: expected.candidateRoot,
      sourceSha: expected.sourceSha,
      stagingDeploymentId: expected.stagingDeploymentId,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return value;
}

/**
 * Revalidates serialized cadence bytes before they can be copied into signed
 * Receipts. This intentionally trusts no WeakSet or process-local marker.
 */
export function validateGithubCadenceObservation(
  observation,
  {
    sourceSha,
    stagingDeploymentId,
    proofDigests,
    budgetExportRoot,
    candidateRoot,
  },
) {
  if (
    !exactKeys(observation, [
      "schema",
      "repository",
      "sourceSha",
      "stagingDeploymentId",
      "run",
      "proofDigests",
      "topology",
      "topologySha256",
      "budgets",
      "budgetsSha256",
      "steps",
      "observedAt",
    ]) ||
    observation.schema !== "punks.github-cadence-observation.v1" ||
    observation.repository !== REPOSITORY ||
    observation.sourceSha !== sourceSha ||
    !exactKeys(observation.run, [
      "id",
      "attempt",
      "event",
      "workflow",
      "headSha",
      "url",
    ]) ||
    !Number.isSafeInteger(observation.run.id) ||
    observation.run.id < 1 ||
    !Number.isSafeInteger(observation.run.attempt) ||
    observation.run.attempt < 1 ||
    observation.run.event !== "workflow_dispatch" ||
    observation.run.workflow !== WORKFLOW_PATH ||
    observation.run.headSha !== sourceSha ||
    observation.run.url !==
      `https://github.com/${REPOSITORY}/actions/runs/${observation.run.id}` ||
    !exactKeys(observation.proofDigests, STEP_NAMES) ||
    STEP_NAMES.some(
      (step) =>
        !SHA256_RE.test(observation.proofDigests[step] ?? "") ||
        observation.proofDigests[step] !== proofDigests[step],
    ) ||
    !SHA256_RE.test(observation.topologySha256 ?? "") ||
    observation.topologySha256 !== canonicalSha256(observation.topology) ||
    validateOperationalTopology(observation.topology).length !== 0 ||
    !SHA256_RE.test(observation.budgetsSha256 ?? "") ||
    observation.budgetsSha256 !== canonicalSha256(observation.budgets) ||
    !exactKeys(observation.steps, STEP_NAMES) ||
    JSON.stringify(Object.keys(observation.steps)) !==
      JSON.stringify(STEP_NAMES)
  ) {
    fail("exact GitHub cadence observation is required");
  }
  const observedAt = instant(observation.observedAt, "observation timestamp");
  validateBudgetObservation(
    observation.budgets,
    {
      sourceSha,
      stagingDeploymentId,
      connectionMethods: observation.topology["moyens-connexion"],
      candidateRoot,
    },
    budgetExportRoot,
  );
  if (Date.parse(observation.budgets.observedAt) > observedAt.milliseconds) {
    fail("budget observation is newer than the GitHub cadence observation");
  }
  let previousEnd = null;
  const references = new Set();
  for (const step of STEP_NAMES) {
    const value = observation.steps[step];
    if (
      !exactKeys(value, [
        "startedAt",
        "closedAt",
        "result",
        "sampleCount",
        "actionsSteps",
        "evidenceSha256",
        "topologySha256",
        "budgetsSha256",
      ]) ||
      value.result !== "vert" ||
      !Number.isSafeInteger(value.sampleCount) ||
      value.sampleCount < 1 ||
      value.evidenceSha256 !== proofDigests[step] ||
      value.topologySha256 !== observation.topologySha256 ||
      value.budgetsSha256 !== observation.budgetsSha256 ||
      !Array.isArray(value.actionsSteps) ||
      value.actionsSteps.length !== 1
    ) {
      fail(`cadence observation ${step} is incomplete or not green`);
    }
    const started = instant(value.startedAt, `${step} observation start`);
    const closed = instant(value.closedAt, `${step} observation end`);
    if (
      closed.milliseconds <= started.milliseconds ||
      (previousEnd !== null && started.milliseconds < previousEnd)
    ) {
      fail(`cadence observation ${step} is not a positive ordered segment`);
    }
    previousEnd = closed.milliseconds;
    const reference = value.actionsSteps[0];
    if (
      !exactKeys(reference, [
        "runId",
        "runAttempt",
        "jobId",
        "jobName",
        "jobUrl",
        "stepNumber",
        "stepName",
        "conclusion",
        "startedAt",
        "completedAt",
      ]) ||
      reference.runId !== observation.run.id ||
      reference.runAttempt !== observation.run.attempt ||
      !Number.isSafeInteger(reference.jobId) ||
      reference.jobId < 1 ||
      !Number.isSafeInteger(reference.stepNumber) ||
      reference.stepNumber < 1 ||
      typeof reference.jobName !== "string" ||
      reference.jobName.length === 0 ||
      typeof reference.stepName !== "string" ||
      reference.stepName.length === 0 ||
      reference.jobUrl !== `${observation.run.url}/job/${reference.jobId}` ||
      reference.conclusion !== "success" ||
      reference.startedAt !== started.canonical ||
      reference.completedAt !== closed.canonical
    ) {
      fail(
        `cadence observation ${step} has no exact successful Actions reference`,
      );
    }
    const identity = `${reference.jobId}:${reference.stepNumber}`;
    if (references.has(identity)) {
      fail(`cadence observation ${step} reuses an Actions reference`);
    }
    references.add(identity);
  }
  if (previousEnd !== null && observedAt.milliseconds < previousEnd) {
    fail("GitHub cadence observation predates its final step");
  }
  return observation;
}

/** Read-only GitHub REST adapter for one immutable workflow attempt. */
export function createGithubActionsBoundary({
  token,
  fetchImpl = globalThis.fetch,
}) {
  if (!TOKEN_RE.test(token ?? "") || typeof fetchImpl !== "function") {
    fail("bounded GitHub Actions credential and fetch boundary are required");
  }
  const request = async (path) => {
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response?.ok) {
      fail(
        `GitHub Actions returned HTTP ${String(response?.status ?? "unknown")}`,
      );
    }
    const contentType = response.headers?.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
      fail("GitHub Actions returned a non-JSON response");
    }
    try {
      return await response.json();
    } catch {
      fail("GitHub Actions returned invalid JSON");
    }
  };
  const path = ({ repository, runId, runAttempt }) => {
    if (
      repository !== REPOSITORY ||
      !Number.isSafeInteger(runId) ||
      runId < 1 ||
      !Number.isSafeInteger(runAttempt) ||
      runAttempt < 1
    ) {
      fail("exact GitHub run attempt coordinates are required");
    }
    return `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
  };
  return {
    async readRun(input) {
      return request(path(input));
    },
    async readJobs(input) {
      const root = path(input);
      const jobs = [];
      let total = null;
      for (let page = 1; page <= 100; page += 1) {
        const envelope = await request(
          `${root}/jobs?per_page=100&page=${page}`,
        );
        if (
          !Number.isSafeInteger(envelope?.total_count) ||
          envelope.total_count < 0 ||
          !Array.isArray(envelope.jobs)
        ) {
          fail("GitHub Actions jobs envelope is invalid");
        }
        if (total === null) total = envelope.total_count;
        if (envelope.total_count !== total) {
          fail("GitHub Actions job count changed during observation");
        }
        jobs.push(...envelope.jobs);
        if (jobs.length >= total) break;
        if (envelope.jobs.length !== 100) {
          fail("GitHub Actions jobs pagination ended early");
        }
      }
      if (total === null || jobs.length !== total) {
        fail("GitHub Actions jobs pagination is incomplete");
      }
      return jobs;
    },
  };
}

/**
 * Reads the current GitHub Actions run and turns only completed remote steps
 * into the ten ordered promotion observations consumed by the signed head.
 */
export async function observeGithubCadence(input, { github, now }) {
  if (
    input?.repository !== REPOSITORY ||
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "")
  ) {
    fail("exact Punks repository, source and staging deployment are required");
  }
  positiveInteger(input.runId, "run ID");
  positiveInteger(input.runAttempt, "run attempt");
  if (
    typeof github?.readRun !== "function" ||
    typeof github?.readJobs !== "function" ||
    typeof now !== "function"
  ) {
    fail("GitHub Actions observation boundary is unavailable");
  }
  const coordinates = {
    repository: input.repository,
    runId: input.runId,
    runAttempt: input.runAttempt,
  };
  const run = await github.readRun(coordinates);
  exactRun(input, run);
  const jobs = await github.readJobs(coordinates);
  if (!Array.isArray(jobs)) fail("Actions jobs are unavailable");
  const evidence = operationalEvidenceDigests(
    input.dossier,
    input.publicationResult,
  );
  const topology = buildOperationalTopology({
    dossier: input.dossier,
    topologyObservation: input.topologyObservation,
  });
  const topologySha256 = canonicalSha256(topology);
  const budgets = validateBudgetObservation(
    input.budgetObservation,
    {
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      connectionMethods: topology["moyens-connexion"],
      candidateRoot: input.candidateRoot,
    },
    input.budgetExportRoot,
  );
  const budgetsSha256 = canonicalSha256(budgets);
  const samples = sampleCounts(input.dossier, input.publicationResult);
  const steps = {};
  let previousEnd = null;
  const usedReferences = new Set();
  for (const binding of STEP_BINDINGS) {
    const observed = actionStep(input, jobs, binding);
    if (previousEnd !== null && observed.milliseconds.start < previousEnd) {
      fail(`${binding.step} overlaps or precedes the prior cadence step`);
    }
    previousEnd = observed.milliseconds.end;
    const identity = `${observed.reference.jobId}:${observed.reference.stepNumber}`;
    if (usedReferences.has(identity)) {
      fail(`${binding.step} reuses another cadence Actions step`);
    }
    usedReferences.add(identity);
    steps[binding.step] = {
      startedAt: observed.reference.startedAt,
      closedAt: observed.reference.completedAt,
      result: "vert",
      sampleCount: samples[binding.step],
      actionsSteps: [observed.reference],
      evidenceSha256: evidence[binding.step],
      topologySha256,
      budgetsSha256,
    };
  }
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("observation clock is invalid");
  }
  if (previousEnd !== null && observedAt.getTime() < previousEnd) {
    fail("observation predates its last completed Actions step");
  }
  const observation = {
    schema: "punks.github-cadence-observation.v1",
    repository: input.repository,
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    run: {
      id: run.id,
      attempt: run.run_attempt,
      event: run.event,
      workflow: run.path,
      headSha: run.head_sha,
      url: run.html_url,
    },
    proofDigests: evidence,
    topology,
    topologySha256,
    budgets,
    budgetsSha256,
    steps,
    observedAt: observedAt.toISOString(),
  };
  return validateGithubCadenceObservation(observation, {
    sourceSha: input.sourceSha,
    stagingDeploymentId: input.stagingDeploymentId,
    proofDigests: evidence,
    budgetExportRoot: input.budgetExportRoot,
    candidateRoot: input.candidateRoot,
  });
}

function parseArguments(argv) {
  const expected = new Set([
    "--dossier",
    "--publication-result",
    "--budget-observation",
    "--budget-exports",
    "--candidate-root",
    "--topology-observation",
    "--repository",
    "--run-id",
    "--run-attempt",
    "--source-sha",
    "--staging-deployment-id",
    "--output",
  ]);
  if (!Array.isArray(argv) || argv.length !== expected.size * 2) {
    fail("exact CLI arguments are required");
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !expected.has(flag) ||
      values.has(flag) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      fail("exact CLI arguments are required");
    }
    values.set(flag, value);
  }
  return (name) => values.get(name);
}

function jsonFile(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size > 64 * 1024 * 1024
  ) {
    fail(`${label} must be one bounded regular file`);
  }
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    fail(`${label} is invalid JSON`);
  }
}

/** Exact CLI used by the protected publisher job. */
export async function run(
  argv = process.argv.slice(2),
  {
    github = createGithubActionsBoundary({
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    }),
    now = () => new Date(),
  } = {},
) {
  const required = parseArguments(argv);
  const runId = Number(required("--run-id"));
  const runAttempt = Number(required("--run-attempt"));
  const observation = await observeGithubCadence(
    {
      repository: required("--repository"),
      runId,
      runAttempt,
      sourceSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      dossier: jsonFile(required("--dossier"), "promotion dossier"),
      publicationResult: jsonFile(
        required("--publication-result"),
        "promotion publication result",
      ),
      budgetObservation: jsonFile(
        required("--budget-observation"),
        "operational budget observation",
      ),
      budgetExportRoot: resolve(required("--budget-exports")),
      candidateRoot: resolve(required("--candidate-root")),
      topologyObservation: jsonFile(
        required("--topology-observation"),
        "remote operational topology observation",
      ),
    },
    { github, now },
  );
  writeFileSync(
    resolve(required("--output")),
    `${JSON.stringify(observation, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return observation;
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
