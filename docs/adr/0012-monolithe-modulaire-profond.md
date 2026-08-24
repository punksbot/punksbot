# Organiser le backend en monolithe modulaire profond

Un Worker d’entrée présente les contrats Punks et orchestre des modules profonds qui cachent leurs implémentations D1, Durable Objects, R2, KV et Queues. Un Worker distinct n’est créé que lorsqu’une vraie couture d’exécution, de sécurité ou de retry le justifie, puis il est joint par service binding plutôt que par une URL publique.
