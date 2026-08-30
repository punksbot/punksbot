import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as signerEd25519,
} from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import {
  BASELINE_PUNKS,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import { executerCliPublication } from "./promotion-publish.mjs";
import {
  finaliserPromotion,
  publierPromotion,
} from "./promotion-publish-lib.mjs";
import { emissionValidePourSha } from "./promotion-dossier-validator-fixture.mjs";

const EMISSION_LOCALE = emissionValidePourSha();
const DOSSIER = EMISSION_LOCALE.dossier;
const CONTEXTE_DOSSIER = EMISSION_LOCALE.contexte;
const SHA_CANDIDAT = DOSSIER.candidat.sha;
const TAG_CANDIDAT = `punks-staging-${SHA_CANDIDAT}`;
const ATTESTATION = EMISSION_LOCALE.attestation;

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

const RECU = EMISSION_LOCALE.recu;
const CONTENU_DOSSIER = `${JSON.stringify(DOSSIER, null, 2)}\n`;
const CONTENU_ATTESTATION_LOCAL = `${JSON.stringify(ATTESTATION, null, 2)}\n`;
const CONTENU_RECU_LOCAL = `${JSON.stringify(RECU, null, 2)}\n`;

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
    return approbateurs.map((approbateur) => {
      const cle = CLES_APPROBATION.get(approbateur);
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
  },
};
const CONFIANCE = {
  registreApprobateursRelease: APPROBATION.approbateurs.map((entree) => ({
    ...entree,
  })),
  ancrageApprobateursRelease: canonicalSha256(APPROBATION.approbateurs),
};
const PROMOTION_FINALE = await finaliserPromotion(
  { attestation: ATTESTATION, recu: RECU, bootstrapR2: true },
  APPROBATION,
  CONFIANCE,
);
const CONTENU_ATTESTATION_FINAL = PROMOTION_FINALE.octets.attestation;
const CONTENU_RECU_FINAL = PROMOTION_FINALE.octets.recu;
const SHA_ATTESTATION_FINALE = canonicalSha256(PROMOTION_FINALE.attestation);
const SHA_RECU_FINAL = PROMOTION_FINALE.recu.sha256;
const NOM_ATTESTATION = `attestation-${SHA_ATTESTATION_FINALE}.json`;
const NOM_RECU = `recu-${SHA_RECU_FINAL}.json`;
const CLE_ATTESTATION = `releases/punks-desktop/tranche:1/attestations/${SHA_ATTESTATION_FINALE}.json`;
const CLE_RECU = `releases/punks-desktop/tranche:1/recus/${SHA_RECU_FINAL}.json`;

const DESTINATIONS_R2 = [
  {
    role: "primaire",
    compte: "3a391620584c792dbbd8cfa148d7634a",
    bucket: "punks-promotion-a",
  },
  {
    role: "secondaire",
    compte: "3a391620584c792dbbd8cfa148d7634a",
    bucket: "punks-promotion-b",
  },
];
CONFIANCE.ancrageDestinationsR2 = canonicalSha256(DESTINATIONS_R2);
const GRAPHE_PUBLICATION = parseYaml(
  readFileSync(
    new URL("../docs/migration/release-graph.yaml", import.meta.url),
    "utf8",
  ),
);
GRAPHE_PUBLICATION["approbateurs-release"] = APPROBATION.approbateurs.map(
  (entree) => ({ ...entree }),
);
GRAPHE_PUBLICATION.publication.r2.destinations = DESTINATIONS_R2.map(
  (destination) => ({
    ...destination,
    "verrouillage-objet": "compliance",
  }),
);
const CONTENU_GRAPHE_PUBLICATION = Buffer.from(
  `${canonicalJson(GRAPHE_PUBLICATION)}\n`,
);

function erreurObjetExistant(message) {
  const erreur = new Error(message);
  erreur.code = "ALREADY_EXISTS";
  return erreur;
}

function creerFrontieres({ release = {}, verrous = {}, journal = null } = {}) {
  const assets = new Map();
  const objets = new Map();
  const cleObjet = ({ compte, bucket, cle }) => `${compte}/${bucket}/${cle}`;

  const github = {
    async lireDraft() {
      return {
        id: 58,
        tag: TAG_CANDIDAT,
        sha: SHA_CANDIDAT,
        draft: true,
        ...release,
      };
    },
    async lireAsset({ nom }) {
      return assets.has(nom) ? Buffer.from(assets.get(nom)) : null;
    },
    async creerAsset({ nom, contenu }) {
      journal?.push(`github:${nom}`);
      if (assets.has(nom)) {
        throw erreurObjetExistant(`asset ${nom} déjà présent`);
      }
      assets.set(nom, Buffer.from(contenu));
    },
  };

  const cloudflare = {
    async lireVerrouillage({ compte, bucket }) {
      return (
        verrous[`${compte}/${bucket}`] ?? {
          mode: "compliance",
          actif: true,
        }
      );
    },
    async lireObjet(destination) {
      const cle = cleObjet(destination);
      return objets.has(cle) ? Buffer.from(objets.get(cle)) : null;
    },
    async creerObjet(destination) {
      journal?.push(`r2:${destination.role}:${destination.cle}`);
      const cle = cleObjet(destination);
      if (objets.has(cle)) {
        throw erreurObjetExistant(`objet ${cle} déjà présent`);
      }
      objets.set(cle, Buffer.from(destination.contenu));
    },
  };

  return { github, cloudflare, approbation: APPROBATION, confiance: CONFIANCE };
}

function optionsPublication(surcharge = {}) {
  return {
    graphe: CONTENU_GRAPHE_PUBLICATION,
    dossier: Buffer.from(CONTENU_DOSSIER),
    contexteDossier: CONTEXTE_DOSSIER,
    attestation: Buffer.from(CONTENU_ATTESTATION_LOCAL),
    recu: Buffer.from(CONTENU_RECU_LOCAL),
    depot: "mabzadev/punksbot",
    tag: TAG_CANDIDAT,
    canal: "punks-desktop",
    r2: DESTINATIONS_R2.map((destination) => ({ ...destination })),
    bootstrapR2: true,
    ...surcharge,
  };
}

test("publie l'attestation et le Reçu dans deux buckets R2 Punks verrouillés", async () => {
  const frontieres = creerFrontieres();

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "publiee");
  assert.equal(resultat.sha, SHA_CANDIDAT);
  assert.equal(resultat.tag, TAG_CANDIDAT);
  assert.deepEqual(resultat.release, {
    id: 58,
    graphe: "tranche:1",
  });
  assert.deepEqual(resultat.objets, [
    {
      sorte: "attestation",
      sha256: createHash("sha256")
        .update(CONTENU_ATTESTATION_FINAL)
        .digest("hex"),
      assetGithub: NOM_ATTESTATION,
      cleR2: CLE_ATTESTATION,
    },
    {
      sorte: "recu",
      sha256: createHash("sha256").update(CONTENU_RECU_FINAL).digest("hex"),
      assetGithub: NOM_RECU,
      cleR2: CLE_RECU,
    },
  ]);
  assert.deepEqual(resultat.crees, [
    "github:attestation",
    "github:recu",
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
  ]);

  assert.deepEqual(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    CONTENU_ATTESTATION_FINAL,
  );
  assert.deepEqual(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_RECU,
    }),
    CONTENU_RECU_FINAL,
  );

  for (const destination of DESTINATIONS_R2) {
    assert.deepEqual(
      await frontieres.cloudflare.lireObjet({
        ...destination,
        cle: CLE_ATTESTATION,
      }),
      CONTENU_ATTESTATION_FINAL,
    );
    assert.deepEqual(
      await frontieres.cloudflare.lireObjet({
        ...destination,
        cle: CLE_RECU,
      }),
      CONTENU_RECU_FINAL,
    );
  }
});

