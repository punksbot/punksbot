import { createHash } from "node:crypto";

export class ErreurPublicationPromotion extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "ErreurPublicationPromotion";
    this.code = code;
    this.details = details;
  }
}

function jsonCanonique(valeur) {
  if (Array.isArray(valeur)) {
    return `[${valeur.map(jsonCanonique).join(",")}]`;
  }
  if (valeur !== null && typeof valeur === "object") {
    return `{${Object.keys(valeur)
      .sort()
      .map((cle) => `${JSON.stringify(cle)}:${jsonCanonique(valeur[cle])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valeur);
}

function sha256Canonique(document) {
  return createHash("sha256").update(jsonCanonique(document)).digest("hex");
}

function sha256Octets(contenu) {
  return createHash("sha256").update(Buffer.from(contenu)).digest("hex");
}

function lireDocument(contenu, nom) {
  const octets = Buffer.from(contenu);
  try {
    return { document: JSON.parse(octets.toString("utf8")), octets };
  } catch (erreur) {
    throw new Error(`${nom} JSON invalide`, { cause: erreur });
  }
}

function identitePromotion({ attestation, recu, tag, canal }) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(canal)) {
    throw new Error("un canal de publication canonique est exigé");
  }
  if (!/^[0-9a-f]{40}$/.test(attestation?.sha)) {
    throw new Error(
      "le SHA exact de l'attestation doit contenir 40 hexadécimaux",
    );
  }
  const tagAttendu = `punks-staging-${attestation.sha}`;
  if (tag !== tagAttendu) {
    throw new Error(
      `le tag doit être exactement ${tagAttendu}, dérivé du SHA exact`,
    );
  }
  const correspondance = /^recu-promotion-([1-9][0-9]*)-([0-9a-f]{12})$/.exec(
    recu.id,
  );
  if (!correspondance) {
    throw new Error("identifiant du Reçu de promotion invalide");
  }
  if (correspondance[2] !== attestation.sha.slice(0, 12)) {
    throw new Error("l'identifiant du Reçu doit citer le SHA de l'attestation");
  }
  const tranche = Number(correspondance[1]);
  if (recu.sha256 !== sha256Canonique(attestation)) {
    throw new Error("le hash du Reçu diverge de l'attestation");
  }
  return {
    sha: attestation.sha,
    tag,
    canal,
    tranche,
    releaseId: `tranche:${tranche}`,
  };
}

function objetsPublication({ identite, attestation, recu }) {
  const cheminR2 = `releases/${identite.canal}/${identite.releaseId}`;
  return [
    {
      sorte: "attestation",
      nomGithub: `attestation-tranche-${identite.tranche}.json`,
      cleR2: `${cheminR2}/attestation.json`,
      contenu: attestation,
    },
    {
      sorte: "recu",
      nomGithub: `recu-promotion-${identite.tranche}.json`,
      cleR2: `${cheminR2}/recus/${recu.document.id}.json`,
      contenu: recu.octets,
    },
  ];
}

