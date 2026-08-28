import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  SURFACES_TOPOLOGIE,
  validateOperationalTopology,
} from "../release-graph-lib.mjs";
import { validateOperationalTopologyObservation } from "./operational-topology-observation.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/u;
const WORKER_CONFIGS = Object.freeze([
  "cloudflare/workers/auth/wrangler.jsonc",
  "cloudflare/workers/attestation/wrangler.jsonc",
  "cloudflare/workers/erasure/wrangler.jsonc",
  "cloudflare/workers/projector/wrangler.jsonc",
  "cloudflare/workers/search/wrangler.jsonc",
  "cloudflare/workers/api/wrangler.jsonc",
  "cloudflare/workers/bot-runtime/wrangler.jsonc",
]);
const CONNECTION_METHODS = Object.freeze(["google", "github"]);
const SERVICE_AUTHORITIES = new Set([
  "erasure-registry",
  "internal-event-signature",
]);
const PROMOTION_PROFILE = "cloudflare/promotion-profiles.json";
const ERASURE_SOURCE = "cloudflare/workers/erasure/src/index.ts";

function fail(message) {
  throw new Error(`operational topology rejected: ${message}`);
}

function fileDigest(root, relative) {
  const absolute = resolve(root, relative);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile()) {
    fail(`${relative} is not one regular source material`);
  }
  return {
    path: relative,
    sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
    size: status.size,
  };
}

function directoryFiles(root, relative) {
  return readdirSync(resolve(root, relative), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map(({ name }) => join(relative, name))
    .sort();
}

function materialDigest(root, surface, paths) {
  return canonicalSha256({
    surface,
    files: [...paths].sort().map((path) => fileDigest(root, path)),
  });
}

function parseJsonc(content, label) {
  let output = "";
  let string = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (current === "\n") {
        output += current;
      }
      continue;
    }
    if (string) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') string = false;
      continue;
    }
    if (current === '"') {
      string = true;
      output += current;
    } else if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      output += current;
    }
  }
  if (string || blockComment) fail(`${label} contains unterminated JSONC`);
  try {
    return JSON.parse(output);
  } catch {
    fail(`${label} is invalid JSONC`);
  }
}

function sourceMaterials(root) {
  const configs = WORKER_CONFIGS.map((relative) => ({
    relative,
    value: parseJsonc(readFileSync(resolve(root, relative), "utf8"), relative),
  }));
  let profile;
  try {
    profile = JSON.parse(
      readFileSync(resolve(root, PROMOTION_PROFILE), "utf8"),
    );
  } catch {
    fail("promotion profile is invalid JSON");
  }
  const selected = profile?.profiles?.find(({ tranche }) => tranche === 1);
  if (
    selected === undefined ||
    !/^desktop-social-loop@[1-9][0-9]*$/u.test(selected.id ?? "")
  ) {
    fail("exact tranche 1 promotion profile is required");
  }
  return { configs, profile: selected };
}

function numericGeneration(value, label) {
  const match = /(?:^|[-@])v?([1-9][0-9]*)$/u.exec(value ?? "");
  if (match === null) fail(`${label} has no monotone generation`);
  return Number(match[1]);
}

function migrationVersions(materials) {
  const versions = new Map();
  for (const { value: config } of materials.configs) {
    const worker = config?.env?.staging?.name;
    if (typeof worker !== "string") fail("staging Worker name is missing");
    for (const [index, migration] of (config.migrations ?? []).entries()) {
      const version = numericGeneration(
        migration.tag ?? `v${index + 1}`,
        `${worker} migration tag`,
      );
      for (const className of migration.new_sqlite_classes ?? []) {
        versions.set(`${worker}:${className}`, version);
      }
      for (const renamed of migration.renamed_classes ?? []) {
        if (typeof renamed?.to === "string") {
          versions.set(`${worker}:${renamed.to}`, version);
        }
      }
    }
  }
  return versions;
}

function erasureSchemaGeneration(root) {
  const source = readFileSync(resolve(root, ERASURE_SOURCE), "utf8");
  const match = /const SCHEMA_VERSION = ([1-9][0-9]*) as const;/u.exec(source);
  if (match === null) fail("Erasure R2 schema generation is unavailable");
  return Number(match[1]);
}