test("la première activation R2 est bootstrapée depuis les assets GitHub immuables", async () => {
  const journal = [];
  const frontieres = creerFrontieres({ journal });
  const resultat = await publierPromotion(
    optionsPublication({ bootstrapR2: true }),
    frontieres,
  );

  assert.equal(resultat.statut, "publiee");
  assert.equal(journal[0].startsWith("github:"), true);
  assert.equal(journal[1].startsWith("github:"), true);
  assert.equal(
    journal.slice(2).every((operation) => operation.startsWith("r2:")),
    true,
  );
  const objetRecu = resultat.objets.find((objet) => objet.sorte === "recu");
  const octetsRecu = await frontieres.github.lireAsset({
    releaseId: 58,
    nom: objetRecu.assetGithub,
  });
  const recu = JSON.parse(octetsRecu.toString("utf8"));
  assert.equal(
    recu.contenu["bootstrap-github-attestation-sha256"],
    canonicalSha256({ ...ATTESTATION, publiee: ["release", "r2"] }),
  );
});

test("la première tranche refuse tout contournement du bootstrap avant une frontière distante", async () => {
  const journal = [];
  const frontieres = creerFrontieres({ journal });
  await assert.rejects(
    publierPromotion(optionsPublication({ bootstrapR2: false }), frontieres),
    /première tranche impose le bootstrap GitHub puis R2/,
  );
  assert.deepEqual(journal, []);
});

