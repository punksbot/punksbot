# Tester sans exécuter les dépendances serveur amont

Docker, PostgreSQL, Redis et tout runtime serveur non-Workers sont exclus non seulement des environnements déployés, mais aussi du développement et de la CI. La migration avance toujours par tranches verticales, mais la parité est établie au moyen des tests amont exécutables sans ces services, de l’analyse des contrats et de fixtures figées plutôt que par un oracle Buzz vivant de bout en bout.
