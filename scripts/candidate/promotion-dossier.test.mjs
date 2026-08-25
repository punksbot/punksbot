import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import {
  METHODES_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  TYPES_FAUTE,
  validerDossier,
} from "../promotion-dossier-lib.mjs";
import {
  bundleSigstoreFixture,
  contenuManifesteCandidatFixture,
  contenuTranscriptInstalleFixture,
  nomsReleaseInstallee,
} from "../promotion-test-fixtures.mjs";
import { assemblerDossierPromotion } from "./promotion-dossier.mjs";

const SHA_CANDIDAT = "a".repeat(40);
const MATERIAU_PREUVE_STAGING = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SHA_CANDIDAT,
  observer: "cloudflare-remote",
  workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
    name,
    versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sourceShaAnnotation: sourceShaAnnotation(SHA_CANDIDAT),
    deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  })),
};
const DEPLOIEMENT = `sha256:${createHash("sha256")
  .update(canonicalJson(MATERIAU_PREUVE_STAGING), "utf8")
  .digest("hex")}`;
const CONTENU_PREUVE_STAGING = `${JSON.stringify(
  {
    ...MATERIAU_PREUVE_STAGING,
    deploymentId: DEPLOIEMENT,
  },
  null,
  2,
)}\n`;
const PLATEFORMES = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];
const WORKERS = [...CANONICAL_STAGING_WORKER_NAMES];
const PROFIL_PROMOTION_PATH = resolve("cloudflare/promotion-profiles.json");
const CONTENU_PROFIL_PROMOTION = readFileSync(PROFIL_PROMOTION_PATH);
const PROFIL_PROMOTION = JSON.parse(CONTENU_PROFIL_PROMOTION).profiles.find(
  ({ tranche }) => tranche === 1,
);
const AUTORITES = PROFIL_PROMOTION.authorities.map(({ id }) => id);
const RECITS = [...PROFIL_PROMOTION.stories];
const CONTENU_MATERIAU_STAGING = readFileSync(
  resolve("cloudflare/staging.resources.json"),
);
const MATERIAU_STAGING = JSON.parse(CONTENU_MATERIAU_STAGING);
const DEPOT = "punksbot/punksbot";
const REF_SOURCE = "refs/heads/staging";
const WORKFLOW_SIGNATAIRE =
  "github.com/punksbot/punksbot/.github/workflows/punks-desktop-candidate.yml";

function technologieLecteurEcran(plateforme) {
  if (plateforme.startsWith("macos-")) return "VoiceOver";
  if (plateforme === "windows-x64") return "NVDA";
  return "Orca";
}
const VERIFICATIONS = [
  "signature",
  "identite-application",
  "protocol-handlers",
  "stockage-securise",
  "updater",
];
const ACCESSIBILITE = [
  "clavier",
  "focus",
  "zoom-200",
  "contraste",
  "mouvement-reduit",
  "lecteur-ecran",
];
const GATES = [
  "corpus-conformite",
  "suites-workers",
  "cloudflare-check",
  "playwright-facade",
  "tauri-staging",
  "accessibilite",
  "fautes-injectees",
  "retrait-diff",
  "goldens-verdict",
  "scans-negatifs",
];

function sha256(contenu) {
  return createHash("sha256").update(contenu).digest("hex");
}

const CONTENU_BUNDLE_PRODUCTION = `${JSON.stringify(bundleSigstoreFixture())}\n`;
const ARTEFACTS_PRODUCTION = PLATEFORMES.map((plateforme) => {
  const [nom, signatureNom] = nomsReleaseInstallee(plateforme, SHA_CANDIDAT);
  return {
    nom,
    sha256: sha256(`bundle:${plateforme}`),
    taille: Buffer.byteLength(`bundle:${plateforme}`),
    signatureNom,
    signature: sha256(`signature:${plateforme}`),
    signatureTaille: Buffer.byteLength(`signature:${plateforme}`),
  };
});
const CONTENU_MANIFESTE_PRODUCTION = contenuManifesteCandidatFixture({
  candidateSha: SHA_CANDIDAT,
  stagingDeploymentId: DEPLOIEMENT,
  stagingProofSha256: sha256(CONTENU_PREUVE_STAGING),
  repository: DEPOT,
  plateformes: PLATEFORMES,
  artefacts: ARTEFACTS_PRODUCTION,
});
const DIGESTS_PRODUCTION = {
  bundle: sha256(CONTENU_BUNDLE_PRODUCTION),
  manifeste: sha256(CONTENU_MANIFESTE_PRODUCTION),
};

