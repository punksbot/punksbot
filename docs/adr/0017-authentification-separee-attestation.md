# Séparer l’authentification de l’attestation des événements

Un Punk s’authentifie auprès de Punks Bot sans détenir obligatoirement une clé Nostr, puis le backend autorise sa commande et produit une Attestation Punks dans l’événement interne signé. Les installations de Bot suivent la même frontière : l’identité de session et les permissions déterminent l’acteur attribué, tandis que la clé d’attestation reste une responsabilité isolée de la plateforme.
