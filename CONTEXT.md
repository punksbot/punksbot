# Punks Bot

Punks Bot est une plateforme sociale organisée en Workspaces, destinée à accueillir des interactions entre Punks et Bots.

## Langage

**Punks Bot** :
Plateforme hébergée dans son ensemble ; malgré son nom, Punks Bot ne désigne pas un Bot individuel.
_À éviter_ : instance Punks

**Punk** :
Personne qui utilise Punks Bot sous une identité globale ; ses appartenances et ses rôles sont propres à chaque Workspace.
_À éviter_ : utilisateur, user

**Compte Punks** :
Identité de connexion globale d’un Punk, indépendante de ses appartenances aux Workspaces et des moyens utilisés pour s’authentifier.
_À éviter_ : compte Workspace, profil social

**Fusion de Comptes Punks** :
Transition explicite et irréversible par laquelle un Punk prouve que deux Comptes Punks le représentent, choisit l’unique Compte Punks survivant et rend l’autre inerte comme alias historique, sans créer de troisième identité ni réécrire les références passées.
_À éviter_ : fusion automatique par e-mail, simple transfert de Moyen de connexion, défusion

**Plan de Fusion de Comptes Punks** :
Aperçu immuable des effets d’une Fusion de Comptes Punks sur deux révisions déterminées, confirmé explicitement par le Punk avant le commit ; tout changement de l’un des comptes l’invalide.
_À éviter_ : aperçu calculé par le client, inventaire approximatif, confirmation implicite

**Reçu de Fusion de Comptes Punks** :
Preuve terminale durable qu’un Compte Punks a été absorbé par un survivant selon un Plan de Fusion de Comptes Punks précis ; il empêche toute restauration ou réparation de réactiver le compte absorbé.
_À éviter_ : projection de fusion, journal supprimable, sauvegarde de compte

**Moyen de connexion** :
Identité Google ou GitHub explicitement liée à un Compte Punks après preuve d’un moyen déjà lié lorsque ce compte existe.
_À éviter_ : compte automatique par e-mail, identité Workspace

**Session de Compte Punks** :
Autorisation opaque et révocable, globale à une origine Punks mais distincte pour chaque client connecté ; elle n’appartient ni à un Workspace ni à un Moyen de connexion.
_À éviter_ : session Workspace, session partagée navigateur-desktop, cookie renderer

**Cérémonie de connexion desktop** :
Parcours explicitement initié par lequel un Punk prouve ou confirme un Moyen de connexion afin d’autoriser une Session de Compte Punks propre au client desktop, distincte de toute session web.
_À éviter_ : transfert de cookie, connexion silencieuse, session WebView

**Bot** :
Participant logiciel autonome doté d’une identité et d’une définition globales.
_À éviter_ : agent, assistant

**Bot Punks** :
Bot dont la logique exécutable est publiée et opérée par l’Opérateur Punks ; un Workspace ne téléverse pas de code serveur arbitraire pour créer une installation.
_À éviter_ : bot tiers exécuté, script de Workspace

**Workspace** :
Espace social isolé qui réunit ses Punks membres et possède ses installations de Bot, ses conversations et ses médias.
_À éviter_ : communauté, espace de travail, tenant, ruche, instance

**Conditions d’accueil de Workspace** :
Version déterminée des règles qu’un Punk doit voir et accepter explicitement avant de rejoindre un Workspace, fixée durant sa préparation et exigée pour son Activation.
_À éviter_ : document facultatif, règles implicites, politique non versionnée

**Plan d’Activation de Workspace** :
Aperçu immuable et expirant, lié à une révision d’un Workspace en préparation, qui énumère les préconditions et les effets exacts de son Activation avant la confirmation forte du Propriétaire.
_À éviter_ : prévisualisation purement locale, confirmation non liée à la révision, activation en attente

**Activation de Workspace** :
Transition explicite, contrôlée et irréversible par laquelle un Workspace en préparation devient utilisable dans Punks Bot ; elle ne constitue ni un choix de backend ni une possibilité de repli.
_À éviter_ : bascule de backend, migration de Workspace, mode Punks

**Suppression de Workspace** :
Transition terminale, confirmée par le Propriétaire, qui ferme immédiatement un Workspace puis orchestre son effacement irréversible sans jamais le réactiver.
_À éviter_ : archivage, désactivation réversible, rollback vers Punks

**Reçu de suppression de Workspace** :
Preuve terminale minimale qu’un Workspace a été supprimé, conservée pour empêcher sa résurrection sans conserver son contenu, ses membres, son nom ou ses règles.
_À éviter_ : archive lisible du Workspace, sauvegarde restaurable, audit social

