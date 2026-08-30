# Punks Full Local 0.5.20 — matrice de preuve terminale

Cette matrice suit les 31 tranches canoniques de l’issue GitHub `#47`. Elle ne
transforme jamais une route visible, une couture implémentée ou un test unitaire
en preuve native. Une ligne n’est `TERMINALE` que si le même build natif exerce
l’action UI, observe le commit autoritaire, relit le résultat, observe son
événement ou sa projection utile, redémarre l’application puis relit l’état
persisté.

## Build sous audit

- Version : `0.5.20`
- Branche : `staging`
- Base consolidée publiée : `e85f8c65fb9a24340bc07a2ffe00b2861f0b9616`
- Correctif sous preuve locale : `26beca51b830b8676bdb66da2199b15dc9086bb0`
- Autorité : `LocalAuthority` SQLite embarquée, loopback `127.0.0.1:18787`
- Interdits : Cloudflare, workerd, relay historique, Docker, PostgreSQL, Redis,
  MinIO, Helm et Kubernetes
- Verdict global courant : **NON TERMINAL**

## Gates frais déjà obtenus

| Gate | Verdict frais |
|---|---|
| Frontend check | Vert ; avertissements Biome non bloquants uniquement |
| TypeScript | Vert |
| Frontend tests | `5533 passed`, `0 failed` |
| Build Vite `VITE_PUNKS_LOCAL=1` | Vert |
| Scan frontend Punks | Vert |
| Rust desktop | `2941 passed`, `19 ignored`, `0 failed` avec `punks-local,mesh-llm` après les correctifs TTL, recherche et Fil |
| Clippy `punks-local,mesh-llm` | Vert avec `-D warnings` après les correctifs TTL, recherche et Fil |
| Frontière CI managed-only | Verte ; 14 workflows Punks actifs |
| Lancement natif | Bundle `.app` reconstruit après le correctif TTL ; comptes, Workspaces, Messages, Fil et Conversation temporaire relus après relaunch réel |

## Matrice 1–31

`Coutures présentes` indique seulement où commencer l’exercice. Les cinq
colonnes de preuve restent volontairement fermées tant qu’un parcours natif
frais n’a pas produit les observations correspondantes.

