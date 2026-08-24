# Isoler l’Attestation Punks dans un Worker dédié

Un Worker d’attestation privé, joignable seulement par Service Binding, détient la clé de signature active propre à chaque environnement. Les clés portent une version, les anciennes clés publiques restent disponibles pour vérifier l’historique, et la rotation ne réécrit aucun événement. Le Worker applicatif transmet uniquement une demande déjà authentifiée et autorisée ; il ne reçoit jamais la clé privée.
