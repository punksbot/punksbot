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
import { generateKeyPairSync, sign as signerEd25519 } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import {
  BUDGETS_PRODUCTION,
  borneWilsonUnilaterale95,
  CADENCES_OPERATIONNELLES,
  CHAINE_TRANSITIONS,
  CONTROLES_CERTIFICAT,
  empreinteDossierCompatibilite,
  ETATS,
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
  validateReleaseGraph,
  validateReleaseGraphEvolution,
} from "./release-graph-lib.mjs";
import { executerCliPublicationRecu } from "./receipt-publish.mjs";
import {
  entreesParityDuGraphe,
  publierRecuOperationnel,
  validateParityReceiptIndex,
} from "./promotion-publish-lib.mjs";

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
const SHA_ROLL_FORWARD = "22".repeat(20);
const ADR =
  "docs/adr/0060-graphe-de-release-expansion-activation-contraction.md";

const CLES_APPROBATEURS = new Map(
  ["ops:alice", "ops:bob"].map((id) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return [
      id,
      {
        privateKey,
        publique: publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
      },
    ];
  }),
);
const APPROBATEURS_RELEASE = [...CLES_APPROBATEURS].map(([id, cle]) => ({
  id,
  "cle-publique-spki": cle.publique,
}));

function signatures(contenu, approbateurs = ["ops:alice", "ops:bob"]) {
  return approbateurs.map((approbateur) => {
    const cle = CLES_APPROBATEURS.get(approbateur);
    assert.ok(cle, `clé de test absente pour ${approbateur}`);
    return {
      approbateur,
      algorithme: "ed25519",
      "cle-publique-spki": cle.publique,
      valeur: signerEd25519(
        null,
        Buffer.from(canonicalJson(contenu), "utf8"),
        cle.privateKey,
      ).toString("hex"),
    };
  });
}

function recuSigne({ id, contenu, publication = ["release", "r2"] }) {
  const contenuLie = { schema: "punks.release-receipt.v1", id, ...contenu };
  return {
    id,
    contenu: contenuLie,
    sha256: canonicalSha256(contenuLie),
    signatures: signatures(contenuLie, contenuLie.approbateurs),
    publication,
  };
}

function resignerRecu(recu) {
  recu.sha256 = canonicalSha256(recu.contenu);
  recu.signatures = signatures(recu.contenu, recu.contenu.approbateurs);
}

function contenuAdresse(contenu) {
  return { contenu, sha256: canonicalSha256(contenu) };
}

function contexteStandard(surcharges = {}) {
  return {
    hashes: { ...HASHES },
    stagingIds: { ...STAGING_IDS },
    ancrageApprobateursRelease: canonicalSha256(APPROBATEURS_RELEASE),
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
    "attestation-sha256": null,
    "dossier-preuve-sha256": null,
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
    dossier: { sha256: release["dossier-preuve-sha256"] },
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
    "digests-production": { ...release["digests-production"] },
    publiee: ["release", "r2"],
  };
}

function artefactsDistribues(seed = "release") {
  return PLATEFORMES.map((plateforme) => ({
    plateforme,
    nom: `punks-${plateforme}.app`,
    sha256: canonicalSha256({ seed, plateforme, sorte: "bundle" }),
    signature: canonicalSha256({ seed, plateforme, sorte: "signature" }),
  }));
}

function shaPhase({ shaFinal, id, phase, phaseFinale }) {
  return phase === phaseFinale
    ? shaFinal
    : canonicalSha256({ shaFinal, id, phase }).slice(0, 40);
}

function topologiePhase({ id, phase, sha }) {
  return {
    workers: [
      {
        nom: "punks-api",
        version: `${id}/${phase}/${sha.slice(0, 12)}`,
        pourcentage: 100,
      },
    ],
    workflows: [
      { nom: "punks-maintenance", version: `${phase}-${sha.slice(0, 12)}` },
    ],
    "generation-compatibilite": 1,
    "migration-stateful": { mode: "aucune" },
    "moyens-connexion": ["oauth", "passkey"],
    inventaire: Object.fromEntries(
      [
        "manifest-staging-sha256",
        "manifest-production-sha256",
        "migrations-durable-objects-sha256",
        "migrations-d1-sha256",
        "bindings-sha256",
        "routes-sha256",
        "triggers-sha256",
        "ressources-sha256",
        "secrets-sha256",
        "configuration-trafic-sha256",
      ].map((surface) => [
        surface,
        canonicalSha256({ id, phase, sha, surface }),
      ]),
    ),
    "versions-cloudflare": [
      {
        ressource: "worker:punks-api",
        id: `worker-${phase}-${sha.slice(0, 12)}`,
      },
      {
        ressource: "workflow:punks-maintenance",
        id: `workflow-${phase}-${sha.slice(0, 12)}`,
      },
    ],
    "versions-etat-durable-objects": [
      { namespace: "AccountDO", version: 1 },
      { namespace: "WorkspaceDO", version: 3 },
    ],
    "etat-r2": {
      formats: [
        { nom: "archives-punks", version: 2 },
        { nom: "tombstones-effacement", version: 1 },
      ],
      "generation-chaines": 4,
      "generation-tombstones": 3,
      "generation-effacement": 5,
      "registre-sha256": canonicalSha256({ id, phase, sha, registre: "r2" }),
    },
    "generations-securite": {
      secrets: [
        { nom: "oauth-session", generation: 7 },
        { nom: "workspace-seal", generation: 4 },
      ],
      "cles-attestation": [{ id: "attestation-primary", generation: 3 }],
      "generation-recuperation-sessions": 6,
      "generations-revoquees-sha256": canonicalSha256({
        id,
        phase,
        sha,
        registre: "generations-revoquees",
      }),
    },
  };
}

function recusCandidat(release) {
  return [
    recuSigne({
      id: `recu-promotion-${release.tranche}-${release.sha}`,
      contenu: {
        type: "promotion",
        "attestation-sha256": release["attestation-sha256"],
        ...(release.tranche === 1 && release.etat === "expansion"
          ? {
              "bootstrap-github-attestation-sha256":
                release["attestation-sha256"],
            }
          : {}),
      },
    }),
    recuSigne({
      id: `recu-retrait-${release.tranche}-${release.sha}`,
      contenu: { type: "retrait", cible: release.id, sha: release.sha },
    }),
  ];
}

function candidatPhase({
  id,
  tranche,
  phase,
  sha,
  deploiement,
  lignesRegistre,
  profil,
}) {
  const artefacts = artefactsDistribues(`${id}/${phase}/${sha}`);
  const release = {
    id,
    tranche,
    etat: phase,
    sha,
    materiaux: structuredClone(candidatPreparation().materiaux),
    staging: {
      ...structuredClone(candidatPreparation().staging),
      deploiement,
    },
    artefacts,
    "digests-production": {
      bundle: canonicalSha256({ id, phase, sha, sorte: "bundle-production" }),
      manifeste: canonicalSha256({
        id,
        phase,
        sha,
        sorte: "manifeste-production",
      }),
    },
    "dossier-preuve-sha256": canonicalSha256({
      id,
      phase,
      sha,
      dossier: "promotion",
    }),
    preuves: preuvesCompletes(sha),
    retrait: {
      sha,
      "lignes-registre": lignesRegistre,
      "verdicts-manifeste": 3,
    },
    attestation: null,
    "attestation-sha256": null,
    recus: [],
  };
  if (profil !== null && profil !== undefined) {
    release.materiaux.profil = structuredClone(profil);
  }
  if (phase === "contraction") {
    release.materiaux["registre-contrats"].sha256 = canonicalSha256({
      id,
      phase,
      sha,
      materiau: "registre-contrats-apres-contraction",
    });
    release.materiaux.generes.sha256 = canonicalSha256({
      id,
      phase,
      sha,
      materiau: "generes-apres-contraction",
    });
  }
  release.attestation = attestationComplete(release);
  release["attestation-sha256"] = canonicalSha256(release.attestation);
  release.recus = recusCandidat(release);
  return release;
}

function cadenceScellee({
  phase,
  instant,
  releaseId,
  grapheSha256,
  verdicts,
  instantane,
}) {
  const statefulNonSplittable =
    instantane.contenu.topologie["migration-stateful"]?.mode ===
    "non-splittable";
  const clePolitique = statefulNonSplittable
    ? phase === "expansion"
      ? "expansion-stateful"
      : phase === "roll-forward"
        ? "roll-forward-stateful"
        : phase
    : phase;
  const politique = CADENCES_OPERATIONNELLES[clePolitique];
  assert.ok(politique, `cadence de test absente pour ${phase}`);
  let curseur =
    Date.parse(instant) -
    politique.reduce((total, etape) => total + etape.heures, 0) * 3600000;
  let precedentEtapeSha256 = null;
  const recus = [];
  const preuvesPourEtape = (attendu) => {
    const empreinte = (categorie, identifiant) =>
      canonicalSha256({
        releaseId,
        etape: attendu.etape,
        categorie,
        identifiant,
      });
    if (attendu.etape === "E0") {
      return [
        {
          type: "parcours-cibles-et-gates-synthetiques",
          "parcours-cibles": ["connexion", "workspace", "mutation"].map(
            (nom) => ({
              nom,
              resultat: "vert",
              "export-sha256": empreinte("parcours", nom),
            }),
          ),
          "gates-synthetiques": ["contrats", "follow", "renderer"].map(
            (nom) => ({
              nom,
              resultat: "vert",
              "export-sha256": empreinte("gate-synthetique", nom),
            }),
          ),
        },
      ];
    }
    if (attendu.etape === "E2") {
      const profil = instantane.contenu.release.materiaux.profil;
      return [
        {
          type: "operations-profil-observees",
          couverture: "complete",
          profil: {
            id: profil.id,
            version: profil.version,
            sha256: profil.sha256,
          },
          operations: ["lecture", "mutation", "follow"].map((nom) => ({
            nom,
            observations: 1_000,
            "export-sha256": empreinte("operation-profil", nom),
          })),
        },
      ];
    }
    if (attendu.etape === "E3") {
      return [
        {
          type: "representativite-clients",
          plateformes: PLATEFORMES.map((plateforme) => ({
            plateforme,
            echantillons: 1_000,
            "export-sha256": empreinte("plateforme", plateforme),
          })),
          "moyens-connexion": instantane.contenu.topologie[
            "moyens-connexion"
          ].map((moyen) => ({
            moyen,
            echantillons: 1_000,
            "export-sha256": empreinte("moyen-connexion", moyen),
          })),
        },
      ];
    }
    if (attendu.etape === "E4") {
      return [
        {
          type: "equilibre-projections-asynchrones",
          resultat: "equilibre",
          projections: ["d1", "recherche"].map((nom) => ({
            nom,
            "retard-ms": 0,
            "export-sha256": empreinte("projection", nom),
          })),
          "travaux-asynchrones": ["queues", "workflows", "outboxes"].map(
            (nom) => ({
              nom,
              "en-attente": 0,
              "age-max-ms": 0,
              "export-sha256": empreinte("travail-asynchrone", nom),
            }),
          ),
        },
      ];
    }
    if (attendu.etape === "A1") {
      return [
        {
          type: "gates-plateformes-fournisseurs",
          gates: PLATEFORMES.flatMap((plateforme) =>
            instantane.contenu.topologie["moyens-connexion"].map(
              (fournisseur) => ({
                plateforme,
                fournisseur,
                resultat: "vert",
                "export-sha256": empreinte(
                  "gate-plateforme-fournisseur",
                  `${plateforme}:${fournisseur}`,
                ),
              }),
            ),
          ),
        },
      ];
    }
    if (attendu.etape === "A2") {
      return [
        {
          type: "absence-incidents-herites",
          "incidents-herites": [],
          "registre-sha256": empreinte("incidents-herites", "registre"),
        },
      ];
    }
    return [];
  };
  for (const attendu of politique) {
    const debut = new Date(curseur).toISOString().replace(".000Z", "Z");
    curseur += attendu.heures * 3600000;
    const fin = new Date(curseur).toISOString().replace(".000Z", "Z");
    const id = `recu-etape-${phase}-${attendu.etape}-${grapheSha256}`;
    const verdictsEtape = verdicts.map((verdict) => ({
      ...structuredClone(verdict),
      "export-sha256": canonicalSha256({
        releaseId,
        etape: attendu.etape,
        budget: verdict.nom,
        export: "metrics",
      }),
    }));
    const pourcentage =
      attendu.etape === "P0"
        ? "0"
        : /^workers:(\d+)%/.exec(attendu.exposition)?.[1];
    const workers = structuredClone(instantane.contenu.topologie.workers);
    if (pourcentage !== undefined) {
      for (const worker of workers) worker.pourcentage = Number(pourcentage);
    }
    const hashesDesktop =
      ["active", "contraction"].includes(phase) ||
      (phase === "roll-forward" && attendu.etape.startsWith("A"))
        ? instantane.contenu.release.artefacts.map(
            ({ plateforme, sha256 }) => ({
              plateforme,
              sha256,
            }),
          )
        : [];
    const recu = recuSigne({
      id,
      contenu: {
        type: "etape",
        phase,
        "release-id": releaseId,
        "sha-punks": instantane.contenu.release.sha,
        etape: attendu.etape,
        exposition: attendu.exposition,
        "duree-minimale-heures": attendu.heures,
        "graphe-sha256": grapheSha256,
        "precedent-etape-sha256": precedentEtapeSha256,
        "verdicts-metriques-sha256": canonicalSha256(verdictsEtape),
        approbateurs: ["ops:alice", "ops:bob"],
        workers,
        workflows: structuredClone(instantane.contenu.topologie.workflows),
        "generation-compatibilite":
          instantane.contenu.topologie["generation-compatibilite"],
        "hashes-desktop": hashesDesktop,
        "couverture-pilote":
          (phase === "active" || phase === "roll-forward") &&
          attendu.etape === "A0"
            ? {
                "artefacts-finaux-signes": true,
                "comptes-punks-reels": true,
                "moyens-connexion": structuredClone(
                  instantane.contenu.topologie["moyens-connexion"],
                ),
                plateformes: PLATEFORMES.map((plateforme) => ({
                  plateforme,
                  "sessions-humaines": 30,
                })),
                workspaces: 2,
              }
            : null,
        "preuve-preparation-stateful-sha256":
          clePolitique.endsWith("-stateful") && attendu.etape === "P0"
            ? canonicalSha256({
                releaseId,
                etape: attendu.etape,
                resultat: "preparation-stateful-verifiee",
              })
            : null,
        "preuves-etape": preuvesPourEtape(attendu),
        heures: { debut, fin },
        "verdicts-metriques": verdictsEtape,
        bookmarks: [
          {
            autorite: "cloudflare",
            valeur: `bookmark:${releaseId}:${attendu.etape}`,
          },
        ],
        dlq: {
          messages: 0,
          "export-sha256": canonicalSha256({
            releaseId,
            etape: attendu.etape,
            export: "dlq",
          }),
        },
        outboxes: {
          "en-attente": 0,
          "export-sha256": canonicalSha256({
            releaseId,
            etape: attendu.etape,
            export: "outboxes",
          }),
        },
        incidents: [],
        segments: [
          {
            debut,
            fin,
            "graphe-sha256": grapheSha256,
            "verdicts-metriques-sha256": canonicalSha256(verdictsEtape),
            resultat: "vert",
            "echantillons-suffisants": true,
          },
        ],
      },
    });
    recus.push(recu);
    precedentEtapeSha256 = recu.sha256;
  }
  return recus;
}

function instantScellementCadence(phase, instantTerminal, topologie = null) {
  const statefulNonSplittable =
    topologie?.["migration-stateful"]?.mode === "non-splittable";
  const clePolitique = statefulNonSplittable
    ? phase === "expansion"
      ? "expansion-stateful"
      : phase === "roll-forward"
        ? "roll-forward-stateful"
        : phase
    : phase;
  const politique = CADENCES_OPERATIONNELLES[clePolitique];
  assert.ok(politique, `cadence de scellement absente pour ${phase}`);
  return new Date(
    Date.parse(instantTerminal) -
      politique.reduce((total, etape) => total + etape.heures, 0) * 3600000,
  )
    .toISOString()
    .replace(".000Z", "Z");
}

function contenuRecuOperationnel({ entree, instantane, type = "transition" }) {
  const baselineDisponible =
    type === "roll-forward" || instantane.contenu.tranche > 1;
  const echantillons = 1_000_000;
  const baseline = (suffixe) => ({
    disponible: baselineDisponible,
    "mesure-n-1": baselineDisponible ? 0 : null,
    "export-n-1-sha256": baselineDisponible
      ? canonicalSha256({
          release: entree["release-id"],
          suffixe,
          export: "metrics-n-1",
        })
      : null,
    "regression-pourcentage": baselineDisponible ? 0 : null,
    "justification-acceptee": false,
    "justification-sha256": null,
  });
  const statistique = (budget, suffixe) => {
    const pourcentage = budget.unite === "pourcentage";
    const occurrences = budget.unite === "occurrences";
    return {
      mesure: 0,
      "borne-superieure-unilaterale-95": pourcentage
        ? borneWilsonUnilaterale95(0, echantillons)
        : 0,
      echantillons,
      numerateur: pourcentage || occurrences ? 0 : null,
      denominateur: pourcentage ? echantillons : null,
      methode: pourcentage
        ? "wilson-unilaterale-95"
        : occurrences
          ? "tolerance-zero"
          : "quantile-export-verifie",
      "baseline-n-1": baseline(suffixe),
      resultat: "vert",
      "export-sha256": canonicalSha256({
        release: entree["release-id"],
        suffixe,
        export: "metrics",
      }),
    };
  };
  const verdicts = BUDGETS_PRODUCTION.map((budget) => {
    const dimensions =
      budget.nom === "connexion-desktop-echecs-par-moyen"
        ? instantane.contenu.topologie["moyens-connexion"]
        : budget.nom === "desktop-sessions-avec-crash-par-plateforme"
          ? PLATEFORMES
          : [];
    return {
      nom: budget.nom,
      unite: budget.unite,
      "budget-max": budget.maximum,
      ...statistique(budget, budget.nom),
      dimensions: dimensions.map((dimension) => ({
        dimension,
        ...statistique(budget, `${budget.nom}:${dimension}`),
      })),
    };
  });
  const phaseCadence = type === "roll-forward" ? type : entree.vers;
  const cadence = cadenceScellee({
    phase: phaseCadence,
    instant: entree.instant,
    releaseId: entree["release-id"],
    grapheSha256: entree.graphe.sha256,
    verdicts,
    instantane,
  });
  return {
    type,
    "release-id": entree["release-id"],
    "sha-punks": instantane.contenu.release.sha,
    ...(type === "transition"
      ? {
          transition: entree.vers,
          "attestation-sha256": entree["attestation-sha256"],
        }
      : {}),
    instant: entree.instant,
    "graphe-sha256": entree.graphe.sha256,
    precedent: structuredClone(entree.precedent ?? null),
    ...(entree["usage-sha256"] === undefined
      ? {}
      : { "usage-sha256": entree["usage-sha256"] }),
    ...(entree["contraction-punks-sha256"] === undefined
      ? {}
      : {
          "contraction-punks-sha256": entree["contraction-punks-sha256"],
        }),
    workers: structuredClone(instantane.contenu.topologie.workers),
    workflows: structuredClone(instantane.contenu.topologie.workflows),
    "generation-compatibilite":
      instantane.contenu.topologie["generation-compatibilite"],
    "hashes-desktop": ["active", "contraction", "roll-forward"].includes(
      phaseCadence,
    )
      ? instantane.contenu.release.artefacts.map(({ plateforme, sha256 }) => ({
          plateforme,
          sha256,
        }))
      : [],
    cadence,
    heures: {
      debut: cadence[0].contenu.segments[0].debut,
      fin: cadence.at(-1).contenu.segments.at(-1).fin,
    },
    approbateurs: ["ops:alice", "ops:bob"],
    "verdicts-metriques": verdicts,
    bookmarks: [
      { autorite: "cloudflare", valeur: `bookmark:${entree["release-id"]}` },
    ],
    dlq: {
      messages: 0,
      "export-sha256": canonicalSha256({
        release: entree["release-id"],
        export: "dlq",
      }),
    },
    outboxes: {
      "en-attente": 0,
      "export-sha256": canonicalSha256({
        release: entree["release-id"],
        export: "outboxes",
      }),
    },
    incidents: [],
  };
}

