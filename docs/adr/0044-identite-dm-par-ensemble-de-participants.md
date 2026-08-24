# Identifier une Conversation directe par son ensemble de participants

Une Conversation directe appartient à un Workspace et son ensemble de deux à neuf Punks participants est immuable. Un agrégat `ConversationIdentityDO`, adressé par le hash canonique du Workspace et de l’ensemble trié des identifiants de Punk, sérialise la création : le même ensemble retourne la même Conversation active, quel que soit l’ordre fourni ou le `commandId`. Ajouter un Punk crée donc une nouvelle Conversation directe, comme dans Buzz, plutôt que de muter silencieusement la portée confidentielle d’un DM existant.

Cette identité ne vaut que dans Punks Bot. Elle ne crée aucune relation GitHub, ne prouve aucun accès à un Repository et ne peut jamais élargir les droits GitHub d’un participant.
