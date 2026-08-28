# Inventaire de retrait Buzz → Punks — vue lisible

> Vue dérivée de [`withdrawal-inventory.yaml`](./withdrawal-inventory.yaml), qui est canonique.
> Régénérée par `scripts/render-withdrawal-inventory.mjs` (`pnpm migration:render`) — ne pas éditer.
> Décisions : issues [#13](https://github.com/punksbot/punksbot/issues/13), [#14](https://github.com/punksbot/punksbot/issues/14) et [#17](https://github.com/punksbot/punksbot/issues/17).
> Checkpoint de récupération : `50e16de180dda4365f8001a8a73503f16977a175` — baseline Buzz gelée : `da818eddc2f470c006a1073c8c5452f8a989f272` — version 1 — sha256 canonique `6a8681b64db2338484adb0285a7a249022991ce00212ed1d0b39d008b842494f`.

Chaque actif reçoit exactement un verdict. Un module partagé appartient à la tranche de
son **dernier** consommateur ; ses parties antérieures disparaissent plus tôt (champ
« séparation »). Aucun renommage, dispatcher universel ou module mixte ne peut masquer
une dépendance active.

## Attribution par tranche

| Tranche | Actifs retirés par le candidat accepté |
|---|---|
| 3 | `desktop/src/features/identity-archive/` |
| 4 | `desktop/src/features/community-members/` ; `desktop/src/features/profile/` ; `desktop/src-tauri/src/nostr_bind.rs` ; `desktop/src-tauri/src/relay_admission.rs` |
| 5 | `desktop/src/features/communities/` ; `desktop/playwright.release-smoke.config.ts` ; `desktop/src-tauri/src/builderlab.rs` ; `Justfile (cibles desktop-release-smoke)` ; `scripts/run-desktop-release-smoke.sh` |
| 7 | `desktop/src/features/notifications/` ; `desktop/src-tauri/src/{observed_unread.rs,unread_catch_up.rs}` |
| 8 | `desktop/src/features/{presence,user-status}/` |
| 10 | `desktop/src/features/moderation/` |
| 11 | `desktop/src/app/routes/{ChannelRouteScreen.tsx,channels.$channelId.tsx,channels.$channelId.posts.$postId.tsx}` ; `desktop/src/features/forum/` |
| 12 | `desktop/src/app/routes/messages.new.tsx` |
| 13 | `desktop/src/features/search/` |
| 17 | `desktop/src/app/routes/index.tsx` ; `desktop/src/features/home/` |
| 18 | `desktop/src-tauri/src/{media_proxy.rs}` |
| 19 | `desktop/src/features/custom-emoji/` ; `desktop/src-tauri/src/link_preview_tags.rs` |
| 22 | `desktop/src-tauri/src/managed_agents/` ; `desktop/src-tauri/Cargo.toml (arête buzz-agent)` ; `scripts/bundle-sidecars.sh` |
| 23 | `desktop/src/app/routes/{WorkflowsRouteScreen.tsx,workflows.tsx,workflows.$workflowId.tsx}` ; `desktop/src/features/workflows/` |
| 24 | `desktop/src/app/routes/{projects.tsx,projects.$projectId.tsx}` ; `desktop/src/features/projects/` |
| 25 | `desktop/src/app/{AppHuddleBar.tsx,AppHuddleShell.tsx,useHuddlePresentation.ts,huddleBackingChannelStorage.*,huddleChannelVisibility.*}` ; `desktop/src/features/huddle/` ; `desktop/src-tauri/src/{huddle/,linux_media.rs,ptt_shortcut.rs}` ; `desktop/src-tauri/resources/` |
| 26 | `desktop/src/app/routes/agents.tsx` ; `desktop/src/features/local-archive/` ; `desktop/src/features/agent-memory/` ; `desktop/src/features/agents/` ; `desktop/src-tauri/src/{persona_catalog.rs,persona_catalog_tests.rs}` ; `desktop/src-tauri/Cargo.toml (arête buzz-persona)` |
| 27 | `desktop/src/app/routes/reminders.tsx` ; `desktop/src/features/reminders/` |
| 28 | `desktop/src/features/channel-templates/` ; `desktop/src-tauri/src/templates/` |
| 29 | `desktop/src-tauri/Cargo.toml (arête buzz-voice)` ; `crates/buzz-voice/` |
| 30 | `desktop/src/app/routes/pulse.tsx` ; `desktop/src/features/channels/` ; `desktop/src/features/messages/` ; `desktop/src/features/pulse/` ; `desktop/src/features/sidebar/` |
| 31 | `desktop/src/features/mesh-compute/` ; `desktop/src/features/settings/` |

## Scellement desktop (gate terminal, après la tranche 31)

- `desktop/src/shared/api/relayClientSession.ts` — séparation : chemins de la boucle sociale (bootstrap, historique, publication, réactions) retirés du graphe accepté à la tranche:1
- `desktop/src/shared/api/relay*.ts` — séparation : rate-limit/reconnect/watchdog partagés multi-tranches ; présence retirée à la tranche:8, observer à la tranche:14
- `desktop/src/shared/api/{readOnlyRelayClient.ts,observerRelay.ts,presenceRelaySubscription.ts}` — séparation : présence retirée à la tranche:8 ; observer retiré à la tranche:14
- `desktop/src/shared/api/types.ts` — RelayEvent, type central du flux Nostr
- `desktop/src/shared/api/tauri*.ts` — séparation : un wrapper par capacité meurt avec sa tranche (messages:1-2, membres:4, canaux:6, présence:8, modération:10, bots:14-22, workflows:23, personas:26)
- `desktop/src/shared/api/` — reste du socle relay (client, invites, modération, members, social, projet git, workflows…)
- `desktop/src/shared/constants/kinds.ts` — registre des kinds Nostr Buzz
- `desktop/src/shared/lib/{nostrUtils.ts,pubkey.ts,normalizeRelayUrl.ts,relayError.ts,useRelayOrigin.ts,ncryptsecSourceScan.ts}`
- `desktop/src/app/RelayConnectionOverlay.tsx`
- `desktop/src/app/App.tsx` — séparation : onboarding/session Buzz → tranche:1 ; communautés → tranche:5 ; huddle → tranche:25 ; providers React et shell visuel neutres conservés après scission ; les dernières arêtes identité/relay meurent au scellement

- `desktop/src/app/AppShell.tsx` — séparation : boucle sociale → tranche:1 ; communautés/sidebar → tranche:6 ; attention → tranche:7 ; présence → tranche:8 ; DMs → tranche:12 ; Bots/Home → tranches:14/17 ; emoji → tranche:19 ; Workflows/Huddle/Agents/Reminders/ Templates/Pulse → tranches:23/25/26/27/28/30 ; le chrome neutre est extrait, les dernières arêtes relay, RelayEvent et identité Buzz meurent au scellement

- `desktop/src/app/routes/root.tsx` — séparation : la route racine reste le point de montage du shell ; AppShell Buzz est remplacé avant conservation de l'enveloppe neutre
- `desktop/src/app/` — séparation : reste de l'orchestration de shell partagé ; les routes et capacités dont le dernier consommateur est connu ont une entrée plus spécifique ci-dessus

- `desktop/src/main.tsx` — séparation : bootstrap, providers, onboarding, communautés, profil Nostr et Huddle Buzz meurent avec leurs derniers consommateurs ; l’entrée produit Punks est déjà extraite dans desktop/punks-product/main.tsx et desktop/src/punks-main.tsx
 — dernière entrée React Buzz, retirée au gate terminal après extraction des mécanismes neutres
- `desktop/src/testing/` — séparation : harnais Buzz (signature nostr-tools, émission RelayEvent) retirés par tranche ; façade Punks extraite et conservée dans le harnais du candidat
- `desktop/tests/` — séparation : scénarios Buzz retirés avec leur dernière capacité et enregistrés dans retraits-par-tranche ; mécanismes Playwright neutres extraits
- `desktop/src-tauri/src/{native_websocket.rs,native_websocket_batch.rs,native_relay_client.rs,native_relay_client_tests.rs}`
- `desktop/src-tauri/src/{relay.rs,relay/}` — séparation : commandes de la boucle sociale retirées du graphe accepté à la tranche:1
- `desktop/src-tauri/src/{nostr_convert.rs,nostr_convert/}`
- `desktop/src-tauri/src/{events.rs,events/}` — builders d’événements signés multi-capacités
- `desktop/src-tauri/src/{app_state_keyring.rs,secret_store.rs,key_backup.rs,key_backup_tests.rs,identity_storage.rs,app_state.rs,app_state_tests.rs,assets/}` — séparation : mécanisme coffre OS conservé pour le jar natif Punks — état relay/identité Nostr persisté, wordlist de phrase de sauvegarde
- `desktop/src-tauri/src/{egress_guard.rs,egress_guard_tests.rs,event_sync.rs,event_sync_tests.rs,event_sync_team_events_tests.rs}`
- `desktop/src-tauri/src/commands/` — séparation : chaque groupe de commandes meurt avec sa tranche : signalement/relay-admission:4, canaux/DM:6-12, présence:8, modération:10, unread:7, recherche:9-13, workflows:23, personas/teams:26, archive Nostr:scellement
- `desktop/src-tauri/src/archive/` — archives locales d’événements Nostr (gate terminal #14)
- `desktop/src-tauri/src/{migration.rs,migration/}` — réconciliation des données Buzz persistées (renames Sprout→Buzz, partage dev)
- `desktop/src-tauri/src/` — reste du socle relay/Nostr du backend Tauri (modules Buzz résiduels, modèles d’identité) — retiré au gate terminal avec ses arêtes Cargo
- `desktop/src-tauri/Cargo.toml (arêtes buzz-core, buzz-sdk, buzz-ws-client, buzz-media dev)`
- `desktop/package.json (dépendances nostr 0.44 et nostr-tools)`
- `scripts/nostr-tools-test-package.json` — suit la devDep nostr-tools

## Retrait global du serveur historique (entrée terminale)

L’entrée « Retrait global du serveur historique » s’ouvre uniquement lorsque : (1) les 31 tranches desktop sont scellées ; (2) chaque client requis — desktop, web, mobile, admin-web — possède un verdict explicite (migré par un effort décidé ailleurs, ou retiré) ; (3) le gate négatif prouve qu’aucun graphe produit, outil actif ni artefact n’atteint le relay, son identité Nostr publique ou ses dépendances serveur. Elle ne crée aucune disponibilité.

- `web/` — client Buzz gelé ; aucune partie migrée par les tranches desktop ; nostr-client/nostr-signer/nip98/invite/repos git-on-Nostr inclus
- `mobile/` — client Buzz gelé ; shared/relay, crypto NIP, pairing, features inclus
- `admin-web/` — console d’administration Buzz gelée
- `crates/{buzz-relay,buzz-db,buzz-pubsub,buzz-auth,buzz-search,buzz-audit,buzz-deletion,buzz-workflow,buzz-media,buzz-relay-mesh,buzz-push-gateway,buzz-pair-relay,buzz-datastore-tracing,buzz-backend-kubernetes}/`
- `crates/{buzz-core,buzz-sdk,buzz-ws-client}/` — séparation : arêtes desktop rompues au scellement
- `crates/{buzz-acp,buzz-cli,buzz-admin,buzz-pairing-cli,buzz-test-client,buzz-dev-mcp,sprig,git-credential-nostr,git-sign-nostr}/`
- `crates/buzz-persona/` — séparation : arête desktop rompue à la tranche:26
- `crates/buzz-agent/` — séparation : arête desktop rompue à la tranche:22
- `crates/buzz-conformance/` — séparation : tests/fixtures/*.jsonl conservés comme goldens neutres attachés à la baseline (registre goldens-ledger.yaml)
- `examples/` — countdown-bot (buzz-sdk) et meadow-core (patrimoine d’agents Buzz)
- `migrations/` — 31 migrations SQL Postgres du relay
- `{Dockerfile,Dockerfile.push-gateway,Dockerfile.sprig,docker-compose.yml,docker-compose.harness.yml,prometheus.yml,ct.yaml}`
- `deploy/` — charts Helm buzz + buzz-push-gateway, compose Caddy, déploiement local HA
- `script/start` — entrypoint CAKE/Istio du pod relay
- `.github/legacy-workflows/` — 18 workflows archivés ; exécution déjà interdite par la frontière managed-only
- `schema/schema.sql`
- `{benchmarks/,perf/}`
- `Cargo.toml` — manifeste racine du workspace Rust Buzz ; ses parties sont détaillées ci-dessous
- `Cargo.toml ([patch.crates-io] aws-creds)` — pin EKS Pod Identity du pod relay S3
- `Cargo.toml (workspace members)` — le workspace Rust se dissout avec les crates serveur
- `Cargo.lock` — graphe généré des crates Buzz ; régénéré à mesure des retraits
- `Justfile (cibles relay, relay-web, admin, staging, production, dev, test-integration, mesh-*, benchmark, goose, release-relay, bootstrap, down, logs, ps)`
- `scripts/{start-relay-for-tests.sh,start-isolated-test-relay.sh,buzz-adopt-prod-agents.sh,ci-mesh-lifecycle-smoke.sh,e2e-git-perms.sh,e2e-large-channel-roster.sh,seed-local-community.sh,seed-admin-dashboard.sh,cleanup-instance-agents.sh,instance-env.sh,dev-setup.sh,dev-reset.sh,_goose-env.sh,grab-emoji.sh,test-signed-canary-contract.sh,run-tests.sh,test-video-upload.sh}`
- `scripts/{cutover/,maintenance/,attach-schema-partitions.sql,backfill-d-tag.sql,release-rulesets.sh}`
- `scripts/{sprig-entrypoint.sh,build-sprig.sh,test-sprig-image.sh,test-k8s-sprig-image-live.sh,test-k8s-provider-release.sh}`
- `scripts/{mobile-release.sh,mobile-worktree-*.sh,publish-mobile-release-candidate.sh,test-mobile-*.sh}` — client mobile gelé, aucune release attendue
- `.env.example` — séparation : le bloc VITE_BUZZ_FORCE_FRESH_ONBOARDING disparaît à la tranche:1 ; le reste appartient au runtime Buzz historique
- `.env.example (blocs relay, db, redis, s3/minio, typesense, git, média, BUZZ_ACP_*, BUZZ_RATE_LIMIT_*)`
- `patches/isomorphic-git*`
- `{NOSTR.md,VISION*.md,ARCHITECTURE.md,RELEASING.md,TESTING.md,CONTRIBUTING.md,README.md,CHANGELOG.md,GOVERNANCE.md,SECURITY.md,CODE_OF_CONDUCT.md,CLAUDE.md}` — conservés comme source de parité jusqu’au retrait global (#13 goldens de baseline)
- `docs/{nips/,multi-tenant-relay.md,multi-tenant-conformance.md,push-gateway-deployment.md,remote-agents.md,buzz-shared-compute-dev.md,git-on-object-storage.md,MCP_DRIVEN_HOOKS.md,bridge-channel-window.md,welcome-kickoff-silent-failures.md}`
- `docs/{formal,upstream,admin,assets}/`

## Conservés (verdicts typés)

### Atelier local autonome

- `desktop/src/features/terminal/`
- `desktop/src-tauri/src/commands/{clipboard.rs,notifications.rs,os_idle.rs,prevent_sleep.rs,updater.rs,window_chrome.rs,window_vibrancy.rs}` — mécanismes OS neutres (presse-papiers, notifications, sommeil, updater, fenêtrage)
- `desktop/src-tauri/src/{mesh_llm/,mesh_llm_stubs.rs}` — séparation : arêtes relay/mesh retirées à la tranche:31 — noyau LLM local (MLX/ggml) de l’Atelier
- `desktop/src-tauri/src/{terminal_runtime.rs,terminal_runtime/,terminal_transport.rs}`
- `desktop/src-tauri/src/{app_menu.rs,initial_window.rs,macos_notifications.rs,mouse_nav.rs,prevent_sleep.rs,shutdown.rs,tray_menu.rs,webkit_rendering.rs,webkit_rendering/}` — fenêtrage, menus, notifications natives, rendu WebKit — mécanismes OS neutres
- `desktop/src-tauri/crates/buzz-terminal/`

### UI neutre

- `desktop/src/shared/` — séparation : api/ et lib Nostr scellés ci-dessus ; constants/kinds.ts au scellement ; deep-links à la tranche:1 — reste neutre (context, hooks, layout, theme, styles, lib datetime/emoji/markdown/clipboard…)
- `desktop/src/app/routes/settings.tsx`
- `desktop/src/{features-manifest.d.ts,jdenticon.d.ts,types/,upng-js.d.ts,vite-env.d.ts}` — déclarations de types et shims sans sémantique Buzz
- `desktop/src/features/chat/` — séparation : types Channel Buzz remplacés par les vues Conversation Punks ; chrome et rendu neutres conservés — rendu neutre alimenté par les vues Punks
- `desktop/public/` — séparation : marque Buzz (buzz.svg, landing/) reprise par l’effort Punks UI ; visuels d’onboarding retirés à la tranche:1

### Mécanismes de test

- `desktop/src/shared/api/{queryClient.ts,tauri.ts}` — mécanisme React Query/invoke neutre ; l’instance devient par WorkspaceSession (décision #11)
- `desktop/{playwright.config.ts,playwright.perf.config.ts}`
- `desktop/src-tauri/tests/`

### Goldens neutres

- `scripts/{normative-corpus.json,model-capabilities.json}` — corpus croisé TS/Rust référencé par le registre des goldens

### Actifs Punks

- `desktop/src/shared/api/punks*` — façade, erreurs, Réactions et adaptateur Tauri sémantiques Punks
- `desktop/src/shared/capabilities/` — disponibilité Punks fermée et garde commune des surfaces desktop
- `desktop/src/{punks-main.tsx,punks.css}` — entrée et styles du produit desktop Punks vérifié
- `desktop/src/features/punks/` — produit Punks, runtime Workspace et boucle sociale du candidat desktop
- `desktop/tests/e2e/capability-masking.spec.ts` — garde structurelle Punks commune aux routes et surfaces indisponibles
- `desktop/playwright.punks-capabilities.config.ts` — harnais Playwright isolé du bundle produit pour les capacités indisponibles
- `desktop/scripts/*punks*` — gates du candidat, du frontend et de l’entrée produit desktop Punks
- `desktop/src-tauri/src/{lib.rs,main.rs}` — séparation : modules, commandes et diagnostics sous cfg buzz-desktop retirés avec leurs tranches puis au scellement ; dispatcher desktop_lib::run et branche punks_runtime::run conservés pour le produit natif Punks
 — entrypoints Tauri mixtes dont la branche Punks est une dépendance active du candidat
- `desktop/src-tauri/src/punks*.rs` — commandes, runtime, lifecycle Message et store de Session Tauri Punks
- `desktop/src-tauri/crates/punks-account-client/` — client sémantique Rust Punks (HTTP, cookies, FOLLOW, bail de génération)
- `desktop/src-tauri/crates/punks-promotion-session/` — processus natif borné utilisé par la preuve de promotion Punks
- `desktop/src-tauri/{capabilities/punks.json,signing/punks-linux-release.asc}` — capacité Tauri et identité de signature native du candidat Punks
- `desktop/src-tauri/tauri.punks*.json` — configurations Tauri fermées du produit et de la signature Windows Punks
- `desktop/punks-product/` — entrée HTML/TypeScript isolée du produit desktop Punks
- `desktop/{tailwind.punks.config.js,tsconfig.punks.json}` — configurations de build fermées de la surface Punks
- `scripts/{check-migration-manifests.mjs,check-migration-manifests.test.mjs,migration-manifest-lib.mjs,render-withdrawal-inventory.mjs}` — gate et générateur des manifestes de migration (issue #49)
- `scripts/{release-graph-lib.mjs,check-release-graph.mjs,check-release-graph.test.mjs,release-graph-live-state.test.mjs}` — gate du graphe de release et du modèle d'attestation (issue #51)
- `scripts/{github-attestation-lib.mjs,promotion-attestation-lib.mjs,promotion-installed-transcript-lib.mjs,promotion-materials-lib.mjs,promotion-materials-lib.test.mjs,promotion-test-fixtures.mjs,promotion-dossier-validator-fixture.mjs,promotion-dossier-lib.mjs,promotion-dossier-lib.test.mjs,promotion-proof-lib.mjs,promotion-resilience-lib.mjs,promotion-local-emission-lib.mjs,promotion-local-emission.test.mjs,check-promotion-dossier.mjs,check-promotion-dossier.test.mjs,promotion-publish-lib.mjs,promotion-publish.mjs,promotion-publish.test.mjs,promotion-frontiers.mjs,promotion-frontiers.test.mjs,receipt-publish.mjs,punks-desktop-candidate-workflow.test.mjs,punks-desktop-promotion-workflow.test.mjs,punks-operational-observation-workflow.test.mjs,check-punks-rust.mjs,punks-native-artifact.mjs,punks-native-artifact.test.mjs,windows-artifact-sign.ps1,windows-artifact-sign.test.ps1}` — harnais d'acceptation d'une promotion : dossier de preuve, gates d'autorisation, chaîne de candidat Tauri signé et émission create-only de l'attestation (issues #52 et #58)
- `scripts/candidate/` — collecte fermée, preuves natives et agrégation attestée des quatre plateformes du candidat Punks
- `package.json` — workspace punksbot — gates Punks (cloudflare:check, punks:check, migration:check)
- `docs/{adr,agents,spec,research}/`
- `docs/migration/` — manifeste de retrait, registre des goldens, dossiers de tranche
- `CONTEXT.md`
- `AGENTS.md` — séparation : sections guide Buzz retirées au retrait global — le lien historique CLAUDE.md reste inventorié séparément avec la documentation Buzz
- `cloudflare/` — registre canonique, workers, workerd, @punks/client, BASELINE.json, frontière managed-only
- `cloudflare/scripts/` — gates, staging et preuves Workers gérés, dont l'expansion de la boucle sociale
- `.github/workflows/{punks-cloudflare.yml,punks-desktop-candidate.yml,punks-operational-observation.yml}`

### Outillage neutre

- `desktop/src/shared/lib/safeStorage.ts` — mécanisme coffre OS réutilisé par le jar natif Punks
- `desktop/src/shared/features/` — feature-gating local, sert les gardes de capacités indisponibles
- `desktop/scripts/` — séparation : checks et entrée produit Punks classés explicitement ; outils Buzz restants suivent leur actif ou le scellement
- `desktop/src-tauri/src/reset.rs` — séparation : parcours d’onboarding sous-jacent retiré à la tranche:1 — wipe atomique deux phases au changement de compte
- `desktop/src-tauri/` — coquille Tauri neutre (manifestes, plists, icônes, capabilities, build.rs)
- `desktop/` — configuration de build du desktop (package.json, biome, vite, tsconfig, tailwind…)
- `Justfile` — séparation : les cibles Buzz qualifiées ci-dessous meurent à leurs échéances ; le conteneur Justfile et les cibles Punks/neutres restent
- `Justfile (cibles desktop-*, mobile-*, web-*, cloudflare via package.json, fmt, clippy, check)`
- `scripts/{prepare-desktop-release.sh,promote-oss-desktop-release.sh,verify-desktop-release-merge.sh,verify-release-ref.sh,test-release-ref-contract.sh,test-oss-desktop-promotion.sh,test-oss-desktop-promotion-behavior.sh,desktop_release.py,desktop-release-cache-key.py,desktop-native-toolchain-id.sh,test-desktop-release-cache-key.sh,test-desktop-release-cache-workflow.sh,test-desktop-release-candidate.sh}` — remplacés par le graphe de release scellé (#16) au fil des activations
- `scripts/{reset-desktop-dev-state.sh,reset-desktop-standalone-state.sh,test-reset-desktop-standalone-state.sh,post-screenshots.sh,check-pr-image-urls.sh,check-branch-skew.sh,check-*-core*.mjs,generate-dev-icon.swift,required-check-succeeded.jq}`
- `bin/` — shims Hermit (Rust, Node) requis par les builds desktop et cloudflare
- `patches/virtua*`
- `{biome.json,lefthook.yml,deny.toml,rust-toolchain.toml,renovate.json,preview-features.json,pnpm-workspace.yaml,pnpm-lock.yaml}` — séparation : prototype punks-desktop retiré à la tranche:1 ; paquets web/admin-web retirés avec leur verdict terminal
- `.github/{CODEOWNERS,ISSUE_TEMPLATE/,PULL_REQUEST_TEMPLATE.md}`
- `{.gitignore,.gitattributes,.dockerignore,LICENSE,.cargo/config.toml,.intersect/sadscan.yaml,.release/,.vscode/settings.json}` — fichiers de configuration neutres du dépôt et des outils contributeurs
- `{.agents/,.claude/,.codex/,.goose/}` — configuration des agents contributeurs
- `docs/linux-rendering-troubleshooting.md`

### Attente refonte UI

- `desktop/src/shared/ui/buzz-logo/` — identité Buzz remplacée par l’effort Punks UI (hors périmètre de cette carte)

## Allowlist Nostr (explicitement hors retrait)

- **Journal interne Punks** : backend cloudflare/ uniquement, jamais un actif client
- **Attestation Punks** : backend cloudflare/ uniquement, jamais un actif client

## Goldens

- Foyer : `goldens/` — Registre : `docs/migration/goldens-ledger.yaml` — Univers indépendant : `docs/migration/goldens-universe.yaml` — Tests Buzz figés : `docs/migration/buzz-tests-universe.yaml`
- Politique : Clé par invariant, jamais par fichier source ; exécution sans relay, Docker, PostgreSQL, Redis ni autre runtime serveur historique ; chaque test Buzz retiré obtient exactement une ligne (preuve Punks, différence intentionnelle, capacité indisponible, hors périmètre). Le registre est rempli tranche par tranche ; le foyer matérialise les goldens déplacés lors de ces retraits.
