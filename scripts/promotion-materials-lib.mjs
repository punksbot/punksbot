/**
 * Validation pure des matériaux externes qui ferment une promotion desktop.
 *
 * Le validateur générique ne connaît aucune story ni autorité propre à une
 * tranche. Il consomme ce profil versionné, puis recoupe le matériau staging
 * et le manifeste agrégé avec les octets installés cités par le dossier.
 */

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/;
const COORDINATE_RE = /^[a-z][a-z0-9-]*$/;
const WORKER_RE = /^[a-z][a-z0-9-]*$/;
const BINDING_RE = /^[A-Z][A-Z0-9_]*$/;
const CLASS_RE = /^[A-Z][A-Za-z0-9]*DO$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLATFORMS = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];
const INSTALLED_RELEASE_SUFFIXES = Object.freeze({
  "macos-arm64": [".app.tar.gz", ".app.tar.gz.sig"],
  "macos-x64": [".app.tar.gz", ".app.tar.gz.sig"],
  "linux-x64": [".AppImage", ".AppImage.sig"],
  "windows-x64": [".exe", ".exe.sig"],
});

function fail(message) {
  throw new Error(message);
}

function parseJson(content, label) {
  try {
    return JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

function uniqueCoordinates(values, label) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !COORDINATE_RE.test(value ?? ""))
  ) {
    fail(`${label} must be a non-empty coordinate list`);
  }
  if (new Set(values).size !== values.length) {
    fail(`${label} contains duplicate coordinates`);
  }
  return [...values];
}

/** Valide la référence fermée du profil portée par le dossier. */
export function validatePromotionProfileDescriptor(
  descriptor,
  { expectedSha256 } = {},
) {
  exactKeys(
    descriptor,
    ["id", "materiau", "materiau-sha256"],
    "promotion profile descriptor",
  );
  if (
    !/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(descriptor.id ?? "") ||
    descriptor.materiau !== "cloudflare/promotion-profiles.json" ||
    !SHA256_RE.test(descriptor["materiau-sha256"] ?? "") ||
    (expectedSha256 !== undefined &&
      descriptor["materiau-sha256"] !== expectedSha256)
  ) {
    fail("promotion profile descriptor is divergent");
  }
  return descriptor;
}

/** Sélectionne et valide le profil fermé de la tranche demandée. */
export function validatePromotionProfilesContent(content, { tranche }) {
  const manifest = parseJson(content, "promotion profiles material");
  exactKeys(manifest, ["schema", "profiles"], "promotion profiles material");
  if (
    manifest.schema !== "punks.promotion-profiles.v1" ||
    !Array.isArray(manifest.profiles) ||
    manifest.profiles.length === 0
  ) {
    fail("promotion profiles material has an invalid schema or profile list");
  }
  const tranches = new Set();
  const profileIds = new Set();
  let selected;
  for (const profile of manifest.profiles) {
    exactKeys(
      profile,
      ["tranche", "id", "stories", "authorities"],
      "promotion profile",
    );
    if (
      !Number.isInteger(profile.tranche) ||
      profile.tranche < 1 ||
      !/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(profile.id ?? "") ||
      tranches.has(profile.tranche) ||
      profileIds.has(profile.id)
    ) {
      fail("promotion profile has a duplicate or invalid identity");
    }
    tranches.add(profile.tranche);
    profileIds.add(profile.id);
    const stories = uniqueCoordinates(profile.stories, "profile stories");
    if (
      !Array.isArray(profile.authorities) ||
      profile.authorities.length === 0
    ) {
      fail("profile authorities must be a non-empty list");
    }
    const authorityIds = new Set();
    const authorities = profile.authorities.map((authority) => {
      const durableObject = authority?.kind === "durable-object";
      exactKeys(
        authority,
        durableObject
          ? ["id", "kind", "worker", "binding", "className"]
          : ["id", "kind", "worker"],
        "promotion authority",
      );
      if (
        !COORDINATE_RE.test(authority.id ?? "") ||
        authorityIds.has(authority.id) ||
        !WORKER_RE.test(authority.worker ?? "") ||
        (!durableObject && authority.kind !== "service") ||
        (durableObject &&
          (!BINDING_RE.test(authority.binding ?? "") ||
            !CLASS_RE.test(authority.className ?? "")))
      ) {
        fail("promotion authority has an invalid or duplicate coordinate");
      }
      authorityIds.add(authority.id);
      return { ...authority };
    });
    if (profile.tranche === tranche) {
      selected = { ...profile, stories, authorities };
    }
  }
  if (selected === undefined) {
    fail(`promotion profile for tranche ${String(tranche)} is missing`);
  }
  return selected;
}

