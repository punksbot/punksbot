/** Fixtures partagées des tests de la chaîne de promotion desktop. */
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

export function contenuManifesteCandidatFixture({
  candidateSha,
  stagingDeploymentId,
  stagingProofSha256,
  repository,
  plateformes,
  artefacts,
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