test("la publication initiale refuse un graphe intégralement invalide avant signature ou frontière distante", async () => {
  const journal = [];
  const frontieres = creerFrontieres({ journal });
  frontieres.approbation = {
    ...frontieres.approbation,
    async signerRecu() {
      journal.push("signature");
      return [];
    },
  };
  const grapheInvalide = structuredClone(GRAPHE_PUBLICATION);
  grapheInvalide.recuperations = [
    {
      type: "retour-punks",
      cible: "punks",
    },
  ];
  await assert.rejects(
    publierPromotion(
      optionsPublication({
        graphe: Buffer.from(`${canonicalJson(grapheInvalide)}\n`),
      }),
      frontieres,
    ),
    /graphe de release est invalide.*retour-punks/s,
  );
  assert.deepEqual(journal, []);
});

test("deux promotions au même préfixe SHA gardent des identités et clés distinctes", async () => {
  const frontieres = creerFrontieres();
  const shaSuivant = `${SHA_CANDIDAT.slice(0, 12)}${"f".repeat(28)}`;
  frontieres.github.lireDraft = async ({ tag }) => ({
    id: tag === TAG_CANDIDAT ? 58 : 59,
    tag,
    sha: tag.slice("punks-staging-".length),
    draft: true,
  });

  const emissionSuivante = emissionValidePourSha(shaSuivant);
  const attestationSuivante = emissionSuivante.attestation;
  const recuSuivant = emissionSuivante.recu;
  assert.notEqual(recuSuivant.id, RECU.id);
  assert.equal(
    attestationSuivante.sha.slice(0, 12),
    ATTESTATION.sha.slice(0, 12),
    "le cas adverse conserve volontairement le même préfixe 48 bits",
  );

  const premier = await publierPromotion(optionsPublication(), frontieres);
  const suivant = await publierPromotion(
    optionsPublication({
      dossier: Buffer.from(
        `${JSON.stringify(emissionSuivante.dossier, null, 2)}\n`,
      ),
      contexteDossier: emissionSuivante.contexte,
      attestation: Buffer.from(
        `${JSON.stringify(attestationSuivante, null, 2)}\n`,
      ),
      recu: Buffer.from(`${JSON.stringify(recuSuivant, null, 2)}\n`),
      tag: `punks-staging-${shaSuivant}`,
    }),
    frontieres,
  );

  assert.equal(premier.statut, "publiee");
  assert.equal(suivant.statut, "publiee");
  assert.notEqual(
    premier.objets.find((objet) => objet.sorte === "attestation").cleR2,
    suivant.objets.find((objet) => objet.sorte === "attestation").cleR2,
  );
  assert.notEqual(
    premier.objets.find((objet) => objet.sorte === "recu").cleR2,
    suivant.objets.find((objet) => objet.sorte === "recu").cleR2,
  );
});

test("la finalisation ordonne les signatures et reproduit exactement les mêmes octets", async () => {
  const inversee = await finaliserPromotion(
    { attestation: ATTESTATION, recu: RECU, bootstrapR2: true },
    {
      ...APPROBATION,
      async signerRecu(argumentsSignature) {
        return (await APPROBATION.signerRecu(argumentsSignature)).reverse();
      },
    },
    CONFIANCE,
  );
  assert.deepEqual(
    inversee.octets.attestation,
    PROMOTION_FINALE.octets.attestation,
  );
  assert.deepEqual(inversee.octets.recu, PROMOTION_FINALE.octets.recu);
});