function contenuTranscript(plateforme) {
  return contenuTranscriptInstalleFixture({
    candidateSha: SHA_CANDIDAT,
    stagingDeploymentId: DEPLOIEMENT,
    plateforme,
    workers: MATERIAU_PREUVE_STAGING.workers,
    artifactSha256: sha256(`bundle:${plateforme}`),
  });
}

function creerJeuDePreuves() {
  const racine = mkdtempSync(join(tmpdir(), "punks-promotion-dossier-"));
  const references = [];
  const parId = new Map();
  const appelsProvenance = [];

  const ajouter = (
    id,
    data = {},
    surcharges = {},
    contenuSujet = `observation:${id}\n`,
  ) => {
    const octetsSujet = Buffer.from(contenuSujet);
    const empreinteSujet = sha256(octetsSujet);
    const sujetChemin = join(
      "sha256",
      `${empreinteSujet}-${id.replaceAll(/[^a-z0-9.-]/gi, "-")}-subject.bin`,
    );
    const sujetAbsolu = join(racine, sujetChemin);
    mkdirSync(dirname(sujetAbsolu), { recursive: true });
    writeFileSync(sujetAbsolu, octetsSujet, { flag: "wx" });
    const preuve = {
      schema: "punks.promotion-proof.v1",
      id,
      candidateSha: SHA_CANDIDAT,
      stagingDeploymentId: DEPLOIEMENT,
      result: "vert",
      data: { ...data, subjectSha256: empreinteSujet },
      ...surcharges,
    };
    const contenu = `${JSON.stringify(preuve)}\n`;
    const empreinte = sha256(contenu);
    const chemin = join(
      "sha256",
      `${empreinte}-${id.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`,
    );
    const absolu = join(racine, chemin);
    mkdirSync(dirname(absolu), { recursive: true });
    writeFileSync(absolu, contenu, { flag: "wx" });
    const reference = {
      id,
      chemin,
      sha256: empreinte,
      sujet: { chemin: sujetChemin, sha256: empreinteSujet },
    };
    references.push(reference);
    parId.set(id, {
      absolu,
      preuve,
      reference,
      sujetAbsolu,
      contenuSujet: octetsSujet,
    });
    return reference;
  };

  ajouter("candidat", { tranche: 1 });
  ajouter(
    "profil/promotion",
    {
      materiau: "cloudflare/promotion-profiles.json",
      profil: PROFIL_PROMOTION.id,
      tranche: 1,
      recits: RECITS,
      autorites: AUTORITES,
    },
    {},
    CONTENU_PROFIL_PROMOTION,
  );
  ajouter("registres", {
    registres: [
      ["registre-contrats", "1"],
      ["profil", "2"],
      ["registre-goldens", "3"],
      ["manifeste-retrait", "4"],
    ].map(([nom, octet]) => ({
      nom,
      version: 1,
      sha256: octet.repeat(64),
    })),
  });
  ajouter(
    "staging/materiau",
    {
      environnement: "staging",
      compte: CANONICAL_STAGING_ACCOUNT_ID,
      zone: MATERIAU_STAGING.zone.id,
      deploiement: DEPLOIEMENT,
      materiau: "cloudflare/staging.resources.json",
      workers: WORKERS,
    },
    {},
    CONTENU_MATERIAU_STAGING,
  );
  ajouter(
    "staging/deploiement",
    {
      compte: CANONICAL_STAGING_ACCOUNT_ID,
      environnement: "staging",
      deploiement: DEPLOIEMENT,
      workers: WORKERS,
    },
    {},
    CONTENU_PREUVE_STAGING,
  );
  const bundles = new Map();
  for (const plateforme of PLATEFORMES) {
    const transcript = contenuTranscript(plateforme);
    const transcriptSha256 = sha256(transcript);
    const [nomArtefact, nomSignature] = nomsReleaseInstallee(
      plateforme,
      SHA_CANDIDAT,
    );
    ajouter(
      `transcript/${plateforme}`,
      {
        schema: "punks.installed-social-loop-transcript.v1",
        plateforme,
      },
      { plateforme },
      transcript,
    );
    ajouter(
      `staging/reobservation/${plateforme}`,
      {
        transcriptSha256,
        initialStagingProofSha256: sha256(CONTENU_PREUVE_STAGING),
        deploymentId: DEPLOIEMENT,
        workers: MATERIAU_PREUVE_STAGING.workers.map(
          ({ name, versionId, deploymentId }) => ({
            name,
            versionId,
            deploymentId,
          }),
        ),
        sequence: ["transcript-installed", "cloudflare-reobserved"],
      },
      { plateforme },
      CONTENU_PREUVE_STAGING,
    );
    ajouter(
      `artefact/${plateforme}/bundle`,
      {
        nom: nomArtefact,
        bundleId: "bot.punks.desktop.staging",
        taille: Buffer.byteLength(`bundle:${plateforme}`),
        transcriptSha256,
      },
      { plateforme },
      `bundle:${plateforme}`,
    );
    bundles.set(plateforme, sha256(`bundle:${plateforme}`));
    ajouter(
      `artefact/${plateforme}/signature`,
      {
        nom: nomSignature,
        taille: Buffer.byteLength(`signature:${plateforme}`),
        transcriptSha256,
      },
      { plateforme },
      `signature:${plateforme}`,
    );
    for (const verification of VERIFICATIONS) {
      ajouter(
        `artefact/${plateforme}/verification/${verification}`,
        { transcriptSha256 },
        { plateforme },
        transcript,
      );
    }
    for (const recit of RECITS) {
      ajouter(
        `parcours/${plateforme}/${recit}`,
        {
          sha256Artefact: bundles.get(plateforme),
          via: ["ui", "ipc-rust", "contrats-publics"],
          contour: "distribue",
          serveurVite: false,
          facadeTest: false,
          transcriptSha256,
        },
        { plateforme },
        transcript,
      );
    }
    for (const critere of ACCESSIBILITE) {
      ajouter(
        `accessibilite/${plateforme}/${critere}`,
        {
          transcriptSha256,
          methodes: METHODES_ACCESSIBILITE,
          ...(critere === "lecteur-ecran"
            ? { technologie: technologieLecteurEcran(plateforme) }
            : {}),
        },
        { plateforme },
        transcript,
      );
    }
    ajouter(
      `accessibilite/${plateforme}/resultat`,
      {
        transcriptSha256,
        methodes: METHODES_ACCESSIBILITE,
        technologieLecteurEcran: technologieLecteurEcran(plateforme),
      },
      { plateforme },
      transcript,
    );
  }
  ajouter("production/bundle", {}, {}, CONTENU_BUNDLE_PRODUCTION);
  ajouter("production/manifeste", {}, {}, CONTENU_MANIFESTE_PRODUCTION);

  const captures = [];
  TYPES_FAUTE.forEach((type, typeIndex) => {
    AUTORITES.forEach((autorite, autoriteIndex) => {
      const plateforme =
        PLATEFORMES[(typeIndex + autoriteIndex) % PLATEFORMES.length];
      const executionId = `fault-${type}-${autorite}`;
      const contenuCapture = `capture:${type}:${autorite}\n`;
      const captureSha256 = sha256(contenuCapture);
      const faute = ajouter(
        `faute/${type}/${autorite}`,
        {
          autorite,
          plateforme,
          executionId,
          sha256Artefact: bundles.get(plateforme),
          transcriptSha256: sha256(contenuTranscript(plateforme)),
          captureSha256,
        },
        { plateforme },
        contenuCapture,
      );
      captures.push({ type, autorite, captureSha256 });
      for (const preuve of PREUVES_RECUPERATION) {
        ajouter(
          `recuperation/${preuve}/${type}/${autorite}`,
          {
            type,
            autorite,
            plateforme,
            executionId,
            fauteSha256: faute.sha256,
            sha256Artefact: bundles.get(plateforme),
            captureSha256,
          },
          { plateforme },
          `recovery:${preuve}:${type}:${autorite}\n`,
        );
      }
    });
  });
  ajouter(
    "recuperation/captures",
    { captures },
    {},
    `${JSON.stringify(captures)}\n`,
  );

  const testGolden = "desktop/tests/e2e/social-loop.spec.ts";
  ajouter(`golden/${testGolden}`, {
    test: testGolden,
    verdict: "preuve-punks",
  });
  ajouter("retrait/diff", {
    lignes: [testGolden],
    verdictsExecutes: 1,
  });
  ajouter("retrait/verdicts");

  for (const cible of ["sources", "dependances", "artefact", "reseau"]) {
    ajouter(`scan/${cible}`);
  }
  for (const gate of GATES) {
    ajouter(`gate/${gate}`);
  }

  const index = join(racine, "index.json");
  writeFileSync(
    index,
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: references,
    })}\n`,
    { flag: "wx" },
  );
  const provenanceBundle = join(racine, "provenance.sigstore.json");
  writeFileSync(
    provenanceBundle,
    `${JSON.stringify(bundleSigstoreFixture())}\n`,
    {
      flag: "wx",
    },
  );
  const verifierProvenance = (appel) => {
    appelsProvenance.push({
      ...appel,
      artifactSha256: sha256(appel.artifactContent),
      bundleSha256: sha256(appel.bundleContent),
    });
  };
  return {
    racine,
    index,
    parId,
    references,
    bundles,
    stagingDeploymentProof: parId.get("staging/deploiement").sujetAbsolu,
    provenanceBundle,
    verifierProvenance,
    appelsProvenance,
  };
}

function assembler(fixture, surcharges = {}) {
  return assemblerDossierPromotion({
    racinePreuves: fixture.racine,
    indexPreuves: fixture.index,
    candidatSha: SHA_CANDIDAT,
    promotionProfile: PROFIL_PROMOTION_PATH,
    stagingDeploymentProof: fixture.stagingDeploymentProof,
    provenanceBundle: fixture.provenanceBundle,
    repository: DEPOT,
    sourceRef: REF_SOURCE,
    signerWorkflow: WORKFLOW_SIGNATAIRE,
    verifierProvenance: fixture.verifierProvenance,
    ...surcharges,
  });
}

function reecrireIndex(fixture) {
  writeFileSync(
    fixture.index,
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: fixture.references,
    })}\n`,
  );
}

