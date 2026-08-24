import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  createCloudflareApiBoundary,
  createStagingDeploymentProof,
  createStagingDeploymentProofFromFile,
  observeStagingDeployment,
  runCli,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
  validateStagingDeploymentProof,
} from "./staging-deployment-proof.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "staging-deployment-proof.mjs",
);

const SOURCE_SHA = "7161888933f6b601c6d37fe5c692ba23ffc55e27";
const VERSION_IDS = Object.freeze([
  "cf792fa3-3d6e-485e-a5f8-0e595f88f8aa",
  "985506b8-1bc4-4ecf-b9e7-e14144f9d735",
  "d5e21478-f5ca-487a-af00-3af5501886f7",
  "97994e1a-21da-4a2b-9ff1-b7132f8ee6a7",
  "08c69247-cc1f-44ad-8bd0-7ff58825dbc1",
  "e7da36e8-7c29-44df-a672-ae132818d042",
  "2a7ed7f0-5b27-4e67-9f34-9ffb80d9a8d1",
]);
const DEPLOYMENT_IDS = Object.freeze([
  "12222222-2222-4222-8222-222222222221",
  "12222222-2222-4222-8222-222222222222",
  "12222222-2222-4222-8222-222222222223",
  "12222222-2222-4222-8222-222222222224",
  "12222222-2222-4222-8222-222222222225",
  "12222222-2222-4222-8222-222222222226",
  "12222222-2222-4222-8222-222222222227",
]);

function validRequest() {
  return {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: SOURCE_SHA,
  };
}

function version(index, overrides = {}) {
  return {
    id: VERSION_IDS[index],
    number: index + 1,
    metadata: {
      author_email: "release@punks.bot",
      author_id: "release-operator",
      created_on: `2026-08-24T00:00:0${index}Z`,
      has_preview: true,
      modified_on: `2026-08-24T00:00:0${index}Z`,
      source: "wrangler",
    },
    annotations: {
      "workers/message": sourceShaAnnotation(SOURCE_SHA),
      "workers/triggered_by": "version_upload",
    },
    ...overrides,
  };
}

function deployment(index, versionId = VERSION_IDS[index], overrides = {}) {
  return {
    id: DEPLOYMENT_IDS[index],
    created_on: `2026-08-24T01:00:0${index}Z`,
    source: "wrangler",
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: versionId }],
    annotations: { "workers/message": "staging release" },
    author_email: "release@punks.bot",
    ...overrides,
  };
}

function validRawObservation() {
  return {
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: SOURCE_SHA,
    workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
      name,
      versions: [version(index)],
      deployment: deployment(index),
    })),
  };
}

function boundaryFor(rawObservation = validRawObservation(), calls = []) {
  return {
    async observe(request) {
      calls.push(structuredClone(request));
      return structuredClone(rawObservation);
    },
  };
}

async function validObservation() {
  return observeStagingDeployment(validRequest(), boundaryFor());
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function apiEnvelope(result, extra = {}) {
  return {
    result,
    success: true,
    errors: [],
    messages: [],
    ...extra,
  };
}

test("creates a deterministic complete proof only from a remotely validated observation", async () => {
  const observation = await validObservation();
  const proof = createStagingDeploymentProof(observation);

  assert.deepEqual(proof, {
    schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
    accountId: CANONICAL_STAGING_ACCOUNT_ID,
    environment: "staging",
    sourceSha: SOURCE_SHA,
    observer: "cloudflare-remote",
    workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
      name,
      versionId: VERSION_IDS[index],
      sourceShaAnnotation: sourceShaAnnotation(SOURCE_SHA),
      deploymentId: DEPLOYMENT_IDS[index],
    })),
    deploymentId:
      "sha256:420e3bc9f7c0cf2064c2760bf853b2279791d30340bbc637db9621ba3ab5bb7e",
  });
  assert.doesNotMatch(JSON.stringify(proof), /token|credential|author_email/i);
  assert.deepEqual(createStagingDeploymentProof(observation), proof);
  assert.deepEqual(
    validateStagingDeploymentProof(
      JSON.parse(JSON.stringify(proof)),
      validRequest(),
    ),
    proof,
  );
});

