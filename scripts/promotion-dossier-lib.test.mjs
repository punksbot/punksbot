/** Validation métier fail-closed du dossier de promotion Punks. */
import assert from "node:assert/strict";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BASELINE_PUNKS,
  CHECKPOINT_RECUPERATION,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import { finaliserPromotion } from "./promotion-publish-lib.mjs";
import {
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
  verifierSignatureRecu,
} from "./release-graph-lib.mjs";
import {
  PREUVES_RECUPERATION,
  SCANS_LEGACY,
  TYPES_FAUTE,
  VERIFICATIONS_ARTEFACT,
  candidatDejaScelle,
  construireAttestation,
  tranchePresente,
  validerDossier,
} from "./promotion-dossier-lib.mjs";
import {
  APPROBATION,
  AUTORITES,
  CONFIANCE_APPROBATION,
  LIGNES_REGISTRE,
  RACINE_PREUVES,
  SHA_CANDIDAT,
  STAGING,
  WORKERS_RUNTIME,
  artefact,
  attendu,
  contenuTranscript,
  contexteValide,
  dossierValide,
  nomsArtefactInstalle,
  preuvesPourDossier,
  remplacerPreuveSujet,
} from "./promotion-dossier-validator-fixture.mjs";

test("un dossier complet et autorisé produit l'attestation au format du graphe", () => {
  const dossier = dossierValide();
  assert.deepEqual(validerDossier(dossier, contexteValide()), []);
  const emission = construireAttestation(dossier, contexteValide());
  assert.equal(emission.erreur, undefined);
  assert.equal(emission.attestation.sha, SHA_CANDIDAT);
  assert.equal(emission.attestation["checkpoint-baseline"], BASELINE_PUNKS);
  assert.equal(emission.attestation.staging.deploiement, STAGING.deploiement);
  assert.deepEqual(
    emission.attestation["digests-production"],
    dossier.liaison["digests-production"],
  );
  assert.equal(emission.attestation.registres.length, 4);
  assert.equal(emission.attestation.artefacts.length, PLATEFORMES.length);
  assert.equal("publiee" in emission.attestation, false);
  assert.equal("publication" in emission.attestation, false);
  assert.equal("publication" in emission.recu, false);
  assert.ok(emission.recu.id.startsWith("recu-promotion-1-"));
  assert.equal(
    emission.recu.contenu["attestation-sha256"],
    canonicalSha256(emission.attestation),
  );
  assert.equal(emission.recu.sha256, canonicalSha256(emission.recu.contenu));
});

test("le transcript refuse un Worker runtime échangé ou un en-tête brut divergent", () => {
  for (const mutation of ["worker-echange", "header-divergent"]) {
    const dossier = dossierValide();
    const plateforme = "macos-arm64";
    const transcript = JSON.parse(contenuTranscript(plateforme));
    if (mutation === "worker-echange") {
      [
        transcript.network.deployment.workers[0].versionId,
        transcript.network.deployment.workers[1].versionId,
      ] = [
        transcript.network.deployment.workers[1].versionId,
        transcript.network.deployment.workers[0].versionId,
      ];
    } else {
      transcript.network.deployment.responseHeaderValue = Buffer.from(
        JSON.stringify([...WORKERS_RUNTIME].reverse()),
      ).toString("base64url");
    }
    const reference = remplacerPreuveSujet(
      dossier,
      `transcript/${plateforme}`,
      { contenuSujet: `${JSON.stringify(transcript)}\n` },
    );
    dossier.liaison.artefacts.find(
      (artefact) => artefact.plateforme === plateforme,
    ).transcriptSha256 = reference.subjectSha256;

    attendu(
      validerDossier(dossier, contexteValide()),
      "transcript brut installé invalide",
    );
  }
});

test("le validateur final refuse un transcript réseau-only tronqué", () => {
  const dossier = dossierValide();
  const plateforme = "macos-arm64";
  const complet = JSON.parse(contenuTranscript(plateforme));
  const tronque = {
    schema: complet.schema,
    candidateSha: complet.candidateSha,
    stagingDeploymentId: complet.stagingDeploymentId,
    platform: complet.platform,
    result: complet.result,
    network: complet.network,
  };
  const reference = remplacerPreuveSujet(dossier, `transcript/${plateforme}`, {
    contenuSujet: `${JSON.stringify(tronque)}\n`,
  });
  dossier.liaison.artefacts.find(
    (artefact) => artefact.plateforme === plateforme,
  ).transcriptSha256 = reference.subjectSha256;

  attendu(
    validerDossier(dossier, contexteValide()),
    "transcript brut installé invalide",
  );
});

