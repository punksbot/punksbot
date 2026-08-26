import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PREUVES_RECUPERATION } from "../promotion-resilience-lib.mjs";
import { validatePromotionProfilesContent } from "../promotion-materials-lib.mjs";
import {
  assignedResilienceScenarios,
  validateResilienceObservation,
} from "./resilience-observation.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const AUTHORITY_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])$/u;
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,299}$/u;

function fail(message) {
  throw new Error(`independent fault controller rejected: ${message}`);
}

function defaultBoundary() {
  fail("protected staging fault boundary is unavailable");
}

function defaultObserver() {
  fail("installed authority observer is unavailable");
}

function stableFile(path, label, maximum = 16 * 1024 * 1024) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.size < 1 ||
    status.size > maximum
  ) {
    fail(`${label} must be one bounded real regular file`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail(`${label} changed while it was read`);
    }
    return { absolute, content };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/** Resolves each promoted authority to the aggregate used by the installed story. */
export function promotionAuthorityTargets(fixture, authorities) {
  const targets = {
    "auth-punk": { kind: "aggregate", id: fixture?.punkId },
    "auth-session-revocation": {
      kind: "aggregate",
      id: fixture?.sessionId,
    },
    "auth-session": { kind: "aggregate", id: fixture?.sessionId },
    "api-workspace": { kind: "aggregate", id: fixture?.workspaceId },
    "api-workspace-slug": {
      kind: "aggregate",
      id: fixture?.workspaceSlug,
    },
    "api-conversation": {
      kind: "aggregate",
      id: fixture?.conversationId,
    },
    "api-message-content": {
      kind: "aggregate",
      id: fixture?.seedMessageIds?.[0],
    },
    "erasure-registry": { kind: "service", id: "erasure-registry" },
    "internal-event-signature": {
      kind: "service",
      id: "internal-event-signature",
    },
  };
  if (
    !Array.isArray(authorities) ||
    authorities.some((authority) => {
      const target = targets[authority];
      return (
        target === undefined ||
        !["aggregate", "service"].includes(target.kind) ||
        !TARGET_RE.test(target.id ?? "")
      );
    })
  ) {
    fail("every authority must resolve to its exact installed-story target");
  }
  return Object.fromEntries(
    authorities.map((authority) => [authority, targets[authority]]),
  );
}

function authorityState(value, identity, { phase, proof, sequence }) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== "punks.promotion-authority-fault-state.v1" ||
    value.executionId !== identity.executionId ||
    value.candidateSha !== identity.candidateSha ||
    value.stagingDeploymentId !== identity.stagingDeploymentId ||
    value.type !== identity.type ||
    value.authority !== identity.authority ||
    value.target?.kind !== identity.target.kind ||
    value.target?.id !== identity.target.id ||
    value.phase !== phase ||
    value.proof !== proof ||
    value.sequence !== sequence ||
    !SHA256_RE.test(value.stateFingerprint ?? "") ||
    typeof value.worker !== "string" ||
    !/^punks-[a-z-]+-staging$/u.test(value.worker) ||
    typeof value.binding !== "string" ||
    !/^[A-Z][A-Z_]+$/u.test(value.binding) ||
    typeof value.className !== "string" ||
    !/^[A-Z][A-Za-z]+$/u.test(value.className)
  ) {
    fail(
      `staging authority ${identity.authority} did not emit its own exact fault state`,
    );
  }
  return value;
}

