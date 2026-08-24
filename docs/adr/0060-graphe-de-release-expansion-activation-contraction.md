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

Le nœud `tranche:N` est le conteneur logique du candidat et suit le vocabulaire
fermé `preparation → expansion → active → contraction → contractee`. La
formulation « trois releases distinctes » de la décision #16 est conservée
explicitement : chaque entrée du journal d'expansion, d'activation et de
contraction porte un instant UTC exact, un `release-id`, un déploiement et une
attestation globalement uniques. Chaque entrée embarque aussi un instantané
`punks.release-graph-snapshot.v1` content-addressé : ce n'est pas un résumé,
mais le nœud candidat exécutable complet avec matériaux, staging, artefacts,
digests production, preuves, retrait, attestation de promotion et Reçus signés
de promotion/retrait. L'expansion, l'activation et la contraction peuvent donc
porter des SHA et artefacts différents ; le sommet `tranche:N` doit reproduire
exactement le dernier candidat scellé, tandis que les phases précédentes restent
immuables dans leurs instantanés. L'attestation de transition lie le SHA, le
hash des artefacts et le hash du graphe ; son hash est lui-même lié par un Reçu
content-addressé.
`contractee` est uniquement l'état terminal de la release de contraction : il
ne crée ni quatrième release, ni quatrième Reçu. Le champ `etat` résume la
dernière transition et le journal reste append-only, sans saut, régression ou
ambiguïté le même jour. Les nœuds de tranche forment eux-mêmes l'historique
contigu `tranche:1…N` dans cet ordre : supprimer une ancienne tranche,
réordonner le passé ou ouvrir une nouvelle tranche avant d'avoir scellé toutes
les précédentes fait échouer le gate.

Aucun candidat ne quitte l'état
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
exactement attestés, sans reconstruction. Deux releases `active` sont admises
uniquement pour les tranches consécutives N et N−1 : la plus haute tranche est
la référence courante, tandis que N−1 demeure supportée. N−1 le reste au moins
90 jours exacts après l'activation de N ; sa contraction exige ensuite moins
de 1 % d'usage mesuré pendant 14 jours consécutifs. Trois releases actives ou
deux tranches actives non consécutives sont refusées. La compatibilité des
profils desktop reste indépendante de l'éligibilité backend : la chronologie
`profils-supportes` possède ses propres instants d'acceptation et de fin. Une
contraction backend ne ferme donc jamais implicitement un profil client ; tout
profil d'une release backend active doit néanmoins rester explicitement
accepté, et toute release qui a déjà atteint `active` conserve un intervalle
historique couvrant son instant d'activation. Les instants d'activation des
tranches sont strictement croissants.

Le roll-forward est la récupération normale : il part de la release de
référence active à l'instant enregistré et corrige cette même tranche logique,
sans consommer la tranche fonctionnelle suivante. Il relie deux snapshots de
graphe complets dont le hash est recalculé depuis le contenu canonique : le
premier est l'instantané `active` exact déjà inscrit au journal ; le second est
un nouveau candidat exécutable `active` avec tout son dossier, un nouveau
`release-id` et `redemarrage: E0`. L'exécution referme alors sans raccourci la
cadence Workers `E0…E4`, puis la cadence desktop `A0…A4`, avant que le Reçu de
roll-forward terminal ne puisse être ajouté. Le nouveau SHA ne peut être ni la
baseline Buzz, ni le checkpoint de récupération, ni aucun SHA Punks déjà
présent dans les nœuds, leurs journaux ou leurs exécutions. Un Reçu signé lie
la cible, l'instant, le nouveau `release-id`, le hash du nouveau graphe et la
tête signée de l'exécution. Le RPO logique est nul, la restauration se fait sur
la plus petite autorité concernée et une Session de Compte Punks n'est jamais
restaurée.

