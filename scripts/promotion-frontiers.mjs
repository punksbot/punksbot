import {
  createPrivateKey,
  createPublicKey,
  sign as signerEd25519,
} from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { canonicalJson, canonicalSha256 } from "./migration-manifest-lib.mjs";
import { PUNKS_CLOUDFLARE_ACCOUNT_ID } from "./release-graph-lib.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMPTE_R2_RE = /^[0-9a-f]{32}$/;
const BUCKET_R2_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const ROLES_R2 = ["primaire", "secondaire"];

function exigerVariable(env, nom) {
  const valeur = env[nom];
  if (typeof valeur !== "string" || valeur.trim() === "") {
    throw new Error(`variable protégée ${nom} manquante`);
  }
  return valeur;
}

function parserJsonProtege(env, nom) {
  try {
    return JSON.parse(exigerVariable(env, nom));
  } catch (erreur) {
    throw new Error(`variable protégée ${nom} : JSON invalide`, {
      cause: erreur,
    });
  }
}

async function corpsErreur(reponse) {
  const texte = await reponse.text();
  return texte.slice(0, 1_000).replaceAll(/\s+/gu, " ").trim();
}

function erreurExistant(message) {
  const erreur = new Error(message);
  erreur.code = "ALREADY_EXISTS";
  return erreur;
}

function clientGithub({ depot, token, fetchImpl }) {
  const entetes = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const lireObjetGit = async (url, libelle) => {
    const reponse = await fetchImpl(url, { headers: entetes });
    if (!reponse.ok) {
      throw new Error(
        `${libelle} illisible (${reponse.status}) : ${await corpsErreur(reponse)}`,
      );
    }
    return reponse.json();
  };
  const resoudreShaTag = async (tag) => {
    const reference = await lireObjetGit(
      `https://api.github.com/repos/${depot}/git/ref/tags/${encodeURIComponent(tag)}`,
      `référence GitHub ${tag}`,
    );
    let objet = reference?.object;
    const visites = new Set();
    for (let profondeur = 0; profondeur < 16; profondeur += 1) {
      if (objet?.type === "commit" && /^[0-9a-f]{40}$/.test(objet?.sha ?? "")) {
        return objet.sha;
      }
      if (
        objet?.type !== "tag" ||
        !/^[0-9a-f]{40}$/.test(objet?.sha ?? "") ||
        visites.has(objet.sha)
      ) {
        break;
      }
      visites.add(objet.sha);
      const tagGit = await lireObjetGit(
        `https://api.github.com/repos/${depot}/git/tags/${objet.sha}`,
        `objet tag GitHub ${objet.sha}`,
      );
      objet = tagGit?.object;
    }
    throw new Error(
      `référence GitHub ${tag} : chaîne de tags invalide, cyclique ou sans commit exact`,
    );
  };
  const lireRelease = async ({ tag }) => {
    const reponse = await fetchImpl(
      `https://api.github.com/repos/${depot}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: entetes },
    );
    if (!reponse.ok) {
      throw new Error(
        `GitHub release ${tag} illisible (${reponse.status}) : ${await corpsErreur(reponse)}`,
      );
    }
    const release = await reponse.json();
    const sha = await resoudreShaTag(tag);
    return {
      id: release.id,
      tag: release.tag_name,
      sha,
      draft: release.draft,
      assets: Array.isArray(release.assets) ? release.assets : [],
    };
  };
  const listerAssets = async (releaseId) => {
    const assets = [];
    for (let page = 1; page <= 100; page += 1) {
      const reponse = await fetchImpl(
        `https://api.github.com/repos/${depot}/releases/${releaseId}/assets?per_page=100&page=${page}`,
        { headers: entetes },
      );
      if (!reponse.ok) {
        throw new Error(
          `assets GitHub illisibles (${reponse.status}) : ${await corpsErreur(reponse)}`,
        );
      }
      const lot = await reponse.json();
      if (!Array.isArray(lot)) {
        throw new Error("GitHub a retourné une liste d'assets malformée");
      }
      assets.push(...lot);
      if (lot.length < 100) return assets;
    }
    throw new Error("plus de 10 000 assets GitHub : pagination refusée");
  };
  return {
    lireRelease,
    lireDraft: lireRelease,
    async lireAsset({ releaseId, nom }) {
      const assets = await listerAssets(releaseId);
      const asset = assets.find((element) => element?.name === nom);
      if (!asset) return null;
      const reponse = await fetchImpl(asset.url, {
        headers: { ...entetes, Accept: "application/octet-stream" },
        redirect: "follow",
      });
      if (!reponse.ok) {
        throw new Error(
          `asset GitHub ${nom} illisible (${reponse.status}) : ${await corpsErreur(reponse)}`,
        );
      }
      return Buffer.from(await reponse.arrayBuffer());
    },
    async creerAsset({ releaseId, nom, contenu }) {
      const reponse = await fetchImpl(
        `https://uploads.github.com/repos/${depot}/releases/${releaseId}/assets?name=${encodeURIComponent(nom)}`,
        {
          method: "POST",
          headers: {
            ...entetes,
            "Content-Length": String(Buffer.byteLength(contenu)),
            "Content-Type": "application/json",
          },
          body: contenu,
        },
      );
      if (reponse.status === 422) {
        throw erreurExistant(`asset GitHub ${nom} déjà présent`);
      }
      if (!reponse.ok) {
        throw new Error(
          `création asset GitHub ${nom} refusée (${reponse.status}) : ${await corpsErreur(reponse)}`,
        );
      }
    },
  };
}

