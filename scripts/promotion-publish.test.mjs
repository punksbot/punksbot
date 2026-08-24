import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executerCliPublication } from "./promotion-publish.mjs";
import { publierPromotion } from "./promotion-publish-lib.mjs";

const SHA_CANDIDAT = "0123456789abcdef0123456789abcdef01234567";
const TAG_CANDIDAT = `punks-staging-${SHA_CANDIDAT}`;
const HASH_CANONIQUE_ATTESTATION =
  "9776eb405bd5e722cfac1f2dc51575c92efec40d2e89bbc852e1750fc22ebb0e";

const ATTESTATION = {
  sha: SHA_CANDIDAT,
  dossier: { sha256: "a".repeat(64) },
  staging: { environnement: "staging", deploiement: "deploy-1" },
};
const RECU = {
  id: `recu-promotion-1-${SHA_CANDIDAT.slice(0, 12)}`,
  sha256: HASH_CANONIQUE_ATTESTATION,
};
const CONTENU_ATTESTATION = `${JSON.stringify(ATTESTATION, null, 2)}\n`;
const CONTENU_RECU = `${JSON.stringify(RECU, null, 2)}\n`;

const DESTINATIONS_R2 = [
  { role: "primaire", compte: "compte-r2-a", bucket: "punks-promotion-a" },
  {
    role: "secondaire",
    compte: "compte-r2-b",
    bucket: "punks-promotion-b",
  },
];

function erreurObjetExistant(message) {
  const erreur = new Error(message);
  erreur.code = "ALREADY_EXISTS";
  return erreur;
}

function creerFrontieres({ release = {}, verrous = {} } = {}) {
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
      const cle = cleObjet(destination);
      if (objets.has(cle)) {
        throw erreurObjetExistant(`objet ${cle} déjà présent`);
      }
      objets.set(cle, Buffer.from(destination.contenu));
    },
  };

  return { github, cloudflare };
}

function optionsPublication(surcharge = {}) {
  return {
    attestation: Buffer.from(CONTENU_ATTESTATION),
    recu: Buffer.from(CONTENU_RECU),
    depot: "mabzadev/punksbot",
    tag: TAG_CANDIDAT,
    canal: "punks-desktop",
    r2: DESTINATIONS_R2.map((destination) => ({ ...destination })),
    ...surcharge,
  };
}

test("publie l'attestation et le Reçu sur la draft exacte et deux comptes R2 compliance", async () => {
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
      sha256:
        "8849eeb01801be60c9ab403ae2779f5bd119eab9ec246de8341666d58f5e35e1",
      assetGithub: "attestation-tranche-1.json",
      cleR2: "releases/punks-desktop/tranche:1/attestation.json",
    },
    {
      sorte: "recu",
      sha256:
        "2c7bc3a1a2c433f135f004cf39b20841288da5feac004d080f79cff4d48ec068",
      assetGithub: "recu-promotion-1.json",
      cleR2: `releases/punks-desktop/tranche:1/recus/${RECU.id}.json`,
    },
  ]);
  assert.deepEqual(resultat.crees, [
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
    "github:attestation",
    "github:recu",
  ]);

  assert.deepEqual(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: "attestation-tranche-1.json",
    }),
    Buffer.from(CONTENU_ATTESTATION),
  );
  assert.deepEqual(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: "recu-promotion-1.json",
    }),
    Buffer.from(CONTENU_RECU),
  );

  for (const destination of DESTINATIONS_R2) {
    assert.deepEqual(
      await frontieres.cloudflare.lireObjet({
        ...destination,
        cle: "releases/punks-desktop/tranche:1/attestation.json",
      }),
      Buffer.from(CONTENU_ATTESTATION),
    );
    assert.deepEqual(
      await frontieres.cloudflare.lireObjet({
        ...destination,
        cle: `releases/punks-desktop/tranche:1/recus/${RECU.id}.json`,
      }),
      Buffer.from(CONTENU_RECU),
    );
  }
});

test("refuse deux destinations dans le même compte R2 avant toute écriture", async () => {
  const frontieres = creerFrontieres();
  const r2 = DESTINATIONS_R2.map((destination) => ({ ...destination }));
  r2[1].compte = r2[0].compte;

  await assert.rejects(
    publierPromotion(optionsPublication({ r2 }), frontieres),
    /deux comptes R2 distincts/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...r2[0],
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    null,
  );
  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: "attestation-tranche-1.json",
    }),
    null,
  );
});

test("refuse le même bucket logique dans les deux comptes avant toute écriture", async () => {
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      nom: "attestation-tranche-1.json",
    }),
    null,
  );
});

test("refuse un canal non canonique avant de construire les clés R2", async () => {
  const frontieres = creerFrontieres();

  await assert.rejects(
    publierPromotion(
      optionsPublication({ canal: "../autre-canal" }),
      frontieres,
    ),
    /canal de publication canonique/s,
  );

  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    null,
  );
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    null,
  );
});