function fenetresObservation({ fin, resultats, incidentId }) {
  const finMs = Date.parse(fin);
  assert.ok(Number.isFinite(finMs), "instant terminal de fenêtre invalide");
  return resultats.map((resultat, index) => {
    const debut = new Date(finMs - (resultats.length - index) * 15 * 60 * 1_000)
      .toISOString()
      .replace(".000Z", "Z");
    const finFenetre = new Date(
      finMs - (resultats.length - index - 1) * 15 * 60 * 1_000,
    )
      .toISOString()
      .replace(".000Z", "Z");
    return {
      debut,
      fin: finFenetre,
      resultat,
      "export-sha256": canonicalSha256({
        incidentId,
        debut,
        fin: finFenetre,
        resultat,
      }),
    };
  });
}

function fencingExecution({ requis, perimetre, incidentId, appliqueA }) {
  return requis
    ? {
        requis: true,
        applique: true,
        "applique-a": appliqueA,
        perimetre,
        "preuve-sha256": canonicalSha256({
          incidentId,
          perimetre,
          action: "fencing",
          appliqueA,
        }),
      }
    : {
        requis: false,
        applique: false,
        "applique-a": null,
        perimetre: null,
        "preuve-sha256": null,
      };
}

const EXECUTIONS_SCELLEES = new WeakMap();

function executionReussiePourTransition({
  cible,
  entree,
  recuTransition,
  precedent,
}) {
  const idSlug = cible.id.replaceAll(":", "-");
  const idExecution = `execution-${idSlug}-${entree.vers}-${entree["release-id"]
    .replaceAll(":", "-")
    .replaceAll("/", "-")}`;
  const recuDemarrage = recuSigne({
    id: `recu-demarrage-${idExecution}-${entree.graphe.sha256}`,
    contenu: {
      type: "execution-demarrage",
      "execution-id": idExecution,
      sequence: 0,
      cible: cible.id,
      programme: entree.vers,
      "release-id": entree["release-id"],
      "sha-punks": entree.sha,
      "graphe-sha256": entree.graphe.sha256,
      deploiement: entree.deploiement,
      precedent: structuredClone(precedent),
      instant: entree.graphe.contenu.instant,
      approbateurs: ["ops:alice", "ops:bob"],
    },
  });
  const evenements = [];
  let precedentEvenementSha256 = recuDemarrage.sha256;
  for (const [index, recuEtape] of recuTransition.contenu.cadence.entries()) {
    const evenement = recuSigne({
      id: `recu-execution-${idExecution}-${index + 1}-etape-fermee`,
      contenu: {
        type: "execution-evenement",
        "execution-id": idExecution,
        sequence: index + 1,
        "precedent-evenement-sha256": precedentEvenementSha256,
        cible: cible.id,
        programme: entree.vers,
        "release-id": entree["release-id"],
        "sha-punks": entree.sha,
        "graphe-sha256": entree.graphe.sha256,
        instant: recuEtape.contenu.heures.fin,
        nature: "etape-fermee",
        approbateurs: ["ops:alice", "ops:bob"],
        "recu-etape": recuEtape,
      },
    });
    evenements.push(evenement);
    precedentEvenementSha256 = evenement.sha256;
  }
  recuTransition.contenu["execution-id"] = idExecution;
  recuTransition.contenu["recu-execution-precedent-sha256"] =
    precedentEvenementSha256;
  resignerRecu(recuTransition);
  const fermeture = recuSigne({
    id: `recu-execution-${idExecution}-${evenements.length + 1}-phase-fermee`,
    contenu: {
      type: "execution-evenement",
      "execution-id": idExecution,
      sequence: evenements.length + 1,
      "precedent-evenement-sha256": precedentEvenementSha256,
      cible: cible.id,
      programme: entree.vers,
      "release-id": entree["release-id"],
      "sha-punks": entree.sha,
      "graphe-sha256": entree.graphe.sha256,
      instant: entree.instant,
      nature: "phase-fermee",
      approbateurs: ["ops:alice", "ops:bob"],
      "recu-transition-id": recuTransition.id,
      "recu-transition-sha256": recuTransition.sha256,
    },
  });
  evenements.push(fermeture);
  return {
    execution: {
      schema: "punks.release-execution.v1",
      id: idExecution,
      tranche: cible.tranche,
      programme: entree.vers,
      cible: cible.id,
      graphe: entree.graphe,
      precedent: structuredClone(precedent),
      "recu-demarrage": recuDemarrage,
      evenements,
    },
    tete: {
      "execution-id": idExecution,
      "release-id": entree["release-id"],
      "sha-punks": entree.sha,
      "graphe-sha256": entree.graphe.sha256,
      "recu-tete-sha256": recuTransition.sha256,
    },
  };
}

function executionReussiePourRollForward(cible, recuperation) {
  return executionReussiePourTransition({
    cible,
    entree: {
      vers: "roll-forward",
      instant: recuperation.instant,
      "release-id": recuperation.graphes.nouveau.contenu["release-id"],
      sha: recuperation.graphes.nouveau.contenu.release.sha,
      deploiement: recuperation.graphes.nouveau.contenu.deploiement,
      graphe: recuperation.graphes.nouveau,
    },
    recuTransition: recuperation.recu,
    precedent: recuperation["execution-precedente"],
  }).execution;
}

function engagementRecuperationPour(execution, instantRecuperation) {
  const evenement = execution.evenements.at(-1);
  const incident = evenement?.contenu?.incidents?.find(
    (element) =>
      canonicalSha256(element) === evenement.contenu["incident-sha256"],
  );
  assert.ok(incident, "incident causal absent de l'exécution de test");
  const detecteA = Date.parse(incident["detecte-a"]);
  const echeanceA = detecteA + 4 * 3600000;
  const depassement = Date.parse(instantRecuperation) > echeanceA;
  return {
    schema: "punks.recovery-commitment.v1",
    "incident-sha256": canonicalSha256(incident),
    "detecte-a": incident["detecte-a"],
    "engage-a": new Date(detecteA + 3 * 3600000)
      .toISOString()
      .replace(".000Z", "Z"),
    "echeance-a": new Date(echeanceA).toISOString().replace(".000Z", "Z"),
    perimetre: evenement.contenu.perimetre,
    "perimetre-ferme": true,
    "escalade-depassement-sha256": depassement
      ? canonicalSha256({
          incident: incident.id,
          action: "escalade-recuperation-ciblee",
        })
      : null,
  };
}

function descripteurExecutionFixture(execution, releases) {
  if (!execution) return null;
  const release = releases.find((element) => element.id === execution.cible);
  const recuTerminal = release?.recus?.find(
    (recu) => recu.contenu?.["execution-id"] === execution.id,
  );
  const recuTete = recuTerminal ?? execution.evenements.at(-1);
  return {
    "execution-id": execution.id,
    "release-id": execution.graphe.contenu["release-id"],
    "sha-punks": execution.graphe.contenu.release.sha,
    "graphe-sha256": execution.graphe.sha256,
    "recu-tete-sha256": recuTete.sha256,
  };
}

function teteExecutionFixture(executions, instant) {
  const borne = Date.parse(instant);
  return executions
    .filter((execution) => {
      const actualiseA = Date.parse(
        execution.evenements.at(-1)?.contenu?.instant ??
          execution["recu-demarrage"]?.contenu?.instant,
      );
      return Number.isFinite(borne) && actualiseA <= borne;
    })
    .sort((gauche, droite) => {
      const instantGauche = Date.parse(
        gauche.evenements.at(-1)?.contenu?.instant ??
          gauche["recu-demarrage"].contenu.instant,
      );
      const instantDroite = Date.parse(
        droite.evenements.at(-1)?.contenu?.instant ??
          droite["recu-demarrage"].contenu.instant,
      );
      return instantDroite - instantGauche;
    })[0];
}

function remplacerValeurExacte(valeur, ancienne, nouvelle, vus = new Set()) {
  if (!valeur || typeof valeur !== "object" || vus.has(valeur)) return;
  vus.add(valeur);
  for (const [cle, enfant] of Object.entries(valeur)) {
    if (enfant === ancienne) {
      valeur[cle] = nouvelle;
    } else {
      remplacerValeurExacte(enfant, ancienne, nouvelle, vus);
    }
  }
}

function executionsScelleesPour(releases) {
  const executions = [];
  for (const release of releases) {
    let precedent = null;
    for (const entree of release.journal ?? []) {
      if (entree.vers === "contractee") continue;
      entree.precedent =
        precedent === null
          ? null
          : {
              "graphe-sha256": precedent["graphe-sha256"],
              "recu-sha256": precedent["recu-tete-sha256"],
            };
      const ancienGrapheSha256 = entree.graphe.sha256;
      entree.graphe.contenu.precedent = structuredClone(entree.precedent);
      if (entree.vers === "contraction") {
        const contractionPunks = entree.graphe.contenu["contraction-punks"];
        contractionPunks["graphe-source-sha256"] = precedent["graphe-sha256"];
        entree["contraction-punks-sha256"] = canonicalSha256(contractionPunks);
        entree.attestation["contraction-punks-sha256"] =
          entree["contraction-punks-sha256"];
      }
      entree.graphe.sha256 = canonicalSha256(entree.graphe.contenu);
      entree.attestation.precedent = structuredClone(entree.precedent);
      entree.attestation["graphe-sha256"] = entree.graphe.sha256;
      entree["attestation-sha256"] = canonicalSha256(entree.attestation);
      const indexRecu = release.recus.findIndex(
        (recu) => recu.id === entree.recu,
      );
      if (indexRecu === -1) continue;
      const recuTransition = release.recus[indexRecu];
      remplacerValeurExacte(
        recuTransition.contenu,
        ancienGrapheSha256,
        entree.graphe.sha256,
      );
      recuTransition.contenu.precedent = structuredClone(entree.precedent);
      recuTransition.contenu["graphe-sha256"] = entree.graphe.sha256;
      recuTransition.contenu["attestation-sha256"] =
        entree["attestation-sha256"];
      if (entree.vers === "contraction") {
        recuTransition.contenu["contraction-punks-sha256"] =
          entree["contraction-punks-sha256"];
      }
      let precedentEtapeSha256 = null;
      for (const recuEtape of recuTransition.contenu.cadence ?? []) {
        const idEtape = `recu-etape-${entree.vers}-${recuEtape.contenu.etape}-${entree.graphe.sha256}`;
        recuEtape.id = idEtape;
        recuEtape.contenu.id = idEtape;
        recuEtape.contenu["graphe-sha256"] = entree.graphe.sha256;
        recuEtape.contenu["precedent-etape-sha256"] = precedentEtapeSha256;
        resignerRecu(recuEtape);
        precedentEtapeSha256 = recuEtape.sha256;
      }
      const scellee = executionReussiePourTransition({
        cible: release,
        entree,
        recuTransition,
        precedent,
      });
      executions.push(scellee.execution);
      precedent = scellee.tete;
    }
  }
  return executions.sort((gauche, droite) => {
    const instantGauche = gauche["recu-demarrage"].contenu.instant;
    const instantDroite = droite["recu-demarrage"].contenu.instant;
    return (
      instantGauche.localeCompare(instantDroite) ||
      gauche.id.localeCompare(droite.id)
    );
  });
}

function resynchroniserExecutionsScellees(release) {
  const executions = executionsScelleesPour([release]);
  EXECUTIONS_SCELLEES.set(release, executions);
  return release;
}

function executionsConnuesPour(releases) {
  return releases
    .flatMap((release) => EXECUTIONS_SCELLEES.get(release) ?? [])
    .sort((gauche, droite) => {
      const instantGauche = gauche["recu-demarrage"].contenu.instant;
      const instantDroite = droite["recu-demarrage"].contenu.instant;
      return (
        instantGauche.localeCompare(instantDroite) ||
        gauche.id.localeCompare(droite.id)
      );
    });
}

function historiqueJusqua({
  etat,
  dates,
  id,
  tranche,
  shaFinal,
  lignesRegistre,
  profil,
  profilsParPhase,
  pourcentageWorkersParPhase,
  migrationStatefulParPhase,
}) {
  const rang = ETATS.indexOf(etat);
  const phases = CHAINE_TRANSITIONS.slice(0, rang).filter(
    (phase) => phase !== "contractee",
  );
  const phaseFinale = phases.at(-1);
  const candidats = [];
  const journal = [];
  const recusTransitions = [];
  let precedentScelle = null;

  for (const [index, vers] of CHAINE_TRANSITIONS.slice(0, rang).entries()) {
    const date = dates[index];
    const instant = `${date}T${String(index).padStart(2, "0")}:00:00Z`;
    if (vers === "contractee") {
      journal.push({ vers, date, instant });
      continue;
    }
    const releaseId = `${id}/${vers}`;
    const sha = shaPhase({ shaFinal, id, phase: vers, phaseFinale });
    const deploiement = `deployment-${id}-${vers}-${sha.slice(0, 8)}`;
    const candidat = candidatPhase({
      id,
      tranche,
      phase: vers,
      sha,
      deploiement,
      lignesRegistre,
      profil: profilsParPhase?.[vers] ?? profil,
    });
    candidats.push(candidat);
    const topologie = topologiePhase({ id, phase: vers, sha });
    if (migrationStatefulParPhase?.[vers]) {
      topologie["migration-stateful"] = structuredClone(
        migrationStatefulParPhase[vers],
      );
    }
    if (pourcentageWorkersParPhase?.[vers] !== undefined) {
      for (const worker of topologie.workers) {
        worker.pourcentage = pourcentageWorkersParPhase[vers];
      }
    }
    const grapheScelleA = instantScellementCadence(vers, instant, topologie);
    const instantaneSource = journal.at(-1)?.graphe ?? null;
    const contractionPunks =
      vers === "contraction"
        ? {
            "graphe-source-sha256": instantaneSource.sha256,
            "materiaux-source-sha256": canonicalSha256(
              instantaneSource.contenu.release.materiaux,
            ),
            "materiaux-resultat-sha256": canonicalSha256(candidat.materiaux),
            retraits: ["contrat", "format", "chemin"].map((categorie) => ({
              categorie,
              identifiant: `${id}:punks-n-1:${categorie}`,
              "preuve-sha256": canonicalSha256({
                id,
                sha,
                categorie,
                preuve: "retrait-punks-n-1",
              }),
            })),
          }
        : null;
    const contenuGraphe = {
      schema: "punks.release-graph-snapshot.v1",
      tranche,
      phase: vers,
      instant: grapheScelleA,
      "release-id": releaseId,
      deploiement,
      precedent: structuredClone(precedentScelle),
      "contraction-punks": contractionPunks,
      topologie,
      release: structuredClone(candidat),
    };
    const graphe = contenuAdresse(contenuGraphe);
    const artefactsSha256 = canonicalSha256(candidat.artefacts);
    const attestation = {
      schema: "punks.transition-attestation.v1",
      "release-id": releaseId,
      transition: vers,
      instant,
      "graphe-scelle-a": grapheScelleA,
      precedent: structuredClone(precedentScelle),
      sha,
      deploiement,
      "artefacts-sha256": artefactsSha256,
      "graphe-sha256": graphe.sha256,
      ...(contractionPunks === null
        ? {}
        : {
            "contraction-punks-sha256": canonicalSha256(contractionPunks),
          }),
      publiee: ["release", "r2"],
    };
    const entree = {
      vers,
      date,
      instant,
      "graphe-scelle-a": grapheScelleA,
      precedent: structuredClone(precedentScelle),
      "release-id": releaseId,
      sha,
      deploiement,
      "artefacts-sha256": artefactsSha256,
      ...(contractionPunks === null
        ? {}
        : {
            "contraction-punks-sha256": canonicalSha256(contractionPunks),
          }),
      graphe,
      attestation,
      "attestation-sha256": canonicalSha256(attestation),
      recu: `recu-transition-${vers}-${tranche}-${sha}`,
    };
    journal.push(entree);
    const recuTransition = recuSigne({
      id: entree.recu,
      contenu: contenuRecuOperationnel({
        entree,
        instantane: { contenu: contenuGraphe },
      }),
    });
    recusTransitions.push(recuTransition);
    precedentScelle = {
      "graphe-sha256": graphe.sha256,
      "recu-sha256": recuTransition.sha256,
    };
  }
  return { candidats, journal, recusTransitions };
}

/**
 * Release scellée complète pour l'état demandé.
 * `dates` fournit les dates des transitions dans l'ordre du graphe.
 */
function releaseScellee({
  id = "tranche:1",
  tranche = 1,
  etat = "expansion",
  sha = SHA_CANDIDAT,
  dates = ["2026-07-10", "2026-08-02", "2026-11-01", "2026-11-03"],
  lignesRegistre = [],
  profil = null,
  profilsParPhase = null,
  pourcentageWorkersParPhase = null,
  migrationStatefulParPhase = null,
  surcharges = {},
} = {}) {
  const historique = historiqueJusqua({
    etat,
    dates,
    id,
    tranche,
    shaFinal: sha,
    lignesRegistre,
    profil,
    profilsParPhase,
    pourcentageWorkersParPhase,
    migrationStatefulParPhase,
  });
  const dernier = structuredClone(historique.candidats.at(-1));
  assert.ok(dernier, "une release scellée doit avoir au moins une phase");
  const base = {
    ...dernier,
    etat,
    recus: [
      ...structuredClone(dernier.recus),
      ...structuredClone(historique.recusTransitions),
    ],
    journal: structuredClone(historique.journal),
  };
  return resynchroniserExecutionsScellees({ ...base, ...surcharges });
}

