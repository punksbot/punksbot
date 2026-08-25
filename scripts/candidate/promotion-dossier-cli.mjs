/** Adaptateur CLI create-only de l'assembleur de dossier de promotion. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function refuser(message) {
  throw new Error(`dossier de promotion refusé : ${message}`);
}

const OPTIONS = new Set([
  "--racine-preuves",
  "--index-preuves",
  "--candidat-sha",
  "--promotion-profile",
  "--staging-deployment-proof",
  "--provenance-bundle",
  "--repository",
  "--source-ref",
  "--signer-workflow",
  "--sortie",
]);

function lireOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const cle = argv[index];
    const valeur = argv[index + 1];
    if (!cle?.startsWith("--") || valeur === undefined) {
      refuser("options attendues par paires --nom valeur");
    }
    if (!OPTIONS.has(cle)) refuser(`option inconnue ${cle}`);
    if (options.has(cle)) refuser(`option dupliquée ${cle}`);
    options.set(cle, valeur);
  }
  return options;
}

/** Parse les options, assemble le dossier puis l'écrit sans écrasement. */
export function runPromotionDossierCli(argv, assembler) {
  const options = lireOptions(argv);
  const exiger = (nom) => {
    const valeur = options.get(nom);
    if (valeur === undefined) refuser(`option obligatoire manquante ${nom}`);
    return valeur;
  };
  const dossier = assembler({
    racinePreuves: resolve(exiger("--racine-preuves")),
    indexPreuves: resolve(exiger("--index-preuves")),
    candidatSha: exiger("--candidat-sha"),
    promotionProfile: resolve(exiger("--promotion-profile")),
    stagingDeploymentProof: resolve(exiger("--staging-deployment-proof")),
    provenanceBundle: resolve(exiger("--provenance-bundle")),
    repository: exiger("--repository"),
    sourceRef: exiger("--source-ref"),
    signerWorkflow: exiger("--signer-workflow"),
  });
  writeFileSync(
    resolve(exiger("--sortie")),
    `${JSON.stringify(dossier, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return dossier;
}
