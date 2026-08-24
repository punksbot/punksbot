# Répartir les projections dans un pool de shards D1

Les projections propres aux Workspaces sont distribuées sur un anneau initial fixe de quatre bases D1 selon l’identifiant stable du Workspace. L’affectation gelée est `FNV-1a 32 bits(UTF-8(workspaceId)) modulo 4`. Le catalogue global des Bots reste exclusivement sur le shard 0. Local et staging utilisent exactement les quatre bindings `PROJECTION_DB_0..3` ; aucune variable d’environnement ne peut réduire, augmenter ou remapper cet anneau à chaud.

Une extension future au-delà de quatre shards exige une migration explicite : annuaire d’affectation durable, copie et vérification des projections reconstructibles, puis bascule fenceée des lectures et des consommateurs Queue. Modifier un modulo ou un nombre de shards en place est interdit, car cela remapperait silencieusement des Workspaces existants vers une projection vide ou partielle.