Le registre racine `executions` rend ces cadences réellement exécutables et
append-only. Chaque exécution (`expansion`, `active`, `contraction` ou
`roll-forward`) possède un identifiant, un snapshot neuf, son prédécesseur
opérationnel exact et un Reçu de démarrage à `sequence: 0`. Ses événements
signés forment ensuite une chaîne sans fork par
`precedent-evenement-sha256` : `etape-fermee` embarque le Reçu d'étape,
`phase-fermee` lie le Reçu terminal déjà inscrit au journal, et les événements
`pause`, `reprise`, `echec` ou `quarantaine` scellent l'état observé. Une phase
ne réussit qu'après la cadence complète ; son Reçu terminal doit citer
`execution-id` et le hash de la dernière tête signée. Une exécution interrompue
reste donc visible et ne peut être réécrite comme un succès a posteriori.
Aucune transition ni aucun roll-forward ne peut être ajouté au journal sans
l'exécution réussie correspondante, intégralement chaînée jusqu'à ce Reçu
terminal.

Les durées fermées sont `E0=1 h`, `E1=2 h`, `E2=6 h`, `E3=24 h`, `E4=48 h`,
puis `A0=48 h`, `A1=168 h`, `A2=24 h`, `A3=48 h`, `A4=168 h`. Une migration
stateful non splittable remplace `E0…E3` par `P0=24 h` avant `E4`; la
contraction réobserve `E4=48 h`. Chaque Reçu d'étape lie exactement les
versions et pourcentages Workers, les versions Workflows, la génération de
compatibilité, les hashes desktop distribués, les bookmarks, DLQ, outboxes,
incidents et les dix surfaces de topologie Cloudflare. Toute modification de
topologie change le hash du snapshot et remet les durées à zéro : aucune durée
acquise sur une autre configuration ne peut être réutilisée.

Les verdicts couvrent exactement les 36 budgets de production décidés, avec
leurs unités et maxima fermés. Pour un taux, le gate recalcule la borne
supérieure unilatérale de Wilson à 95 % depuis les comptes bruts ; pour une
latence ou un compteur, il recalcule la comparaison exacte à la limite. Les
dimensions imposées par moyen de connexion et plateforme sont exhaustives et
la tranche N (comme tout roll-forward) cite les mêmes mesures N−1 en baseline,
ce qui rend les régressions calculables plutôt que déclaratives. Un verdict
`vert`, `rouge` ou `insuffisant` doit correspondre au calcul ; seul un ensemble
entièrement vert peut fermer une étape.

Les décisions d'arrêt utilisent des fenêtres content-addressées, consécutives
et longues de quinze minutes. Une pause lie exactement un incident ouvert et
les fenêtres rouges prescrites par sa catégorie. Une régression fonctionnelle
hors budget impose le roll-forward après deux fenêtres rouges consécutives, ou
après quatre heures si le périmètre n'a toujours pas pu être qualifié. Une
dégradation non destructive ne se pause qu'après deux fenêtres rouges et peut
reprendre après deux fenêtres vertes. Toute reprise commence exactement après
la pause signée, lie un incident résolu et ne conserve aucun incident critique
ouvert.

Une violation critique confirmée ne dépend d'aucune fenêtre statistique : sa
détection intervient sous cinq minutes, puis la pause est immédiate et la
quarantaine suit dans la même chaîne causale, au plus tard sous quinze minutes.
Si des données restent exposées, le fencing content-addressé du périmètre exact
est lui aussi appliqué sous quinze minutes. La qualification du périmètre doit
intervenir sous trente minutes ; tout dépassement scelle son instant
d'escalade, maintient le périmètre fermé et ne transforme jamais l'incident en
reprise ou en simple échec fonctionnel. Si cette qualification n'est pas encore
disponible lors de la première quarantaine, un nouvel événement `quarantaine`
prolonge le même incident dans la chaîne append-only et scelle la qualification
ou l'escalade ; seule la première quarantaine et son fencing sont soumises à la
borne de quinze minutes. L'objectif de quatre heures concerne l'engagement de
la récupération ciblée ou du roll-forward, pas la qualification.