test("la première publication refuse tout champ local implicite avant signature", async () => {
  const recuImplicite = structuredClone(RECU);
  recuImplicite.contenu["backend-implicite"] = "punks";
  recuImplicite.sha256 = canonicalSha256(recuImplicite.contenu);
  await assert.rejects(
    finaliserPromotion(
      { attestation: ATTESTATION, recu: recuImplicite, bootstrapR2: true },
      APPROBATION,
      CONFIANCE,
    ),
    /Reçu local à schéma fermé/,
  );

  const attestationImplicite = structuredClone(ATTESTATION);
  attestationImplicite["backend-implicite"] = "punks";
  await assert.rejects(
    finaliserPromotion(
      {
        attestation: attestationImplicite,
        recu: recuPour(attestationImplicite),
        bootstrapR2: true,
      },
      APPROBATION,
      CONFIANCE,
    ),
    /attestation locale .*schéma fermé/,
  );
});

test("la première publication refuse les champs implicites d'une signature", async () => {
  await assert.rejects(
    finaliserPromotion(
      { attestation: ATTESTATION, recu: RECU, bootstrapR2: true },
      {
        ...APPROBATION,
        async signerRecu(argumentsSignature) {
          const signatures = await APPROBATION.signerRecu(argumentsSignature);
          signatures[0]["autorite-implicite"] = "punks";
          return signatures;
        },
      },
      CONFIANCE,
    ),
    /signature du Reçu à schéma fermé/,
  );
});

test("la sérialisation finale est canonique malgré un ordre de clés différent", async () => {
  const reordonner = (valeur) => {
    if (Array.isArray(valeur)) return valeur.map(reordonner);
    if (valeur === null || typeof valeur !== "object") return valeur;
    return Object.fromEntries(
      Object.entries(valeur)
        .reverse()
        .map(([cle, contenu]) => [cle, reordonner(contenu)]),
    );
  };
  const attestation = reordonner(ATTESTATION);
  const recu = reordonner(recuPour(attestation));
  const finalisee = await finaliserPromotion(
    { attestation, recu, bootstrapR2: true },
    APPROBATION,
    CONFIANCE,
  );

  assert.deepEqual(finalisee.octets.attestation, CONTENU_ATTESTATION_FINAL);
  assert.deepEqual(finalisee.octets.recu, CONTENU_RECU_FINAL);
});

test("refuse toute attestation locale incomplète avant signature et écriture", async () => {
  const mutations = [
    (attestation) => delete attestation.dossier,
    (attestation) => delete attestation["checkpoint-baseline"],
    (attestation) => delete attestation.profil,
    (attestation) => delete attestation.registres,
    (attestation) => delete attestation.staging,
    (attestation) => delete attestation.gates,
    (attestation) => delete attestation.artefacts,
    (attestation) => delete attestation["digests-production"],
  ];
  for (const muter of mutations) {
    const attestation = structuredClone(ATTESTATION);
    muter(attestation);
    await assert.rejects(
      finaliserPromotion(
        { attestation, recu: recuPour(attestation) },
        APPROBATION,
        CONFIANCE,
      ),
      /attestation locale complète/s,
    );
  }
});

test("refuse deux encodages DER de la même clé comme deux approbateurs", async () => {
  const [id, cle] = CLES_APPROBATION.entries().next().value;
  const derAvecSuffixe = Buffer.concat([
    Buffer.from(cle.publique, "base64"),
    Buffer.from([0]),
  ]).toString("base64");
  let signatureDemandee = false;
  const approbation = {
    approbateurs: [
      { id, "cle-publique-spki": cle.publique },
      { id: "ops:alias", "cle-publique-spki": derAvecSuffixe },
    ],
    async signerRecu() {
      signatureDemandee = true;
      return [];
    },
  };
  const confianceAlias = {
    registreApprobateursRelease: approbation.approbateurs.map((entree) => ({
      ...entree,
    })),
    ancrageApprobateursRelease: canonicalSha256(approbation.approbateurs),
  };

  await assert.rejects(
    finaliserPromotion(
      { attestation: ATTESTATION, recu: RECU },
      approbation,
      confianceAlias,
    ),
    /registre d'approbateurs Ed25519 invalide ou dupliqué/s,
  );
  assert.equal(signatureDemandee, false);
});

