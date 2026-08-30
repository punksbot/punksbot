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
- Base consolidée : `ad920681c5ae7db5fc77025fc11d158389ed8743`
- Autorité : `LocalAuthority` SQLite embarquée, loopback `127.0.0.1:18787`
- Interdits : Cloudflare, workerd, relay historique, Docker, PostgreSQL, Redis,
  MinIO, Helm et Kubernetes
- Verdict global courant : **NON TERMINAL**

## Gates frais déjà obtenus

| Gate | Verdict frais |
|---|---|
| Frontend check | Vert ; avertissements Biome non bloquants uniquement |
| TypeScript | Vert |
| Frontend tests | `5527 passed`, `0 failed` |
| Build Vite `VITE_PUNKS_LOCAL=1` | Vert |
| Scan frontend Punks | Vert |
| Rust desktop | `2934 passed`, `19 ignored` avant les corrections natives de reprise ; relance finale requise |
| Clippy `punks-local,mesh-llm` | Vert après trois corrections mécaniques |
| Frontière CI managed-only | Verte ; 14 workflows Punks actifs |
| Lancement natif | Réalisé ; a révélé puis motivé deux corrections TDD (import Buzz interdit et découverte froide du runtime Welcome) |

## Matrice 1–31

`Coutures présentes` indique seulement où commencer l’exercice. Les cinq
colonnes de preuve restent volontairement fermées tant qu’un parcours natif
frais n’a pas produit les observations correspondantes.

| T | Capacité | Coutures présentes | UI native | Commit + relecture | Événement / projection | Redémarrage + persistance | Verdict |
|---:|---|---|---|---|---|---|---|
| 1 | Boucle sociale Punks | `local_authority_content*`, HTTP/WS loopback | Message racine publié et relu dans le `.app` | Événement kind 9 confirmé dans SQLite et relu via la fenêtre autoritaire | Livraison live puis page `Message + bounds` observées | Même Message relu après fermeture/réouverture des mêmes octets | PARTIELLE — réponse, sujet et réaction restent à prouver |
| 2 | Cycle de vie des Messages | `local_authority_content*`, `local_authority_lifecycle` | Réaction 👍 et réponse publiées puis relues dans le `.app` | Événements de réaction/réponse committés et rechargés | Fermeture auxiliaire + résumé signé `1 reply` observés | Réaction, compteur et texte exact de la réponse relus après redémarrage | PARTIELLE — édition, rétraction, restauration et effacement restent à prouver |
| 3 | Fusion de Comptes Punks | `local_accounts`, `local_authority_account_tests` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 4 | Identité sociale et gouvernance | `local_authority_accounts`, `local_authority_membership`, `local_authority_governance` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 5 | Cycle de vie d’un Workspace | `local_workspaces`, `local_authority_workspace_hub`, `local_authority_workspace` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 6 | Gestion des Conversations | `local_authority_channels`, `local_authority_channel_ttl` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 7 | Attention | projections de lecture/non-lus et UI existante | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 8 | Présence | transport loopback et projections éphémères | À prouver à deux identités | À prouver | À prouver | Sans persistance métier ; extinction à prouver | NON TERMINALE |
| 9 | Recherche de Conversation | `local_authority_query`, index SQLite | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 10 | Modération | `local_authority_governance` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 11 | Conversations Forum | UI Forum + autorité de contenu | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 12 | Conversations directes fiables | `local_authority_dms` | À prouver à deux identités | À prouver | À prouver | À prouver | NON TERMINALE |
| 13 | Cmd+K | UI Search + requêtes locales | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 14 | Premier Bot Punks | runtime ACP et `managed_agents` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 15 | Références et broadcasts | autorité de contenu + mentions UI | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 16 | Organisation des Messages | réactions, épingles et signets locaux | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
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

1. Étendre la fenêtre autoritaire locale aux résumés de Fil et à la fermeture
   auxiliaire avant de considérer réponses/réactions/éditions persistantes.
2. Rejouer l’amorçage Welcome après découverte ACP forcée et obtenir trois
   installations configurées ou un état d’action honnête si un modèle/credential
   manque.
3. Conserver captures, arbre d’accessibilité et actions natives par ligne du
   `.app` désormais adressable à l’automatisation macOS.
4. Auditer les fallbacks `command kind … not implemented locally` et
   `action not implemented locally` contre l’ensemble exact annoncé par l’UI.
5. Construire et scanner le bundle release distribué, ses sidecars, plist,
   menus, espaces de stockage et trafic observé.