function contientCaractereControle(valeur) {
  return [...valeur].some((caractere) => {
    const code = caractere.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
}

function validerDestinationsR2(destinations) {
  if (!Array.isArray(destinations) || destinations.length !== 2) {
    throw new Error("exactement deux destinations R2 sont exigées");
  }
  if (
    destinations[0]?.role !== "primaire" ||
    destinations[1]?.role !== "secondaire"
  ) {
    throw new Error("les rôles R2 doivent être exactement primaire/secondaire");
  }
  for (const destination of destinations) {
    for (const valeur of [destination.compte, destination.bucket]) {
      if (
        typeof valeur !== "string" ||
        valeur.length === 0 ||
        valeur.trim() !== valeur ||
        valeur.includes("/") ||
        contientCaractereControle(valeur)
      ) {
        throw new Error(
          `une identité R2 canonique compte/bucket est exigée pour ${destination.role}`,
        );
      }
    }
  }
  if (destinations[0]?.compte === destinations[1]?.compte) {
    throw new Error("deux comptes R2 distincts sont exigés");
  }
  if (destinations[0]?.bucket === destinations[1]?.bucket) {
    throw new Error("deux buckets R2 distincts sont exigés");
  }
}

function validerDraft(release, identite, releaseIdAttendu = null) {
  if (!release || typeof release !== "object") {
    throw new Error("release GitHub candidate introuvable");
  }
  if (release.id === null || release.id === undefined) {
    throw new Error("release GitHub refusée : identifiant de draft manquant");
  }
  if (releaseIdAttendu !== null && release.id !== releaseIdAttendu) {
    throw new Error("release GitHub refusée : identifiant de draft divergent");
  }
  if (release.tag !== identite.tag) {
    throw new Error("release GitHub refusée : tag divergent");
  }
  if (release.sha !== identite.sha) {
    throw new Error("release GitHub refusée : SHA divergent");
  }
  if (release.draft !== true) {
    throw new Error("release GitHub refusée : la draft exacte est exigée");
  }
}

function exigerVerrouillageCompliance(verrouillage, destination) {
  if (verrouillage?.mode !== "compliance" || verrouillage?.actif !== true) {
    throw new Error(
      `un verrouillage compliance actif est exigé pour ${destination.role}`,
    );
  }
}

function refuserHashDivergent(libelle, existant, attendu) {
  if (existant === null || existant === undefined) {
    return false;
  }
  const hashExistant = sha256Octets(existant);
  const hashAttendu = sha256Octets(attendu);
  if (hashExistant !== hashAttendu) {
    throw new ErreurPublicationPromotion(
      "HASH_DIVERGENT",
      `${libelle} : hash divergent`,
      { hashExistant, hashAttendu },
    );
  }
  return true;
}

function exigerContenuExact(libelle, existant, attendu) {
  if (existant === null || existant === undefined) {
    throw new ErreurPublicationPromotion(
      "OBJET_MANQUANT",
      `${libelle} manquant après création create-only`,
    );
  }
  refuserHashDivergent(libelle, existant, attendu);
}

async function creerObjetR2CreateOnly({ cloudflare, destination, objet }) {
  try {
    await cloudflare.creerObjet({
      ...destination,
      cle: objet.cleR2,
      contenu: objet.contenu,
      modeRequis: "compliance",
    });
    return "cree";
  } catch (erreur) {
    const existant = await cloudflare.lireObjet({
      ...destination,
      cle: objet.cleR2,
    });
    if (existant !== null && existant !== undefined) {
      refuserHashDivergent(
        `objet R2 existant ${destination.role}/${objet.sorte}`,
        existant,
        objet.contenu,
      );
      return "deja-present";
    }
    if (erreur?.code === "ALREADY_EXISTS") {
      throw new ErreurPublicationPromotion(
        "OBJET_EXISTANT_INVERIFIABLE",
        `objet R2 existant ${destination.role}/${objet.sorte} introuvable après le conflit create-only`,
      );
    }
    throw erreur;
  }
}

async function creerAssetGithubCreateOnly({ github, depot, release, objet }) {
  try {
    await github.creerAsset({
      depot,
      releaseId: release.id,
      nom: objet.nomGithub,
      contenu: objet.contenu,
      attendu: {
        tag: release.tag,
        sha: release.sha,
        draft: true,
      },
    });
    return "cree";
  } catch (erreur) {
    const existant = await github.lireAsset({
      depot,
      releaseId: release.id,
      nom: objet.nomGithub,
    });
    if (existant !== null && existant !== undefined) {
      refuserHashDivergent(
        `asset GitHub existant ${objet.sorte}`,
        existant,
        objet.contenu,
      );
      return "deja-present";
    }
    if (erreur?.code === "ALREADY_EXISTS") {
      throw new ErreurPublicationPromotion(
        "OBJET_EXISTANT_INVERIFIABLE",
        `asset GitHub existant ${objet.sorte} introuvable après le conflit create-only`,
      );
    }
    throw erreur;
  }
}

function erreurPartielle(erreur, attendus, crees, dejaPresents) {
  const termines = new Set([...dejaPresents, ...crees]);
  const publies = attendus.filter((identifiant) => termines.has(identifiant));
  if (publies.length === 0) {
    return erreur;
  }
  return new ErreurPublicationPromotion(
    "PUBLICATION_PARTIELLE",
    `publication partielle (${publies.length}/${attendus.length}) : reprise idempotente exigée`,
    {
      reprenable: true,
      publies,
      restants: attendus.filter((identifiant) => !termines.has(identifiant)),
      causeCode: erreur?.code ?? null,
    },
    { cause: erreur },
  );
}

/**
 * Publie create-only une paire attestation/Reçu sur la draft GitHub du
 * candidat et sur exactement deux destinations R2 injectées.
 */
export async function publierPromotion(options, { github, cloudflare }) {
  validerDestinationsR2(options.r2);
  const attestation = lireDocument(options.attestation, "attestation");
  const recu = lireDocument(options.recu, "Reçu");
  const identite = identitePromotion({
    attestation: attestation.document,
    recu: recu.document,
    tag: options.tag,
    canal: options.canal,
  });
  const release = await github.lireDraft({
    depot: options.depot,
    tag: identite.tag,
  });
  validerDraft(release, identite);
  const objets = objetsPublication({
    identite,
    attestation: attestation.octets,
    recu,
  });
  const crees = [];
  const dejaPresents = [];
  const attendus = [
    ...options.r2.flatMap((destination) =>
      objets.map((objet) => `r2:${destination.role}:${objet.sorte}`),
    ),
    ...objets.map((objet) => `github:${objet.sorte}`),
  ];

  for (const destination of options.r2) {
    const verrouillage = await cloudflare.lireVerrouillage(destination);
    exigerVerrouillageCompliance(verrouillage, destination);
  }

  for (const destination of options.r2) {
    for (const objet of objets) {
      const existant = await cloudflare.lireObjet({
        ...destination,
        cle: objet.cleR2,
      });
      if (
        refuserHashDivergent(
          `objet R2 existant ${destination.role}/${objet.sorte}`,
          existant,
          objet.contenu,
        )
      ) {
        dejaPresents.push(`r2:${destination.role}:${objet.sorte}`);
      }
    }
  }
  for (const objet of objets) {
    const existant = await github.lireAsset({
      depot: options.depot,
      releaseId: release.id,
      nom: objet.nomGithub,
    });
    if (
      refuserHashDivergent(
        `asset GitHub existant ${objet.sorte}`,
        existant,
        objet.contenu,
      )
    ) {
      dejaPresents.push(`github:${objet.sorte}`);
    }
  }

  try {
    for (const destination of options.r2) {
      for (const objet of objets) {
        const identifiant = `r2:${destination.role}:${objet.sorte}`;
        if (dejaPresents.includes(identifiant)) {
          continue;
        }
        const resultatCreation = await creerObjetR2CreateOnly({
          cloudflare,
          destination,
          objet,
        });
        if (resultatCreation === "cree") {
          crees.push(identifiant);
        } else {
          dejaPresents.push(identifiant);
        }
      }
    }

    const releaseAvantAssets = await github.lireDraft({
      depot: options.depot,
      tag: identite.tag,
    });
    validerDraft(releaseAvantAssets, identite, release.id);

    for (const objet of objets) {
      const identifiant = `github:${objet.sorte}`;
      if (dejaPresents.includes(identifiant)) {
        continue;
      }
      const resultatCreation = await creerAssetGithubCreateOnly({
        github,
        depot: options.depot,
        release: releaseAvantAssets,
        objet,
      });
      if (resultatCreation === "cree") {
        crees.push(identifiant);
      } else {
        dejaPresents.push(identifiant);
      }
    }
  } catch (erreur) {
    throw erreurPartielle(erreur, attendus, crees, dejaPresents);
  }

  const verifiesPostPublication = [];
  try {
    const releaseFinale = await github.lireDraft({
      depot: options.depot,
      tag: identite.tag,
    });
    validerDraft(releaseFinale, identite, release.id);
    for (const destination of options.r2) {
      const verrouillage = await cloudflare.lireVerrouillage(destination);
      exigerVerrouillageCompliance(verrouillage, destination);
      for (const objet of objets) {
        const existant = await cloudflare.lireObjet({
          ...destination,
          cle: objet.cleR2,
        });
        exigerContenuExact(
          `objet R2 ${destination.role}/${objet.sorte}`,
          existant,
          objet.contenu,
        );
        verifiesPostPublication.push(`r2:${destination.role}:${objet.sorte}`);
      }
    }
    for (const objet of objets) {
      const existant = await github.lireAsset({
        depot: options.depot,
        releaseId: release.id,
        nom: objet.nomGithub,
      });
      exigerContenuExact(
        `asset GitHub ${objet.sorte}`,
        existant,
        objet.contenu,
      );
      verifiesPostPublication.push(`github:${objet.sorte}`);
    }
  } catch (erreur) {
    throw new ErreurPublicationPromotion(
      "VALIDATION_POST_PUBLICATION",
      `publication non validée après relecture de la draft exacte : ${erreur.message}`,
      {
        reprenable: true,
        publies: verifiesPostPublication,
        restants: attendus.filter(
          (identifiant) => !verifiesPostPublication.includes(identifiant),
        ),
        causeCode: erreur?.code ?? null,
      },
      { cause: erreur },
    );
  }

  return {
    statut:
      crees.length === 0 && dejaPresents.length === 6
        ? "deja-publiee"
        : dejaPresents.length > 0
          ? "reprise"
          : "publiee",
    sha: identite.sha,
    tag: identite.tag,
    release: { id: release.id, graphe: identite.releaseId },
    objets: objets.map((objet) => ({
      sorte: objet.sorte,
      sha256: sha256Octets(objet.contenu),
      assetGithub: objet.nomGithub,
      cleR2: objet.cleR2,
    })),
    crees,
    dejaPresents,
  };
}