**Disponibilité de capacité** :
État uniforme pour un environnement Punks et une version compatible du client, distinct des autorisations d’un Punk et des pannes rencontrées à l’exécution.
_À éviter_ : feature flag de Workspace, disponibilité déduite d’une erreur

**Compatibilité du client desktop** :
Aptitude d’une version de `desktop/` à ouvrir un Workspace activé en respectant le socle minimal des contrats Punks ; son absence ne remet pas en cause l’Activation de Workspace.
_À éviter_ : désactivation de Workspace, capacité indisponible

**Atelier local autonome** :
Surface du client desktop utilisable sans Workspace pour un terminal sans contexte, l’inspection d’un checkout choisi manuellement et l’installation ou l’authentification d’outils ACP ; ses opérations n’ont aucune identité, autorité, coordination ni valeur d’audit Punks.
_À éviter_ : Workspace local, mode hors ligne Punks, Bot local

**Liaison locale de ressource** :
Association explicitement créée entre une ressource de l’Atelier local autonome et une ressource Punks après une autorisation fraîche ; isolée par origine, Punk, Workspace et ressource, elle devient inerte hors de ce contexte sans transférer de propriété, d’autorité ou d’historique.
_À éviter_ : association automatique, ressource Punks locale

**Installation de Bot** :
Présence configurée d’un Bot dans un Workspace, avec des permissions, une mémoire, un statut et des paramètres propres à ce Workspace.
_À éviter_ : instance de Bot, Bot de Workspace

**Exécution locale d’une Installation de Bot** :
Processus ACP exécuté sur l’appareil du Punk pour une Installation de Bot précise après autorisation Punks ; son autorité provient uniquement des Capacités de Bot de cette Installation, jamais du rôle du Punk ni de l’Atelier local autonome.
_À éviter_ : Bot local, agent du Punk, Bot du desktop

**Autorisation locale d’outil** :
Accord explicite et révocable donné sur un appareil par un Punk à une Installation de Bot pour utiliser des répertoires, checkouts, commandes ou outils locaux déterminés ; elle ne constitue ni une Capacité de Bot, ni une autorité ou une preuve d’audit Punks.
_À éviter_ : permission de Workspace, héritage des outils du Punk, capacité locale de Bot

**Abonnement de Réveil** :
Lien explicite et révocable par lequel une Installation de Bot accepte les nouveaux Messages d’une Conversation à partir d’un point d’activation déterminé.
_À éviter_ : écoute globale, souscription implicite, fan-out de Bots

**Réveil de Bot** :
Invitation opaque et idempotente à examiner un Message committé pour une Installation de Bot précise ; elle ne constitue ni une autorisation d’agir, ni le contenu du Message.
_À éviter_ : action de Bot, Message en Queue, permission de Bot

**Tour de Bot** :
Exécution bornée et durable d’un Réveil de Bot, conclue par un reçu terminal et susceptible de proposer au plus une action admise séparément.
_À éviter_ : session de chat, tâche autonome générale, Workflow métier

**Attestation Punks** :
Preuve signée par Punks Bot qu’une action authentifiée et autorisée a été attribuée à un Punk ou à une installation de Bot.
_À éviter_ : signature du Punk, clé Nostr du Punk

**Journal interne Punks** :
Suite append-only d’événements et de sceaux attestés par la plateforme, encodés dans des enveloppes Nostr pour l’intégrité et la reconstruction internes ; il ne constitue ni un relay public, ni une identité Nostr de Punk, ni une promesse de compatibilité NIP générale.
_À éviter_ : réseau Nostr Punks, relay Punks, événement client brut

**Capacité de Bot** :
Permission explicite, limitée et révocable accordée à une installation de Bot pour agir dans son Workspace.
_À éviter_ : rôle de Bot, permission héritée du Punk

**Action sensible de Bot** :
Action d’une installation de Bot dont l’effet est difficile à annuler, externe au Workspace, coûteux ou privilégié, et qui relève d’une politique d’approbation renforcée.
_À éviter_ : action admin, action libre

**Admission d’action de Bot** :
Reçu durable qui lie une action déterminée à une Installation de Bot, à sa Capacité de Bot et à une ressource précise avant l’exécution de l’effet demandé.
_À éviter_ : permission permanente, jeton de rôle, action libre

**Repository** :
Dépôt Git dont les objets et les références autoritaires résident sur GitHub ; Punks Bot en conserve les connexions, attestations, projections et caches utiles sans devenir une seconde autorité Git.
_À éviter_ : dépôt R2, repository Punks natif

**Connexion de Repository** :
Association entre un Repository et un Workspace, avec sa visibilité, ses capacités de Bot et ses projections propres ; un Repository peut avoir plusieurs connexions et un Workspace peut en posséder plusieurs, mais la connexion n’accorde jamais à un Punk un accès GitHub qu’il ne possède pas déjà.
_À éviter_ : copie de Repository, Repository enfant