function executionExpansionPartielle({
  cible = candidatPreparation(),
  suffixe = "1",
  sha = "31".repeat(20),
  instantGraphe = "2026-08-06T14:00:00Z",
  instantDemarrage = "2026-08-06T14:30:00Z",
  instantCadence = "2026-08-10T00:00:00Z",
  instantEtat = "2026-08-06T17:00:00Z",
  natureTerminale = "echec",
  precedent = null,
} = {}) {
  const releaseId = `${cible.id}/expansion/tentative-${suffixe}`;
  const idSlug = cible.id.replaceAll(":", "-");
  const deploiement = `deployment-${idSlug}-expansion-tentative-${suffixe}`;
  const candidat = candidatPhase({
    id: cible.id,
    tranche: cible.tranche,
    phase: "expansion",
    sha,
    deploiement,
    lignesRegistre: [],
  });
  const topologie = topologiePhase({
    id: cible.id,
    phase: "expansion",
    sha,
  });
  const contenuGraphe = {
    schema: "punks.release-graph-snapshot.v1",
    tranche: cible.tranche,
    phase: "expansion",
    instant: instantGraphe,
    "release-id": releaseId,
    deploiement,
    precedent:
      precedent === null
        ? null
        : {
            "graphe-sha256": precedent["graphe-sha256"],
            "recu-sha256": precedent["recu-tete-sha256"],
          },
    "contraction-punks": null,
    topologie,
    release: candidat,
  };
  const graphe = contenuAdresse(contenuGraphe);
  const idExecution = `execution-${idSlug}-expansion-tentative-${suffixe}`;
  const recuDemarrage = recuSigne({
    id: `recu-demarrage-${idExecution}-${graphe.sha256}`,
    contenu: {
      type: "execution-demarrage",
      "execution-id": idExecution,
      sequence: 0,
      cible: cible.id,
      programme: "expansion",
      "release-id": releaseId,
      "sha-punks": sha,
      "graphe-sha256": graphe.sha256,
      deploiement,
      precedent: structuredClone(precedent),
      instant: instantDemarrage,
      approbateurs: ["ops:alice", "ops:bob"],
    },
  });
  const cadence = cadenceScellee({
    phase: "expansion",
    instant: instantCadence,
    releaseId,
    grapheSha256: graphe.sha256,
    verdicts: contenuRecuOperationnel({
      entree: {
        vers: "expansion",
        instant: instantCadence,
        "release-id": releaseId,
        "attestation-sha256": "00".repeat(32),
        precedent:
          precedent === null
            ? null
            : {
                "graphe-sha256": precedent["graphe-sha256"],
                "recu-sha256": precedent["recu-tete-sha256"],
              },
        graphe,
      },
      instantane: { contenu: contenuGraphe },
    })["verdicts-metriques"],
    instantane: { contenu: contenuGraphe },
  });
  const recuE0 = cadence[0];
  const fermetureE0 = recuSigne({
    id: `recu-execution-${idExecution}-1-etape-fermee`,
    contenu: {
      type: "execution-evenement",
      "execution-id": idExecution,
      sequence: 1,
      "precedent-evenement-sha256": recuDemarrage.sha256,
      cible: cible.id,
      programme: "expansion",
      "release-id": releaseId,
      "sha-punks": sha,
      "graphe-sha256": graphe.sha256,
      instant: recuE0.contenu.heures.fin,
      nature: "etape-fermee",
      approbateurs: ["ops:alice", "ops:bob"],
      "recu-etape": recuE0,
    },
  });
  const charge = contenuRecuOperationnel({
    entree: {
      vers: "expansion",
      instant: instantEtat,
      "release-id": releaseId,
      "attestation-sha256": "00".repeat(32),
      precedent:
        precedent === null
          ? null
          : {
              "graphe-sha256": precedent["graphe-sha256"],
              "recu-sha256": precedent["recu-tete-sha256"],
            },
      graphe,
    },
    instantane: { contenu: contenuGraphe },
  });
  const workersE1 = structuredClone(topologie.workers);
  for (const worker of workersE1) worker.pourcentage = 1;
  const verdictsEtat = structuredClone(charge["verdicts-metriques"]);
  const violation = verdictsEtat.find(
    (verdict) => verdict.nom === "replay-automatique",
  );
  assert.ok(violation, "budget de tolérance zéro absent de la fixture");
  violation.mesure = 1;
  violation["borne-superieure-unilaterale-95"] = 1;
  violation.numerateur = 1;
  violation.resultat = "rouge";
  if (violation["baseline-n-1"].disponible) {
    violation["baseline-n-1"]["regression-pourcentage"] = null;
    violation["baseline-n-1"]["justification-acceptee"] = true;
    violation["baseline-n-1"]["justification-sha256"] = canonicalSha256({
      incident: `incident-expansion-e1-${suffixe}`,
      cause: "baseline nulle et violation absolue du budget",
    });
  }
  const terminal = ["echec", "quarantaine"].includes(natureTerminale);
  const critique = natureTerminale === "quarantaine";
  const pauseInstant =
    terminal && !critique
      ? new Date(Date.parse(instantEtat) - 15 * 60 * 1_000)
          .toISOString()
          .replace(".000Z", "Z")
      : instantEtat;
  const incidentId = `incident-expansion-e1-${suffixe}`;
  const fenetresPause = critique
    ? []
    : fenetresObservation({
        fin: pauseInstant,
        resultats: ["rouge"],
        incidentId,
      });
  const perimetre = "worker:punks-api";
  const survenuA = critique
    ? new Date(Date.parse(pauseInstant) - 60 * 1_000)
        .toISOString()
        .replace(".000Z", "Z")
    : fenetresPause[0].debut;
  const detecteA = critique ? pauseInstant : fenetresPause[0].debut;
  const incidents = [
    {
      id: incidentId,
      categorie: critique ? "violation-critique" : "regression-fonctionnelle",
      criticite: critique ? "critique" : "non-critique",
      statut: "ouvert",
      "donnees-exposees": critique,
      "survenu-a": survenuA,
      "detecte-a": detecteA,
      "qualifie-a": pauseInstant,
      "escalade-a": null,
    },
  ];
  const contenuEtat = ({
    nature,
    instant,
    sequence,
    precedentEvenementSha256,
    fenetres,
  }) => ({
    type: "execution-evenement",
    "execution-id": idExecution,
    sequence,
    "precedent-evenement-sha256": precedentEvenementSha256,
    cible: cible.id,
    programme: "expansion",
    "release-id": releaseId,
    "sha-punks": sha,
    "graphe-sha256": graphe.sha256,
    instant,
    nature,
    approbateurs: ["ops:alice", "ops:bob"],
    etape: "E1",
    cause: "borne statistique critique hors budget",
    perimetre,
    "incident-sha256": canonicalSha256(incidents[0]),
    workers: workersE1,
    workflows: structuredClone(topologie.workflows),
    "generation-compatibilite": topologie["generation-compatibilite"],
    "hashes-desktop": [],
    "verdicts-metriques": structuredClone(verdictsEtat),
    bookmarks: structuredClone(charge.bookmarks),
    dlq: structuredClone(charge.dlq),
    outboxes: structuredClone(charge.outboxes),
    incidents: structuredClone(incidents),
    "fenetres-observation": fenetres,
    fencing: fencingExecution({
      requis: critique,
      perimetre,
      incidentId,
      appliqueA: pauseInstant,
    }),
  });
  const pauseE1 = recuSigne({
    id: `recu-execution-${idExecution}-2-pause`,
    contenu: {
      ...contenuEtat({
        nature: "pause",
        instant: pauseInstant,
        sequence: 2,
        precedentEvenementSha256: fermetureE0.sha256,
        fenetres: fenetresPause,
      }),
      id: `recu-execution-${idExecution}-2-pause`,
      schema: "punks.release-receipt.v1",
    },
  });
  const evenements = [fermetureE0, pauseE1];
  if (terminal) {
    const fenetresTerminales = critique
      ? []
      : fenetresObservation({
          fin: instantEtat,
          resultats: ["rouge", "rouge"],
          incidentId,
        });
    const arret = recuSigne({
      id: `recu-execution-${idExecution}-3-${natureTerminale}`,
      contenu: {
        ...contenuEtat({
          nature: natureTerminale,
          instant: instantEtat,
          sequence: 3,
          precedentEvenementSha256: pauseE1.sha256,
          fenetres: fenetresTerminales,
        }),
        id: `recu-execution-${idExecution}-3-${natureTerminale}`,
        schema: "punks.release-receipt.v1",
      },
    });
    evenements.push(arret);
  }
  return {
    cible,
    execution: {
      schema: "punks.release-execution.v1",
      id: idExecution,
      tranche: cible.tranche,
      programme: "expansion",
      cible: cible.id,
      graphe,
      precedent: structuredClone(precedent),
      "recu-demarrage": recuDemarrage,
      evenements,
    },
  };
}

function executionExpansionReussie() {
  const cible = releaseScellee({
    etat: "expansion",
    dates: ["2026-08-10"],
  });
  const entree = cible.journal[0];
  const recuTransition = cible.recus.find((recu) => recu.id === entree.recu);
  assert.ok(recuTransition, "Reçu de transition de test absent");
  const graphe = entree.graphe;
  const idExecution = "execution-tranche-1-expansion-reussie";
  const recuDemarrage = recuSigne({
    id: `recu-demarrage-${idExecution}-${graphe.sha256}`,
    contenu: {
      type: "execution-demarrage",
      "execution-id": idExecution,
      sequence: 0,
      cible: cible.id,
      programme: "expansion",
      "release-id": entree["release-id"],
      "sha-punks": entree.sha,
      "graphe-sha256": graphe.sha256,
      deploiement: entree.deploiement,
      precedent: null,
      instant: graphe.contenu.instant,
      approbateurs: ["ops:alice", "ops:bob"],
    },
  });
  const evenements = [];
  let precedentEvenementSha256 = recuDemarrage.sha256;
  for (const [index, recuEtape] of recuTransition.contenu.cadence.entries()) {
    const evenement = recuSigne({
      id: `recu-execution-${idExecution}-${index + 1}-etape-fermee`,
      contenu: {
        type: "execution-evenement",
        "execution-id": idExecution,
        sequence: index + 1,
        "precedent-evenement-sha256": precedentEvenementSha256,
        cible: cible.id,
        programme: "expansion",
        "release-id": entree["release-id"],
        "sha-punks": entree.sha,
        "graphe-sha256": graphe.sha256,
        instant: recuEtape.contenu.heures.fin,
        nature: "etape-fermee",
        approbateurs: ["ops:alice", "ops:bob"],
        "recu-etape": recuEtape,
      },
    });
    evenements.push(evenement);
    precedentEvenementSha256 = evenement.sha256;
  }
  recuTransition.contenu["execution-id"] = idExecution;
  recuTransition.contenu["recu-execution-precedent-sha256"] =
    precedentEvenementSha256;
  resignerRecu(recuTransition);
  const fermeture = recuSigne({
    id: `recu-execution-${idExecution}-${evenements.length + 1}-phase-fermee`,
    contenu: {
      type: "execution-evenement",
      "execution-id": idExecution,
      sequence: evenements.length + 1,
      "precedent-evenement-sha256": precedentEvenementSha256,
      cible: cible.id,
      programme: "expansion",
      "release-id": entree["release-id"],
      "sha-punks": entree.sha,
      "graphe-sha256": graphe.sha256,
      instant: entree.instant,
      nature: "phase-fermee",
      approbateurs: ["ops:alice", "ops:bob"],
      "recu-transition-id": recuTransition.id,
      "recu-transition-sha256": recuTransition.sha256,
    },
  });
  evenements.push(fermeture);
  return {
    cible,
    execution: {
      schema: "punks.release-execution.v1",
      id: idExecution,
      tranche: cible.tranche,
      programme: "expansion",
      cible: cible.id,
      graphe,
      precedent: null,
      "recu-demarrage": recuDemarrage,
      evenements,
    },
  };
}

function deplacerInstantTransition(release, transition, instant) {
  const entree = release.journal.find((item) => item.vers === transition);
  assert.ok(entree, `transition ${transition} absente`);
  entree.date = instant.slice(0, 10);
  entree.instant = instant;
  entree["graphe-scelle-a"] = instantScellementCadence(
    transition,
    instant,
    entree.graphe.contenu.topologie,
  );
  entree.graphe.contenu.instant = entree["graphe-scelle-a"];
  entree.graphe.sha256 = canonicalSha256(entree.graphe.contenu);
  entree.attestation.instant = instant;
  entree.attestation["graphe-scelle-a"] = entree["graphe-scelle-a"];
  entree.attestation["graphe-sha256"] = entree.graphe.sha256;
  entree["attestation-sha256"] = canonicalSha256(entree.attestation);
  const recu = release.recus.find((item) => item.id === entree.recu);
  assert.ok(recu, `Reçu de ${transition} absent`);
  recu.contenu.instant = instant;
  recu.contenu["attestation-sha256"] = entree["attestation-sha256"];
  recu.contenu["graphe-sha256"] = entree.graphe.sha256;
  recu.contenu.cadence = cadenceScellee({
    phase: transition,
    instant,
    releaseId: entree["release-id"],
    grapheSha256: entree.graphe.sha256,
    verdicts: recu.contenu["verdicts-metriques"],
    instantane: { contenu: entree.graphe.contenu },
  });
  recu.contenu.heures = {
    debut: recu.contenu.cadence[0].contenu.segments[0].debut,
    fin: recu.contenu.cadence.at(-1).contenu.segments.at(-1).fin,
  };
  recu.sha256 = canonicalSha256(recu.contenu);
  recu.signatures = signatures(recu.contenu, recu.contenu.approbateurs);
  resynchroniserExecutionsScellees(release);
}

function scellerUsageContraction(release, usage) {
  const entree = release.journal.find(
    (transition) => transition.vers === "contraction",
  );
  assert.ok(entree, "transition contraction absente");
  release.usage = structuredClone(usage);
  entree.graphe.contenu.release.usage = structuredClone(usage);
  const usageSha256 = canonicalSha256(usage);
  entree["usage-sha256"] = usageSha256;
  entree.graphe.sha256 = canonicalSha256(entree.graphe.contenu);
  entree.attestation["usage-sha256"] = usageSha256;
  entree.attestation["graphe-sha256"] = entree.graphe.sha256;
  entree["attestation-sha256"] = canonicalSha256(entree.attestation);
  const recu = release.recus.find((item) => item.id === entree.recu);
  assert.ok(recu, "Reçu de contraction absent");
  recu.contenu["usage-sha256"] = usageSha256;
  recu.contenu["graphe-sha256"] = entree.graphe.sha256;
  recu.contenu["attestation-sha256"] = entree["attestation-sha256"];
  recu.contenu.cadence = cadenceScellee({
    phase: "contraction",
    instant: entree.instant,
    releaseId: entree["release-id"],
    grapheSha256: entree.graphe.sha256,
    verdicts: recu.contenu["verdicts-metriques"],
    instantane: { contenu: entree.graphe.contenu },
  });
  recu.contenu.heures = {
    debut: recu.contenu.cadence[0].contenu.segments[0].debut,
    fin: recu.contenu.cadence.at(-1).contenu.segments.at(-1).fin,
  };
  resignerRecu(recu);
  resynchroniserExecutionsScellees(release);
}

function profilsActifs(...releases) {
  return releases.map((release) => ({
    id: release.materiaux.profil.id,
    version: release.materiaux.profil.version,
    sha256: release.materiaux.profil.sha256,
  }));
}

function preuveControle({
  controle,
  cible,
  cibleLogique,
  instantaneCible,
  instantaneReference,
  instant,
  profils,
  recu,
  attestationEligibleSha256,
}) {
  const details = {
    "bundle-manifeste-originaux": {
      ...cible["digests-production"],
    },
    "attestation-valide-non-revoquee": {
      "attestation-eligible-sha256": attestationEligibleSha256,
      invalidee: false,
      revoquee: false,
    },
    "securite-isolation-effacement-sans-buzz": {
      vulnerabilite: false,
      "violation-isolation": false,
      "violation-effacement": false,
      "chemin-buzz-nostr-public": false,
    },
    "profils-desktop-actifs": { profils },
    "versions-etat-durable-objects": {
      versions: structuredClone(
        instantaneReference.entree.graphe.contenu.topologie[
          "versions-etat-durable-objects"
        ],
      ),
    },
    "migrations-durable-objects-franchissables": {
      infranchissable: false,
    },
    "migrations-d1-expand-compatibles": { "expand-compatible": true },
    "formats-r2-tombstones-generations": {
      ...structuredClone(
        instantaneReference.entree.graphe.contenu.topologie["etat-r2"],
      ),
    },
    "topologie-cloudflare": {
      "inventaire-sha256": canonicalSha256(
        instantaneReference.entree.graphe.contenu.topologie.inventaire,
      ),
      "versions-cloudflare-sha256": canonicalSha256(
        instantaneReference.entree.graphe.contenu.topologie[
          "versions-cloudflare"
        ],
      ),
      "workflows-sha256": canonicalSha256(
        instantaneReference.entree.graphe.contenu.topologie.workflows,
      ),
      "generation-compatibilite":
        instantaneReference.entree.graphe.contenu.topologie[
          "generation-compatibilite"
        ],
      "moyens-connexion-sha256": canonicalSha256(
        instantaneReference.entree.graphe.contenu.topologie["moyens-connexion"],
      ),
    },
    "generations-secrets-attestation-sessions": {
      ...structuredClone(
        instantaneReference.entree.graphe.contenu.topologie[
          "generations-securite"
        ],
      ),
      "generation-revoquee-reactivee": false,
    },
    "workflows-compatibles-ou-neutralises": {
      statut: "compatible",
      "preuve-staging-sha256": "77".repeat(32),
    },
    "smoke-handshake-probes": {
      "smoke-production": "vert",
      handshake: "vert",
      "probes-critiques": "vert",
    },
    "recu-cloudflare-digests-approbateurs": {
      "recu-sha256": recu?.sha256,
    },
  }[controle];
  const preuve = {
    schema: "punks.compatibility-control.v1",
    controle,
    cible: cibleLogique.id,
    "release-id-cible": instantaneCible.entree["release-id"],
    "graphe-cible-sha256": instantaneCible.entree.graphe.sha256,
    "release-id-reference": instantaneReference.entree["release-id"],
    "graphe-reference-sha256": instantaneReference.entree.graphe.sha256,
    "topologie-reference-sha256": canonicalSha256(
      instantaneReference.entree.graphe.contenu.topologie,
    ),
    "sha-cible": cible.sha,
    instant,
    resultat: "vert",
    details,
  };
  return {
    controle,
    preuve,
    "preuve-sha256": canonicalSha256(preuve),
  };
}

function instantaneCiblePourTest(cible, instant, phaseForcee = null) {
  const entrees = cible.journal.filter(
    (entree) =>
      entree.vers !== "contractee" &&
      (phaseForcee === null
        ? entree.instant <= instant
        : entree.vers === phaseForcee),
  );
  const entree = entrees
    .sort((a, b) => a.instant.localeCompare(b.instant))
    .at(-1);
  assert.ok(entree, "snapshot cible absent pour le certificat de test");
  return {
    entree,
    release: entree.graphe.contenu.release,
  };
}

function certificatComplet({
  cible,
  reference,
  date,
  profils = [reference],
  phaseCible = null,
  grapheReference = null,
}) {
  const instant = `${date}T12:00:00Z`;
  const instantaneCible = instantaneCiblePourTest(cible, instant, phaseCible);
  const instantaneReference = grapheReference
    ? {
        entree: {
          "release-id": grapheReference.contenu["release-id"],
          graphe: grapheReference,
        },
        release: grapheReference.contenu.release,
      }
    : instantaneCiblePourTest(reference, instant);
  const cibleHistorique = instantaneCible.release;
  const attestationEligibleSha256 =
    instantaneCible.entree["attestation-sha256"];
  const profilsCites = profilsActifs(...profils);
  const certificat = {
    cible: cible.id,
    "release-id-cible": instantaneCible.entree["release-id"],
    "graphe-cible-sha256": instantaneCible.entree.graphe.sha256,
    "release-id-reference": instantaneReference.entree["release-id"],
    "graphe-reference-sha256": instantaneReference.entree.graphe.sha256,
    "topologie-reference-sha256": canonicalSha256(
      instantaneReference.entree.graphe.contenu.topologie,
    ),
    "sha-cible": cibleHistorique.sha,
    "attestation-eligible-sha256": attestationEligibleSha256,
    "calcule-a": instant,
    contrats: cibleHistorique.materiaux["registre-contrats"].version,
    profil: cibleHistorique.materiaux.profil.id,
    "profil-version": cibleHistorique.materiaux.profil.version,
    "compatibilite-donnees": true,
    "verifie-contre": reference.id,
    "digests-production": { ...cibleHistorique["digests-production"] },
    "profils-actifs": profilsCites,
    controles: CONTROLES_CERTIFICAT.slice(0, -1).map((controle) =>
      preuveControle({
        controle,
        cible: cibleHistorique,
        cibleLogique: cible,
        instantaneCible,
        instantaneReference,
        instant,
        profils: profilsCites,
        recu: null,
        attestationEligibleSha256,
      }),
    ),
  };
  const recu = recuSigne({
    id: `recu-eligibilite-${cible.id}-${date}`,
    contenu: {
      type: "retour-punks",
      cible: cible.id,
      "release-id-cible": instantaneCible.entree["release-id"],
      "graphe-cible-sha256": instantaneCible.entree.graphe.sha256,
      "release-id-reference": instantaneReference.entree["release-id"],
      "graphe-reference-sha256": instantaneReference.entree.graphe.sha256,
      "topologie-reference-sha256": canonicalSha256(
        instantaneReference.entree.graphe.contenu.topologie,
      ),
      "sha-cible": cibleHistorique.sha,
      "attestation-eligible-sha256": attestationEligibleSha256,
      instant,
      "identifiants-cloudflare": structuredClone(
        instantaneReference.entree.graphe.contenu.topologie[
          "versions-cloudflare"
        ],
      ),
      "digests-historiques": { ...cibleHistorique["digests-production"] },
      "dossier-compatibilite-sha256": empreinteDossierCompatibilite(certificat),
      approbateurs: ["ops:alice", "ops:bob"],
    },
  });
  certificat.controles.push(
    preuveControle({
      controle: CONTROLES_CERTIFICAT.at(-1),
      cible: cibleHistorique,
      cibleLogique: cible,
      instantaneCible,
      instantaneReference,
      instant,
      profils: profilsCites,
      recu,
      attestationEligibleSha256,
    }),
  );
  return {
    ...certificat,
    recu,
  };
}