/** Builds the canonical operational topology from exact candidate materials. */
export function buildOperationalTopology({
  dossier,
  topologyObservation,
  repositoryRoot,
}) {
  const root = resolve(
    repositoryRoot ?? fileURLToPath(new URL("../../", import.meta.url)),
  );
  const staging = dossier?.liaison?.staging;
  const production = dossier?.liaison?.["digests-production"];
  const promotionDigests = dossier?.liaison?.["digests-preuves-promotion"];
  const workers = staging?.workers;
  const authorities = staging?.autorites;
  const materials = sourceMaterials(root);
  const stateVersions = migrationVersions(materials);
  const compatibilityGeneration = numericGeneration(
    materials.profile.id,
    "promotion profile",
  );
  if (
    !Array.isArray(workers) ||
    workers.length !== 7 ||
    !Array.isArray(authorities) ||
    authorities.length < 1 ||
    !SHA256_RE.test(staging?.["materiau-sha256"] ?? "") ||
    !SHA256_RE.test(production?.manifeste ?? "")
  ) {
    fail("exact staging, production and authority materials are required");
  }
  let remote;
  try {
    remote = validateOperationalTopologyObservation(topologyObservation, {
      sourceSha: dossier.candidat.sha,
      stagingDeploymentId: staging.deploiement,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (
    canonicalSha256(
      remote.workers.map(({ name, versionId, deploymentId }) => ({
        name,
        versionId,
        deploymentId,
      })),
    ) !== canonicalSha256(workers) ||
    remote.securityGenerations.compatibility !== compatibilityGeneration
  ) {
    fail("remote topology diverges from the exact candidate materials");
  }
  const d1Migrations = directoryFiles(
    root,
    "cloudflare/workers/projector/migrations",
  );
  const configDigest = (surface) =>
    materialDigest(root, surface, WORKER_CONFIGS);
  const inventory = {
    "manifest-staging-sha256": staging["materiau-sha256"],
    "manifest-production-sha256": production.manifeste,
    "migrations-durable-objects-sha256": configDigest(
      "migrations-durable-objects",
    ),
    "migrations-d1-sha256": materialDigest(root, "migrations-d1", d1Migrations),
    "bindings-sha256": configDigest("bindings"),
    "routes-sha256": configDigest("routes"),
    "triggers-sha256": configDigest("triggers"),
    "ressources-sha256": canonicalSha256({
      stagingMaterial: staging["materiau-sha256"],
      productionManifest: production.manifeste,
      remoteWorkflow: remote.workflows,
    }),
    "secrets-sha256": configDigest("secret-names"),
    "configuration-trafic-sha256": canonicalSha256({
      deploymentId: staging.deploiement,
      workers: workers.map(({ name, versionId, deploymentId }) => ({
        name,
        versionId,
        deploymentId,
        percentage: 100,
      })),
      remoteTopologyObservationSha256: remote.sha256,
    }),
  };
  if (
    JSON.stringify(Object.keys(inventory).sort()) !==
    JSON.stringify([...SURFACES_TOPOLOGIE].sort())
  ) {
    fail("ten canonical topology surfaces are required");
  }
  const topology = {
    workers: workers.map(({ name, versionId }) => ({
      nom: name,
      version: versionId,
      pourcentage: 100,
    })),
    workflows: remote.workflows.map(({ name, versionId }) => ({
      nom: name,
      version: versionId,
    })),
    "generation-compatibilite": remote.securityGenerations.compatibility,
    inventaire: inventory,
    "migration-stateful": { mode: "aucune" },
    "moyens-connexion": [...CONNECTION_METHODS],
    "versions-cloudflare": workers
      .map(({ name, versionId }) => ({
        ressource: name,
        id: versionId,
      }))
      .concat(
        remote.workflows.map(({ name, versionId }) => ({
          ressource: `workflow:${name}`,
          id: versionId,
        })),
      ),
    "versions-etat-durable-objects": materials.profile.authorities
      .filter(
        ({ id }) => authorities.includes(id) && !SERVICE_AUTHORITIES.has(id),
      )
      .map(({ id, worker, className }) => {
        const version = stateVersions.get(`${worker}:${className}`);
        if (!Number.isInteger(version)) {
          fail(`${id} has no observed Durable Object migration generation`);
        }
        return { namespace: id, version };
      }),
    "etat-r2": {
      formats: [
        { nom: "promotion-evidence", version: compatibilityGeneration },
        { nom: "erasure-tombstone", version: erasureSchemaGeneration(root) },
      ],
      "generation-chaines": compatibilityGeneration,
      "generation-tombstones": erasureSchemaGeneration(root),
      "generation-effacement": erasureSchemaGeneration(root),
      "registre-sha256": canonicalSha256(promotionDigests),
    },
    "generations-securite": {
      secrets: [
        {
          nom: "operator-provisioning",
          generation: remote.securityGenerations.operatorProvisioning,
        },
        {
          nom: "promotion-session",
          generation: remote.securityGenerations.promotionSession,
        },
        {
          nom: "release-approvers",
          generation: remote.securityGenerations.releaseApprovers,
        },
        {
          nom: "r2-primary",
          generation: remote.securityGenerations.r2Primary,
        },
        {
          nom: "r2-recovery",
          generation: remote.securityGenerations.r2Recovery,
        },
      ],
      "cles-attestation": [
        {
          id: "punks-release-approver-primary",
          generation: remote.securityGenerations.attestationPrimary,
        },
        {
          id: "punks-release-approver-secondary",
          generation: remote.securityGenerations.attestationSecondary,
        },
      ],
      "generation-recuperation-sessions":
        remote.securityGenerations.sessionRecovery,
      "generations-revoquees-sha256": canonicalSha256(
        dossier?.recuperation ?? null,
      ),
    },
  };
  const errors = validateOperationalTopology(topology);
  if (errors.length > 0) fail(errors.join("; "));
  return topology;
}