export function createStagingBoundary({ origin, token }) {
  const call = async (path, body, accepted) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let document;
    try {
      document = await response.json();
    } catch {
      fail(`staging fault boundary ${path} returned non-JSON`);
    }
    if (!accepted.includes(response.status)) {
      fail(`staging fault boundary ${path} returned HTTP ${response.status}`);
    }
    return { response, document };
  };
  return {
    async inject(identity) {
      const startedAt = new Date().toISOString();
      const injected = await call(
        "/api/internal/v1/promotion/faults/inject",
        { contract: "promotion.fault-inject@1", ...identity },
        [200, 201],
      );
      const probe = await call(
        "/api/internal/v1/promotion/faults/probe",
        {
          contract: "promotion.fault-probe@1",
          executionId: identity.executionId,
        },
        [401, 409, 503],
      );
      const expectedStatus =
        identity.type === "revocation"
          ? 401
          : identity.type === "perte-autorite"
            ? 409
            : 503;
      if (
        probe.response.status !== expectedStatus ||
        injected.document?.receipt?.executionId !== identity.executionId ||
        injected.document?.receipt?.phase !== "injected"
      ) {
        fail(
          `fault ${identity.type}/${identity.authority} did not fail closed`,
        );
      }
      const observedAuthority = authorityState(
        injected.document?.authorityState,
        identity,
        { phase: "injected", proof: null, sequence: 1 },
      );
      return {
        startedAt,
        receipt: {
          sequence: injected.document.receipt.sequence,
          probeStatus: probe.response.status,
        },
        authorityState: observedAuthority,
      };
    },
    async recover(input) {
      const recovered = await call(
        "/api/internal/v1/promotion/faults/recover",
        { contract: "promotion.fault-recover@1", ...input },
        [200],
      );
      const receipt = recovered.document?.receipt;
      if (
        receipt?.executionId !== input.executionId ||
        receipt?.proof !== input.proof ||
        !["recovering", "recovered"].includes(receipt?.phase)
      ) {
        fail(`recovery ${input.proof} did not cite its exact injection`);
      }
      const observedAuthority = authorityState(
        recovered.document?.authorityState,
        input,
        {
          phase: receipt.phase,
          proof: input.proof,
          sequence: receipt.sequence,
        },
      );
      if (input.proof === PREUVES_RECUPERATION.at(-1)) {
        const probe = await call(
          "/api/internal/v1/promotion/faults/probe",
          {
            contract: "promotion.fault-probe@1",
            executionId: input.executionId,
          },
          [200],
        );
        if (probe.document?.status !== "recovered") {
          fail(`recovery ${input.executionId} did not reopen its probe`);
        }
      }
      return {
        receipt: {
          sequence: receipt.sequence,
          phase: receipt.phase,
          observedAt: receipt.observedAt,
        },
        authorityState: observedAuthority,
      };
    },
  };
}