function resignerCertificat(certificat) {
  for (const controle of certificat.controles.slice(0, -1)) {
    controle["preuve-sha256"] = canonicalSha256(controle.preuve);
  }
  certificat.recu.contenu["dossier-compatibilite-sha256"] =
    empreinteDossierCompatibilite(certificat);
  resignerRecu(certificat.recu);
  const controleRecu = certificat.controles.at(-1);
  controleRecu.preuve.details["recu-sha256"] = certificat.recu.sha256;
  controleRecu["preuve-sha256"] = canonicalSha256(controleRecu.preuve);
}

function invalidationAttestation({
  release,
  transition = "expansion",
  nature = "supersession-documentaire",
  instant = "2026-09-01T12:00:00Z",
  suffixe = "1",
}) {
  const entree = release.journal.find((element) => element.vers === transition);
  assert.ok(entree, `attestation de ${transition} absente`);
  const id = `invalidation-${release.id.replaceAll(":", "-")}-${transition}-${suffixe}`;
  const cause = `correction ${transition} ${suffixe}`;
  const supersession = nature === "supersession-documentaire";
  const attestationSupersedante = supersession
    ? {
        schema: "punks.attestation-supersedante.v1",
        "attestation-originale-sha256": entree["attestation-sha256"],
        cause,
        instant,
        "dossier-correctif-sha256": canonicalSha256({
          id,
          correction: true,
        }),
        publiee: ["release", "r2"],
      }
    : null;
  const attestationSupersedanteSha256 = supersession
    ? canonicalSha256(attestationSupersedante)
    : null;
  const contenuRecu = {
    type: "invalidation-attestation",
    "invalidation-id": id,
    nature,
    "attestation-sha256": entree["attestation-sha256"],
    "attestation-supersedante-sha256": attestationSupersedanteSha256,
    "release-id": entree["release-id"],
    "sha-punks": entree.sha,
    "profil-bloque-sha256": null,
    "fencing-preuve-sha256": null,
    "execution-id": null,
    "recu-pause-sha256": null,
    "recu-quarantaine-sha256": null,
    cause,
    instant,
    approbateurs: ["ops:alice", "ops:bob"],
  };
  return {
    schema: "punks.attestation-invalidation.v1",
    id,
    nature,
    "attestation-sha256": entree["attestation-sha256"],
    "attestation-supersedante": attestationSupersedante,
    "attestation-supersedante-sha256": attestationSupersedanteSha256,
    "release-id": entree["release-id"],
    "sha-punks": entree.sha,
    "profil-bloque-sha256": null,
    "fencing-preuve-sha256": null,
    "execution-id": null,
    "recu-pause-sha256": null,
    "recu-quarantaine-sha256": null,
    cause,
    instant,
    recu: recuSigne({
      id: `recu-invalidation-attestation-${id}`,
      contenu: contenuRecu,
    }),
  };
}

function profilsSupportesPour(releases) {
  const profils = new Map();
  for (const release of releases) {
    const activation = release.journal?.find(
      (entree) => entree.vers === "active",
    );
    if (!activation) {
      continue;
    }
    const profil =
      activation.graphe?.contenu?.release?.materiaux?.profil ?? null;
    if (profil === null) continue;
    const cle = `${profil.id}\u0000${profil.version}\u0000${profil.sha256}`;
    const existant = profils.get(cle);
    if (!existant || activation.instant < existant["accepte-depuis"]) {
      profils.set(cle, {
        id: profil.id,
        version: profil.version,
        sha256: profil.sha256,
        "accepte-depuis": activation.instant,
        "accepte-jusqua": null,
      });
    }
  }
  return [...profils.values()];
}

function graphValide(surcharges = {}) {
  const releases = surcharges.releases ?? [candidatPreparation()];
  const executions = surcharges.executions ?? executionsConnuesPour(releases);
  const recuperations = surcharges.recuperations ?? [];
  for (const recuperation of recuperations) {
    if (!("execution-precedente" in recuperation)) {
      recuperation["execution-precedente"] =
        recuperation.type === "roll-forward"
          ? descripteurExecutionFixture(
              teteExecutionFixture(executions, recuperation.instant),
              releases,
            )
          : null;
    }
  }
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
        "bootstrap-r2": {
          "premiere-activation": "github-puis-r2",
          reference: "bootstrap-github-attestation-sha256",
        },
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
    "controles-certificat-retour-punks": [...CONTROLES_CERTIFICAT],
    plateformes: [...PLATEFORMES],
    references: {
      spec: 47,
      decisions: [13, 14, 16, 17],
      adr: [ADR],
    },
    publication: {
      r2: {
        destinations: [
          {
            role: "primaire",
            compte: "10".repeat(16),
            bucket: "punks-release-proofs-primary",
            "verrouillage-objet": "compliance",
          },
          {
            role: "secondaire",
            compte: "20".repeat(16),
            bucket: "punks-release-proofs-recovery",
            "verrouillage-objet": "compliance",
          },
        ],
        layout: {
          attestations:
            "releases/{canal}/{id}/attestations/{attestation-sha256}.json",
          recus: "releases/{canal}/{id}/recus/{recu-sha256}.json",
        },
      },
    },
    "approbateurs-release": APPROBATEURS_RELEASE.map((entree) => ({
      ...entree,
    })),
    "invalidations-attestations":
      surcharges["invalidations-attestations"] ?? [],
    releases,
    executions,
    "profils-supportes":
      surcharges["profils-supportes"] ?? profilsSupportesPour(releases),
    recuperations,
  };
  return { ...graph, ...surcharges };
}

function frontieresPublicationOperationnelle({ tag, sha, draft = false }) {
  const assets = new Map();
  const objets = new Map();
  return {
    github: {
      async lireRelease() {
        return { id: 51, tag, sha, draft };
      },
      async lireAsset({ nom }) {
        return assets.get(nom) ?? null;
      },
      async creerAsset({ nom, contenu }) {
        if (assets.has(nom)) {
          const erreur = new Error("asset existant");
          erreur.code = "ALREADY_EXISTS";
          throw erreur;
        }
        assets.set(nom, Buffer.from(contenu));
      },
    },
    cloudflare: {
      async lireVerrouillage() {
        return { mode: "compliance", actif: true };
      },
      async lireObjet({ compte, bucket, cle }) {
        return objets.get(`${compte}/${bucket}/${cle}`) ?? null;
      },
      async creerObjet({ compte, bucket, cle, contenu }) {
        const identite = `${compte}/${bucket}/${cle}`;
        if (objets.has(identite)) {
          const erreur = new Error("objet existant");
          erreur.code = "ALREADY_EXISTS";
          throw erreur;
        }
        objets.set(identite, Buffer.from(contenu));
      },
    },
  };
}

function optionsPublicationOperationnelle(graph, recu, { releaseId, sha }) {
  const r2 = graph.publication.r2.destinations.map(
    ({ role, compte, bucket }) => ({ role, compte, bucket }),
  );
  const tag = `punks-staging-${sha}`;
  return {
    options: {
      graphe: Buffer.from(canonicalJson(graph)),
      recu: Buffer.from(canonicalJson(recu)),
      parity: Buffer.from(
        `${entreesParityDuGraphe(graph)
          .map((entree) => entree.marqueur)
          .join("\n")}\n`,
      ),
      depot: "punksbot/punksbot",
      tag,
      sha,
      releaseId,
      draft: false,
      canal: "punks-desktop",
      r2,
    },
    frontieres: {
      ...frontieresPublicationOperationnelle({ tag, sha }),
      confiance: {
        registreApprobateursRelease: APPROBATEURS_RELEASE,
        ancrageApprobateursRelease: canonicalSha256(APPROBATEURS_RELEASE),
        ancrageDestinationsR2: canonicalSha256(r2),
      },
    },
  };
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

  const extensionBuzz = graphValide();
  extensionBuzz.politique.recuperation["redirection-buzz"] = "autorisee";
  extensionBuzz["fallback-nostr-public"] = { actif: true };
  attendu(erreurs(extensionBuzz), "schéma racine fermé");
  attendu(erreurs(extensionBuzz), "arête implicite interdite");
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
  const graph4 = graphValide();
  graph4["controles-certificat-retour-punks"] = CONTROLES_CERTIFICAT.slice(1);
  attendu(
    erreurs(graph4),
    "controles-certificat-retour-punks doit être exactement",
  );
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
  const graph4 = graphValide();
  graph4.references.adr = ["docs/adr/0059-une-autre-decision.md"];
  attendu(
    erreurs(graph4, contexteStandard({ fileExists: () => true })),
    "doit citer l'ADR 0060",
  );
  const graph5 = graphValide();
  graph5.references.adr.push("docs/adr/0061-decision-complementaire.md");
  assert.deepEqual(
    erreurs(graph5, contexteStandard({ fileExists: () => true })),
    [],
  );
  attendu(
    erreurs(graphValide({ canal: "buzz-desktop" })),
    "canal doit être punks-desktop",
  );
});

test("le layout R2 est fermé et identique à celui du publisher", () => {
  const graph = graphValide();
  graph.publication.r2.layout.attestations = "attestations/{id}.json";
  attendu(erreurs(graph), "layout R2 de attestations");
  const graph2 = graphValide();
  graph2.publication.r2.layout.recus = "releases/{canal}/{id}/recus.json";
  attendu(erreurs(graph2), "layout R2 de recus doit être exactement");
  const graph3 = graphValide();
  graph3.publication.r2.layout.attestations =
    "releases/evil/{canal}/{id}/ailleurs/{attestation-sha256}.json";
  attendu(erreurs(graph3), "layout R2 de attestations doit être exactement");
  const sansDestinations = graphValide({
    releases: [releaseScellee({ etat: "expansion" })],
  });
  sansDestinations.publication.r2.destinations = [];
  attendu(erreurs(sansDestinations), "destinations R2 ancrées");
  const memeCompte = graphValide();
  memeCompte.publication.r2.destinations[1].compte =
    memeCompte.publication.r2.destinations[0].compte;
  attendu(erreurs(memeCompte), "destination R2 secondaire canonique");
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
  const graph5 = graphValide({
    releases: [
      {
        ...candidatPreparation(),
        id: "tranche:2",
        tranche: 2,
      },
    ],
  });
  attendu(erreurs(graph5), "historique des tranches doit commencer à 1");
});

