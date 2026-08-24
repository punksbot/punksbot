# Maintenir un registre de contrats indépendant du langage

Les commandes, réponses, erreurs et événements temps réel exposés aux clients sont décrits dans un registre versionné qui ne dépend d’aucun langage d’implémentation. Ce registre génère ou valide les modèles TypeScript, Rust et Dart et constitue l’interface commune des tests de parité, tandis que le stockage et la coordination restent cachés derrière elle.
