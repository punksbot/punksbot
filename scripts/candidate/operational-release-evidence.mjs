import { canonicalSha256 } from "../migration-manifest-lib.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`operational release evidence rejected: ${message}`);
}

/** Exact promotion subjects consumed by the ten operational cadence steps. */
export function operationalEvidenceDigests(dossier, publicationResult) {
  const receipt = publicationResult?.objets?.find(
    ({ sorte }) => sorte === "recu",
  );
  if (!SHA256_RE.test(receipt?.sha256 ?? "")) {
    fail("published promotion Receipt digest is missing");
  }
  const values = {
    E0: canonicalSha256(dossier.gates),
    E1: canonicalSha256(dossier.liaison?.staging),
    E2: canonicalSha256(dossier.parcours),
    E3: canonicalSha256(dossier.accessibilite),
    E4: canonicalSha256({
      recuperation: dossier.recuperation,
      retrait: dossier.retrait,
    }),
    A0: canonicalSha256(dossier.liaison?.artefacts),
    A1: canonicalSha256(dossier.parcours),
    A2: canonicalSha256(dossier.fautes),
    A3: canonicalSha256({ scans: dossier.scans, goldens: dossier.goldens }),
    A4: receipt.sha256,
  };
  if (Object.values(values).some((value) => !SHA256_RE.test(value))) {
    fail("one operational evidence digest is invalid");
  }
  return values;
}
