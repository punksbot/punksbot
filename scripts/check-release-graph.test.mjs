/**
 * Tests du socle du graphe de release (issue #51).
 *
 * Chaque règle décidée par les issues #13, #14, #16 et #47 §13 est prouvée :
 * liaison explicite des matériaux, dossier indivisible preuves + retrait sur
 * le même SHA, fenêtre de support 90 jours, contraction < 1 % pendant 14
 * jours, contenu complet de l'attestation, immuabilité et publication R2,
 * roll-forward, certificat de compatibilité et interdiction de retour Buzz.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
} from "./migration-manifest-lib.mjs";
import {
  CHAINE_TRANSITIONS,
  ETATS,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
  validateReleaseGraph,
} from "./release-graph-lib.mjs";

const HASHES = {
  "registre-contrats": "aa".repeat(32),
  schemas: "bb".repeat(32),
  generes: "cc".repeat(32),
  profil: "dd".repeat(32),
  "registre-goldens": "ee".repeat(32),
  "manifeste-retrait": "ff".repeat(32),
  staging: "09".repeat(32),
};
const STAGING_IDS = {
  compte: "3a391620584c792dbbd8cfa148d7634a",
  zone: "b91146ce242a275de0b7e6e0cc3804c7",
};
const SHA_CANDIDAT = "11".repeat(20);
const ADR =
  "docs/adr/0060-graphe-de-release-expansion-activation-contraction.md";

function contexteStandard(surcharges = {}) {
  return {
    hashes: { ...HASHES },
    stagingIds: { ...STAGING_IDS },
    fileExists: (chemin) => chemin === ADR,
    ...surcharges,
  };
}

function candidatPreparation() {
  return {
    id: "tranche:1",
    tranche: 1,
    etat: "preparation",
    sha: null,
    materiaux: {
      "registre-contrats": { version: 1, sha256: HASHES["registre-contrats"] },
      schemas: { version: 1, sha256: HASHES.schemas },
      generes: { version: 1, sha256: HASHES.generes },
      profil: {
        id: "desktop-social-loop@1",
        version: 1,
        sha256: HASHES.profil,
      },
      "registre-goldens": { version: 1, sha256: HASHES["registre-goldens"] },
      "manifeste-retrait": {
        version: 1,
        sha256: HASHES["manifeste-retrait"],
      },
    },
    staging: {
      environnement: "staging",
      compte: STAGING_IDS.compte,
      zone: STAGING_IDS.zone,
      materiau: "cloudflare/staging.resources.json",
      "materiau-sha256": HASHES.staging,
      deploiement: null,
    },
    artefacts: [],
    preuves: {},
    retrait: null,
    attestation: null,
    recus: [],
    journal: [],
  };
}

function preuvesCompletes(sha = SHA_CANDIDAT) {
  return Object.fromEntries(
    PREUVES_OBLIGATOIRES.map((cle) => [cle, { resultat: "vert", sha }]),
  );
}

function attestationComplete(release) {
  return {
    sha: release.sha,
    "checkpoint-baseline": BASELINE_BUZZ,
    registres: [
      {
        nom: "registre-contrats",
        version: release.materiaux["registre-contrats"].version,
        sha256: release.materiaux["registre-contrats"].sha256,
      },
      {
        nom: "profil",
        version: release.materiaux.profil.version,
        sha256: release.materiaux.profil.sha256,
      },
      {
        nom: "registre-goldens",
        version: release.materiaux["registre-goldens"].version,
        sha256: release.materiaux["registre-goldens"].sha256,
      },
      {
        nom: "manifeste-retrait",
        version: release.materiaux["manifeste-retrait"].version,
        sha256: release.materiaux["manifeste-retrait"].sha256,
      },
    ],
    staging: {
      environnement: release.staging.environnement,
      compte: release.staging.compte,
      zone: release.staging.zone,
      deploiement: release.staging.deploiement,
    },
    gates: PREUVES_OBLIGATOIRES.map((gate) => ({
      gate,
      resultat: "vert",
      sha: release.sha,
    })),
    artefacts: release.artefacts.map((a) => ({
      plateforme: a.plateforme,
      sha256: a.sha256,
    })),
    publiee: ["release", "r2"],
  };
}

function artefactsDistribues() {
  return PLATEFORMES.map((plateforme, i) => ({
    plateforme,
    nom: `punks-${plateforme}.app`,
    sha256: `${i}${"a".repeat(63)}`,
    signature: `${i}${"b".repeat(63)}`,
  }));
}

function journalJusqua(etat, dates) {
  const rang = ETATS.indexOf(etat);
  return CHAINE_TRANSITIONS.slice(0, rang).map((vers, i) => ({
    vers,
    date: dates[i],
  }));
}

/**
 * Release scellée complète pour l'état demandé.
 * `dates` fournit les dates des transitions dans l'ordre du graphe.
 */
