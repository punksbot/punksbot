import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifierEd25519 } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";

import { canonicalJson, canonicalSha256 } from "./migration-manifest-lib.mjs";
import { creerFrontieresPublication } from "./promotion-frontiers.mjs";

const DESTINATIONS = [
  {
    role: "primaire",
    compte: "11".repeat(16),
    bucket: "preuves-primaire",
  },
  {
    role: "secondaire",
    compte: "22".repeat(16),
    bucket: "preuves-recuperation",
  },
];

function approbateursSecrets() {
  return ["ops:alice", "ops:bob"].map((id) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return {
      id,
      "cle-publique-spki": publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      "cle-privee-pkcs8": privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
    };
  });
}

function environnement(surcharge = {}) {
  const secrets = approbateursSecrets();
  const registre = secrets.map(({ id, "cle-publique-spki": cle }) => ({
    id,
    "cle-publique-spki": cle,
  }));
  return {
    GITHUB_TOKEN: "github-protege",
    PUNKS_R2_PRIMARY_API_TOKEN: "r2-primaire-protege",
    PUNKS_R2_RECOVERY_API_TOKEN: "r2-recuperation-protege",
    PUNKS_R2_PRIMARY_ACCESS_KEY_ID: "access-primaire",
    PUNKS_R2_PRIMARY_SECRET_ACCESS_KEY: "secret-primaire",
    PUNKS_R2_RECOVERY_ACCESS_KEY_ID: "access-recuperation",
    PUNKS_R2_RECOVERY_SECRET_ACCESS_KEY: "secret-recuperation",
    PUNKS_RELEASE_APPROVERS_JSON: JSON.stringify(secrets),
    PUNKS_RELEASE_APPROVERS_ANCHOR_SHA256: canonicalSha256(registre),
    PUNKS_R2_DESTINATIONS_ANCHOR_SHA256: canonicalSha256(DESTINATIONS),
    ...surcharge,
  };
}

function reponseJson(valeur, status = 200) {
  const octets = Buffer.from(JSON.stringify(valeur));
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(valeur);
    },
    async text() {
      return octets.toString("utf8");
    },
    async arrayBuffer() {
      return octets;
    },
  };
}

function reponseOctets(valeur, status = 200) {
  const octets = Buffer.from(valeur);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return octets.toString("utf8");
    },
    async arrayBuffer() {
      return octets;
    },
  };
}

function configuration() {
  return {
    depot: "punksbot/punksbot",
    r2: DESTINATIONS.map((destination) => ({ ...destination })),
  };
}

function reponseS3(statusCode, corps = "") {
  return {
    response: {
      statusCode,
      headers: { "content-type": "application/xml" },
      body: Readable.from([corps]),
    },
  };
}