/** Extrait les identifiants et Workers du matériau staging versionné. */
export function validateStagingMaterialContent(content) {
  const material = parseJson(content, "staging material");
  const accountId = material?.account?.id;
  const zoneId = material?.zone?.id;
  const workers = Object.values(material?.workers ?? {}).map(
    (worker) => worker?.name,
  );
  if (
    material?.environment !== "staging" ||
    !/^[0-9a-f]{32}$/.test(accountId ?? "") ||
    !/^[0-9a-f]{32}$/.test(zoneId ?? "") ||
    workers.length === 0 ||
    workers.some((worker) => !WORKER_RE.test(worker ?? "")) ||
    new Set(workers).size !== workers.length
  ) {
    fail(
      "staging material does not expose exact staging identifiers and workers",
    );
  }
  return {
    environment: material.environment,
    accountId,
    zoneId,
    workers,
  };
}

/** Valide la projection fermée des versions Workers observées à distance. */
export function validateDeployedWorkerDescriptors(workers) {
  if (!Array.isArray(workers) || workers.length === 0) {
    fail("deployed workers must be a non-empty list");
  }
  const names = new Set();
  return workers.map((worker) => {
    exactKeys(worker, ["name", "versionId", "deploymentId"], "deployed worker");
    if (
      !WORKER_RE.test(worker.name ?? "") ||
      !UUID_RE.test(worker.versionId ?? "") ||
      !UUID_RE.test(worker.deploymentId ?? "") ||
      names.has(worker.name)
    ) {
      fail("deployed worker has an invalid or duplicate identity");
    }
    names.add(worker.name);
    return { ...worker };
  });
}

/**
 * Lie l'artefact installé au rôle updater canonique de sa plateforme et du
 * commit candidat, tel qu'il est nommé par l'agrégateur de release.
 */
export function validateInstalledReleaseNames({
  platform,
  candidateSha,
  artifactName,
  signatureName,
}) {
  const suffixes = INSTALLED_RELEASE_SUFFIXES[platform];
  if (suffixes === undefined || !SHA1_RE.test(candidateSha ?? "")) {
    fail("installed release identity has an invalid platform or candidate SHA");
  }
  const prefix = `punks-desktop-${platform}-${candidateSha}`;
  if (
    artifactName !== `${prefix}${suffixes[0]}` ||
    signatureName !== `${prefix}${suffixes[1]}`
  ) {
    fail(
      "installed release names do not match the exact platform updater roles",
    );
  }
  return { artifactName, signatureName };
}

function decodeRuntimeVersionsHeader(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail("installed runtime versions header is not canonical base64url");
  }
  const content = Buffer.from(value, "base64url");
  if (content.toString("base64url") !== value) {
    fail("installed runtime versions header is not canonical base64url");
  }
  return parseJson(content, "installed runtime versions header");
}

const FOLLOW_SCENARIOS = Object.freeze({
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
});

function nonEmptyCoordinate(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    value.trim() === value
  );
}

