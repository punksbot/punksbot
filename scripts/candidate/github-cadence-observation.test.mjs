import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  validateGithubCadenceObservation,
} from "./github-cadence-observation.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const repository = "punksbot/punksbot";
const runId = 328_000_058;
const runAttempt = 2;
const publicationResult = {
  objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
};
const verifyProviderSubject = () => [{ verified: true }];

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

function prepareCandidateRoot(candidateRoot) {
  const sources = join(candidateRoot, "operational-budget-sources");
  mkdirSync(sources, { recursive: true });
  const provenanceRoot = join(candidateRoot, "operational-budget-provenance");
  mkdirSync(provenanceRoot);
  const bundle = Buffer.from(
    `${JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      dsseEnvelope: {
        payload: Buffer.from("budget provenance").toString("base64"),
        signatures: [{ sig: Buffer.from("signature").toString("base64") }],
      },
      verificationMaterial: {},
    })}\n`,
  );
  const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
  writeFileSync(join(provenanceRoot, `${bundleSha256}.sigstore.json`), bundle);
  writeFileSync(
    join(candidateRoot, "operational-budget-provenance.json"),
    `${JSON.stringify({
      schema: "punks.operational-budget-provenance.v1",
      sourceSha,
      stagingDeploymentId,
      repository,
      sourceRef: "refs/heads/staging",
      signerWorkflow:
        "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml",
      bundle: {
        path: `operational-budget-provenance/${bundleSha256}.sigstore.json`,
        sha256: bundleSha256,
      },
    })}\n`,
  );
  return sources;
}

function topologyObservation(dossier) {
  const content = {
    schema: "punks.operational-topology-observation.v1",
    accountId: "3a391620584c792dbbd8cfa148d7634a",
    sourceSha,
    stagingDeploymentId,
    workers: dossier.liaison.staging.workers,
    workflows: [
      {
        name: "punks-bot-wake-staging",
        id: "workflow-staging-id",
        scriptName: "punks-bot-runtime-staging",
        className: "BotWakeWorkflow",
        versionId: "workflow-version-id",
        createdOn: "2026-08-26T19:00:00.000Z",
        modifiedOn: "2026-08-26T19:01:00.000Z",
        versionCreatedOn: "2026-08-26T19:01:00.000Z",
      },
    ],
    securityGenerations: {
      compatibility: 1,
      operatorProvisioning: 1,
      promotionSession: 1,
      releaseApprovers: 1,
      r2Primary: 1,
      r2Recovery: 1,
      attestationPrimary: 1,
      attestationSecondary: 1,
      sessionRecovery: 5,
    },
    observedAt: "2026-08-26T19:02:00.000Z",
  };
  return { ...content, sha256: canonicalSha256(content) };
}