test("refuse deux vraies clés non membres de l'ancrage opérateur", async () => {
  const approbateurs = ["attaquant:1", "attaquant:2"].map((id) => {
    const { publicKey } = generateKeyPairSync("ed25519");
    return {
      id,
      "cle-publique-spki": publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    };
  });
  let signatureDemandee = false;
  await assert.rejects(
    finaliserPromotion(
      { attestation: ATTESTATION, recu: RECU },
      {
        approbateurs,
        async signerRecu() {
          signatureDemandee = true;
          return [];
        },
      },
      CONFIANCE,
    ),
    /appartenir exactement au registre complet ancré/s,
  );
  assert.equal(signatureDemandee, false);
});

test("refuse une destination hors du compte Punks avant toute écriture", async () => {
  const journal = [];
  const r2 = DESTINATIONS_R2.map((destination) => ({ ...destination }));
  r2[1].compte = "22".repeat(16);
  const frontieres = creerFrontieres();
  frontieres.confiance = {
    ...CONFIANCE,
    ancrageDestinationsR2: canonicalSha256(r2),
  };
  const graphe = structuredClone(GRAPHE_PUBLICATION);
  graphe.publication.r2.destinations = r2.map((destination) => ({
    ...destination,
    "verrouillage-objet": "compliance",
  }));

  await assert.rejects(
    publierPromotion(
      optionsPublication({
        graphe: Buffer.from(`${canonicalJson(graphe)}\n`),
        r2,
      }),
      frontieres,
    ),
    /compte Cloudflare Punks/,
  );
  assert.deepEqual(journal, []);
});

