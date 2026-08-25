import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import {
  BASELINE_BUZZ,
  CHECKPOINT_RECUPERATION,
  canonicalJson,
  canonicalSha256,
} from "./migration-manifest-lib.mjs";
import {
  validerEmissionLocaleDepuisDossier,
  validerPaireLocale,
} from "./promotion-local-emission-lib.mjs";
import {
  ANCRAGE_APPROBATEURS_RELEASE,
  CANAL_RELEASE,
  empreinteClePubliqueEd25519,
  PUBLICATION,
  validateReleaseGraph,
  verifierSignatureRecu,
} from "./release-graph-lib.mjs";

export class ErreurPublicationPromotion extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "ErreurPublicationPromotion";
    this.code = code;
    this.details = details;
  }
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

function lireGrapheRelease(contenu) {
  const octets = Buffer.from(contenu ?? "");
  const texte = octets.toString("utf8");
  try {
    const document = parseYaml(texte);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new TypeError("objet racine attendu");
    }
    return document;
  } catch (erreur) {
    throw new Error("graphe de release YAML/JSON invalide", { cause: erreur });
  }
}

function estSha256(valeur) {
  return typeof valeur === "string" && /^[0-9a-f]{64}$/.test(valeur);
}

function clesExactes(valeur, cles) {
  return (
    valeur &&
    typeof valeur === "object" &&
    !Array.isArray(valeur) &&
    Object.keys(valeur).sort().join("\u0000") ===
      [...cles].sort().join("\u0000")
  );
}

function identitePromotion({ attestation, recu, tag, canal }) {
  if (canal !== CANAL_RELEASE) {
    throw new Error(
      `le canal de publication doit être exactement ${CANAL_RELEASE}`,
    );
  }
  const tranche = validerPaireLocale(attestation, recu);
  const tagAttendu = `punks-staging-${attestation.sha}`;
  if (tag !== tagAttendu) {
    throw new Error(
      `le tag doit être exactement ${tagAttendu}, dérivé du SHA exact`,
    );
  }
  return {
    sha: attestation.sha,
    tag,
    canal,
    tranche,
    releaseId: `tranche:${tranche}`,
  };
}

function octetsJson(document) {
  return Buffer.from(`${canonicalJson(document)}\n`, "utf8");
}

function registreConfiance(confiance = {}) {
  const registreComplet = confiance.registreApprobateursRelease ?? [];
  const ancrage =
    confiance.ancrageApprobateursRelease ?? ANCRAGE_APPROBATEURS_RELEASE;
  if (
    !Array.isArray(registreComplet) ||
    !estSha256(ancrage) ||
    canonicalSha256(registreComplet) !== ancrage
  ) {
    throw new Error(
      "le registre complet d'approbateurs doit correspondre à l'ancrage de confiance opérateur indépendant",
    );
  }
  const approuves = new Map();
  const empreintes = new Set();
  for (const entree of registreComplet) {
    const id = entree?.id;
    const cle = entree?.["cle-publique-spki"];
    const empreinte = empreinteClePubliqueEd25519(cle);
    if (
      typeof id !== "string" ||
      id.trim() === "" ||
      empreinte === null ||
      approuves.has(id) ||
      empreintes.has(empreinte)
    ) {
      throw new Error("registre d'approbateurs Ed25519 invalide ou dupliqué");
    }
    approuves.set(id, cle);
    empreintes.add(empreinte);
  }
  return approuves;
}

function registreApprobation(approbation, confiance) {
  const selection = approbation?.approbateurs;
  if (!Array.isArray(selection) || selection.length !== 2) {
    throw new Error(
      "exactement deux approbateurs Ed25519 approuvés sont exigés pour finaliser le Reçu",
    );
  }
  const approuves = registreConfiance(confiance);
  const registre = new Map();
  for (const entree of selection) {
    const id = entree?.id;
    const cle = entree?.["cle-publique-spki"];
    if (
      typeof id !== "string" ||
      registre.has(id) ||
      approuves.get(id) !== cle
    ) {
      throw new Error(
        "les deux approbateurs sélectionnés doivent appartenir exactement au registre complet ancré",
      );
    }
    registre.set(id, cle);
  }
  return registre;
}

/**
 * Transforme la paire locale non publiée en paire finale reproductible. La
 * frontière d'approbation ne reçoit que le contenu canonique déjà figé et ne
 * peut ni modifier l'attestation ni choisir une autre identité de release.
 */
