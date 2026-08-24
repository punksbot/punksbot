# Paginer l’historique Message par `createdCursor`

L’historique d’une Conversation est ordonné par le `createdCursor` immuable de chaque Message, jamais par son horodatage ni par son curseur de dernière mutation. La première page capture le curseur autoritaire courant de la Conversation comme `highWaterCursor`. Toutes les pages suivantes conservent ce high-water et excluent les Messages créés après lui, même si de nouveaux Messages sont publiés pendant la pagination.

Le curseur opaque est signé par HMAC avec un secret distinct, lie le Workspace, la Conversation, l’éventuel filtre `threadRootMessageId`, le high-water, la position `createdCursor` et la direction `older` ou `newer`, et ne peut donc pas être transplanté entre agrégats ou jeux de filtres. Chaque page publique reste triée par `createdCursor` croissant. Les pages `older` traversent les lignes en ordre descendant puis inversent uniquement la présentation.

Le high-water fige l’ensemble et l’ordre de création, pas une copie historique du plaintext. Le statut et le contenu de chaque Message sont relus dans l’état autoritaire courant. L’accès Workspace et Conversation est vérifié avant tout déchiffrement puis revalidé avant la réponse afin qu’une révocation concurrente ne laisse pas sortir le plaintext déjà lu. Un Message rétracté ou effacé est rendu comme tombstone sans contenu.

La réponse sérialisée UTF-8 ne dépasse jamais 1 048 576 octets. Le runtime réserve la taille maximale du prochain curseur, arrête la page avant la limite et émet `nextCursor` dès qu’un Message autorisé reste à parcourir. Les vues publiques sont construites par allowlist et ne contiennent ni événement Nostr, ni engagement cryptographique, ni identifiant de clé, ni référence R2.