test("la réobservation post-parcours est obligatoire et immuable", () => {
  const plateforme = "linux-x64";
  const identifiant = `staging/reobservation/${plateforme}`;

  const absente = dossierValide();
  delete absente.preuves[identifiant];
  attendu(
    validerDossier(absente, contexteValide()),
    `preuve « ${identifiant} » manquant`,
  );

  const alteree = dossierValide();
  const preuveStaging = JSON.parse(
    readFileSync(
      join(RACINE_PREUVES, alteree.preuves[identifiant].sujet.chemin),
      "utf8",
    ),
  );
  preuveStaging.workers[0].versionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  remplacerPreuveSujet(alteree, identifiant, {
    contenuSujet: `${JSON.stringify(preuveStaging)}\n`,
  });
  attendu(
    validerDossier(alteree, contexteValide()),
    "réobservation Cloudflare post-parcours invalide",
  );

  const autreDeploiement = dossierValide();
  const document = JSON.parse(
    readFileSync(
      join(RACINE_PREUVES, autreDeploiement.preuves[identifiant].chemin),
      "utf8",
    ),
  );
  remplacerPreuveSujet(autreDeploiement, identifiant, {
    data: {
      ...document.data,
      deploymentId: `sha256:${"f".repeat(64)}`,
    },
  });
  attendu(
    validerDossier(autreDeploiement, contexteValide()),
    "réobservation Cloudflare post-parcours invalide",
  );
});

test("un artefact updater ne peut pas être réattribué à une autre plateforme", () => {
  const dossier = dossierValide();
  const macos = dossier.liaison.artefacts.find(
    (artefact) => artefact.plateforme === "macos-arm64",
  );
  [macos.nom, macos.signatureNom] = nomsArtefactInstalle("linux-x64");

  attendu(
    validerDossier(dossier, contexteValide()),
    "installed release names do not match the exact platform updater roles",
  );
});

test("le Reçu lie l'attestation locale complète, pas seulement ses registres", () => {
  const original = construireAttestation(dossierValide(), contexteValide());
  assert.equal(original.erreur, undefined);

  const variations = [
    (dossier) => (dossier.candidat.sha = "31".repeat(20)),
    (dossier) => (dossier.liaison.registres[0].version = 2),
    (dossier) => (dossier.retrait["verdicts-executes"] = 5),
  ];
  for (const modifier of variations) {
    const dossier = dossierValide();
    modifier(dossier);
    if (dossier.candidat.sha !== SHA_CANDIDAT) {
      for (const gate of Object.values(dossier.gates)) {
        gate.sha = dossier.candidat.sha;
      }
      for (const artefact of dossier.liaison.artefacts) {
        [artefact.nom, artefact.signatureNom] = nomsArtefactInstalle(
          artefact.plateforme,
          dossier.candidat.sha,
        );
      }
    }
    if (
      dossier.liaison.artefacts[0].sha256 !== artefact(PLATEFORMES[0]).sha256
    ) {
      for (const execution of dossier.parcours.executions.filter(
        (entree) => entree.plateforme === PLATEFORMES[0],
      )) {
        execution.sha256Artefact = dossier.liaison.artefacts[0].sha256;
      }
    }
    if (dossier.liaison.staging.deploiement !== STAGING.deploiement) {
      for (const execution of dossier.parcours.executions) {
        execution.deploiement = dossier.liaison.staging.deploiement;
      }
    }
    dossier.preuves = preuvesPourDossier(dossier);
    const emission = construireAttestation(
      dossier,
      contexteValide({
        autorisation: { cloudflareCheck: "vert", graphe: "vert" },
      }),
    );
    assert.equal(emission.erreur, undefined);
    assert.notEqual(emission.recu.sha256, original.recu.sha256);
  }
});

test("l'en-tête du dossier est figé", () => {
  attendu(
    validerDossier(dossierValide({ version: 2 })),
    "version non supportée",
  );
  attendu(
    validerDossier(dossierValide({ "baseline-punks": "ff" })),
    "baseline Punks invalide",
  );
  attendu(
    validerDossier({ ...dossierValide(), candidat: { sha: "zz", tranche: 1 } }),
    "SHA exact",
  );
  for (const shaInterdit of [BASELINE_PUNKS, CHECKPOINT_RECUPERATION]) {
    const dossier = dossierValide();
    dossier.candidat.sha = shaInterdit;
    attendu(
      validerDossier(dossier, contexteValide()),
      "distinct des checkpoints Punks interdits",
    );
  }
});