function validateFollowEvidence(follow, requests) {
  exactKeys(
    follow,
    ["protocol", "request", "trace", "scenarios", "distributed"],
    "installed FOLLOW evidence",
  );
  exactKeys(
    follow.distributed,
    ["proofSha256", "observedAt", "catchUpFrames", "cursors", "scenarios"],
    "distributed FOLLOW evidence",
  );
  exactKeys(
    follow.distributed.cursors,
    ["initial", "live", "crashBeforeAck", "replay"],
    "distributed FOLLOW cursors",
  );
  exactKeys(
    follow.distributed.scenarios,
    [
      "catchUpAckReady",
      "liveChangeAck",
      "crashBeforeAckReplay",
      "afterAckNoReplay",
      "revokedSessionRejected",
    ],
    "distributed FOLLOW scenarios",
  );
  const distributed = follow.distributed;
  if (
    !SHA256_RE.test(distributed.proofSha256 ?? "") ||
    typeof distributed.observedAt !== "string" ||
    !Number.isFinite(Date.parse(distributed.observedAt)) ||
    !Number.isSafeInteger(distributed.catchUpFrames) ||
    distributed.catchUpFrames < 1 ||
    !Number.isSafeInteger(distributed.cursors.initial) ||
    !Number.isSafeInteger(distributed.cursors.live) ||
    !Number.isSafeInteger(distributed.cursors.crashBeforeAck) ||
    !Number.isSafeInteger(distributed.cursors.replay) ||
    distributed.cursors.initial >= distributed.cursors.live ||
    distributed.cursors.live >= distributed.cursors.crashBeforeAck ||
    distributed.cursors.crashBeforeAck !== distributed.cursors.replay ||
    Object.values(distributed.scenarios).some((result) => result !== "vert")
  ) {
    fail("distributed FOLLOW evidence is not exact and green");
  }
  exactKeys(
    follow.request,
    ["transport", "method", "origin", "path", "status"],
    "installed FOLLOW request",
  );
  if (
    follow.protocol !== "punks.follow.v1" ||
    follow.request.transport !== "wss" ||
    follow.request.method !== "FOLLOW" ||
    follow.request.origin !== "wss://staging.punks.bot" ||
    !/^\/api\/v1\/workspaces\/[^/]+\/conversations\/[^/]+\/follow$/u.test(
      follow.request.path ?? "",
    ) ||
    follow.request.status !== 101 ||
    !requests.some(
      (request) => JSON.stringify(request) === JSON.stringify(follow.request),
    )
  ) {
    fail("installed FOLLOW request is not the successful public WSS contract");
  }
  if (!Array.isArray(follow.trace) || follow.trace.length < 7) {
    fail("installed FOLLOW trace is incomplete");
  }
  const accepted = follow.trace[0];
  exactKeys(accepted, ["state", "cursor"], "FOLLOW accepted trace");
  if (accepted.state !== "accepted" || !nonEmptyCoordinate(accepted.cursor)) {
    fail("installed FOLLOW trace must start at accepted with an opaque cursor");
  }
  let cursor = accepted.cursor;
  let index = 1;
  let batches = 0;
  let ready = false;
  let live = false;
  let terminal = false;
  const batchIds = new Set();
  while (index < follow.trace.length) {
    const entry = follow.trace[index];
    if (entry?.state === "changes") {
      const changes = entry;
      const renderer = follow.trace[index + 1];
      const ack = follow.trace[index + 2];
      exactKeys(
        changes,
        ["state", "previousCursor", "cursor", "batchId", "atomic"],
        "FOLLOW changes trace",
      );
      exactKeys(renderer, ["state", "cursor"], "FOLLOW renderer confirmation");
      exactKeys(ack, ["state", "cursor"], "FOLLOW ACK trace");
      if (
        terminal ||
        changes.previousCursor !== cursor ||
        !nonEmptyCoordinate(changes.cursor) ||
        changes.cursor === cursor ||
        !nonEmptyCoordinate(changes.batchId) ||
        batchIds.has(changes.batchId) ||
        changes.atomic !== true ||
        renderer.state !== "renderer-confirmed" ||
        renderer.cursor !== changes.cursor ||
        ack.state !== "ack" ||
        ack.cursor !== changes.cursor
      ) {
        fail(
          "installed FOLLOW changes must be contiguous, atomic and ACKed only after renderer confirmation",
        );
      }
      cursor = changes.cursor;
      batchIds.add(changes.batchId);
      batches += 1;
      index += 3;
      continue;
    }
    exactKeys(entry, ["state", "cursor"], "FOLLOW lifecycle trace");
    if (entry.state === "ready" && !ready && !live && entry.cursor === cursor) {
      ready = true;
    } else if (
      entry.state === "live" &&
      ready &&
      !live &&
      entry.cursor === cursor
    ) {
      live = true;
    } else if (
      entry.state === "terminal" &&
      ready &&
      live &&
      !terminal &&
      entry.cursor === cursor &&
      index === follow.trace.length - 1
    ) {
      terminal = true;
    } else {
      fail("installed FOLLOW trace has an unexpected lifecycle");
    }
    index += 1;
  }
  if (batches === 0 || !ready || !live || !terminal) {
    fail("installed FOLLOW trace is missing changes, ready, live or terminal");
  }
  exactKeys(
    follow.scenarios,
    Object.keys(FOLLOW_SCENARIOS),
    "installed FOLLOW scenarios",
  );
  if (
    Object.entries(FOLLOW_SCENARIOS).some(
      ([scenario, result]) => follow.scenarios[scenario] !== result,
    )
  ) {
    fail(
      "installed FOLLOW evidence does not prove snapshot, cursor, crash, resync and terminal scenarios",
    );
  }
}