test("refuse le même bucket logique pour les deux rôles avant toute écriture", async () => {
  const frontieres = creerFrontieres();
  const r2 = DESTINATIONS_R2.map((destination) => ({ ...destination }));
  r2[1].bucket = r2[0].bucket;

  await assert.rejects(
    publierPromotion(optionsPublication({ r2 }), frontieres),
    /deux buckets R2 distincts/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...r2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("refuse une identité R2 non canonique avant toute frontière externe", async () => {
  const frontieres = creerFrontieres();
  const r2 = DESTINATIONS_R2.map((destination) => ({ ...destination }));
  r2[0].compte = ` ${r2[0].compte}`;

  await assert.rejects(
    publierPromotion(optionsPublication({ r2 }), frontieres),
    /identité R2 canonique/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("refuse un bucket sans verrouillage compliance avant toute écriture", async () => {
  const destination = DESTINATIONS_R2[1];
  const frontieres = creerFrontieres({
    verrous: {
      [`${destination.compte}/${destination.bucket}`]: {
        mode: "governance",
        actif: true,
      },
    },
  });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    /verrouillage compliance actif/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
    "le préflight doit valider les deux buckets avant la première écriture",
  );
});

test("refuse un tag demandé qui ne dérive pas du SHA de l'attestation", async () => {
  const frontieres = creerFrontieres();

  await assert.rejects(
    publierPromotion(
      optionsPublication({ tag: `punks-staging-${"f".repeat(40)}` }),
      frontieres,
    ),
    /tag.*SHA exact/s,
  );

  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    null,
  );
});

test("refuse les checkpoints Punks avant signature et publication", async () => {
  for (const sha of [BASELINE_PUNKS, CHECKPOINT_RECUPERATION]) {
    const attestation = { ...ATTESTATION, sha };
    const id = `recu-promotion-1-${sha}`;
    const contenu = {
      schema: "punks.release-receipt.v1",
      id,
      type: "promotion",
      "attestation-sha256": canonicalSha256(attestation),
    };
    const recu = { id, contenu, sha256: canonicalSha256(contenu) };
    await assert.rejects(
      finaliserPromotion({ attestation, recu }, APPROBATION, CONFIANCE),
      /distinct des checkpoints Punks interdits/s,
    );
  }
});

test("refuse tout canal différent du canal fermé avant de construire les clés R2", async () => {
  for (const canal of ["../autre-canal", "autre-canal"]) {
    const frontieres = creerFrontieres();
    await assert.rejects(
      publierPromotion(optionsPublication({ canal }), frontieres),
      /canal de publication doit être exactement punks-desktop/s,
    );
    assert.equal(
      await frontieres.cloudflare.lireObjet({
        ...DESTINATIONS_R2[0],
        cle: CLE_ATTESTATION,
      }),
      null,
    );
  }
});

test("refuse une release GitHub dont le tag observé diverge", async () => {
  const frontieres = creerFrontieres({
    release: { tag: "punks-staging-autre" },
  });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    /release GitHub.*tag divergent/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("refuse une release GitHub dont le SHA cible diverge", async () => {
  const frontieres = creerFrontieres({ release: { sha: "f".repeat(40) } });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    /release GitHub.*SHA divergent/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("refuse une release GitHub qui n'est plus une draft", async () => {
  const frontieres = creerFrontieres({ release: { draft: false } });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    /release GitHub.*draft exacte/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("refuse un objet R2 existant au hash divergent avant toute nouvelle publication", async () => {
  const frontieres = creerFrontieres();
  const secondaire = DESTINATIONS_R2[1];
  await frontieres.cloudflare.creerObjet({
    ...secondaire,
    cle: CLE_ATTESTATION,
    contenu: Buffer.from("contenu-divergent\n"),
  });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "HASH_DIVERGENT" &&
      /objet R2 existant.*secondaire.*attestation/s.test(erreur.message),
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
    "aucune destination saine ne doit être écrite avant la fin du préflight",
  );
  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    null,
  );
});

test("refuse un asset GitHub existant au hash divergent avant toute écriture R2", async () => {
  const frontieres = creerFrontieres();
  await frontieres.github.creerAsset({
    releaseId: 58,
    nom: NOM_RECU,
    contenu: Buffer.from("recu-divergent\n"),
  });

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "HASH_DIVERGENT" &&
      /asset GitHub existant recu/s.test(erreur.message),
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    null,
  );
});

test("reprend idempotemment une publication partielle dont l'objet existant est exact", async () => {
  const frontieres = creerFrontieres();
  await frontieres.cloudflare.creerObjet({
    ...DESTINATIONS_R2[0],
    cle: CLE_ATTESTATION,
    contenu: CONTENU_ATTESTATION_FINAL,
  });

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.dejaPresents, ["r2:primaire:attestation"]);
  assert.deepEqual(resultat.crees, [
    "github:attestation",
    "github:recu",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
  ]);
  assert.deepEqual(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    CONTENU_ATTESTATION_FINAL,
  );
});

test("retourne un succès sans réécriture lorsque les six objets exacts existent", async () => {
  const frontieres = creerFrontieres();
  const objets = [
    {
      sorte: "attestation",
      nom: NOM_ATTESTATION,
      cle: CLE_ATTESTATION,
      contenu: CONTENU_ATTESTATION_FINAL,
    },
    {
      sorte: "recu",
      nom: NOM_RECU,
      cle: CLE_RECU,
      contenu: CONTENU_RECU_FINAL,
    },
  ];
  for (const destination of DESTINATIONS_R2) {
    for (const objet of objets) {
      await frontieres.cloudflare.creerObjet({
        ...destination,
        cle: objet.cle,
        contenu: objet.contenu,
      });
    }
  }
  for (const objet of objets) {
    await frontieres.github.creerAsset({
      releaseId: 58,
      nom: objet.nom,
      contenu: objet.contenu,
    });
  }

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "deja-publiee");
  assert.deepEqual(resultat.crees, []);
  assert.deepEqual(resultat.dejaPresents, [
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
    "github:attestation",
    "github:recu",
  ]);
});

test("reprend une course create-only si l'objet concurrent porte exactement le hash attendu", async () => {
  const frontieres = creerFrontieres();
  const creerObjet = frontieres.cloudflare.creerObjet.bind(
    frontieres.cloudflare,
  );
  let courseInjectee = false;
  frontieres.cloudflare.creerObjet = async (destination) => {
    if (
      !courseInjectee &&
      destination.role === "primaire" &&
      destination.cle.includes("/attestations/")
    ) {
      courseInjectee = true;
      await creerObjet(destination);
      throw erreurObjetExistant("création concurrente exacte");
    }
    return creerObjet(destination);
  };

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.dejaPresents, ["r2:primaire:attestation"]);
  assert.equal(resultat.crees.includes("r2:primaire:attestation"), false);
  assert.deepEqual(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: CLE_ATTESTATION,
    }),
    CONTENU_ATTESTATION_FINAL,
  );
});

test("reprend idempotemment au second passage une publication interrompue", async () => {
  const frontieres = creerFrontieres();
  const creerObjet = frontieres.cloudflare.creerObjet.bind(
    frontieres.cloudflare,
  );
  let panneArmee = true;
  frontieres.cloudflare.creerObjet = async (destination) => {
    if (
      panneArmee &&
      destination.role === "secondaire" &&
      destination.cle.includes("/recus/")
    ) {
      panneArmee = false;
      throw new Error("panne Cloudflare simulée");
    }
    return creerObjet(destination);
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "PUBLICATION_PARTIELLE" &&
      erreur.details?.reprenable === true &&
      erreur.details?.publies?.length === 5 &&
      erreur.details?.restants?.length === 1,
  );

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.dejaPresents, [
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "github:attestation",
    "github:recu",
  ]);
  assert.deepEqual(resultat.crees, ["r2:secondaire:recu"]);
});

test("refuse un Reçu dont l'identifiant ne cite pas le SHA de l'attestation", async () => {
  const frontieres = creerFrontieres();
  const recu = {
    ...RECU,
    id: `recu-promotion-1-${"f".repeat(40)}`,
  };

  await assert.rejects(
    publierPromotion(
      optionsPublication({
        recu: Buffer.from(`${JSON.stringify(recu, null, 2)}\n`),
      }),
      frontieres,
    ),
    /Reçu.*SHA de l'attestation/s,
  );

  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    null,
  );
});

