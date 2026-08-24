# Isoler les passkeys de staging par leur RP ID

Les cérémonies WebAuthn de staging emploient `staging.punks.bot` comme RP ID et `https://staging.punks.bot` comme origine attendue. Elles n’emploient jamais le RP ID parent `punks.bot`, réservé à la production, afin qu’une passkey créée ou testée en staging ne puisse pas être présentée au service de production. Les credentials sont discoverable, exigent la vérification du Punk et ne peuvent être ajoutés qu’après une réauthentification récente.