test("toute tranche antérieure est scellée avant d'ouvrir la suivante", () => {
  const preparation = candidatPreparation();
  const courante = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  attendu(
    erreurs(graphValide({ releases: [preparation, courante] })),
    "tranche antérieure à la tranche courante doit déjà être scellée",
  );
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

  for (const shaInterdit of [BASELINE_BUZZ, CHECKPOINT_RECUPERATION]) {
    const interdit = releaseScellee({ etat: "expansion" });
    interdit.sha = shaInterdit;
    attendu(
      erreurs(graphValide({ releases: [interdit] })),
      "distinct des checkpoints Buzz interdits",
    );
  }
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
  const release2 = releaseScellee({ etat: "expansion" });
  release2.staging.deploiement = "";
  attendu(
    erreurs(graphValide({ releases: [release2] }), contexteStandard()),
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

  const preuveAvecChampImplicite = releaseScellee({ etat: "expansion" });
  preuveAvecChampImplicite.preuves["cloudflare-check"].exception = true;
  attendu(
    erreurs(graphValide({ releases: [preuveAvecChampImplicite] })),
    "preuve « cloudflare-check » à schéma fermé",
  );
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
  const release3 = releaseScellee({ etat: "expansion", dates: ["2026-08-01"] });
  release3.retrait.sha = "22".repeat(20);
  attendu(
    erreurs(graphValide({ releases: [release3] })),
    "retrait.sha doit être rattaché au SHA exact du candidat",
  );
  const graph = graphValide();
  graph.releases[0].retrait = {
    sha: null,
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
    [(a) => delete a.dossier, "dossier de preuve content-addressé exact"],
    [
      (a) => (a.dossier.sha256 = "42".repeat(32)),
      "dossier de preuve content-addressé exact",
    ],
    [
      (a) => (a.registres = a.registres.slice(0, 2)),
      "manque « registre-goldens »",
    ],
    [(a) => a.registres.push({ ...a.registres[0] }), "duplique le registre"],
    [(a) => (a.registres[0].sha256 = "55".repeat(32)), "diverge des matériaux"],
    [(a) => (a.staging.compte = "0".repeat(32)), "staging.compte diverge"],
    [(a) => (a.gates = a.gates.slice(0, 3)), "manque le résultat"],
    [(a) => a.gates.push({ ...a.gates[0] }), "duplique la gate"],
    [(a) => (a.gates[0].sha = "33".repeat(20)), "liée au SHA du candidat"],
    [(a) => (a.artefacts = []), "artefacts distribués"],
    [(a) => (a.artefacts[1] = { ...a.artefacts[0] }), "duplique la plateforme"],
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
  const contenuAttestationAltere = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  contenuAttestationAltere.attestation.note = "altération non scellée";
  attendu(
    erreurs(graphValide({ releases: [contenuAttestationAltere] })),
    "attestation-sha256 doit être le hash canonique",
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
  const graph = graphValide();
  graph.releases[0].recus = [
    {
      id: "recu-anticipe",
      sha256: "12".repeat(32),
      publication: ["release", "r2"],
    },
  ];
  attendu(erreurs(graph), "candidat en preparation ne porte pas de Reçu");
  const release4 = releaseScellee({ etat: "expansion" });
  release4.recus.push({ ...release4.recus[0] });
  attendu(
    erreurs(graphValide({ releases: [release4] })),
    "identifiant de Reçu dupliqué",
  );
  const release5 = releaseScellee({ etat: "expansion" });
  release5.recus[1].sha256 = release5.recus[0].sha256;
  attendu(
    erreurs(graphValide({ releases: [release5] })),
    "sha256 de Reçu dupliqué",
  );
  const contenuAltere = releaseScellee({ etat: "expansion" });
  contenuAltere.recus[0].contenu.sha = "22".repeat(20);
  attendu(
    erreurs(graphValide({ releases: [contenuAltere] })),
    "hash canonique du contenu divergent",
  );
  const signatureInvalide = releaseScellee({ etat: "expansion" });
  signatureInvalide.recus[0].signatures[0].valeur = "invalide";
  attendu(
    erreurs(graphValide({ releases: [signatureInvalide] })),
    "deux signatures ed25519 cryptographiquement valides",
  );
  const orphelin = releaseScellee({ etat: "contractee" });
  orphelin.recus.push(
    recuSigne({
      id: `recu-transition-contractee-${orphelin.tranche}-${orphelin.sha}`,
      contenu: {
        type: "transition",
        transition: "contractee",
        "release-id": `${orphelin.id}/contractee-interdit`,
      },
    }),
  );
  attendu(erreurs(graphValide({ releases: [orphelin] })), "est orphelin");

  const typeInconnu = releaseScellee({ etat: "expansion" });
  typeInconnu.recus.push(
    recuSigne({
      id: `recu-inconnu-${typeInconnu.sha}`,
      contenu: { type: "magique" },
    }),
  );
  attendu(
    erreurs(graphValide({ releases: [typeInconnu] })),
    "type de Reçu orphelin ou inconnu",
  );

  const enveloppeImplicite = releaseScellee({ etat: "expansion" });
  enveloppeImplicite.recus[0].trace = "non-contractuelle";
  attendu(
    erreurs(graphValide({ releases: [enveloppeImplicite] })),
    "enveloppe de Reçu à schéma fermé",
  );

  const promotionImplicite = releaseScellee({ etat: "expansion" });
  promotionImplicite.recus[0].contenu.exception = true;
  resignerRecu(promotionImplicite.recus[0]);
  attendu(
    erreurs(graphValide({ releases: [promotionImplicite] })),
    "Reçu de promotion à schéma fermé",
  );

  const retraitImplicite = releaseScellee({ etat: "expansion" });
  retraitImplicite.recus[1].contenu.exception = true;
  resignerRecu(retraitImplicite.recus[1]);
  attendu(
    erreurs(graphValide({ releases: [retraitImplicite] })),
    "Reçu de retrait à schéma fermé",
  );

  const transitionImplicite = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-21"],
  });
  const recuTransitionImplicite = transitionImplicite.recus.find(
    (recu) => recu.contenu?.type === "transition",
  );
  assert.ok(recuTransitionImplicite, "Reçu de transition de test absent");
  recuTransitionImplicite.contenu.exception = true;
  resignerRecu(recuTransitionImplicite);
  attendu(
    erreurs(graphValide({ releases: [transitionImplicite] })),
    "Reçu opérationnel à schéma fermé",
  );
});

test("le registre approuvé et la cryptographie empêchent forge et re-signature étrangère", () => {
  const forge = releaseScellee({ etat: "expansion" });
  forge.recus[0].signatures[0].valeur = "00".repeat(64);
  attendu(
    erreurs(graphValide({ releases: [forge] })),
    "cryptographiquement valides de clés approuvées",
  );

  const etrangere = releaseScellee({ etat: "expansion" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const recu = etrangere.recus[0];
  recu.signatures[0] = {
    approbateur: "ops:alice",
    algorithme: "ed25519",
    "cle-publique-spki": publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    valeur: signerEd25519(
      null,
      Buffer.from(canonicalJson(recu.contenu), "utf8"),
      privateKey,
    ).toString("hex"),
  };
  attendu(
    erreurs(graphValide({ releases: [etrangere] })),
    "cryptographiquement valides de clés approuvées",
  );

  const registreRemplace = graphValide({
    releases: [releaseScellee({ etat: "expansion" })],
  });
  registreRemplace["approbateurs-release"] = [
    {
      id: "attaquant:1",
      "cle-publique-spki": publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    },
  ];
  attendu(
    erreurs(registreRemplace),
    "ancrage de confiance opérateur indépendant",
  );

  const aliasDer = graphValide();
  const cleCanonique = APPROBATEURS_RELEASE[0]["cle-publique-spki"];
  aliasDer["approbateurs-release"] = [
    APPROBATEURS_RELEASE[0],
    {
      id: "ops:alias",
      "cle-publique-spki": Buffer.concat([
        Buffer.from(cleCanonique, "base64"),
        Buffer.from([0]),
      ]).toString("base64"),
    },
  ];
  attendu(
    validateReleaseGraph(
      aliasDer,
      contexteStandard({
        ancrageApprobateursRelease: canonicalSha256(
          aliasDer["approbateurs-release"],
        ),
      }),
    ),
    "clé publique SPKI ed25519 base64 invalide",
  );
});

test("un Reçu de promotion signé scelle obligatoirement l'attestation finale", () => {
  const sansPromotion = releaseScellee({ etat: "expansion" });
  sansPromotion.recus = sansPromotion.recus.filter(
    (recu) => recu.contenu.type !== "promotion",
  );
  attendu(
    erreurs(graphValide({ releases: [sansPromotion] })),
    "exactement un Reçu de promotion signé",
  );

  const rehashSansRecu = releaseScellee({ etat: "expansion" });
  rehashSansRecu.attestation.note = "contenu réécrit après promotion";
  rehashSansRecu["attestation-sha256"] = canonicalSha256(
    rehashSansRecu.attestation,
  );
  attendu(
    erreurs(graphValide({ releases: [rehashSansRecu] })),
    "exactement un Reçu de promotion signé",
  );
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
    "strictement postérieur à la transition précédente",
  );
  const sansReleaseDistincte = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  delete sansReleaseDistincte.journal[0]["release-id"];
  attendu(
    erreurs(graphValide({ releases: [sansReleaseDistincte] })),
    "release distincte sans identifiant",
  );
  const releaseDupliquee = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  releaseDupliquee.journal[1]["release-id"] =
    releaseDupliquee.journal[0]["release-id"];
  attendu(
    erreurs(graphValide({ releases: [releaseDupliquee] })),
    "identifiant de release de transition dupliqué",
  );
  const sansRecuTransition = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  sansRecuTransition.journal[1].recu = "recu-inconnu";
  attendu(
    erreurs(graphValide({ releases: [sansRecuTransition] })),
    "Reçu immuable de sa release distincte",
  );
  const graph = graphValide();
  graph.releases[0].journal = [{ vers: "expansion", date: "2026-08-01" }];
  attendu(erreurs(graph), "pas de journal de transitions");
});

test("l'évolution entre deux têtes interdit toute troncature ou réécriture historique", () => {
  const avant = graphValide({
    releases: [releaseScellee({ etat: "active" })],
  });
  assert.deepEqual(
    validateReleaseGraphEvolution(avant, structuredClone(avant)),
    [],
  );

  const journalTronque = structuredClone(avant);
  journalTronque.releases[0].journal.pop();
  attendu(
    validateReleaseGraphEvolution(avant, journalTronque),
    "journal historique a été tronqué",
  );

  const recuReecrit = structuredClone(avant);
  recuReecrit.releases[0].recus[0].publication = ["release"];
  attendu(
    validateReleaseGraphEvolution(avant, recuReecrit),
    "a disparu ou a été réécrit",
  );

  const partielle = executionExpansionPartielle();
  const avantExecution = graphValide({
    releases: [partielle.cible],
    executions: [partielle.execution],
  });
  const executionTronquee = structuredClone(avantExecution);
  executionTronquee.executions[0].evenements.pop();
  attendu(
    validateReleaseGraphEvolution(avantExecution, executionTronquee),
    "séquence d'événements a été tronquée",
  );

  const recuperationAvant = graphValide();
  recuperationAvant.recuperations = [{ id: "recuperation-immuable" }];
  const recuperationTronquee = structuredClone(recuperationAvant);
  recuperationTronquee.recuperations = [];
  attendu(
    validateReleaseGraphEvolution(recuperationAvant, recuperationTronquee),
    "journal des récupérations",
  );

  const preparationAvant = graphValide();
  const preparationApres = structuredClone(preparationAvant);
  preparationApres.releases[0].materiaux.schemas.sha256 = "12".repeat(32);
  assert.deepEqual(
    validateReleaseGraphEvolution(preparationAvant, preparationApres),
    [],
  );

  const profilOuvert = graphValide({
    releases: [releaseScellee({ etat: "active" })],
  });
  const profilFerme = structuredClone(profilOuvert);
  profilFerme["profils-supportes"][0]["accepte-jusqua"] =
    "2027-01-01T00:00:00Z";
  assert.deepEqual(
    validateReleaseGraphEvolution(profilOuvert, profilFerme),
    [],
  );
  const profilReouvert = structuredClone(profilFerme);
  profilReouvert["profils-supportes"][0]["accepte-jusqua"] = null;
  attendu(
    validateReleaseGraphEvolution(profilFerme, profilReouvert),
    "fermeture monotone null→instant",
  );
  const profilReecrit = structuredClone(profilOuvert);
  profilReecrit["profils-supportes"][0].sha256 = "99".repeat(32);
  attendu(
    validateReleaseGraphEvolution(profilOuvert, profilReecrit),
    "fermeture monotone null→instant",
  );
});

test("les invalidations d'attestation sont causales, signées et append-only", () => {
  const release = releaseScellee({
    etat: "expansion",
    dates: ["2026-08-01"],
  });
  const invalidation = invalidationAttestation({ release });
  const graph = graphValide({
    releases: [release],
    "invalidations-attestations": [invalidation],
  });
  assert.deepEqual(erreurs(graph), []);

  const releaseAntedatee = releaseScellee({
    etat: "expansion",
    dates: ["2026-08-01"],
  });
  const antedatee = invalidationAttestation({
    release: releaseAntedatee,
    instant: "2026-07-31T23:59:59Z",
  });
  attendu(
    erreurs(
      graphValide({
        releases: [releaseAntedatee],
        "invalidations-attestations": [antedatee],
      }),
    ),
    "strictement postérieure",
  );

  const reecrite = structuredClone(graph);
  reecrite["invalidations-attestations"][0].cause = "cause réécrite";
  attendu(
    validateReleaseGraphEvolution(graph, reecrite),
    "journal des invalidations d'attestation",
  );
});

test("une révocation matérielle bloque toute phase ordinaire suivante", () => {
  const release = releaseScellee({
    etat: "active",
    dates: ["2026-01-01", "2026-01-21"],
  });
  const invalidation = invalidationAttestation({
    release,
    nature: "revocation-materielle-non-critique",
    instant: "2026-01-02T00:30:00Z",
  });
  attendu(
    erreurs(
      graphValide({
        releases: [release],
        "invalidations-attestations": [invalidation],
      }),
    ),
    "attestation matériellement révoquée",
  );

  const releaseCorrigee = releaseScellee({
    etat: "active",
    dates: ["2026-01-01", "2026-01-21"],
  });
  const supersession = invalidationAttestation({
    release: releaseCorrigee,
    instant: "2026-01-02T00:30:00Z",
  });
  assert.deepEqual(
    erreurs(
      graphValide({
        releases: [releaseCorrigee],
        "invalidations-attestations": [supersession],
      }),
    ),
    [],
  );
});

test("chaque transition scelle son instant, son déploiement, son attestation et son Reçu", () => {
  const attestationAlteree = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  attestationAlteree.journal[0].attestation.sha = "22".repeat(20);
  attendu(
    erreurs(graphValide({ releases: [attestationAlteree] })),
    "hash canonique du contenu d'attestation divergent",
  );

  const recuRejoue = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  recuRejoue.journal[1].recu = recuRejoue.journal[0].recu;
  attendu(
    erreurs(graphValide({ releases: [recuRejoue] })),
    "rejoué sur plusieurs transitions",
  );

  const deploiementRejoue = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-02"],
  });
  deploiementRejoue.journal[1].deploiement =
    deploiementRejoue.journal[0].deploiement;
  attendu(
    erreurs(graphValide({ releases: [deploiementRejoue] })),
    "déploiement de transition rejoué",
  );

  const memeJourInverse = releaseScellee({
    etat: "active",
    dates: ["2026-08-01", "2026-08-01"],
  });
  deplacerInstantTransition(memeJourInverse, "active", "2026-08-01T00:00:00Z");
  attendu(
    erreurs(graphValide({ releases: [memeJourInverse] })),
    "strictement postérieur à la transition précédente",
  );

  const terminaleFaussementDistincte = releaseScellee({
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-02", "2026-06-01", "2026-06-02"],
  });
  terminaleFaussementDistincte.journal.at(-1)["release-id"] =
    "tranche:1/contractee";
  attendu(
    erreurs(graphValide({ releases: [terminaleFaussementDistincte] })),
    "jamais une quatrième release distincte",
  );
});

test("chaque Reçu post-promotion porte le minimum opérationnel fermé de la décision 16", () => {
  const cas = [
    ["workers", "versions/pourcentages Workers"],
    ["workflows", "Workers, Workflows et génération"],
    ["generation-compatibilite", "Workers, Workflows et génération"],
    ["hashes-desktop", "hashes desktop distribués"],
    ["heures", "heures de début/fin"],
    ["verdicts-metriques", "verdicts métriques"],
    ["bookmarks", "bookmarks"],
    ["dlq", "état DLQ"],
    ["outboxes", "état outboxes"],
    ["incidents", "incidents"],
  ];
  for (const [champ, message] of cas) {
    const release = releaseScellee({ etat: "expansion" });
    const recu = release.recus.find(
      (entree) => entree.contenu.type === "transition",
    );
    delete recu.contenu[champ];
    resignerRecu(recu);
    attendu(erreurs(graphValide({ releases: [release] })), message);
  }

  const incidentCritique = releaseScellee({ etat: "expansion" });
  const recuActivation = incidentCritique.recus.find(
    (recu) => recu.contenu.transition === "expansion",
  );
  recuActivation.contenu.incidents = [
    { id: "INC-CRIT-1", criticite: "critique", statut: "ouvert" },
  ];
  resignerRecu(recuActivation);
  attendu(
    erreurs(graphValide({ releases: [incidentCritique] })),
    "incident critique non résolu",
  );

  const incidentEtape = releaseScellee({ etat: "expansion" });
  const recuExpansion = incidentEtape.recus.find(
    (recu) => recu.contenu.transition === "expansion",
  );
  const e4 = recuExpansion.contenu.cadence.at(-1);
  e4.contenu.incidents = [
    { id: "INC-CRIT-E4", criticite: "critique", statut: "ouvert" },
  ];
  resignerRecu(e4);
  resignerRecu(recuExpansion);
  attendu(
    erreurs(graphValide({ releases: [incidentEtape] })),
    "incident critique non résolu",
  );

  const dlqNonVide = releaseScellee({ etat: "active" });
  const recuAvecDlq = dlqNonVide.recus.find(
    (recu) => recu.contenu.transition === "active",
  );
  recuAvecDlq.contenu.dlq.messages = 1;
  resignerRecu(recuAvecDlq);
  attendu(erreurs(graphValide({ releases: [dlqNonVide] })), "état DLQ");
});

test("chaque étape possède ses propres budgets et N−1 impose une baseline", () => {
  const release = releaseScellee({ etat: "expansion" });
  const recu = release.recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  assert.equal(
    new Set(
      recu.contenu.cadence.map(
        (element) => element.contenu["verdicts-metriques-sha256"],
      ),
    ).size,
    CADENCES_OPERATIONNELLES.expansion.length,
  );

  const avecNMoinsUn = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2026-01-01", "2026-01-21"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "expansion",
        dates: ["2026-02-01"],
      }),
    ],
  });
  const recuN = avecNMoinsUn.releases[1].recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  for (const verdict of recuN.contenu["verdicts-metriques"]) {
    verdict["baseline-n-1"] = {
      disponible: false,
      "mesure-n-1": null,
      "export-n-1-sha256": null,
      "regression-pourcentage": null,
      "justification-acceptee": false,
      "justification-sha256": null,
    };
  }
  resignerRecu(recuN);
  attendu(erreurs(avecNMoinsUn), "baseline Punks obligatoire");

  const borneInventee = releaseScellee({ etat: "expansion" });
  const recuBorne = borneInventee.recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  const proportion = recuBorne.contenu["verdicts-metriques"].find(
    (verdict) => verdict.unite === "pourcentage",
  );
  proportion.echantillons = 1;
  proportion.numerateur = 0;
  proportion.denominateur = 1;
  proportion.mesure = 0;
  proportion["borne-superieure-unilaterale-95"] = 0;
  resignerRecu(recuBorne);
  attendu(
    erreurs(graphValide({ releases: [borneInventee] })),
    "borne unilatérale 95 % recalculée",
  );

  for (const nom of [
    "connexion-desktop-echecs-par-moyen",
    "desktop-sessions-avec-crash-par-plateforme",
  ]) {
    const dimensionInventee = releaseScellee({ etat: "expansion" });
    const recuDimension = dimensionInventee.recus.find(
      (element) => element.contenu.transition === "expansion",
    );
    const verdict = recuDimension.contenu["verdicts-metriques"].find(
      (element) => element.nom === nom,
    );
    verdict.dimensions[0]["borne-superieure-unilaterale-95"] = 0;
    resignerRecu(recuDimension);
    attendu(
      erreurs(graphValide({ releases: [dimensionInventee] })),
      "dimensions exactes",
    );
  }

  const baselineInventee = structuredClone(avecNMoinsUn);
  const recuBaseline = baselineInventee.releases[1].recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  recuBaseline.contenu["verdicts-metriques"][0]["baseline-n-1"][
    "regression-pourcentage"
  ] = 1;
  resignerRecu(recuBaseline);
  attendu(erreurs(baselineInventee), "comparaison N−1 recalculée");
});

test("les conditions propres à E0, E2, E3, E4, A1 et A2 sont signées et fermées", () => {
  const cas = [
    {
      etat: "expansion",
      transition: "expansion",
      etape: "E0",
      alterer: (preuve) => {
        preuve["gates-synthetiques"][0].resultat = "rouge";
      },
    },
    {
      etat: "expansion",
      transition: "expansion",
      etape: "E2",
      alterer: (preuve) => {
        preuve.couverture = "partielle";
      },
    },
    {
      etat: "expansion",
      transition: "expansion",
      etape: "E3",
      alterer: (preuve) => {
        preuve["moyens-connexion"].pop();
      },
    },
    {
      etat: "expansion",
      transition: "expansion",
      etape: "E4",
      alterer: (preuve) => {
        preuve["travaux-asynchrones"][0]["en-attente"] = 1;
      },
    },
    {
      etat: "active",
      transition: "active",
      etape: "A1",
      alterer: (preuve) => {
        preuve.gates[0].resultat = "rouge";
      },
    },
    {
      etat: "active",
      transition: "active",
      etape: "A2",
      alterer: (preuve) => {
        preuve["incidents-herites"].push("incident-ouvert");
      },
    },
  ];
  for (const scenario of cas) {
    const release = releaseScellee({ etat: scenario.etat });
    const recu = release.recus.find(
      (element) => element.contenu.transition === scenario.transition,
    );
    const recuEtape = recu.contenu.cadence.find(
      (element) => element.contenu.etape === scenario.etape,
    );
    scenario.alterer(recuEtape.contenu["preuves-etape"][0]);
    resignerRecu(recuEtape);
    resignerRecu(recu);
    attendu(
      erreurs(graphValide({ releases: [release] })),
      "preuve conditionnelle",
    );
  }
});

test("les trois phases sont des releases matérielles distinctes et non des alias du sommet", () => {
  const release = releaseScellee({
    etat: "contraction",
    dates: ["2026-01-01", "2026-01-02", "2026-06-01"],
  });
  const [expansion, activation, contraction] = release.journal;
  assert.equal(
    new Set([
      expansion["release-id"],
      activation["release-id"],
      contraction["release-id"],
    ]).size,
    3,
  );
  assert.equal(
    new Set([expansion.sha, activation.sha, contraction.sha]).size,
    3,
  );
  assert.equal(
    new Set([
      expansion["artefacts-sha256"],
      activation["artefacts-sha256"],
      contraction["artefacts-sha256"],
    ]).size,
    3,
  );
  assert.equal(release.sha, contraction.sha);
});

test("les snapshots active et contraction exigent une exposition Workers à 100 %", () => {
  for (const phase of ["active", "contraction"]) {
    const release = releaseScellee({
      etat: phase,
      pourcentageWorkersParPhase: { [phase]: 10 },
    });
    attendu(erreurs(graphValide({ releases: [release] })), "Workers à 100 %");
  }
});

test("une migration stateful non splittable suit P0 24 h puis E4 48 h sans E1 à E3", () => {
  const release = releaseScellee({
    etat: "expansion",
    migrationStatefulParPhase: {
      expansion: {
        mode: "non-splittable",
        "plan-preparation-sha256": canonicalSha256({
          plan: "backfill-et-preparation-lecture",
        }),
      },
    },
  });
  const graph = graphValide({ releases: [release] });
  assert.deepEqual(erreurs(graph), []);
  const recu = release.recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  assert.deepEqual(
    recu.contenu.cadence.map((element) => element.contenu.etape),
    ["P0", "E4"],
  );
  assert.equal(recu.contenu.cadence[0].contenu.workers[0].pourcentage, 0);
  assert.equal(recu.contenu.cadence[1].contenu.workers[0].pourcentage, 100);

  const sansPreuveP0 = structuredClone(graph);
  const recuSansPreuve = sansPreuveP0.releases[0].recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  const p0 = recuSansPreuve.contenu.cadence[0];
  p0.contenu["preuve-preparation-stateful-sha256"] = null;
  resignerRecu(p0);
  resignerRecu(recuSansPreuve);
  attendu(erreurs(sansPreuveP0), "digest signé du résultat de préparation");

  const fauxP0A100 = structuredClone(graph);
  const recuFauxP0 = fauxP0A100.releases[0].recus.find(
    (element) => element.contenu.transition === "expansion",
  );
  const p0A100 = recuFauxP0.contenu.cadence[0];
  p0A100.contenu.workers[0].pourcentage = 100;
  resignerRecu(p0A100);
  resignerRecu(recuFauxP0);
  attendu(erreurs(fauxP0A100), "topologie");
});

test("les dates du graphe doivent exister dans le calendrier", () => {
  const release = releaseScellee({
    etat: "expansion",
    dates: ["2026-02-30"],
  });
  attendu(
    erreurs(graphValide({ releases: [release] })),
    "sans date YYYY-MM-DD valide",
  );
});

function grapheContraction({
  joursAvantContraction = 90,
  usage = 0.4,
  joursUsage = 14,
  avecUsage = true,
} = {}) {
  const activeLe = "2026-01-11";
  const msActive = Date.parse(`${activeLe}T00:00:00Z`);
  const msDebutContraction = msActive + joursAvantContraction * 86400000;
  const msContraction = msDebutContraction + 48 * 3600000;
  const contractionLe = new Date(msContraction).toISOString().slice(0, 10);
  const ancienne = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contraction",
    dates: ["2025-12-01", "2025-12-21", contractionLe],
  });
  ancienne.successeur = "tranche:2";
  if (avecUsage) {
    scellerUsageContraction(
      ancienne,
      Array.from({ length: joursUsage }, (_, i) => {
        const date = new Date(msDebutContraction - (joursUsage - i) * 86400000)
          .toISOString()
          .slice(0, 10);
        return { date, pourcentage: usage };
      }),
    );
  }
  const successeur = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2025-12-22", activeLe],
  });
  return graphValide({ releases: [ancienne, successeur] });
}

test("une contraction légale (90 jours puis < 1 % pendant 14 jours) est acceptée", () => {
  assert.deepEqual(erreurs(grapheContraction()), []);
});

