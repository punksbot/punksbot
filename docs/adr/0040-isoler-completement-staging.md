# Isoler complètement le staging de la production

`staging.punks.bot` utilise des Workers, Durable Objects, bases D1, buckets R2, namespaces KV, Queues, secrets, clés d’attestation, clients OAuth Google et GitHub App distincts de la production. Aucun Compte Punks, Repository connecté, événement ou contenu n’est partagé entre les environnements. Les contrats et artefacts déployables sont identiques, tandis que les identifiants et données restent séparés.
