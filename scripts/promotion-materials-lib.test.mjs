import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { repoRoot } from "./render-withdrawal-inventory.mjs";
import {
  validateCandidateAggregateContent,
  validateDeployedWorkerDescriptors,
  validateInstalledNetworkBinding,
  validatePromotionProfilesContent,
  validateStagingMaterialContent,
} from "./promotion-materials-lib.mjs";

const SHA = "a".repeat(40);
const DEPLOYMENT = `sha256:${"b".repeat(64)}`;
const STAGING_PROOF_SHA256 = "c".repeat(64);
const ARTIFACTS = [
  {
    plateforme: "linux-x64",
    nom: `punks-desktop-linux-x64-${SHA}.AppImage`,
    sha256: "d".repeat(64),
    taille: 123,
    signatureNom: `punks-desktop-linux-x64-${SHA}.AppImage.sig`,
    signature: "e".repeat(64),
    signatureTaille: 45,
  },
];

test("le profil T1 ferme les récits et les autorités métier sans les confondre avec les Workers", () => {
  const content = readFileSync(
    join(repoRoot, "cloudflare/promotion-profiles.json"),
  );
  const profile = validatePromotionProfilesContent(content, { tranche: 1 });

  assert.deepEqual(profile.stories, [
    "connexion",
    "workspace",
    "lecture-live",
    "pagination",
    "publication",
    "reponse",
    "sujet",
    "reactions",
  ]);
  assert.deepEqual(
    profile.authorities.map(({ className }) => className).filter(Boolean),
    [
      "PunkDO",
      "IdentityClaimDO",
      "EmailClaimDO",
      "AuthTransactionDO",
      "DesktopDeliveryDO",
      "SessionDO",
      "PasskeyCeremonyDO",
      "PasskeyCredentialDO",
      "WorkspaceDO",
      "WorkspaceSlugDO",
      "ConversationDO",
      "MessageContentDO",
    ],
  );
  assert.deepEqual(
    profile.authorities
      .filter(({ kind }) => kind === "service")
      .map(({ id, worker }) => ({ id, worker })),
    [
      {
        id: "erasure-registry",
        worker: "punks-erasure-staging",
      },
      {
        id: "internal-event-signature",
        worker: "punks-attestation-staging",
      },
    ],
  );
});

