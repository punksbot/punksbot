# Publication immuable d'une promotion

`scripts/promotion-publish.mjs` publie la paire locale créée par
`promotion:valider` sans reconstruire ni modifier son contenu :

1. deux assets create-only dans la draft GitHub exacte du candidat ;
2. les deux mêmes documents dans un bucket verrouillé en mode `compliance`
   de chacun de deux comptes R2 distincts.

Le publisher ne contient aucun client GitHub ou Cloudflare implicite. Le
processus qui l'exécute injecte explicitement un module de frontières. Cette
séparation permet de tester toute l'orchestration avec des doubles uniquement
aux limites GitHub/Cloudflare et empêche un test local de contacter un service
réel par défaut.

## CLI public

```bash
node scripts/promotion-publish.mjs \
  --attestation ./promotion/attestation-tranche-1.json \
  --recu ./promotion/recu-promotion-1.json \
  --depot owner/repository \
  --tag punks-staging-0123456789abcdef0123456789abcdef01234567 \
  --canal punks-desktop \
  --r2-primaire account-a/promotion-a \
  --r2-secondaire account-b/promotion-b \
  --frontieres ./operations/promotion-boundaries.mjs
```

`--canal` vaut `punks-desktop` par défaut. Les deux valeurs R2 sont toujours
de la forme canonique `<compte>/<bucket>`. Les comptes doivent être distincts
et les noms de buckets doivent eux aussi être distincts.

Le succès écrit une seule ligne JSON sur stdout. `statut` vaut :

- `publiee` si les six objets ont été créés par ce passage ;
- `reprise` si des objets exacts existaient déjà et que seuls les objets
  manquants ont été créés ;
- `deja-publiee` si les six objets existaient déjà avec leurs octets exacts.

Le résultat cite le SHA candidat, le tag, l'identifiant GitHub de la draft,
les deux clés d'objet, les SHA-256 des octets publiés et la répartition entre
objets créés et déjà présents. Un refus écrit une erreur JSON sur stderr et
retourne le code processus `1`.

## Layout fixe

Pour la tranche `N`, le publisher utilise exactement :

```text
GitHub : attestation-tranche-N.json
GitHub : recu-promotion-N.json
R2     : releases/{canal}/tranche:N/attestation.json
R2     : releases/{canal}/tranche:N/recus/{recu.id}.json
```

Le tag doit être exactement `punks-staging-{attestation.sha}`. La release
observée doit rester une draft portant ce tag et ciblant ce même SHA. Le Reçu
doit citer le hash canonique de l'attestation et son identifiant doit citer la
tranche et les douze premiers caractères du même SHA.

## Contrat du module de frontières

Le module passé à `--frontieres` exporte :

```js
export async function creerFrontieresPublication(configuration) {
  return { github, cloudflare };
}
```

`configuration` contient `{ depot, tag, canal, r2 }`. Les interfaces retournées
respectent les coutures suivantes :

```js
github.lireDraft({ depot, tag })
// -> { id, tag, sha, draft }

github.lireAsset({ depot, releaseId, nom })
// -> Uint8Array | Buffer | null

github.creerAsset({ depot, releaseId, nom, contenu, attendu })
// création stricte, jamais de clobber

cloudflare.lireVerrouillage({ role, compte, bucket })
// -> { mode: "compliance", actif: true }

cloudflare.lireObjet({ role, compte, bucket, cle })
// -> Uint8Array | Buffer | null

cloudflare.creerObjet({
  role,
  compte,
  bucket,
  cle,
  contenu,
  modeRequis: "compliance",
})
// création stricte, jamais d'overwrite
```

Les opérations `creerAsset` et `creerObjet` doivent être create-only au niveau
du fournisseur. Un conflit d'existence porte `erreur.code = "ALREADY_EXISTS"`.
Pour GitHub, `attendu` oblige l'adaptateur à revalider le tag, le SHA cible et
l'état draft au plus près de la création. Pour R2, `modeRequis` oblige
l'adaptateur à vérifier le verrouillage au plus près de l'écriture.

Les lectures retournent les octets réels, pas uniquement une métadonnée de
hash. Le publisher recalcule ainsi le SHA-256 lui-même avant toute reprise et
après la publication.

## Create-only et reprise

Le préflight lit la draft, les deux politiques de verrouillage et les six
objets avant la première écriture. Un objet existant n'est accepté que si ses
octets ont exactement le SHA-256 attendu ; il n'est jamais réécrit. Tout objet
divergent bloque l'opération avant les nouvelles créations.

Les objets R2 sont créés avant les assets de la draft. Une panne peut donc
laisser une publication partielle, mais aucun rollback destructif n'est tenté.
L'erreur `PUBLICATION_PARTIELLE` contient `reprenable: true`, `publies` et
`restants`. Il faut relancer exactement la même commande : les objets exacts
sont relus et conservés, les objets manquants seuls sont créés. Une course
create-only ou une réponse distante ambiguë suit la même règle : relecture des
octets, acceptation seulement du hash exact, refus de toute divergence.

Avant de déclarer le succès, le publisher relit la draft, les deux verrous et
les six contenus. Une dérive tardive produit `VALIDATION_POST_PUBLICATION` et
exige une nouvelle exécution après correction de l'état externe.
