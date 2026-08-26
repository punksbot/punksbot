/** Fixtures partagées des tests de la chaîne de promotion desktop. */
import { createHash } from "node:crypto";
import {
  IDENTITE_APPLICATION_PUNKS,
  MATRICE_ACCESSIBILITE,
  METHODES_ACCESSIBILITE,
  REQUIRED_STORIES,
  VERIFICATIONS_ARTEFACT,
} from "./promotion-installed-transcript-lib.mjs";

export function nomsReleaseInstallee(plateforme, candidateSha) {
  const prefixe = `punks-desktop-${plateforme}-${candidateSha}`;
  if (plateforme.startsWith("macos-")) {
    return [`${prefixe}.app.tar.gz`, `${prefixe}.app.tar.gz.sig`];
  }
  if (plateforme === "linux-x64") {
    return [`${prefixe}.AppImage`, `${prefixe}.AppImage.sig`];
  }
  return [`${prefixe}.exe`, `${prefixe}.exe.sig`];
}

export function bundleSigstoreFixture() {
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payload: Buffer.from("{}").toString("base64"),
      signatures: [{ keyid: "", sig: "ZmFrZQ==" }],
    },
    verificationMaterial: {
      certificate: { rawBytes: "ZmFrZQ==" },
      tlogEntries: [],
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inventoryDigest(schema, files, links) {
  return sha256(
    Buffer.from(
      JSON.stringify(
        links === undefined ? { schema, files } : { schema, files, links },
      ),
    ),
  );
}

export function contenuScanArtefactInstalleFixture({
  plateforme,
  candidateSha,
  nomArtefact,
  tailleArtefact,
  sha256Artefact,
  sha256Natif = "b".repeat(64),
  tailleNatif = 123,
}) {
  const nomNatif =
    plateforme === "windows-x64"
      ? "punks-bot-staging.exe"
      : "punks-bot-staging";
  const cheminNatif = plateforme.startsWith("macos-")
    ? `Punks Bot Staging.app/Contents/MacOS/${nomNatif}`
    : plateforme === "linux-x64"
      ? `usr/bin/${nomNatif}`
      : `Punks Bot Staging/${nomNatif}`;
  const fichiersInstallation = [
    { path: cheminNatif, size: tailleNatif, sha256: sha256Natif },
    {
      path: plateforme.startsWith("macos-")
        ? "Punks Bot Staging.app/Contents/Info.plist"
        : plateforme === "linux-x64"
          ? "usr/share/applications/punks-bot-staging.desktop"
          : "Punks Bot Staging/WebView2Loader.dll",
      size: 64,
      sha256: "9".repeat(64),
    },
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const fichiersFrontend = [
    { path: "assets/index.js", size: 31, sha256: "74".repeat(32) },
    { path: "index.html", size: 29, sha256: "73".repeat(32) },
  ];
  const liensInstallation = [];
  return `${JSON.stringify({
    schema: "punks.installed-artifact-scan.v2",
    platform: plateforme,
    candidateSha,
    artifact: {
      name: nomArtefact,
      size: tailleArtefact,
      sha256: sha256Artefact,
    },
    native: {
      name: nomNatif,
      size: tailleNatif,
      sha256: sha256Natif,
    },
    installation: {
      schema: "punks.installed-file-inventory.v1",
      files: fichiersInstallation,
      links: liensInstallation,
      sha256: inventoryDigest(
        "punks.installed-file-inventory.v1",
        fichiersInstallation,
        liensInstallation,
      ),
    },
    frontend: {
      schema: "punks.embedded-asset-manifest.v1",
      product: "punks-frontend",
      mode: "embedded-runtime",
      files: fichiersFrontend,
      sha256: inventoryDigest(
        "punks.embedded-asset-manifest.v1",
        fichiersFrontend,
      ),
      forbiddenMarkers: [],
    },
    forbiddenMarkers: [
      "buzz-media",
      "native_websocket",
      "buzz",
      "nostr",
      "relay",
      "huddle",
    ],
  })}\n`;
}

export function contenuManifesteCandidatFixture({
  candidateSha,
  stagingDeploymentId,
  stagingProofSha256,
  repository,
  plateformes,
  artefacts,
  promotionEvidenceDigests = {
    platformIndex: "a".repeat(64),
    recoveryIndex: "b".repeat(64),
    network: Object.fromEntries(
      plateformes.map((platform, index) => [
        platform,
        String.fromCharCode(99 + index).repeat(64),
      ]),
    ),
  },
}) {
  return `${JSON.stringify({
    schema: "punks.desktop-candidate-aggregate.v1",
    sourceSha: candidateSha,
    stagingDeploymentId,
    version: "1.0.0",
    repository,
    releaseTag: `punks-staging-${candidateSha}`,
    stagingProof: {
      path: "staging-deployment-proof.json",
      sha256: stagingProofSha256,
    },
    promotionEvidence: {
      platformIndex: {
        path: "promotion-evidence/platform-index.json",
        sha256: promotionEvidenceDigests.platformIndex,
      },
      recoveryIndex: {
        path: "promotion-evidence/recovery-index.json",
        sha256: promotionEvidenceDigests.recoveryIndex,
      },
      stagingProof: {
        path: "promotion-evidence/staging-deployment-proof.json",
        sha256: stagingProofSha256,
      },
      network: plateformes.map((platform) => ({
        platform,
        path: `promotion-evidence/network/${platform}.json`,
        sha256: promotionEvidenceDigests.network[platform],
      })),
    },
    platforms: plateformes.map((platform, index) => ({
      platform,
      target: `target-${platform}`,
      manifestSha256: String(index + 1).repeat(64),
      provenanceSha256: String(index + 5).repeat(64),
    })),
    immutableLatest: {
      path: `release-assets/latest-${candidateSha}.json`,
      sha256: "9".repeat(64),
    },
    releaseAssets: [
      ...artefacts.flatMap((artefact) => [
        {
          name: artefact.nom,
          sha256: artefact.sha256,
          size: artefact.taille,
        },
        {
          name: artefact.signatureNom,
          sha256: artefact.signature,
          size: artefact.signatureTaille,
        },
      ]),
      { name: "latest.json", sha256: "9".repeat(64), size: 12 },
      {
        name: `latest-${candidateSha}.json`,
        sha256: "9".repeat(64),
        size: 12,
      },
    ],
  })}\n`;
}

function lecteurEcran(plateforme) {
  if (plateforme.startsWith("macos-")) return "VoiceOver";
  if (plateforme === "windows-x64") return "NVDA";
  return "Orca";
}

export function preuveFollowFixture() {
  const request = {
    transport: "wss",
    method: "FOLLOW",
    origin: "wss://staging.punks.bot",
    path: "/api/v1/workspaces/id/conversations/id/follow",
    status: 101,
  };
  return {
    protocol: "punks.follow.v1",
    request,
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
    distributed: {
      proofSha256: "a".repeat(64),
      observedAt: "2026-08-26T17:11:41.455Z",
      catchUpFrames: 53,
      cursors: {
        initial: 54,
        live: 55,
        crashBeforeAck: 56,
        replay: 56,
      },
      scenarios: {
        catchUpAckReady: "vert",
        liveChangeAck: "vert",
        crashBeforeAckReplay: "vert",
        afterAckNoReplay: "vert",
        revokedSessionRejected: "vert",
      },
    },
  };
}

export function contenuTranscriptInstalleFixture({
  candidateSha,
  stagingDeploymentId,
  plateforme,
  workers,
  artifactSha256,
}) {
  const runtimeWorkers = workers.map(({ name, versionId }) => ({
    name,
    versionId,
  }));
  return `${JSON.stringify({
    schema: "punks.installed-social-loop-transcript.v1",
    candidateSha,
    stagingDeploymentId,
    platform: plateforme,
    result: "vert",
    driver: plateforme.startsWith("macos-") ? "xctest" : "tauri-driver",
    contour: "distribue",
    serveurVite: false,
    facadeTest: false,
    installed: {
      bundleId: IDENTITE_APPLICATION_PUNKS,
      artifactSha256,
      binarySha256: "b".repeat(64),
      launched: true,
    },
    verifications: Object.fromEntries(
      VERIFICATIONS_ARTEFACT.map((verification) => [verification, "vert"]),
    ),
    stories: REQUIRED_STORIES.map((id) => ({
      id,
      result: "vert",
      via: ["ui", "ipc-rust", "contrats-publics"],
      assertions: [`${id} exercé par le candidat installé`],
    })),
    accessibility: Object.fromEntries(
      MATRICE_ACCESSIBILITE.map((critere) => [
        critere,
        {
          resultat: "vert",
          methodes: [...METHODES_ACCESSIBILITE],
          ...(critere === "lecteur-ecran"
            ? { technologie: lecteurEcran(plateforme) }
            : {}),
        },
      ]),
    ),
    authentication: {
      contour: "navigateur-systeme-provider-reel",
      proof: {
        schema: "punks.live-staging-auth-matrix-proof.v2",
        sourceSha: candidateSha,
        stagingDeploymentId,
        flows: Object.fromEntries(
          ["google", "github", "passkey"].map((method) => [
            method,
            {
              success: { method, environment: "staging" },
              cancellation: { method, outcomeCode: "cancelled" },
            },
          ]),
        ),
        negative: {
          wrongOauthState: "refused",
          wrongBrowserBinding: "refused",
          wrongNativePkceVerifier: "refused",
          wrongPasskeyChallenge: "refused",
        },
      },
    },
    rawEvidence: {
      indexSha256: "71".repeat(32),
      files: 7,
    },
    network: {
      deployment: {
        transport: "https",
        method: "POST",
        origin: "https://staging.punks.bot",
        path: "/api/v1/desktop/compatibility",
        status: 200,
        responseHeader: "x-punks-worker-versions",
        responseHeaderValue: Buffer.from(
          JSON.stringify(runtimeWorkers),
        ).toString("base64url"),
        workers: runtimeWorkers,
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
          ...preuveFollowFixture().request,
        },
      ],
      follow: preuveFollowFixture(),
    },
  })}\n`;
}
