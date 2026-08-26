import assert from "node:assert/strict";
import test from "node:test";

import {
  assignedResilienceScenarios,
  validateResilienceObservation,
} from "./resilience-observation.mjs";
import {
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "../promotion-resilience-lib.mjs";

const PLATFORMS = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];
const AUTHORITIES = ["auth-session", "workspace", "conversation"];
const SOURCE_SHA = "3d".repeat(20);
const DEPLOYMENT_ID = `sha256:${"4e".repeat(32)}`;
const ARTIFACT_SHA = "5f".repeat(32);

function observation(platform, mutate = () => {}) {
  const scenarios = assignedResilienceScenarios(platform, AUTHORITIES).map(
    ({ type, authority }, index) => ({
      type,
      authority,
      executionId: `${platform}-${type}-${authority}`,
      injection: {
        startedAt: `2026-08-26T10:${String(index).padStart(2, "0")}:00.000Z`,
        observedAt: `2026-08-26T10:${String(index).padStart(2, "0")}:01.000Z`,
        operation: "installed-public-contract",
        failureKind: type === "revocation" ? "problem" : "transport",
        observations: [
          `${type}/${authority} failed closed in the installed UI`,
        ],
      },
      recoveries: Object.fromEntries(
        PREUVES_RECUPERATION.map((proof) => [
          proof,
          {
            observedAt: `2026-08-26T10:${String(index).padStart(2, "0")}:02.000Z`,
            observations: [`${proof} observed after ${type}/${authority}`],
          },
        ]),
      ),
    }),
  );
  const value = {
    schema: "punks.installed-resilience-observation.v1",
    platform,
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    artifactSha256: ARTIFACT_SHA,
    scenarios,
  };
  mutate(value);
  return value;
}

test("assigns every fault-authority coordinate to exactly one platform", () => {
  const coordinates = PLATFORMS.flatMap((platform) =>
    assignedResilienceScenarios(platform, AUTHORITIES).map(
      ({ type, authority }) => `${type}/${authority}`,
    ),
  );
  assert.deepEqual(
    coordinates.sort(),
    TYPES_FAUTE.flatMap((type) =>
      AUTHORITIES.map((authority) => `${type}/${authority}`),
    ).sort(),
  );
  assert.equal(new Set(coordinates).size, coordinates.length);
  assert.deepEqual(assignedResilienceScenarios("macos-arm64", AUTHORITIES), []);
  assert.deepEqual(assignedResilienceScenarios("macos-x64", AUTHORITIES), []);
});

test("accepts only complete observed recovery scenarios for one installed leg", () => {
  const platform = "linux-x64";
  const value = observation(platform);
  assert.deepEqual(
    validateResilienceObservation(value, {
      platform,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      artifactSha256: ARTIFACT_SHA,
      authorities: AUTHORITIES,
    }),
    value,
  );
});

test("rejects a missing recovery and credentials in observations", () => {
  const platform = "linux-x64";
  for (const mutate of [
    (value) => delete value.scenarios[0].recoveries[PREUVES_RECUPERATION[0]],
    (value) => value.scenarios.pop(),
    (value) =>
      value.scenarios[0].injection.observations.push(
        "Authorization: Bearer secret",
      ),
  ]) {
    assert.throws(
      () =>
        validateResilienceObservation(observation(platform, mutate), {
          platform,
          candidateSha: SOURCE_SHA,
          stagingDeploymentId: DEPLOYMENT_ID,
          artifactSha256: ARTIFACT_SHA,
          authorities: AUTHORITIES,
        }),
      /recover|scenario|credential|secret/i,
    );
  }
});
