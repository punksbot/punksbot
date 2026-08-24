# Adresser les Workspaces par chemin

L’URL canonique de chaque Workspace est `punks.bot/w/<slug>` et, en staging, `staging.punks.bot/w/<slug>`, plutôt qu’un sous-domaine. Tous les Workspaces partagent ainsi une origine web et un système de connexion, tandis que leur isolation reste imposée par le routage, les autorisations et le partitionnement des données ; les routes produit réservées ne peuvent pas entrer en collision avec un slug.
