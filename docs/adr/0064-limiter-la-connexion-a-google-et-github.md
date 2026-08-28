# Limiter la connexion à Google et GitHub

La décision opérateur du 28 août 2026 retire définitivement les passkeys comme Moyen de connexion Punks : Google et GitHub sont les seuls moyens proposés ou acceptés, y compris pour la réauthentification et les preuves du candidat. Cette décision remplace l’option facultative de l’ADR 0020 et l’ADR 0043 ; la liaison explicite après réauthentification de l’ADR 0032 reste obligatoire entre Google et GitHub.

Les points d’entrée WebAuthn, les nouvelles cérémonies passkey, leurs dépendances et leurs stockages dédiés sont retirés ; les anciens flux ne peuvent plus délivrer de Session, tandis que les comptes et Sessions OAuth restent utilisables. Les métadonnées historiques nécessaires à la lecture des anciens comptes, plans et journaux restent interprétables sans constituer une autorité d’authentification ni réintroduire l’option.