function releaseScellee({
  id = "tranche:1",
  tranche = 1,
  etat = "expansion",
  dates = ["2026-08-01", "2026-08-02", "2026-11-01", "2026-11-02"],
  lignesRegistre = [],
  surcharges = {},
} = {}) {
  const base = {
    id,
    tranche,
    etat,
    sha: SHA_CANDIDAT,
    materiaux: { ...candidatPreparation().materiaux },
    staging: {
      ...candidatPreparation().staging,
      deploiement: `staging-${id}`,
    },
    artefacts: artefactsDistribues(),
    preuves: preuvesCompletes(),
    retrait: {
      "lignes-registre": lignesRegistre,
      "verdicts-manifeste": 3,
    },
    attestation: null,
    recus: [
      {
        id: `recu-retrait-${id}`,
        sha256: "12".repeat(32),
        publication: ["release", "r2"],
      },
    ],
    journal: journalJusqua(etat, dates),
  };
  base.attestation = attestationComplete(base);
  return { ...base, ...surcharges };
}

function graphValide(surcharges = {}) {
  const graph = {
    version: 1,
    "checkpoint-recuperation": CHECKPOINT_RECUPERATION,
    "baseline-buzz": BASELINE_BUZZ,
    canal: "punks-desktop",
    politique: {
      "fenetre-support-jours": 90,
      "seuil-usage-contraction": 1,
      "fenetre-mesure-contraction-jours": 14,
      recuperation: {
        normale: "roll-forward",
        "retour-punks-anterieur": "certificat-compatibilite-exige",
        "retour-buzz": "interdit",
      },
      "rpo-logique-nul": true,
      immuabilite: {
        attestations: {
          publication: ["release", "r2"],
          ecriture: "create-only",
          "verrouillage-objet": "compliance",
          "comptes-r2": 2,
        },
        recus: {
          publication: ["release", "r2"],
          ecriture: "create-only",
          "verrouillage-objet": "compliance",
          "comptes-r2": 2,
        },
      },
    },
    etats: [...ETATS],
    transitions: CHAINE_TRANSITIONS.map((vers, index) => ({
      de: ETATS[index],
      vers,
    })),
    "preuves-obligatoires": [...PREUVES_OBLIGATOIRES],
    plateformes: [...PLATEFORMES],
    references: {
      spec: 47,
      decisions: [13, 14, 16, 17],
      adr: [ADR],
    },
    publication: {
      r2: {
        layout: {
          attestations: "releases/{canal}/{id}/attestation.json",
          recus: "releases/{canal}/{id}/recus/{recu}.json",
        },
      },
    },
    releases: [candidatPreparation()],
    recuperations: [],
  };
  return { ...graph, ...surcharges };
}

function erreurs(graph, contexte = contexteStandard()) {
  return validateReleaseGraph(graph, contexte);
}

function attendu(errors, extrait) {
  assert.ok(
    errors.some((e) => e.includes(extrait)),
    `attendu un message contenant « ${extrait} », reçu : ${JSON.stringify(errors)}`,
  );
}

test("un candidat en preparation correctement relié est valide", () => {
  assert.deepEqual(erreurs(graphValide()), []);
});

test("un candidat scellé avec dossier indivisible complet est valide", () => {
  const graph = graphValide({
    releases: [releaseScellee({ etat: "expansion", dates: ["2026-08-01"] })],
  });
  assert.deepEqual(erreurs(graph), []);
});