test("la liaison relie sans ambiguïté SHA, artefacts et déploiement", () => {
  const cas = [
    [(d) => d.liaison.artefacts.pop(), "artefact manquant pour"],
    [(d) => (d.liaison.artefacts[0].sha256 = "court"), "sans sha256 valide"],
    [
      (d) => (d.liaison.artefacts[1].signature = "court"),
      "sans signature valide",
    ],
    [
      (d) => delete d.liaison.artefacts[2].identite,
      "sans identité d'application",
    ],
    [
      (d) =>
        (d.liaison.artefacts[0].identite.bundleId = "bot.punks.desktop.dev"),
      "identité d'application Punks staging exacte",
    ],
    [
      (d) => (d.liaison.artefacts[3].identite.verifications.updater = "echec"),
      "« updater »",
    ],
    [
      (d) => (d.liaison.staging.deploiement = ""),
      "déploiement Workers exact manquant",
    ],
    [
      (d) => (d.liaison.staging.deploiement = "staging-alias-mutable"),
      "déploiement Workers exact sha256",
    ],
    [
      (d) => (d.liaison.staging.compte = "0".repeat(32)),
      "divergents du matériau réel",
    ],
    [
      (d) => (d.liaison.staging["materiau-sha256"] = "6e".repeat(32)),
      "matériau de staging divergent du dépôt courant",
    ],
    [
      (d) => delete d.liaison["digests-production"],
      "digests du bundle et du manifeste production",
    ],
    [
      (d) => (d.liaison["digests-production"].bundle = "court"),
      "digest production « bundle » invalide",
    ],
    [
      (d) => d.liaison.registres.pop(),
      "registre « manifeste-retrait » non cité",
    ],
    [
      (d) => (d.liaison.registres[0].sha256 = "1".repeat(64)),
      "ne correspond pas au dépôt courant",
    ],
  ];
  for (const [muter, message] of cas) {
    const dossier = dossierValide();
    muter(dossier);
    attendu(validerDossier(dossier, contexteValide()), message);
  }
  for (const verification of VERIFICATIONS_ARTEFACT) {
    const dossier = dossierValide();
    delete dossier.liaison.artefacts[0].identite.verifications[verification];
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${verification} » manquant`,
    );
  }
});

test("le parcours distribué exclut serveur Vite et façade de test", () => {
  const cas = [
    [(p) => (p.contour = "vite"), "contour distribué exigé"],
    [(p) => (p.serveurVite = true), "aucun serveur Vite"],
    [(p) => (p.facadeTest = true), "aucune façade de test"],
    [(p) => p.executions.pop(), "exécution manquante pour"],
    [
      (p) => (p.executions[0].sha256Artefact = "9".repeat(64)),
      "rattaché au sha256 de l'artefact",
    ],
    [
      (p) => (p.executions[1].deploiement = "autre"),
      "déploiement Workers exact",
    ],
    [
      (p) => (p.executions[2].via = ["ui"]),
      "interface, IPC Rust et contrats publics",
    ],
    [(p) => (p.executions[3].resultat = "echec"), "non vert"],
    [(p) => (p.recits = []), "récits de la tranche"],
  ];
  for (const [muter, message] of cas) {
    const dossier = dossierValide();
    muter(dossier.parcours);
    attendu(validerDossier(dossier, contexteValide()), message);
  }
});

test("les matrices exactes refusent doublons et couche de parcours parallèle", () => {
  const cas = [
    [
      (dossier) => dossier.parcours.recits.push(dossier.parcours.recits[0]),
      /récit.*cité deux fois/i,
    ],
    [
      (dossier) => dossier.parcours.executions[0].via.push("http-direct"),
      /couches exactes.*UI.*IPC Rust.*contrats publics/i,
    ],
    [
      (dossier) => dossier.fautes.push({ ...dossier.fautes[0] }),
      /scénario.*coupure.*deux fois/i,
    ],
    [
      (dossier) => dossier.accessibilite.push({ ...dossier.accessibilite[0] }),
      /accessibilite.*macos-arm64.*deux fois/i,
    ],
    [
      (dossier) => dossier.goldens.push({ ...dossier.goldens[0] }),
      /goldens.*verdict.*deux fois/i,
    ],
    [
      (dossier) => dossier.retrait.lignes.push(dossier.retrait.lignes[0]),
      /retrait.*ligne.*deux fois/i,
    ],
  ];

  for (const [modifier, message] of cas) {
    const dossier = dossierValide();
    modifier(dossier);
    assert.match(validerDossier(dossier, contexteValide()).join("\n"), message);
  }
});

test("les fautes injectées couvrent coupures, révocations et pertes d'autorité", () => {
  for (const type of TYPES_FAUTE) {
    const dossier = dossierValide();
    dossier.fautes = dossier.fautes.filter((f) => f.type !== type);
    attendu(
      validerDossier(dossier, contexteValide()),
      `aucun scénario de type « ${type} »`,
    );
  }
  const dossier = dossierValide();
  dossier.fautes[0].resultat = "echec";
  attendu(
    validerDossier(dossier, contexteValide()),
    "scénario coupure non vert",
  );
  const dossier2 = dossierValide();
  dossier2.fautes = [
    {
      type: "retour-punks",
      plateforme: "macos-arm64",
      autorite: "x",
      resultat: "vert",
    },
  ];
  attendu(validerDossier(dossier2, contexteValide()), "type inconnu");
});

test("chaque type de faute couvre exactement chaque autorité staging", () => {
  const dossier = dossierValide();
  dossier.liaison.staging.autorites = AUTORITES.slice(0, 2);
  dossier.fautes = TYPES_FAUTE.map((type, index) => ({
    type,
    plateforme: PLATEFORMES[index],
    autorite: AUTORITES[0],
    resultat: "vert",
  }));

  attendu(
    validerDossier(dossier, contexteValide()),
    `scénario manquant pour revocation/${AUTORITES[1]}`,
  );
});

test("le roll-forward et le RPO logique nul sont prouvés par les scénarios", () => {
  for (const preuve of PREUVES_RECUPERATION) {
    const dossier = dossierValide();
    dossier.recuperation.scenarios[0].preuves[preuve].resultat = "non-prouve";
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${preuve} » doit être prouvé vert pour`,
    );
  }
  const dossier = dossierValide();
  dossier.recuperation.captures = "xx";
  attendu(
    validerDossier(dossier, contexteValide()),
    "captures de faute manquante",
  );

  const dossier3 = dossierValide();
  dossier3.recuperation.scenarios[0].preuves["roll-forward"].preuveSha256 =
    "f".repeat(64);
  attendu(
    validerDossier(dossier3, contexteValide()),
    "lien causal faute → récupération",
  );
});

