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
- Correctif sous preuve locale : `0c6e1d4f36634ec6c3354f7a3bc1f8f1542f0ac1`
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
| Rust desktop | `2943 passed`, `19 ignored`, `0 failed` avec `punks-local,mesh-llm` après les correctifs TTL, recherche, Fil et adhésion Agent |
| Clippy `punks-local,mesh-llm` | Vert avec `-D warnings` après les correctifs TTL, recherche, Fil et adhésion Agent |
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
| 5 | Cycle de vie d’un Workspace | `local_workspaces`, `local_authority_workspace_hub`, `local_authority_workspace` | `Research Local` créé, renommé `Research Archive Proof`, archivé, retiré du rail, restauré puis remonté | Registre + autorité SQLite par UUID committés sans changer l’URL `f8a9085d…localhost:18787` | URLs loopback distinctes et Messages mutuellement absents observés avant et après le cycle | Nom restauré, Workspace actif et Message `Research Workspace isolated persistence proof` relus après relaunch | PARTIELLE — suppression irréversible et anti-résurrection restent à prouver |
| 6 | Gestion des Conversations | `local_authority_channels`, `local_authority_channel_ttl` | Conversation temporaire créée, renommée `research-lab`, archivée puis désarchivée dans le `.app` | Métadonnées, description et échéance autoritaires relues ; test TDD garantit la conservation exacte du `ttl_deadline` | Sidebar, composer désactivé en archive, retour actif et projection TTL « Aug 30 at 12:39 PM » observés | Même échéance relue après relaunch, puis Conversation absente du rail après expiration effective du TTL | PARTIELLE — accès, managers, topic/purpose et suppression restent à prouver |
| 7 | Attention | projections de lecture/non-lus et UI existante | `Mark unread` et `Follow thread` exercés depuis le Message | Suivi relu comme `Unfollow thread` | Rail non-lu et état de suivi observés | `Unfollow thread` relu après rebuild et relaunch | PARTIELLE — marqueur forcé, mute et préférences multi-appareil restent à prouver |
| 8 | Présence | transport loopback et projections éphémères | Local Punk relu `Online` ; Honey est passé `Online` pendant le corps local puis `Offline` après Stop | Aucun état de présence durable utilisé comme autorité métier | Carte et profil Honey ont suivi le processus vivant puis son extinction | Après relaunch, Honey reste Offline et aucun processus Agent ne ressuscite | PARTIELLE — deux humains, frappe éphémère, expiration et dégradation transport restent à prouver |
| 9 | Recherche de Conversation | `local_authority_query`, index SQLite | Recherche `edited lifecycle` exercée dans le `.app` | FTS SQLite remplacé par le contenu effectif ; ancien texte exclu ; rétraction/restauration/restart couverts en TDD | Résultat exact avec auteur, Conversation, ID stable et texte édité observé | Même résultat édité obtenu après rebuild et relaunch | PARTIELLE — réautorisation et non-divulgation après perte d’accès restent à prouver |
| 10 | Modération | `local_authority_governance` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 11 | Conversations Forum | UI Forum + autorité de contenu | Forum `forum-proof` créé depuis l’action dédiée `New forum` avec purpose `Durable threaded topics` | Conversation Forum UUID `3a28c50e…bf23` committée séparément des Streams | Entrée sous la section Forums et vue spécialisée `Forum posts / Start a new post…` observées | Forum, purpose et vue vide spécialisée relus après relaunch | PARTIELLE — post à sujet obligatoire, hiérarchie, tri, épingle et verrouillage restent à prouver |
| 12 | Conversations directes fiables | `local_authority_dms` | À prouver à deux identités | À prouver | À prouver | À prouver | NON TERMINALE |
| 13 | Cmd+K | UI Search + requêtes locales | Cmd+K a trouvé `edited lifecycle` puis navigué vers le Message | Résultat lié à l’ID autoritaire du Message, pas à l’événement d’édition | Route Conversation + `messageId` + Fil ouverte depuis le résultat | Recherche et navigation répétées après relaunch du bundle | PARTIELLE — fournisseurs Conversations, Punks, actions et résultats partiels restent à prouver |
| 14 | Premier Bot Punks | runtime ACP et `managed_agents` | Honey, Fizz et Pollen démarrés, relus `running`, puis arrêtés proprement dans leurs Workspaces | Chaque clé exacte a été réparée comme membre Workspace `bot` avant spawn ; isolation par URL couverte en TDD | Trois processus `punks-acp` successifs sans nouvelle erreur de harness ; le journal Fizz conserve l’ancien échec puis un nouveau start réussi | Après relaunch, les Agents restent arrêtés et les adhésions `bot` persistent ; aucun processus résiduel | PARTIELLE — Message/réaction, Admission, budgets et Reçu restent à prouver |
| 15 | Références et broadcasts | autorité de contenu + mentions UI | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 16 | Organisation des Messages | réactions, épingles et signets locaux | `Pin to Workspace` et `Bookmark privately` exercés dans le `.app` | Toasts de commit `Message pinned` et `Message bookmarked` observés | Menu relu avec les inverses autoritaires `Unpin` et `Remove private bookmark` | Les deux inverses sont encore présents après rebuild et relaunch | PARTIELLE — note de signet et séparation explicite par second Compte restent à prouver |
| 17 | Home | projection Home existante | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 18 | Pièces jointes | `local_authority_media`, `local_authority_media_tests` | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 19 | Identités visuelles | profils, emoji et média locaux | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 20 | Canvas | `local_authority_canvas` | Canvas créé puis édité en deux révisions Markdown depuis les réglages de `#general` | Seconde révision acceptée avec précondition autoritaire ; conflits et historique couverts par le test Rust dédié | Vue rendue avec titre et trois items, dont `second authoritative revision` | Résumé dans les réglages et contenu complet exact relus après fermeture/relaunch du `.app` | PARTIELLE — conflit natif, resynchronisation et chiffrement/versionnement restent à prouver |
| 21 | Repositories humains | `local_authority_git` et parcours Projects | Project `punksbot-proof` et repository `proof-repo` créés dans Research depuis l’UI | Repositories bare réels matérialisés sous l’autorité Git isolée du Workspace ; `git rev-parse --is-bare-repository` retourne `true` | Vue Project expose Overview/Files/Commits/Tasks/Review/Channels/Contributors et Activity `created the repository` | Project, `proof-repo`, compteurs Projects 1 / Repositories 2 / Channels 1 relus après relaunch | PARTIELLE — GitHub App, Preuve d’accès personnelle, clone court, lecture et mutation GitHub restent à prouver |
| 22 | Corps local d’une Installation | sidecars Punks + runtime ACP local | `Start` puis `Stop` exercés sur Honey, Fizz et Pollen dans le `.app` | Adhésion Workspace `bot` autoritaire écrite avant chaque spawn ; aucune adhésion créée dans l’autre Workspace | Sidecar packagé `punks-acp` observé vivant puis terminé à chaque cycle ; aucun processus Agent résiduel | État arrêté relu après relaunch et aucun auto-start non demandé | PARTIELLE — bail court, permissions locales, révocation et changement de génération restent à prouver |
| 23 | Workflows essentiels | `local_authority_workflows`, approbations et traces | `Full Local Workflow Proof` créé et activé dans `#general`, puis déclenché manuellement | Définition UUID `987064ed…40e1` et run `bcb499fd…a5b3` committés dans l’autorité Research | Étape `Delay 5s` terminée avec trace `delay_status: elapsed`, sans avertissement backend | Même définition active et résumé `When a message is posted, wait 5 seconds` relus après relaunch | PARTIELLE — commande métier, approbation et déclencheurs Message/Réaction réels restent à prouver |
| 24 | Forge | `local_authority_git` + UI Projects/PR/issues | Project et deux repositories locaux créés, sélectionnés et relus dans la Forge | Annonce Project `30621:…:punksbot-proof` et repositories isolés committés | Activity Forge, filtres Projects/Repositories/Tasks/Reviews/Channels et tabs repository observés | Composition Project/repositories encore présente après relaunch | PARTIELLE — branches, CI, revues, issues, PR et protections GitHub restent à prouver |
| 25 | Huddles humains | `local_authority_huddles`, audio loopback | À prouver à deux identités | À prouver | À prouver | Lifecycle à prouver après redémarrage | NON TERMINALE |
| 26 | Agents avancés | personas, équipes, fournisseurs et modèles locaux | Personas Fizz/Honey/Pollen, Welcome Team et deux instances Fizz relus ; cycle runtime Honey exercé | Instance Honey et son identité Workspace restent distinctes des définitions/personas | UI expose runtime, provider, modèle, accès owner-only, équipe et instances sans inventer de valeurs manquantes | Roster et état arrêté relus après relaunch | PARTIELLE — modèle local réel, mémoire, budgets, versionnement et corps distant restent à prouver |
| 27 | Workflows temporels et externes | scheduler, webhooks et `local_authority_reminders` | Délai Workflow de 5 secondes déclenché depuis l’UI | Timer durable créé puis consommé par le scheduler embarqué | Run passé à `completed` avec `started_at`, `completed_at` et `due_at` distincts de 5 secondes | Définition et run durable encore présents après relaunch | PARTIELLE — horaires IANA, occurrence manquée, webhook HMAC, rappels consentis et dead letter restent à prouver |
| 28 | Templates de Conversation | UI Templates + commandes Tauri existantes | `Full Local Template Proof` créé puis sélectionné dans New channel pour créer `template-proof` | Template et Conversation UUID `732efed7…cbbd` committés ; description et Canvas appliqués ensemble | Preview `Open · Canvas included`, description `Reusable local Conversation` et placeholders rendus en `template-proof / Created from Full Local Template Proof` | Conversation dans le rail, description et Canvas exacts relus après relaunch | PARTIELLE — preview immuable, paramètres, résolution de capacités et politiques abort/compensate/keep_partial restent à prouver |
| 29 | Extensions vocales | STT/TTS locaux, consentement Huddle | Réglages Voice ouverts sans solliciter le micro ; `Agent text to speech` relu activé | Voix locale Pocket TTS `Mary` sélectionnée, fichiers annoncés privés sur cet appareil | UI promet une lecture ordonnée uniquement des nouvelles réponses Agent pendant un Huddle actif | Préférence TTS locale relue après les relaunchs précédents ; aucun enregistrement ni processus vocal lancé | PARTIELLE — consentements Huddle STT/TTS, transcript partiel/final, résumé et rétention éphémère restent à prouver |
| 30 | Pulse | autorité de contenu + UI Pulse | À prouver | À prouver | À prouver | À prouver | NON TERMINALE |
| 31 | Calcul partagé | `mesh_llm` embarqué et UI Mesh | Surface native `Share compute` ouverte ; opt-in `Share this machine` explicitement désactivé | Profil matériel Apple M2 Pro / 12 GB AI et limite `Max VRAM` dérivés localement | Modèle recommandé `unsloth/gemma-4-E4B-it-GGUF:Q4_K_M`, 4,6 GB, `Fits well` affiché avec avertissement de téléchargement | Préférence reste off ; aucun runtime, slot ou processus de calcul laissé actif | PARTIELLE — téléchargement 4,6 GB volontairement non déclenché ; offre, présence, sélection, bail, sandbox et révocation restent à prouver |

## Écarts natifs ouverts

1. Prouver encore les rétractions, restaurations et effacements de Messages ;
   l’édition est maintenant cohérente entre timeline, recherche et Fil.
2. Configurer un modèle réel et prouver un tour Agent ; les trois starters
   démarrent puis s’arrêtent désormais sans nouvelle erreur d’auth.
3. Conserver captures, arbre d’accessibilité et actions natives par ligne du
   `.app` désormais adressable à l’automatisation macOS.
4. Étendre les preuves natives aux sept actions de Workflow maintenant routées
   vers `LocalAuthority` sans avertissement backend trompeur.
5. Construire et scanner le bundle release distribué, ses sidecars, plist,
   menus, espaces de stockage et trafic observé.