**Preuve d’accès de Repository** :
Grant personnel entre un Punk et la GitHub App dédiée, conservé chiffré côté Punks et vérifié effectivement à chaque opération médiatisée ; distinct de la Connexion de Repository, il n’accorde aucun droit Workspace et devient inerte à une Fusion de Comptes sans nouvelle preuve.
_À éviter_ : jeton partagé de Workspace, autorisation dérivée de la Connexion

**Marqueur d’effacement** :
Événement attesté qui conserve la preuve minimale d’une suppression après destruction de la clé donnant accès au contenu chiffré concerné.
_À éviter_ : soft delete, réécriture du journal

**Présence** :
Signal décoratif et éphémère indiquant l’activité courante d’un Punk dans un
Workspace ; elle peut être perdue, retardée ou omise et ne prouve jamais une
identité, un accès, un rôle ou une action.
_À éviter_ : statut d’autorité, historique de connexion, preuve d’activité

**Bail de Présence** :
Coordonnée courte et renouvelable d’une Présence courante, liée au Punk, au
Workspace, à l’appareil et à la génération ; son expiration signifie
`offline` et détruit Statut et Signaux de frappe associés.
_À éviter_ : Session de Compte Punks, abonnement durable, événement historique

**Statut de Présence** :
Courte chaîne facultative portée uniquement par le Bail de Présence vivant,
sans historique, recherche, indexation ni valeur d’autorité.
_À éviter_ : profil du Punk, message de statut persistant

**Signal de frappe** :
Indication éphémère et auto-expirante qu’un Punk saisit dans une Conversation
qu’il peut actuellement lire ; sa perte ou son omission est normale.
_À éviter_ : accusé de lecture, événement de Message, preuve de participation

**Huddle** :
Session audio temps réel tenue dans un Workspace entre des Punks et, lorsque leurs capacités le permettent, des Bots.
_À éviter_ : salon vocal, appel audio

**Conversation** :
Flux social autoritaire d’un Workspace, de type stream, forum, DM ou workflow, qui possède son ordre local, ses membres éventuels et ses Messages.
_À éviter_ : channel, salon, room

**Stream** :
Spécialisation synchrone d’une Conversation, seule Conversation créable dans la tranche de gestion initiale ; Forum, DM, Canvas, Huddle et Workflow restent des spécialisations ultérieures soumises à leurs propres contrats.
_À éviter_ : type générique anticipé, channel Punks

**Responsable de Conversation** :
Punk qui crée un Stream et en administre le cycle de vie conversationnel ; le Propriétaire et les Modérateurs du Workspace conservent une autorité de secours.
_À éviter_ : propriétaire implicite du Workspace, administrateur relay

**Visibilité de Conversation** :
Politique `open` ou `private` d’une Conversation : `open` hérite de la lecture de son Workspace, tandis que `private` exige simultanément l’appartenance actuelle au Workspace et un accès explicite à la Conversation.
_À éviter_ : visibilité indépendante du Workspace, adhésion implicite

**Sujet de Stream** :
Courte orientation éditable d’un Stream, distincte du Sujet de Message et de son purpose.
_À éviter_ : sujet global des Messages, topic surchargé

**Purpose de Stream** :
Description détaillée et éditable de l’intention durable d’un Stream, distincte de son nom et de son Sujet de Stream.
_À éviter_ : sujet court, commentaire de Message

**Sujet de Message** :
Courte qualification propre à un Message racine, requise lorsque le Stream active `topicRequired` et soumise au lifecycle du Message.
_À éviter_ : Sujet de Stream, métadonnée héritée de Conversation

**Adhésion à Conversation** :
Lien explicite d’un Punk avec une Conversation pour son roster, son suivi et ses préférences ; dans une Conversation `open`, elle n’est jamais une permission supplémentaire d’écrire.
_À éviter_ : seconde permission de publication, adhésion implicite

**Accès de Conversation** :
Niveau local `manager`, `member` ou `guest` qu’un Responsable attribue dans une Conversation ; il borne le roster et ne contourne jamais les permissions du Workspace.
_À éviter_ : rôle de Workspace, privilège trans-Conversation

**TTL de Conversation** :
Durée de vie glissante d’un Stream actif, renouvelée seulement par la publication réussie d’un Message et qui déclenche son archivage sans le supprimer à échéance.
_À éviter_ : expiration depuis la création, prolongation par lecture ou métadonnée

**Révision de Conversation** :
Version monotone de l’état mutable d’une Conversation, attendue par chaque commande de mutation afin de refuser les écritures concurrentes périmées sans effet partiel.
_À éviter_ : last writer wins, révision de Message