test("la récupération prouve les sessions non restaurées et le reçu PITR", () => {
  for (const preuve of ["session-non-restauree", "recu-resistant-pitr"]) {
    const dossier = dossierValide();
    delete dossier.recuperation.scenarios[0].preuves[preuve];
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${preuve} » doit être prouvé vert pour`,
    );
  }
});

test("le dossier échoue sans matrice d'accessibilité complète par plateforme", () => {
  const dossier = dossierValide();
  dossier.accessibilite.pop();
  attendu(validerDossier(dossier, contexteValide()), "preuve manquante pour");
  const dossier2 = dossierValide();
  delete dossier2.accessibilite[0].matrice["zoom-200"];
  attendu(
    validerDossier(dossier2, contexteValide()),
    "« zoom-200 » manquant ou non vert",
  );
});

test("l'accessibilité cite les méthodes et le lecteur d'écran natif", () => {
  const dossier = dossierValide();
  const windows = dossier.accessibilite.find(
    (entree) => entree.plateforme === "windows-x64",
  );
  windows.matrice["lecteur-ecran"].technologie = "VoiceOver";

  attendu(validerDossier(dossier, contexteValide()), "NVDA");
});

test("les verdicts golden doivent correspondre au registre des goldens", () => {
  const dossier = dossierValide();
  dossier.goldens[0].verdict = "capacite-indisponible";
  attendu(
    validerDossier(dossier, contexteValide()),
    "verdict manquant ou divergent",
  );
  const dossier2 = dossierValide();
  dossier2.goldens.push({ test: "crates/inconnu.rs", verdict: "preuve-punks" });
  attendu(validerDossier(dossier2, contexteValide()), "verdict inconnu");
  const dossier3 = dossierValide();
  attendu(
    validerDossier(dossier3, contexteValide({ ledgerRetraits: [] })),
    "le retrait doit précéder la promotion",
  );
});

test("le diff de retrait associé au même candidat est exigé", () => {
  const cas = [
    [(r) => (r.diff = "court"), "empreinte du diff"],
    [(r) => (r["verdicts-executes"] = 0), "au moins un verdict du manifeste"],
    [(r) => (r.lignes = ["../hors.rs"]), "lignes du registre des goldens"],
    [
      (r) => (r.lignes = [LIGNES_REGISTRE[0].test]),
      "lignes divergentes du registre",
    ],
  ];
  for (const [muter, message] of cas) {
    const dossier = dossierValide();
    muter(dossier.retrait);
    attendu(validerDossier(dossier, contexteValide()), message);
  }
  attendu(
    validerDossier({ ...dossierValide(), retrait: null }, contexteValide()),
    "diff de retrait associé",
  );
});

test("le scan legacy sources, dépendances, artefact et réseau est exigé", () => {
  for (const cible of SCANS_LEGACY) {
    const dossier = dossierValide();
    delete dossier.scans[cible];
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${cible} » doit être vert`,
    );
    const dossier2 = dossierValide();
    dossier2.scans[cible].resultat = "restes-detectes";
    attendu(
      validerDossier(dossier2, contexteValide()),
      `« ${cible} » doit être vert`,
    );
  }
});

