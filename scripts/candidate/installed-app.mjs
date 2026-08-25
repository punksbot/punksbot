#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_STAGING_ACCOUNT_ID,
  createCloudflareApiBoundary,
  createStagingDeploymentProof,
  observeStagingDeployment,
  validateStagingDeploymentProof,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { validateInstalledReleaseNames } from "../promotion-materials-lib.mjs";
import {
  MATRICE_ACCESSIBILITE as ACCESSIBILITY,
  METHODES_ACCESSIBILITE,
  REQUIRED_STORIES,
  VERIFICATIONS_ARTEFACT as VERIFICATIONS,
  validateInstalledTranscript,
} from "../promotion-installed-transcript-lib.mjs";

export { REQUIRED_STORIES };

const PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const SHA1_RE = /^[0-9a-f]{40}$/;

function fail(message) {
  throw new Error(`installed candidate proof rejected: ${message}`);
}

function stableFile(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile()) {
    fail(`${label} must be one real regular file`);
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

function parseTranscript(path) {
  const file = stableFile(path, "driver transcript");
  let transcript;
  try {
    transcript = JSON.parse(file.content.toString("utf8"));
  } catch {
    fail("driver transcript is not JSON");
  }
  return { ...file, transcript };
}

function parseStagingDeploymentProof(path, candidateSha) {
  const file = stableFile(path, "staging deployment proof");
  let document;
  try {
    document = JSON.parse(file.content.toString("utf8"));
  } catch {
    fail("staging deployment proof is not JSON");
  }
  try {
    return {
      ...file,
      proof: validateStagingDeploymentProof(document, {
        accountId: CANONICAL_STAGING_ACCOUNT_ID,
        environment: "staging",
        sourceSha: candidateSha,
      }),
    };
  } catch (error) {
    fail(
      `staging deployment proof is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function proof({ id, platform, candidateSha, stagingDeploymentId, data }) {
  return {
    schema: "punks.promotion-proof.v1",
    id,
    candidateSha,
    stagingDeploymentId,
    result: "vert",
    plateforme: platform,
    data,
  };
}

function writeProof(output, value, sujet) {
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const digest = sha256(content);
  const safeId = value.id.replaceAll(/[^a-z0-9.-]/giu, "-");
  const relative = `sha256/${digest}-${safeId}.json`;
  writeFileSync(join(output, relative), content, { flag: "wx", mode: 0o600 });
  return { id: value.id, chemin: relative, sha256: digest, sujet };
}

function writeSubject(output, content, label) {
  const digest = sha256(content);
  const relative = `sha256/${digest}-${label}`;
  writeFileSync(join(output, relative), content, { flag: "wx", mode: 0o600 });
  return { chemin: relative, sha256: digest };
}

/**
 * Émet le lot create-only d'une exécution réellement installée.
 *
 * L'identité du staging est dérivée de la preuve distante canonique, jamais
 * d'un identifiant fourni séparément. Chaque verdict référence en outre les
 * octets locaux exacts (artefact, signature ou transcript) qui l'ont produit.
 * Après validation du snapshot du transcript, une nouvelle observation de
 * l'API Cloudflare doit encore retrouver exactement les mêmes sept versions et
 * déploiements avant que le moindre octet du lot ne soit écrit.
 *
 * `remoteBoundary` est un point d'injection réservé aux tests de cette API. Le
 * chemin CLI n'en accepte aucun et construit toujours la frontière Cloudflare
 * authentifiée réelle.
 */
export async function emitInstalledAppEvidence(
  {
    platform,
    candidateSha,
    stagingDeploymentProof,
    artifact,
    signature,
    transcript,
    output,
  },
  { remoteBoundary } = {},
) {
  if (!PLATFORMS.includes(platform)) fail("unsupported platform");
  if (!SHA1_RE.test(candidateSha ?? "")) fail("exact source SHA required");
  const staging = parseStagingDeploymentProof(
    stagingDeploymentProof,
    candidateSha,
  );
  const stagingDeploymentId = staging.proof.deploymentId;
  const artifactFile = stableFile(artifact, "installed artifact");
  const signatureFile = stableFile(signature, "updater signature");
  const artifactDigest = sha256(artifactFile.content);
  const signatureDigest = sha256(signatureFile.content);
  const parsed = parseTranscript(transcript);
  validateInstalledReleaseNames({
    platform,
    candidateSha,
    artifactName: basename(artifactFile.absolute),
    signatureName: basename(signatureFile.absolute),
  });
  let transcriptValide;
  try {
    transcriptValide = validateInstalledTranscript(parsed.transcript, {
      platform,
      candidateSha,
      stagingDeploymentId,
      artifactSha256: artifactDigest,
      deployedWorkers: staging.proof.workers.map(
        ({ name, versionId, deploymentId }) => ({
          name,
          versionId,
          deploymentId,
        }),
      ),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const { stories, accessibility } = transcriptValide;
  const outputPath = resolve(output);
  const transcriptDigest = sha256(parsed.content);
  const observation = await observeStagingDeployment(
    {
      accountId: CANONICAL_STAGING_ACCOUNT_ID,
      environment: "staging",
      sourceSha: candidateSha,
    },
    remoteBoundary ?? createCloudflareApiBoundary(),
  );
  const postStagingProof = createStagingDeploymentProof(observation);
  const postStagingContent = Buffer.from(
    `${JSON.stringify(postStagingProof, null, 2)}\n`,
  );
  if (
    postStagingProof.deploymentId !== stagingDeploymentId ||
    !postStagingContent.equals(staging.content)
  ) {
    fail(
      "post-exercise Cloudflare observation differs from the exact staging aggregate",
    );
  }

  try {
    mkdirSync(outputPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("evidence output already exists");
    throw error;
  }
  mkdirSync(join(outputPath, "sha256"), { mode: 0o700 });
  const common = { platform, candidateSha, stagingDeploymentId };
  const artifactSubject = writeSubject(
    outputPath,
    artifactFile.content,
    "installed-artifact.bin",
  );
  const signatureSubject = writeSubject(
    outputPath,
    signatureFile.content,
    "updater-signature.bin",
  );
  const transcriptSubject = writeSubject(
    outputPath,
    parsed.content,
    "driver-transcript.json",
  );
  const postStagingSubject = writeSubject(
    outputPath,
    postStagingContent,
    "staging-post-exercise.json",
  );
  const values = [
    proof({
      ...common,
      id: `artefact/${platform}/bundle`,
      data: {
        nom: basename(artifactFile.absolute),
        bundleId: parsed.transcript.installed.bundleId,
        subjectSha256: artifactDigest,
        taille: artifactFile.content.length,
        installedBinarySha256: parsed.transcript.installed.binarySha256,
        transcriptSha256: transcriptDigest,
      },
    }),
    proof({
      ...common,
      id: `artefact/${platform}/signature`,
      data: {
        nom: basename(signatureFile.absolute),
        subjectSha256: signatureDigest,
        taille: signatureFile.content.length,
        transcriptSha256: transcriptDigest,
      },
    }),
    proof({
      ...common,
      id: `transcript/${platform}`,
      data: {
        subjectSha256: transcriptDigest,
        schema: parsed.transcript.schema,
        plateforme: platform,
        byteLength: parsed.content.length,
      },
    }),
    proof({
      ...common,
      id: `staging/reobservation/${platform}`,
      data: {
        subjectSha256: postStagingSubject.sha256,
        transcriptSha256: transcriptDigest,
        initialStagingProofSha256: sha256(staging.content),
        deploymentId: stagingDeploymentId,
        workers: postStagingProof.workers.map(
          ({ name, versionId, deploymentId }) => ({
            name,
            versionId,
            deploymentId,
          }),
        ),
        sequence: ["transcript-installed", "cloudflare-reobserved"],
      },
    }),
  ];
  for (const verification of VERIFICATIONS) {
    values.push(
      proof({
        ...common,
        id: `artefact/${platform}/verification/${verification}`,
        data: {
          driver: parsed.transcript.driver,
          subjectSha256: transcriptDigest,
          transcriptSha256: transcriptDigest,
        },
      }),
    );
  }
  for (const story of REQUIRED_STORIES) {
    const observed = stories.get(story);
    values.push(
      proof({
        ...common,
        id: `parcours/${platform}/${story}`,
        data: {
          sha256Artefact: artifactDigest,
          via: observed.via,
          contour: parsed.transcript.contour,
          serveurVite: parsed.transcript.serveurVite,
          facadeTest: parsed.transcript.facadeTest,
          assertions: observed.assertions,
          subjectSha256: transcriptDigest,
          transcriptSha256: transcriptDigest,
        },
      }),
    );
  }
  for (const criterion of ACCESSIBILITY) {
    const observed = accessibility.get(criterion);
    values.push(
      proof({
        ...common,
        id: `accessibilite/${platform}/${criterion}`,
        data: {
          driver: parsed.transcript.driver,
          subjectSha256: transcriptDigest,
          transcriptSha256: transcriptDigest,
          methodes: observed.methodes,
          ...(observed.technologie === undefined
            ? {}
            : { technologie: observed.technologie }),
        },
      }),
    );
  }
  values.push(
    proof({
      ...common,
      id: `accessibilite/${platform}/resultat`,
      data: {
        driver: parsed.transcript.driver,
        subjectSha256: transcriptDigest,
        transcriptSha256: transcriptDigest,
        methodes: METHODES_ACCESSIBILITE,
        technologieLecteurEcran: accessibility.get("lecteur-ecran").technologie,
      },
    }),
  );

  const references = values.map((value) => {
    const sujet =
      value.id === `artefact/${platform}/bundle`
        ? artifactSubject
        : value.id === `artefact/${platform}/signature`
          ? signatureSubject
          : value.id === `staging/reobservation/${platform}`
            ? postStagingSubject
            : transcriptSubject;
    return writeProof(outputPath, value, sujet);
  });
  references.sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(
    join(outputPath, "index.json"),
    `${JSON.stringify({ schema: "punks.promotion-evidence-index.v1", preuves: references }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return { references, transcriptSha256: transcriptDigest };
}

function options(argv) {
  const expected = new Set([
    "--platform",
    "--source-sha",
    "--staging-deployment-proof",
    "--installed-artifact",
    "--updater-signature",
    "--driver-transcript",
    "--proof-output",
  ]);
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || result.has(flag)) {
      fail("arguments must be unique --name value pairs");
    }
    result.set(flag, value);
  }
  if (
    result.size !== expected.size ||
    [...result.keys()].some((flag) => !expected.has(flag))
  ) {
    fail("the exact installed evidence CLI arguments are required");
  }
  const required = (name) => {
    const value = result.get(name);
    if (!value) fail(`${name} is required`);
    return value;
  };
  return { required };
}

export async function run(argv = process.argv.slice(2)) {
  const { required } = options(argv);
  return await emitInstalledAppEvidence({
    platform: required("--platform"),
    candidateSha: required("--source-sha"),
    stagingDeploymentProof: required("--staging-deployment-proof"),
    artifact: required("--installed-artifact"),
    signature: required("--updater-signature"),
    transcript: required("--driver-transcript"),
    output: required("--proof-output"),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