function remplacerPreuve(fixture, id, modifier) {
  const entree = fixture.parId.get(id);
  const preuve = JSON.parse(readFileSync(entree.absolu, "utf8"));
  modifier(preuve);
  const contenu = `${JSON.stringify(preuve)}\n`;
  const empreinte = sha256(contenu);
  const chemin = join(
    "sha256",
    `${empreinte}-${id.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`,
  );
  const absolu = join(fixture.racine, chemin);
  writeFileSync(absolu, contenu, { flag: "wx" });
  unlinkSync(entree.absolu);
  Object.assign(entree.reference, { chemin, sha256: empreinte });
  Object.assign(entree, { absolu, preuve });
  reecrireIndex(fixture);
}

test("assemble un dossier complet uniquement depuis les preuves réelles", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));

  const dossier = assembler(fixture);

  assert.equal(dossier.candidat.sha, SHA_CANDIDAT);
  assert.equal(dossier.liaison.staging.deploiement, DEPLOIEMENT);
  assert.deepEqual(dossier.liaison["digests-production"], DIGESTS_PRODUCTION);
  assert.deepEqual(
    dossier.liaison.artefacts.map(({ plateforme }) => plateforme),
    PLATEFORMES,
  );
  assert.deepEqual(
    validerDossier(dossier, {
      racinePreuves: fixture.racine,
      verifierProvenance: fixture.verifierProvenance,
    }),
    [],
  );
  assert.ok(
    fixture.appelsProvenance.some(
      ({ artifactSha256 }) =>
        artifactSha256 === sha256(readFileSync(fixture.index)),
    ),
    "l'index exact doit être vérifié par l'attestation GitHub",
  );
  assert.ok(
    fixture.appelsProvenance.some(
      ({ artifactSha256 }) =>
        artifactSha256 ===
        sha256(
          readFileSync(fixture.parId.get("transcript/linux-x64").sujetAbsolu),
        ),
    ),
    "les octets exacts du transcript doivent être sujets de l'attestation",
  );
  assert.equal(
    dossier.gates["cloudflare-check"].resultat,
    JSON.parse(
      readFileSync(fixture.parId.get("gate/cloudflare-check").absolu, "utf8"),
    ).result,
  );
});

