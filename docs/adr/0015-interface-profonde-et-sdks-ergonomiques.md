# Séparer l’interface profonde des SDK ergonomiques

Le backend et le registre de contrats exposent une petite interface typée de commande, requête et suivi, stable pour le versioning et les tests. Les SDK web, desktop et mobile construisent au-dessus des sessions ergonomiques de Workspace, conversation, Git, huddle et Bot sans créer une seconde sémantique ni exposer les noms de contrats aux Punks.