test("les frontières réelles appliquent les identités, rôles et écritures create-only", async () => {
  const appels = [];
  const shaTag = "a".repeat(40);
  const shaObjetTag = "b".repeat(40);
  const fetchImpl = async (url, options = {}) => {
    appels.push({ url, options });
    if (url.includes("/releases/tags/")) {
      return reponseJson({
        id: 51,
        tag_name: "punks-staging-abc",
        target_commitish: "main",
        draft: true,
        assets: [],
      });
    }
    if (url.includes("/git/ref/tags/")) {
      return reponseJson({ object: { type: "tag", sha: shaObjetTag } });
    }
    if (url.includes(`/git/tags/${shaObjetTag}`)) {
      return reponseJson({ object: { type: "commit", sha: shaTag } });
    }
    if (url.includes("/releases/51/assets?")) return reponseJson([]);
    if (url.startsWith("https://uploads.github.com/")) {
      return reponseJson({ id: 99 }, 201);
    }
    if (url.endsWith("/lock")) {
      return reponseJson({
        success: true,
        result: {
          rules: [
            {
              enabled: true,
              prefix: "releases/",
              condition: { type: "Indefinite" },
            },
          ],
        },
      });
    }
    return reponseOctets("absent", 404);
  };
  const appelsS3 = [];
  const s3RequestHandler = {
    async handle(requete) {
      appelsS3.push(requete);
      return requete.method === "PUT"
        ? reponseS3(200)
        : reponseS3(
            404,
            "<Error><Code>NoSuchKey</Code><Message>absent</Message></Error>",
          );
    },
  };
  const frontieres = await creerFrontieresPublication(configuration(), {
    env: environnement(),
    fetchImpl,
    s3RequestHandler,
  });

  assert.deepEqual(await frontieres.github.lireDraft({ tag: "tag" }), {
    id: 51,
    tag: "punks-staging-abc",
    sha: shaTag,
    draft: true,
    assets: [],
  });
  assert.equal(
    await frontieres.github.lireAsset({ releaseId: 51, nom: "preuve.json" }),
    null,
  );
  await frontieres.github.creerAsset({
    releaseId: 51,
    nom: "preuve.json",
    contenu: Buffer.from("{}"),
  });
  assert.deepEqual(
    await frontieres.cloudflare.lireVerrouillage(DESTINATIONS[0]),
    { mode: "compliance", actif: true },
  );
  assert.equal(
    await frontieres.cloudflare.lireObjet({
      ...DESTINATIONS[1],
      cle: "releases/preuve.json",
    }),
    null,
  );
  await frontieres.cloudflare.creerObjet({
    ...DESTINATIONS[0],
    cle: "releases/preuve.json",
    contenu: Buffer.from("{}"),
  });

  const requeteGithub = appels.find((appel) =>
    appel.url.startsWith("https://uploads.github.com/"),
  );
  assert.equal(
    requeteGithub.options.headers.Authorization,
    "Bearer github-protege",
  );
  const requeteR2 = appelsS3.find((appel) => appel.method === "PUT");
  assert.equal(requeteR2.headers["if-none-match"], "*");
  assert.match(requeteR2.headers.authorization, /Credential=access-primaire\//);
  assert.match(
    requeteR2.headers.authorization,
    /SignedHeaders=[^,]*if-none-match/,
  );
  assert.match(requeteR2.hostname, new RegExp(DESTINATIONS[0].compte));
  const lectureSecondaire = appelsS3.find(
    (appel) =>
      appel.method === "GET" && appel.hostname.includes(DESTINATIONS[1].compte),
  );
  assert.match(
    lectureSecondaire.headers.authorization,
    /Credential=access-recuperation\//,
  );

  const contenu = { id: "recu-test", type: "execution-evenement" };
  const signatures = await frontieres.approbation.signerRecu({
    contenu,
    approbateurs: ["ops:alice", "ops:bob"],
  });
  assert.equal(signatures.length, 2);
  for (const signature of signatures) {
    assert.equal(
      verifierEd25519(
        null,
        Buffer.from(canonicalJson(contenu), "utf8"),
        {
          key: Buffer.from(signature["cle-publique-spki"], "base64"),
          format: "der",
          type: "spki",
        },
        Buffer.from(signature.valeur, "hex"),
      ),
      true,
    );
  }
});

test("les frontières lient chaque appel à la destination R2 ancrée exacte", async () => {
  const appelsS3 = [];
  const frontieres = await creerFrontieresPublication(configuration(), {
    env: environnement(),
    fetchImpl: async () => reponseJson({}),
    s3RequestHandler: {
      async handle(requete) {
        appelsS3.push(requete);
        return reponseS3(404);
      },
    },
  });

  await assert.rejects(
    frontieres.cloudflare.lireObjet({
      ...DESTINATIONS[0],
      compte: "attacker.example#",
      cle: "releases/preuve.json",
    }),
    /destination R2 .* ancrée exacte/,
  );
  assert.deepEqual(appelsS3, []);

  const destinationsMalicieuses = configuration().r2;
  destinationsMalicieuses[0].compte = "attacker.example#";
  await assert.rejects(
    creerFrontieresPublication(
      { depot: "punksbot/punksbot", r2: destinationsMalicieuses },
      {
        env: environnement({
          PUNKS_R2_DESTINATIONS_ANCHOR_SHA256: canonicalSha256(
            destinationsMalicieuses,
          ),
        }),
        fetchImpl: async () => reponseJson({}),
      },
    ),
    /compte R2 Cloudflare canonique/,
  );
});

test("les frontières refusent les secrets et ancrages qui confondent les autorités", async () => {
  await assert.rejects(
    creerFrontieresPublication(configuration(), {
      env: environnement({
        PUNKS_R2_RECOVERY_API_TOKEN: "r2-primaire-protege",
      }),
      fetchImpl: async () => reponseJson({}),
    }),
    /jetons REST et identifiants S3 distincts/,
  );
  await assert.rejects(
    creerFrontieresPublication(configuration(), {
      env: environnement({
        PUNKS_R2_RECOVERY_ACCESS_KEY_ID: "access-primaire",
      }),
      fetchImpl: async () => reponseJson({}),
    }),
    /jetons REST et identifiants S3 distincts/,
  );
  await assert.rejects(
    creerFrontieresPublication(configuration(), {
      env: environnement({
        PUNKS_R2_DESTINATIONS_ANCHOR_SHA256: "0".repeat(64),
      }),
      fetchImpl: async () => reponseJson({}),
    }),
    /destinations R2 divergent/,
  );
});

test("les réponses de concurrence sont classées create-only et les verrous absents restent rouges", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://uploads.github.com/")) {
      return reponseJson({ message: "already_exists" }, 422);
    }
    if (url.endsWith("/lock")) {
      return reponseJson({ success: true, result: { rules: [] } });
    }
    return reponseJson([]);
  };
  const s3RequestHandler = {
    async handle(requete) {
      return requete.method === "PUT"
        ? reponseS3(
            412,
            "<Error><Code>PreconditionFailed</Code><Message>exists</Message></Error>",
          )
        : reponseS3(404);
    },
  };
  const frontieres = await creerFrontieresPublication(configuration(), {
    env: environnement(),
    fetchImpl,
    s3RequestHandler,
  });
  await assert.rejects(
    frontieres.github.creerAsset({
      releaseId: 51,
      nom: "preuve.json",
      contenu: Buffer.from("{}"),
    }),
    (erreur) => erreur?.code === "ALREADY_EXISTS",
  );
  await assert.rejects(
    frontieres.cloudflare.creerObjet({
      ...DESTINATIONS[0],
      cle: "releases/preuve.json",
      contenu: Buffer.from("{}"),
    }),
    (erreur) => erreur?.code === "ALREADY_EXISTS",
  );
  assert.deepEqual(
    await frontieres.cloudflare.lireVerrouillage(DESTINATIONS[0]),
    { mode: "compliance", actif: false },
  );
});
