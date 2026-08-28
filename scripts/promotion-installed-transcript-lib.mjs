/** Contrat fermé du transcript produit par un candidat desktop installé. */
import { validateInstalledNetworkBinding } from "./promotion-materials-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
} from "./promotion-resilience-lib.mjs";
import { PLATEFORMES } from "./release-graph-lib.mjs";

export const REQUIRED_STORIES = Object.freeze([
  "connexion",
  "workspace",
  "lecture-live",
  "pagination",
  "publication",
  "reponse",
  "sujet",
  "reactions",
]);

export const FOLLOW_SCENARIO_OUTCOMES = Object.freeze({
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

export const AUTHENTICATION_SCENARIO_OUTCOMES = Object.freeze({
  "google-succes": "vert",
  "github-succes": "vert",
  "google-annulation": "vert",
  "github-annulation": "vert",
  "passkey-retiree": "refuse",
  "mauvaise-origine": "refuse",
  "deeplink-rejoue": "refuse",
  expiration: "expire",
  "crash-livraison-avant-confirmation": "reprenable",
  renouvellement: "borne",
  "deconnexion-hors-ligne": "mise-en-file",
});

export const VERIFICATIONS_ARTEFACT = Object.freeze([
  "signature",
  "identite-application",
  "protocol-handlers",
  "stockage-securise",
  "updater",
]);

export const IDENTITE_APPLICATION_PUNKS = "bot.punks.desktop.staging";

export { MATRICE_ACCESSIBILITE, METHODES_ACCESSIBILITE };

const LECTEUR_ECRAN_PAR_PLATEFORME = Object.freeze({
  "macos-arm64": "VoiceOver",
  "macos-x64": "VoiceOver",
  "windows-x64": "NVDA",
});
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DEPLOIEMENT_RE = /^sha256:[0-9a-f]{64}$/;

function refuser(message) {
  throw new Error(message);
}

function clesExactes(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuser(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    refuser(`${label} has an unexpected shape`);
  }
}

/**
 * Valide l'intégralité du transcript installé et retourne ses observations
 * déjà recoupées pour l'émission des preuves content-addressées.
 */
export function validateInstalledTranscript(
  transcript,
  {
    platform,
    candidateSha,
    stagingDeploymentId,
    deployedWorkers,
    artifactSha256,
  },
) {
  clesExactes(
    transcript,
    [
      "schema",
      "candidateSha",
      "stagingDeploymentId",
      "platform",
      "result",
      "driver",
      "contour",
      "serveurVite",
      "facadeTest",
      "installed",
      "verifications",
      "stories",
      "accessibility",
      "authentication",
      "rawEvidence",
      "network",
    ],
    "driver transcript",
  );
  if (
    !PLATEFORMES.includes(platform) ||
    !SHA1_RE.test(candidateSha ?? "") ||
    !DEPLOIEMENT_RE.test(stagingDeploymentId ?? "") ||
    !SHA256_RE.test(artifactSha256 ?? "") ||
    transcript.schema !== "punks.installed-social-loop-transcript.v1" ||
    transcript.candidateSha !== candidateSha ||
    transcript.stagingDeploymentId !== stagingDeploymentId ||
    transcript.platform !== platform ||
    transcript.result !== "vert"
  ) {
    refuser(
      "driver transcript identity or result does not match the candidate",
    );
  }

  clesExactes(
    transcript.authentication,
    ["contour", "proof"],
    "installed authentication",
  );
  const liveAuth = transcript.authentication.proof;
  const authMethods = ["google", "github"];
  if (
    transcript.authentication.contour !== "navigateur-systeme-provider-reel" ||
    liveAuth?.schema !== "punks.live-staging-auth-matrix-proof.v3" ||
    liveAuth?.sourceSha !== candidateSha ||
    liveAuth?.stagingDeploymentId !== stagingDeploymentId ||
    JSON.stringify(Object.keys(liveAuth?.flows ?? {})) !==
      JSON.stringify(authMethods) ||
    authMethods.some(
      (method) =>
        liveAuth.flows[method]?.success?.method !== method ||
        liveAuth.flows[method]?.success?.environment !== "staging" ||
        liveAuth.flows[method]?.cancellation?.method !== method ||
        liveAuth.flows[method]?.cancellation?.outcomeCode !== "cancelled",
    ) ||
    liveAuth?.negative?.wrongOauthState !== "refused" ||
    liveAuth?.negative?.wrongBrowserBinding !== "refused" ||
    liveAuth?.negative?.wrongNativePkceVerifier !== "refused" ||
    liveAuth?.negative?.retiredPasskeyMethod !== "refused"
  ) {
    refuser("the complete real system-browser provider matrix is required");
  }
  const expectedDriver = platform.startsWith("macos-")
    ? "xctest"
    : "tauri-driver";
  if (transcript.driver !== expectedDriver) {
    refuser(`${platform} must use the reviewed ${expectedDriver} driver`);
  }
  if (
    transcript.contour !== "distribue" ||
    transcript.serveurVite !== false ||
    transcript.facadeTest !== false
  ) {
    refuser(
      "the exact distributed installation is required; no Vite or test facade",
    );
  }

  clesExactes(
    transcript.installed,
    ["bundleId", "artifactSha256", "binarySha256", "launched"],
    "installed application",
  );
  if (
    transcript.installed.bundleId !== IDENTITE_APPLICATION_PUNKS ||
    transcript.installed.artifactSha256 !== artifactSha256 ||
    !SHA256_RE.test(transcript.installed.binarySha256 ?? "") ||
    transcript.installed.launched !== true
  ) {
    refuser("installed application identity or artifact digest is divergent");
  }

  clesExactes(
    transcript.rawEvidence,
    ["indexSha256", "files"],
    "installed raw evidence",
  );
  if (
    !SHA256_RE.test(transcript.rawEvidence.indexSha256 ?? "") ||
    !Number.isSafeInteger(transcript.rawEvidence.files) ||
    transcript.rawEvidence.files < 1
  ) {
    refuser("installed raw evidence is missing or invalid");
  }

  clesExactes(
    transcript.verifications,
    VERIFICATIONS_ARTEFACT,
    "native verifications",
  );
  for (const verification of VERIFICATIONS_ARTEFACT) {
    if (transcript.verifications[verification] !== "vert") {
      refuser(`native verification ${verification} is not green`);
    }
  }

  if (!Array.isArray(transcript.stories)) refuser("stories must be an array");
  const stories = new Map();
  for (const story of transcript.stories) {
    clesExactes(story, ["id", "result", "via", "assertions"], "story");
    if (!REQUIRED_STORIES.includes(story.id) || stories.has(story.id)) {
      refuser(`unknown or duplicate story ${String(story.id)}`);
    }
    if (
      story.result !== "vert" ||
      !Array.isArray(story.via) ||
      story.via.length !== 3 ||
      new Set(story.via).size !== 3 ||
      !["ui", "ipc-rust", "contrats-publics"].every((layer) =>
        story.via.includes(layer),
      ) ||
      !Array.isArray(story.assertions) ||
      story.assertions.length === 0 ||
      story.assertions.some(
        (assertion) =>
          typeof assertion !== "string" ||
          assertion.length === 0 ||
          assertion.length > 500,
      )
    ) {
      refuser(
        `story ${story.id} is not proven through UI + IPC + public contracts`,
      );
    }
    stories.set(story.id, story);
  }
  for (const story of REQUIRED_STORIES) {
    if (!stories.has(story)) refuser(`required story ${story} is missing`);
  }

  clesExactes(
    transcript.accessibility,
    MATRICE_ACCESSIBILITE,
    "accessibility matrix",
  );
  const accessibility = new Map();
  for (const criterion of MATRICE_ACCESSIBILITE) {
    const observation = transcript.accessibility[criterion];
    const isScreenReader = criterion === "lecteur-ecran";
    clesExactes(
      observation,
      isScreenReader
        ? ["resultat", "methodes", "technologie"]
        : ["resultat", "methodes"],
      `accessibility criterion ${criterion}`,
    );
    if (observation.resultat !== "vert") {
      refuser(`accessibility criterion ${criterion} is not green`);
    }
    if (
      !Array.isArray(observation.methodes) ||
      observation.methodes.length !== METHODES_ACCESSIBILITE.length ||
      new Set(observation.methodes).size !== METHODES_ACCESSIBILITE.length ||
      !METHODES_ACCESSIBILITE.every((method) =>
        observation.methodes.includes(method),
      )
    ) {
      refuser(
        `accessibility criterion ${criterion} must cite automatique and manuelle evidence`,
      );
    }
    if (isScreenReader) {
      const expectedTechnology = LECTEUR_ECRAN_PAR_PLATEFORME[platform];
      if (
        typeof observation.technologie !== "string" ||
        observation.technologie.trim() === ""
      ) {
        refuser(`accessibility criterion ${criterion} needs a screen reader`);
      }
      if (
        expectedTechnology !== undefined &&
        observation.technologie !== expectedTechnology
      ) {
        refuser(
          `${platform} must prove accessibility with ${expectedTechnology}`,
        );
      }
    }
    accessibility.set(criterion, observation);
  }

  validateInstalledNetworkBinding(transcript.network, { deployedWorkers });
  return { stories, accessibility };
}
