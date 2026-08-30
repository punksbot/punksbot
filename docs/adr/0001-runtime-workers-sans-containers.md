# Cibler un runtime Cloudflare Workers sans Containers

Cloudflare Native signifie que le compute et les données contrôlés par Punks Bot reposent exclusivement sur les services Workers gérés, notamment Workers, Durable Objects, D1, R2, KV, Queues et Workflows ; Cloudflare Containers ainsi que les bases, caches et stockages externes sont exclus. Les API externes qui fournissent une capacité produit, comme les modèles d’IA, GitHub, Stripe ou APNs, restent permises, au prix d’une réécriture des composants Punks qui dépendent de Rust natif, PostgreSQL, Redis, du filesystem ou de sous-processus.