test("une contraction no-op sans diff réel des matériaux Punks est refusée", () => {
  const graph = grapheContraction();
  const release = graph.releases[0];
  const entree = release.journal.find(
    (transition) => transition.vers === "contraction",
  );
  const contractionPunks = entree.graphe.contenu["contraction-punks"];
  contractionPunks["materiaux-resultat-sha256"] =
    contractionPunks["materiaux-source-sha256"];
  const contractionSha256 = canonicalSha256(contractionPunks);
  entree["contraction-punks-sha256"] = contractionSha256;
  entree.attestation["contraction-punks-sha256"] = contractionSha256;
  const recu = release.recus.find((element) => element.id === entree.recu);
  recu.contenu["contraction-punks-sha256"] = contractionSha256;
  scellerUsageContraction(release, release.usage);
  attendu(erreurs(graph), "matériaux Punks réellement modifiés");
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
  const graph4 = grapheContraction();
  for (const point of graph4.releases[0].usage) {
    point.date = new Date(Date.parse(`${point.date}T00:00:00Z`) - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  attendu(
    erreurs(graph4),
    "fenêtre d'usage doit se terminer la veille de la contraction",
  );
  const graph5 = grapheContraction();
  for (const point of graph5.releases[0].usage) point.pourcentage = 0.9;
  attendu(
    erreurs(graph5),
    "sommet logique doit refléter exactement le dernier candidat scellé",
  );
});

test("une contraction exige un successeur explicite", () => {
  const graph = grapheContraction();
  delete graph.releases[0].successeur;
  attendu(erreurs(graph), "contraction sans successeur");

  const successeurNonActif = grapheContraction();
  successeurNonActif.releases[1] = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "expansion",
    dates: ["2026-01-01"],
  });
  attendu(
    erreurs(successeurNonActif),
    "successeur tranche:2 doit être la release actuellement active",
  );

  const successeurNonConsecutif = grapheContraction();
  successeurNonConsecutif.releases[1] = releaseScellee({
    id: "tranche:3",
    tranche: 3,
    etat: "active",
    dates: ["2025-12-10", "2026-01-01"],
  });
  successeurNonConsecutif.releases[0].successeur = "tranche:3";
  attendu(
    erreurs(successeurNonConsecutif),
    "successeur doit être la tranche immédiatement suivante",
  );
});

test("une contraction historique reste valide quand son successeur avance", () => {
  const graph = grapheContraction();
  const ancienne = graph.releases[0];
  ancienne.etat = "contractee";
  ancienne.journal.push({
    vers: "contractee",
    date: "2026-04-15",
    instant: "2026-04-15T03:00:00Z",
  });

  const successeur = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "contraction",
    dates: ["2025-12-22", "2026-01-11", "2026-09-01"],
  });
  successeur.successeur = "tranche:3";
  const contractionLe = Date.parse("2026-08-30T00:00:00Z");
  scellerUsageContraction(
    successeur,
    Array.from({ length: 14 }, (_, i) => ({
      date: new Date(contractionLe - (14 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const active = releaseScellee({
    id: "tranche:3",
    tranche: 3,
    etat: "active",
    dates: ["2026-05-10", "2026-06-01"],
  });
  graph.releases = [ancienne, successeur, active];
  graph.executions = executionsConnuesPour(graph.releases);
  graph["profils-supportes"] = profilsSupportesPour(graph.releases);

  assert.deepEqual(erreurs(graph), []);
});

test("deux releases actives consécutives modélisent le support N/N−1", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2026-07-10", "2026-08-02"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-08-03", "2026-08-24"],
      }),
    ],
  });
  assert.deepEqual(erreurs(graph), []);

  const troisActives = structuredClone(graph);
  troisActives.releases.push(
    releaseScellee({
      id: "tranche:3",
      tranche: 3,
      etat: "active",
      dates: ["2026-08-25", "2026-09-15"],
    }),
  );
  attendu(erreurs(troisActives), "au plus deux releases actives");

  const nonConsecutives = structuredClone(graph);
  nonConsecutives.releases[1] = releaseScellee({
    id: "tranche:3",
    tranche: 3,
    etat: "active",
    dates: ["2026-08-03", "2026-08-24"],
  });
  attendu(erreurs(nonConsecutives), "tranches consécutives N et N−1");
});

test("le support N/N−1 est borné sur toute la chronologie, pas seulement au sommet", () => {
  const releases = [
    releaseScellee({
      id: "tranche:1",
      tranche: 1,
      etat: "contractee",
      dates: ["2026-01-01", "2026-01-02", "2026-04-03", "2026-04-04"],
    }),
    releaseScellee({
      id: "tranche:2",
      tranche: 2,
      etat: "contractee",
      dates: ["2026-01-02", "2026-01-03", "2026-04-04", "2026-04-05"],
    }),
    releaseScellee({
      id: "tranche:3",
      tranche: 3,
      etat: "active",
      dates: ["2026-01-03", "2026-01-04"],
    }),
  ];
  for (let index = 0; index < 2; index += 1) {
    const release = releases[index];
    release.successeur = releases[index + 1].id;
    const contraction = Date.parse(
      `${release.journal.find((entree) => entree.vers === "contraction").date}T00:00:00Z`,
    );
    scellerUsageContraction(
      release,
      Array.from({ length: 14 }, (_, jour) => ({
        date: new Date(contraction - (14 - jour) * 86400000)
          .toISOString()
          .slice(0, 10),
        pourcentage: 0.2,
      })),
    );
  }
  attendu(erreurs(graphValide({ releases })), "au plus deux releases actives");
});

test("une seule expansion peut exister à tout instant historique", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2026-01-01", "2026-01-10"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-01-02", "2026-01-11"],
      }),
    ],
  });
  attendu(erreurs(graph), "au plus une release en expansion");
});

test("les activations suivent strictement l'ordre temporel des tranches", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2026-08-03", "2026-08-04"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-08-01", "2026-08-02"],
      }),
    ],
  });
  attendu(erreurs(graph), "activation doit être strictement postérieure");
});

test("une exécution partielle scelle E0 puis un échec E1 sans prétendre clore l'expansion", () => {
  const { cible, execution } = executionExpansionPartielle();
  const graph = graphValide({ releases: [cible], executions: [execution] });
  assert.deepEqual(erreurs(graph), []);

  const sequenceBrisee = structuredClone(graph);
  sequenceBrisee.executions[0].evenements[2].contenu.sequence = 5;
  resignerRecu(sequenceBrisee.executions[0].evenements[2]);
  attendu(erreurs(sequenceBrisee), "prolonger sans fork");

  const ajoutApresEchec = structuredClone(graph);
  const evenement = structuredClone(
    ajoutApresEchec.executions[0].evenements[0],
  );
  evenement.id = `recu-execution-${execution.id}-4-etape-fermee`;
  evenement.contenu.id = evenement.id;
  evenement.contenu.sequence = 4;
  evenement.contenu["precedent-evenement-sha256"] =
    ajoutApresEchec.executions[0].evenements[2].sha256;
  resignerRecu(evenement);
  ajoutApresEchec.executions[0].evenements.push(evenement);
  attendu(erreurs(ajoutApresEchec), "prolonger sans fork");

  const nostalgieNostr = structuredClone(graph);
  nostalgieNostr.executions[0].graphe.contenu.topologie["moyens-connexion"] = [
    "nostr-public",
  ];
  attendu(erreurs(nostalgieNostr), "sans Buzz/Nostr public");
});

test("un échec d'exécution lie un budget réellement rouge et son incident causal exact", () => {
  const { cible, execution } = executionExpansionPartielle();

  const sansViolation = graphValide({
    releases: [cible],
    executions: [structuredClone(execution)],
  });
  const evenementSansViolation = sansViolation.executions[0].evenements[2];
  const verdict = evenementSansViolation.contenu["verdicts-metriques"].find(
    (element) => element.nom === "replay-automatique",
  );
  verdict.mesure = 0;
  verdict["borne-superieure-unilaterale-95"] = 0;
  verdict.numerateur = 0;
  verdict.resultat = "vert";
  resignerRecu(evenementSansViolation);
  attendu(erreurs(sansViolation), "exige au moins un verdict rouge");

  const incidentForge = graphValide({
    releases: [cible],
    executions: [structuredClone(execution)],
  });
  const evenementForge = incidentForge.executions[0].evenements[2];
  evenementForge.contenu["incident-sha256"] = "00".repeat(32);
  resignerRecu(evenementForge);
  attendu(
    erreurs(incidentForge),
    "doit désigner exactement un incident embarqué",
  );
});

