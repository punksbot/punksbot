# Séparer l’identité du Workspace de son slug

Chaque Workspace reçoit un identifiant opaque permanent et un slug humain globalement unique mais modifiable. Les relations, Durable Objects et clés de stockage utilisent l’identifiant stable ; un changement de slug conserve temporairement l’ancien chemin comme redirection plutôt que de renommer les données.