test("serialized proof validation rejects identity, material and digest mutations", async () => {
  const proof = createStagingDeploymentProof(await validObservation());
  for (const mutate of [
    (candidate) => {
      candidate.sourceSha = "b".repeat(40);
    },
    (candidate) => {
      candidate.workers[0].versionId = VERSION_IDS[1];
    },
    (candidate) => {
      candidate.workers.reverse();
    },
    (candidate) => {
      candidate.observer = "local-file";
    },
    (candidate) => {
      candidate.extra = true;
    },
    (candidate) => {
      candidate.deploymentId = `sha256:${"0".repeat(64)}`;
    },
  ]) {
    const candidate = JSON.parse(JSON.stringify(proof));
    mutate(candidate);
    assert.throws(
      () => validateStagingDeploymentProof(candidate, validRequest()),
      /proof|identity|digest|observer|exactly|canonical|annotation/,
    );
  }
});

test("binds the remote observation request to the canonical account, staging, and source SHA", async () => {
  const calls = [];
  await observeStagingDeployment(validRequest(), boundaryFor(undefined, calls));
  assert.deepEqual(calls, [validRequest()]);

  for (const [key, value, pattern] of [
    ["accountId", "0".repeat(32), /canonical staging account/],
    ["environment", "production", /environment must be exactly staging/],
    ["sourceSha", SOURCE_SHA.toUpperCase(), /lowercase Git SHA/],
  ]) {
    const request = validRequest();
    request[key] = value;
    await assert.rejects(
      observeStagingDeployment(request, boundaryFor()),
      pattern,
    );
  }
});

test("rejects the old forgeable JSON shape and unbranded observations", async () => {
  const forged = {
    sourceSha: SOURCE_SHA,
    workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
      name,
      versionId: VERSION_IDS[index],
    })),
  };
  assert.throws(
    () => createStagingDeploymentProof(forged),
    /validated remote observation/,
  );
  assert.throws(
    () => createStagingDeploymentProof(validRawObservation()),
    /validated remote observation/,
  );

  const directory = await mkdtemp(join(tmpdir(), "punks-forged-proof-"));
  const path = join(directory, "deployment.json");
  await writeFile(path, JSON.stringify(forged));
  await assert.rejects(
    createStagingDeploymentProofFromFile(path),
    /file input is disabled.*remote observation is required/,
  );
});

test("rejects an absent canonical Worker including a missing bot runtime", async () => {
  const raw = validRawObservation();
  raw.workers.pop();
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(raw)),
    /workers must contain exactly 7 entries/,
  );
});

test("rejects unknown Workers and non-canonical Worker order", async () => {
  const unknown = validRawObservation();
  unknown.workers[6].name = "punks-invented-runtime-staging";
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(unknown)),
    /expected punks-bot-runtime-staging at index 6/,
  );

  const reordered = validRawObservation();
  [reordered.workers[0], reordered.workers[1]] = [
    reordered.workers[1],
    reordered.workers[0],
  ];
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(reordered)),
    /expected punks-auth-staging at index 0/,
  );
});

test("rejects observations whose account, environment, or SHA differs from the request", async () => {
  for (const [key, value, pattern] of [
    ["accountId", "0".repeat(32), /observed accountId does not match/],
    ["environment", "production", /observed environment does not match/],
    ["sourceSha", "f".repeat(40), /observed sourceSha does not match/],
  ]) {
    const raw = validRawObservation();
    raw[key] = value;
    await assert.rejects(
      observeStagingDeployment(validRequest(), boundaryFor(raw)),
      pattern,
    );
  }
});

test("rejects missing, mismatched, and ambiguous SHA annotations", async () => {
  const missing = validRawObservation();
  missing.workers[0].versions[0].annotations = {
    "workers/triggered_by": "version_upload",
  };
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(missing)),
    /punks-auth-staging has no version with exact source SHA annotation/,
  );

  const mismatched = validRawObservation();
  mismatched.workers[0].versions[0].annotations["workers/message"] =
    sourceShaAnnotation("f".repeat(40));
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(mismatched)),
    /punks-auth-staging has no version with exact source SHA annotation/,
  );

  const ambiguous = validRawObservation();
  ambiguous.workers[0].versions.push(
    version(0, { id: "72222222-2222-4222-8222-222222222222", number: 42 }),
  );
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(ambiguous)),
    /punks-auth-staging has 2 versions with the exact source SHA annotation/,
  );
});

