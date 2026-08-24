# Journaliser des deltas pour les collections non bornées

Un événement attesté ne transporte jamais le snapshot complet d’une collection dont la taille peut croître avec le Workspace. Les membres d’un Workspace, les membres d’une Conversation, les versions et relations d’un Message, les installations et les connexions de Repository sont conservés dans des tables SQLite normalisées du Durable Object autoritaire. Chaque événement ne contient que l’identité de l’agrégat, la transition appliquée, son curseur et les valeurs minimales nécessaires à la reconstruction.

Le Durable Object applique le delta, incrémente le curseur, écrit le journal local et prépare l’outbox dans une seule transaction. L’attestation signe ensuite cette enveloppe bornée. Les projecteurs reconstruisent leurs propres tables à partir des deltas et refusent toute régression de curseur ; un outil de reconstruction peut rejouer le journal scellé sans dépendre d’un snapshot embarqué dans chaque événement.

Les lectures d’une collection utilisent une pagination stable liée au curseur autoritaire. Un endpoint de détail peut exposer un résumé borné, mais il ne renvoie pas implicitement un roster complet. Les limites des contrats doivent être compatibles avec la limite de requête du Worker d’attestation et testées au-delà de 1 000 et 10 000 entrées.

Les snapshots périodiques de reconstruction sont des artefacts internes distincts, chiffrés et segmentés ; ils ne changent ni la forme bornée des événements ni la sémantique des commandes publiques.

Les Réactions appliquent cette décision au niveau de la Conversation. `ConversationDO` conserve une présence stable par coordonnée Message, acteur et valeur canonique, ainsi qu’un ledger de commandes idempotent. Add, remove et toggle produisent seulement, lorsqu’ils changent l’état, un delta borné attesté de kind 50210 ou 50211. Le projecteur vérifie que le scope, le curseur, l’identité de Réaction, l’acteur, le contrat, le kind et le delta correspondent exactement à l’événement signé, puis reconstruit une présence et un compteur absolu borné dans D1 sans roster d’acteurs.

Le cycle de vie d’un Message pilote un overlay distinct : retract masque temporairement la collection, restore rétablit les présences encore actives et l’effacement final la masque irréversiblement. Cet overlay est dérivé de la projection Message, sans grossir l’événement Message ni créer un événement Réaction de cycle de vie.

FOLLOW transporte des patches absolus plutôt qu’un historique de présences : au plus 100 compteurs `{messageId, reaction, count, reactedByPunk, cursor}` et 100 overlays `{messageId, visibility, cursor, refreshRequired}` par frame de changements. `reactedByPunk` est le seul état personnel ; aucune identité d’autre acteur, liste, enveloppe signée, donnée cryptographique ou donnée en clair n’est exposée.