test("une violation critique est pausée puis quarantainée avec fencing prouvé", () => {
  const { cible, execution } = executionExpansionPartielle({
    natureTerminale: "quarantaine",
  });
  const graph = graphValide({ releases: [cible], executions: [execution] });
  assert.deepEqual(erreurs(graph), []);

  const sansFencing = structuredClone(graph);
  const quarantaine = sansFencing.executions[0].evenements.at(-1);
  quarantaine.contenu.fencing = {
    requis: false,
    applique: false,
    "applique-a": null,
    perimetre: null,
    "preuve-sha256": null,
  };
  resignerRecu(quarantaine);
  attendu(erreurs(sansFencing), "fencing exact, content-addressé");

  const [pause, arret] = execution.evenements.slice(-2);
  assert.equal(
    pause.contenu.instant,
    arret.contenu.instant,
    "pause et quarantaine critiques doivent être causalement immédiates",
  );
  assert.deepEqual(pause.contenu["fenetres-observation"], []);
  assert.deepEqual(arret.contenu["fenetres-observation"], []);

  const detectionTardive = structuredClone(graph);
  for (const evenement of detectionTardive.executions[0].evenements.slice(-2)) {
    const incident = evenement.contenu.incidents[0];
    incident["survenu-a"] = new Date(
      Date.parse(incident["detecte-a"]) - 6 * 60 * 1_000,
    )
      .toISOString()
      .replace(".000Z", "Z");
    evenement.contenu["incident-sha256"] = canonicalSha256(incident);
    resignerRecu(evenement);
  }
  attendu(erreurs(detectionTardive), "détection critique sous cinq minutes");

  const quarantaineTardive = structuredClone(graph);
  const arretTardif = quarantaineTardive.executions[0].evenements.at(-1);
  const detecteA = arretTardif.contenu.incidents[0]["detecte-a"];
  arretTardif.contenu.instant = new Date(Date.parse(detecteA) + 16 * 60 * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
  arretTardif.contenu.fencing["applique-a"] = arretTardif.contenu.instant;
  resignerRecu(arretTardif);
  attendu(erreurs(quarantaineTardive), "quarantainée immédiatement");
});

test("une quarantaine critique journalise honnêtement fencing puis qualification tardive", () => {
  const { cible, execution } = executionExpansionPartielle({
    natureTerminale: "quarantaine",
  });
  const pause = execution.evenements.at(-2);
  const quarantaine = execution.evenements.at(-1);
  const detecteA = pause.contenu.incidents[0]["detecte-a"];
  const appliqueA = new Date(Date.parse(detecteA) + 10 * 60 * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
  const qualifieA = new Date(Date.parse(detecteA) + 31 * 60 * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
  const escaladeA = new Date(Date.parse(detecteA) + 30 * 60 * 1_000)
    .toISOString()
    .replace(".000Z", "Z");

  for (const evenement of [pause, quarantaine]) {
    const incident = evenement.contenu.incidents[0];
    incident["qualifie-a"] = null;
    incident["escalade-a"] = null;
    evenement.contenu["incident-sha256"] = canonicalSha256(incident);
  }
  pause.contenu.fencing = {
    requis: true,
    applique: false,
    "applique-a": null,
    perimetre: pause.contenu.perimetre,
    "preuve-sha256": null,
  };
  resignerRecu(pause);

  quarantaine.contenu.instant = appliqueA;
  quarantaine.contenu["precedent-evenement-sha256"] = pause.sha256;
  quarantaine.contenu.fencing["applique-a"] = appliqueA;
  resignerRecu(quarantaine);

  const qualification = structuredClone(quarantaine);
  qualification.id = `recu-execution-${execution.id}-4-quarantaine`;
  qualification.contenu.id = qualification.id;
  qualification.contenu.sequence = 4;
  qualification.contenu["precedent-evenement-sha256"] = quarantaine.sha256;
  qualification.contenu.instant = qualifieA;
  qualification.contenu.incidents[0]["qualifie-a"] = qualifieA;
  qualification.contenu.incidents[0]["escalade-a"] = escaladeA;
  qualification.contenu["incident-sha256"] = canonicalSha256(
    qualification.contenu.incidents[0],
  );
  resignerRecu(qualification);
  execution.evenements.push(qualification);

  assert.deepEqual(
    erreurs(graphValide({ releases: [cible], executions: [execution] })),
    [],
  );

  const sansEscalade = structuredClone(execution);
  const derniere = sansEscalade.evenements.at(-1);
  derniere.contenu.incidents[0]["escalade-a"] = null;
  derniere.contenu["incident-sha256"] = canonicalSha256(
    derniere.contenu.incidents[0],
  );
  resignerRecu(derniere);
  attendu(
    erreurs(graphValide({ releases: [cible], executions: [sansEscalade] })),
    "qualification du périmètre sous trente minutes",
  );

  const detectionReecrite = structuredClone(execution);
  const derniereReecrite = detectionReecrite.evenements.at(-1);
  const incidentReecrit = derniereReecrite.contenu.incidents[0];
  incidentReecrit["detecte-a"] = new Date(
    Date.parse(incidentReecrit["detecte-a"]) + 60 * 1_000,
  )
    .toISOString()
    .replace(".000Z", "Z");
  incidentReecrit["escalade-a"] = null;
  derniereReecrite.contenu["incident-sha256"] =
    canonicalSha256(incidentReecrit);
  resignerRecu(derniereReecrite);
  attendu(
    erreurs(
      graphValide({ releases: [cible], executions: [detectionReecrite] }),
    ),
    "prolonger exactement l'incident causal",
  );
});

test("une qualification tardive reste fermée et scelle son escalade à trente minutes", () => {
  const { cible, execution } = executionExpansionPartielle({
    natureTerminale: "pause",
  });
  const pause = execution.evenements.at(-1);
  const incident = pause.contenu.incidents[0];
  incident["detecte-a"] = new Date(
    Date.parse(pause.contenu.instant) - 45 * 60 * 1_000,
  )
    .toISOString()
    .replace(".000Z", "Z");
  incident["survenu-a"] = incident["detecte-a"];
  incident["qualifie-a"] = new Date(
    Date.parse(incident["detecte-a"]) + 31 * 60 * 1_000,
  )
    .toISOString()
    .replace(".000Z", "Z");
  incident["escalade-a"] = new Date(
    Date.parse(incident["detecte-a"]) + 30 * 60 * 1_000,
  )
    .toISOString()
    .replace(".000Z", "Z");
  pause.contenu["incident-sha256"] = canonicalSha256(incident);
  resignerRecu(pause);
  assert.deepEqual(
    erreurs(graphValide({ releases: [cible], executions: [execution] })),
    [],
  );

  const sansEscalade = structuredClone(execution);
  const pauseSansEscalade = sansEscalade.evenements.at(-1);
  pauseSansEscalade.contenu.incidents[0]["escalade-a"] = null;
  pauseSansEscalade.contenu["incident-sha256"] = canonicalSha256(
    pauseSansEscalade.contenu.incidents[0],
  );
  resignerRecu(pauseSansEscalade);
  attendu(
    erreurs(graphValide({ releases: [cible], executions: [sansEscalade] })),
    "qualification du périmètre sous trente minutes",
  );
});

test("une exécution reprise jusqu'au succès reste append-only et se ferme sur le Reçu du journal", () => {
  const { cible, execution } = executionExpansionReussie();
  const graph = graphValide({ releases: [cible], executions: [execution] });
  assert.deepEqual(erreurs(graph), []);

  const historiqueTronque = structuredClone(graph);
  historiqueTronque.executions[0].evenements.pop();
  attendu(erreurs(historiqueTronque), "cadence complète doit être close");

  const lienTerminalForge = structuredClone(graph);
  const recuTransition = lienTerminalForge.releases[0].recus.find(
    (recu) => recu.contenu.type === "transition",
  );
  recuTransition.contenu["recu-execution-precedent-sha256"] = "00".repeat(32);
  resignerRecu(recuTransition);
  attendu(erreurs(lienTerminalForge), "clôture réussie doit relier exactement");
});

test("une pause conserve le créneau d'expansion jusqu'à sa consommation explicite", () => {
  const premiere = executionExpansionPartielle({
    natureTerminale: "pause",
  });
  const tete = premiere.execution.evenements.at(-1);
  const precedent = {
    "execution-id": premiere.execution.id,
    "release-id": premiere.execution.graphe.contenu["release-id"],
    "sha-punks": premiere.execution.graphe.contenu.release.sha,
    "graphe-sha256": premiere.execution.graphe.sha256,
    "recu-tete-sha256": tete.sha256,
  };
  const seconde = executionExpansionPartielle({
    cible: premiere.cible,
    suffixe: "2",
    sha: "33".repeat(20),
    instantGraphe: "2026-08-07T14:00:00Z",
    instantDemarrage: "2026-08-07T14:30:00Z",
    instantCadence: "2026-08-11T00:00:00Z",
    instantEtat: "2026-08-07T17:00:00Z",
    precedent,
  });
  attendu(
    erreurs(
      graphValide({
        releases: [premiere.cible],
        executions: [premiere.execution, seconde.execution],
      }),
    ),
    "chevauche",
  );
});

test("une exécution ne peut citer une tête future ni contourner un arrêt terminal", () => {
  const premiere = executionExpansionPartielle();
  const tete = premiere.execution.evenements.at(-1);
  const precedent = {
    "execution-id": premiere.execution.id,
    "release-id": premiere.execution.graphe.contenu["release-id"],
    "sha-punks": premiere.execution.graphe.contenu.release.sha,
    "graphe-sha256": premiere.execution.graphe.sha256,
    "recu-tete-sha256": tete.sha256,
  };
  const future = executionExpansionPartielle({
    cible: premiere.cible,
    suffixe: "future",
    sha: "34".repeat(20),
    instantGraphe: "2026-08-06T15:30:00Z",
    instantDemarrage: "2026-08-06T16:00:00Z",
    instantCadence: "2026-08-10T00:00:00Z",
    instantEtat: "2026-08-06T19:00:00Z",
    precedent,
  });
  attendu(
    erreurs(
      graphValide({
        releases: [premiere.cible],
        executions: [premiere.execution, future.execution],
      }),
    ),
    "événement signé ultérieur",
  );

  const contournement = executionExpansionPartielle({
    cible: premiere.cible,
    suffixe: "contournement",
    sha: "35".repeat(20),
    instantGraphe: "2026-08-07T14:00:00Z",
    instantDemarrage: "2026-08-07T14:30:00Z",
    instantCadence: "2026-08-11T00:00:00Z",
    instantEtat: "2026-08-07T17:00:00Z",
    precedent,
  });
  attendu(
    erreurs(
      graphValide({
        releases: [premiere.cible],
        executions: [premiere.execution, contournement.execution],
      }),
    ),
    "ne peut être consommée que par sa reprise locale ou un roll-forward à E0",
  );
});

test("une reprise exige deux fenêtres vertes complètes après la pause", () => {
  const { cible, execution } = executionExpansionPartielle({
    natureTerminale: "pause",
  });
  const pause = execution.evenements.at(-1);
  const construireReprise = (minutes) => {
    const contenu = structuredClone(pause.contenu);
    const instant = new Date(
      Date.parse(pause.contenu.instant) + minutes * 60_000,
    )
      .toISOString()
      .replace(".000Z", "Z");
    contenu.id = `recu-execution-${execution.id}-3-reprise`;
    contenu.sequence = 3;
    contenu["precedent-evenement-sha256"] = pause.sha256;
    contenu.instant = instant;
    contenu.nature = "reprise";
    contenu.incidents[0].statut = "resolu";
    contenu["incident-sha256"] = canonicalSha256(contenu.incidents[0]);
    const violation = contenu["verdicts-metriques"].find(
      (verdict) => verdict.nom === "replay-automatique",
    );
    violation.mesure = 0;
    violation["borne-superieure-unilaterale-95"] = 0;
    violation.numerateur = 0;
    violation.resultat = "vert";
    contenu["fenetres-observation"] = fenetresObservation({
      fin: instant,
      resultats: ["vert", "vert"],
      incidentId: contenu.incidents[0].id,
    });
    return recuSigne({ id: contenu.id, contenu });
  };

  const repriseValide = structuredClone(execution);
  repriseValide.evenements.push(construireReprise(30));
  assert.deepEqual(
    erreurs(graphValide({ releases: [cible], executions: [repriseValide] })),
    [],
  );

  const reprisePrecipitee = structuredClone(execution);
  reprisePrecipitee.evenements.push(construireReprise(1));
  attendu(
    erreurs(
      graphValide({ releases: [cible], executions: [reprisePrecipitee] }),
    ),
    "doivent commencer après la pause signée",
  );
});

test("l'index PARITY refuse un marqueur de Reçu dupliqué", () => {
  const { cible, execution } = executionExpansionPartielle();
  const graph = graphValide({ releases: [cible], executions: [execution] });
  const entrees = entreesParityDuGraphe(graph);
  assert.ok(entrees.length > 0);
  const source = `${entrees.map((entree) => entree.marqueur).join("\n")}\n${entrees[0].marqueur}\n`;

  attendu(
    validateParityReceiptIndex(graph, source),
    "marqueur de Reçu dupliqué",
  );
});

test("le publisher générique publie les transitions et chaque Reçu d'exécution partielle", async () => {
  const release = releaseScellee({ etat: "expansion" });
  const graphTransition = graphValide({ releases: [release] });
  const entree = release.journal[0];
  const recuTransition = release.recus.find((recu) => recu.id === entree.recu);
  const publicationTransition = optionsPublicationOperationnelle(
    graphTransition,
    recuTransition,
    { releaseId: entree["release-id"], sha: entree.sha },
  );
  publicationTransition.options.attestation = Buffer.from(
    canonicalJson(entree.attestation),
  );
  const resultatTransition = await publierRecuOperationnel(
    publicationTransition.options,
    publicationTransition.frontieres,
  );
  assert.equal(resultatTransition.statut, "publiee");
  assert.equal(resultatTransition.crees.length, 6);

  const partielle = executionExpansionPartielle();
  const graphExecution = graphValide({
    releases: [partielle.cible],
    executions: [partielle.execution],
  });
  const recuDemarrage = partielle.execution["recu-demarrage"];
  const publicationExecution = optionsPublicationOperationnelle(
    graphExecution,
    recuDemarrage,
    {
      releaseId: partielle.execution.graphe.contenu["release-id"],
      sha: partielle.execution.graphe.contenu.release.sha,
    },
  );
  const resultatExecution = await publierRecuOperationnel(
    publicationExecution.options,
    publicationExecution.frontieres,
  );
  assert.equal(resultatExecution.statut, "publiee");
  assert.equal(resultatExecution.crees.length, 3);

  const evenement = partielle.execution.evenements[0];
  const publicationEvenement = optionsPublicationOperationnelle(
    graphExecution,
    evenement,
    {
      releaseId: partielle.execution.graphe.contenu["release-id"],
      sha: partielle.execution.graphe.contenu.release.sha,
    },
  );
  const resultatEvenement = await publierRecuOperationnel(
    publicationEvenement.options,
    publicationEvenement.frontieres,
  );
  assert.equal(resultatEvenement.statut, "publiee");
  assert.equal(resultatEvenement.crees.length, 3);
});

test("le publisher générique publie une supersession et son Reçu durable", async () => {
  const release = releaseScellee({
    etat: "expansion",
    dates: ["2026-08-01"],
  });
  const invalidation = invalidationAttestation({ release });
  const graph = graphValide({
    releases: [release],
    "invalidations-attestations": [invalidation],
  });
  const publication = optionsPublicationOperationnelle(
    graph,
    invalidation.recu,
    {
      releaseId: invalidation["release-id"],
      sha: invalidation["sha-punks"],
    },
  );
  publication.options.attestation = Buffer.from(
    canonicalJson(invalidation["attestation-supersedante"]),
  );
  const resultat = await publierRecuOperationnel(
    publication.options,
    publication.frontieres,
  );
  assert.equal(resultat.statut, "publiee");
  assert.equal(resultat.crees.length, 6);
  assert.ok(
    entreesParityDuGraphe(graph).some(
      (entree) => entree.id === invalidation.recu.id,
    ),
  );
});

test("le CLI générique publie un Reçu signé depuis le graphe validé", async () => {
  const partielle = executionExpansionPartielle();
  const graph = graphValide({
    releases: [partielle.cible],
    executions: [partielle.execution],
  });
  const recu = partielle.execution["recu-demarrage"];
  const sha = partielle.execution.graphe.contenu.release.sha;
  const releaseId = partielle.execution.graphe.contenu["release-id"];
  const publication = optionsPublicationOperationnelle(graph, recu, {
    releaseId,
    sha,
  });
  const temp = mkdtempSync(join(tmpdir(), "punks-receipt-publish-"));
  const cheminGraphe = join(temp, "release-graph.json");
  const cheminRecu = join(temp, "receipt.json");
  const cheminParity = join(temp, "PARITY.md");
  writeFileSync(cheminGraphe, canonicalJson(graph), { flag: "wx" });
  writeFileSync(cheminRecu, canonicalJson(recu), { flag: "wx" });
  writeFileSync(cheminParity, publication.options.parity, { flag: "wx" });
  const sorties = [];
  const erreursCli = [];
  const r2 = publication.options.r2;
  const code = await executerCliPublicationRecu(
    [
      "--graphe",
      cheminGraphe,
      "--recu",
      cheminRecu,
      "--parity",
      cheminParity,
      "--depot",
      "punksbot/punksbot",
      "--tag",
      `punks-staging-${sha}`,
      "--sha",
      sha,
      "--release-id",
      releaseId,
      "--etat-release",
      "published",
      "--r2-primaire",
      `${r2[0].compte}/${r2[0].bucket}`,
      "--r2-secondaire",
      `${r2[1].compte}/${r2[1].bucket}`,
    ],
    {
      frontieres: publication.frontieres,
      ecrireSortie: (ligne) => sorties.push(ligne),
      ecrireErreur: (ligne) => erreursCli.push(ligne),
    },
  );
  assert.equal(code, 0);
  assert.deepEqual(erreursCli, []);
  assert.equal(JSON.parse(sorties[0]).recu.id, recu.id);
});

test("un roll-forward consomme exactement la tête d'une expansion partielle échouée", async () => {
  const { cible, execution } = executionExpansionPartielle();
  const instant = "2026-09-01T12:00:00Z";
  const sha = "32".repeat(20);
  const releaseId = "tranche:1/roll-forward/apres-echec-e1";
  const recuTete = execution.evenements.at(-1);
  const lienPrecedent = {
    "graphe-sha256": execution.graphe.sha256,
    "recu-sha256": recuTete.sha256,
  };
  const executionPrecedente = {
    "execution-id": execution.id,
    "release-id": execution.graphe.contenu["release-id"],
    "sha-punks": execution.graphe.contenu.release.sha,
    "graphe-sha256": execution.graphe.sha256,
    "recu-tete-sha256": recuTete.sha256,
  };
  const deploiement = "deployment-roll-forward-apres-echec-e1";
  const candidat = candidatPhase({
    id: cible.id,
    tranche: cible.tranche,
    phase: "active",
    sha,
    deploiement,
    lignesRegistre: [],
  });
  const topologie = topologiePhase({ id: cible.id, phase: "active", sha });
  const contenuNouveau = {
    schema: "punks.release-graph-snapshot.v1",
    tranche: cible.tranche,
    phase: "active",
    instant: instantScellementCadence("roll-forward", instant, topologie),
    "release-id": releaseId,
    deploiement,
    redemarrage: "E0",
    precedent: lienPrecedent,
    "contraction-punks": null,
    topologie,
    release: candidat,
  };
  const nouveau = contenuAdresse(contenuNouveau);
  const charge = contenuRecuOperationnel({
    entree: {
      vers: "active",
      instant,
      "release-id": releaseId,
      "attestation-sha256": "00".repeat(32),
      precedent: lienPrecedent,
      graphe: nouveau,
    },
    instantane: { contenu: contenuNouveau },
    type: "roll-forward",
  });
  const recu = recuSigne({
    id: `recu-roll-forward-tranche-1-${sha}`,
    contenu: {
      ...charge,
      cible: cible.id,
      "execution-precedente": executionPrecedente,
    },
  });
  const recuperation = {
    date: instant.slice(0, 10),
    instant,
    type: "roll-forward",
    depuis: cible.id,
    cible: cible.id,
    "execution-precedente": executionPrecedente,
    graphes: { precedent: execution.graphe, nouveau },
    redemarrage: "E0",
    recu,
  };
  recuperation["engagement-recuperation"] = engagementRecuperationPour(
    execution,
    instant,
  );
  recuperation.recu.contenu["engagement-recuperation-sha256"] = canonicalSha256(
    recuperation["engagement-recuperation"],
  );
  const executionRollForward = executionReussiePourRollForward(
    cible,
    recuperation,
  );
  const graph = graphValide({
    releases: [cible],
    executions: [execution, executionRollForward],
    recuperations: [recuperation],
  });
  assert.deepEqual(erreurs(graph), []);

  const recuRollForwardImplicite = structuredClone(graph);
  recuRollForwardImplicite.recuperations[0].recu.contenu.exception = true;
  resignerRecu(recuRollForwardImplicite.recuperations[0].recu);
  attendu(
    erreurs(recuRollForwardImplicite),
    "Reçu opérationnel à schéma fermé",
  );

  const recuRetraitNouveau = nouveau.contenu.release.recus.find(
    (element) => element.contenu.type === "retrait",
  );
  const publicationRetrait = optionsPublicationOperationnelle(
    graph,
    recuRetraitNouveau,
    { releaseId: cible.id, sha },
  );
  const resultatRetrait = await publierRecuOperationnel(
    publicationRetrait.options,
    publicationRetrait.frontieres,
  );
  assert.equal(resultatRetrait.statut, "publiee");

  const teteTronquee = structuredClone(graph);
  teteTronquee.recuperations[0]["execution-precedente"]["recu-tete-sha256"] =
    "00".repeat(32);
  attendu(erreurs(teteTronquee), "identité complète de l'exécution partielle");

  const sansPauseNiEchec = structuredClone(graph);
  sansPauseNiEchec.executions[0].evenements.pop();
  sansPauseNiEchec.executions[0].evenements.pop();
  attendu(erreurs(sansPauseNiEchec), "pausée, échouée ou mise en quarantaine");

  const sansEscaladeQuatreHeures = structuredClone(graph);
  sansEscaladeQuatreHeures.recuperations[0]["engagement-recuperation"][
    "escalade-depassement-sha256"
  ] = null;
  attendu(
    erreurs(sansEscaladeQuatreHeures),
    "engagement ciblé signé sous quatre heures",
  );
});

test("un engagement de récupération ne peut pas être signé après le retour qu'il autorise", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
  });
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  cible.successeur = reference.id;
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const releases = [cible, reference];
  const executionsScellees = executionsConnuesPour(releases);
  const precedent = descripteurExecutionFixture(
    teteExecutionFixture(
      executionsScellees.filter(
        (execution) => execution.cible === reference.id,
      ),
      "2026-06-10T08:30:00Z",
    ),
    releases,
  );
  const { execution } = executionExpansionPartielle({
    cible: reference,
    suffixe: "engagement-futur",
    instantGraphe: "2026-06-10T08:00:00Z",
    instantDemarrage: "2026-06-10T08:30:00Z",
    instantCadence: "2026-06-13T18:00:00Z",
    instantEtat: "2026-06-10T11:00:00Z",
    natureTerminale: "quarantaine",
    precedent,
  });
  const instant = "2026-06-10T12:00:00Z";
  const certificat = certificatComplet({
    cible,
    reference,
    date: "2026-06-10",
    grapheReference: execution.graphe,
  });
  const recuperation = {
    date: "2026-06-10",
    instant,
    type: "retour-punks",
    cible: cible.id,
    "execution-precedente": descripteurExecutionFixture(execution, releases),
    certificat,
    "engagement-recuperation": engagementRecuperationPour(execution, instant),
  };
  certificat.recu.contenu["engagement-recuperation-sha256"] = canonicalSha256(
    recuperation["engagement-recuperation"],
  );
  resignerCertificat(certificat);

  const graph = graphValide({
    releases,
    executions: [...executionsScellees, execution],
    recuperations: [recuperation],
  });
  assert.ok(
    Date.parse(recuperation["engagement-recuperation"]["engage-a"]) >
      Date.parse(recuperation.instant),
    "la fixture doit matérialiser un engagement antidaté par rapport au retour",
  );
  attendu(erreurs(graph), "engagement ciblé signé sous quatre heures");

  const engagementChronologique = structuredClone(graph);
  engagementChronologique.recuperations[0]["engagement-recuperation"][
    "engage-a"
  ] = "2026-06-10T11:30:00Z";
  engagementChronologique.recuperations[0].certificat.recu.contenu[
    "engagement-recuperation-sha256"
  ] = canonicalSha256(
    engagementChronologique.recuperations[0]["engagement-recuperation"],
  );
  resignerCertificat(engagementChronologique.recuperations[0].certificat);
  assert.deepEqual(erreurs(engagementChronologique), []);

  const qualificationAbsente = structuredClone(engagementChronologique);
  const executionCritique = qualificationAbsente.executions.at(-1);
  const pauseCritique = executionCritique.evenements.at(-2);
  const quarantaineCritique = executionCritique.evenements.at(-1);
  for (const evenement of [pauseCritique, quarantaineCritique]) {
    const incident = evenement.contenu.incidents[0];
    incident["qualifie-a"] = null;
    incident["escalade-a"] = null;
    evenement.contenu["incident-sha256"] = canonicalSha256(incident);
  }
  resignerRecu(pauseCritique);
  quarantaineCritique.contenu["precedent-evenement-sha256"] =
    pauseCritique.sha256;
  resignerRecu(quarantaineCritique);
  qualificationAbsente.recuperations[0]["execution-precedente"] =
    descripteurExecutionFixture(executionCritique, releases);
  qualificationAbsente.recuperations[0]["engagement-recuperation"] =
    engagementRecuperationPour(executionCritique, instant);
  qualificationAbsente.recuperations[0]["engagement-recuperation"]["engage-a"] =
    "2026-06-10T11:30:00Z";
  qualificationAbsente.recuperations[0].certificat.recu.contenu[
    "engagement-recuperation-sha256"
  ] = canonicalSha256(
    qualificationAbsente.recuperations[0]["engagement-recuperation"],
  );
  resignerCertificat(qualificationAbsente.recuperations[0].certificat);
  attendu(
    erreurs(qualificationAbsente),
    "engagement ciblé signé sous quatre heures",
  );
});

test("le roll-forward rejoue E0 à E4 puis A0 à A4 sur un nouveau graphe", () => {
  const source = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "active",
    dates: ["2026-07-01", "2026-07-21"],
  });
  const instant = "2026-08-20T12:00:00Z";
  const releaseId = "tranche:1/roll-forward/2026-08-20T12:00:00Z";
  const precedent = structuredClone(
    source.journal.find((entree) => entree.vers === "active").graphe,
  );
  const entreeActive = source.journal.find(
    (entree) => entree.vers === "active",
  );
  const recuActif = source.recus.find((recu) => recu.id === entreeActive.recu);
  const lienActif = {
    "graphe-sha256": precedent.sha256,
    "recu-sha256": recuActif.sha256,
  };
  const deploiement = `deployment-roll-forward-${SHA_ROLL_FORWARD.slice(0, 8)}`;
  const candidat = candidatPhase({
    id: source.id,
    tranche: source.tranche,
    phase: "active",
    sha: SHA_ROLL_FORWARD,
    deploiement,
    lignesRegistre: [],
  });
  const topologieFinale = topologiePhase({
    id: source.id,
    phase: "active",
    sha: SHA_ROLL_FORWARD,
  });
  const contenuNouveau = {
    schema: "punks.release-graph-snapshot.v1",
    tranche: source.tranche,
    "release-id": releaseId,
    phase: "active",
    instant: instantScellementCadence("roll-forward", instant, topologieFinale),
    deploiement,
    redemarrage: "E0",
    precedent: lienActif,
    "contraction-punks": null,
    topologie: topologieFinale,
    release: candidat,
  };
  const nouveau = contenuAdresse(contenuNouveau);
  const chargeOperationnelle = contenuRecuOperationnel({
    entree: {
      vers: "active",
      instant,
      "release-id": releaseId,
      "attestation-sha256": "00".repeat(32),
      precedent: lienActif,
      graphe: nouveau,
    },
    instantane: { contenu: contenuNouveau },
    type: "roll-forward",
  });
  const recu = recuSigne({
    id: `recu-roll-forward-tranche-1-${SHA_ROLL_FORWARD}`,
    contenu: {
      ...chargeOperationnelle,
      type: "roll-forward",
      cible: source.id,
      instant,
      "release-id": releaseId,
      "graphe-sha256": nouveau.sha256,
    },
  });
  const recuperation = {
    date: "2026-08-20",
    instant,
    type: "roll-forward",
    depuis: source.id,
    cible: source.id,
    graphes: { precedent, nouveau },
    redemarrage: "E0",
    recu,
  };
  const executionsSource = EXECUTIONS_SCELLEES.get(source) ?? [];
  const executionPrecedente = descripteurExecutionFixture(
    teteExecutionFixture(executionsSource, instant),
    [source],
  );
  recuperation["execution-precedente"] = executionPrecedente;
  recuperation.recu.contenu["execution-precedente"] =
    structuredClone(executionPrecedente);
  const executionRollForward = executionReussiePourRollForward(
    source,
    recuperation,
  );
  const graph = graphValide({
    releases: [source],
    executions: [...executionsSource, executionRollForward],
    recuperations: [recuperation],
  });
  assert.deepEqual(erreurs(graph), []);

  const expositionTerminaleInvalide = structuredClone(graph);
  expositionTerminaleInvalide.recuperations[0].graphes.nouveau.contenu.topologie.workers[0].pourcentage = 10;
  attendu(erreurs(expositionTerminaleInvalide), "Workers à 100 %");

  const memeGraphe = structuredClone(graph);
  memeGraphe.recuperations[0].graphes.nouveau = structuredClone(
    memeGraphe.recuperations[0].graphes.precedent,
  );
  attendu(erreurs(memeGraphe), "nouveau graphe scellé distinct");

  const hashDecoratif = structuredClone(graph);
  hashDecoratif.recuperations[0].graphes.nouveau.contenu.phase = "expansion";
  attendu(erreurs(hashDecoratif), "hash canonique du contenu");

  const sansE0 = structuredClone(graph);
  sansE0.recuperations[0].redemarrage = "E1";
  attendu(erreurs(sansE0), "redémarrer à E0");

  const expansionAncienne = structuredClone(graph);
  expansionAncienne.recuperations[0].graphes.nouveau.contenu.instant =
    "2026-08-09T12:00:00Z";
  expansionAncienne.recuperations[0].graphes.nouveau.sha256 = canonicalSha256(
    expansionAncienne.recuperations[0].graphes.nouveau.contenu,
  );
  attendu(erreurs(expansionAncienne), "nouveau graphe exacts");

  const memeCandidat = structuredClone(graph);
  memeCandidat.recuperations[0].graphes.nouveau.contenu.release.sha =
    source.sha;
  memeCandidat.recuperations[0].graphes.nouveau.sha256 = canonicalSha256(
    memeCandidat.recuperations[0].graphes.nouveau.contenu,
  );
  attendu(erreurs(memeCandidat), "jamais Buzz ni un candidat historique");

  const ancienCandidatExpansion = structuredClone(graph);
  ancienCandidatExpansion.recuperations[0].graphes.nouveau.contenu.release.sha =
    source.journal[0].sha;
  ancienCandidatExpansion.recuperations[0].graphes.nouveau.sha256 =
    canonicalSha256(
      ancienCandidatExpansion.recuperations[0].graphes.nouveau.contenu,
    );
  attendu(
    erreurs(ancienCandidatExpansion),
    "jamais Buzz ni un candidat historique",
  );

  const baselineInterdite = structuredClone(graph);
  baselineInterdite.recuperations[0].graphes.nouveau.contenu.release.sha =
    BASELINE_BUZZ;
  baselineInterdite.recuperations[0].graphes.nouveau.sha256 = canonicalSha256(
    baselineInterdite.recuperations[0].graphes.nouveau.contenu,
  );
  attendu(erreurs(baselineInterdite), "jamais Buzz ni un candidat historique");

  const grapheIncomplet = structuredClone(graph);
  delete grapheIncomplet.recuperations[0].graphes.nouveau.contenu.release
    .materiaux.schemas;
  grapheIncomplet.recuperations[0].graphes.nouveau.sha256 = canonicalSha256(
    grapheIncomplet.recuperations[0].graphes.nouveau.contenu,
  );
  attendu(erreurs(grapheIncomplet), "materiaux.schemas manquant");

  const releaseIdRejoue = structuredClone(graph);
  releaseIdRejoue.recuperations[0].graphes.nouveau.contenu["release-id"] =
    precedent.contenu["release-id"];
  releaseIdRejoue.recuperations[0].graphes.nouveau.sha256 = canonicalSha256(
    releaseIdRejoue.recuperations[0].graphes.nouveau.contenu,
  );
  attendu(erreurs(releaseIdRejoue), "release-id de roll-forward distinct");
});