test("l'en-tête est figé (version, checkpoint, baseline)", () => {
  attendu(erreurs(graphValide({ version: 2 })), "version non supportée");
  attendu(
    erreurs(graphValide({ "checkpoint-recuperation": "ab" })),
    "checkpoint de récupération invalide",
  );
  attendu(
    erreurs(graphValide({ "baseline-buzz": "cd" })),
    "baseline Buzz invalide",
  );
});

test("la politique ne peut pas dériver des décisions closes", () => {
  const cas = [
    [
      "fenetre-support-jours",
      30,
      "fenetre-support-jours doit être exactement 90",
    ],
    [
      "seuil-usage-contraction",
      5,
      "seuil-usage-contraction doit être exactement 1",
    ],
    [
      "fenetre-mesure-contraction-jours",
      7,
      "fenetre-mesure-contraction-jours doit être exactement 14",
    ],
  ];
  for (const [cle, valeur, message] of cas) {
    const graph = graphValide();
    graph.politique[cle] = valeur;
    attendu(erreurs(graph), message);
  }
  const graph = graphValide();
  graph.politique.recuperation.normale = "rollback";
  attendu(erreurs(graph), "roll-forward est la récupération normale");
  const graph2 = graphValide();
  graph2.politique.recuperation["retour-punks-anterieur"] = "libre";
  attendu(erreurs(graph2), "certificat de compatibilité");
  const graph3 = graphValide();
  graph3.politique.recuperation["retour-buzz"] = "permis";
  attendu(erreurs(graph3), "retour-buzz doit être interdit");
  const graph4 = graphValide();
  graph4.politique["rpo-logique-nul"] = false;
  attendu(erreurs(graph4), "rpo-logique-nul doit être vrai");
});

test("l'immuabilité R2 est verrouillée pour attestations et Reçus", () => {
  const variantes = [
    [
      (regles) => (regles.publication = ["release"]),
      "release ET dans le stockage R2",
    ],
    [
      (regles) => (regles.ecriture = "upsert"),
      "ecriture doit être create-only",
    ],
    [
      (regles) => (regles["verrouillage-objet"] = "none"),
      "verrouillage-objet doit être compliance",
    ],
    [(regles) => (regles["comptes-r2"] = 1), "comptes-r2 doit être 2"],
  ];
  for (const sorte of ["attestations", "recus"]) {
    for (const [muter, message] of variantes) {
      const graph = graphValide();
      muter(graph.politique.immuabilite[sorte]);
      attendu(erreurs(graph), `immuabilite.${sorte}`);
      attendu(erreurs(graph), message);
    }
  }
});

test("états, transitions, preuves obligatoires et plateformes sont fermés", () => {
  attendu(
    erreurs(graphValide({ etats: ["preparation", "active"] })),
    "etats doit être exactement",
  );
  const graph = graphValide();
  graph.transitions = graph.transitions.slice(0, 3);
  attendu(erreurs(graph), "quatre transitions scellées attendues");
  const graph2 = graphValide();
  graph2["preuves-obligatoires"] = PREUVES_OBLIGATOIRES.slice(1);
  attendu(erreurs(graph2), "preuves-obligatoires doit être exactement");
  const graph3 = graphValide();
  graph3.plateformes = ["macos-arm64"];
  attendu(erreurs(graph3), "plateformes doit être exactement");
});

test("les références de spec, décisions et ADR sont exigées", () => {
  attendu(erreurs(graphValide({ references: null })), "references manquantes");
  const graph = graphValide();
  graph.references.spec = 46;
  attendu(erreurs(graph), "spec doit être 47");
  const graph2 = graphValide();
  graph2.references.decisions = [13];
  attendu(erreurs(graph2), "decisions doit être exactement");
  const graph3 = graphValide();
  graph3.references.adr = ["docs/adr/9999-absent.md"];
  attendu(erreurs(graph3), "ADR introuvable");
});

test("le layout R2 cite canal et release", () => {
  const graph = graphValide();
  graph.publication.r2.layout.attestations = "attestations/{id}.json";
  attendu(erreurs(graph), "layout R2 de attestations");
});

test("au moins un candidat doit être relié", () => {
  attendu(erreurs(graphValide({ releases: [] })), "au moins le candidat");
});

