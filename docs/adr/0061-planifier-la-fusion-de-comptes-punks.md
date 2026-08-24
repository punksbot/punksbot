# Planifier une Fusion de Comptes Punks avant son point de non-retour

Une Fusion de Comptes Punks commence par un Plan versionné, immuable et sans
effet d’autorité. Le Plan exige exactement deux preuves fraîches, une par
Compte Punks actif, liées à la même intention et à la même liaison de
détenteur. Il fixe explicitement le Compte survivant, les deux révisions
observées et le traitement de chaque catégorie déjà liée au compte : claims,
droits, Sessions, handoffs, accès Repository et liaisons locales. Une preuve
expirée, révoquée, consommée, rejouée, liée à une autre intention ou à une
ancienne révision échoue sans révéler l’autre Compte ni son inventaire.
La représentation publique unique du Plan est le contrat généré
`account-merge.plan@1` du registre JSON Schema. Les snapshots et les contrats
emploient exclusivement `punkId` comme identifiant technique ; aucune seconde
définition manuelle du Plan n’est admise dans le domaine.

Une autorité d’intention unique, adressée par `intentId`, conserve les deux
preuves côté serveur. Le service RPC privé `AccountMergePlanningService`,
protégé par des props exactes et séparé de `PunkSessionService`, dérive toujours
le Durable Object par `ACCOUNT_MERGE_INTENTS.getByName(intentId)`. Il ne fabrique
une preuve qu’à partir d’une Session active dont la réauthentification Google,
GitHub ou passkey, le sujet fournisseur et l’échéance ont été enregistrés par
`SessionDO`. Le jeton de liaison du détenteur n’est jamais persisté : seul son
hash lié à l’intention entre dans les deux preuves. Une réauthentification est
réclamée create-only par un seul couple `(intentId, rôle)` ; elle ne peut donc
pas émettre une seconde preuve pour une autre intention sans nouvelle
réauthentification.

À la préparation, l’autorité relit les deux Comptes dans `PunkDO`, reconstruit
tous leurs claims depuis les identités canoniques et charge leurs inventaires
serveur de droits, de Sessions et de handoffs. L’inventaire des droits est un
index autoritatif par Punk conservé dans `PunkDO` par Auth ; chaque entrée lie
exactement `workspaceId`, rôle et révision. `WorkspaceDO` synchronise cet index
autour de sa mutation locale avec un protocole `prepare` / `commit` / `abort`.
La mutation et son entrée d’outbox sont écrites atomiquement, puis l’outbox
réessaie le `commit` après une réponse distante ambiguë ou une indisponibilité.
Une préparation distante est annulée si la mutation locale n’est pas
finalisée. L’absence ou l’échec de l’index ferme l’opération : le projecteur et
ses candidats éventuels ne constituent jamais une source d’autorité.

Un Punk créé avec cette architecture porte immédiatement son marqueur de
couverture des droits. Un ancien Punk sans ce marqueur reste explicitement
`complete: false` : aucun Plan ne peut être produit avant un backfill explicite
qui établit la couverture. Les Sessions héritées suivent également une
couverture fermée sur une fenêtre de 30 jours ; tant que cette couverture n’est
pas acquise, leur inventaire ne peut pas être déclaré complet. Chaque Session
inventoriée est ensuite relue dans son `SessionDO`. Chaque handoff est pareillement
revalidé contre son Durable Object source — `DesktopDeliveryDO`,
`AuthTransactionDO` ou `PasskeyCeremonyDO` — avec son identifiant, son type, son
état, son Punk et son échéance exacts. Une entrée indexée sans source valide est
retirée ou refusée, jamais transformée en preuve d’autorité.

Une révision de Compte ancienne échoue. Toutes les limites de cardinalité sont
appliquées avant le premier parcours, tri, hash ou calcul cryptographique des
claims, droits, Sessions, handoffs et conflits. L’autorité vérifie ensuite les
liaisons exactes au rôle, au Punk, à l’intention, au détenteur et à la révision.
Elle consomme d’abord les deux autorisations à usage unique dans leurs
`SessionDO`, puis consomme les descripteurs locaux et écrit le Plan dans une
transaction SQLite locale. Une interruption entre ces autorités peut imposer
une nouvelle intention mais ne peut jamais produire un Plan à partir d’une
autorisation révoquée. Un seul commandId concurrent peut gagner et toute
seconde préparation, y compris avec le même commandId, échoue. Après une
réponse RPC ambiguë, seule la lecture explicite `readPlan(intentId)` peut
récupérer le Plan déjà stocké sans recréer ni reconsommer. Toutes les causes de
refus de préparation partagent la même réponse publique non énumérante
`plan_unavailable`; une faute interne inattendue produit seulement un événement
structuré avec le `correlationId`, sans inventaire ni secret.

Une preuve active peut passer explicitement à `revoked` mais jamais revenir à
`active`; la révocation ou l’expiration de sa Session est aussi revalidée au
dernier instant. La première preuve programme une alarme après son échéance :
une intention incomplète ou abandonnée supprime tout son stockage. Un Plan
réussi annule cette alarme et suit la politique de conservation des Reçus de
Fusion plutôt que celle des intentions éphémères.

Le Plan conserve les identités historiques à leur origine. Il peut prévoir un
transfert, une conservation, une révocation, une nouvelle authentification ou
un conflit explicite, mais il ne déplace rien et ne choisit jamais le survivant
implicitement. Les accès Repository exigent une nouvelle preuve personnelle et
les liaisons locales deviennent inertes. Toute nouvelle catégorie
`account-scoped` doit déclarer sa stratégie fermée avant de pouvoir participer
à une Fusion ; une catégorie inconnue rend le Plan impossible plutôt que
d’être transférée par défaut.

L’application ultérieure suit la saga fermée
`planned → preparing → committed → applying → completed`. Avant `committed`,
une intention peut expirer ou être abandonnée sans effet. `committed` est le
point de non-retour : aucune défusion et aucun rollback ne sont permis, seule
une reprise idempotente en roll-forward peut atteindre `completed`. Le Compte
absorbé devient alors un alias inerte, ses Sessions et handoffs sont révoqués,
et un Reçu terminal create-only lie le Plan et le survivant afin qu’un PITR,
une réparation ou un rejeu tardif ne puisse jamais ressusciter l’absorbé.
