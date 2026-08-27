import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import YAML from "yaml";

const workflow = YAML.parse(
  readFileSync(".github/workflows/punks-desktop-candidate.yml", "utf8"),
);
const installedExerciseProducer =
  "scripts/candidate/exercise-installed-social-loop.mjs";
const promotionEvidenceProducer =
  "scripts/candidate/complete-promotion-evidence.mjs";
const artifactScanProducer = "scripts/candidate/installed-artifact-scan.mjs";

function step(job, id) {
  const selected = workflow.jobs?.[job]?.steps?.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(selected, `${job}/${id} is required`);
  return selected;
}

test("a full candidate proves the installed social loop before collecting a leg", () => {
  const build = workflow.jobs.build;
  const exercise = step("build", "exercise_installed_candidate");
  const scan = step("build", "scan_installed_candidate");
  const seal = step("build", "seal_installed_candidate");
  const stage = step("build", "stage_leg");

  assert.equal(
    exercise.if,
    "inputs.validation_scope == 'full-candidate'",
    "installed testing must run on every full-candidate platform leg",
  );
  assert.doesNotMatch(exercise.run, /scripts\/candidate\/installed-app\.mjs/);
  assert.match(seal.run, /scripts\/candidate\/installed-app\.mjs/);
  assert.match(exercise.run, new RegExp(installedExerciseProducer));
  assert.match(scan.run, new RegExp(artifactScanProducer));
  assert.match(exercise.run, /Contents\/MacOS\/punks-bot-staging/);
  assert.match(exercise.run, /--appimage-extract/);
  assert.match(exercise.run, /punks-nsis-install/);
  assert.match(scan.run, /--installed-root/);
  assert.match(scan.run, /--embedded-assets/);
  assert.equal(
    existsSync(installedExerciseProducer),
    true,
    "the installed exercise producer must be executable repository code",
  );
  assert.equal(existsSync(artifactScanProducer), true);
  assert.match(exercise.run, /--installed-artifact/);
  assert.match(exercise.run, /--staging-deployment-proof/);
  assert.match(exercise.run, /--live-auth-proof/);
  assert.match(exercise.run, /--live-follow-proof/);
  assert.match(seal.run, /--proof-output/);
  assert.match(seal.run, /--network-output/);
  assert.match(exercise.run, /--resilience-output/);
  assert.match(exercise.run, /--raw-evidence-output/);
  assert.match(exercise.run, /--native-binary/);
  assert.match(exercise.run, /--native-proof/);
  assert.match(exercise.run, /--fault-observation/);
  assert.match(exercise.run, /--operator-token-file "\$operator_token_file"/);
  assert.match(seal.run, /--resilience-observation/);
  assert.match(seal.run, /--artifact-scan/);
  assert.match(seal.run, /--raw-evidence/);
  assert.equal(
    exercise.env?.PUNKS_PROMOTION_SESSION,
    "${{ secrets.PUNKS_PROMOTION_SESSION }}",
  );
  assert.equal(
    exercise.env?.PUNKS_OPERATOR_PROVISIONING_TOKEN,
    "${{ secrets.PUNKS_OPERATOR_PROVISIONING_TOKEN }}",
  );
  assert.equal(
    exercise.env?.PUNKS_ACCESSIBILITY_MANUAL_REVIEW,
    undefined,
    "interactive review must derive from the exact installed evidence, not a JSON secret",
  );
  assert.equal(
    exercise.env?.PUNKS_ACCESSIBILITY_REVIEWER,
    undefined,
    "a protected reviewer name cannot manufacture a manual review",
  );
  assert.match(exercise.run, /--screen-reader-binary/);
  assert.match(exercise.run, /--manual-review-file/);
  assert.equal(
    exercise.env?.CLOUDFLARE_API_TOKEN,
    undefined,
    "the installed driver does not need the remote observation credential",
  );
  assert.equal(
    seal.env?.CLOUDFLARE_API_TOKEN,
    "${{ secrets.PUNKS_CLOUDFLARE_API_TOKEN }}",
    "only post-driver Cloudflare reobservation receives the read token",
  );
  assert.match(
    exercise.run,
    /unset PUNKS_PROMOTION_SESSION PUNKS_OPERATOR_PROVISIONING_TOKEN/,
    "raw promotion credentials must leave the environment before any driver can inherit it",
  );
  assert.match(exercise.run, /scripts\/candidate\/staging-fixture\.mjs/);
  assert.match(exercise.run, /--staging-fixture/);
  assert.match(exercise.run, /punks-staging-fixture\.json/);
  assert.match(exercise.run, /test ! -e "\$session_bundle"/);
  assert.match(exercise.run, /remove_secret_files\(\)/);
  assert.ok(
    exercise.run.lastIndexOf("remove_secret_files") >
      exercise.run.indexOf("exercise-installed-social-loop.mjs"),
    "operator material must survive only until the installed observer closes",
  );
  assert.match(exercise.run, /cleanup_session\(\)/);
  assert.match(exercise.run, /local main_status=\$\?/);
  assert.match(exercise.run, /trap - EXIT/);
  assert.match(exercise.run, /exit "\$cleanup_status"/);
  assert.match(
    exercise.run,
    /"\$helper" --destroy \|\| cleanup_status=\$\?/,
    "keyring cleanup failure must not skip deletion of the secret files",
  );
  assert.match(
    exercise.run,
    /remove_secret_files \|\| cleanup_status=\$\?/,
    "secret-file cleanup must run and remain observable on every exit",
  );
  assert.ok(
    exercise.run.indexOf("trap cleanup_session EXIT") <
      exercise.run.indexOf("writeFileSync(path, value") &&
      exercise.run.indexOf("scripts/candidate/staging-fixture.mjs") <
        exercise.run.lastIndexOf('test ! -e "$session_bundle"') &&
      exercise.run.lastIndexOf('test ! -e "$session_bundle"') <
        exercise.run.indexOf("exercise-installed-social-loop.mjs") &&
      exercise.run.indexOf(
        "unset PUNKS_PROMOTION_SESSION PUNKS_OPERATOR_PROVISIONING_TOKEN",
      ) < exercise.run.indexOf("driver_command=(node)") &&
      exercise.run.indexOf("exercise-installed-social-loop.mjs") <
        exercise.run.lastIndexOf("remove_secret_files"),
    "raw secrets must leave the environment before the driver and the bounded operator file must be deleted after observation",
  );
  assert.ok(
    build.steps.indexOf(exercise) < build.steps.indexOf(scan) &&
      build.steps.indexOf(scan) < build.steps.indexOf(seal) &&
      build.steps.indexOf(seal) < build.steps.indexOf(stage),
    "the platform leg must consume only an already exercised installation",
  );

  assert.match(stage.run, /--installed-proof/);
  assert.match(stage.run, /--network-proof/);
});