test("les identifi de release sont uniques et cohérents", () => {
  const graph = graphValide({
    releases: [candidatPreparation(), candidatPreparation()],
  });
  attendu(erreurs(graph), "doublon");
  const graph2 = graphValide({
    releases: [{ ...candidatPreparation(), id: "release-1" }],
  });
  attendu(erreurs(graph2), "tranche:N");
  const graph3 = graphValide({
    releases: [{ ...candidatPreparation(), tranche: 2 }],
  });
  attendu(erreurs(graph3), "incohérent avec l'id");
  const graph4 = graphValide({
    releases: [
      candidatPreparation(),
      { ...candidatPreparation(), id: "tranche:1" },
    ],
  });
  attendu(erreurs(graph4), "déjà portée par");
});

test("un état inconnu est refusé", () => {
  const graph = graphValide({
    releases: [{ ...candidatPreparation(), etat: "hybride" }],
  });
  attendu(erreurs(graph), "état inconnu");
});

test("un candidat scellé exige son SHA exact", () => {
  const release = releaseScellee({ etat: "expansion" });
  release.sha = null;
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "SHA du candidat exact manquant",
  );
  const release2 = releaseScellee({ etat: "expansion" });
  release2.sha = "zz";
  attendu(erreurs(graphValide({ releases: [release2] })), "sha invalide");
});

test("les matériaux du candidat en preparation suivent le dépôt réel", () => {
  const graph = graphValide();
  graph.releases[0].materiaux.profil.sha256 = "71".repeat(32);
  attendu(erreurs(graph), "materiaux.profil.sha256 ne correspond pas");
  const graph2 = graphValide();
  delete graph2.releases[0].materiaux.schemas;
  attendu(erreurs(graph2), "materiaux.schemas manquant");
  const graph3 = graphValide();
  graph3.releases[0].materiaux["manifeste-retrait"].version = 0;
  attendu(erreurs(graph3), "version entière ≥ 1");
});

test("les identifiants de staging cités sont les vrais", () => {
  const graph = graphValide();
  graph.releases[0].staging.compte = "0".repeat(32);
  attendu(erreurs(graph), "compte/zone) ne correspondent pas");
  const graph2 = graphValide();
  graph2.releases[0].staging["materiau-sha256"] = "88".repeat(32);
  attendu(erreurs(graph2), "materiau-sha256 ne correspond pas");
  const graph3 = graphValide();
  graph3.releases[0].staging.deploiement = "deja-deploye";
  attendu(erreurs(graph3), "ne déclare pas de déploiement");
  const release = releaseScellee({ etat: "expansion" });
  release.staging.deploiement = null;
  attendu(
    erreurs(graphValide({ releases: [release] }), contexteStandard()),
    "déploiement de staging exact manquant",
  );
});

test("la matrice d'artefacts distribués est exigée dès le scellement", () => {
  const release = releaseScellee({ etat: "expansion" });
  release.artefacts = release.artefacts.slice(0, 2);
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "artefact distribué manquant",
  );
  const graph = graphValide();
  graph.releases[0].artefacts = artefactsDistribues();
  attendu(erreurs(graph), "ne distribue pas encore d'artefacts");
  const release2 = releaseScellee({ etat: "expansion" });
  release2.artefacts[0].signature = "pas-une-signature";
  attendu(
    erreurs(graphValide({ releases: [release2] })),
    "sans signature valide",
  );
});

test("aucune activation sans les preuves obligatoires sur le même SHA", () => {
  const release = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  delete release.preuves["tauri-staging"];
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "preuve obligatoire « tauri-staging » manquante",
  );
  const release2 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release2.preuves["cloudflare-check"].sha = "22".repeat(20);
  attendu(
    erreurs(graphValide({ releases: [release2] })),
    "rattachées au même candidat",
  );
  const release3 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release3.preuves.accessibilite.resultat = "floconneux";
  attendu(erreurs(graphValide({ releases: [release3] })), "non verte");
  const release4 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release4.preuves.personnalisee = { resultat: "vert", sha: SHA_CANDIDAT };
  attendu(erreurs(graphValide({ releases: [release4] })), "preuve inconnue");
  const graph = graphValide();
  graph.releases[0].preuves = preuvesCompletes(null);
  attendu(erreurs(graph), "ne déclare pas de résultats de gates");
});

