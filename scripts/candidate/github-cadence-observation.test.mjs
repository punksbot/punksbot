import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { dossierValide } from "../promotion-dossier-validator-fixture.mjs";
import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
  PLATEFORMES,
  validateOperationalBudgetVerdicts,
  validateOperationalTopology,
} from "../release-graph-lib.mjs";
import { operationalEvidenceDigests } from "./operational-release-head.mjs";
import {
  createGithubActionsBoundary,
  observeGithubCadence,
  run,
} from "./github-cadence-observation.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const repository = "punksbot/punksbot";
const runId = 328_000_058;
const runAttempt = 2;
const publicationResult = {
  objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
};

const bindings = [
  [
    "E0",
    "Secretless candidate gates",
    "Execute every secretless Punks candidate gate",
  ],
  [
    "E1",
    "Bind the exact remote staging deployment",
    "Reobserve all seven Workers through the Cloudflare API",
  ],
  [
    "E2",
    "Bind the exact remote staging deployment",
    "Prove distributed FOLLOW against the exact staging",
  ],
  [
    "E3",
    "Bind the exact remote staging deployment",
    "Prove real provider authentication against the exact Auth Worker",
  ],
  [
    "E4",
    "Bind the exact remote staging deployment",
    "Upload the exact remote staging proof",
  ],
  [
    "A0",
    "Aggregate four verified legs",
    "Download all four attested platform legs",
  ],
  [
    "A1",
    "Aggregate four verified legs",
    "Build closed aggregate and immutable staging latest.json",
  ],
  [
    "A2",
    "Aggregate four verified legs",
    "Complete the content-addressed promotion evidence",
  ],
  [
    "A3",
    "Aggregate four verified legs",
    "Validate the promotion dossier and emit its local pair",
  ],
  [
    "A4",
    "Publish immutable T1 proofs and activate the verified candidate",
    "Publish the immutable attestation and Receipt",
  ],
];

function githubObservation() {
  let minute = 0;
  const jobs = [];
  const byName = new Map();
  for (const [, jobName, stepName] of bindings) {
    let job = byName.get(jobName);
    if (job === undefined) {
      job = {
        id: 9000 + jobs.length,
        name: jobName,
        status: jobName.startsWith("Publish ") ? "in_progress" : "completed",
        conclusion: jobName.startsWith("Publish ") ? null : "success",
        html_url: `https://github.com/${repository}/actions/runs/${runId}/job/${9000 + jobs.length}`,
        run_attempt: runAttempt,
        steps: [],
      };
      byName.set(jobName, job);
      jobs.push(job);
    }
    const startedAt = `2026-08-26T20:${String(minute).padStart(2, "0")}:00Z`;
    minute += 1;
    const completedAt = `2026-08-26T20:${String(minute).padStart(2, "0")}:00Z`;
    minute += 1;
    job.steps.push({
      number: job.steps.length + 1,
      name: stepName,
      status: "completed",
      conclusion: "success",
      started_at: startedAt,
      completed_at: completedAt,
    });
  }
  return {
    run: {
      id: runId,
      run_attempt: runAttempt,
      event: "workflow_dispatch",
      head_sha: sourceSha,
      path: ".github/workflows/punks-desktop-candidate.yml",
      status: "in_progress",
      conclusion: null,
      html_url: `https://github.com/${repository}/actions/runs/${runId}`,
    },
    jobs,
  };
}

