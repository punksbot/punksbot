import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(".github/workflows/punks-operational-budget.yml", "utf8"),
);
const githubExpression = (value) => ["$", "{{ ", value, " }}"].join("");

function step(id) {
  const value = workflow.jobs.prepare.steps.find((entry) => entry.id === id);
  assert.ok(value, `missing workflow step ${id}`);
  return value;
}

test("the protected workflow materializes and publishes exact provider sources", () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), [
    "source_sha",
    "sources_bundle_gzip_base64",
    "sources_bundle_sha256",
    "staging_deployment_id",
  ]);
  assert.ok(Object.values(inputs).every(({ required }) => required === true));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.prepare;
  assert.equal(job.environment, "punks-staging-promotion");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.deepEqual(job.permissions, workflow.permissions);
  assert.equal(job.env, undefined);

  assert.deepEqual(step("checkout").with, {
    ref: githubExpression("github.sha"),
    "fetch-depth": 1,
    "persist-credentials": false,
  });
  const validate = step("validate_source");
  assert.equal(
    validate.env.REF_PROTECTED,
    githubExpression("github.ref_protected"),
  );
  assert.match(validate.run, /SOURCE_SHA.*GITHUB_SHA/);
  assert.match(step("decode_sources").run, /SOURCES_BUNDLE_SHA256/);
  assert.match(step("decode_sources").run, /gunzipSync/);
  assert.match(step("decode_sources").run, /documents\.length !== 43/);
  assert.match(step("decode_sources").run, /writeFileSync.*flag: "wx"/s);

  const materialize = step("materialize");
  assert.match(
    materialize.run,
    /operational-budget-materialize\.mjs materialize/,
  );
  assert.match(materialize.run, /--sources "\$RUNNER_TEMP\/provider-sources"/);
  assert.match(materialize.run, /manifestSha256/);

  const publish = step("publish");
  assert.deepEqual(Object.keys(publish.env).sort(), [
    "PUNKS_R2_PRIMARY_ACCESS_KEY_ID",
    "PUNKS_R2_PRIMARY_API_TOKEN",
    "PUNKS_R2_PRIMARY_DESTINATION",
    "PUNKS_R2_PRIMARY_SECRET_ACCESS_KEY",
    "PUNKS_R2_RECOVERY_ACCESS_KEY_ID",
    "PUNKS_R2_RECOVERY_API_TOKEN",
    "PUNKS_R2_RECOVERY_DESTINATION",
    "PUNKS_R2_RECOVERY_SECRET_ACCESS_KEY",
  ]);
  assert.match(publish.run, /operational-budget-materialize\.mjs publish/);
  assert.match(publish.run, /--manifest-sha256 "\$MANIFEST_SHA256"/);
  assert.match(publish.run, /scripts\/promotion-frontiers\.mjs/);

  assert.equal(
    job.steps.some(({ id }) => id === "anchor"),
    false,
    "the workflow token cannot mutate protected environment variables",
  );
});

test("the workflow never uploads the caller bundle or secret material", () => {
  const upload = step("upload");
  assert.equal(
    upload.uses,
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  );
  assert.match(upload.with.path, /operational-budget\/manifest\.json/);
  assert.doesNotMatch(upload.with.path, /provider-sources|bundle/i);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 1);
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized, /PUNKS_PROMOTION_SESSION/);
  assert.doesNotMatch(serialized, /PUNKS_OPERATOR_PROVISIONING_TOKEN/);
  assert.doesNotMatch(serialized, /PUNKS_CLOUDFLARE_API_TOKEN/);
});