export async function finaliserPromotion(
  { attestation, recu, bootstrapR2 = false },
  approbation,
  confiance = {},
) {
  if (typeof bootstrapR2 !== "boolean") {
    throw new Error("bootstrapR2 doit être un booléen explicite");
  }
  validerPaireLocale(attestation, recu);
  const registre = registreApprobation(approbation, confiance);
  if (typeof approbation?.signerRecu !== "function") {
    throw new Error("frontière signerRecu manquante");
  }
  const attestationFinale = {
    ...attestation,
    publiee: [...PUBLICATION],
  };
  const contenuRecu = {
    ...recu.contenu,
    "attestation-sha256": canonicalSha256(attestationFinale),
    approbateurs: [...registre.keys()],
    ...(bootstrapR2
      ? {
          "bootstrap-github-attestation-sha256":
            canonicalSha256(attestationFinale),
        }
      : {}),
  };
  const sha256 = canonicalSha256(contenuRecu);
  const signatures = await approbation.signerRecu({
    contenu: structuredClone(contenuRecu),
    sha256,
    approbateurs: [...registre.keys()],
  });
  if (!Array.isArray(signatures) || signatures.length !== registre.size) {
    throw new Error(
      "la frontière d'approbation doit retourner exactement deux signatures",
    );
  }
  const vus = new Set();
  for (const signature of signatures) {
    const cle = registre.get(signature?.approbateur);
    if (
      !clesExactes(signature, [
        "algorithme",
        "approbateur",
        "cle-publique-spki",
        "valeur",
      ])
    ) {
      throw new Error("signature du Reçu à schéma fermé exigée");
    }
    if (
      cle === undefined ||
      vus.has(signature.approbateur) ||
      signature?.["cle-publique-spki"] !== cle ||
      !verifierSignatureRecu(contenuRecu, signature, cle)
    ) {
      throw new Error(
        "signature du Reçu invalide ou étrangère au registre approuvé",
      );
    }
    vus.add(signature.approbateur);
  }
  const signaturesOrdonnees = [...registre.keys()].map((approbateur) =>
    signatures.find((signature) => signature.approbateur === approbateur),
  );
  const recuFinal = {
    id: recu.id,
    contenu: contenuRecu,
    sha256,
    signatures: signaturesOrdonnees,
    publication: [...PUBLICATION],
  };
  return {
    attestation: attestationFinale,
    recu: recuFinal,
    octets: {
      attestation: octetsJson(attestationFinale),
      recu: octetsJson(recuFinal),
    },
  };
}