test("un retour Punks antérieur exige un certificat de compatibilité exact", () => {
  const graph = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "contraction",
        dates: ["2026-01-01", "2026-01-21", "2026-06-01"],
        lignesRegistre: [],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2026-02-01", "2026-02-21"],
      }),
    ],
  });
  graph.releases[0].successeur = "tranche:2";
  scellerUsageContraction(
    graph.releases[0],
    Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  graph.executions = executionsConnuesPour(graph.releases);
  const certificatValide = certificatComplet({
    cible: graph.releases[0],
    reference: graph.releases[1],
    date: "2026-06-10",
  });
  const avecCertificat = structuredClone(graph);
  avecCertificat.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:1",
      "execution-precedente": null,
      certificat: certificatValide,
    },
  ];
  assert.deepEqual(erreurs(avecCertificat), []);
  const referenceNonActive = structuredClone(graph);
  referenceNonActive.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:1",
      "execution-precedente": null,
      certificat: {
        ...certificatValide,
        "verifie-contre": "tranche:1",
      },
    },
  ];
  attendu(
    erreurs(referenceNonActive),
    "release active de référence à l'instant du retour",
  );
  const cibleNonAnterieure = structuredClone(graph);
  cibleNonAnterieure.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:2",
      "execution-precedente": null,
      certificat: certificatValide,
    },
  ];
  attendu(
    erreurs(cibleNonAnterieure),
    "doit viser une version Punks antérieure",
  );
  const sansCertificat = structuredClone(graph);
  sansCertificat.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:1",
      "execution-precedente": null,
    },
  ];
  attendu(erreurs(sansCertificat), "sans certificat de compatibilité");
  const certificatDivergent = structuredClone(graph);
  certificatDivergent.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:1",
      "execution-precedente": null,
      certificat: { ...certificatValide, contrats: 9 },
    },
  ];
  attendu(erreurs(certificatDivergent), "version exacte du registre");
  const donneesNonProuvees = structuredClone(graph);
  donneesNonProuvees.recuperations = [
    {
      date: "2026-06-10",
      instant: "2026-06-10T12:00:00Z",
      type: "retour-punks",
      cible: "tranche:1",
      "execution-precedente": null,
      certificat: { ...certificatValide, "compatibilite-donnees": false },
    },
  ];
  attendu(erreurs(donneesNonProuvees), "compatibilite-donnees");
});

test("le certificat recalcule les treize contrôles obligatoires et produit un nouveau Reçu", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
  });
  cible.successeur = "tranche:2";
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  const certificat = certificatComplet({
    cible,
    reference,
    date: "2026-06-10",
  });
  const graph = graphValide({
    releases: [cible, reference],
    recuperations: [
      {
        date: "2026-06-10",
        instant: "2026-06-10T12:00:00Z",
        type: "retour-punks",
        cible: cible.id,
        certificat,
      },
    ],
  });
  assert.deepEqual(erreurs(graph), []);

  const recuperationAvecChampImplicite = structuredClone(graph);
  recuperationAvecChampImplicite.recuperations[0]["retour-buzz"] = true;
  attendu(
    erreurs(recuperationAvecChampImplicite),
    "récupération à schéma fermé",
  );

  const certificatAvecChampImplicite = structuredClone(graph);
  certificatAvecChampImplicite.recuperations[0].certificat[
    "compatibilite-magique"
  ] = true;
  attendu(
    erreurs(certificatAvecChampImplicite),
    "certificat de compatibilité à schéma fermé",
  );

  const recuAvecChampImplicite = structuredClone(graph);
  recuAvecChampImplicite.recuperations[0].certificat.recu.contenu[
    "exception-implicite"
  ] = true;
  resignerCertificat(recuAvecChampImplicite.recuperations[0].certificat);
  attendu(erreurs(recuAvecChampImplicite), "Reçu d'éligibilité à schéma fermé");

  const securiteAvecRedirectionBuzz = structuredClone(graph);
  const controleSecurite =
    securiteAvecRedirectionBuzz.recuperations[0].certificat.controles.find(
      (controle) =>
        controle.controle === "securite-isolation-effacement-sans-buzz",
    );
  controleSecurite.preuve.details["redirection-buzz"] = true;
  resignerCertificat(securiteAvecRedirectionBuzz.recuperations[0].certificat);
  attendu(
    erreurs(securiteAvecRedirectionBuzz),
    "ne prouve pas son invariant exact",
  );

  for (const controle of CONTROLES_CERTIFICAT) {
    const incomplet = structuredClone(graph);
    incomplet.recuperations[0].certificat.controles =
      certificat.controles.filter((preuve) => preuve.controle !== controle);
    attendu(erreurs(incomplet), `contrôle obligatoire « ${controle} »`);
  }

  const nonRecalcule = structuredClone(graph);
  nonRecalcule.recuperations[0].certificat["calcule-a"] =
    "2026-06-10T11:59:59Z";
  attendu(erreurs(nonRecalcule), "recalculé à l'instant exact du retour");

  const instantNonCanonique = structuredClone(graph);
  instantNonCanonique.recuperations[0].instant = "2026-06-10T14:00:00+02:00";
  instantNonCanonique.recuperations[0].certificat["calcule-a"] =
    instantNonCanonique.recuperations[0].instant;
  instantNonCanonique.recuperations[0].certificat.recu.contenu.instant =
    instantNonCanonique.recuperations[0].instant;
  attendu(erreurs(instantNonCanonique), "instant UTC canonique");

  const digestDivergent = structuredClone(graph);
  digestDivergent.recuperations[0].certificat["digests-production"].bundle =
    "00".repeat(32);
  attendu(erreurs(digestDivergent), "digests production originaux");

  const profilsIncomplets = structuredClone(graph);
  profilsIncomplets.recuperations[0].certificat["profils-actifs"] = [];
  attendu(erreurs(profilsIncomplets), "tous les profils desktop actifs");

  const controleNonVert = structuredClone(graph);
  controleNonVert.recuperations[0].certificat.controles[0].preuve.resultat =
    "rouge";
  attendu(erreurs(controleNonVert), "preuve verte exacte");

  const recuSansIdentifiants = structuredClone(graph);
  recuSansIdentifiants.recuperations[0].certificat.recu.contenu[
    "identifiants-cloudflare"
  ] = [];
  attendu(erreurs(recuSansIdentifiants), "identifiants Cloudflare actuels");

  const versionDoInventee = structuredClone(graph);
  const controleDo =
    versionDoInventee.recuperations[0].certificat.controles.find(
      (controle) => controle.controle === "versions-etat-durable-objects",
    );
  controleDo.preuve.details.versions[0].version = 999;
  resignerCertificat(versionDoInventee.recuperations[0].certificat);
  attendu(erreurs(versionDoInventee), "ne prouve pas son invariant exact");

  const generationR2Inventee = structuredClone(graph);
  const controleR2 =
    generationR2Inventee.recuperations[0].certificat.controles.find(
      (controle) => controle.controle === "formats-r2-tombstones-generations",
    );
  controleR2.preuve.details["generation-effacement"] = 999;
  resignerCertificat(generationR2Inventee.recuperations[0].certificat);
  attendu(erreurs(generationR2Inventee), "ne prouve pas son invariant exact");

  const generationSessionInventee = structuredClone(graph);
  const controleGenerations =
    generationSessionInventee.recuperations[0].certificat.controles.find(
      (controle) =>
        controle.controle === "generations-secrets-attestation-sessions",
    );
  controleGenerations.preuve.details["generation-recuperation-sessions"] = 999;
  resignerCertificat(generationSessionInventee.recuperations[0].certificat);
  attendu(
    erreurs(generationSessionInventee),
    "ne prouve pas son invariant exact",
  );

  const identifiantCloudflareInvente = structuredClone(graph);
  identifiantCloudflareInvente.recuperations[0].certificat.recu.contenu[
    "identifiants-cloudflare"
  ][0].id = "bogus";
  resignerRecu(identifiantCloudflareInvente.recuperations[0].certificat.recu);
  attendu(
    erreurs(identifiantCloudflareInvente),
    "identifiants Cloudflare actuels",
  );

  const recuSansDeuxApprobateurs = structuredClone(graph);
  recuSansDeuxApprobateurs.recuperations[0].certificat.recu.contenu.approbateurs =
    ["ops:alice"];
  attendu(erreurs(recuSansDeuxApprobateurs), "deux approbateurs distincts");

  const recuNonLie = structuredClone(graph);
  const controleRecu = recuNonLie.recuperations[0].certificat.controles.at(-1);
  controleRecu.preuve.details["recu-sha256"] = "97".repeat(32);
  controleRecu["preuve-sha256"] = canonicalSha256(controleRecu.preuve);
  attendu(erreurs(recuNonLie), "ne prouve pas son invariant exact");

  const preuveAlteree = structuredClone(graph);
  preuveAlteree.recuperations[0].certificat.controles[0].preuve.details.bundle =
    "98".repeat(32);
  attendu(
    erreurs(preuveAlteree),
    "hash canonique du contenu de preuve divergent",
  );

  const preuveRehasheeSansNouveauRecu = structuredClone(graph);
  const controleRehashe =
    preuveRehasheeSansNouveauRecu.recuperations[0].certificat.controles[0];
  controleRehashe.preuve.details.bundle = "99".repeat(32);
  controleRehashe["preuve-sha256"] = canonicalSha256(controleRehashe.preuve);
  attendu(
    erreurs(preuveRehasheeSansNouveauRecu),
    "signer le noyau canonique des douze preuves",
  );

  const recuRejoue = structuredClone(graph);
  recuRejoue.recuperations.push(structuredClone(recuRejoue.recuperations[0]));
  attendu(erreurs(recuRejoue), "Reçu d'éligibilité de récupération dupliqué");
});

test("une invalidation future ne réécrit pas rétroactivement un certificat antérieur", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
  });
  cible.successeur = "tranche:2";
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  const certificat = certificatComplet({
    cible,
    reference,
    date: "2026-06-10",
  });
  const invalidationFuture = invalidationAttestation({
    release: cible,
    transition: "contraction",
    nature: "revocation-materielle-non-critique",
    instant: "2026-09-01T12:00:00Z",
  });
  const graph = graphValide({
    releases: [cible, reference],
    "invalidations-attestations": [invalidationFuture],
    recuperations: [
      {
        date: "2026-06-10",
        instant: "2026-06-10T12:00:00Z",
        type: "retour-punks",
        cible: cible.id,
        certificat,
      },
    ],
  });
  assert.deepEqual(erreurs(graph), []);
});

test("la release active de référence est évaluée à l'instant du retour", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
  });
  cible.successeur = "tranche:2";
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "contraction",
    dates: ["2026-02-01", "2026-02-21", "2027-04-03"],
  });
  reference.successeur = "tranche:3";
  scellerUsageContraction(
    reference,
    Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse("2027-03-18T00:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const activeActuelle = releaseScellee({
    id: "tranche:3",
    tranche: 3,
    etat: "active",
    dates: ["2026-12-10", "2027-01-01"],
  });
  const certificat = certificatComplet({
    cible,
    reference,
    date: "2026-06-10",
  });
  const graph = graphValide({
    releases: [cible, reference, activeActuelle],
    recuperations: [
      {
        date: "2026-06-10",
        instant: "2026-06-10T12:00:00Z",
        type: "retour-punks",
        cible: cible.id,
        certificat,
      },
    ],
  });
  assert.deepEqual(erreurs(graph), []);

  const antedate = structuredClone(graph);
  antedate.recuperations[0].date = "2026-02-10";
  antedate.recuperations[0].instant = "2026-02-10T12:00:00Z";
  antedate.recuperations[0].certificat = certificatComplet({
    cible,
    reference,
    date: "2026-02-10",
  });
  attendu(
    erreurs(antedate),
    "release active de référence à l'instant du retour",
  );

  const snapshotFutur = structuredClone(graph);
  snapshotFutur.recuperations = [
    {
      date: "2026-03-01",
      instant: "2026-03-01T12:00:00Z",
      type: "retour-punks",
      cible: cible.id,
      certificat: certificatComplet({
        cible,
        reference,
        date: "2026-03-01",
        phaseCible: "contraction",
      }),
    },
  ];
  attendu(
    erreurs(snapshotFutur),
    "snapshot candidat exact réellement déployé à l'instant du retour",
  );
});

test("une récupération ne peut viser qu'une release déjà activée à son instant", () => {
  const jamaisActivee = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "expansion",
    dates: ["2026-01-01"],
  });
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-02"],
  });
  const graph = graphValide({
    releases: [jamaisActivee, reference],
    recuperations: [
      {
        date: "2026-03-01",
        instant: "2026-03-01T12:00:00Z",
        type: "retour-punks",
        cible: jamaisActivee.id,
      },
    ],
  });
  attendu(
    erreurs(graph),
    "retour Punks ne peut viser qu'une release déjà activée",
  );

  const future = graphValide({
    releases: [
      releaseScellee({
        id: "tranche:1",
        tranche: 1,
        etat: "active",
        dates: ["2027-01-01", "2027-01-02"],
      }),
      releaseScellee({
        id: "tranche:2",
        tranche: 2,
        etat: "active",
        dates: ["2027-01-03", "2027-01-04"],
      }),
    ],
    recuperations: [
      {
        date: "2026-12-01",
        instant: "2026-12-01T12:00:00Z",
        type: "retour-punks",
        cible: "tranche:1",
      },
    ],
  });
  attendu(
    erreurs(future),
    "retour Punks ne peut viser qu'une release déjà activée",
  );
});

test("les profils clients supportés restent indépendants de l'éligibilité backend", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
    profil: {
      id: "desktop-social-loop@legacy",
      version: 7,
      sha256: "ab".repeat(32),
    },
  });
  cible.successeur = "tranche:2";
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const reference = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  const certificat = certificatComplet({
    cible,
    reference,
    date: "2026-06-10",
    profils: [cible, reference],
  });
  const graph = graphValide({
    releases: [cible, reference],
    recuperations: [
      {
        date: "2026-06-10",
        instant: "2026-06-10T12:00:00Z",
        type: "retour-punks",
        cible: cible.id,
        certificat,
      },
    ],
  });
  assert.deepEqual(erreurs(graph), []);

  const profilContracteOmis = structuredClone(graph);
  profilContracteOmis.recuperations[0].certificat["profils-actifs"] =
    profilsActifs(reference);
  attendu(erreurs(profilContracteOmis), "chronologie client indépendante");
});

test("la chronologie conserve le profil de toute activation historique", () => {
  const ancienne = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
    profil: {
      id: "desktop-social-loop@historique",
      version: 4,
      sha256: "bc".repeat(32),
    },
  });
  ancienne.successeur = "tranche:2";
  scellerUsageContraction(
    ancienne,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const courante = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  const graph = graphValide({ releases: [ancienne, courante] });
  assert.deepEqual(erreurs(graph), []);
  graph["profils-supportes"] = graph["profils-supportes"].filter(
    (profil) => profil.id !== "desktop-social-loop@historique",
  );
  attendu(erreurs(graph), "profil réellement activé");
});

test("le profil actif historique vient du snapshot active et couvre jusqu'à la contraction", () => {
  const profilActif = {
    id: "desktop-active-historique",
    version: 2,
    sha256: "ca".repeat(32),
  };
  const profilContraction = {
    id: "desktop-contraction",
    version: 3,
    sha256: "cb".repeat(32),
  };
  const ancienne = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-06-01", "2026-06-03"],
    profilsParPhase: {
      expansion: profilActif,
      active: profilActif,
      contraction: profilContraction,
    },
  });
  ancienne.successeur = "tranche:2";
  scellerUsageContraction(
    ancienne,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-05-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const courante = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-02-01", "2026-02-21"],
  });
  const graph = graphValide({ releases: [ancienne, courante] });
  assert.deepEqual(erreurs(graph), []);

  const intervalleActif = graph["profils-supportes"].find(
    (profil) => profil.id === profilActif.id,
  );
  assert.ok(intervalleActif);
  intervalleActif["accepte-jusqua"] = "2026-05-01T00:00:00Z";
  attendu(erreurs(graph), "couvrir sans trou toute sa durée backend");
});

test("la référence historique utilise l'instant exact même le jour d'une activation", () => {
  const cible = releaseScellee({
    id: "tranche:1",
    tranche: 1,
    etat: "contractee",
    dates: ["2026-01-01", "2026-01-21", "2026-08-01", "2026-08-02"],
  });
  cible.successeur = "tranche:2";
  scellerUsageContraction(
    cible,
    Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.parse("2026-07-16T00:00:00Z") + index * 86400000)
        .toISOString()
        .slice(0, 10),
      pourcentage: 0.2,
    })),
  );
  const referenceMidi = releaseScellee({
    id: "tranche:2",
    tranche: 2,
    etat: "active",
    dates: ["2026-04-10", "2026-05-01"],
  });
  const activeLeSoir = releaseScellee({
    id: "tranche:3",
    tranche: 3,
    etat: "active",
    dates: ["2026-07-20", "2026-08-10"],
  });
  deplacerInstantTransition(activeLeSoir, "active", "2026-08-10T18:00:00Z");
  const graph = graphValide({
    releases: [cible, referenceMidi, activeLeSoir],
    recuperations: [
      {
        date: "2026-08-10",
        instant: "2026-08-10T12:00:00Z",
        type: "retour-punks",
        cible: cible.id,
        certificat: certificatComplet({
          cible,
          reference: referenceMidi,
          date: "2026-08-10",
        }),
      },
    ],
  });
  assert.deepEqual(erreurs(graph), []);
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