Toute récupération consécutive à un incident porte un objet fermé
`punks.recovery-commitment.v1`. Il lie le hash canonique de l'incident, son
instant de détection, le périmètre fermé, l'instant d'engagement au plus tard
quatre heures après la détection et l'échéance exacte correspondante. Si la
récupération effective dépasse cette échéance, un hash de preuve d'escalade est
obligatoire ; il est interdit sinon. Le Reçu terminal signe le hash canonique de
cet engagement, de sorte qu'un roll-forward tardif ne puisse jamais satisfaire
silencieusement l'objectif de quatre heures.

Revenir à une version Punks antérieure n'est permis qu'avec un certificat de
compatibilité recalculé à l'instant UTC exact du redéploiement. La release de
référence est évaluée à cet instant dans l'historique du journal, et non d'après
son état courant ; la cible doit elle-même avoir atteint `active` avant cet
instant, jamais être un candidat en expansion ou une release future. Le
certificat cite la cible, la version du registre des
contrats, le profil, les digests originaux du bundle et du manifeste production,
tous les profils desktop acceptés par leur chronologie indépendante et les
treize contrôles fermés de la décision #16. Chaque contrôle embarque sa preuve
verte et le gate recalcule son hash canonique ainsi que son invariant propre.
Un nouveau Reçu content-addressé lie les identifiants Cloudflare actuels, les
digests historiques et le noyau canonique du certificat avec les douze
premières preuves ; deux signatures correspondent exactement aux deux
approbateurs. Le treizième contrôle lie ensuite le sha256 de ce Reçu, ce qui
scelle toute la chaîne sans dépendance circulaire. Le Reçu est publié avec la
release et dans R2. Revenir à Buzz est impossible : aucun type de récupération
ni aucune cible du vocabulaire fermé ne peut désigner Buzz, la baseline gelée
ou une identité Nostr publique.

Chaque candidat scellé porte une attestation immuable contenant le SHA, le
checkpoint de baseline Buzz, les versions et hashes des registres (contrats,
profil, goldens, manifeste de retrait), les identifiants de staging et les
résultats des gates. Elle scelle aussi les digests originaux du bundle et du
manifeste production, fournis par deux preuves locales content-addressées du
dossier de promotion. Son champ `attestation-sha256` est recalculé depuis le
contenu canonique. Tous les Reçus portent également leur contenu canonique,
son sha256 et deux signatures Ed25519 vérifiées cryptographiquement contre le
registre `approbateurs-release` de clés publiques SPKI. Une attestation de
promotion n'est scellée que si exactement un Reçu de type `promotion` lie son
`attestation-sha256`. Chaque Reçu de transition et de roll-forward recense en
outre le digest du graphe, les versions et pourcentages Workers, les versions
Workflows, la génération de compatibilité, les hashes desktop, les heures de
début/fin, les approbateurs, les verdicts métriques, les bookmarks, les états
DLQ/outboxes et les incidents. Les
attestations et les Reçus sont publiés avec la release et dans le stockage R2
prévu, en écriture create-only, avec verrouillage d'objet et deux comptes R2
pour les contenus critiques ; le gate refuse toute dérive de ces règles
d'immuabilité comme toute régression du journal.

Une attestation déjà publiée n'est jamais supprimée ni réécrite. Le registre
append-only `invalidations-attestations` peut seulement lui associer un Reçu
signé ultérieur. Une supersession documentaire cite et publie une nouvelle
attestation content-addressée ; une révocation matérielle bloque toute phase
ordinaire ultérieure qui tenterait encore de consommer l'attestation révoquée.
Une révocation critique lie en plus l'exécution, les Reçus de pause et de
quarantaine ainsi que la preuve de fencing du périmètre. L'éligibilité est
toujours évaluée à l'instant de la décision : une invalidation future ne
réécrit donc jamais rétroactivement un certificat ou un retour antérieur.