test("aucune activation sans le retrait associé au même candidat", () => {
  const release = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release.retrait = null;
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "retrait associé manquant",
  );
  const release2 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release2.retrait["lignes-registre"] = ["../hors-depot.rs"];
  attendu(erreurs(graphValide({ releases: [release2] })), "lignes-registre");
  const graph = graphValide();
  graph.releases[0].retrait = {
    "lignes-registre": ["crates/a.rs"],
    "verdicts-manifeste": 1,
  };
  attendu(erreurs(graph), "n'a pas encore retiré");
});

test("le retrait scellé doit correspondre aux lignes du registre des goldens", () => {
  const release = releaseScellee({
    etat: "expansion",
    dates: ["2026-08-01"],
    lignesRegistre: ["crates/buzz-agent/tests/golden.rs"],
  });
  const contexte = contexteStandard({
    ledgerRetraits: [
      {
        test: "crates/buzz-agent/tests/golden.rs",
        tranche: "tranche:1",
        verdict: "preuve-punks",
      },
      {
        test: "crates/buzz-db/tests/autre.rs",
        tranche: "tranche:1",
        verdict: "difference-intentionnelle",
      },
    ],
  });
  attendu(
    erreurs(graphValide({ releases: [release] }), contexte),
    "divergent du registre des goldens",
  );
});

test("l'attestation contient SHA, baseline, registres, staging, gates et publication", () => {
  const cas = [
    [(a) => delete a.sha, "attestation.sha"],
    [(a) => (a["checkpoint-baseline"] = "42"), "checkpoint-baseline invalide"],
    [
      (a) => (a.registres = a.registres.slice(0, 2)),
      "manque « registre-goldens »",
    ],
    [(a) => (a.registres[0].sha256 = "55".repeat(32)), "diverge des matériaux"],
    [(a) => (a.staging.compte = "0".repeat(32)), "staging.compte diverge"],
    [(a) => (a.gates = a.gates.slice(0, 3)), "manque le résultat"],
    [(a) => (a.gates[0].sha = "33".repeat(20)), "liée au SHA du candidat"],
    [(a) => (a.artefacts = []), "artefacts distribués"],
    [
      (a) => (a.publiee = ["release"]),
      "publiée avec la release ET dans le stockage R2",
    ],
  ];
  for (const [muter, message] of cas) {
    const release = releaseScellee({
      etat: "active",
      dates: ["2026-08-01", "2026-08-02"],
    });
    muter(release.attestation);
    attendu(erreurs(graphValide({ releases: [release] })), message);
  }
  const releaseSans = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  releaseSans.attestation = null;
  attendu(
    erreurs(graphValide({ releases: [releaseSans] })),
    "attestation immuable manquante",
  );
  const graph = graphValide();
  graph.releases[0].attestation = attestationComplete({
    ...candidatPreparation(),
    sha: null,
  });
  attendu(erreurs(graph), "ne porte pas d'attestation");
});

test("les Reçus accompagnent le scellement et sont publiés en release et R2", () => {
  const release = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release.recus = [];
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "au moins un Reçu immuable",
  );
  const release2 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release2.recus[0].publication = ["r2"];
  attendu(
    erreurs(graphValide({ releases: [release2] })),
    "recu.publication doit être exactement",
  );
  const release3 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release3.recus[0].sha256 = "xx";
  attendu(erreurs(graphValide({ releases: [release3] })), "recu sans sha256");
});

test("le journal est append-only sans saut ni régression", () => {
  const release = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  release.journal = [
    { vers: "active", date: "2026-08-02" },
    { vers: "contraction", date: "2026-08-03" },
  ];
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "doit être la transition « expansion »",
  );
  const release2 = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  release2.journal = [
    { vers: "expansion", date: "2026-08-01" },
    { vers: "active", date: "2026-08-02" },
    { vers: "contraction", date: "2026-08-03" },
  ];
  attendu(
    erreurs(graphValide({ releases: [release2] })),
    "journal append-only incomplet",
  );
  const release3 = releaseScellee({
    etat: "active",
    dates: ["2026-08-02", "2026-08-01"],
  });
  attendu(
    erreurs(graphValide({ releases: [release3] })),
    "antérieure à la transition précédente",
  );
  const graph = graphValide();
  graph.releases[0].journal = [{ vers: "expansion", date: "2026-08-01" }];
  attendu(erreurs(graph), "pas de journal de transitions");
});

