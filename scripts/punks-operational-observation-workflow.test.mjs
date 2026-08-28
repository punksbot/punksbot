import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const provider = YAML.parse(
  readFileSync(".github/workflows/punks-operational-observation.yml", "utf8"),
);
const candidate = YAML.parse(
  readFileSync(".github/workflows/punks-desktop-candidate.yml", "utf8"),
);

function step(job, id) {
  const value = provider.jobs[job].steps.find((entry) => entry.id === id);
  assert.ok(value, `${job}/${id} is required`);
  return value;
}

test("the reusable provider accepts coordinates but no caller samples", () => {
  assert.deepEqual(Object.keys(provider.on.workflow_call.inputs).sort(), [
    "phase",
    "source_sha",
    "staging_deployment_id",
  ]);
  assert.equal(
    provider.on.workflow_call.outputs.manifest_sha256.value,
    "${{ jobs.finalize.outputs.manifest_sha256 }}",
  );
  assert.deepEqual(Object.keys(provider.jobs).sort(), ["backend", "finalize"]);
  assert.equal(provider.jobs.backend.environment, "punks-staging-promotion");
  assert.equal(provider.jobs.finalize.environment, "punks-staging-promotion");
  assert.equal(provider.jobs.backend.if, "inputs.phase == 'backend'");
  assert.equal(provider.jobs.finalize.if, "inputs.phase == 'finalize'");
  assert.doesNotMatch(JSON.stringify(provider.on), /samples|bundle_base64/i);
});

test("backend probes staging before Session loss and receives no R2 authority", () => {
  const observe = step("backend", "observe_staging");
  const collect = step("backend", "collect_backend");
  const reobserve = step("backend", "reobserve_staging");
  const attest = step("backend", "attest_backend");
  const verify = step("backend", "verify_backend");
  const upload = step("backend", "upload_backend");
  assert.match(observe.run, /staging-deployment-proof\.mjs/);
  assert.deepEqual(Object.keys(collect.env), ["PUNKS_PROMOTION_SESSION"]);
  assert.match(collect.run, /operational-backend-probe\.mjs/);
  assert.match(collect.run, /unset PUNKS_PROMOTION_SESSION/);
  assert.match(reobserve.run, /staging-deployment-proof\.mjs/);
  assert.match(reobserve.run, /cmp -s/);
  assert.ok(
    provider.jobs.backend.steps.indexOf(reobserve) <
      provider.jobs.backend.steps.indexOf(attest),
    "backend report is attested before the post-probe staging reobservation",
  );
  assert.equal(
    attest.uses,
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  );
  assert.match(verify.run, /punks-operational-observation\.yml/);
  assert.equal(
    upload.with.name,
    "punks-operational-backend-${{ inputs.source_sha }}",
  );
  assert.doesNotMatch(
    JSON.stringify(provider.jobs.backend),
    /PUNKS_R2_|PUNKS_OPERATOR_PROVISIONING_TOKEN/,
  );
});

test("finalization verifies four legs and publishes one provider-owned v4 manifest", () => {
  const aggregate = step("finalize", "aggregate");
  const infrastructure = step("finalize", "observe_infrastructure");
  const reobserve = step("finalize", "reobserve_final_staging");
  const collect = step("finalize", "collect_sources");
  const attest = step("finalize", "attest_sources");
  const verify = step("finalize", "verify_sources");
  const materialize = step("finalize", "materialize");
  const publish = step("finalize", "publish");
  assert.match(aggregate.run, /artifacts\.mjs aggregate/);
  assert.match(infrastructure.run, /operational-infrastructure-probe\.mjs/);
  assert.match(infrastructure.run, /unset PUNKS_OPERATOR_PROVISIONING_TOKEN/);
  assert.match(reobserve.run, /staging-deployment-proof\.mjs/);
  assert.match(reobserve.run, /cmp -s/);
  assert.ok(
    provider.jobs.finalize.steps.indexOf(infrastructure) <
      provider.jobs.finalize.steps.indexOf(reobserve) &&
      provider.jobs.finalize.steps.indexOf(reobserve) <
        provider.jobs.finalize.steps.indexOf(collect),
    "infrastructure state is not fenced by a final staging reobservation",
  );
  assert.match(collect.run, /--infrastructure-report/);
  assert.match(aggregate.run, /--input provider-input\/legs/);
  assert.match(collect.run, /operational-source-collect\.mjs/);
  assert.match(collect.run, /backend-probe\.sigstore\.json/);
  assert.equal(
    attest.uses,
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  );
  assert.match(verify.run, /test .* = "43"/);
  assert.match(verify.run, /punks-operational-observation\.yml/);
  assert.match(
    materialize.run,
    /operational-budget-materialize\.mjs materialize/,
  );
  assert.match(materialize.run, /--provider-bundle "\$ATTESTATION_BUNDLE"/);
  assert.match(publish.run, /operational-budget-materialize\.mjs publish/);
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
  assert.ok(
    provider.jobs.finalize.steps.indexOf(attest) <
      provider.jobs.finalize.steps.indexOf(verify) &&
      provider.jobs.finalize.steps.indexOf(verify) <
        provider.jobs.finalize.steps.indexOf(materialize) &&
      provider.jobs.finalize.steps.indexOf(materialize) <
        provider.jobs.finalize.steps.indexOf(publish),
  );
});

test("the candidate consumes the provider output from the same run", () => {
  const backend = candidate.jobs.observe_operational_backend;
  const finalize = candidate.jobs.observe_operational;
  assert.equal(
    backend.uses,
    "./.github/workflows/punks-operational-observation.yml",
  );
  assert.equal(backend.with.phase, "backend");
  assert.equal(backend.if, "inputs.validation_scope == 'full-candidate'");
  assert.equal(finalize.with.phase, "finalize");
  assert.deepEqual(candidate.jobs.aggregate.needs, [
    "attest_legs",
    "observe_operational",
  ]);
  const serialized = JSON.stringify(candidate.jobs.aggregate);
  assert.match(
    serialized,
    /needs\.observe_operational\.outputs\.manifest_sha256/,
  );
  assert.doesNotMatch(
    serialized,
    /vars\.PUNKS_OPERATIONAL_BUDGET_MANIFEST_SHA256/,
  );
});