test("les dix preuves obligatoires doivent être vertes sur le SHA exact", () => {
  for (const preuve of PREUVES_OBLIGATOIRES) {
    const dossier = dossierValide();
    dossier.gates[preuve].sha = "3".repeat(20);
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${preuve} » doit être verte et liée au SHA exact`,
    );
    const dossierNonVert = dossierValide();
    dossierNonVert.gates[preuve].resultat = "echec";
    attendu(
      validerDossier(dossierNonVert, contexteValide()),
      `« ${preuve} » doit être verte et liée au SHA exact`,
    );
  }
  const dossier = dossierValide();
  delete dossier.gates["cloudflare-check"];
  attendu(
    validerDossier(dossier, contexteValide()),
    "« cloudflare-check » doit être verte",
  );
  const dossier2 = dossierValide();
  dossier2.gates.personnalisee = { resultat: "vert", sha: SHA_CANDIDAT };
  attendu(validerDossier(dossier2, contexteValide()), "gate inconnue");
});

test("un statut vert sans fichier de preuve recalculé reste insuffisant", () => {
  const dossier = dossierValide();
  delete dossier.preuves[`gate/${PREUVES_OBLIGATOIRES[0]}`];
  attendu(
    validerDossier(dossier, contexteValide()),
    `preuve « gate/${PREUVES_OBLIGATOIRES[0]} » manquant`,
  );
});

test("une référence de preuve malformée échoue fermé sans exception", () => {
  const dossier = dossierValide();
  dossier.preuves.candidat = null;
  let erreurs;
  assert.doesNotThrow(() => {
    erreurs = validerDossier(dossier, contexteValide());
  });
  attendu(erreurs, "preuve « candidat » manquant");
});

test("un hash de preuve faux est refusé même si tous les statuts sont verts", () => {
  const dossier = dossierValide();
  const identifiant = `gate/${PREUVES_OBLIGATOIRES[0]}`;
  const sha256Declare = "ff".repeat(32);
  const chemin = `sha256/${sha256Declare}-preuve-faussee.json`;
  writeFileSync(
    join(RACINE_PREUVES, chemin),
    "contenu qui ne correspond pas\n",
    {
      flag: "wx",
    },
  );
  dossier.preuves[identifiant] = { chemin, sha256: sha256Declare };
  attendu(
    validerDossier(dossier, contexteValide()),
    "hash recalculé ne correspond pas au sha256 déclaré",
  );
});

test("une preuve content-addressée lie séparément le hash de l'artefact signé", () => {
  const dossier = dossierValide();
  const identifiant = "artefact/macos-arm64/bundle";
  const artefactMac = dossier.liaison.artefacts.find(
    ({ plateforme }) => plateforme === "macos-arm64",
  );
  assert.notEqual(dossier.preuves[identifiant].sha256, artefactMac.sha256);
  assert.equal(dossier.preuves[identifiant].subjectSha256, artefactMac.sha256);
  assert.deepEqual(validerDossier(dossier, contexteValide()), []);

  dossier.preuves[identifiant].subjectSha256 = "cd".repeat(32);
  attendu(
    validerDossier(dossier, contexteValide()),
    "divergente du hash sujet lié",
  );
});

test("un chemin de preuve symbolique est refusé", () => {
  const dossier = dossierValide();
  const identifiant = `gate/${PREUVES_OBLIGATOIRES[0]}`;
  const preuve = dossier.preuves[identifiant];
  const cheminLien = join("sha256", `${preuve.sha256}-preuve-symbolique.json`);
  symlinkSync(
    join(RACINE_PREUVES, preuve.chemin),
    join(RACINE_PREUVES, cheminLien),
  );
  dossier.preuves[identifiant] = { ...preuve, chemin: cheminLien };
  attendu(
    validerDossier(dossier, contexteValide()),
    "lien symbolique interdit",
  );
});

test("une URL de provenance garde une copie locale dont le digest est recalculé", () => {
  const dossier = dossierValide();
  const identifiant = `gate/${PREUVES_OBLIGATOIRES[0]}`;
  const preuve = dossier.preuves[identifiant];
  preuve.url = `https://preuves.punks.bot/sha256/${preuve.sha256}/rapport.json`;
  assert.deepEqual(validerDossier(dossier, contexteValide()), []);

  const sansCopieLocale = dossierValide();
  sansCopieLocale.preuves[identifiant] = {
    url: preuve.url,
    sha256: preuve.sha256,
  };
  attendu(
    validerDossier(sansCopieLocale, contexteValide()),
    "copie locale content-addressée est exigée",
  );
});

test("l'émission locale est finalisée et scellée par la couture de publication réelle", async () => {
  const dossier = dossierValide();
  const emission = construireAttestation(dossier, contexteValide());
  assert.equal(emission.erreur, undefined);
  assert.equal(emission.attestation.gates.length, PREUVES_OBLIGATOIRES.length);
  assert.equal("publiee" in emission.attestation, false);
  assert.equal("publication" in emission.recu, false);
  assert.equal("signatures" in emission.recu, false);
  const finale = await finaliserPromotion(
    emission,
    APPROBATION,
    CONFIANCE_APPROBATION,
  );
  assert.deepEqual(finale.attestation.publiee, ["release", "r2"]);
  assert.deepEqual(finale.recu.publication, ["release", "r2"]);
  assert.equal(finale.recu.signatures.length, 2);
  assert.equal(
    finale.recu.contenu["attestation-sha256"],
    canonicalSha256(finale.attestation),
  );
  const clesParId = new Map(
    APPROBATION.approbateurs.map((approbateur) => [
      approbateur.id,
      approbateur["cle-publique-spki"],
    ]),
  );
  for (const signature of finale.recu.signatures) {
    assert.equal(
      verifierSignatureRecu(
        finale.recu.contenu,
        signature,
        clesParId.get(signature.approbateur),
      ),
      true,
      `la signature ${signature.approbateur} doit sceller les octets canoniques du Reçu final`,
    );
  }
});

test("aucune attestation sans autorisation réelle des deux gates", () => {
  const dossier = dossierValide();
  const sansCloudflare = construireAttestation(
    dossier,
    contexteValide({
      autorisation: { cloudflareCheck: "echec", graphe: "vert" },
    }),
  );
  assert.match(
    sansCloudflare.erreur,
    /cloudflare:check doit réellement terminer vert/,
  );
  const sansGraphe = construireAttestation(
    dossier,
    contexteValide({
      autorisation: { cloudflareCheck: "vert", graphe: "echec" },
    }),
  );
  assert.match(
    sansGraphe.erreur,
    /graphe de release doit autoriser le candidat/,
  );
  const invalide = construireAttestation(
    { ...dossier, scans: {} },
    contexteValide(),
  );
  assert.match(invalide.erreur, /dossier invalide/);
});

test("un candidat déjà scellé ne peut pas être réémis, une tranche absente est refusée", () => {
  const graph = {
    releases: [
      { id: "tranche:1", tranche: 1, etat: "preparation" },
      { id: "tranche:2", tranche: 2, etat: "active" },
    ],
  };
  assert.equal(candidatDejaScelle(graph, 1), false);
  assert.equal(candidatDejaScelle(graph, 2), true);
  assert.equal(candidatDejaScelle(graph, 3), false);
  assert.equal(tranchePresente(graph, 1), true);
  assert.equal(tranchePresente(graph, 3), false);
});
