/** Construction pure du contenu immuable d'une attestation de promotion. */
import { canonicalSha256 } from "./migration-manifest-lib.mjs";
import { PREUVES_OBLIGATOIRES } from "./release-graph-lib.mjs";

/** Projette un dossier déjà validé vers son attestation et son Reçu liés. */
export function construireEmissionAttestation(dossier) {
  const liaison = dossier.liaison;
  const attestation = {
    sha: dossier.candidat.sha,
    dossier: { sha256: canonicalSha256(dossier) },
    "checkpoint-baseline": dossier["baseline-punks"],
    profil: { ...dossier.profil },
    registres: liaison.registres.map((registre) => ({
      nom: registre.nom,
      version: registre.version,
      sha256: registre.sha256,
    })),
    staging: {
      environnement: liaison.staging.environnement,
      compte: liaison.staging.compte,
      zone: liaison.staging.zone,
      deploiement: liaison.staging.deploiement,
      "deploiement-preuve-sha256": liaison.staging["deploiement-preuve-sha256"],
      materiau: liaison.staging.materiau,
      "materiau-sha256": liaison.staging["materiau-sha256"],
      workers: liaison.staging.workers.map((worker) => ({ ...worker })),
      autorites: [...liaison.staging.autorites],
    },
    gates: PREUVES_OBLIGATOIRES.map((preuve) => ({
      gate: preuve,
      resultat: dossier.gates[preuve].resultat,
      sha: dossier.candidat.sha,
    })),
    artefacts: liaison.artefacts.map((artefact) => ({
      plateforme: artefact.plateforme,
      nom: artefact.nom,
      sha256: artefact.sha256,
      taille: artefact.taille,
      signatureNom: artefact.signatureNom,
      signature: artefact.signature,
      signatureTaille: artefact.signatureTaille,
      transcriptSha256: artefact.transcriptSha256,
      bundleId: artefact.identite.bundleId,
    })),
    "digests-production": { ...liaison["digests-production"] },
  };
  const recuId = `recu-promotion-${dossier.candidat.tranche}-${dossier.candidat.sha}`;
  const contenuRecu = {
    schema: "punks.release-receipt.v1",
    id: recuId,
    type: "promotion",
    "attestation-sha256": canonicalSha256(attestation),
  };
  return {
    attestation,
    recu: {
      id: recuId,
      contenu: contenuRecu,
      sha256: canonicalSha256(contenuRecu),
    },
  };
}