function budgetObservation() {
  const sampleCount = 1_000_000;
  const connectionMethods = ["google", "github", "passkey"];
  const statistic = (budget, suffix) => ({
    mesure: 0,
    "borne-superieure-unilaterale-95":
      budget.unite === "pourcentage"
        ? borneWilsonUnilaterale95(0, sampleCount)
        : 0,
    echantillons: sampleCount,
    numerateur: budget.unite === "millisecondes" ? null : 0,
    denominateur: budget.unite === "pourcentage" ? sampleCount : null,
    methode:
      budget.unite === "pourcentage"
        ? "wilson-unilaterale-95"
        : budget.unite === "occurrences"
          ? "tolerance-zero"
          : "quantile-export-verifie",
    "baseline-n-1": {
      disponible: false,
      "mesure-n-1": null,
      "export-n-1-sha256": null,
      "regression-pourcentage": null,
      "justification-acceptee": false,
      "justification-sha256": null,
    },
    resultat: "vert",
    "export-sha256": canonicalSha256({ budget: budget.nom, suffix }),
  });
  const verdicts = BUDGETS_PRODUCTION.map((budget) => {
    const dimensions =
      budget.nom === "connexion-desktop-echecs-par-moyen"
        ? connectionMethods
        : budget.nom === "desktop-sessions-avec-crash-par-plateforme"
          ? PLATEFORMES
          : [];
    return {
      nom: budget.nom,
      unite: budget.unite,
      "budget-max": budget.maximum,
      ...statistic(budget, "aggregate"),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        ...statistic(budget, dimension),
      })),
    };
  });
  const content = {
    schema: "punks.operational-budget-observation.v1",
    sourceSha,
    stagingDeploymentId,
    connectionMethods,
    verdicts,
    bookmarks: [
      { autorite: "cloudflare-staging", valeur: stagingDeploymentId },
    ],
    dlq: { messages: 0, "export-sha256": canonicalSha256({ dlq: 0 }) },
    outboxes: {
      "en-attente": 0,
      "export-sha256": canonicalSha256({ outboxes: 0 }),
    },
    incidents: [],
    observedAt: "2026-08-26T20:19:59.000Z",
  };
  return { ...content, sha256: canonicalSha256(content) };
}

test("observes ten successful cadence steps from the exact current Actions run", async () => {
  const dossier = dossierValide({
    candidat: { sha: sourceSha, tranche: 1 },
    liaison: {
      ...dossierValide().liaison,
      staging: {
        ...dossierValide().liaison.staging,
        deploiement: stagingDeploymentId,
      },
    },
  });
  const remote = githubObservation();
  const calls = [];
  const observation = await observeGithubCadence(
    {
      repository,
      runId,
      runAttempt,
      sourceSha,
      stagingDeploymentId,
      dossier,
      publicationResult,
      budgetObservation: budgetObservation(),
    },
    {
      github: {
        async readRun(input) {
          calls.push(["run", input]);
          return remote.run;
        },
        async readJobs(input) {
          calls.push(["jobs", input]);
          return remote.jobs;
        },
      },
      now: () => new Date("2026-08-26T20:20:00Z"),
    },
  );

  assert.deepEqual(calls, [
    ["run", { repository, runId, runAttempt }],
    ["jobs", { repository, runId, runAttempt }],
  ]);
  assert.equal(observation.schema, "punks.github-cadence-observation.v1");
  assert.equal(observation.sourceSha, sourceSha);
  assert.equal(observation.stagingDeploymentId, stagingDeploymentId);
  assert.equal(observation.run.id, runId);
  assert.equal(observation.run.attempt, runAttempt);
  assert.equal(observation.run.headSha, sourceSha);
  assert.equal(observation.observedAt, "2026-08-26T20:20:00.000Z");
  assert.deepEqual(validateOperationalTopology(observation.topology), []);
  assert.equal(
    observation.topologySha256,
    canonicalSha256(observation.topology),
  );
  assert.equal(Object.keys(observation.topology.inventaire).length, 10);
  assert.deepEqual(observation.topology["moyens-connexion"], [
    "google",
    "github",
    "passkey",
  ]);
  assert.equal(observation.budgets.verdicts.length, 36);
  assert.deepEqual(
    validateOperationalBudgetVerdicts(observation.budgets.verdicts, {
      connectionMethods: observation.budgets.connectionMethods,
    }),
    [],
  );
  assert.equal(observation.budgetsSha256, canonicalSha256(observation.budgets));
  assert.deepEqual(
    Object.keys(observation.steps),
    bindings.map(([step]) => step),
  );
  const evidence = operationalEvidenceDigests(dossier, publicationResult);
  for (const [index, [step, jobName, stepName]] of bindings.entries()) {
    const actual = observation.steps[step];
    assert.equal(actual.result, "vert");
    assert.equal(actual.evidenceSha256, evidence[step]);
    assert.equal(
      actual.startedAt,
      `2026-08-26T20:${String(index * 2).padStart(2, "0")}:00.000Z`,
    );
    assert.equal(
      actual.closedAt,
      `2026-08-26T20:${String(index * 2 + 1).padStart(2, "0")}:00.000Z`,
    );
    assert.deepEqual(actual.actionsSteps, [
      {
        runId,
        runAttempt,
        jobId: remote.jobs.find(({ name }) => name === jobName).id,
        jobName,
        jobUrl: remote.jobs.find(({ name }) => name === jobName).html_url,
        stepNumber: remote.jobs
          .find(({ name }) => name === jobName)
          .steps.find(({ name }) => name === stepName).number,
        stepName,
        conclusion: "success",
        startedAt: actual.startedAt,
        completedAt: actual.closedAt,
      },
    ]);
    assert.ok(actual.sampleCount > 0);
  }
});