test("refuse un Reçu dont le hash canonique diverge de l'attestation", async () => {
  const frontieres = creerFrontieres();
  const recu = { ...RECU, sha256: "f".repeat(64) };

  await assert.rejects(
    publierPromotion(
      optionsPublication({
        recu: Buffer.from(`${JSON.stringify(recu, null, 2)}\n`),
      }),
      frontieres,
    ),
    /Reçu local doit lier exactement son contenu canonique/s,
  );

  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    null,
  );
});

test("refuse une frontière d'approbation absente, falsifiée ou non approuvée avant toute écriture", async () => {
  const absente = creerFrontieres();
  absente.approbation = null;
  await assert.rejects(
    publierPromotion(optionsPublication(), absente),
    /deux approbateurs Ed25519 approuvés/s,
  );

  const falsifiee = creerFrontieres();
  falsifiee.approbation = {
    ...APPROBATION,
    async signerRecu({ contenu, approbateurs }) {
      const signatures = await APPROBATION.signerRecu({
        contenu,
        approbateurs,
      });
      signatures[0].valeur = "00".repeat(64);
      return signatures;
    },
  };
  await assert.rejects(
    publierPromotion(optionsPublication(), falsifiee),
    /signature du Reçu invalide/s,
  );

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const etrangere = creerFrontieres();
  etrangere.approbation = {
    ...APPROBATION,
    async signerRecu({ contenu, approbateurs }) {
      const signatures = await APPROBATION.signerRecu({
        contenu,
        approbateurs,
      });
      signatures[0] = {
        approbateur: approbateurs[0],
        algorithme: "ed25519",
        "cle-publique-spki": publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
        valeur: signerEd25519(
          null,
          Buffer.from(canonicalJson(contenu), "utf8"),
          privateKey,
        ).toString("hex"),
      };
      return signatures;
    },
  };
  await assert.rejects(
    publierPromotion(optionsPublication(), etrangere),
    /étrangère au registre approuvé/s,
  );

  assert.equal(
    await falsifiee.github.lireAsset({
      releaseId: 58,
      nom: NOM_ATTESTATION,
    }),
    null,
  );
});

test("refuse le succès si la draft diverge pendant la publication puis reprend sans réécrire", async () => {
  const frontieres = creerFrontieres();
  let lectures = 0;
  let stable = false;
  frontieres.github.lireDraft = async () => {
    lectures += 1;
    return {
      id: 58,
      tag: TAG_CANDIDAT,
      sha: SHA_CANDIDAT,
      draft: stable || lectures < 3,
    };
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "PUBLICATION_PARTIELLE" &&
      /draft exacte/s.test(erreur.cause?.message ?? ""),
  );

  stable = true;
  const resultat = await publierPromotion(optionsPublication(), frontieres);
  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.crees, [
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
  ]);
});