test("refuse de mélanger les preuves de deux exécutions installées", (t) => {
  for (const id of [
    "artefact/linux-x64/signature",
    "artefact/linux-x64/verification/updater",
    "parcours/linux-x64/publication",
    "accessibilite/linux-x64/clavier",
    "accessibilite/linux-x64/resultat",
  ]) {
    const fixture = creerJeuDePreuves();
    t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
    remplacerPreuve(fixture, id, (preuve) => {
      preuve.data.transcriptSha256 = "f".repeat(64);
    });

    assert.throws(
      () => assembler(fixture),
      /divergente.*transcript/i,
      `la preuve ${id} doit provenir du même transcript installé`,
    );
  }
});

test("la validation finale refuse de réattribuer les preuves à un autre candidat", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const dossier = assembler(fixture);
  const autreSha = "e".repeat(40);
  dossier.candidat.sha = autreSha;
  for (const gate of Object.values(dossier.gates)) {
    gate.sha = autreSha;
  }

  const erreurs = validerDossier(dossier, {
    racinePreuves: fixture.racine,
    verifierProvenance: fixture.verifierProvenance,
  });

  assert.match(
    erreurs.join("\n"),
    /preuve.*SHA candidat/i,
    "les enveloppes de preuve doivent rester liées au SHA qui les a produites",
  );
});

