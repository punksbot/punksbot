# Maintenir la Présence comme signal éphémère sans autorité

La décision close par l’issue #23 et la tranche T8 de l’issue #70 sont
matérialisées par un `PresenceDO(workspaceId)` séparé des autorités de
Workspace, Conversation et Attention.

Le Durable Object conserve uniquement l’état courant nécessaire pour survivre
à une hibernation : au plus un Bail de Présence par Punk, son Statut de Présence
facultatif et les Signaux de frappe encore vivants. Ces lignes ont toutes une
échéance. Une déconnexion, une révocation ou une alarme les détruit ; aucune
transition n’entre dans un journal signé, D1, R2, une Queue, un Reçu ou une
projection de recherche. SQLite n’est donc pas un historique de Présence : il
est le minuteur fortement coordonné du signal vivant.

Le sous-protocole `punks.presence.v1` applique un heartbeat toutes les quinze
secondes, dérive `away` après trente secondes et `offline` par absence de Bail
après soixante secondes. Un token `pls1` aléatoire de 256 bits borne et fence
le Bail mais n’accorde aucune autorité ; il reste dans le client Rust et le
WebSocket. Le renderer reçoit seulement `desktop.presence-delivery@1`, qui
exclut structurellement token, Session, cookie et appareil. Le Statut est une
chaîne NFC de 1 à 80 caractères et les changements excédentaires sont omis. Le
typing expire après cinq secondes et ses excès sont eux aussi omis.

Chaque signal actif revalide la Session, le Workspace et, pour le typing, la
Conversation. Les destinataires d’un patch sont revalidés avant livraison. Un
Invité ne reçoit pas le roster de Présence du Workspace ; le typing reste sur
le FOLLOW de la Conversation qu’il peut effectivement lire. Les patches
typing sont dédupliqués par `{Punk, leaseGeneration, sequence}`, ne portent pas
de curseur de Conversation et ne participent jamais à l’ACK autoritaire.

Le Rust natif possède la socket, le heartbeat et la reconnexion. React conserve
les vues dans des Maps strictement mémoire liées à la génération de
`WorkspaceSession`, applique les expirations localement et affiche une
dégradation explicite. Il n’existe ni cache persistant, ni réhydratation, ni
fallback Buzz/Nostr, ni retry de mutation.

La source préparée transporte le snapshot et les deltas Workspace sur le canal
du Bail. La décision #23 destine ces patches au FOLLOW d’Attention lorsque T7
est disponible. Cette intégration et le Reçu T7 restent un gate d’activation :
la capacité `presence` demeure absente du profil actif et du graphe produit
tant que ce séquencement et le dossier distribué T8 ne sont pas scellés. Cette
préparation ne revendique donc ni activation, ni retrait physique des chemins
Buzz de Présence.