| T | Capacité | Coutures présentes | UI native | Commit + relecture | Événement / projection | Redémarrage + persistance | Verdict |
|---:|---|---|---|---|---|---|---|
| 1 | Boucle sociale Punks | `local_authority_content*`, HTTP/WS loopback | Message racine publié et relu dans le `.app` | Événement kind 9 confirmé dans SQLite et relu via la fenêtre autoritaire | Livraison live puis page `Message + bounds` observées | Même Message relu après fermeture/réouverture des mêmes octets | PARTIELLE — sujet et parcours social complet restent à prouver |
| 2 | Cycle de vie des Messages | `local_authority_content*`, `local_authority_lifecycle` | Réaction 👍, réponse et édition publiées puis relues dans le `.app` | Édition committée ; index effectif et réponse de recherche relisent le nouveau texte sans changer l’ID du Message | Timeline, résultat Cmd+K et root du Fil affichent tous `(edited)` et le texte exact ; fermeture `restored/erased` couverte en TDD | Réaction, compteur, réponse et édition exacte relus dans timeline et Fil après redémarrage | PARTIELLE — rétraction, restauration et effacement natifs attendent le geste destructif confirmé |
| 3 | Fusion de Comptes Punks | `local_accounts`, `local_authority_account_tests` | Second Compte créé ; bascules premier ↔ second exercées | Compte/génération actifs committés avant relaunch | Roster passé à 4 et vues propres à chaque identité observées | Deux Comptes et identité active relus après plusieurs relaunchs | PARTIELLE — Plan/Reçu et Fusion irréversible restent à prouver |
| 4 | Identité sociale et gouvernance | `local_authority_accounts`, `local_authority_membership`, `local_authority_governance` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 5 | Cycle de vie d’un Workspace | `local_workspaces`, `local_authority_workspace_hub`, `local_authority_workspace` | `Research Local` créé et bascules primaire ↔ Research exercées | Registre + autorité SQLite par UUID committés | URLs loopback distinctes et Messages mutuellement absents observés | Deux Workspaces et Message Research exact relus après redémarrage | PARTIELLE — rename/archive/restore/delete restent à prouver |
| 6 | Gestion des Conversations | `local_authority_channels`, `local_authority_channel_ttl` | Conversation temporaire créée, renommée `research-lab`, archivée puis désarchivée dans le `.app` | Métadonnées, description et échéance autoritaires relues ; test TDD garantit la conservation exacte du `ttl_deadline` | Sidebar, composer désactivé en archive, retour actif et projection TTL « Aug 30 at 12:39 PM » observés | Workspace, nom, état désarchivé et même échéance `12:39 PM` relus après relaunch du bundle | PARTIELLE — accès, managers, topic/purpose et suppression restent à prouver |
| 7 | Attention | projections de lecture/non-lus et UI existante | `Mark unread` et `Follow thread` exercés depuis le Message | Suivi relu comme `Unfollow thread` | Rail non-lu et état de suivi observés | `Unfollow thread` relu après rebuild et relaunch | PARTIELLE — marqueur forcé, mute et préférences multi-appareil restent à prouver |
| 8 | Présence | transport loopback et projections éphémères | À prouver à deux identités | À prouver | À prouver | Sans persistance métier ; extinction à prouver | NON TERMINALE |
| 9 | Recherche de Conversation | `local_authority_query`, index SQLite | Recherche `edited lifecycle` exercée dans le `.app` | FTS SQLite remplacé par le contenu effectif ; ancien texte exclu ; rétraction/restauration/restart couverts en TDD | Résultat exact avec auteur, Conversation, ID stable et texte édité observé | Même résultat édité obtenu après rebuild et relaunch | PARTIELLE — réautorisation et non-divulgation après perte d’accès restent à prouver |
| 10 | Modération | `local_authority_governance` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 11 | Conversations Forum | UI Forum + autorité de contenu | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 12 | Conversations directes fiables | `local_authority_dms` | À prouver à deux identités | À prouver | À prouver | À prouver | NON TERMINALE |
| 13 | Cmd+K | UI Search + requêtes locales | Cmd+K a trouvé `edited lifecycle` puis navigué vers le Message | Résultat lié à l’ID autoritaire du Message, pas à l’événement d’édition | Route Conversation + `messageId` + Fil ouverte depuis le résultat | Recherche et navigation répétées après relaunch du bundle | PARTIELLE — fournisseurs Conversations, Punks, actions et résultats partiels restent à prouver |
| 14 | Premier Bot Punks | runtime ACP et `managed_agents` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 15 | Références et broadcasts | autorité de contenu + mentions UI | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 16 | Organisation des Messages | réactions, épingles et signets locaux | `Pin to Workspace` et `Bookmark privately` exercés dans le `.app` | Toasts de commit `Message pinned` et `Message bookmarked` observés | Menu relu avec les inverses autoritaires `Unpin` et `Remove private bookmark` | Les deux inverses sont encore présents après rebuild et relaunch | PARTIELLE — note de signet et séparation explicite par second Compte restent à prouver |
| 17 | Home | projection Home existante | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 18 | Pièces jointes | `local_authority_media`, `local_authority_media_tests` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 19 | Identités visuelles | profils, emoji et média locaux | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 20 | Canvas | `local_authority_canvas` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 21 | Repositories humains | `local_authority_git` et parcours Projects | À prouver sur un dépôt réel choisi | À prouver | À prouver | À prouver | NON TERMINALE |
| 22 | Corps local d’une Installation | sidecars Punks + runtime ACP local | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 23 | Workflows essentiels | `local_authority_workflows`, approbations et traces | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 24 | Forge | `local_authority_git` + UI Projects/PR/issues | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 25 | Huddles humains | `local_authority_huddles`, audio loopback | À prouver à deux identités | À prouver | À prouver | Lifecycle à prouver après redémarrage | NON TERMINALE |
| 26 | Agents avancés | personas, équipes, fournisseurs et modèles locaux | À prouver avec un modèle local réel | À prouver | À prouver | À prouver | NON TERMINALE |
| 27 | Workflows temporels et externes | scheduler, webhooks et `local_authority_reminders` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 28 | Templates de Conversation | UI Templates + commandes Tauri existantes | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 29 | Extensions vocales | STT/TTS locaux, consentement Huddle | À prouver avec consentement explicite | À prouver | À prouver | Préférences et absence d’enregistrement à prouver | NON TERMINALE |
| 30 | Pulse | autorité de contenu + UI Pulse | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 31 | Calcul partagé | `mesh_llm` embarqué et UI Mesh | À prouver entre deux identités/appareils ou processus admis | À prouver | À prouver | À prouver | NON TERMINALE |

## Écarts natifs ouverts

1. Prouver encore les rétractions, restaurations et effacements de Messages ;
   l’édition est maintenant cohérente entre timeline, recherche et Fil.
2. Rejouer l’amorçage Welcome après découverte ACP forcée et obtenir trois
   installations configurées ou un état d’action honnête si un modèle/credential
   manque.
3. Conserver captures, arbre d’accessibilité et actions natives par ligne du
   `.app` désormais adressable à l’automatisation macOS.
4. Étendre les preuves natives aux sept actions de Workflow maintenant routées
   vers `LocalAuthority` sans avertissement backend trompeur.
5. Construire et scanner le bundle release distribué, ses sidecars, plist,
   menus, espaces de stockage et trafic observé.
