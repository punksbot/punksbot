import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateSigstoreBundleContent,
  verifyGithubSubject,
} from "../github-attestation-lib.mjs";
import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import { BUDGETS_PRODUCTION, PLATEFORMES } from "../release-graph-lib.mjs";
import { OPERATIONAL_BUDGET_PROVENANCE } from "./operational-budget-evidence.mjs";
import { validateOperationalInfrastructureReport } from "./operational-infrastructure-evidence.mjs";
import { readStableEvidenceFile } from "./stable-evidence-file.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const BACKEND_PATHS = ["/api/health", "/api/auth/v1/session", "/api/v1/punk"];
const CONNECTION_METHODS = ["google", "github"];
const MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1_000;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail(message) {
  throw new Error(`operational source collection rejected: ${message}`);
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function instant(value, label) {
  if (typeof value !== "string" || !INSTANT_RE.test(value)) {
    fail(`${label} is not a closed UTC instant`);
  }
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== normalized
  ) {
    fail(`${label} is invalid`);
  }
  return milliseconds;
}

function json(path, label) {
  try {
    return JSON.parse(readStableEvidenceFile(path, label).toString("utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("operational source collection rejected:")
    ) {
      throw error;
    }
    fail(`${label} is invalid JSON`);
  }
}

function parseJson(content, label) {
  try {
    return JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    fail(`${label} is invalid JSON`);
  }
}

function verifyReference(root, reference, label) {
  exact(reference, ["path", "sha256"], label);
  if (
    typeof reference.path !== "string" ||
    reference.path.startsWith("/") ||
    reference.path.includes("\\") ||
    reference.path.split("/").some((part) => ["", ".", ".."].includes(part)) ||
    !SHA256_RE.test(reference.sha256 ?? "")
  ) {
    fail(`${label} is invalid`);
  }
  const path = resolve(root, reference.path);
  const contained = relative(resolve(root), path);
  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`)
  ) {
    fail(`${label} escapes the candidate`);
  }
  const content = readStableEvidenceFile(path, label);
  if (sha256(content) !== reference.sha256) fail(`${label} digest diverges`);
  return content;
}

function validateEvidenceIndex(
  candidateRoot,
  reference,
  label,
  { sourceSha, stagingDeploymentId },
) {
  const content = verifyReference(candidateRoot, reference, label);
  const index = parseJson(content, label);
  exact(index, ["schema", "preuves"], label);
  if (
    index.schema !== "punks.promotion-evidence-index.v1" ||
    !Array.isArray(index.preuves) ||
    index.preuves.length === 0
  ) {
    fail(`${label} is empty or invalid`);
  }
  const evidenceRoot = resolve(candidateRoot, "promotion-evidence");
  const proofs = new Map();
  for (const [proofIndex, proofReference] of index.preuves.entries()) {
    exact(
      proofReference,
      ["id", "chemin", "sha256", "sujet"],
      `${label} proof reference ${proofIndex}`,
    );
    exact(
      proofReference.sujet,
      ["chemin", "sha256"],
      `${label} subject reference ${proofIndex}`,
    );
    if (
      typeof proofReference.id !== "string" ||
      proofReference.id.length === 0 ||
      proofs.has(proofReference.id)
    ) {
      fail(`${label} contains an invalid or duplicate proof ID`);
    }
    const proofContent = verifyReference(
      evidenceRoot,
      { path: proofReference.chemin, sha256: proofReference.sha256 },
      `${label} proof ${proofReference.id}`,
    );
    const subjectContent = verifyReference(
      evidenceRoot,
      {
        path: proofReference.sujet.chemin,
        sha256: proofReference.sujet.sha256,
      },
      `${label} subject ${proofReference.id}`,
    );
    const proof = parseJson(
      proofContent,
      `${label} proof ${proofReference.id}`,
    );
    exact(
      proof,
      [
        "schema",
        "id",
        "candidateSha",
        "stagingDeploymentId",
        "result",
        ...(proof.plateforme === undefined ? [] : ["plateforme"]),
        "data",
      ],
      `${label} proof ${proofReference.id}`,
    );
    if (
      proof.schema !== "punks.promotion-proof.v1" ||
      proof.id !== proofReference.id ||
      proof.candidateSha !== sourceSha ||
      proof.stagingDeploymentId !== stagingDeploymentId ||
      proof.result !== "vert" ||
      proof.data?.subjectSha256 !== proofReference.sujet.sha256
    ) {
      fail(`${label} proof ${proofReference.id} is not green and exact`);
    }
    proofs.set(proofReference.id, {
      proofSha256: proofReference.sha256,
      subjectSha256: proofReference.sujet.sha256,
      subjectContent,
    });
  }
  return { digest: reference.sha256, proofs };
}

function validateCandidate(root, sourceSha, stagingDeploymentId) {
  const aggregate = json(
    join(root, "aggregate-manifest.json"),
    "candidate aggregate manifest",
  );
  if (
    aggregate.schema !== "punks.desktop-candidate-aggregate.v1" ||
    aggregate.sourceSha !== sourceSha ||
    aggregate.stagingDeploymentId !== stagingDeploymentId ||
    aggregate.repository !== "punksbot/punksbot" ||
    aggregate.stagingProof?.path !== "staging-deployment-proof.json" ||
    aggregate.stagingProof?.sha256 !==
      aggregate.promotionEvidence?.stagingProof?.sha256 ||
    aggregate.promotionEvidence?.platformIndex?.path !==
      "promotion-evidence/platform-index.json" ||
    aggregate.promotionEvidence?.recoveryIndex?.path !==
      "promotion-evidence/recovery-index.json" ||
    aggregate.promotionEvidence?.stagingProof?.path !==
      "promotion-evidence/staging-deployment-proof.json" ||
    !Array.isArray(aggregate.platforms) ||
    JSON.stringify(aggregate.platforms.map(({ platform }) => platform)) !==
      JSON.stringify(PLATEFORMES) ||
    !Array.isArray(aggregate.promotionEvidence?.network) ||
    JSON.stringify(
      aggregate.promotionEvidence.network.map(({ platform }) => platform),
    ) !== JSON.stringify(PLATEFORMES) ||
    aggregate.promotionEvidence.platformIndex === undefined ||
    aggregate.promotionEvidence.recoveryIndex === undefined ||
    aggregate.promotionEvidence.stagingProof === undefined
  ) {
    fail("exact four-platform candidate aggregate is required");
  }
  const networks = new Map();
  for (const [
    index,
    reference,
  ] of aggregate.promotionEvidence.network.entries()) {
    if (
      reference.path !==
        `promotion-evidence/network/${reference.platform}.json` ||
      !SHA256_RE.test(reference.sha256 ?? "")
    ) {
      fail(`platform network evidence ${index} identity is invalid`);
    }
    verifyReference(
      root,
      { path: reference.path, sha256: reference.sha256 },
      `platform network evidence ${index}`,
    );
    networks.set(reference.platform, reference.sha256);
  }
  verifyReference(
    root,
    aggregate.promotionEvidence.stagingProof,
    "staging proof",
  );
  verifyReference(root, aggregate.stagingProof, "aggregate staging proof");
  const platform = validateEvidenceIndex(
    root,
    aggregate.promotionEvidence.platformIndex,
    "candidate platform evidence",
    { sourceSha, stagingDeploymentId },
  );
  const recovery = validateEvidenceIndex(
    root,
    aggregate.promotionEvidence.recoveryIndex,
    "candidate recovery evidence",
    { sourceSha, stagingDeploymentId },
  );
  if (
    [...platform.proofs.keys()].some((proofId) => recovery.proofs.has(proofId))
  ) {
    fail("candidate evidence contains a duplicate cross-index proof ID");
  }
  for (const [index, entry] of aggregate.platforms.entries()) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.target !== "string" ||
      entry.target.length === 0 ||
      !SHA256_RE.test(entry.manifestSha256 ?? "") ||
      !SHA256_RE.test(entry.provenanceSha256 ?? "")
    ) {
      fail(`candidate platform ${index} identity is invalid`);
    }
  }
  const evidenceRoot = resolve(root, "promotion-evidence");
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      const status = lstatSync(path);
      if (status.isSymbolicLink())
        fail("candidate evidence contains a symlink");
      if (status.isDirectory()) {
        walk(path);
      } else if (status.isFile() && entry.name.endsWith(".json")) {
        const content = readStableEvidenceFile(path, "candidate JSON evidence");
        files.push({
          path: relative(root, path).split(sep).join("/"),
          sha256: sha256(content),
        });
      }
    }
  };
  walk(evidenceRoot);
  if (files.length < 6) fail("candidate evidence corpus is incomplete");
  const aggregateSha256 = sha256(
    readStableEvidenceFile(
      join(root, "aggregate-manifest.json"),
      "candidate aggregate manifest",
    ),
  );
  const corpusSha256 = canonicalSha256({
    aggregateSha256,
    files,
  });
  return {
    sourceSha,
    stagingDeploymentId,
    corpusSha256,
    aggregateSha256,
    stagingProofSha256: aggregate.promotionEvidence.stagingProof.sha256,
    platformIndexSha256: platform.digest,
    recoveryIndexSha256: recovery.digest,
    platformProofs: platform.proofs,
    recoveryProofs: recovery.proofs,
    networks,
    platforms: new Map(
      aggregate.platforms.map((entry) => [entry.platform, entry]),
    ),
  };
}

function validateBackendReport(report, expected) {
  exact(
    report,
    [
      "schema",
      "sourceSha",
      "stagingDeploymentId",
      "origin",
      "endpoints",
      "observedAt",
      "sha256",
    ],
    "backend probe report",
  );
  const { sha256: digest, ...content } = report;
  if (
    report.schema !== "punks.operational-backend-proof.v2" ||
    report.sourceSha !== expected.sourceSha ||
    report.stagingDeploymentId !== expected.stagingDeploymentId ||
    report.origin !== "https://staging.punks.bot" ||
    digest !== canonicalSha256(content) ||
    !Array.isArray(report.endpoints) ||
    JSON.stringify(report.endpoints.map(({ path }) => path)) !==
      JSON.stringify(BACKEND_PATHS) ||
    !Number.isFinite(instant(report.observedAt, "backend probe observedAt"))
  ) {
    fail("backend probe report identity is invalid");
  }
  for (const [index, endpoint] of report.endpoints.entries()) {
    exact(
      endpoint,
      ["path", "authority", "status", "result", "responseSha256"],
      `backend endpoint ${index}`,
    );
    if (
      endpoint.authority !==
        ["api-public", "auth-session", "auth-punk"][index] ||
      !["vert", "rouge"].includes(endpoint.result) ||
      !(
        endpoint.status === null ||
        (Number.isSafeInteger(endpoint.status) &&
          endpoint.status >= 100 &&
          endpoint.status <= 599)
      ) ||
      !(
        endpoint.responseSha256 === null ||
        SHA256_RE.test(endpoint.responseSha256 ?? "")
      ) ||
      (endpoint.result === "vert" &&
        (endpoint.status !== 200 || endpoint.responseSha256 === null))
    ) {
      fail(`backend endpoint ${index} proof is invalid`);
    }
  }
  return report;
}

function dimensions(metric) {
  if (metric === "connexion-desktop-echecs-par-moyen") {
    return CONNECTION_METHODS;
  }
  if (metric === "desktop-sessions-avec-crash-par-plateforme") {
    return PLATEFORMES;
  }
  return [];
}

function closedCheck(id, evidenceSha256, result = "vert") {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    !SHA256_RE.test(evidenceSha256 ?? "") ||
    !["vert", "rouge"].includes(result)
  ) {
    fail("deterministic check identity is invalid");
  }
  return { id, evidenceSha256, result };
}

function requiredProof(proofs, proofId, checkId = proofId) {
  const proof = proofs.get(proofId);
  if (proof === undefined)
    fail(`required candidate proof ${proofId} is absent`);
  return closedCheck(checkId, proof.proofSha256);
}

function transcriptChecks(
  candidate,
  prefix = "transcript",
  onlyPlatform = null,
) {
  const platforms = onlyPlatform === null ? PLATEFORMES : [onlyPlatform];
  return platforms.map((platform) =>
    requiredProof(
      candidate.platformProofs,
      `transcript/${platform}`,
      `${prefix}/${platform}`,
    ),
  );
}

function authenticationChecks(candidate, method) {
  if (!CONNECTION_METHODS.includes(method)) {
    fail(`authentication method ${String(method)} is invalid`);
  }
  return PLATEFORMES.map((platform) => {
    const proof = candidate.platformProofs.get(`transcript/${platform}`);
    if (proof === undefined) fail(`transcript proof ${platform} is absent`);
    const transcript = parseJson(
      proof.subjectContent,
      `installed transcript ${platform}`,
    );
    const live = transcript.authentication?.proof;
    const flow = live?.flows?.[method];
    if (
      live?.schema !== "punks.live-staging-auth-matrix-proof.v3" ||
      live.sourceSha !== candidate.sourceSha ||
      live.stagingDeploymentId !== candidate.stagingDeploymentId ||
      flow?.success?.method !== method ||
      flow?.success?.environment !== "staging" ||
      flow?.cancellation?.method !== method ||
      flow?.cancellation?.outcomeCode !== "cancelled"
    ) {
      fail(`installed ${method} proof ${platform} is absent or divergent`);
    }
    return closedCheck(
      `auth/${method}/${platform}`,
      canonicalSha256({
        schema: "punks.operational-auth-method-proof.v1",
        transcriptSubjectSha256: proof.subjectSha256,
        method,
        flow,
      }),
    );
  });
}

function storyChecks(candidate, story) {
  return PLATEFORMES.map((platform) =>
    requiredProof(
      candidate.platformProofs,
      `parcours/${platform}/${story}`,
      `story/${story}/${platform}`,
    ),
  );
}

function networkChecks(candidate) {
  return PLATEFORMES.map((platform) => {
    const digest = candidate.networks.get(platform);
    if (digest === undefined) fail(`network proof ${platform} is absent`);
    return closedCheck(`network/${platform}`, digest);
  });
}

function recoveryChecks(candidate, predicate, label) {
  const checks = [...candidate.recoveryProofs.entries()]
    .filter(([id]) => predicate(id))
    .map(([id, proof]) => closedCheck(`${label}/${id}`, proof.proofSha256));
  if (checks.length === 0)
    fail(`required recovery proof group ${label} is absent`);
  return checks;
}

function artifactChecks(candidate) {
  return PLATEFORMES.flatMap((platform) => {
    const entry = candidate.platforms.get(platform);
    if (entry === undefined) fail(`candidate platform ${platform} is absent`);
    return [
      closedCheck(`artifact/manifest/${platform}`, entry.manifestSha256),
      closedCheck(`artifact/provenance/${platform}`, entry.provenanceSha256),
      requiredProof(
        candidate.platformProofs,
        `scan/artefact/${platform}`,
        `artifact/scan/${platform}`,
      ),
    ];
  });
}

function backendCheck(report, reportSha256, path) {
  const endpoint = report.endpoints.find((entry) => entry.path === path);
  if (endpoint === undefined) fail(`backend proof ${path} is absent`);
  return closedCheck(`backend${path}`, reportSha256, endpoint.result);
}

function queueChecks(infrastructure, predicate, label) {
  const checks = infrastructure.queues
    .filter(({ name }) => predicate(name))
    .map((queue) =>
      closedCheck(
        `${label}/${queue.name}`,
        canonicalSha256(queue),
        queue.result,
      ),
    );
  if (checks.length === 0) fail(`infrastructure queue group ${label} is empty`);
  return checks;
}

function outboxChecks(infrastructure) {
  return infrastructure.authorities.map((authority) =>
    closedCheck(
      `outbox/${authority.authority}`,
      canonicalSha256({
        authority: authority.authority,
        outboxesPending: authority.outboxesPending,
      }),
      authority.outboxesPending === 0 ? "vert" : "rouge",
    ),
  );
}

function archiveChecks(infrastructure) {
  return [
    ...infrastructure.authorities.map((authority) =>
      closedCheck(
        `archive-state/${authority.authority}`,
        canonicalSha256({
          authority: authority.authority,
          pendingArchives: authority.pendingArchives,
          archiveSegments: authority.archiveSegments,
          archiveHeadValid: authority.archiveHeadValid,
        }),
        authority.pendingArchives === 0 && authority.archiveHeadValid
          ? "vert"
          : "rouge",
      ),
    ),
    closedCheck(
      "archive/r2-create-read-chain",
      canonicalSha256(infrastructure.r2Probe),
      infrastructure.r2Probe.result,
    ),
  ];
}

function lockChecks(infrastructure) {
  return infrastructure.locks.map((lock) =>
    closedCheck(`r2-lock/${lock.role}`, canonicalSha256(lock), lock.result),
  );
}

const AUTH_METRICS = new Set([
  "activation-unconfirmed-terminal",
  "renouvellement-session-echecs",
  "desktop-demarrage-sans-frontiere-session",
]);
const MUTATION_METRICS = new Set([
  "mutations-ambiguous",
  "mutations-ambiguous-apres-5m",
  "replay-automatique",
]);
const FOLLOW_METRICS = new Set([
  "follow-live-p95",
  "follow-live-p99",
  "renderer-confirmation-p95",
  "renderer-confirmation-p99",
  "follow-trou-ou-chevauchement-divergent",
  "ack-avant-publication-renderer",
]);
const STORAGE_METRICS = new Set([
  "d1-retard-p95",
  "d1-retard-p99",
  "d1-retard-actif-max",
]);
function checksForMetric(
  metric,
  dimension,
  candidate,
  report,
  reportSha256,
  infrastructure,
) {
  let checks;
  if (metric === "connexion-desktop-echecs-par-moyen") {
    const methods = dimension === null ? CONNECTION_METHODS : [dimension];
    checks = methods.flatMap((method) =>
      authenticationChecks(candidate, method),
    );
    checks.push(backendCheck(report, reportSha256, "/api/auth/v1/session"));
    checks.push(backendCheck(report, reportSha256, "/api/v1/punk"));
  } else if (metric === "desktop-sessions-avec-crash-par-plateforme") {
    checks = transcriptChecks(candidate, "crash-free", dimension);
  } else if (AUTH_METRICS.has(metric)) {
    checks = [
      ...transcriptChecks(candidate, "auth-session"),
      backendCheck(report, reportSha256, "/api/auth/v1/session"),
      backendCheck(report, reportSha256, "/api/v1/punk"),
    ];
  } else if (MUTATION_METRICS.has(metric)) {
    checks = [
      ...storyChecks(candidate, "publication"),
      ...storyChecks(candidate, "reponse"),
      ...storyChecks(candidate, "reactions"),
      ...transcriptChecks(candidate, "mutation"),
    ];
  } else if (FOLLOW_METRICS.has(metric)) {
    checks = [
      ...networkChecks(candidate),
      ...transcriptChecks(candidate, "follow"),
    ];
  } else if (metric === "history-required-hors-exercice") {
    checks = storyChecks(candidate, "pagination");
  } else if (
    metric === "durable-objects-erreurs-internes" ||
    metric === "durable-objects-p99"
  ) {
    checks = [
      ...recoveryChecks(candidate, () => true, "durable-object"),
      backendCheck(report, reportSha256, "/api/health"),
    ];
  } else if (STORAGE_METRICS.has(metric)) {
    checks = [
      ...storyChecks(candidate, "pagination"),
      ...recoveryChecks(
        candidate,
        (id) => /api-(conversation|message-content|workspace)/u.test(id),
        "storage-recovery",
      ),
    ];
  } else if (
    metric === "alarmes-outboxes-age-p99" ||
    metric === "alarmes-outboxes-age-max" ||
    metric === "outboxes-en-attente"
  ) {
    checks = outboxChecks(infrastructure);
  } else if (metric === "queues-age-p95" || metric === "queues-age-p99") {
    checks = queueChecks(
      infrastructure,
      (name) => !name.endsWith("-dlq"),
      "queue-backlog",
    );
  } else if (metric === "queues-dlq") {
    checks = queueChecks(
      infrastructure,
      (name) => name.endsWith("-dlq"),
      "dead-letter-queue",
    );
  } else if (
    metric === "r2-archivage-p99" ||
    metric === "r2-element-chaud-bloque-max"
  ) {
    checks = archiveChecks(infrastructure);
  } else if (metric === "workspace-profil-absent-ou-incompatible") {
    checks = storyChecks(candidate, "workspace");
  } else if (metric === "contract-violation") {
    checks = [
      closedCheck("candidate/platform-index", candidate.platformIndexSha256),
      ...[
        "connexion",
        "workspace",
        "lecture-live",
        "pagination",
        "publication",
        "reponse",
        "sujet",
        "reactions",
      ].flatMap((story) => storyChecks(candidate, story)),
    ];
  } else if (metric === "fuite-inter-workspace-ou-acces-non-autorise") {
    checks = [
      ...transcriptChecks(candidate, "authorization"),
      ...recoveryChecks(
        candidate,
        (id) => /api-(workspace|conversation|message-content)/u.test(id),
        "authorization-recovery",
      ),
    ];
  } else if (metric === "resurrection-session-revoquee") {
    checks = [
      ...transcriptChecks(candidate, "revoked-session"),
      ...recoveryChecks(candidate, (id) => /auth-session/u.test(id), "session"),
    ];
  } else if (
    metric === "contradiction-marqueur-effacement" ||
    metric === "plaintext-lisible-apres-effacement"
  ) {
    checks = recoveryChecks(
      candidate,
      (id) => /erasure-registry/u.test(id),
      "erasure",
    );
  } else if (metric === "r2-double-ecriture-hash-lock-ou-chaine-invalide") {
    checks = [...lockChecks(infrastructure), ...archiveChecks(infrastructure)];
  } else if (metric === "discordance-artefact-ou-attestation") {
    checks = artifactChecks(candidate);
  } else if (metric === "tentative-buzz-ou-nostr-public") {
    checks = [
      ...networkChecks(candidate),
      ...PLATEFORMES.map((platform) =>
        requiredProof(
          candidate.platformProofs,
          `scan/artefact/${platform}`,
          `legacy-scan/${platform}`,
        ),
      ),
    ];
  } else {
    fail(`metric ${metric} has no deterministic evidence contract`);
  }
  const ids = new Set();
  for (const check of checks) {
    if (ids.has(check.id)) fail(`${metric} deterministic check is duplicated`);
    ids.add(check.id);
  }
  return checks.sort((left, right) => left.id.localeCompare(right.id));
}

/** Builds sources only from a provider-attested live report and exact legs. */
export function collectOperationalMetricSources(
  input,
  { verifyProviderSubject = verifyGithubSubject, now = () => new Date() } = {},
) {
  if (
    !SHA1_RE.test(input?.sourceSha ?? "") ||
    !DEPLOYMENT_RE.test(input?.stagingDeploymentId ?? "") ||
    typeof input?.candidateRoot !== "string" ||
    typeof input?.backendReport !== "string" ||
    typeof input?.backendBundle !== "string" ||
    typeof input?.infrastructureReport !== "string" ||
    typeof input?.output !== "string" ||
    typeof verifyProviderSubject !== "function" ||
    typeof now !== "function"
  ) {
    fail("exact candidate and provider verification are required");
  }
  const candidateRoot = resolve(input.candidateRoot);
  const candidate = validateCandidate(
    candidateRoot,
    input.sourceSha,
    input.stagingDeploymentId,
  );
  const reportContent = readStableEvidenceFile(
    input.backendReport,
    "backend probe report",
  );
  const report = validateBackendReport(
    JSON.parse(reportContent.toString("utf8")),
    input,
  );
  const infrastructureContent = readStableEvidenceFile(
    input.infrastructureReport,
    "infrastructure proof report",
  );
  const infrastructure = validateOperationalInfrastructureReport(
    parseJson(infrastructureContent, "infrastructure proof report"),
    input,
  );
  const bundleContent = readStableEvidenceFile(
    input.backendBundle,
    "backend probe provider bundle",
  );
  validateSigstoreBundleContent(bundleContent);
  const verification = verifyProviderSubject({
    artifact: resolve(input.backendReport),
    artifactContent: reportContent,
    bundle: resolve(input.backendBundle),
    bundleContent,
    repository: OPERATIONAL_BUDGET_PROVENANCE.repository,
    sourceSha: input.sourceSha,
    sourceRef: OPERATIONAL_BUDGET_PROVENANCE.sourceRef,
    signerWorkflow: OPERATIONAL_BUDGET_PROVENANCE.signerWorkflow,
  });
  if (!Array.isArray(verification) || verification.length === 0) {
    fail("backend probe provider verification is empty");
  }
  const observedAt = now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail("provider observation clock is invalid");
  }
  const reportTime = instant(report.observedAt, "backend probe observedAt");
  const infrastructureTime = instant(
    infrastructure.observedAt,
    "infrastructure proof observedAt",
  );
  if (
    reportTime > observedAt.getTime() ||
    observedAt.getTime() - reportTime > MAX_REPORT_AGE_MS ||
    infrastructureTime > observedAt.getTime() ||
    observedAt.getTime() - infrastructureTime > MAX_REPORT_AGE_MS
  ) {
    fail("provider report is stale or future-dated");
  }
  const reportFileSha256 = sha256(reportContent);
  const infrastructureFileSha256 = sha256(infrastructureContent);
  const output = resolve(input.output);
  let outputCreated = false;
  try {
    mkdirSync(output, { mode: 0o700 });
    outputCreated = true;
    let count = 0;
    const writeSource = (metric, dimension, unit) => {
      const checks = checksForMetric(
        metric,
        dimension,
        candidate,
        report,
        reportFileSha256,
        infrastructure,
      );
      const document = {
        schema: "punks.operational-metric-source.v3",
        sourceSha: input.sourceSha,
        stagingDeploymentId: input.stagingDeploymentId,
        metric,
        dimension,
        unit,
        observer: "github-attested-installed-candidate",
        querySha256: canonicalSha256({
          schema: "punks.operational-provider-query.v2",
          corpusSha256: candidate.corpusSha256,
          backendReportSha256: reportFileSha256,
          infrastructureReportSha256: infrastructureFileSha256,
          metric,
          dimension,
          checks,
        }),
        observedAt: observedAt.toISOString(),
        samples: { checks },
      };
      const content = Buffer.from(`${JSON.stringify(document)}\n`);
      const digest = sha256(content);
      writeFileSync(join(output, `${digest}.json`), content, {
        flag: "wx",
        mode: 0o600,
      });
      count += 1;
    };
    for (const budget of BUDGETS_PRODUCTION) {
      writeSource(budget.nom, null, budget.unite);
      for (const dimension of dimensions(budget.nom)) {
        writeSource(budget.nom, dimension, budget.unite);
      }
    }
    writeSource("outboxes-en-attente", null, "occurrences");
    if (count !== 43) fail("provider source count diverges");
    return {
      sources: count,
      corpusSha256: candidate.corpusSha256,
      backendReportSha256: reportFileSha256,
      infrastructureReportSha256: infrastructureFileSha256,
    };
  } catch (error) {
    if (outputCreated) rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const expected = new Set([
    "--source-sha",
    "--staging-deployment-id",
    "--candidate-root",
    "--backend-report",
    "--backend-bundle",
    "--infrastructure-report",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || !value || values.has(flag)) {
      fail("exact CLI arguments are required");
    }
    values.set(flag, value);
  }
  if (values.size !== expected.size) fail("exact CLI arguments are required");
  return (flag) => values.get(flag);
}

export function run(argv = process.argv.slice(2)) {
  const required = parseArgs(argv);
  return collectOperationalMetricSources({
    sourceSha: required("--source-sha"),
    stagingDeploymentId: required("--staging-deployment-id"),
    candidateRoot: required("--candidate-root"),
    backendReport: required("--backend-report"),
    backendBundle: required("--backend-bundle"),
    infrastructureReport: required("--infrastructure-report"),
    output: required("--output"),
  });
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${JSON.stringify(run())}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
