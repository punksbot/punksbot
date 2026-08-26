# Exécuter un tour de Bot depuis un Réveil opaque

La première verticale autonome d’un Bot part d’un Message committé et peut
proposer une Réaction. Elle ne généralise ni les outils, ni la mémoire, ni les
modèles. `BotInstallationDO` reste l’autorité unique de l’Installation, de sa
release, de sa configuration, de ses grants, de ses Réveils et de ses Tours.
Un Workflow Cloudflare exécute un Tour durable, mais ne devient jamais une
seconde autorité métier.

`ConversationDO` conserve un registre fort d’Abonnements de Réveil. Une
activation est grant-last : la Conversation prépare l’abonnement et capture son
high-water visible, l’Installation commet ensuite les grants exacts, puis une
outbox active l’abonnement. Une révocation est revoke-first : l’Installation
retire d’abord le grant, puis une outbox désactive le registre Conversation.
Les livraisons tardives portent l’époque de l’abonnement et ne peuvent pas
réactiver une ancienne génération.

Le déclencheur est un entrypoint privé distinct qui reçoit exactement une
Installation, une Conversation et un Message déjà connus. Il ne consulte aucun
index d’Installations et ne fait aucun fan-out. `ConversationDO` vérifie le
Message committé, actif et non modifié, reconstruit sa source signée, dérive un
candidat déterministe sans plaintext et le commet avec une outbox réparable.

Le grant `messages.read-context` est distinct de `messages.react`. Il ne fait
pas partie du registre des actions admissibles et ne peut jamais être déduit du
seul droit de Réagir. Pour accepter un Réveil, l’Installation exige les deux
grants actifs sur la Conversation exacte. La lecture passe par un service privé
borné, relit l’autorité Installation puis l’état Conversation et Message avant
et après le déchiffrement, et utilise le coffre avec le purpose `bot-context`.
L’Installation possède aussi le ledger Réveil/Tour, les bornes de Réveils
ouverts et chauds, le budget quotidien de claims, l’outbox Queue et les reçus
terminaux. Un reçu terminal est archivé create-only sous une clé R2 opaque et
relu cold-first ; un objet exact domine un état vivant restauré par PITR, tandis
qu’un objet absent, indisponible ou non canonique échoue fermé.

Une offre placée dans Queue contient seulement `{installationId, wakeId}`. Elle
n’expose ni Workspace, ni Conversation, ni Message, ni texte, ni jeton de
recherche. `wakeId` et le Workflow ID sont déterministes ; après réception,
l’Installation restitue au Workflow les coordonnées autoritaires seulement si
le Réveil, l’abonnement, l’époque et les deux grants sont encore valides. Les
projections D1 ne contiennent aucun ledger de Réveil ou de Tour et ne
participent jamais à cette décision.

L’outbox Queue de l’Installation est une lease opaque de soixante secondes,
conservée jusqu’au reçu terminal plutôt qu’un envoi one-shot. Un Réveil offert
et révoqué est terminalisé avant Queue ; un Réveil déjà `claimed` est relivré
pour que son Workflow enregistre le terminal révoqué. Le consumer inspecte alors
l’instance Workflow déterministe et ne la redémarre que si son statut est
`errored`. Une inspection ou un restart incertain remet la livraison en retry.
Cette boucle répare l’épuisement des reprises internes de claim ou de completion
sans ajouter d’autorité au Workflow.

La première release runtime est immuable et publiée par Punks avec son Bot :
identifiant de release, digest canonique, modèle, prompt système, politique
d’outils, allowlist de Réactions et budgets. Aucun caller, Workspace, contenu de
Message ou configuration libre ne choisit un provider, un modèle, une URL ou
un outil. Les Bots existants sans release compatible restent désactivés pour le
Harness jusqu’à une migration explicite.

Le runtime privé utilise le modèle Punks fixé pour cette release, une sortie
JSON Schema stricte `skip | react`, une allowlist bornée de Réactions, une
température nulle, un résultat très court et une deadline. Un adaptateur
`ModelPort` possède exactement deux implémentations : Workers AI en staging ou
production, et un fake déterministe sous Workerd. Les tests et dry-runs
n’appellent jamais un modèle distant payant.

Le Workflow sépare la décision du modèle de l’effet. La proposition validée est
liée à un `actionId` stable, puis passe exclusivement par la couture existante
credential court → Admission `50320` → Réaction `50210|50211` → completion
`50321`. Une reprise peut répéter un appel réseau ou une livraison ; l’effet
reste exactement idempotent grâce aux identifiants et receipts autoritaires.
Cette architecture ne prétend pas qu’une inférence Workers AI est strictement
at-most-once après tous les crashes de plateforme : un crash à la frontière de
l’appel peut entraîner une seconde facturation. Elle garantit que deux
inférences ou deux livraisons ne produisent pas deux effets métier.

La lecture privée et l’appel au modèle appartiennent à une seule étape sensible
avec zéro retry. Les RPC de claim, d’effet et de completion ont des reprises
bornées, mais aucune reprise du Workflow ne peut relancer implicitement la
lecture/inférence sensible. Une erreur de cette étape devient un résultat
terminal fermé.

Le plaintext existe seulement dans la mémoire de l’étape sensible qui lit le
Message et appelle le modèle. Il est absent des payloads Queue et Workflow, des
journaux Nostr, de D1, de R2, des receipts, des erreurs, des métriques et des
logs. Le Workflow ne persiste que des identifiants opaques, digests, états
bornés, compteurs de budget et résultat d’action. Une panne de lecture,
d’autorité, de modèle, de validation ou d’admission échoue fermée sans Réaction.

La première tranche accepte un Réveil privé avec `installationId` connu. Elle
ne découvre pas automatiquement toutes les Installations intéressées par une
Conversation, n’ajoute ni historique de discussion, ni auteur, ni pièces
jointes, ni mémoire, ni schedule, ni outil GitHub. Cette limitation est
volontaire : un index de découverte ou une nouvelle capacité fera l’objet d’une
couture autoritaire et d’un ADR séparés.

Cette verticale est implémentée et testée en source sous `workerd`. Au moment de
cette décision, les bindings API producteur, Runtime consommateur, Service
Bindings et Workflow étaient configurés pour local et staging. La Queue Bot
Wake et sa dead-letter Queue étaient déjà provisionnées sans consommateur ; le
Workflow n’était pas provisionné et aucun Bot Runtime Worker n’était déployé.
Les tests utilisaient le fake déterministe et aucune inférence Workers AI
distante n’était revendiquée. La preuve était composée de suites `workerd`
ciblées sur chaque couture, sans E2E multi-Worker dans un pool unique.

Mise à jour opérationnelle du 2026-08-26 — sans modifier la décision :
[OPERATIONS.md](../../cloudflare/OPERATIONS.md) enregistre l’observation
distante historique de la Queue, de sa dead-letter Queue, du Runtime
consommateur et du Workflow. Cette observation ne prouve ni le candidat
courant, ni les Service Bindings à l’exécution, ni une inférence distante ; ces
preuves et l’approbation séparée restent exigées.