function tokensR2(env) {
  const lireRole = (role, prefixe) => ({
    role,
    apiToken: exigerVariable(env, `${prefixe}_API_TOKEN`),
    accessKeyId: exigerVariable(env, `${prefixe}_ACCESS_KEY_ID`),
    secretAccessKey: exigerVariable(env, `${prefixe}_SECRET_ACCESS_KEY`),
  });
  const primaire = lireRole("primaire", "PUNKS_R2_PRIMARY");
  const secondaire = lireRole("secondaire", "PUNKS_R2_RECOVERY");
  if (
    primaire.accessKeyId === secondaire.accessKeyId ||
    primaire.secretAccessKey === secondaire.secretAccessKey
  ) {
    throw new Error(
      "les rôles R2 primaire et récupération exigent des identifiants S3 distincts",
    );
  }
  return { primaire, secondaire };
}

async function octetsCorpsS3(corps) {
  if (corps === undefined || corps === null) return Buffer.alloc(0);
  if (typeof corps.transformToByteArray === "function") {
    return Buffer.from(await corps.transformToByteArray());
  }
  if (typeof corps.arrayBuffer === "function") {
    return Buffer.from(await corps.arrayBuffer());
  }
  if (corps instanceof Uint8Array) return Buffer.from(corps);
  if (typeof corps[Symbol.asyncIterator] === "function") {
    const morceaux = [];
    for await (const morceau of corps) morceaux.push(Buffer.from(morceau));
    return Buffer.concat(morceaux);
  }
  throw new Error("R2 S3 a retourné un corps objet illisible");
}

function statutErreurS3(erreur) {
  return erreur?.$metadata?.httpStatusCode ?? erreur?.statusCode ?? null;
}

function destinationsR2Canoniques(destinations) {
  if (!Array.isArray(destinations) || destinations.length !== 2) {
    throw new Error("exactement deux destinations R2 sont requises");
  }
  const normalisees = destinations.map((destination, index) => {
    const role = destination?.role;
    const compte = destination?.compte;
    const bucket = destination?.bucket;
    if (
      Object.keys(destination ?? {})
        .sort()
        .join("\u0000") !== "bucket\u0000compte\u0000role"
    ) {
      throw new Error(`destination R2 ${index} : schéma fermé invalide`);
    }
    if (role !== ROLES_R2[index]) {
      throw new Error(
        `destination R2 ${index} : rôle ${ROLES_R2[index]} exact requis`,
      );
    }
    if (!COMPTE_R2_RE.test(compte ?? "")) {
      throw new Error(
        `destination R2 ${role} : compte R2 Cloudflare canonique requis`,
      );
    }
    if (compte !== PUNKS_CLOUDFLARE_ACCOUNT_ID) {
      throw new Error(
        `destination R2 ${role} : compte Cloudflare Punks exact requis`,
      );
    }
    if (!BUCKET_R2_RE.test(bucket ?? "")) {
      throw new Error(
        `destination R2 ${role} : nom de bucket Cloudflare canonique requis`,
      );
    }
    return { role, compte, bucket };
  });
  if (
    normalisees[0].compte === normalisees[1].compte &&
    normalisees[0].bucket === normalisees[1].bucket
  ) {
    throw new Error("les deux destinations R2 doivent être distinctes");
  }
  return normalisees;
}

