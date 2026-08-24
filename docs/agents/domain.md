# Documents de domaine

Comment les compétences en ingénierie doivent utiliser la documentation de domaine de ce référentiel lors de l’exploration de la base de code.

## Avant d’explorer, lisez ceci

- **`CONTEXT.md`** à la racine du dépôt, ou
- **`CONTEXT-MAP.md`** à la racine du dépôt s’il existe — il pointe vers un `CONTEXT.md` par contexte. Lisez chacun d’entre eux en rapport avec le sujet.
- **`docs/adr/`** — lisez les ADR qui touchent le domaine dans lequel vous êtes sur le point de travailler. Dans les dépôts multi-contextes, vérifiez également `src/<context>/docs/adr/` pour les décisions contextuelles.

Si l’un de ces fichiers n’existe pas, poursuivez sans le signaler. Ne demandez pas de les créer à l’avance. La compétence `/domain-modeling` les crée au moment où les termes ou les décisions sont réellement clarifiés.

## Structure du fichier

Dépôt à contexte unique :

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Dépôt multi-contexte :

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← décisions générales du système
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← décisions propres au contexte
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Utiliser le vocabulaire du glossaire

Lorsque votre sortie nomme un concept de domaine — dans le titre d’un problème, une proposition de refactorisation, une hypothèse ou un nom de test — utilisez le terme tel que défini dans `CONTEXT.md`. Ne dérivez pas vers les synonymes que le glossaire évite explicitement.

Si le concept dont vous avez besoin ne figure pas encore dans le glossaire, c’est un signal : soit vous inventez un langage que le projet n’utilise pas, soit il y a une réelle lacune. Notez-la pour `/domain-modeling`.

## Signaler les conflits d’ADR

Si votre résultat contredit un ADR existant, exposez-le explicitement plutôt que de le remplacer silencieusement :

> _Contradictoire ADR-0007 (commandes événementielles) — mais vaut la peine d’être rouvert parce que…_
