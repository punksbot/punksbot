# Sceller le graphe de release expansion → activation → contraction

Les décisions closes par les issues #13 (preuves et seuils de retrait), #14
(ordre des tranches), #16 (promotion, observation, récupération) et #47
(§13 « Retrait, promotion et récupération ») sont matérialisées par un graphe
de release unique, versionné dans `docs/migration/release-graph.yaml` et
vérifié par `node scripts/check-release-graph.mjs`. Le présent ADR les
documente sans les rouvrir.

Le graphe relie explicitement, pour chaque candidat : le SHA exact, le registre
des contrats et ses schémas générés, le profil commun, le registre des goldens,
le manifeste de retrait, le matériau et les identifiants du staging isolé, puis
les artefacts distribués signés par plateforme. Un candidat en préparation
porte les hashes vivants recalculés par le gate : toute dérive d'un matériau
sans mise à jour simultanée du graphe est refusée. Une release scellée fige
ses hashes ; ils ne sont plus re-vérifiés contre le dépôt courant.

Le cycle de vie d'une release suit le vocabulaire fermé
`preparation → expansion → active → contraction → contractee`, journalisé en
append-only sans saut ni régression. Aucun candidat ne quitte l'état
`preparation` sans que les preuves obligatoires (corpus de conformité, suites
`workerd`, `pnpm cloudflare:check`, parcours Playwright, parcours Tauri
packagé contre le staging exact, accessibilité, fautes injectées, diff de
retrait, verdict goldens, scans négatifs) ET le retrait associé (lignes du
registre des goldens, verdicts exécutés du manifeste de retrait) ne soient
rattachés au même SHA. L'activation est donc structurellement impossible sans
ce dossier indivisible : une ligne de retrait sans candidat scellé, un
candidat scellé dont les preuves citent un autre SHA, ou un actif retiré
encore présent dans l'arbre suivi font échouer le gate.

La promotion déploie les artefacts desktop et les déploiements Workers
exactement attestés, sans reconstruction. Les versions N et N−1 restent
supportées au moins 90 jours après l'activation de N ; la contraction de N−1
exige ensuite moins de 1 % d'usage mesuré pendant 14 jours consécutifs. Le
roll-forward est la récupération normale : le RPO logique est nul, la
restauration se fait sur la plus petite autorité concernée et une Session de
Compte Punks n'est jamais restaurée. Revenir à une version Punks antérieure
n'est permis qu'avec un certificat de compatibilité exact citant la version du
registre des contrats, le profil et la compatibilité des données de la cible,
vérifié contre la release active de référence. Revenir à Buzz est impossible :
aucun type de récupération ni aucune cible du vocabulaire fermé ne peut
désigner Buzz, la baseline gelée ou une identité Nostr publique.

Chaque candidat scellé porte une attestation immuable contenant le SHA, le
checkpoint de baseline Buzz, les versions et hashes des registres (contrats,
profil, goldens, manifeste de retrait), les identifiants de staging et les
résultats des gates. Les attestations et les Reçus sont publiés avec la
release et dans le stockage R2 prévu, en écriture create-only, avec
verrouillage d'objet et deux comptes R2 pour les contenus critiques ; le gate
refuse toute dérive de ces règles d'immuabilité comme toute régression du
journal.