export async function exerciseIndependentFaultMatrix(
  input,
  {
    boundary = { inject: defaultBoundary, recover: defaultBoundary },
    observer = {
      observeFailure: defaultObserver,
      observeRecovery: defaultObserver,
    },
  } = {},
) {
  if (
    !SHA1_RE.test(input.candidateSha ?? "") ||
    !SHA256_RE.test(input.artifactSha256 ?? "") ||
    !DEPLOYMENT_RE.test(input.stagingDeploymentId ?? "") ||
    !Array.isArray(input.authorities) ||
    input.authorities.length === 0 ||
    new Set(input.authorities).size !== input.authorities.length ||
    input.authorities.some(
      (authority) => !AUTHORITY_RE.test(authority ?? ""),
    ) ||
    input.targets === null ||
    typeof input.targets !== "object" ||
    Array.isArray(input.targets) ||
    JSON.stringify(Object.keys(input.targets).sort()) !==
      JSON.stringify([...input.authorities].sort()) ||
    input.authorities.some((authority) => {
      const target = input.targets[authority];
      return (
        target === null ||
        typeof target !== "object" ||
        Array.isArray(target) ||
        JSON.stringify(Object.keys(target).sort()) !==
          JSON.stringify(["id", "kind"]) ||
        !["aggregate", "service"].includes(target.kind) ||
        !TARGET_RE.test(target.id ?? "")
      );
    })
  ) {
    fail(
      "exact candidate, staging, artifact and authority coordinates are required",
    );
  }
  const assigned = assignedResilienceScenarios(
    input.platform,
    input.authorities,
  );
  if (
    assigned.length > 0 &&
    (observer.observeFailure === defaultObserver ||
      observer.observeRecovery === defaultObserver)
  ) {
    defaultObserver();
  }
  const output = resolve(input.output);
  if (existsSync(output)) fail("fault controller output already exists");
  const scenarios = [];
  for (const { type, authority } of assigned) {
    const executionId = `${input.candidateSha.slice(0, 12)}.${input.artifactSha256.slice(0, 12)}:${input.platform}:${type}:${authority}`;
    const target = input.targets[authority];
    const control = await boundary.inject({
      type,
      authority,
      executionId,
      candidateSha: input.candidateSha,
      stagingDeploymentId: input.stagingDeploymentId,
      target,
    });
    const observedFailure = await observer.observeFailure({
      type,
      authority,
      executionId,
      candidateSha: input.candidateSha,
      stagingDeploymentId: input.stagingDeploymentId,
      target,
      control,
    });
    const injection = {
      startedAt: control.startedAt,
      ...observedFailure,
    };
    const recoveries = {};
    for (const proof of PREUVES_RECUPERATION) {
      const recoveryControl = await boundary.recover({
        type,
        authority,
        executionId,
        proof,
        candidateSha: input.candidateSha,
        stagingDeploymentId: input.stagingDeploymentId,
        target,
      });
      recoveries[proof] = await observer.observeRecovery({
        type,
        authority,
        executionId,
        proof,
        candidateSha: input.candidateSha,
        stagingDeploymentId: input.stagingDeploymentId,
        target,
        control: recoveryControl,
      });
    }
    scenarios.push({ type, authority, executionId, injection, recoveries });
  }
  const observation = {
    schema: "punks.installed-resilience-observation.v1",
    platform: input.platform,
    candidateSha: input.candidateSha,
    stagingDeploymentId: input.stagingDeploymentId,
    artifactSha256: input.artifactSha256,
    scenarios,
  };
  try {
    validateResilienceObservation(observation, {
      platform: input.platform,
      candidateSha: input.candidateSha,
      stagingDeploymentId: input.stagingDeploymentId,
      artifactSha256: input.artifactSha256,
      authorities: input.authorities,
    });
  } catch (error) {
    fail(
      `boundary emitted invalid observations: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  writeFileSync(output, `${JSON.stringify(observation, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return observation;
}

function options(argv) {
  const expected = new Set([
    "--platform",
    "--source-sha",
    "--staging-deployment-id",
    "--artifact",
    "--fixture",
    "--operator-token-file",
    "--origin",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || values.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    values.set(flag, value);
  }
  if (
    values.size !== expected.size ||
    [...values.keys()].some((flag) => !expected.has(flag))
  ) {
    fail("exact independent fault controller CLI arguments are required");
  }
  return (name) => values.get(name);
}

export async function run(argv = process.argv.slice(2)) {
  const required = options(argv);
  const origin = new URL(required("--origin"));
  if (
    origin.protocol !== "https:" ||
    origin.origin !== "https://staging.punks.bot" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    fail("exact staging HTTPS origin is required");
  }
  const token = stableFile(
    required("--operator-token-file"),
    "operator token",
    16 * 1024,
  )
    .content.toString("utf8")
    .trim();
  if (token.length < 32 || token.length > 4096 || /\s/u.test(token)) {
    fail("operator token is malformed");
  }
  const profile = validatePromotionProfilesContent(
    stableFile(
      fileURLToPath(
        new URL("../../cloudflare/promotion-profiles.json", import.meta.url),
      ),
      "promotion profile",
    ).content,
    { tranche: 1 },
  );
  const artifact = stableFile(
    required("--artifact"),
    "installed updater artifact",
  );
  let fixture;
  try {
    fixture = JSON.parse(
      stableFile(required("--fixture"), "staging fixture").content.toString(
        "utf8",
      ),
    );
  } catch {
    fail("staging fixture is invalid JSON");
  }
  const authorities = profile.authorities.map(({ id }) => id);
  return exerciseIndependentFaultMatrix(
    {
      platform: required("--platform"),
      candidateSha: required("--source-sha"),
      stagingDeploymentId: required("--staging-deployment-id"),
      artifactSha256: sha256(artifact.content),
      authorities,
      targets: promotionAuthorityTargets(fixture, authorities),
      output: required("--output"),
    },
    { boundary: createStagingBoundary({ origin: origin.origin, token }) },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
