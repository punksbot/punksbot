/** Validation locale de la paire attestation/Reçu avant publication. */
import {
  BASELINE_PUNKS,
  CHECKPOINT_RECUPERATION,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import {
  construireAttestation,
  validerDossier,
} from "./promotion-dossier-lib.mjs";
import {
  validateDeployedWorkerDescriptors,
  validatePromotionProfileDescriptor,
} from "./promotion-materials-lib.mjs";
import {
  NOMS_REGISTRES_ATTESTATION,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
} from "./release-graph-lib.mjs";

function estSha256(valeur) {
  return typeof valeur === "string" && /^[0-9a-f]{64}$/.test(valeur);
}

function clesExactes(valeur, cles) {
  return (
    valeur &&
    typeof valeur === "object" &&
    !Array.isArray(valeur) &&
    Object.keys(valeur).sort().join("\u0000") ===
      [...cles].sort().join("\u0000")
  );
}

function valeursUniquesExactes(liste, attendues, cle) {
  if (!Array.isArray(liste) || liste.length !== attendues.length) return false;
  const valeurs = liste.map((entree) => entree?.[cle]);
  return (
    new Set(valeurs).size === attendues.length &&
    attendues.every((attendue) => valeurs.includes(attendue))
  );
}

function validerAttestationLocale(attestation) {
  if (
    !clesExactes(attestation, [
      "artefacts",
      "checkpoint-baseline",
      "digests-production",
      "dossier",
      "gates",
      "profil",
      "registres",
      "sha",
      "staging",
    ])
  ) {
    throw new Error("attestation locale complète à schéma fermé exigée");
  }
  if (
    !clesExactes(attestation.dossier, ["sha256"]) ||
    !estSha256(attestation.dossier.sha256)
  ) {
    throw new Error(
      "l'attestation locale complète doit lier le hash canonique du dossier de preuve",
    );
  }
  if (attestation["checkpoint-baseline"] !== BASELINE_PUNKS) {
    throw new Error(
      "l'attestation locale complète doit lier le checkpoint de baseline exact",
    );
  }
  try {
    validatePromotionProfileDescriptor(attestation.profil);
  } catch (erreur) {
    throw new Error(
      "l'attestation locale doit sceller le profil de promotion",
      {
        cause: erreur,
      },
    );
  }
  if (
    !valeursUniquesExactes(
      attestation.registres,
      NOMS_REGISTRES_ATTESTATION,
      "nom",
    ) ||
    attestation.registres.some(
      (registre) =>
        !clesExactes(registre, ["nom", "sha256", "version"]) ||
        !Number.isInteger(registre?.version) ||
        registre.version < 1 ||
        !estSha256(registre?.sha256),
    )
  ) {
    throw new Error(
      "l'attestation locale complète doit contenir les versions et hashes exacts de tous les registres",
    );
  }
  const staging = attestation.staging;
  if (
    !clesExactes(staging, [
      "autorites",
      "compte",
      "deploiement",
      "deploiement-preuve-sha256",
      "environnement",
      "materiau",
      "materiau-sha256",
      "workers",
      "zone",
    ]) ||
    staging?.environnement !== "staging" ||
    !/^[0-9a-f]{32}$/.test(staging?.compte ?? "") ||
    !/^[0-9a-f]{32}$/.test(staging?.zone ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(staging?.deploiement ?? "") ||
    !estSha256(staging?.["deploiement-preuve-sha256"]) ||
    staging?.materiau !== "cloudflare/staging.resources.json" ||
    !estSha256(staging?.["materiau-sha256"]) ||
    !Array.isArray(staging?.autorites) ||
    staging.autorites.length === 0 ||
    new Set(staging.autorites).size !== staging.autorites.length ||
    staging.autorites.some(
      (autorite) =>
        typeof autorite !== "string" ||
        autorite.trim() === "" ||
        autorite.includes("/"),
    )
  ) {
    throw new Error(
      "l'attestation locale complète doit contenir les identifiants du déploiement staging exact",
    );
  }
  try {
    validateDeployedWorkerDescriptors(staging.workers);
  } catch (erreur) {
    throw new Error(
      "l'attestation locale doit sceller les versions Workers exactes",
      { cause: erreur },
    );
  }
  if (
    !valeursUniquesExactes(attestation.gates, PREUVES_OBLIGATOIRES, "gate") ||
    attestation.gates.some(
      (gate) =>
        !clesExactes(gate, ["gate", "resultat", "sha"]) ||
        gate?.resultat !== "vert" ||
        gate?.sha !== attestation.sha,
    )
  ) {
    throw new Error(
      "l'attestation locale complète doit contenir toutes les gates vertes liées au SHA exact",
    );
  }
  if (
    !valeursUniquesExactes(attestation.artefacts, PLATEFORMES, "plateforme") ||
    attestation.artefacts.some(
      (artefact) =>
        !clesExactes(artefact, [
          "bundleId",
          "nom",
          "plateforme",
          "sha256",
          "signature",
          "signatureNom",
          "signatureTaille",
          "taille",
          "transcriptSha256",
        ]) ||
        typeof artefact?.nom !== "string" ||
        artefact.nom.trim() === "" ||
        typeof artefact?.signatureNom !== "string" ||
        artefact.signatureNom.trim() === "" ||
        artefact?.bundleId !== "bot.punks.desktop.staging" ||
        !estSha256(artefact?.sha256) ||
        !estSha256(artefact?.signature) ||
        !estSha256(artefact?.transcriptSha256) ||
        !Number.isInteger(artefact?.taille) ||
        artefact.taille < 1 ||
        !Number.isInteger(artefact?.signatureTaille) ||
        artefact.signatureTaille < 1,
    )
  ) {
    throw new Error(
      "l'attestation locale complète doit contenir les hashes de tous les artefacts distribués",
    );
  }
  const digests = attestation["digests-production"];
  if (
    !clesExactes(digests, ["bundle", "manifeste"]) ||
    !estSha256(digests.bundle) ||
    !estSha256(digests.manifeste)
  ) {
    throw new Error(
      "l'attestation locale complète doit sceller les digests du bundle et du manifeste production",
    );
  }
}

/**
 * Valide la forme fermée d'une attestation locale non publiée et du Reçu qui
 * lie son hash canonique; retourne le numéro de tranche ou lève au premier
 * écart d'identité, de matériau, de signature anticipée ou de publication.
 */
export function validerPaireLocale(attestation, recu) {
  if (!/^[0-9a-f]{40}$/.test(attestation?.sha)) {
    throw new Error(
      "le SHA exact de l'attestation doit contenir 40 hexadécimaux",
    );
  }
  if (
    attestation.sha === BASELINE_PUNKS ||
    attestation.sha === CHECKPOINT_RECUPERATION
  ) {
    throw new Error(
      "le SHA de publication Punks doit être distinct des checkpoints Punks interdits",
    );
  }
  validerAttestationLocale(attestation);
  const correspondance = /^recu-promotion-([1-9][0-9]*)-([0-9a-f]{40})$/.exec(
    recu?.id ?? "",
  );
  if (!correspondance) {
    throw new Error("identifiant du Reçu de promotion invalide");
  }
  if (correspondance[2] !== attestation.sha) {
    throw new Error("l'identifiant du Reçu doit citer le SHA de l'attestation");
  }
  const contenu = recu?.contenu;
  if (
    !clesExactes(recu, ["contenu", "id", "sha256"]) ||
    !clesExactes(contenu, ["attestation-sha256", "id", "schema", "type"])
  ) {
    throw new Error("Reçu local à schéma fermé exigé");
  }
  if (
    !contenu ||
    typeof contenu !== "object" ||
    Array.isArray(contenu) ||
    contenu.schema !== "punks.release-receipt.v1" ||
    contenu.id !== recu.id ||
    contenu.type !== "promotion" ||
    contenu["attestation-sha256"] !== canonicalSha256(attestation) ||
    recu.sha256 !== canonicalSha256(contenu)
  ) {
    throw new Error(
      "le Reçu local doit lier exactement son contenu canonique et l'attestation locale",
    );
  }
  if (
    "publiee" in attestation ||
    "publication" in attestation ||
    "publication" in recu ||
    "signatures" in recu ||
    "approbateurs" in contenu
  ) {
    throw new Error(
      "la source locale doit être non publiée et non signée avant finalisation",
    );
  }
  return Number(correspondance[1]);
}

/**
 * Relit un dossier avec son contexte matériel, reconstruit son émission pure
 * et exige que l'attestation et le Reçu fournis soient exactement identiques;
 * lève avant toute frontière distante si une preuve ou un octet diverge.
 */
export function validerEmissionLocaleDepuisDossier(
  dossier,
  contexteDossier,
  attestation,
  recu,
) {
  if (
    dossier === null ||
    typeof dossier !== "object" ||
    Array.isArray(dossier) ||
    contexteDossier === null ||
    typeof contexteDossier !== "object" ||
    Array.isArray(contexteDossier)
  ) {
    throw new Error(
      "le dossier validé et son contexte matériel exact sont exigés avant publication",
    );
  }
  const erreurs = validerDossier(dossier, contexteDossier);
  if (erreurs.length > 0) {
    throw new Error(
      `le dossier validé est invalide à la frontière de publication : ${erreurs
        .slice(0, 5)
        .join(" ; ")}`,
    );
  }
  const attendue = construireAttestation(dossier, {
    ...contexteDossier,
    autorisation: { cloudflareCheck: "vert", graphe: "vert" },
  });
  if (
    attendue.erreur !== undefined ||
    canonicalSha256(attestation) !== canonicalSha256(attendue.attestation) ||
    canonicalSha256(recu) !== canonicalSha256(attendue.recu)
  ) {
    throw new Error(
      "l'attestation et le Reçu doivent reproduire l'émission locale exacte du dossier validé",
    );
  }
}
