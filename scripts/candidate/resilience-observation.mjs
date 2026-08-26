import {
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
} from "../promotion-resilience-lib.mjs";
import { PLATEFORMES } from "../release-graph-lib.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const COORDINATE_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])$/u;
const EXECUTION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/u;
const CREDENTIAL_RE =
  /authorization\s*:|bearer\s+|__host-|cookie\s*=|token\s*=|secret\s*=|password\s*=/iu;

function fail(message) {
  throw new Error(`installed resilience observation rejected: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has an unexpected shape`);
  }
}

function boundedObservations(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > 500 ||
        entry.trim() !== entry ||
        CREDENTIAL_RE.test(entry),
    )
  ) {
    fail(`${label} contains a credential, secret or unbounded observation`);
  }
}

function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(`${label} must be one canonical UTC timestamp`);
  }
  return Date.parse(value);
}

/** Deterministically partitions the closed fault × authority product. */
export function assignedResilienceScenarios(platform, authorities) {
  if (!PLATEFORMES.includes(platform)) fail("unsupported resilience platform");
  if (
    !Array.isArray(authorities) ||
    authorities.length === 0 ||
    new Set(authorities).size !== authorities.length ||
    authorities.some((authority) => !COORDINATE_RE.test(authority ?? ""))
  ) {
    fail("authorities must be one closed coordinate list");
  }
  const observerPlatforms = ["linux-x64", "windows-x64"];
  const platformIndex = observerPlatforms.indexOf(platform);
  if (platformIndex < 0) return [];
  return TYPES_FAUTE.flatMap((type, typeIndex) =>
    authorities.flatMap((authority, authorityIndex) =>
      (typeIndex + authorityIndex) % observerPlatforms.length === platformIndex
        ? [{ type, authority }]
        : [],
    ),
  );
}

/**
 * Validates the raw observations emitted by a real installed platform driver.
 * It accepts no green/result flag: completeness, ordering and recovery are
 * derived from observed records only.
 */
export function validateResilienceObservation(
  observation,
  { platform, candidateSha, stagingDeploymentId, artifactSha256, authorities },
) {
  exactKeys(
    observation,
    [
      "schema",
      "platform",
      "candidateSha",
      "stagingDeploymentId",
      "artifactSha256",
      "scenarios",
    ],
    "resilience observation",
  );
  if (
    observation.schema !== "punks.installed-resilience-observation.v1" ||
    observation.platform !== platform ||
    observation.candidateSha !== candidateSha ||
    observation.stagingDeploymentId !== stagingDeploymentId ||
    observation.artifactSha256 !== artifactSha256 ||
    !PLATEFORMES.includes(platform) ||
    !SHA1_RE.test(candidateSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "") ||
    !SHA256_RE.test(artifactSha256 ?? "")
  ) {
    fail("resilience observation belongs to another candidate");
  }
  if (!Array.isArray(observation.scenarios)) {
    fail("resilience scenarios must be an array");
  }
  const expected = assignedResilienceScenarios(platform, authorities);
  if (observation.scenarios.length !== expected.length) {
    fail("resilience scenario set is incomplete");
  }
  const seen = new Set();
  for (const scenario of observation.scenarios) {
    exactKeys(
      scenario,
      ["type", "authority", "executionId", "injection", "recoveries"],
      "resilience scenario",
    );
    const coordinate = `${scenario.type}/${scenario.authority}`;
    if (
      !expected.some(
        ({ type, authority }) =>
          type === scenario.type && authority === scenario.authority,
      ) ||
      seen.has(coordinate) ||
      !EXECUTION_RE.test(scenario.executionId ?? "")
    ) {
      fail(`unknown, duplicate or invalid resilience scenario ${coordinate}`);
    }
    seen.add(coordinate);
    exactKeys(
      scenario.injection,
      ["startedAt", "observedAt", "operation", "failureKind", "observations"],
      `fault injection ${coordinate}`,
    );
    const startedAt = timestamp(
      scenario.injection.startedAt,
      `fault injection ${coordinate} start`,
    );
    const observedAt = timestamp(
      scenario.injection.observedAt,
      `fault injection ${coordinate} observation`,
    );
    if (
      observedAt < startedAt ||
      typeof scenario.injection.operation !== "string" ||
      scenario.injection.operation.length === 0 ||
      scenario.injection.operation.length > 200 ||
      ![
        "problem",
        "transport",
        "contract_violation",
        "stale_workspace",
        "session_expired",
        "ambiguous",
      ].includes(scenario.injection.failureKind)
    ) {
      fail(`fault injection ${coordinate} did not fail closed`);
    }
    boundedObservations(
      scenario.injection.observations,
      `fault injection ${coordinate}`,
    );
    exactKeys(
      scenario.recoveries,
      PREUVES_RECUPERATION,
      `recoveries ${coordinate}`,
    );
    for (const proof of PREUVES_RECUPERATION) {
      const recovery = scenario.recoveries[proof];
      exactKeys(
        recovery,
        ["observedAt", "observations"],
        `${proof} recovery ${coordinate}`,
      );
      const recoveredAt = timestamp(
        recovery.observedAt,
        `${proof} recovery ${coordinate}`,
      );
      if (recoveredAt < observedAt) {
        fail(`${proof} recovery precedes fault ${coordinate}`);
      }
      boundedObservations(
        recovery.observations,
        `${proof} recovery ${coordinate}`,
      );
    }
  }
  for (const { type, authority } of expected) {
    if (!seen.has(`${type}/${authority}`)) {
      fail(`resilience scenario ${type}/${authority} is missing`);
    }
  }
  return observation;
}