test("the aggregate validates, publishes and only then activates the exact draft", () => {
  const aggregate = workflow.jobs.aggregate;
  const attestProduction = step("aggregate", "attest_production_candidate");
  const verifyProduction = step("aggregate", "verify_production_candidate");
  const buildObserved = step("aggregate", "build_observed_evidence_fragments");
  const complete = step("aggregate", "complete_promotion_evidence");
  const stageBudgets = step("aggregate", "stage_operational_budgets");
  const attestComplete = step("aggregate", "attest_complete_evidence");
  const verifyComplete = step("aggregate", "verify_complete_evidence");
  const sealBudgets = step("aggregate", "seal_operational_budgets");
  const assemble = step("aggregate", "assemble_promotion_dossier");
  const validate = step("aggregate", "validate_promotion_dossier");
  assert.match(complete.run, new RegExp(promotionEvidenceProducer));
  assert.equal(
    existsSync(promotionEvidenceProducer),
    true,
    "the promotion evidence producer must be executable repository code",
  );
  assert.match(assemble.run, /scripts\/candidate\/promotion-dossier\.mjs/);
  assert.match(
    buildObserved.run,
    /scripts\/candidate\/observed-evidence-fragments\.mjs/,
  );
  assert.match(complete.run, /production-aggregate-provenance\.sigstore\.json/);
  assert.equal(aggregate.environment, "punks-staging-promotion");
  assert.match(
    stageBudgets.run,
    /scripts\/candidate\/operational-budget-fetch\.mjs/,
  );
  assert.match(
    attestComplete.with?.["subject-path"],
    /candidate\/operational-budget-sources\/\*/,
  );
  assert.match(verifyComplete.run, /candidate\/operational-budget-sources/);
  assert.match(
    sealBudgets.run,
    /scripts\/candidate\/operational-budget-seal\.mjs/,
  );
  assert.match(assemble.run, /pre-dossier-provenance\.sigstore\.json/);
  assert.match(validate.run, /pnpm promotion:valider/);
  assert.ok(
    aggregate.steps.indexOf(attestProduction) <
      aggregate.steps.indexOf(verifyProduction) &&
      aggregate.steps.indexOf(verifyProduction) <
        aggregate.steps.indexOf(buildObserved) &&
      aggregate.steps.indexOf(buildObserved) <
        aggregate.steps.indexOf(complete) &&
      aggregate.steps.indexOf(complete) <
        aggregate.steps.indexOf(stageBudgets) &&
      aggregate.steps.indexOf(stageBudgets) <
        aggregate.steps.indexOf(attestComplete) &&
      aggregate.steps.indexOf(attestComplete) <
        aggregate.steps.indexOf(verifyComplete) &&
      aggregate.steps.indexOf(verifyComplete) <
        aggregate.steps.indexOf(sealBudgets) &&
      aggregate.steps.indexOf(sealBudgets) <
        aggregate.steps.indexOf(assemble) &&
      aggregate.steps.indexOf(assemble) < aggregate.steps.indexOf(validate),
    "production provenance, complete evidence provenance, dossier and validation are misordered",
  );

  const publish = workflow.jobs.publish_promotion;
  assert.ok(publish, "publish_promotion job is required");
  assert.equal(
    publish.needs,
    "attest_candidate",
    "immutable publication must wait for the final attested candidate",
  );
  assert.equal(publish.environment, "punks-staging-promotion");
  assert.equal(
    publish.permissions?.attestations,
    "read",
    "the publisher must verify every operational metric Sigstore subject",
  );
  const download = step("publish_promotion", "download_final_candidate");
  assert.equal(
    download.uses,
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  );
  assert.equal(
    download.with?.name,
    "punks-desktop-candidate-${{ inputs.source_sha }}",
  );
  assert.equal(download.with?.path, "candidate");
  assert.equal(
    download.run,
    undefined,
    "the completed dependency must be downloaded directly without polling",
  );
  const publishStep = step("publish_promotion", "publish_immutable_proofs");
  const cadence = step("publish_promotion", "observe_github_cadence");
  const operationalHead = step(
    "publish_promotion",
    "materialize_operational_head",
  );
  const activate = step("publish_promotion", "activate_verified_draft");
  assert.match(publishStep.run, /scripts\/promotion-publish\.mjs/);
  assert.match(
    cadence.run,
    /scripts\/candidate\/github-cadence-observation\.mjs/,
  );
  assert.match(cadence.run, /--run-id "\$GITHUB_RUN_ID"/);
  assert.match(cadence.run, /--run-attempt "\$GITHUB_RUN_ATTEMPT"/);
  assert.match(cadence.run, /--budget-observation "\$budget_file"/);
  assert.match(
    cadence.run,
    /budget_file="candidate\/operational-budget-observation\.json"/,
  );
  assert.match(
    cadence.run,
    /budget_exports="candidate\/operational-budget-exports"/,
  );
  assert.match(cadence.run, /--budget-exports "\$budget_exports"/);
  assert.match(cadence.run, /--candidate-root candidate/);
  assert.doesNotMatch(cadence.run, /operational-budget-fetch\.mjs/);
  assert.match(cadence.run, /test -f "\$budget_file"/);
  assert.match(
    cadence.run,
    /scripts\/candidate\/operational-topology-observation\.mjs/,
  );
  assert.match(
    cadence.run,
    /--topology-observation candidate\/operational-topology-observation\.json/,
  );
  assert.match(cadence.run, /github-cadence-observation\.json/);
  assert.equal(cadence.env?.GITHUB_TOKEN, "${{ github.token }}");
  assert.doesNotMatch(
    JSON.stringify(cadence),
    /PUNKS_OPERATIONAL_BUDGET_OBSERVATION/,
  );
  assert.match(
    operationalHead.run,
    /scripts\/candidate\/operational-release-head\.mjs/,
  );
  assert.match(
    operationalHead.run,
    /--cadence-observation candidate\/github-cadence-observation\.json/,
  );
  assert.match(
    operationalHead.run,
    /--budget-exports candidate\/operational-budget-exports/,
  );
  assert.match(operationalHead.run, /--candidate-root candidate/);
  assert.match(operationalHead.run, /operational-release-head\.json/);
  assert.match(operationalHead.run, /validateOperationalReleaseHead/);
  assert.match(activate.run, /\["expansion", "active"\]/);
  assert.match(activate.run, /"E0", "E1", "E2", "E3", "E4"/);
  assert.match(activate.run, /"A0", "A1", "A2", "A3", "A4"/);
  assert.match(activate.run, /gh release edit/);
  assert.match(activate.run, /--draft=false/);
  assert.match(
    activate.run,
    /--latest/,
    "the activated release must serve the configured releases/latest updater endpoint",
  );
  assert.match(activate.run, /\.isPrerelease == false/);
  assert.doesNotMatch(
    activate.run,
    /^\s*--prerelease\s*$/m,
    "a prerelease is excluded from GitHub's releases/latest endpoint",
  );
  assert.ok(
    publish.steps.indexOf(publishStep) < publish.steps.indexOf(cadence) &&
      publish.steps.indexOf(cadence) < publish.steps.indexOf(operationalHead) &&
      publish.steps.indexOf(operationalHead) < publish.steps.indexOf(activate),
    "release activation must follow immutable publication and the signed operational head",
  );
});
