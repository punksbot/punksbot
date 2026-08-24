# Publication immuable d'une promotion

Deux chemins de publication existent et partagent les mêmes frontières
create-only :

- `scripts/promotion-publish.mjs` finalise puis publie la paire locale
  attestation/Reçu de promotion produite par `promotion:valider` ;
- `scripts/receipt-publish.mjs` publie un Reçu opérationnel déjà signé
  (`transition`, démarrage/événement d'exécution, roll-forward, retour Punks,
  retrait, certificat ou invalidation d'attestation) et, lorsqu'elle existe,
  son attestation exacte.

Aucun des deux CLI ne reconstruit un artefact et aucun ne possède de client
distant implicite. Les seules frontières réelles livrées par le dépôt sont dans
`scripts/promotion-frontiers.mjs`; elles restent injectables afin que les tests
n'effectuent jamais d'appel réseau.

## Scellement de la première paire

La paire locale est volontairement non publiée et non signée. Avant toute
frontière distante, `promotion-publish.mjs` :

1. lit `docs/migration/release-graph.yaml`, vérifie le canal, la baseline, le
   checkpoint, l'unique candidat encore en `preparation`, la politique de
   bootstrap et les deux destinations R2 ancrées ;
2. impose `--bootstrap-r2` pour la tranche 1 et le refuse pour les suivantes ;
3. ajoute `publiee: [release, r2]` à l'attestation ;
4. recalcule son hash canonique, l'inscrit dans le Reçu avec les deux
   approbateurs ancrés et, pour la tranche 1, avec
   `bootstrap-github-attestation-sha256` ;
5. fait signer les octets canoniques par exactement deux clés Ed25519
   distinctes puis vérifie lui-même les signatures ;
6. ajoute `publication: [release, r2]` au Reçu final.

Les octets finaux sont déterministes pour une même paire et un même registre
d'approbateurs ordonné. Le premier bootstrap écrit et relit obligatoirement les
deux assets GitHub avant la première écriture R2. Ce choix n'est pas un booléen
opérateur libre : un graphe ou une commande qui tente de publier R2 d'abord est
refusé avant toute création irréversible.

## Commandes

Publication initiale de la tranche 1 :

```bash
pnpm promotion:publier -- \
  --graphe docs/migration/release-graph.yaml \
  --attestation ./promotion/attestation-tranche-1.json \
  --recu ./promotion/recu-promotion-1.json \
  --depot punksbot/punksbot \
  --tag punks-staging-0123456789abcdef0123456789abcdef01234567 \
  --canal punks-desktop \
  --r2-primaire 11111111111111111111111111111111/promotion-a \
  --r2-secondaire 22222222222222222222222222222222/promotion-b \
  --bootstrap-r2 \
  --frontieres scripts/promotion-frontiers.mjs
```

Publication d'un Reçu opérationnel déjà présent dans le graphe validé :

```bash
pnpm promotion:publier-recu -- \
  --graphe docs/migration/release-graph.yaml \
  --recu ./promotion/recu-execution-signe.json \
  --parity cloudflare/PARITY.md \
  --depot punksbot/punksbot \
  --tag punks-staging-0123456789abcdef0123456789abcdef01234567 \
  --sha 0123456789abcdef0123456789abcdef01234567 \
  --release-id tranche:1/expansion/execution-1 \
  --etat-release draft \
  --canal punks-desktop \
  --r2-primaire 11111111111111111111111111111111/promotion-a \
  --r2-secondaire 22222222222222222222222222222222/promotion-b \
  --frontieres scripts/promotion-frontiers.mjs
```

Un Reçu de `transition` ou de supersession documentaire exige en plus
`--attestation ./promotion/attestation-transition.json` avec l'attestation
exactement citée par le graphe. Après activation de la GitHub Release,
`--etat-release published` est obligatoire. Le tag cite toujours le SHA Punks
intégral de 40 caractères ; aucun préfixe abrégé n'est une identité.

Le succès écrit une ligne JSON. `statut` vaut `publiee`, `reprise` ou
`deja-publiee`. Un refus écrit une erreur JSON sur stderr et retourne le code
processus `1`.

## Noms et clés content-addressés

Pour un identifiant canonique de release `{id}` :

```text
GitHub : attestation-{attestation-sha256}.json
GitHub : recu-{recu-sha256}.json
R2     : releases/{canal}/{id}/attestations/{attestation-sha256}.json
R2     : releases/{canal}/{id}/recus/{recu-sha256}.json
```

Le SHA-256 est toujours l'empreinte intégrale des octets canoniques attendus.
Une clé fondée sur `recu.id`, un nom mutable comme `attestation.json` ou un hash
tronqué est refusé par le contrat.

## Frontières réelles et confiance indépendante

Le module de frontières retourne exactement les capacités nécessaires :

```js
export async function creerFrontieresPublication(configuration) {
  return { github, cloudflare, approbation, confiance };
}
```

Les lectures renvoient les octets réels afin que le publisher recalcule le hash.
Les créations ne clobberent jamais :

```js
github.lireDraft({ tag })
github.lireRelease({ tag })
github.lireAsset({ releaseId, nom })
github.creerAsset({ releaseId, nom, contenu })

cloudflare.lireVerrouillage({ role, compte, bucket })
cloudflare.lireObjet({ role, compte, bucket, cle })
cloudflare.creerObjet({ role, compte, bucket, cle, contenu })

approbation.signerRecu({ contenu, sha256, approbateurs })
```

`scripts/promotion-frontiers.mjs` utilise les API GitHub Release et Cloudflare
R2, `If-None-Match: *`, et vérifie une règle Bucket Lock `Indefinite` active sur
`releases/` (ou sur tout le bucket). Les conflits fournisseur sont normalisés en
`ALREADY_EXISTS`, puis les octets sont relus ; une réponse de succès sans objet
vérifiable est un échec.

Variables protégées requises :

```text
GITHUB_TOKEN
PUNKS_R2_PRIMARY_API_TOKEN
PUNKS_R2_PRIMARY_ACCESS_KEY_ID
PUNKS_R2_PRIMARY_SECRET_ACCESS_KEY
PUNKS_R2_RECOVERY_API_TOKEN
PUNKS_R2_RECOVERY_ACCESS_KEY_ID
PUNKS_R2_RECOVERY_SECRET_ACCESS_KEY
PUNKS_RELEASE_APPROVERS_JSON
PUNKS_RELEASE_APPROVERS_ANCHOR_SHA256
PUNKS_R2_DESTINATIONS_ANCHOR_SHA256
```

Chaque rôle R2 possède un jeton API pour lire le verrouillage Bucket Lock et
une paire S3 dédiée pour les lectures/écritures d'objets signées SigV4. Les deux
jetons API, les deux identifiants de clé et les deux secrets doivent rester
distincts entre les comptes primaire et récupération.
Chaque `compte` est l'identifiant Cloudflare exact de 32 caractères
hexadécimaux ; chaque bucket suit le nom canonique R2 (3 à 63 caractères
minuscules, chiffres ou tirets, sans tiret initial ou final). La frontière
refuse tout appel dont le triplet `role/compte/bucket` diffère de la liste
ordonnée ancrée dans le graphe.
`PUNKS_RELEASE_APPROVERS_JSON`
contient exactement deux objets `{id, cle-publique-spki,
cle-privee-pkcs8}` en DER base64. L'adaptateur recalcule chaque clé publique
depuis la clé privée Ed25519 et refuse une paire divergente. Les deux ancrages
sont des SHA-256 canoniques protégés, comparés respectivement au registre public
et à la liste ordonnée `primaire`, `secondaire` du graphe. Ils ne sont jamais
déduits de l'objet à signer.

## PARITY et appartenance au graphe

`receipt-publish.mjs` valide le graphe complet avant toute frontière, retrouve
le Reçu exact (identifiant, SHA et contenu), vérifie ses deux signatures et
refuse un Reçu orphelin. Il exige aussi que chaque Reçu opérationnel du graphe
possède dans `cloudflare/PARITY.md` son marqueur canonique :

```text
<!-- punks-release-receipt {"id":"…","sha256":"…","verdict":"…"} -->
```

Un marqueur manquant, divergent, dupliqué ou sans Reçu correspondant bloque
`pnpm migration:check` et la publication.

## Reprise et validation post-publication

Le préflight lit la release GitHub exacte, les deux verrous et chaque objet
attendu avant la première écriture. Un contenu existant exact est conservé ; un
contenu divergent bloque immédiatement. Une panne après une création produit
`PUBLICATION_PARTIELLE` avec `reprenable`, `publies` et `restants`. Aucun
rollback destructif n'est tenté : il faut relancer la commande avec les mêmes
octets et le même graphe.

Avant de déclarer le succès, le publisher relit la release, les verrous et tous
les contenus. Une dérive tardive produit `VALIDATION_POST_PUBLICATION`. Les
assets GitHub et objets R2 ne sont jamais modifiés ou supprimés par ces outils.

## État opérationnel actuel

Le graphe versionné reste honnêtement en `preparation` : ses destinations R2 et
son registre d'approbateurs sont vides tant que les deux comptes, les deux
buckets verrouillés, les jetons séparés et les ancrages protégés n'ont pas été
provisionnés. Dans cet état, aucune commande de scellement réel ne peut réussir.
La préparation du mécanisme n'est donc pas présentée comme une promotion déjà
effectuée.