function objetsPublication({ identite, attestation, recu }) {
  const cheminR2 = `releases/${identite.canal}/${identite.releaseId}`;
  const attestationSha256 = canonicalSha256(attestation.document);
  const recuSha256 = recu.document.sha256;
  return [
    {
      sorte: "attestation",
      nomGithub: `attestation-${attestationSha256}.json`,
      cleR2: `${cheminR2}/attestations/${attestationSha256}.json`,
      contenu: attestation.octets,
    },
    {
      sorte: "recu",
      nomGithub: `recu-${recuSha256}.json`,
      cleR2: `${cheminR2}/recus/${recuSha256}.json`,
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

function validerDestinationsR2(destinations, confiance) {
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
  if (
    !estSha256(confiance?.ancrageDestinationsR2) ||
    canonicalSha256(destinations) !== confiance.ancrageDestinationsR2
  ) {
    throw new Error(
      "les deux destinations R2 doivent correspondre exactement à l'ancrage opérateur approuvé",
    );
  }
}

function validerDestinationsDuGraphe(destinations, graphe) {
  const attendues = graphe?.publication?.r2?.destinations;
  const projection = Array.isArray(attendues)
    ? attendues.map(({ role, compte, bucket }) => ({ role, compte, bucket }))
    : null;
  if (canonicalSha256(destinations) !== canonicalSha256(projection)) {
    throw new Error(
      "les destinations R2 doivent correspondre exactement au graphe de release validé",
    );
  }
}

function validerContextePublicationPromotion(
  sourceGraphe,
  identite,
  destinations,
  bootstrapR2,
  confiance,
) {
  const graphe = lireGrapheRelease(sourceGraphe);
  let erreurs;
  try {
    erreurs = validateReleaseGraph(graphe, {
      ancrageApprobateursRelease:
        confiance?.ancrageApprobateursRelease ?? ANCRAGE_APPROBATEURS_RELEASE,
      fileExists: () => true,
    });
  } catch (erreur) {
    throw new Error("le graphe de release ne peut pas être validé", {
      cause: erreur,
    });
  }
  if (erreurs.length > 0) {
    throw new Error(
      `le graphe de release est invalide : ${erreurs.slice(0, 5).join(" ; ")}`,
    );
  }
  const bootstrap = graphe?.politique?.immuabilite?.["bootstrap-r2"];
  if (
    graphe?.version !== 1 ||
    graphe?.["checkpoint-recuperation"] !== CHECKPOINT_RECUPERATION ||
    graphe?.["baseline-buzz"] !== BASELINE_BUZZ ||
    graphe?.canal !== identite.canal ||
    bootstrap?.["premiere-activation"] !== "github-puis-r2" ||
    bootstrap?.reference !== "bootstrap-github-attestation-sha256"
  ) {
    throw new Error(
      "le graphe de release exact et sa politique GitHub puis R2 sont exigés avant publication",
    );
  }
  validerDestinationsDuGraphe(destinations, graphe);
  const candidats = Array.isArray(graphe.releases)
    ? graphe.releases.filter(
        (release) =>
          release?.id === identite.releaseId &&
          release?.tranche === identite.tranche,
      )
    : [];
  if (
    candidats.length !== 1 ||
    candidats[0]?.etat !== "preparation" ||
    candidats[0]?.sha !== null
  ) {
    throw new Error(
      "la publication initiale doit viser l'unique candidat encore en préparation du graphe",
    );
  }
  const bootstrapAttendu = identite.tranche === 1;
  if (bootstrapR2 !== bootstrapAttendu) {
    throw new Error(
      bootstrapAttendu
        ? "la première tranche impose le bootstrap GitHub puis R2 avant toute écriture"
        : "le bootstrap R2 est réservé à la première tranche",
    );
  }
  return graphe;
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
        draft: release.draft,
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

async function publierObjetsImmuables({
  options,
  github,
  cloudflare,
  release,
  lireRelease,
  validerRelease,
  objets,
}) {
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
        if (dejaPresents.includes(identifiant)) continue;
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
    const releaseAvantAssets = await lireRelease();
    validerRelease(releaseAvantAssets, release.id);
    for (const objet of objets) {
      const identifiant = `github:${objet.sorte}`;
      if (dejaPresents.includes(identifiant)) continue;
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
    const releaseFinale = await lireRelease();
    validerRelease(releaseFinale, release.id);
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
      `publication non validée après relecture de la release exacte : ${erreur.message}`,
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
      crees.length === 0 && dejaPresents.length === attendus.length
        ? "deja-publiee"
        : dejaPresents.length > 0
          ? "reprise"
          : "publiee",
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

const TYPES_RECUS_OPERATIONNELS = new Set([
  "execution-demarrage",
  "execution-evenement",
  "etape",
  "transition",
  "retrait",
  "roll-forward",
  "retour-punks",
  "invalidation-attestation",
]);

function publicationExacte(publication) {
  return (
    Array.isArray(publication) &&
    publication.length === PUBLICATION.length &&
    PUBLICATION.every((valeur, index) => publication[index] === valeur)
  );
}

function identiteReleaseOperationnelle(options, recu) {
  if (options.canal !== CANAL_RELEASE) {
    throw new Error(
      `le canal de publication doit être exactement ${CANAL_RELEASE}`,
    );
  }
  if (
    !/^[0-9a-f]{40}$/.test(options.sha ?? "") ||
    options.sha === BASELINE_BUZZ ||
    options.sha === CHECKPOINT_RECUPERATION
  ) {
    throw new Error("un SHA Punks exact non réservé est exigé");
  }
  if (options.tag !== `punks-staging-${options.sha}`) {
    throw new Error("le tag opérationnel doit dériver du SHA Punks exact");
  }
  const releaseId = options.releaseId;
  const segments = typeof releaseId === "string" ? releaseId.split("/") : [];
  if (
    segments.length === 0 ||
    releaseId.trim() !== releaseId ||
    contientCaractereControle(releaseId) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error("un release-id canonique est exigé pour le layout R2");
  }
  if (typeof options.draft !== "boolean") {
    throw new Error("l'état draft/published attendu de la release est exigé");
  }
  const contenu = recu.contenu;
  const identiteRecue =
    contenu?.["release-id"] ?? contenu?.cible ?? contenu?.["release-id-cible"];
  if (identiteRecue !== releaseId) {
    throw new Error("le Reçu doit lier le release-id publié exact");
  }
  const shaLie =
    contenu?.type === "retrait"
      ? contenu.sha
      : contenu?.type === "retour-punks"
        ? contenu["sha-cible"]
        : contenu?.["sha-punks"];
  const champsShaConcurrents =
    contenu?.type === "retrait"
      ? ["sha-punks", "sha-cible"]
      : contenu?.type === "retour-punks"
        ? ["sha", "sha-punks"]
        : ["sha", "sha-cible"];
  if (champsShaConcurrents.some((champ) => champ in contenu)) {
    throw new Error("le Reçu contient une identité SHA concurrente interdite");
  }
  if (shaLie !== options.sha) {
    throw new Error(
      "le Reçu doit lier cryptographiquement le SHA Punks exact de la GitHub Release",
    );
  }
  return {
    canal: options.canal,
    releaseId,
    sha: options.sha,
    tag: options.tag,
    draft: options.draft,
  };
}

function validerRecuOperationnelSigne(recu, confiance) {
  const contenu = recu?.contenu;
  if (
    !recu ||
    typeof recu !== "object" ||
    Array.isArray(recu) ||
    typeof recu.id !== "string" ||
    recu.id.trim() === "" ||
    !contenu ||
    typeof contenu !== "object" ||
    Array.isArray(contenu) ||
    contenu.schema !== "punks.release-receipt.v1" ||
    contenu.id !== recu.id ||
    !TYPES_RECUS_OPERATIONNELS.has(contenu.type) ||
    recu.sha256 !== canonicalSha256(contenu) ||
    !publicationExacte(recu.publication)
  ) {
    throw new Error(
      "un Reçu opérationnel signé, content-addressé et marqué release+r2 est exigé",
    );
  }
  const registre = registreConfiance(confiance);
  const signatures = recu.signatures;
  if (!Array.isArray(signatures) || signatures.length !== 2) {
    throw new Error("exactement deux signatures approuvées sont exigées");
  }
  const vus = new Set();
  for (const signature of signatures) {
    const cle = registre.get(signature?.approbateur);
    if (
      cle === undefined ||
      vus.has(signature.approbateur) ||
      signature?.algorithme !== "ed25519" ||
      signature?.["cle-publique-spki"] !== cle ||
      !verifierSignatureRecu(contenu, signature, cle)
    ) {
      throw new Error(
        "les signatures du Reçu doivent provenir de deux clés Ed25519 ancrées distinctes",
      );
    }
    vus.add(signature.approbateur);
  }
  if (
    contenu.approbateurs !== undefined &&
    (!Array.isArray(contenu.approbateurs) ||
      contenu.approbateurs.length !== 2 ||
      contenu.approbateurs.some((id) => !vus.has(id)))
  ) {
    throw new Error(
      "les approbateurs du contenu doivent correspondre exactement aux signatures",
    );
  }
  return contenu;
}

function indexerRecusOperationnels(graph) {
  const index = [];
  const ajouter = (recu, contexte = {}) => {
    if (!recu || typeof recu !== "object") return;
    index.push({ recu, ...contexte });
    for (const recuEtape of Array.isArray(recu.contenu?.cadence)
      ? recu.contenu.cadence
      : []) {
      ajouter(recuEtape, contexte);
    }
    ajouter(recu.contenu?.["recu-etape"], contexte);
  };
  for (const release of Array.isArray(graph?.releases) ? graph.releases : []) {
    const attestations = new Map(
      (Array.isArray(release?.journal) ? release.journal : [])
        .filter((entree) => typeof entree?.recu === "string")
        .map((entree) => [entree.recu, entree.attestation]),
    );
    for (const recu of Array.isArray(release?.recus) ? release.recus : []) {
      ajouter(recu, { attestation: attestations.get(recu?.id) });
    }
    for (const entree of Array.isArray(release?.journal)
      ? release.journal
      : []) {
      const candidat = entree?.graphe?.contenu?.release;
      for (const recu of Array.isArray(candidat?.recus) ? candidat.recus : []) {
        ajouter(recu);
      }
    }
  }
  for (const execution of Array.isArray(graph?.executions)
    ? graph.executions
    : []) {
    ajouter(execution?.["recu-demarrage"]);
    for (const evenement of Array.isArray(execution?.evenements)
      ? execution.evenements
      : []) {
      ajouter(evenement);
    }
  }
  for (const recuperation of Array.isArray(graph?.recuperations)
    ? graph.recuperations
    : []) {
    ajouter(recuperation?.recu);
    ajouter(recuperation?.certificat?.recu);
    for (const nom of ["precedent", "nouveau"]) {
      const candidat = recuperation?.graphes?.[nom]?.contenu?.release;
      for (const recu of Array.isArray(candidat?.recus) ? candidat.recus : []) {
        ajouter(recu);
      }
    }
  }
  for (const invalidation of Array.isArray(
    graph?.["invalidations-attestations"],
  )
    ? graph["invalidations-attestations"]
    : []) {
    ajouter(invalidation?.recu, {
      attestation: invalidation?.["attestation-supersedante"] ?? undefined,
    });
  }
  return index;
}

function verdictRecuOperationnel(recu) {
  const contenu = recu?.contenu;
  if (contenu?.type === "execution-demarrage") return "demarre";
  if (contenu?.type === "retrait") return "scelle";
  if (contenu?.type === "execution-evenement") {
    if (["echec", "quarantaine"].includes(contenu.nature)) return "rouge";
    if (contenu.nature === "pause") return "pause";
    if (contenu.nature === "reprise") return "reprise";
  }
  const verdicts = Array.isArray(contenu?.["verdicts-metriques"])
    ? contenu["verdicts-metriques"]
    : [];
  const critiqueOuvert = (
    Array.isArray(contenu?.incidents) ? contenu.incidents : []
  ).some(
    (incident) =>
      incident?.criticite === "critique" && incident?.statut !== "resolu",
  );
  return !critiqueOuvert &&
    verdicts.every((verdict) => verdict?.resultat === "vert")
    ? "vert"
    : "rouge";
}

/** Construit le marqueur PARITY canonique d'un Reçu opérationnel signé. */
export function entreeParityRecu(recu) {
  if (
    !recu ||
    !TYPES_RECUS_OPERATIONNELS.has(recu?.contenu?.type) ||
    typeof recu.id !== "string" ||
    !estSha256(recu.sha256)
  ) {
    throw new Error("Reçu opérationnel invalide pour l'index PARITY");
  }
  const entree = {
    id: recu.id,
    sha256: recu.sha256,
    verdict: verdictRecuOperationnel(recu),
  };
  return {
    ...entree,
    marqueur: `<!-- punks-release-receipt ${canonicalJson(entree)} -->`,
  };
}

/** Énumère sans doublon les marqueurs PARITY exigés par le graphe. */
export function entreesParityDuGraphe(graph) {
  const uniques = new Map();
  for (const { recu } of indexerRecusOperationnels(graph)) {
    if (!TYPES_RECUS_OPERATIONNELS.has(recu?.contenu?.type)) continue;
    const entree = entreeParityRecu(recu);
    const cle = `${entree.id}\u0000${entree.sha256}`;
    if (!uniques.has(cle)) uniques.set(cle, entree);
  }
  return [...uniques.values()];
}

/** Compare l'index PARITY textuel aux Reçus exacts du graphe. */
export function validateParityReceiptIndex(graph, source) {
  const texte = Buffer.from(source ?? "").toString("utf8");
  const attendues = entreesParityDuGraphe(graph);
  const presentes = texte
    .split(/\r?\n/u)
    .filter((ligne) => ligne.startsWith("<!-- punks-release-receipt "));
  const erreurs = [];
  for (const entree of attendues) {
    if (!presentes.includes(entree.marqueur)) {
      erreurs.push(
        `PARITY : digest/verdict manquant ou divergent pour le Reçu « ${entree.id} » (${entree.sha256})`,
      );
    }
  }
  const marqueursAttendus = new Set(attendues.map((entree) => entree.marqueur));
  const marqueursVus = new Set();
  for (const marqueur of presentes) {
    if (marqueursVus.has(marqueur)) {
      erreurs.push(`PARITY : marqueur de Reçu dupliqué « ${marqueur} »`);
    } else {
      marqueursVus.add(marqueur);
    }
    if (!marqueursAttendus.has(marqueur)) {
      erreurs.push(
        `PARITY : marqueur de Reçu inconnu ou non canonique « ${marqueur} »`,
      );
    }
  }
  return erreurs;
}

function validerPresenceDansGraphe(graph, recu, confiance) {
  const ancrage =
    confiance?.ancrageApprobateursRelease ?? ANCRAGE_APPROBATEURS_RELEASE;
  let erreurs;
  try {
    erreurs = validateReleaseGraph(graph, {
      ancrageApprobateursRelease: ancrage,
      fileExists: () => true,
    });
  } catch (erreur) {
    throw new Error("le graphe de release ne peut pas être validé", {
      cause: erreur,
    });
  }
  if (erreurs.length > 0) {
    throw new Error(
      `le graphe de release est invalide : ${erreurs.slice(0, 5).join(" ; ")}`,
    );
  }
  const correspondances = indexerRecusOperationnels(graph).filter(
    (candidat) =>
      candidat.recu?.id === recu.id &&
      candidat.recu?.sha256 === recu.sha256 &&
      canonicalSha256(candidat.recu) === canonicalSha256(recu),
  );
  if (correspondances.length === 0) {
    throw new Error(
      "le Reçu opérationnel exact doit appartenir au graphe de release intégralement validé",
    );
  }
  const attestations = correspondances
    .map((correspondance) => correspondance.attestation)
    .filter((attestation) => attestation !== undefined);
  return { attestations };
}

function validerReleaseOperationnelle(
  release,
  identite,
  releaseIdAttendu = null,
) {
  if (!release || typeof release !== "object") {
    throw new Error("release GitHub opérationnelle introuvable");
  }
  if (release.id === null || release.id === undefined) {
    throw new Error("release GitHub opérationnelle sans identifiant");
  }
  if (releaseIdAttendu !== null && release.id !== releaseIdAttendu) {
    throw new Error("identifiant de release GitHub divergent");
  }
  if (
    release.tag !== identite.tag ||
    release.sha !== identite.sha ||
    release.draft !== identite.draft
  ) {
    throw new Error(
      "tag, SHA ou état draft/published de la release GitHub divergent",
    );
  }
}

/**
 * Publie un Reçu post-promotion déjà signé et, le cas échéant, l'attestation
 * de transition ou de supersession qu'il lie, sous des noms GitHub et clés R2
 * content-addressés.
 */
export async function publierRecuOperationnel(
  options,
  { github, cloudflare, confiance },
) {
  validerDestinationsR2(options.r2, confiance);
  if (typeof github?.lireRelease !== "function") {
    throw new Error("frontière github.lireRelease manquante");
  }
  const recu = lireDocument(options.recu, "Reçu opérationnel");
  const contenuRecu = validerRecuOperationnelSigne(recu.document, confiance);
  const graphe = lireGrapheRelease(options.graphe);
  const erreursParity = validateParityReceiptIndex(graphe, options.parity);
  if (erreursParity.length > 0) {
    throw new Error(
      `l'index digest/verdict cloudflare/PARITY.md est invalide : ${erreursParity
        .slice(0, 3)
        .join(" ; ")}`,
    );
  }
  validerDestinationsDuGraphe(options.r2, graphe);
  const presence = validerPresenceDansGraphe(graphe, recu.document, confiance);
  const identite = identiteReleaseOperationnelle(options, recu.document);
  const cheminR2 = `releases/${identite.canal}/${identite.releaseId}`;
  const objets = [];
  const exigeAttestationTransition = contenuRecu.type === "transition";
  const exigeAttestationSupersedante =
    contenuRecu.type === "invalidation-attestation" &&
    estSha256(contenuRecu["attestation-supersedante-sha256"]);
  if (exigeAttestationTransition || exigeAttestationSupersedante) {
    if (options.attestation === undefined) {
      throw new Error("l'attestation liée au Reçu opérationnel est exigée");
    }
    const attestation = lireDocument(
      options.attestation,
      exigeAttestationTransition
        ? "attestation de transition"
        : "attestation supersédante",
    );
    const attestationSha256 = canonicalSha256(attestation.document);
    const identiteAttestationValide = exigeAttestationTransition
      ? attestation.document?.schema === "punks.transition-attestation.v1" &&
        attestation.document?.["release-id"] === identite.releaseId &&
        attestation.document?.sha === identite.sha &&
        contenuRecu["attestation-sha256"] === attestationSha256
      : attestation.document?.schema === "punks.attestation-supersedante.v1" &&
        contenuRecu["attestation-supersedante-sha256"] === attestationSha256;
    if (
      !identiteAttestationValide ||
      !publicationExacte(attestation.document?.publiee) ||
      !presence.attestations.some(
        (attestationGraphe) =>
          canonicalSha256(attestationGraphe) === attestationSha256,
      )
    ) {
      throw new Error(
        "l'attestation doit être exacte, liée au Reçu et marquée release+r2",
      );
    }
    objets.push({
      sorte: "attestation",
      nomGithub: `attestation-${attestationSha256}.json`,
      cleR2: `${cheminR2}/attestations/${attestationSha256}.json`,
      contenu: octetsJson(attestation.document),
    });
  } else if (options.attestation !== undefined) {
    throw new Error(
      "une attestation séparée n'est admise que pour un Reçu de transition ou de supersession",
    );
  }
  objets.push({
    sorte: "recu",
    nomGithub: `recu-${recu.document.sha256}.json`,
    cleR2: `${cheminR2}/recus/${recu.document.sha256}.json`,
    contenu: octetsJson(recu.document),
  });

  const lireRelease = () =>
    github.lireRelease({ depot: options.depot, tag: identite.tag });
  const release = await lireRelease();
  validerReleaseOperationnelle(release, identite);
  const resultat = await publierObjetsImmuables({
    options,
    github,
    cloudflare,
    release,
    lireRelease,
    validerRelease: (candidate, releaseIdAttendu) =>
      validerReleaseOperationnelle(candidate, identite, releaseIdAttendu),
    objets,
  });
  return {
    ...resultat,
    sha: identite.sha,
    tag: identite.tag,
    release: { id: release.id, graphe: identite.releaseId },
    recu: { id: recu.document.id, sha256: recu.document.sha256 },
    parity: entreeParityRecu(recu.document),
  };
}

/**
 * Publie create-only une paire attestation/Reçu sur la draft GitHub du
 * candidat et sur exactement deux destinations R2 injectées.
 */
export async function publierPromotion(
  options,
  { github, cloudflare, approbation, confiance },
) {
  validerDestinationsR2(options.r2, confiance);
  const dossier = lireDocument(options.dossier, "dossier de promotion");
  const attestation = lireDocument(options.attestation, "attestation");
  const recu = lireDocument(options.recu, "Reçu");
  const identite = identitePromotion({
    attestation: attestation.document,
    recu: recu.document,
    tag: options.tag,
    canal: options.canal,
  });
  validerEmissionLocaleDepuisDossier(
    dossier.document,
    options.contexteDossier,
    attestation.document,
    recu.document,
  );
  validerContextePublicationPromotion(
    options.graphe,
    identite,
    options.r2,
    options.bootstrapR2,
    confiance,
  );
  const finalisee = await finaliserPromotion(
    {
      attestation: attestation.document,
      recu: recu.document,
      bootstrapR2: options.bootstrapR2,
    },
    approbation,
    confiance,
  );
  const release = await github.lireDraft({
    depot: options.depot,
    tag: identite.tag,
  });
  validerDraft(release, identite);
  const objets = objetsPublication({
    identite,
    attestation: {
      document: finalisee.attestation,
      octets: finalisee.octets.attestation,
    },
    recu: {
      document: finalisee.recu,
      octets: finalisee.octets.recu,
    },
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

  const publierR2 = async () => {
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
  };
  const publierGithub = async () => {
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
  };
  const verifierBootstrapGithub = async () => {
    const releaseBootstrap = await github.lireDraft({
      depot: options.depot,
      tag: identite.tag,
    });
    validerDraft(releaseBootstrap, identite, release.id);
    for (const objet of objets) {
      const existant = await github.lireAsset({
        depot: options.depot,
        releaseId: release.id,
        nom: objet.nomGithub,
      });
      exigerContenuExact(
        `preuve de bootstrap GitHub ${objet.sorte}`,
        existant,
        objet.contenu,
      );
    }
  };

  try {
    if (options.bootstrapR2 === true) {
      await publierGithub();
      await verifierBootstrapGithub();
      await publierR2();
    } else {
      await publierR2();
      await publierGithub();
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
