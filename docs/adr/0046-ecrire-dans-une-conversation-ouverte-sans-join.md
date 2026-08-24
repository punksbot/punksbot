# Autoriser l’écriture dans une Conversation ouverte sans adhésion explicite

Un Punk qui appartient au Workspace et dont le Rôle de Workspace contient `conversations.write` peut lire et publier dans une Conversation `open` sans exécuter préalablement `conversation.join`. L’adhésion explicite à la Conversation sert au roster, au suivi, aux préférences et à certaines notifications ; elle n’est pas une seconde permission d’écriture pour une Conversation ouverte. Une Conversation `private` exige toujours à la fois l’appartenance actuelle au Workspace et un accès explicite à la Conversation.

Cette règle préserve le comportement effectif de Buzz tout en gardant l’autorisation dans le bundle de permissions Workspace. Elle ne s’applique jamais aux Installations de Bot, qui restent refusées par défaut et doivent recevoir la capacité `messages.write` explicitement. Elle ne crée aucune autorisation GitHub et ne peut pas être utilisée pour inférer l’accès à un Repository.