function budgetObservation(exportRoot, candidateRoot) {
  const sampleCount = 1_000_000;
  const connectionMethods = ["google", "github", "passkey"];
  const sources = prepareCandidateRoot(candidateRoot);
  mkdirSync(exportRoot);
  const statistic = (budget, dimension) => {
    const samples =
      budget.unite === "pourcentage"
        ? { failures: 0, total: sampleCount }
        : budget.unite === "occurrences"
          ? { occurrences: 0, total: sampleCount }
          : { histogram: [{ value: 0, count: sampleCount }] };
    const source = {
      schema: "punks.operational-metric-source.v2",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observer: "cloudflare-analytics",
      querySha256: canonicalSha256({ metric: budget.nom, dimension, query: 1 }),
      observedAt: "2026-08-26T20:19:57.000Z",
      samples,
    };
    const sourceContent = Buffer.from(`${JSON.stringify(source)}\n`);
    const provenanceSha256 = createHash("sha256")
      .update(sourceContent)
      .digest("hex");
    writeFileSync(join(sources, `${provenanceSha256}.json`), sourceContent);
    const raw = {
      schema: "punks.operational-metric-export.v1",
      sourceSha,
      stagingDeploymentId,
      metric: budget.nom,
      dimension,
      unit: budget.unite,
      observedAt: "2026-08-26T20:19:58.000Z",
      provenance: [
        {
          path: `operational-budget-sources/${provenanceSha256}.json`,
          sha256: provenanceSha256,
        },
      ],
      samples,
    };
    const exportSha256 = canonicalSha256(raw);
    writeFileSync(
      join(exportRoot, `${exportSha256}.json`),
      `${JSON.stringify(raw)}\n`,
    );
    return {
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
      "export-sha256": exportSha256,
    };
  };
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
      ...statistic(budget, null),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        ...statistic(budget, dimension),
      })),
    };
  });
  const outbox = statistic(
    { nom: "outboxes-en-attente", unite: "occurrences" },
    null,
  );
  const dlq = verdicts.find(({ nom }) => nom === "queues-dlq");
  const content = {
    schema: "punks.operational-budget-observation.v1",
    sourceSha,
    stagingDeploymentId,
    connectionMethods,
    verdicts,
    bookmarks: [
      { autorite: "cloudflare-staging", valeur: stagingDeploymentId },
    ],
    dlq: { messages: 0, "export-sha256": dlq["export-sha256"] },
    outboxes: {
      "en-attente": 0,
      "export-sha256": outbox["export-sha256"],
    },
    incidents: [],
    observedAt: "2026-08-26T20:19:59.000Z",
  };
  return { ...content, sha256: canonicalSha256(content) };
}

test("observes ten successful cadence steps from the exact current Actions run", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "punks-budget-exports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const budgetExportRoot = join(root, "exports");
  const candidateRoot = join(root, "candidate");
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
  dossier.liaison.staging.deploiement = stagingDeploymentId;
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
      budgetObservation: budgetObservation(budgetExportRoot, candidateRoot),
      budgetExportRoot,
      candidateRoot,
      topologyObservation: topologyObservation(dossier),
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
      verifyProviderSubject,
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
  assert.deepEqual(
    observation.topology.workflows.map(({ nom }) => nom),
    ["punks-bot-wake-staging"],
  );
  assert.ok(
    observation.topology["versions-etat-durable-objects"].some(
      ({ version }) => version > 1,
    ),
    "Durable Object state versions must come from the deployed migration chain",
  );
  assert.equal(
    observation.topology["generations-securite"][
      "generation-recuperation-sessions"
    ],
    5,
  );
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
  const firstExport = observation.budgets.verdicts[0]["export-sha256"];
  writeFileSync(
    join(budgetExportRoot, `${firstExport}.json`),
    '{"tampered":true}\n',
  );
  assert.throws(
    () =>
      validateGithubCadenceObservation(observation, {
        sourceSha,
        stagingDeploymentId,
        proofDigests: evidence,
        budgetExportRoot,
        candidateRoot,
        verifyProviderSubject,
      }),
    /raw export digest diverges|unexpected shape/i,
  );
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
  dossier.liaison.staging.deploiement = stagingDeploymentId;
  writeFileSync(dossierPath, JSON.stringify(dossier));
  writeFileSync(publicationPath, JSON.stringify(publicationResult));
  const budgetPath = join(root, "budgets.json");
  const budgetExportRoot = join(root, "budget-exports");
  const candidateRoot = join(root, "candidate");
  writeFileSync(
    budgetPath,
    JSON.stringify(budgetObservation(budgetExportRoot, candidateRoot)),
  );
  const remote = githubObservation();
  const topologyPath = join(root, "topology.json");
  writeFileSync(topologyPath, JSON.stringify(topologyObservation(dossier)));
  const observation = await run(
    [
      "--dossier",
      dossierPath,
      "--publication-result",
      publicationPath,
      "--budget-observation",
      budgetPath,
      "--budget-exports",
      budgetExportRoot,
      "--candidate-root",
      candidateRoot,
      "--topology-observation",
      topologyPath,
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
      verifyProviderSubject,
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
        "--budget-exports",
        budgetExportRoot,
        "--candidate-root",
        candidateRoot,
        "--topology-observation",
        topologyPath,
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
        verifyProviderSubject,
      },
    ),
    /EEXIST|exist/i,
  );
});