test("reads one exact run attempt and all of its jobs through the versioned GitHub API", async () => {
  const calls = [];
  const boundary = createGithubActionsBoundary({
    token: "github-actions-token-for-tests",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith(`/attempts/${runAttempt}`)) {
        return Response.json({ id: runId, run_attempt: runAttempt });
      }
      if (url.endsWith(`/attempts/${runAttempt}/jobs?per_page=100&page=1`)) {
        return Response.json({
          total_count: 101,
          jobs: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
        });
      }
      if (url.endsWith(`/attempts/${runAttempt}/jobs?per_page=100&page=2`)) {
        return Response.json({ total_count: 101, jobs: [{ id: 101 }] });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const coordinates = { repository, runId, runAttempt };
  assert.deepEqual(await boundary.readRun(coordinates), {
    id: runId,
    run_attempt: runAttempt,
  });
  const jobs = await boundary.readJobs(coordinates);
  assert.equal(jobs.length, 101);
  assert.deepEqual(jobs[0], { id: 1 });
  assert.deepEqual(jobs.at(-1), { id: 101 });
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.deepEqual(init.headers, {
      accept: "application/vnd.github+json",
      authorization: "Bearer github-actions-token-for-tests",
      "x-github-api-version": "2026-03-10",
    });
  }
});

test("the CLI writes one create-only observation from the current run boundary", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-github-cadence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dossierPath = join(root, "dossier.json");
  const publicationPath = join(root, "publication.json");
  const output = join(root, "observation.json");
  const base = dossierValide();
  const dossier = dossierValide({
    candidat: { sha: sourceSha, tranche: 1 },
    liaison: {
      ...base.liaison,
      staging: {
        ...base.liaison.staging,
        deploiement: stagingDeploymentId,
      },
    },
  });
  writeFileSync(dossierPath, JSON.stringify(dossier));
  writeFileSync(publicationPath, JSON.stringify(publicationResult));
  const budgetPath = join(root, "budgets.json");
  writeFileSync(budgetPath, JSON.stringify(budgetObservation()));
  const remote = githubObservation();
  const observation = await run(
    [
      "--dossier",
      dossierPath,
      "--publication-result",
      publicationPath,
      "--budget-observation",
      budgetPath,
      "--repository",
      repository,
      "--run-id",
      String(runId),
      "--run-attempt",
      String(runAttempt),
      "--source-sha",
      sourceSha,
      "--staging-deployment-id",
      stagingDeploymentId,
      "--output",
      output,
    ],
    {
      github: {
        async readRun() {
          return remote.run;
        },
        async readJobs() {
          return remote.jobs;
        },
      },
      now: () => new Date("2026-08-26T20:20:00Z"),
    },
  );
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), observation);
  await assert.rejects(
    run(
      [
        "--dossier",
        dossierPath,
        "--publication-result",
        publicationPath,
        "--budget-observation",
        budgetPath,
        "--repository",
        repository,
        "--run-id",
        String(runId),
        "--run-attempt",
        String(runAttempt),
        "--source-sha",
        sourceSha,
        "--staging-deployment-id",
        stagingDeploymentId,
        "--output",
        output,
      ],
      {
        github: {
          async readRun() {
            return remote.run;
          },
          async readJobs() {
            return remote.jobs;
          },
        },
        now: () => new Date("2026-08-26T20:20:00Z"),
      },
    ),
    /EEXIST|exist/i,
  );
});