test("rejects secret and every other non-upload version even with the exact SHA annotation", async () => {
  for (const trigger of ["secret", "rollback", "promotion"]) {
    const raw = validRawObservation();
    raw.workers[6].versions[0].annotations["workers/triggered_by"] = trigger;
    await assert.rejects(
      observeStagingDeployment(validRequest(), boundaryFor(raw)),
      new RegExp(`punks-bot-runtime-staging.*${trigger}.*not an upload`),
    );
  }
});

test("accepts the previous Cloudflare upload trigger spelling", async () => {
  const raw = validRawObservation();
  for (const worker of raw.workers) {
    worker.versions[0].annotations["workers/triggered_by"] = "upload";
  }
  await assert.doesNotReject(
    observeStagingDeployment(validRequest(), boundaryFor(raw)),
  );
});

test("rejects malformed, duplicate, and fake version UUIDs unless remotely observed", async () => {
  const malformed = validRawObservation();
  malformed.workers[6].versions[0].id = "fake-bot-runtime-version";
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(malformed)),
    /lowercase RFC 4122 UUID/,
  );

  const duplicate = validRawObservation();
  duplicate.workers[6].versions[0].id = VERSION_IDS[5];
  duplicate.workers[6].deployment.versions[0].version_id = VERSION_IDS[5];
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(duplicate)),
    /duplicate observed Worker version UUID/,
  );
});

test("requires the annotated version to be the sole active deployment at 100 percent", async () => {
  const inactive = validRawObservation();
  inactive.workers[0].deployment.versions[0].version_id = VERSION_IDS[1];
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(inactive)),
    /latest deployment does not exclusively activate observed version/,
  );

  const split = validRawObservation();
  split.workers[0].deployment.versions = [
    { percentage: 90, version_id: VERSION_IDS[0] },
    { percentage: 10, version_id: VERSION_IDS[1] },
  ];
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(split)),
    /latest deployment does not exclusively activate observed version/,
  );

  const partial = validRawObservation();
  partial.workers[0].deployment.versions[0].percentage = 99;
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(partial)),
    /latest deployment does not exclusively activate observed version/,
  );
});

test("rejects a deployment observation with a non-canonical Cloudflare source", async () => {
  const raw = validRawObservation();
  raw.workers[0].deployment.source = "user-json";
  await assert.rejects(
    observeStagingDeployment(validRequest(), boundaryFor(raw)),
    /deployment\.source is not a canonical Cloudflare source/,
  );
});

test("rejects unknown keys at every user-controlled observation boundary", async () => {
  const cases = [
    [
      () => ({ ...validRequest(), bypass: true }),
      /request must contain exactly/,
    ],
    [
      () => ({ ...validRawObservation(), bypass: true }),
      /remote observation must contain exactly/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].bypass = true;
        return raw;
      },
      /workers\[0\] must contain exactly/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].versions[0].bypass = true;
        return raw;
      },
      /versions\[0\] contains unknown key: bypass/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].versions[0].metadata.bypass = true;
        return raw;
      },
      /metadata contains unknown key: bypass/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].versions[0].metadata.hasPreview = true;
        return raw;
      },
      /ambiguous preview metadata/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].versions[0].annotations.bypass = true;
        return raw;
      },
      /annotations contains unknown key: bypass/,
    ],
    [
      () => {
        const raw = validRawObservation();
        raw.workers[0].deployment.bypass = true;
        return raw;
      },
      /deployment contains unknown key: bypass/,
    ],
  ];

  for (const [factory, pattern] of cases) {
    const value = factory();
    if ("workers" in value) {
      await assert.rejects(
        observeStagingDeployment(validRequest(), boundaryFor(value)),
        pattern,
      );
    } else {
      await assert.rejects(
        observeStagingDeployment(value, boundaryFor()),
        pattern,
      );
    }
  }
});