function grapheContraction({
  joursAvantContraction = 90,
  usage = 0.4,
  joursUsage = 14,
  avecUsage = true,
} = {}) {
  const activeLe = "2026-01-01";
  const msActive = Date.parse(`${activeLe}T00:00:00Z`);
  const msContraction = msActive + joursAvantContraction * 86400000;
  const contractionLe = new Date(msContraction).toISOString().slice(0, 10);
  const ancienne = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contraction",
    dates: ["2025-12-01", activeLe, contractionLe],
  });
  ancienne.successeur = "tranche:2";
  if (avecUsage) {
    ancienne.usage = Array.from({ length: joursUsage }, (_, i) => {
      const date = new Date(msContraction - (joursUsage - 1 - i) * 86400000)
        .toISOString()
        .slice(0, 10);
      return { date, pourcentage: usage };
    });
  }
  const successeur = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2025-12-20", activeLe],
  });
  return graphValide({ releases: [ancienne, successeur] });
}

test("une contraction légale (90 jours puis < 1 % pendant 14 jours) est acceptée", () => {
  assert.deepEqual(erreurs(grapheContraction()), []);
});

test("aucune contraction avant 90 jours de support N/N−1", () => {
  attendu(
    erreurs(grapheContraction({ joursAvantContraction: 89 })),
    "contraction interdite",
  );
  attendu(
    erreurs(grapheContraction({ joursAvantContraction: 89 })),
    "au moins 90 jours",
  );
});

test("la contraction exige moins de 1 % d'usage chaque jour pendant 14 jours", () => {
  attendu(
    erreurs(grapheContraction({ usage: 1.2 })),
    "moins de 1 % chaque jour",
  );
  attendu(
    erreurs(grapheContraction({ joursUsage: 13 })),
    "14 jours d'usage mesuré",
  );
  const graph = grapheContraction();
  const release = graph.releases[0];
  const intercale = new Date(
    Date.parse(`${release.usage[5].date}T00:00:00Z`) + 2 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  release.usage[5].date = intercale;
  attendu(erreurs(graph), "usage non contigu");
  const graph2 = grapheContraction();
  graph2.releases[0].usage[13].date = "2027-01-01";
  attendu(erreurs(graph2), "postérieur à la contraction");
  const graph3 = grapheContraction({ avecUsage: false });
  attendu(erreurs(graph3), "sans 14 jours d'usage mesuré");
});

test("une contraction exige un successeur explicite", () => {
  const graph = grapheContraction();
  delete graph.releases[0].successeur;
  attendu(erreurs(graph), "contraction sans successeur");
});

test("au plus une release active et une en expansion", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2026-08-01", "2026-08-02"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-08-03", "2026-08-04"],
      }),
    ],
  });
  attendu(erreurs(graph), "au plus une release active");
});

test("le roll-forward vers un candidat scellé est la récupération normale", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({ etat: "active", dates: ["2026-08-01", "2026-08-02"] }),
    ],
    recuperations: [
      { date: "2026-08-10", type: "roll-forward", cible: "tranche:1" },
    ],
  });
  assert.deepEqual(erreurs(graph), []);
});