test("refuse le succès si la draft candidate est remplacée sous le même tag et SHA", async () => {
  const frontieres = creerFrontieres();
  let lectures = 0;
  frontieres.github.lireDraft = async () => {
    lectures += 1;
    return {
      id: lectures < 3 ? 58 : 59,
      tag: TAG_CANDIDAT,
      sha: SHA_CANDIDAT,
      draft: true,
    };
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "PUBLICATION_PARTIELLE" &&
      /identifiant de draft divergent/s.test(erreur.cause?.message ?? ""),
  );
});

test("refuse le succès si un verrou compliance disparaît pendant la publication", async () => {
  const frontieres = creerFrontieres();
  const lireVerrouillage = frontieres.cloudflare.lireVerrouillage.bind(
    frontieres.cloudflare,
  );
  let lecturesSecondaire = 0;
  let stable = false;
  frontieres.cloudflare.lireVerrouillage = async (destination) => {
    if (destination.role !== "secondaire") {
      return lireVerrouillage(destination);
    }
    lecturesSecondaire += 1;
    if (stable || lecturesSecondaire === 1) {
      return { mode: "compliance", actif: true };
    }
    return { mode: "governance", actif: true };
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "VALIDATION_POST_PUBLICATION" &&
      /verrouillage compliance actif/s.test(erreur.message),
  );

  stable = true;
  const resultat = await publierPromotion(optionsPublication(), frontieres);
  assert.equal(resultat.statut, "deja-publiee");
});

test("refuse le succès si une frontière annonce une création sans objet vérifiable", async () => {
  const frontieres = creerFrontieres();
  const creerAsset = frontieres.github.creerAsset.bind(frontieres.github);
  let perteArmee = true;
  frontieres.github.creerAsset = async (asset) => {
    if (perteArmee && asset.nom === NOM_RECU) {
      perteArmee = false;
      return;
    }
    return creerAsset(asset);
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "PUBLICATION_PARTIELLE" &&
      /bootstrap GitHub recu manquant/s.test(erreur.cause?.message ?? ""),
  );

  const resultat = await publierPromotion(optionsPublication(), frontieres);
  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.crees, [
    "github:recu",
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
  ]);
});

test("le CLI publie les deux fichiers locaux via les seules frontières injectées", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-publish-cli-"));
  const cheminGraphe = join(temp, "release-graph.json");
  const cheminDossier = join(temp, "promotion-dossier.json");
  const cheminAttestation = join(temp, "attestation-tranche-1.json");
  const cheminRecu = join(temp, "recu-promotion-1.json");
  writeFileSync(cheminGraphe, CONTENU_GRAPHE_PUBLICATION, { flag: "wx" });
  writeFileSync(cheminDossier, CONTENU_DOSSIER, { flag: "wx" });
  writeFileSync(cheminAttestation, CONTENU_ATTESTATION_LOCAL, { flag: "wx" });
  writeFileSync(cheminRecu, CONTENU_RECU_LOCAL, { flag: "wx" });
  const sorties = [];
  const erreurs = [];

  const code = await executerCliPublication(
    [
      "--graphe",
      cheminGraphe,
      "--dossier",
      cheminDossier,
      "--attestation",
      cheminAttestation,
      "--recu",
      cheminRecu,
      "--depot",
      "mabzadev/punksbot",
      "--tag",
      TAG_CANDIDAT,
      "--canal",
      "punks-desktop",
      "--bootstrap-r2",
      "--r2-primaire",
      `${DESTINATIONS_R2[0].compte}/${DESTINATIONS_R2[0].bucket}`,
      "--r2-secondaire",
      `${DESTINATIONS_R2[1].compte}/${DESTINATIONS_R2[1].bucket}`,
    ],
    {
      frontieres: creerFrontieres(),
      construireContexteDossier: () => ({
        contexteValidation: CONTEXTE_DOSSIER,
      }),
      ecrireSortie: (ligne) => sorties.push(ligne),
      ecrireErreur: (ligne) => erreurs.push(ligne),
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(erreurs, []);
  assert.equal(sorties.length, 1);
  const resultat = JSON.parse(sorties[0]);
  assert.equal(resultat.statut, "publiee");
  assert.equal(resultat.sha, SHA_CANDIDAT);
  assert.equal(resultat.crees.length, 6);
});