test("la validation finale refuse de réattribuer les preuves à un autre staging", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const dossier = assembler(fixture);
  const autreDeploiement = `sha256:${"f".repeat(64)}`;
  dossier.liaison.staging.deploiement = autreDeploiement;
  for (const execution of dossier.parcours.executions) {
    execution.deploiement = autreDeploiement;
  }

  const erreurs = validerDossier(dossier, {
    racinePreuves: fixture.racine,
    verifierProvenance: fixture.verifierProvenance,
  });

  assert.match(
    erreurs.join("\n"),
    /preuve.*déploiement staging/i,
    "les enveloppes de preuve doivent rester liées au staging qui les a produites",
  );
});

test("la validation finale refuse une identité d'artefact divergente de sa preuve", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const dossier = assembler(fixture);
  dossier.liaison.artefacts[0].identite.bundleId =
    "bot.punks.desktop.contrefait";

  const erreurs = validerDossier(dossier, {
    racinePreuves: fixture.racine,
    verifierProvenance: fixture.verifierProvenance,
  });

  assert.match(
    erreurs.join("\n"),
    /preuve.*identité d'application/i,
    "le dossier final doit conserver l'identité observée dans l'artefact installé",
  );
});

test("le dossier final conserve les preuves de l'identité candidate et des registres", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));

  const dossier = assembler(fixture);
  const { id: _candidatId, ...preuveCandidat } =
    fixture.parId.get("candidat").reference;
  const { id: _registresId, ...preuveRegistres } =
    fixture.parId.get("registres").reference;
  preuveCandidat.subjectSha256 = preuveCandidat.sujet.sha256;
  preuveRegistres.subjectSha256 = preuveRegistres.sujet.sha256;

  assert.deepEqual(dossier.preuves.candidat, preuveCandidat);
  assert.deepEqual(dossier.preuves.registres, preuveRegistres);
});

test("la validation finale exige les versions exactes du graphe de release", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const dossier = assembler(fixture);
  const registresAttendus = Object.fromEntries(
    dossier.liaison.registres.map((registre) => [
      registre.nom,
      { version: registre.version, sha256: registre.sha256 },
    ]),
  );
  registresAttendus.profil = {
    ...registresAttendus.profil,
    version: registresAttendus.profil.version + 1,
  };

  const erreurs = validerDossier(dossier, {
    racinePreuves: fixture.racine,
    verifierProvenance: fixture.verifierProvenance,
    registresAttendus,
  });

  assert.match(
    erreurs.join("\n"),
    /registre « profil ».*version.*graphe de release/i,
  );
});