/**
 * Recoupe la réponse de compatibilité HTTPS et le trafic FOLLOW observés par
 * l'application installée avec les sept versions Workers réellement déployées.
 */
export function validateInstalledNetworkBinding(network, { deployedWorkers }) {
  exactKeys(
    network,
    ["deployment", "requests", "follow"],
    "installed network evidence",
  );
  exactKeys(
    network.deployment,
    [
      "transport",
      "method",
      "origin",
      "path",
      "status",
      "responseHeader",
      "responseHeaderValue",
      "workers",
    ],
    "installed network deployment binding",
  );
  const deployment = network.deployment;
  const expectedWorkers = validateDeployedWorkerDescriptors(
    deployedWorkers,
  ).map(({ name, versionId }) => ({ name, versionId }));
  const expectedHeaderValue = Buffer.from(
    JSON.stringify(expectedWorkers),
  ).toString("base64url");
  const decodedWorkers = decodeRuntimeVersionsHeader(
    deployment.responseHeaderValue,
  );
  if (
    deployment.transport !== "https" ||
    deployment.method !== "POST" ||
    deployment.origin !== "https://staging.punks.bot" ||
    deployment.path !== "/api/v1/desktop/compatibility" ||
    deployment.status !== 200 ||
    deployment.responseHeader !== "x-punks-worker-versions" ||
    deployment.responseHeaderValue !== expectedHeaderValue ||
    JSON.stringify(deployment.workers) !== JSON.stringify(expectedWorkers) ||
    JSON.stringify(decodedWorkers) !== JSON.stringify(expectedWorkers)
  ) {
    fail(
      "installed network evidence is not bound to the staging Worker aggregate",
    );
  }
  if (!Array.isArray(network.requests) || network.requests.length < 2) {
    fail("installed network evidence must include HTTPS and FOLLOW requests");
  }
  const transports = new Set();
  let deploymentRequestObserved = false;
  let followRequestObserved = false;
  for (const request of network.requests) {
    exactKeys(
      request,
      ["transport", "method", "origin", "path", "status"],
      "installed network request",
    );
    const expectedOrigin =
      request.transport === "https"
        ? "https://staging.punks.bot"
        : request.transport === "wss"
          ? "wss://staging.punks.bot"
          : null;
    if (
      expectedOrigin === null ||
      request.origin !== expectedOrigin ||
      typeof request.method !== "string" ||
      !request.path.startsWith("/api/") ||
      !Number.isInteger(request.status) ||
      request.status < 100 ||
      request.status > 599 ||
      /punks|nostr|relay|huddle/iu.test(`${request.origin}${request.path}`)
    ) {
      fail("installed network evidence contains an invalid or legacy request");
    }
    transports.add(request.transport);
    deploymentRequestObserved ||=
      request.transport === deployment.transport &&
      request.method === deployment.method &&
      request.origin === deployment.origin &&
      request.path === deployment.path &&
      request.status === deployment.status;
    followRequestObserved ||=
      request.transport === "wss" &&
      request.method === "FOLLOW" &&
      /^\/api\/v1\/workspaces\/[^/]+\/conversations\/[^/]+\/follow$/u.test(
        request.path,
      ) &&
      request.status === 101;
  }
  if (
    !transports.has("https") ||
    !transports.has("wss") ||
    !deploymentRequestObserved ||
    !followRequestObserved
  ) {
    fail(
      "installed network evidence does not prove HTTPS, FOLLOW and version response",
    );
  }
  validateFollowEvidence(network.follow, network.requests);
  return network;
}