test("the Cloudflare API boundary performs only authenticated read requests", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const workerIndex = CANONICAL_STAGING_WORKER_NAMES.findIndex((name) =>
      String(url).includes(`/scripts/${name}/`),
    );
    assert.notEqual(workerIndex, -1);
    if (String(url).includes("/versions?")) {
      return jsonResponse(
        apiEnvelope(
          { items: [version(workerIndex)] },
          {
            result_info: {
              page: 1,
              per_page: 100,
              count: 1,
              total_count: 1,
              total_pages: 1,
            },
            errors: null,
            messages: null,
          },
        ),
      );
    }
    if (String(url).endsWith("/deployments")) {
      return jsonResponse(
        apiEnvelope({ deployments: [deployment(workerIndex)] }),
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const boundary = createCloudflareApiBoundary({
    apiToken: "a-secure-cloudflare-api-token-value",
    fetchImpl,
  });

  const observation = await observeStagingDeployment(validRequest(), boundary);
  assert.equal(observation.workers.length, 7);
  assert.equal(calls.length, 14);
  for (const { url, init } of calls) {
    assert.match(url, new RegExp(`/accounts/${CANONICAL_STAGING_ACCOUNT_ID}/`));
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(
      init.headers.Authorization,
      "Bearer a-secure-cloudflare-api-token-value",
    );
    assert.doesNotMatch(url, /workers\/ai|\/ai\//i);
  }
});

test("the Cloudflare API boundary fails closed on auth, HTTP, media type, and envelope errors", async () => {
  assert.throws(
    () => createCloudflareApiBoundary({ apiToken: "", fetchImpl: fetch }),
    /CLOUDFLARE_API_TOKEN is required/,
  );

  for (const [response, pattern] of [
    [
      new Response("denied", { status: 403 }),
      /Cloudflare API request failed.*403/,
    ],
    [
      new Response("{}", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      /must return application\/json/,
    ],
    [
      jsonResponse({ success: false, result: { items: [] } }),
      /invalid API envelope/,
    ],
    [
      jsonResponse(apiEnvelope({ items: [] }, { forged: true })),
      /Cloudflare API envelope contains unknown key: forged/,
    ],
    [
      jsonResponse({
        ...apiEnvelope({ items: [] }),
        messages: [{ code: 1, message: "warning" }],
      }),
      /invalid API envelope/,
    ],
  ]) {
    const boundary = createCloudflareApiBoundary({
      apiToken: "a-secure-cloudflare-api-token-value",
      fetchImpl: async () => response.clone(),
    });
    await assert.rejects(
      observeStagingDeployment(validRequest(), boundary),
      pattern,
    );
  }
});

test("a remotely absent bot runtime cannot be replaced by a user-provided UUID", async () => {
  const boundary = createCloudflareApiBoundary({
    apiToken: "a-secure-cloudflare-api-token-value",
    fetchImpl: async (url) => {
      if (String(url).includes("punks-bot-runtime-staging")) {
        return new Response("worker missing", { status: 404 });
      }
      const index = CANONICAL_STAGING_WORKER_NAMES.findIndex((name) =>
        String(url).includes(`/scripts/${name}/`),
      );
      return String(url).includes("/versions?")
        ? jsonResponse(apiEnvelope({ items: [version(index)] }))
        : jsonResponse(apiEnvelope({ deployments: [deployment(index)] }));
    },
  });

  await assert.rejects(
    observeStagingDeployment(validRequest(), boundary),
    /punks-bot-runtime-staging.*404/,
  );
});

test("the normal CLI rejects file/capture bypasses and unknown options", async () => {
  for (const args of [
    ["--input", "/tmp/forged.json"],
    [
      "--account-id",
      CANONICAL_STAGING_ACCOUNT_ID,
      "--environment",
      "staging",
      "--source-sha",
      SOURCE_SHA,
      "--observation",
      "/tmp/forged.json",
    ],
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, ...args], {
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: "",
        },
      }),
      /usage:.*--account-id.*--environment.*--source-sha/s,
    );
  }
});

test("the normal CLI cannot emit a proof without authenticated remote access", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--account-id",
        CANONICAL_STAGING_ACCOUNT_ID,
        "--environment",
        "staging",
        "--source-sha",
        SOURCE_SHA,
      ],
      {
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: "",
        },
      },
    ),
    /CLOUDFLARE_API_TOKEN is required/,
  );
});

test("the CLI library entry uses its injected remote boundary but exposes no skip flag", async () => {
  const calls = [];
  const proof = await runCli(
    [
      "--source-sha",
      SOURCE_SHA,
      "--environment",
      "staging",
      "--account-id",
      CANONICAL_STAGING_ACCOUNT_ID,
    ],
    { boundary: boundaryFor(undefined, calls) },
  );
  assert.equal(proof.deploymentId.startsWith("sha256:"), true);
  assert.deepEqual(calls, [validRequest()]);

  await assert.rejects(
    runCli(
      [
        "--account-id",
        CANONICAL_STAGING_ACCOUNT_ID,
        "--environment",
        "staging",
        "--source-sha",
        SOURCE_SHA,
        "--skip-remote",
      ],
      { boundary: boundaryFor() },
    ),
    /usage:/,
  );
});