test("la validation finale refuse de citer deux fois le même registre", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const dossier = assembler(fixture);
  dossier.liaison.registres.push({ ...dossier.liaison.registres[0] });

  const erreurs = validerDossier(dossier, {
    racinePreuves: fixture.racine,
    verifierProvenance: fixture.verifierProvenance,
  });

  assert.match(erreurs.join("\n"), /registre.*cité deux fois/i);
});

test("la validation finale compare chaque projection aux données réellement prouvées", async (t) => {
  const mutations = [
    ["candidat", (dossier) => (dossier.candidat.tranche = 2)],
    ["registres", (dossier) => (dossier.liaison.registres[0].version = 2)],
    [
      "staging/materiau",
      (dossier) => (dossier.liaison.staging.compte = "9".repeat(32)),
    ],
    [
      "parcours/macos-arm64/publication",
      (dossier) =>
        dossier.parcours.executions
          .find(
            (execution) =>
              execution.plateforme === "macos-arm64" &&
              execution.recit === "publication",
          )
          .via.push("canal-parallele"),
    ],
    [
      `faute/coupure/${AUTORITES[0]}`,
      (dossier) => (dossier.fautes[0].autorite = "autre"),
    ],
    [
      "accessibilite/windows-x64/lecteur-ecran",
      (dossier) =>
        dossier.accessibilite
          .find((entree) => entree.plateforme === "windows-x64")
          .matrice["lecteur-ecran"].methodes.pop(),
    ],
    [
      "golden/desktop/tests/e2e/social-loop.spec.ts",
      (dossier) => (dossier.goldens[0].verdict = "hors-perimetre"),
    ],
    ["retrait/diff", (dossier) => (dossier.retrait["verdicts-executes"] = 2)],
  ];

  for (const [preuveAttendue, modifier] of mutations) {
    await t.test(preuveAttendue, () => {
      const fixture = creerJeuDePreuves();
      t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
      const dossier = assembler(fixture);
      modifier(dossier);

      const erreurs = validerDossier(dossier, {
        racinePreuves: fixture.racine,
        verifierProvenance: fixture.verifierProvenance,
      });

      assert.match(
        erreurs.join("\n"),
        new RegExp(`preuve.*${preuveAttendue.replaceAll("/", "\\/")}`, "i"),
      );
    });
  }
});

test("refuse une preuve obligatoire omise", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  fixture.references.splice(
    fixture.references.findIndex(({ id }) => id === "gate/cloudflare-check"),
    1,
  );
  reecrireIndex(fixture);

  assert.throws(
    () => assembler(fixture),
    /preuve obligatoire absente.*cloudflare-check/,
  );
});

test("le profil externe exige chaque récit sur les quatre plateformes", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const recit = RECITS.at(-1);
  for (let index = fixture.references.length - 1; index >= 0; index -= 1) {
    if (
      fixture.references[index].id.startsWith("parcours/") &&
      fixture.references[index].id.endsWith(`/${recit}`)
    ) {
      fixture.references.splice(index, 1);
    }
  }
  reecrireIndex(fixture);

  assert.throws(() => assembler(fixture), new RegExp(`preuve.*${recit}`, "i"));
});

test("refuse le contenu altéré après son adressage", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  writeFileSync(
    fixture.parId.get("scan/reseau").absolu,
    '{"result":"vert","tampered":true}\n',
  );

  assert.throws(
    () => assembler(fixture),
    /scan\/reseau.*altérée.*hash recalculé/,
  );
});

test("refuse une preuve proprement re-hashée mais liée au mauvais SHA", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  remplacerPreuve(fixture, "parcours/windows-x64/publication", (preuve) => {
    preuve.candidateSha = "c".repeat(40);
  });

  assert.throws(() => assembler(fixture), /mauvais SHA candidat/);
});

test("refuse une preuve liée à un autre déploiement staging", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  remplacerPreuve(fixture, "staging/materiau", (preuve) => {
    preuve.stagingDeploymentId = `sha256:${"d".repeat(64)}`;
  });

  assert.throws(() => assembler(fixture), /mauvais déploiement staging/);
});

