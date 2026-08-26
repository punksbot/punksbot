import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../migration-manifest-lib.mjs";
import {
  buildOperationalReleaseHead,
  publishOperationalReleaseHead,
  validateOperationalReleaseHead,
} from "./operational-release-head.mjs";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const keys = ["ops:one", "ops:two"].map((id) => {
  const pair = generateKeyPairSync("ed25519");
  return {
    id,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
});
const approbation = {
  approbateurs: keys.map(({ id, publicKey }) => ({
    id,
    "cle-publique-spki": publicKey,
  })),
  async signerRecu({ contenu, approbateurs }) {
    return approbateurs.map((id) => {
      const key = keys.find((candidate) => candidate.id === id);
      return {
        approbateur: id,
        algorithme: "ed25519",
        "cle-publique-spki": key.publicKey,
        valeur: sign(
          null,
          Buffer.from(canonicalJson(contenu)),
          key.privateKey,
        ).toString("hex"),
      };
    });
  },
};

function dossier() {
  return {
    candidat: { sha: sourceSha },
    liaison: {
      staging: { deploiement: stagingDeploymentId },
      artefacts: [{ plateforme: "linux-x64", sha256: "01".repeat(32) }],
    },
    gates: { cloudflare: { resultat: "vert" } },
    parcours: {
      plateformes: ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"],
    },
    accessibilite: { resultat: "vert" },
    recuperation: { resultat: "vert" },
    retrait: { resultat: "vert" },
    fautes: { resultat: "vert" },
    scans: { resultat: "vert" },
    goldens: { resultat: "vert" },
  };
}

test("materializes signed expansion and active executions before Latest", async () => {
  const input = dossier();
  const head = await buildOperationalReleaseHead({
    dossier: input,
    publicationResult: {
      objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
    },
    approbation,
    now: Date.parse("2026-08-26T20:00:00.000Z"),
  });
  assert.deepEqual(
    head.transitions.map(({ programme }) => programme),
    ["expansion", "active"],
  );
  assert.deepEqual(
    head.transitions.flatMap(({ steps }) => steps.map(({ step }) => step)),
    ["E0", "E1", "E2", "E3", "E4", "A0", "A1", "A2", "A3", "A4"],
  );
  assert.equal(
    head.transitions
      .flatMap(({ steps }) => steps)
      .every(
        ({ receipt, eventReceipt }) =>
          receipt.signatures.length === 2 &&
          eventReceipt.signatures.length === 2,
      ),
    true,
  );
  assert.equal(
    validateOperationalReleaseHead(head, {
      sourceSha,
      stagingDeploymentId,
      dossierSha256: head.dossierSha256,
    }),
    head,
  );
});

test("refuses activation when one ordered operational step is absent", async () => {
  const head = await buildOperationalReleaseHead({
    dossier: dossier(),
    publicationResult: {
      objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
    },
    approbation,
    now: Date.parse("2026-08-26T20:00:00.000Z"),
  });
  head.transitions[1].steps.pop();
  const { sha256: _prior, ...content } = head;
  head.sha256 = canonicalSha256(content);
  assert.throws(
    () =>
      validateOperationalReleaseHead(head, {
        sourceSha,
        stagingDeploymentId,
        dossierSha256: head.dossierSha256,
      }),
    /five ordered steps/i,
  );
});

test("publishes the operational head create-only to the draft and both Punks buckets", async () => {
  const head = await buildOperationalReleaseHead({
    dossier: dossier(),
    publicationResult: {
      objets: [{ sorte: "recu", sha256: "ef".repeat(32) }],
    },
    approbation,
    now: Date.parse("2026-08-26T20:00:00.000Z"),
  });
  const writes = [];
  const r2 = [
    {
      role: "primaire",
      compte: "3a391620584c792dbbd8cfa148d7634a",
      bucket: "punks-promotion-primary",
    },
    {
      role: "secondaire",
      compte: "3a391620584c792dbbd8cfa148d7634a",
      bucket: "punks-promotion-recovery",
    },
  ];
  const result = await publishOperationalReleaseHead({
    depot: "punksbot/punksbot",
    tag: `punks-staging-${sourceSha}`,
    sourceSha,
    document: head,
    r2,
    frontieres: {
      github: {
        async lireDraft() {
          return {
            id: 58,
            tag: `punks-staging-${sourceSha}`,
            sha: sourceSha,
            draft: true,
          };
        },
        async lireAsset() {
          return null;
        },
        async creerAsset(input) {
          writes.push(["github", input.nom]);
        },
      },
      cloudflare: {
        async lireVerrouillage() {
          return { mode: "compliance", actif: true };
        },
        async lireObjet() {
          return null;
        },
        async creerObjet(input) {
          writes.push([input.role, input.cle]);
        },
      },
    },
  });
  assert.match(result.asset, /^operational-release-head-[0-9a-f]{64}\.json$/);
  assert.deepEqual(
    writes.map(([role]) => role),
    ["github", "primaire", "secondaire"],
  );
});