test("le manifeste agrégé doit contenir les octets installés et leurs signatures exactes", () => {
  const manifest = {
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha: SHA,
    stagingDeploymentId: DEPLOYMENT,
    version: "1.0.0",
    repository: "punksbot/punksbot",
    releaseTag: `punks-staging-${SHA}`,
    stagingProof: {
      path: "staging-deployment-proof.json",
      sha256: STAGING_PROOF_SHA256,
    },
    platforms: [
      ["macos-arm64", "aarch64-apple-darwin"],
      ["macos-x64", "x86_64-apple-darwin"],
      ["linux-x64", "x86_64-unknown-linux-gnu"],
      ["windows-x64", "x86_64-pc-windows-msvc"],
    ].map(([platform, target], index) => ({
      platform,
      target,
      manifestSha256: String(index + 1).repeat(64),
      provenanceSha256: String(index + 5).repeat(64),
    })),
    immutableLatest: {
      path: `release-assets/latest-${SHA}.json`,
      sha256: "f".repeat(64),
    },
    releaseAssets: [
      {
        name: ARTIFACTS[0].nom,
        sha256: ARTIFACTS[0].sha256,
        size: ARTIFACTS[0].taille,
      },
      {
        name: ARTIFACTS[0].signatureNom,
        sha256: ARTIFACTS[0].signature,
        size: ARTIFACTS[0].signatureTaille,
      },
      { name: "latest.json", sha256: "f".repeat(64), size: 12 },
      {
        name: `latest-${SHA}.json`,
        sha256: "f".repeat(64),
        size: 12,
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateCandidateAggregateContent(Buffer.from(JSON.stringify(manifest)), {
      candidateSha: SHA,
      stagingDeploymentId: DEPLOYMENT,
      stagingProofSha256: STAGING_PROOF_SHA256,
      repository: "punksbot/punksbot",
      artifacts: ARTIFACTS,
    }),
  );

  const latest = manifest.releaseAssets.pop();
  assert.throws(
    () =>
      validateCandidateAggregateContent(Buffer.from(JSON.stringify(manifest)), {
        candidateSha: SHA,
        stagingDeploymentId: DEPLOYMENT,
        stagingProofSha256: STAGING_PROOF_SHA256,
        repository: "punksbot/punksbot",
        artifacts: ARTIFACTS,
      }),
    /latest/i,
  );
  manifest.releaseAssets.push(latest);

  manifest.releaseAssets[0].sha256 = "0".repeat(64);
  assert.throws(
    () =>
      validateCandidateAggregateContent(Buffer.from(JSON.stringify(manifest)), {
        candidateSha: SHA,
        stagingDeploymentId: DEPLOYMENT,
        stagingProofSha256: STAGING_PROOF_SHA256,
        repository: "punksbot/punksbot",
        artifacts: ARTIFACTS,
      }),
    /installed artifact|artefact installé/i,
  );
});

test("le matériau staging expose séparément les identifiants et les Workers", () => {
  const material = validateStagingMaterialContent(
    readFileSync(join(repoRoot, "cloudflare/staging.resources.json")),
  );
  assert.equal(material.environment, "staging");
  assert.match(material.accountId, /^[0-9a-f]{32}$/);
  assert.match(material.zoneId, /^[0-9a-f]{32}$/);
  assert.ok(material.workers.includes("punks-api-staging"));
  assert.ok(material.workers.includes("punks-auth-staging"));
});

test("le trafic installé lie l'en-tête brut aux sept versions distantes exactes", () => {
  const deployedWorkers = [
    "punks-auth-staging",
    "punks-attestation-staging",
    "punks-erasure-staging",
    "punks-projector-staging",
    "punks-search-staging",
    "punks-api-staging",
    "punks-bot-runtime-staging",
  ].map((name, index) => ({
    name,
    versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  }));
  const workers = deployedWorkers.map(({ name, versionId }) => ({
    name,
    versionId,
  }));
  const responseHeaderValue = Buffer.from(JSON.stringify(workers)).toString(
    "base64url",
  );
  const network = {
    deployment: {
      transport: "https",
      method: "POST",
      origin: "https://staging.punks.bot",
      path: "/api/v1/desktop/compatibility",
      status: 200,
      responseHeader: "x-punks-worker-versions",
      responseHeaderValue,
      workers,
    },
    requests: [
      {
        transport: "https",
        method: "POST",
        origin: "https://staging.punks.bot",
        path: "/api/v1/desktop/compatibility",
        status: 200,
      },
      {
        transport: "wss",
        method: "FOLLOW",
        origin: "wss://staging.punks.bot",
        path: "/api/v1/workspaces/id/conversations/id/follow",
        status: 101,
      },
    ],
    follow: {
      protocol: "punks.follow.v1",
      request: {
        transport: "wss",
        method: "FOLLOW",
        origin: "wss://staging.punks.bot",
        path: "/api/v1/workspaces/id/conversations/id/follow",
        status: 101,
      },
      trace: [
        { state: "accepted", cursor: "cursor-0" },
        {
          state: "changes",
          previousCursor: "cursor-0",
          cursor: "cursor-1",
          batchId: "batch-1",
          atomic: true,
        },
        { state: "renderer-confirmed", cursor: "cursor-1" },
        { state: "ack", cursor: "cursor-1" },
        { state: "ready", cursor: "cursor-1" },
        { state: "live", cursor: "cursor-1" },
        { state: "terminal", cursor: "cursor-1" },
      ],
      scenarios: {
        snapshot: "vert",
        "pagination-concurrente": "vert",
        "changements-avant-ready": "vert",
        "doublon-exact": "ignore",
        trou: "resync",
        divergence: "resync",
        "crash-avant-ack": "rejoue",
        "crash-apres-ack": "ne-rejoue-pas",
        resync: "vert",
        terminal: "vert",
      },
    },
  };
  assert.doesNotThrow(() =>
    validateInstalledNetworkBinding(network, { deployedWorkers }),
  );

  for (const mutate of [
    (value) => (value.deployment.workers[0].versionId = crypto.randomUUID()),
    (value) => (value.deployment.responseHeaderValue = "Zm9yZ2Vk"),
    (value) =>
      (value.deployment.responseHeaderValue = Buffer.from(
        JSON.stringify(workers, null, 2),
      ).toString("base64url")),
    (value) => {
      const [first, ...rest] = workers;
      const duplicated = `[{"name":${JSON.stringify(first.name)},"name":${JSON.stringify(first.name)},"versionId":${JSON.stringify(first.versionId)}}${rest.map((worker) => `,${JSON.stringify(worker)}`).join("")}]`;
      value.deployment.responseHeaderValue =
        Buffer.from(duplicated).toString("base64url");
    },
    (value) => (value.deployment.path = "/api/v1/health"),
    (value) =>
      Object.assign(value.requests[1], {
        method: "GET",
        path: "/api/v1/not-follow",
        status: 500,
      }),
    (value) => value.follow.trace.splice(2, 1),
    (value) => (value.follow.trace[1].previousCursor = "cursor-forge"),
    (value) => (value.follow.trace[1].atomic = false),
    (value) => (value.follow.scenarios.trou = "vert"),
    (value) => value.requests.shift(),
  ]) {
    const forged = structuredClone(network);
    mutate(forged);
    assert.throws(() =>
      validateInstalledNetworkBinding(forged, { deployedWorkers }),
    );
  }
});

test("les Workers déployés conservent version et déploiement sans doublon", () => {
  const workers = validateDeployedWorkerDescriptors([
    {
      name: "punks-api-staging",
      versionId: "e7da36e8-7c29-44df-a672-ae132818d042",
      deploymentId: "10000000-0000-4000-8000-000000000001",
    },
  ]);
  assert.equal(workers[0].name, "punks-api-staging");
  assert.throws(() =>
    validateDeployedWorkerDescriptors([
      ...workers,
      { ...workers[0], deploymentId: crypto.randomUUID() },
    ]),
  );
});
