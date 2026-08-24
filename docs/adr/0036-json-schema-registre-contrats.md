# Utiliser JSON Schema comme registre canonique de contrats

Les commandes, requêtes, événements, erreurs et enveloppes sont définis par des JSON Schema versionnés dans le registre indépendant du langage. Les types et validateurs TypeScript, Rust et Dart ainsi que les descriptions OpenAPI et AsyncAPI sont générés depuis ce registre ; aucun type source d’un client ou du serveur ne devient une seconde définition canonique.
