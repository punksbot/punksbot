# Tranche 1 — état de préparation non promouvable

Cet état accompagne la préparation de `desktop-social-loop@1`. Il ne constitue
ni un dossier de preuve, ni une attestation de promotion, ni une déclaration de
disponibilité produit.

Références figées par la spec :

- checkpoint de récupération : `50e16de180dda4365f8001a8a73503f16977a175` ;
- baseline Buzz : `da818eddc2f470c006a1073c8c5452f8a989f272` ;
- profil préparé : `desktop-social-loop@1`, registre version 1.

## Préparé dans le code

- contrats fermés de compatibilité, liste des Workspaces, liste des Streams et
  résolution bornée des auteurs ;
- découverte D1 privée avec réautorisation systématique par les Durable Objects
  et continuations HMAC liées au Punk et au Workspace ;
- client sémantique TypeScript sans reprise automatique des mutations ambiguës ;
- crate Rust `punks-account-client` possédant HTTP, cookies, WebSocket FOLLOW,
  validation, bail de génération et taxonomie fermée des échecs ;
- commandes Tauri typées et façade React/fake préparées derrière la feature de
  build `punks-desktop-social-loop` ;
- réducteur FOLLOW monotone et corpus commun exécuté en TypeScript et Rust ;
- gate `punks:check` redirigé vers l’application riche avec la feature Punks.

Le retrait source de la tranche 1 est désormais préparé dans le candidat : le
prototype desktop minimal, son runner, l’ancien onboarding, les deeplinks Buzz
et les harnais relay exclusifs ont été retirés, et chaque test historique
concerné possède un verdict dans le registre des goldens. Ce retrait source ne
constitue toutefois ni un dossier indivisible, ni un scellement, ni une
activation.

Le Worker API conserve `DESKTOP_SOCIAL_LOOP_ENABLED=false` dans le manifest
local. Le staging isolé porte `true` pendant l’expansion afin que le candidat
signé et installé, lié au SHA et au déploiement exacts, puisse exécuter le
dossier de promotion. Cette expansion staging n’active ni la distribution ni
l’updater : sans attestation et Reçu publiés, la release reste une draft. Le
build Tauri normal ne compile ni le module ni les commandes Punks.

## Gate backend exigé par le futur dossier de preuve

Tout dossier de preuve de tranche doit enregistrer le résultat complet et vert
de `pnpm cloudflare:check` pour le SHA exact du candidat. Un contrôle ciblé, un
résultat absent, un timeout ou un résultat produit depuis un autre SHA ne
satisfait pas ce prérequis backend et interdit le scellement de la tranche.
Un run flaky comportant un test échoué, sauté ou annulé reste invalide même si
une relance ultérieure est verte ; le dossier doit conserver cet échec et ne
peut pas présenter la relance comme preuve du candidat.

## Éléments manquants avant toute activation

- cérémonie desktop Google et GitHub complète : navigateur système,
  PKCE, deeplink par environnement, jar de quarantaine, confirmation de
  livraison et stockage sécurisé OS ;
- preuve installée de la boucle sociale dans l’interface riche, incluant les
  gardes communes navigation/routes/raccourcis/deeplinks et confirmant le
  retrait source déjà préparé ;
- génération Rust, Dart, OpenAPI et AsyncAPI depuis le même registre ;
- exécution du corpus sémantique commun dans `workerd` en plus de Rust et
  TypeScript ;
- scans négatifs du graphe, des sources, de l’artefact et du trafic — le
  registre des goldens, le manifeste de retrait et le graphe de release sont
  désormais versionnés et validés (`pnpm migration:check`), mais les scans
  restent à exécuter ;
- `pnpm cloudflare:check` intégralement vert ;
- staging isolé exact, fautes injectées et parcours Tauri packagé, signé et
  testé sur macOS arm64/x64, Linux x64 et Windows x64 ;
- matrice d’accessibilité et émission de l’attestation immuable liée au SHA et
  aux hashes des artefacts — le modèle d’attestation est scellé par le graphe
  de release (`docs/migration/release-graph.yaml`), l’attestation elle-même
  reste à produire au scellement.

Tant qu’un seul de ces éléments manque, la tranche reste structurellement
indisponible et ne peut pas être promue.
