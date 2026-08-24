# Bloquer la résurrection PITR par un registre d’effacement séparé

La suppression des clés dans le SQLite d’un `MessageContentDO` garantit l’effacement dans son état courant, mais Cloudflare permet de restaurer ce SQLite à un point des trente derniers jours. Une clé ancienne pourrait donc réapparaître après un PITR. Punks Bot ne qualifie pas cette seule nullification de garantie d’Effacement définitif.

Avant de détruire les clés d’une génération, un Worker privé d’effacement écrit un tombstone create-only dans un bucket R2 dédié. L’API Worker et les `MessageContentDO` n’ont pas de binding direct vers ce bucket ; ils ne peuvent passer que par les RPC bornées `record` et `lookup` du Worker. Celui-ci n’expose aucune route, aucune RPC de suppression et aucun code permettant d’écraser un tombstone existant.

Le tombstone lie au minimum le Workspace, la Conversation, le Message, la génération, la commande d’effacement, l’ensemble canonique des identifiants de clés et l’instant de décision. Son écriture précède la nullification des clés. Après son existence, `stage`, `finalize` et `readAuthorized` échouent fermement pour cette génération, y compris si le SQLite du coffre est restauré ; `destroyGeneration` reste rejouable afin de renullifier les clés ressuscitées par un PITR.

Le journal Conversation reçoit ensuite le Marqueur d’effacement attesté. Une panne après le tombstone mais avant ce marqueur rend déjà le contenu illisible et se répare par replay ; elle ne permet jamais une Restauration ordinaire.

Cette garantie protège le comportement de l’application contre le PITR de ses Durable Objects. Elle ne prétend pas résister à un administrateur du compte Cloudflare capable de modifier les bindings, le Worker privé ou les objets R2, ni constituer une preuve de destruction physique dans l’infrastructure du fournisseur.
