# Ne jamais élargir l’accès à un Repository GitHub

Une Connexion de Repository n’accorde aucun droit implicite sur le code. Chaque Punk doit être autorisé par GitHub pour consulter ou modifier un Repository privé, et Punks UI vérifie cette autorisation au moyen du jeton utilisateur de la GitHub App. Les projections, caches et résultats de Bot dérivés d’un Repository privé ne sont jamais exposés à un Punk non autorisé ni aux vues Punks ou publiques ; le jeton d’installation utilisé par un Bot ne sert pas à redistribuer les droits de la GitHub App.