test("refuse un objet R2 existant au hash divergent avant toute nouvelle publication", async () => {
  const frontieres = creerFrontieres();
  const secondaire = DESTINATIONS_R2[1];
  await frontieres.cloudflare.creerObjet({
    ...secondaire,
    cle: "releases/punks-desktop/tranche:1/attestation.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    null,
    "aucune destination saine ne doit être écrite avant la fin du préflight",
  );
  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: "attestation-tranche-1.json",
    }),
    null,
  );
});

test("refuse un asset GitHub existant au hash divergent avant toute écriture R2", async () => {
  const frontieres = creerFrontieres();
  await frontieres.github.creerAsset({
    releaseId: 58,
    nom: "recu-promotion-1.json",
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    null,
  );
});

test("reprend idempotemment une publication partielle dont l'objet existant est exact", async () => {
  const frontieres = creerFrontieres();
  await frontieres.cloudflare.creerObjet({
    ...DESTINATIONS_R2[0],
    cle: "releases/punks-desktop/tranche:1/attestation.json",
    contenu: Buffer.from(CONTENU_ATTESTATION),
  });

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.dejaPresents, ["r2:primaire:attestation"]);
  assert.deepEqual(resultat.crees, [
    "r2:primaire:recu",
    "r2:secondaire:attestation",
    "r2:secondaire:recu",
    "github:attestation",
    "github:recu",
  ]);
  assert.deepEqual(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS_R2[0],
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    Buffer.from(CONTENU_ATTESTATION),
  );
});

test("retourne un succès sans réécriture lorsque les six objets exacts existent", async () => {
  const frontieres = creerFrontieres();
  const objets = [
    {
      sorte: "attestation",
      nom: "attestation-tranche-1.json",
      cle: "releases/punks-desktop/tranche:1/attestation.json",
      contenu: Buffer.from(CONTENU_ATTESTATION),
    },
    {
      sorte: "recu",
      nom: "recu-promotion-1.json",
      cle: `releases/punks-desktop/tranche:1/recus/${RECU.id}.json`,
      contenu: Buffer.from(CONTENU_RECU),
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
      destination.cle.endsWith("/attestation.json")
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
      cle: "releases/punks-desktop/tranche:1/attestation.json",
    }),
    Buffer.from(CONTENU_ATTESTATION),
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
      erreur.details?.publies?.length === 3 &&
      erreur.details?.restants?.length === 3,
  );

  const resultat = await publierPromotion(optionsPublication(), frontieres);

  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.dejaPresents, [
    "r2:primaire:attestation",
    "r2:primaire:recu",
    "r2:secondaire:attestation",
  ]);
  assert.deepEqual(resultat.crees, [
    "r2:secondaire:recu",
    "github:attestation",
    "github:recu",
  ]);
});

test("refuse un Reçu dont l'identifiant ne cite pas le SHA de l'attestation", async () => {
  const frontieres = creerFrontieres();
  const recu = {
    ...RECU,
    id: `recu-promotion-1-${"f".repeat(12)}`,
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
      nom: "attestation-tranche-1.json",
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
    /hash du Reçu diverge de l'attestation/s,
  );

  assert.equal(
    await frontieres.github.lireAsset({
      releaseId: 58,
      nom: "attestation-tranche-1.json",
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
      erreur.code === "VALIDATION_POST_PUBLICATION" &&
      /draft exacte/s.test(erreur.message),
  );

  stable = true;
  const resultat = await publierPromotion(optionsPublication(), frontieres);
  assert.equal(resultat.statut, "deja-publiee");
  assert.deepEqual(resultat.crees, []);
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
      erreur.code === "VALIDATION_POST_PUBLICATION" &&
      /identifiant de draft divergent/s.test(erreur.message),
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
    if (perteArmee && asset.nom === "recu-promotion-1.json") {
      perteArmee = false;
      return;
    }
    return creerAsset(asset);
  };

  await assert.rejects(
    publierPromotion(optionsPublication(), frontieres),
    (erreur) =>
      erreur.code === "VALIDATION_POST_PUBLICATION" &&
      /asset GitHub.*recu.*manquant/s.test(erreur.message),
  );

  const resultat = await publierPromotion(optionsPublication(), frontieres);
  assert.equal(resultat.statut, "reprise");
  assert.deepEqual(resultat.crees, ["github:recu"]);
});

test("le CLI publie les deux fichiers locaux via les seules frontières injectées", async () => {
  const temp = mkdtempSync(join(tmpdir(), "punks-promotion-publish-cli-"));
  const cheminAttestation = join(temp, "attestation-tranche-1.json");
  const cheminRecu = join(temp, "recu-promotion-1.json");
  writeFileSync(cheminAttestation, CONTENU_ATTESTATION, { flag: "wx" });
  writeFileSync(cheminRecu, CONTENU_RECU, { flag: "wx" });
  const sorties = [];
  const erreurs = [];

  const code = await executerCliPublication(
    [
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
      "--r2-primaire",
      "compte-r2-a/punks-promotion-a",
      "--r2-secondaire",
      "compte-r2-b/punks-promotion-b",
    ],
    {
      frontieres: creerFrontieres(),
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
