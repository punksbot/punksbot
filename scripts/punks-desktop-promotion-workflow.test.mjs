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
  const stage = step("build", "stage_leg");

  assert.equal(
    exercise.if,
    "inputs.validation_scope == 'full-candidate'",
    "installed testing must run on every full-candidate platform leg",
  );
  assert.match(exercise.run, /scripts\/candidate\/installed-app\.mjs/);
  assert.match(exercise.run, new RegExp(installedExerciseProducer));
  assert.equal(
    existsSync(installedExerciseProducer),
    true,
    "the installed exercise producer must be executable repository code",
  );
  assert.match(exercise.run, /--installed-artifact/);
  assert.match(exercise.run, /--staging-deployment-proof/);
  assert.match(exercise.run, /--proof-output/);
  assert.match(exercise.run, /--network-output/);
  assert.equal(
    exercise.env?.PUNKS_PROMOTION_SESSION,
    "${{ secrets.PUNKS_PROMOTION_SESSION }}",
  );
  assert.ok(
    build.steps.indexOf(exercise) < build.steps.indexOf(stage),
    "the platform leg must consume only an already exercised installation",
  );

  assert.match(stage.run, /--installed-proof/);
  assert.match(stage.run, /--network-proof/);
});

test("the aggregate validates, publishes and only then activates the exact draft", () => {
  const aggregate = workflow.jobs.aggregate;
  const complete = step("aggregate", "complete_promotion_evidence");
  const assemble = step("aggregate", "assemble_promotion_dossier");
  const validate = step("aggregate", "validate_promotion_dossier");
  assert.match(complete.run, new RegExp(promotionEvidenceProducer));
  assert.equal(
    existsSync(promotionEvidenceProducer),
    true,
    "the promotion evidence producer must be executable repository code",
  );
  assert.match(assemble.run, /scripts\/candidate\/promotion-dossier\.mjs/);
  assert.match(validate.run, /pnpm promotion:valider/);
  assert.ok(
    aggregate.steps.indexOf(assemble) < aggregate.steps.indexOf(validate),
    "the assembled dossier must be validated before publication",
  );

  const publish = workflow.jobs.publish_promotion;
  assert.ok(publish, "publish_promotion job is required");
  assert.equal(
    publish.needs,
    "attest_candidate",
    "immutable publication must wait for the final attested candidate",
  );
  assert.equal(publish.environment, "punks-staging-promotion");
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
  const activate = step("publish_promotion", "activate_verified_draft");
  assert.match(publishStep.run, /scripts\/promotion-publish\.mjs/);
  assert.match(activate.run, /gh release edit/);
  assert.match(activate.run, /--draft=false/);
  assert.ok(
    publish.steps.indexOf(publishStep) < publish.steps.indexOf(activate),
    "release activation must be downstream of immutable publication",
  );
});
