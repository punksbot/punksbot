/**
 * Tests du harnais d'acceptation d'une promotion Punks (issue #52).
 *
 * Prouve chaque règle de la couture d'acceptation : liaison sans ambiguïté
 * SHA/artefacts/staging, parcours distribué sans Vite ni façade, matrice de
 * plateformes avec vérifications d'artefact, fautes injectées avec preuves de
 * récupération, accessibilité, goldens, retrait, scans legacy, gates
 * d'autorisation et émission create-only de l'attestation immuable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign as signerEd25519,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  ecrireEmissionLocale,
  exigerCheckoutPropre,
} from "./check-promotion-dossier.mjs";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import { finaliserPromotion } from "./promotion-publish-lib.mjs";
import {
  PLATEFORMES,
  PREUVES_OBLIGATOIRES,
  verifierSignatureRecu,
} from "./release-graph-lib.mjs";
import {
  MATRICE_ACCESSIBILITE,
  PREUVES_RECUPERATION,
  SCANS_LEGACY,
  TYPES_FAUTE,
  VERIFICATIONS_ARTEFACT,
  candidatDejaScelle,
  construireAttestation,
  tranchePresente,
  validerDossier,
} from "./promotion-dossier-lib.mjs";

const SHA_CANDIDAT = "21".repeat(20);
const HASH_REGISTRE = {
  "registre-contrats": "0a".repeat(32),
  profil: "0b".repeat(32),
  "registre-goldens": "0c".repeat(32),
  "manifeste-retrait": "0d".repeat(32),
};
const STAGING = {
  compte: "3a391620584c792dbbd8cfa148d7634a",
  zone: "b91146ce242a275de0b7e6e0cc3804c7",
  deploiement: "staging-tranche-1-abc123",
};
const DIGESTS_PRODUCTION = {
  bundle: "4a".repeat(32),
  manifeste: "4b".repeat(32),
};
const LIGNES_REGISTRE = [
  {
    test: "crates/buzz-agent/tests/golden.rs",
    tranche: "tranche:1",
    verdict: "preuve-punks",
  },
  {
    test: "crates/buzz-db/tests/isolement.rs",
    tranche: "tranche:1",
    verdict: "difference-intentionnelle",
  },
];
const RACINE_PREUVES = mkdtempSync(join(tmpdir(), "punks-preuves-"));

const CLES_APPROBATION = new Map(
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
const APPROBATION = {
  approbateurs: [...CLES_APPROBATION].map(([id, cle]) => ({
    id,
    "cle-publique-spki": cle.publique,
  })),
  async signerRecu({ contenu, approbateurs }) {
    return signaturesRecu(contenu, approbateurs);
  },
};
const CONFIANCE_APPROBATION = {
  registreApprobateursRelease: APPROBATION.approbateurs.map((entree) => ({
    ...entree,
  })),
  ancrageApprobateursRelease: canonicalSha256(APPROBATION.approbateurs),
};

function signaturesRecu(contenu, approbateurs = ["ops:alice", "ops:bob"]) {
  return approbateurs.map((approbateur) => {
    const cle = CLES_APPROBATION.get(approbateur);
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

function preuvePour(identifiant) {
  const contenu = `${JSON.stringify({ identifiant, resultat: "vert" })}\n`;
  const sha256 = createHash("sha256").update(contenu).digest("hex");
  const nom = `${sha256}-${identifiant.replaceAll(/[^a-z0-9.-]/gi, "-")}.json`;
  const chemin = join("sha256", nom);
  const absolu = join(RACINE_PREUVES, chemin);
  mkdirSync(dirname(absolu), { recursive: true });
  if (!existsSync(absolu)) {
    writeFileSync(absolu, contenu, { flag: "wx" });
  }
  return { chemin, sha256 };
}

function preuvesPourDossier(dossier) {
  const preuves = {};
  const ajouter = (identifiant) => {
    const preuve = preuvePour(identifiant);
    preuves[identifiant] = preuve;
    return preuve;
  };

  for (const artefact of dossier.liaison.artefacts) {
    artefact.sha256 = ajouter(`artefact/${artefact.plateforme}/bundle`).sha256;
    artefact.signature = ajouter(
      `artefact/${artefact.plateforme}/signature`,
    ).sha256;
    for (const verification of VERIFICATIONS_ARTEFACT) {
      ajouter(`artefact/${artefact.plateforme}/verification/${verification}`);
    }
  }
  const shaParPlateforme = new Map(
    dossier.liaison.artefacts.map((artefact) => [
      artefact.plateforme,
      artefact.sha256,
    ]),
  );
  for (const execution of dossier.parcours.executions) {
    execution.sha256Artefact = shaParPlateforme.get(execution.plateforme);
    ajouter(`parcours/${execution.plateforme}/${execution.recit}`);
  }

  dossier.liaison.staging["materiau-sha256"] =
    ajouter("staging/materiau").sha256;
  for (const nom of ["bundle", "manifeste"]) {
    ajouter(`production/${nom}`).subjectSha256 =
      dossier.liaison["digests-production"][nom];
  }
  for (const scenario of dossier.fautes) {
    ajouter(`faute/${scenario.type}`);
  }
  for (const preuve of PREUVES_RECUPERATION) {
    ajouter(`recuperation/${preuve}`);
  }
  dossier.recuperation.captures = ajouter("recuperation/captures").sha256;
  for (const entree of dossier.accessibilite) {
    for (const critere of MATRICE_ACCESSIBILITE) {
      ajouter(`accessibilite/${entree.plateforme}/${critere}`);
    }
    ajouter(`accessibilite/${entree.plateforme}/resultat`);
  }
  for (const golden of dossier.goldens) {
    ajouter(`golden/${golden.test}`);
  }
  dossier.retrait.diff = ajouter("retrait/diff").sha256;
  ajouter("retrait/verdicts");
  for (const cible of SCANS_LEGACY) {
    dossier.scans[cible].empreinte = ajouter(`scan/${cible}`).sha256;
  }
  for (const gate of PREUVES_OBLIGATOIRES) {
    ajouter(`gate/${gate}`);
  }
  return preuves;
}

const GIT_REEL = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

function creerShimGit(statutPorcelain) {
  const bin = mkdtempSync(join(tmpdir(), "punks-promotion-bin-"));
  const cheminGit = join(bin, "git");
  writeFileSync(
    cheminGit,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PROMOTION_GIT_APPELS"
if [ "$1" = "status" ] && [ "$2" = "--porcelain" ]; then
  printf '%s' "$PROMOTION_GIT_STATUT"
  exit 0
fi
exec "$PROMOTION_GIT_REEL" "$@"
`,
  );
  chmodSync(cheminGit, 0o755);
  return {
    bin,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PROMOTION_GIT_REEL: GIT_REEL,
      PROMOTION_GIT_STATUT: statutPorcelain,
    },
  };
}

function executerCli(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/check-promotion-dossier.mjs", ...args],
      { cwd: process.cwd(), ...options },
      (erreur, stdout, stderr) =>
        resolve({
          code: erreur?.code ?? 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

test("le garde-fou n'accepte qu'un porcelain strictement vide", () => {
  const appels = [];
  assert.doesNotThrow(() =>
    exigerCheckoutPropre({
      cwd: "/checkout-test",
      executer: (commande, args, options) => {
        appels.push({ commande, args, options });
        return "";
      },
    }),
  );
  assert.deepEqual(appels, [
    {
      commande: "git",
      args: ["status", "--porcelain"],
      options: {
        cwd: "/checkout-test",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
});

test("le garde-fou refuse toute sortie porcelain non vide", () => {
  for (const statut of [
    " M CONTEXT.md\n",
    "M  scripts/check-promotion-dossier.mjs\n",
    "?? docs/research/\n",
    "\n",
  ]) {
    assert.throws(
      () =>
        exigerCheckoutPropre({
          executer: () => statut,
        }),
      /checkout git non propre.*git status --porcelain doit être strictement vide.*SHA HEAD/s,
    );
  }
});

test("le garde-fou échoue fermé si git status ne peut pas être exécuté", () => {
  assert.throws(
    () =>
      exigerCheckoutPropre({
        executer: () => {
          const erreur = new Error("git indisponible");
          erreur.status = 128;
          throw erreur;
        },
      }),
    /impossible de vérifier la propreté.*code 128.*aucune gate/s,
  );
});

test("le CLI refuse un checkout sale avant de lire le dossier ou d'exécuter les gates", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-sale-"));
  const appelsGit = join(temp, "appels-git.txt");
  const appelsPnpm = join(temp, "appels-pnpm.txt");
  const shim = creerShimGit(" M CONTEXT.md\n?? docs/research/\n");
  const cheminPnpm = join(shim.bin, "pnpm");
  writeFileSync(
    cheminPnpm,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$PROMOTION_PNPM_APPELS"
exit 97
`,
  );
  chmodSync(cheminPnpm, 0o755);

  const { code, stdout, stderr } = await executerCli(
    [join(temp, "dossier-inexistant.json"), "--sortie", temp],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
        PROMOTION_PNPM_APPELS: appelsPnpm,
      },
    },
  );

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /checkout git non propre/);
  assert.match(stderr, /git status --porcelain doit être strictement vide/);
  assert.deepEqual(readFileSync(appelsGit, "utf8").trim().split("\n"), [
    "status --porcelain",
  ]);
  assert.equal(existsSync(appelsPnpm), false, "pnpm ne doit pas être exécuté");
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("--sans-execution ne peut jamais valider, émettre ni écrire", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-sans-execution-"));
  const appelsGit = join(temp, "appels-git.txt");
  const shim = creerShimGit("");
  const { code, stdout, stderr } = await executerCli(
    [
      join(temp, "dossier-inexistant.json"),
      "--sans-execution",
      "--sortie",
      temp,
    ],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
      },
    },
  );

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--sans-execution.*interdit.*aucune émission locale/s);
  assert.equal(
    existsSync(appelsGit),
    false,
    "aucune gate ne doit être consultée",
  );
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("l'émission locale crée atomiquement deux fichiers sans déclarer de publication", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-locale-"));
  const drapeaux = [];
  const resultat = ecrireEmissionLocale(
    {
      sortie,
      tranche: 1,
      attestation: { sha: SHA_CANDIDAT, portee: "locale" },
      recu: { id: "recu-local", sha256: "ab".repeat(32) },
    },
    {
      ouvrir: (chemin, drapeau, mode) => {
        drapeaux.push(drapeau);
        return openSync(chemin, drapeau, mode);
      },
    },
  );

  assert.deepEqual(drapeaux, ["wx", "wx"]);
  const attestation = JSON.parse(readFileSync(resultat.cheminAttestation));
  const recu = JSON.parse(readFileSync(resultat.cheminRecu));
  assert.equal("publiee" in attestation, false);
  assert.equal("publication" in attestation, false);
  assert.equal("publication" in recu, false);
});

test("l'émission locale refuse une destination symbolique", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-symlink-"));
  const cible = join(sortie, "cible.json");
  const cheminAttestation = join(sortie, "attestation-tranche-1.json");
  writeFileSync(cible, "ne-pas-modifier\n");
  symlinkSync(cible, cheminAttestation);

  assert.throws(
    () =>
      ecrireEmissionLocale({
        sortie,
        tranche: 1,
        attestation: { sha: SHA_CANDIDAT },
        recu: { id: "recu-local", sha256: "ab".repeat(32) },
      }),
    /lien symbolique.*create-only/s,
  );
  assert.equal(readFileSync(cible, "utf8"), "ne-pas-modifier\n");
});

test("une course sur le second fichier annule le premier sans écraser le concurrent", () => {
  const sortie = mkdtempSync(join(tmpdir(), "punks-emission-course-"));
  const cheminAttestation = join(sortie, "attestation-tranche-1.json");
  const cheminRecu = join(sortie, "recu-promotion-1.json");
  let ouvertures = 0;

  assert.throws(
    () =>
      ecrireEmissionLocale(
        {
          sortie,
          tranche: 1,
          attestation: { sha: SHA_CANDIDAT },
          recu: { id: "recu-local", sha256: "ab".repeat(32) },
        },
        {
          ouvrir: (chemin, drapeau, mode) => {
            ouvertures += 1;
            if (ouvertures === 2) {
              writeFileSync(chemin, "contenu-concurrent\n", { flag: "wx" });
            }
            return openSync(chemin, drapeau, mode);
          },
        },
      ),
    /create-only.*EEXIST/s,
  );

  assert.equal(
    existsSync(cheminAttestation),
    false,
    "le premier fichier est annulé",
  );
  assert.equal(readFileSync(cheminRecu, "utf8"), "contenu-concurrent\n");
});

function artefact(plateforme, index) {
  return {
    plateforme,
    nom: `punks-${plateforme}.app`,
    sha256: `${index}${"e".repeat(63)}`,
    signature: `${index}${"f".repeat(63)}`,
    identite: {
      bundleId: "bot.punks.desktop",
      verifications: Object.fromEntries(
        VERIFICATIONS_ARTEFACT.map((v) => [v, "vert"]),
      ),
    },
  };
}

function dossierValide(surcharges = {}) {
  const recits = ["connexion", "boucle-sociale", "changement-workspace"];
  const dossier = {
    version: 1,
    "checkpoint-recuperation": CHECKPOINT_RECUPERATION,
    "baseline-buzz": BASELINE_BUZZ,
    candidat: { sha: SHA_CANDIDAT, tranche: 1 },
    liaison: {
      canal: "punks-desktop",
      artefacts: PLATEFORMES.map((p, i) => artefact(p, i)),
      staging: {
        environnement: "staging",
        compte: STAGING.compte,
        zone: STAGING.zone,
        deploiement: STAGING.deploiement,
        materiau: "cloudflare/staging.resources.json",
        "materiau-sha256": "3f".repeat(32),
      },
      "digests-production": { ...DIGESTS_PRODUCTION },
      registres: [
        {
          nom: "registre-contrats",
          version: 1,
          sha256: HASH_REGISTRE["registre-contrats"],
        },
        { nom: "profil", version: 1, sha256: HASH_REGISTRE.profil },
        {
          nom: "registre-goldens",
          version: 1,
          sha256: HASH_REGISTRE["registre-goldens"],
        },
        {
          nom: "manifeste-retrait",
          version: 1,
          sha256: HASH_REGISTRE["manifeste-retrait"],
        },
      ],
    },
    parcours: {
      contour: "distribue",
      serveurVite: false,
      facadeTest: false,
      recits,
      executions: PLATEFORMES.flatMap((p, i) =>
        recits.map((recit) => ({
          plateforme: p,
          sha256Artefact: `${i}${"e".repeat(63)}`,
          deploiement: STAGING.deploiement,
          recit,
          via: ["ui", "ipc-rust", "contrats-publics"],
          resultat: "vert",
        })),
      ),
    },
    fautes: TYPES_FAUTE.map((type, i) => ({
      type,
      plateforme: PLATEFORMES[i],
      autorite: "workers",
      resultat: "vert",
    })),
    recuperation: {
      "roll-forward": "vert",
      "rpo-logique-nul": "vert",
      captures: "9a".repeat(32),
    },
    accessibilite: PLATEFORMES.map((p) => ({
      plateforme: p,
      matrice: Object.fromEntries(
        MATRICE_ACCESSIBILITE.map((c) => [c, "vert"]),
      ),
      resultat: "vert",
    })),
    goldens: LIGNES_REGISTRE.map((l) => ({ test: l.test, verdict: l.verdict })),
    retrait: {
      diff: "8b".repeat(32),
      "verdicts-executes": 4,
      lignes: LIGNES_REGISTRE.map((l) => l.test),
    },
    scans: Object.fromEntries(
      SCANS_LEGACY.map((c, i) => [
        c,
        { resultat: "vert", empreinte: `${i}${"7".repeat(63)}` },
      ]),
    ),
    gates: Object.fromEntries(
      PREUVES_OBLIGATOIRES.map((preuve) => [
        preuve,
        { resultat: "vert", sha: SHA_CANDIDAT },
      ]),
    ),
    ...surcharges,
  };
  dossier.preuves = surcharges.preuves ?? preuvesPourDossier(dossier);
  return dossier;
}

function contexteValide(surcharges = {}) {
  return {
    ledgerRetraits: LIGNES_REGISTRE,
    hashes: { ...HASH_REGISTRE },
    stagingIds: { ...STAGING },
    racinePreuves: RACINE_PREUVES,
    autorisation: { cloudflareCheck: "vert", graphe: "vert" },
    ...surcharges,
  };
}

function attendu(errors, extrait) {
  assert.ok(
    errors.some((e) => e.includes(extrait)),
    `attendu un message contenant « ${extrait} », reçu : ${JSON.stringify(errors)}`,
  );
}

test("un dossier complet et autorisé produit l'attestation au format du graphe", () => {
  const dossier = dossierValide();
  assert.deepEqual(validerDossier(dossier, contexteValide()), []);
  const emission = construireAttestation(dossier, contexteValide());
  assert.equal(emission.erreur, undefined);
  assert.equal(emission.attestation.sha, SHA_CANDIDAT);
  assert.equal(emission.attestation["checkpoint-baseline"], BASELINE_BUZZ);
  assert.equal(emission.attestation.staging.deploiement, STAGING.deploiement);
  assert.deepEqual(
    emission.attestation["digests-production"],
    DIGESTS_PRODUCTION,
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

test("le Reçu lie l'attestation locale complète, pas seulement ses registres", () => {
  const original = construireAttestation(dossierValide(), contexteValide());
  assert.equal(original.erreur, undefined);

  const variations = [
    (dossier) => (dossier.candidat.sha = "31".repeat(20)),
    (dossier) => (dossier.liaison.staging.deploiement = "staging-autre"),
    (dossier) => {
      const preuve = preuvePour("variation-artefact-macos-arm64");
      dossier.liaison.artefacts[0].sha256 = preuve.sha256;
      dossier.preuves[`artefact/${PLATEFORMES[0]}/bundle`] = preuve;
    },
  ];
  for (const modifier of variations) {
    const dossier = dossierValide();
    modifier(dossier);
    if (dossier.candidat.sha !== SHA_CANDIDAT) {
      for (const gate of Object.values(dossier.gates)) {
        gate.sha = dossier.candidat.sha;
      }
    }
    if (dossier.liaison.artefacts[0].sha256 !== `${0}${"e".repeat(63)}`) {
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
    validerDossier(dossierValide({ "baseline-buzz": "ff" })),
    "baseline Buzz invalide",
  );
  attendu(
    validerDossier({ ...dossierValide(), candidat: { sha: "zz", tranche: 1 } }),
    "SHA exact",
  );
  for (const shaInterdit of [BASELINE_BUZZ, CHECKPOINT_RECUPERATION]) {
    const dossier = dossierValide();
    dossier.candidat.sha = shaInterdit;
    attendu(
      validerDossier(dossier, contexteValide()),
      "distinct des checkpoints Buzz interdits",
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
      (d) => (d.liaison.artefacts[3].identite.verifications.updater = "echec"),
      "« updater »",
    ],
    [
      (d) => (d.liaison.staging.deploiement = ""),
      "déploiement Workers exact manquant",
    ],
    [
      (d) => (d.liaison.staging.compte = "0".repeat(32)),
      "divergents du matériau réel",
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
      type: "retour-buzz",
      plateforme: "macos-arm64",
      autorite: "x",
      resultat: "vert",
    },
  ];
  attendu(validerDossier(dossier2, contexteValide()), "type inconnu");
});

test("le roll-forward et le RPO logique nul sont prouvés par les scénarios", () => {
  for (const preuve of PREUVES_RECUPERATION) {
    const dossier = dossierValide();
    dossier.recuperation[preuve] = "non-prouve";
    attendu(
      validerDossier(dossier, contexteValide()),
      `« ${preuve} » doit être prouvé vert`,
    );
  }
  const dossier = dossierValide();
  dossier.recuperation.captures = "xx";
  attendu(
    validerDossier(dossier, contexteValide()),
    "captures de faute manquante",
  );
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
    `preuve « gate/${PREUVES_OBLIGATOIRES[0]} » manquante`,
  );
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
  const sujet = "ab".repeat(32);
  dossier.liaison.artefacts.find(
    ({ plateforme }) => plateforme === "macos-arm64",
  ).sha256 = sujet;
  for (const execution of dossier.parcours.executions.filter(
    ({ plateforme }) => plateforme === "macos-arm64",
  )) {
    execution.sha256Artefact = sujet;
  }
  dossier.preuves[identifiant].subjectSha256 = sujet;
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

test("l'ancien bypass CLI reste refusé même avec un dossier complet", async () => {
  const dossierIncomplet = dossierValide();
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-"));
  const chemin = join(temp, "dossier.json");
  writeFileSync(chemin, JSON.stringify(dossierIncomplet));
  const appelsGit = join(temp, "appels-git.txt");
  const shim = creerShimGit("");
  const { code, stderr } = await executerCli(
    [chemin, "--sans-execution", "--sortie", temp],
    {
      env: {
        ...shim.env,
        PROMOTION_GIT_APPELS: appelsGit,
      },
    },
  );
  assert.equal(code, 1);
  assert.equal(existsSync(appelsGit), false);
  assert.match(stderr, /--sans-execution.*interdit/s);
  assert.equal(existsSync(join(temp, "attestation-tranche-1.json")), false);
  assert.equal(existsSync(join(temp, "recu-promotion-1.json")), false);
});

test("le CLI exige un chemin de dossier", async () => {
  const { code, stderr } = await executerCli([]);
  assert.equal(code, 1);
  assert.match(stderr, /usage :/);
});
