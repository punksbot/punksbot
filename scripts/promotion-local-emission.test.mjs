import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "./migration-manifest-lib.mjs";
import {
  emissionValidePourSha,
  nomsArtefactInstalle,
} from "./promotion-dossier-validator-fixture.mjs";
import { publierPromotion } from "./promotion-publish-lib.mjs";

const emission = emissionValidePourSha();
const destinations = [
  { role: "primaire", compte: "11".repeat(16), bucket: "promotion-a" },
  { role: "secondaire", compte: "22".repeat(16), bucket: "promotion-b" },
];

function recuPour(attestation) {
  const id = `recu-promotion-1-${attestation.sha}`;
  const contenu = {
    schema: "punks.release-receipt.v1",
    id,
    type: "promotion",
    "attestation-sha256": canonicalSha256(attestation),
  };
  return { id, contenu, sha256: canonicalSha256(contenu) };
}

function options(attestation, recu) {
  return {
    graphe: Buffer.from("{}"),
    dossier: Buffer.from(`${JSON.stringify(emission.dossier)}\n`),
    contexteDossier: emission.contexte,
    attestation: Buffer.from(`${JSON.stringify(attestation)}\n`),
    recu: Buffer.from(`${JSON.stringify(recu)}\n`),
    depot: "punksbot/punksbot",
    tag: `punks-staging-${attestation.sha}`,
    canal: "punks-desktop",
    r2: destinations,
    bootstrapR2: true,
  };
}

const frontieres = {
  confiance: {
    ancrageDestinationsR2: canonicalSha256(destinations),
  },
};

test("refuse toute attestation reconstruite hors du dossier validé", async () => {
  const mutations = [
    (attestation) => (attestation.dossier.sha256 = "f".repeat(64)),
    (attestation) => (attestation.profil["materiau-sha256"] = "e".repeat(64)),
    (attestation) =>
      (attestation.staging.workers = [attestation.staging.workers[0]]),
    (attestation) =>
      (attestation.staging.autorites = attestation.staging.autorites.filter(
        (autorite) => autorite !== "erasure-registry",
      )),
    (attestation) => {
      const artefact = attestation.artefacts.find(
        ({ plateforme }) => plateforme === "macos-arm64",
      );
      [artefact.nom, artefact.signatureNom] = nomsArtefactInstalle("linux-x64");
    },
  ];

  for (const muter of mutations) {
    const attestation = structuredClone(emission.attestation);
    muter(attestation);
    await assert.rejects(
      publierPromotion(options(attestation, recuPour(attestation)), frontieres),
      /dossier.*validé|émission locale exacte/i,
    );
  }
});
