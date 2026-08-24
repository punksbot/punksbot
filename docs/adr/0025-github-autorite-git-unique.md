# Utiliser GitHub comme autorité Git unique

Les objets Git, commits, références et branches autoritaires résident exclusivement sur GitHub et sont accessibles par une GitHub App aux permissions minimales. Punks Bot conserve dans Cloudflare les connexions, attestations, projections, index et caches nécessaires, mais aucun cache R2 ne devient inscriptible comme seconde autorité. Cette dépendance externe est une exception délibérée au stockage Cloudflare Native ; le reste de l’état possédé par Punks reste sur les services Cloudflare retenus.
