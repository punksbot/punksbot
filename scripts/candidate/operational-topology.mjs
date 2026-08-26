import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  SURFACES_TOPOLOGIE,
  validateOperationalTopology,
} from "../release-graph-lib.mjs";

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
const CONNECTION_METHODS = Object.freeze(["google", "github", "passkey"]);
const SERVICE_AUTHORITIES = new Set([
  "erasure-registry",
  "internal-event-signature",
]);

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

/** Builds the canonical operational topology from exact candidate materials. */
export function buildOperationalTopology({ dossier, repositoryRoot }) {
  const root = resolve(
    repositoryRoot ?? fileURLToPath(new URL("../../", import.meta.url)),
  );
  const staging = dossier?.liaison?.staging;
  const production = dossier?.liaison?.["digests-production"];
  const promotionDigests = dossier?.liaison?.["digests-preuves-promotion"];
  const workers = staging?.workers;
  const authorities = staging?.autorites;
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
    workflows: [],
    "generation-compatibilite": 1,
    inventaire: inventory,
    "migration-stateful": { mode: "aucune" },
    "moyens-connexion": [...CONNECTION_METHODS],
    "versions-cloudflare": workers.map(({ name, versionId }) => ({
      ressource: name,
      id: versionId,
    })),
    "versions-etat-durable-objects": authorities
      .filter((authority) => !SERVICE_AUTHORITIES.has(authority))
      .map((authority) => ({ namespace: authority, version: 1 })),
    "etat-r2": {
      formats: [
        { nom: "promotion-evidence", version: 1 },
        { nom: "erasure-tombstone", version: 1 },
      ],
      "generation-chaines": 1,
      "generation-tombstones": 1,
      "generation-effacement": 1,
      "registre-sha256": canonicalSha256(promotionDigests),
    },
    "generations-securite": {
      secrets: [
        { nom: "operator-provisioning", generation: 1 },
        { nom: "promotion-session", generation: 1 },
        { nom: "release-approvers", generation: 1 },
        { nom: "r2-primary", generation: 1 },
        { nom: "r2-recovery", generation: 1 },
      ],
      "cles-attestation": [
        { id: "punks-release-approver-primary", generation: 1 },
        { id: "punks-release-approver-secondary", generation: 1 },
      ],
      "generation-recuperation-sessions": 1,
      "generations-revoquees-sha256": canonicalSha256([]),
    },
  };
  const errors = validateOperationalTopology(topology);
  if (errors.length > 0) fail(errors.join("; "));
  return topology;
}