function clientCloudflare({
  tokens,
  destinations,
  fetchImpl,
  s3RequestHandler,
}) {
  const clientsS3 = new Map();
  const destinationsParRole = new Map(
    destinations.map((destination) => [destination.role, destination]),
  );
  const exigerDestinationAncree = (destination) => {
    const ancree = destinationsParRole.get(destination?.role);
    if (
      !ancree ||
      destination?.compte !== ancree.compte ||
      destination?.bucket !== ancree.bucket
    ) {
      throw new Error(
        `destination R2 ${String(destination?.role)} différente de la destination ancrée exacte`,
      );
    }
    return ancree;
  };
  const secrets = (destination) => {
    exigerDestinationAncree(destination);
    const secret = tokens[destination.role];
    if (!secret) {
      throw new Error(`rôle R2 inconnu : ${String(destination.role)}`);
    }
    return secret;
  };
  const entetes = (destination) => {
    return { Authorization: `Bearer ${secrets(destination).apiToken}` };
  };
  const clientS3 = (destination) => {
    const ancree = exigerDestinationAncree(destination);
    const cle = ancree.role;
    if (!clientsS3.has(cle)) {
      const secret = secrets(ancree);
      clientsS3.set(
        cle,
        new S3Client({
          region: "auto",
          endpoint: `https://${ancree.compte}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: secret.accessKeyId,
            secretAccessKey: secret.secretAccessKey,
          },
          ...(s3RequestHandler ? { requestHandler: s3RequestHandler } : {}),
        }),
      );
    }
    return clientsS3.get(cle);
  };
  return {
    async lireVerrouillage(destination) {
      const reponse = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(destination.compte)}/r2/buckets/${encodeURIComponent(destination.bucket)}/lock`,
        { headers: entetes(destination) },
      );
      if (!reponse.ok) {
        throw new Error(
          `verrouillage R2 ${destination.role} illisible (${reponse.status}) : ${await corpsErreur(reponse)}`,
        );
      }
      const enveloppe = await reponse.json();
      const cleRequise =
        typeof destination.cle === "string" && destination.cle.length > 0
          ? destination.cle
          : "releases/";
      const actif =
        enveloppe?.success === true &&
        Array.isArray(enveloppe?.result?.rules) &&
        enveloppe.result.rules.some((regle) => {
          const prefixe = regle?.prefix ?? "";
          return (
            regle?.enabled === true &&
            regle?.condition?.type === "Indefinite" &&
            typeof prefixe === "string" &&
            (prefixe === "" || cleRequise.startsWith(prefixe))
          );
        });
      return { mode: "compliance", actif };
    },
    async lireObjet(destination) {
      try {
        const reponse = await clientS3(destination).send(
          new GetObjectCommand({
            Bucket: destination.bucket,
            Key: destination.cle,
          }),
        );
        return octetsCorpsS3(reponse.Body);
      } catch (erreur) {
        if (statutErreurS3(erreur) === 404 || erreur?.name === "NoSuchKey") {
          return null;
        }
        throw new Error(
          `objet R2 S3 ${destination.role}/${destination.cle} illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
          { cause: erreur },
        );
      }
    },
    async creerObjet(destination) {
      const commande = new PutObjectCommand({
        Bucket: destination.bucket,
        Key: destination.cle,
        Body: destination.contenu,
        ContentType: "application/json",
      });
      commande.middlewareStack.add(
        (suivant) => async (argumentsCommande) => {
          if (!argumentsCommande.request?.headers) {
            throw new Error("requête PutObject S3 malformée avant signature");
          }
          argumentsCommande.request.headers["if-none-match"] = "*";
          return suivant(argumentsCommande);
        },
        {
          step: "build",
          name: "punksCreateOnlyIfNoneMatch",
          priority: "low",
        },
      );
      try {
        await clientS3(destination).send(commande);
      } catch (erreur) {
        if (
          [409, 412].includes(statutErreurS3(erreur)) ||
          ["ConditionalRequestConflict", "PreconditionFailed"].includes(
            erreur?.name,
          )
        ) {
          throw erreurExistant(
            `objet R2 ${destination.role}/${destination.cle} déjà présent`,
          );
        }
        throw new Error(
          `création R2 S3 ${destination.role}/${destination.cle} refusée : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
          { cause: erreur },
        );
      }
    },
  };
}

function approbationEtConfiance(env, destinations) {
  const secrets = parserJsonProtege(env, "PUNKS_RELEASE_APPROVERS_JSON");
  if (!Array.isArray(secrets) || secrets.length !== 2) {
    throw new Error(
      "PUNKS_RELEASE_APPROVERS_JSON doit contenir exactement deux approbateurs",
    );
  }
  const identifiants = new Set();
  const approbateurs = [];
  const clesPrivees = new Map();
  for (const entree of secrets) {
    const id = entree?.id;
    const clePublique = entree?.["cle-publique-spki"];
    const clePrivee = entree?.["cle-privee-pkcs8"];
    if (
      typeof id !== "string" ||
      id.trim() !== id ||
      id === "" ||
      identifiants.has(id) ||
      typeof clePublique !== "string" ||
      clePublique === "" ||
      typeof clePrivee !== "string" ||
      clePrivee === ""
    ) {
      throw new Error(
        "chaque approbateur doit avoir un id unique canonique et deux clés DER base64",
      );
    }
    let privee;
    let publiqueDer;
    try {
      privee = createPrivateKey({
        key: Buffer.from(clePrivee, "base64"),
        format: "der",
        type: "pkcs8",
      });
      publiqueDer = createPublicKey(privee).export({
        format: "der",
        type: "spki",
      });
    } catch (erreur) {
      throw new Error(`clé privée Ed25519 invalide pour ${id}`, {
        cause: erreur,
      });
    }
    if (
      privee.asymmetricKeyType !== "ed25519" ||
      publiqueDer.toString("base64") !== clePublique
    ) {
      throw new Error(`paire Ed25519 publique/privée divergente pour ${id}`);
    }
    identifiants.add(id);
    approbateurs.push({ id, "cle-publique-spki": clePublique });
    clesPrivees.set(id, privee);
  }
  const ancrageApprobateurs = exigerVariable(
    env,
    "PUNKS_RELEASE_APPROVERS_ANCHOR_SHA256",
  );
  const ancrageDestinations = exigerVariable(
    env,
    "PUNKS_R2_DESTINATIONS_ANCHOR_SHA256",
  );
  if (
    !SHA256_RE.test(ancrageApprobateurs) ||
    ancrageApprobateurs !== canonicalSha256(approbateurs)
  ) {
    throw new Error(
      "ancrage protégé des approbateurs divergent du registre chargé",
    );
  }
  if (
    !SHA256_RE.test(ancrageDestinations) ||
    ancrageDestinations !== canonicalSha256(destinations)
  ) {
    throw new Error(
      "ancrage protégé des destinations R2 divergent de la configuration",
    );
  }
  return {
    approbation: {
      approbateurs,
      async signerRecu({ contenu, approbateurs: selection }) {
        if (
          !Array.isArray(selection) ||
          selection.length !== 2 ||
          new Set(selection).size !== 2 ||
          selection.some((id) => !clesPrivees.has(id))
        ) {
          throw new Error(
            "la signature exige les deux approbateurs ancrés exacts",
          );
        }
        return selection.map((approbateur) => ({
          approbateur,
          algorithme: "ed25519",
          "cle-publique-spki": approbateurs.find(
            (entree) => entree.id === approbateur,
          )?.["cle-publique-spki"],
          valeur: signerEd25519(
            null,
            Buffer.from(canonicalJson(contenu), "utf8"),
            clesPrivees.get(approbateur),
          ).toString("hex"),
        }));
      },
    },
    confiance: {
      registreApprobateursRelease: approbateurs,
      ancrageApprobateursRelease: ancrageApprobateurs,
      ancrageDestinationsR2: ancrageDestinations,
    },
  };
}

/** Frontières distantes réelles, injectables en test et sans état implicite. */
export async function creerFrontieresPublication(
  configuration,
  { env = process.env, fetchImpl = globalThis.fetch, s3RequestHandler } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch indisponible pour les frontières de publication");
  }
  const depot = configuration?.depot;
  if (!/^[^/\s]+\/[^/\s]+$/.test(depot ?? "")) {
    throw new Error("dépôt GitHub owner/repo canonique exigé");
  }
  const destinations = destinationsR2Canoniques(configuration?.r2);
  const { approbation, confiance } = approbationEtConfiance(env, destinations);
  return {
    github: clientGithub({
      depot,
      token: exigerVariable(env, "GITHUB_TOKEN"),
      fetchImpl,
    }),
    cloudflare: clientCloudflare({
      tokens: tokensR2(env),
      destinations,
      fetchImpl,
      s3RequestHandler,
    }),
    approbation,
    confiance,
  };
}

/** Read-only R2 proof boundary without GitHub or signing-key material. */
export function creerFrontiereLectureR2(
  configuration,
  { env = process.env, fetchImpl = globalThis.fetch, s3RequestHandler } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch indisponible pour la frontière R2");
  }
  const destinations = destinationsR2Canoniques(configuration?.r2);
  return {
    cloudflare: clientCloudflare({
      tokens: tokensR2(env),
      destinations,
      fetchImpl,
      s3RequestHandler,
    }),
  };
}

export default creerFrontieresPublication;
