# Suivi des tickets : GitHub

Les tickets et les spécifications de ce dépôt sont enregistrés comme tickets GitHub dans `mabzadev/punksbot`. Utilisez la CLI `gh` pour toutes les opérations.

Lorsque le dépôt est exécuté depuis un clone correctement configuré, déduisez le dépôt avec `git remote -v`. Depuis un environnement qui n’est pas encore un clone, utilisez explicitement `-R mabzadev/punksbot`.

## Conventions

- **Créer un problème** : `gh issue create -R mabzadev/punksbot --title "..." --body "..."`. Utilisez un hérédoc pour les corps multilignes.
- **Lire un numéro** : `gh issue view <number> -R mabzadev/punksbot --comments`, filtrer les commentaires par `jq` et récupérer également les étiquettes.
- **Liste des problèmes** : `gh issue list -R mabzadev/punksbot --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` avec les filtres `--label` et `--state` appropriés.
- **Commenter un problème** : `gh issue comment <number> -R mabzadev/punksbot --body "..."`
- **Appliquer/supprimer des étiquettes** : `gh issue edit <number> -R mabzadev/punksbot --add-label "..."` / `--remove-label "..."`
- **Fermer** : `gh issue close <number> -R mabzadev/punksbot --comment "..."`

## Conventions d’identification

GitHub partage un espace numérique entre les problèmes et les PR, donc un simple `#42` peut être l’un ou l’autre. Résolvez l’ambiguïté avec :

- `gh issue view 42 -R mabzadev/punksbot --comments`
- `gh pr view 42 -R mabzadev/punksbot --comments`

## Pull requests comme source de demandes

**PR comme source de demandes : non.**

Les PR externes ne sont pas incluses automatiquement dans la file des demandes et ne passent pas par les mêmes étiquettes ou états que les problèmes.

## Lorsqu'une compétence indique « Publier sur le système de suivi des problèmes »

Créez un problème GitHub dans `mabzadev/punksbot`.

## Quand une compétence dit « récupérer le ticket correspondant »

Exécutez `gh issue view <number> -R mabzadev/punksbot --comments`.

## Opérations d’orientation

Utilisé par `/wayfinder`. La carte est un problème unique avec des problèmes enfants comme tickets.

- **Carte** : un seul numéro étiqueté `wayfinder:map`, contenant le corps Notes / Décisions jusqu’à présent / Brouillard. Utilisez `gh issue create -R mabzadev/punksbot --label wayfinder:map`.
- **Ticket enfant** : un ticket lié à la carte comme sous-ticket GitHub. Si les sous-tickets ne sont pas activés, ajoutez l’enfant à une liste de tâches dans le corps de la carte et placez `Fait partie de #<carte>` au début de son corps. Étiquettes : `wayfinder:<type>` (`research`, `prototype`, `grilling` ou `task`). Une fois réclamé, le ticket est attribué au développeur qui pilote la carte.
- **Blocage** : utilisez les dépendances natives de GitHub. Ajoutez une dépendance avec `gh api --method POST repos/mabzadev/punksbot/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, où `<blocker-db-id>` est l’identifiant numérique de base de données du bloqueur, pas son numéro ni son `node_id`. Si les dépendances ne sont pas disponibles, ajoutez `Bloqué par : #<n>, #<n>` au début du corps. Un ticket est débloqué lorsque tous ses bloqueurs sont fermés.
- **Requête de frontière** : répertoriez les enfants ouverts de la carte, puis écartez ceux qui ont un bloqueur ouvert ou un responsable. Le premier ticket restant dans l’ordre de la carte l’emporte.
- **Réclamation** : utilisez `gh issue edit <n> -R mabzadev/punksbot --add-assignee @me`.
- **Résoudre** : utilisez `gh issue comment <n> -R mabzadev/punksbot --body "<answer>"`, puis `gh issue close <n> -R mabzadev/punksbot`, puis ajoutez un pointeur de contexte — essentiel et lien — aux décisions de la carte jusqu’à présent.