test("refuse les identifiants, chemins et contenus dupliqués", (t) => {
  for (const doublon of ["id", "chemin", "sha256"]) {
    const fixture = creerJeuDePreuves();
    t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
    const premiere = fixture.references[0];
    const seconde = fixture.references[1];
    if (doublon === "id") seconde.id = premiere.id;
    if (doublon === "chemin") seconde.chemin = premiere.chemin;
    if (doublon === "sha256") seconde.sha256 = premiere.sha256;
    reecrireIndex(fixture);

    assert.throws(() => assembler(fixture), /dupliqué/, doublon);
  }
});

test("refuse les liens symboliques et les chemins hors racine", (t) => {
  const fixtureLien = creerJeuDePreuves();
  t.after(() => rmSync(fixtureLien.racine, { recursive: true, force: true }));
  const entree = fixtureLien.parId.get("gate/tauri-staging");
  const cible = `${entree.absolu}.cible`;
  renameSync(entree.absolu, cible);
  symlinkSync(cible, entree.absolu);
  assert.throws(() => assembler(fixtureLien), /lien symbolique/);

  const fixtureSortie = creerJeuDePreuves();
  t.after(() => rmSync(fixtureSortie.racine, { recursive: true, force: true }));
  fixtureSortie.references[0].chemin = "../preuve-externe.json";
  reecrireIndex(fixtureSortie);
  assert.throws(() => assembler(fixtureSortie), /hors racine/);
});

test("refuse un index qui traverse un répertoire symbolique", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const repertoireReel = join(fixture.racine, "index-reel");
  const repertoireLien = join(fixture.racine, "index-lien");
  mkdirSync(repertoireReel);
  const indexReel = join(repertoireReel, "index.json");
  renameSync(fixture.index, indexReel);
  symlinkSync(repertoireReel, repertoireLien);

  assert.throws(
    () =>
      assembler(fixture, {
        indexPreuves: join(repertoireLien, "index.json"),
      }),
    /index.*lien symbolique/,
  );
});

test("refuse toute valeur non verte et toute plateforme divergente", (t) => {
  const fixtureRouge = creerJeuDePreuves();
  t.after(() => rmSync(fixtureRouge.racine, { recursive: true, force: true }));
  remplacerPreuve(fixtureRouge, "accessibilite/linux-x64/focus", (preuve) => {
    preuve.result = "rouge";
  });
  assert.throws(() => assembler(fixtureRouge), /absente ou non verte/);

  const fixturePlateforme = creerJeuDePreuves();
  t.after(() =>
    rmSync(fixturePlateforme.racine, { recursive: true, force: true }),
  );
  remplacerPreuve(
    fixturePlateforme,
    "artefact/macos-arm64/signature",
    (preuve) => {
      preuve.plateforme = "macos-x64";
    },
  );
  assert.throws(
    () => assembler(fixturePlateforme),
    /plateforme macos-x64.*macos-arm64/,
  );
});

test("refuse les enveloppes auto-déclarées sans provenance GitHub vérifiée", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));

  assert.throws(
    () =>
      assembler(fixture, {
        verifierProvenance: () => {
          throw new Error("verification rejected");
        },
      }),
    /provenance.*verification rejected/i,
  );

  writeFileSync(
    fixture.provenanceBundle,
    `${JSON.stringify({ verified: true })}\n`,
  );
  assert.throws(() => assembler(fixture), /Sigstore|provenance/i);
});

test("refuse une récupération verte sans lien causal vers la faute exacte", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const id = `recuperation/roll-forward/coupure/${AUTORITES[0]}`;
  remplacerPreuve(fixture, id, (preuve) => {
    preuve.data.fauteSha256 = "f".repeat(64);
  });

  assert.throws(() => assembler(fixture), /récupération.*faute|lien causal/i);
});

test("refuse un staging forgé même si son identifiant déclaré reste inchangé", (t) => {
  const fixture = creerJeuDePreuves();
  t.after(() => rmSync(fixture.racine, { recursive: true, force: true }));
  const preuve = JSON.parse(
    readFileSync(fixture.stagingDeploymentProof, "utf8"),
  );
  preuve.workers[0].deploymentId = "20000000-0000-4000-8000-000000000001";
  const forge = join(fixture.racine, "staging-forge.json");
  writeFileSync(forge, `${JSON.stringify(preuve)}\n`);

  assert.throws(
    () =>
      assembler(fixture, {
        stagingDeploymentProof: forge,
      }),
    /staging.*digest|preuve.*staging/i,
  );
});