test("un retour Punks antérieur exige un certificat de compatibilité exact", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "contraction",
        dates: ["2026-01-01", "2026-01-02", "2026-06-01"],
        lignesRegistre: [],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-02-01", "2026-02-02"],
      }),
    ],
  });
  graph.releases[0].successeur = "tranche:2";
  graph.releases[0].usage = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.parse("2026-05-19T00:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
    pourcentage: 0.2,
  }));
  const certificatValide = {
    contrats: 1,
    profil: "desktop-social-loop@1",
    "profil-version": 1,
    "compatibilite-donnees": true,
    "verifie-contre": "tranche:2",
  };
  const avecCertificat = structuredClone(graph);
  avecCertificat.recuperations = [
    {
      date: "2026-06-10",
      type: "retour-punks",
      cible: "tranche:1",
      certificat: certificatValide,
    },
  ];
  assert.deepEqual(erreurs(avecCertificat), []);
  const sansCertificat = structuredClone(graph);
  sansCertificat.recuperations = [
    { date: "2026-06-10", type: "retour-punks", cible: "tranche:1" },
  ];
  attendu(erreurs(sansCertificat), "sans certificat de compatibilité");
  const certificatDivergent = structuredClone(graph);
  certificatDivergent.recuperations = [
    {
      date: "2026-06-10",
      type: "retour-punks",
      cible: "tranche:1",
      certificat: { ...certificatValide, contrats: 9 },
    },
  ];
  attendu(erreurs(certificatDivergent), "version exacte du registre");
  const donneesNonProuvees = structuredClone(graph);
  donneesNonProuvees.recuperations = [
    {
      date: "2026-06-10",
      type: "retour-punks",
      cible: "tranche:1",
      certificat: { ...certificatValide, "compatibilite-donnees": false },
    },
  ];
  attendu(erreurs(donneesNonProuvees), "compatibilite-donnees");
});

test("aucun retour vers Buzz n'existe dans le vocabulaire fermé", () => {
  const graph = graphValide({
    recuperations: [{ date: "2026-08-10", type: "retour-buzz", cible: "buzz" }],
  });
  attendu(erreurs(graph), "type inconnu");
  attendu(erreurs(graph), "exclut structurellement tout retour vers Buzz");
  const graph2 = graphValide({
    recuperations: [
      { date: "2026-08-10", type: "roll-forward", cible: "buzz" },
    ],
  });
  attendu(erreurs(graph2), "cible « buzz » inconnue");
  const graph3 = graphValide({
    releases: [candidatPreparation()],
    recuperations: [
      { date: "2026-08-10", type: "roll-forward", cible: "tranche:1" },
    ],
  });
  attendu(erreurs(graph3), "non scellée");
});

test("les lignes de retrait préparent le candidat sans le déclarer scellé", () => {
  const contexte = contexteStandard({
    ledgerRetraits: [
      {
        test: "crates/buzz-db/tests/x.rs",
        tranche: "tranche:1",
        verdict: "preuve-punks",
      },
    ],
  });
  assert.deepEqual(erreurs(graphValide(), contexte), []);

  const graphAvecFaussePreuve = graphValide();
  graphAvecFaussePreuve.releases[0].retrait = {
    "lignes-registre": ["crates/buzz-db/tests/x.rs"],
    "verdicts-manifeste": 1,
  };
  attendu(
    erreurs(graphAvecFaussePreuve, contexte),
    "un candidat en preparation n'a pas encore retiré de chemin Buzz",
  );

  const contexteSansCandidate = contexteStandard({
    ledgerRetraits: [
      {
        test: "crates/buzz-db/tests/x.rs",
        tranche: "tranche:2",
        verdict: "preuve-punks",
      },
    ],
  });
  attendu(
    erreurs(graphValide(), contexteSansCandidate),
    "retrait(s) de tranche:2 sans candidat dans le graphe",
  );
});

test("le retrait physique du manifeste est prouvé pour les candidats scellés", () => {
  const release = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  const contexte = contexteStandard({
    manifestActifs: [
      { chemin: "crates/buzz-conformance/", verdict: "tranche:1" },
    ],
    trackedFiles: [
      "crates/buzz-conformance/src/lib.rs",
      "scripts/release-graph-lib.mjs",
    ],
  });
  attendu(
    erreurs(graphValide({ releases: [release] }), contexte),
    "retrait incomplet",
  );
  const contexteRetire = contexteStandard({
    manifestActifs: [
      { chemin: "crates/buzz-conformance/", verdict: "tranche:1" },
    ],
    trackedFiles: ["scripts/release-graph-lib.mjs"],
  });
  assert.deepEqual(
    erreurs(graphValide({ releases: [release] }), contexteRetire),
    [],
  );
});
