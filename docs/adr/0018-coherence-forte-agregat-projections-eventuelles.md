# Garantir la cohérence forte de l’agrégat et projeter ensuite

Une commande réussit après son commit dans le Durable Object autoritaire, ce qui rend immédiatement cohérents les permissions, le journal et l’état courant de l’agrégat. D1, la recherche, les notifications et les vues globales rejoignent ensuite le même curseur de façon asynchrone ; une requête peut demander un curseur minimal et recevoir explicitement une erreur de retard de projection.