**Résumé de Conversation** :
Vue bornée d’une Conversation autorisée pour un navigateur ou une sidebar, sans roster complet ni donnée révélant l’existence d’une Conversation privée inaccessible.
_À éviter_ : snapshot de channels, roster embarqué, modèle relay

**Delta de Conversation** :
Changement typé et ordonné par curseur, limité aux données autorisées nécessaires pour mettre à jour ou invalider une Vue de Conversation ; un trou de curseur impose une relecture autoritaire.
_À éviter_ : événement Nostr client, journal d’attestation, snapshot complet

**Spécialisation de Conversation** :
Contrat versionné ultérieur qui ajoute ses propres vues, commandes et transitions à une Conversation sans modifier rétroactivement les invariants d’un Stream.
_À éviter_ : type mutable, champs anticipés, extension générique

**Message** :
Contenu publié par un Punk ou une Installation de Bot autorisée dans une Conversation ; ses éditions, rétractions, restaurations et son éventuel Marqueur d’effacement s’ajoutent au journal sans réécrire l’historique.
_À éviter_ : événement brut, post Nostr

**Intention d’upload média** :
Engagement immuable et expirant d’un Punk dans un Workspace à téléverser exactement un contenu lié à un purpose, une taille, un type déclaré et une empreinte déterminés ; elle n’est ni un Média accepté ni une référence de Message.
_À éviter_ : upload multipart, pièce jointe, média accepté

**Grant d’upload média** :
Autorisation courte et minimale issue d’une Intention d’upload média, utilisable seulement pour les opérations de cette intention sans exposer de credential R2 durable.
_À éviter_ : Session de Compte Punks, clé R2, URL présignée durable

**Objet candidat média** :
Contenu dont la taille, le type déclaré et l’empreinte ont été vérifiés selon son Intention d’upload média, mais qui reste en quarantaine et n’est encore ni livrable ni attachable.
_À éviter_ : Média accepté, pièce jointe, variante livrable

**Réaction** :
Présence autoritaire et idempotente, possédée par la Conversation, d’un Punk ou d’une Installation de Bot sur la coordonnée unique formée par un Message et une valeur canonique. Un Punk peut l’ajouter, la retirer ou la basculer ; une Installation de Bot exige une capacité explicite et reste refusée par défaut. La rétraction du Message la masque temporairement, sa restauration peut la rendre de nouveau visible et son effacement définitif la masque irréversiblement, sans exposer de roster non borné.
_À éviter_ : événement Nostr public, compteur sans présence autoritaire

**Fil de discussion** :
Ascendance parent/racine de Messages au sein d’une même Conversation, avec ses compteurs autoritaires ; un Fil de discussion n’est pas un agrégat ni un espace distinct.
_À éviter_ : Conversation enfant, thread global

**Opérateur Punks** :
Punk doté d’une autorité sur toute la plateforme pour provisionner un Workspace et désigner ses premiers propriétaires.
_À éviter_ : super-admin, administrateur système

**Propriétaire de Workspace** :
Punk responsable des invitations, des rôles, des installations de Bot et des paramètres au sein d’un Workspace déterminé.
_À éviter_ : administrateur global, opérateur

**Rôle de Workspace** :
Ensemble intégré de permissions explicites attribué à un Punk dans un Workspace : Propriétaire, Modérateur, Membre ou Invité.
_À éviter_ : rôle global, permission implicite

**Modérateur de Workspace** :
Punk autorisé à appliquer les règles sociales et à modérer le contenu d’un Workspace sans recevoir l’autorité complète d’un Propriétaire.
_À éviter_ : administrateur, opérateur

**Membre de Workspace** :
Punk autorisé à participer normalement à un Workspace selon ses permissions intégrées.
_À éviter_ : utilisateur du Workspace

**Invité de Workspace** :
Punk dont la participation à un Workspace est volontairement restreinte par le rôle intégré Invité.
_À éviter_ : anonyme, visiteur public

**Suppression ordinaire** :
Masquage immédiat et réversible d’un contenu pendant une grâce de sept jours avant son crypto-effacement.
_À éviter_ : effacement immédiat, soft delete permanent

**Effacement définitif** :
Destruction irréversible, après confirmation forte, de la clé permettant de déchiffrer un contenu, suivie de son Marqueur d’effacement.
_À éviter_ : suppression ordinaire, purge du journal

**Punks UI** :
Expérience utilisateur propre à Punks Bot, distincte des interfaces héritées de Punks et spécifiée après la migration Cloudflare Native.
_À éviter_ : Punks UI

**Visibilité de Workspace** :
Politique configurable à trois niveaux — privé, Punks ou public — déterminant qui peut lire un Workspace sans accorder implicitement le droit d’y écrire.
_À éviter_ : permission de membre, rôle public