/**
 * Valide le manifeste agrégé original et sa liaison aux sujets installés.
 */
export function validateCandidateAggregateContent(
  content,
  {
    candidateSha,
    stagingDeploymentId,
    stagingProofSha256,
    promotionEvidenceDigests,
    repository,
    artifacts,
  },
) {
  const manifest = parseJson(content, "candidate aggregate manifest");
  exactKeys(
    manifest,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "version",
      "repository",
      "releaseTag",
      "stagingProof",
      "promotionEvidence",
      "platforms",
      "immutableLatest",
      "releaseAssets",
    ],
    "candidate aggregate manifest",
  );
  exactKeys(
    manifest.stagingProof,
    ["path", "sha256"],
    "aggregate staging proof",
  );
  exactKeys(
    manifest.promotionEvidence,
    ["platformIndex", "recoveryIndex", "stagingProof", "network"],
    "aggregate promotion evidence",
  );
  exactKeys(
    promotionEvidenceDigests,
    ["platformIndex", "recoveryIndex", "network"],
    "observed promotion evidence digests",
  );
  exactKeys(
    promotionEvidenceDigests.network,
    PLATFORMS,
    "observed promotion network digests",
  );
  if (
    !SHA256_RE.test(promotionEvidenceDigests.platformIndex ?? "") ||
    !SHA256_RE.test(promotionEvidenceDigests.recoveryIndex ?? "") ||
    PLATFORMS.some(
      (platform) =>
        !SHA256_RE.test(promotionEvidenceDigests.network[platform] ?? ""),
    )
  ) {
    fail("observed promotion evidence digest set is invalid");
  }
  for (const [name, expectedPath] of [
    ["platformIndex", "promotion-evidence/platform-index.json"],
    ["recoveryIndex", "promotion-evidence/recovery-index.json"],
    ["stagingProof", "promotion-evidence/staging-deployment-proof.json"],
  ]) {
    exactKeys(
      manifest.promotionEvidence[name],
      ["path", "sha256"],
      `aggregate promotion evidence ${name}`,
    );
    if (
      manifest.promotionEvidence[name].path !== expectedPath ||
      !SHA256_RE.test(manifest.promotionEvidence[name].sha256 ?? "") ||
      (name !== "stagingProof" &&
        manifest.promotionEvidence[name].sha256 !==
          promotionEvidenceDigests[name])
    ) {
      fail(`aggregate promotion evidence ${name} digest is divergent`);
    }
  }
  if (
    manifest.promotionEvidence.stagingProof.sha256 !== stagingProofSha256 ||
    !Array.isArray(manifest.promotionEvidence.network) ||
    manifest.promotionEvidence.network.length !== PLATFORMS.length
  ) {
    fail("aggregate promotion evidence staging or network matrix is divergent");
  }
  const networkPlatforms = new Set();
  for (const network of manifest.promotionEvidence.network) {
    exactKeys(
      network,
      ["platform", "path", "sha256"],
      "aggregate promotion network evidence",
    );
    if (
      !PLATFORMS.includes(network.platform) ||
      networkPlatforms.has(network.platform) ||
      network.path !== `promotion-evidence/network/${network.platform}.json` ||
      !SHA256_RE.test(network.sha256 ?? "") ||
      network.sha256 !== promotionEvidenceDigests.network[network.platform]
    ) {
      fail(
        "aggregate promotion network evidence digest is invalid or duplicated",
      );
    }
    networkPlatforms.add(network.platform);
  }
  exactKeys(
    manifest.immutableLatest,
    ["path", "sha256"],
    "aggregate immutable latest",
  );
  if (
    manifest.schema !== "punks.desktop-candidate-aggregate.v1" ||
    !SHA1_RE.test(candidateSha ?? "") ||
    !DEPLOYMENT_RE.test(stagingDeploymentId ?? "") ||
    !SHA256_RE.test(stagingProofSha256 ?? "") ||
    manifest.sourceSha !== candidateSha ||
    manifest.stagingDeploymentId !== stagingDeploymentId ||
    manifest.repository !== repository ||
    manifest.releaseTag !== `punks-staging-${candidateSha}` ||
    manifest.stagingProof.path !== "staging-deployment-proof.json" ||
    manifest.stagingProof.sha256 !== stagingProofSha256 ||
    manifest.immutableLatest.path !==
      `release-assets/latest-${candidateSha}.json` ||
    !SHA256_RE.test(manifest.immutableLatest.sha256 ?? "")
  ) {
    fail("candidate aggregate identity is divergent");
  }
  if (!Array.isArray(manifest.platforms)) {
    fail("candidate aggregate platforms must be an array");
  }
  const platformNames = manifest.platforms.map((platform) => {
    exactKeys(
      platform,
      ["platform", "target", "manifestSha256", "provenanceSha256"],
      "aggregate platform",
    );
    if (
      !PLATFORMS.includes(platform.platform) ||
      typeof platform.target !== "string" ||
      !SHA256_RE.test(platform.manifestSha256 ?? "") ||
      !SHA256_RE.test(platform.provenanceSha256 ?? "")
    ) {
      fail("candidate aggregate platform is invalid");
    }
    return platform.platform;
  });
  if (
    platformNames.length !== PLATFORMS.length ||
    new Set(platformNames).size !== PLATFORMS.length ||
    !PLATFORMS.every((platform) => platformNames.includes(platform))
  ) {
    fail("candidate aggregate must contain the exact platform matrix");
  }
  if (!Array.isArray(manifest.releaseAssets)) {
    fail("candidate aggregate releaseAssets must be an array");
  }
  const assets = new Map();
  for (const asset of manifest.releaseAssets) {
    exactKeys(asset, ["name", "sha256", "size"], "aggregate release asset");
    if (
      typeof asset.name !== "string" ||
      asset.name.trim() === "" ||
      asset.name.includes("/") ||
      asset.name.includes("\\") ||
      !SHA256_RE.test(asset.sha256 ?? "") ||
      !Number.isInteger(asset.size) ||
      asset.size < 1 ||
      assets.has(asset.name)
    ) {
      fail("candidate aggregate release asset is invalid or duplicated");
    }
    assets.set(asset.name, asset);
  }
  const latestMutable = assets.get("latest.json");
  const latestImmuable = assets.get(`latest-${candidateSha}.json`);
  if (
    latestMutable?.sha256 !== manifest.immutableLatest.sha256 ||
    latestImmuable?.sha256 !== manifest.immutableLatest.sha256 ||
    latestMutable?.size !== latestImmuable?.size
  ) {
    fail("candidate aggregate latest metadata is absent or divergent");
  }
  for (const artifact of artifacts ?? []) {
    validateInstalledReleaseNames({
      platform: artifact?.plateforme,
      candidateSha,
      artifactName: artifact?.nom,
      signatureName: artifact?.signatureNom,
    });
    for (const expected of [
      {
        name: artifact?.nom,
        sha256: artifact?.sha256,
        size: artifact?.taille,
      },
      {
        name: artifact?.signatureNom,
        sha256: artifact?.signature,
        size: artifact?.signatureTaille,
      },
    ]) {
      const received = assets.get(expected.name);
      if (
        received?.sha256 !== expected.sha256 ||
        received?.size !== expected.size
      ) {
        fail(
          `installed artifact ${String(expected.name)} is absent or divergent`,
        );
      }
    }
  }
  return manifest;
}
