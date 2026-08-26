# Paginer la recherche Message par un curseur lié

La première surface publique recherche dans une seule Conversation déjà
autorisée ou dans un Fil explicite de cette Conversation. Le
`threadRootMessageId` nullable est toujours présent dans le contrat : `null`
désigne toute la Conversation, un UUID désigne exactement un Fil autorisé.
Elle normalise et déduplique entre un et trente-deux termes avec un
algorithme versionné, dérive les jetons opaques décrits par l’ADR 0047, puis
exige leur présence conjointe dans D1 FTS5 sous le Workspace **et** la
Conversation exacts. Les termes sont comptés jusqu’au trente-troisième avant
toute HMAC ; une requête vide ou trop large est refusée et n’est jamais
tronquée. D1 ne calcule pas de BM25 global : les candidats suivent
`createdCursor DESC`, `conversationId ASC`, `messageId ASC`.

Une recherche transversale au Workspace ne peut pas être construite en
interrogeant tous les candidats puis en filtrant les Conversations privées :
les pages vides, le curseur suivant et le temps de réponse révéleraient le
volume de correspondances cachées. Elle restera indisponible jusqu’à disposer
d’un snapshot d’accès fortement lié au Punk, révocable avant lecture et
incapable d’élargir les droits. Cette restriction applique l’isolation complète
au lieu de transformer D1 en autorité implicite.

La recherche publique utilise un `POST` à corps JSON canonique afin que le
texte et le curseur n’entrent pas dans l’URL ni dans les journaux d’accès URL.
Le corps est exactement `message.search@1` : Workspace, Conversation, racine
de Fil nullable, requête, curseur nullable et limite sont tous explicites et
obligatoires ; la couche HTTP n’invente aucune valeur par défaut hors du
registre.
Le curseur public a la forme `msc1.<nonce>.<ciphertext>`. Une clé
`MESSAGE_SEARCH_CURSOR_KEY`, distincte de la clé d’indexation, passe par HKDF
SHA-256 pour dériver séparément une clé AES-256-GCM et une clé HMAC de liaison
de requête. Chaque encodage utilise un nonce aléatoire de 96 bits. Le payload
chiffré et authentifié lie sa version, le Punk, le Workspace, la Conversation,
la racine de Fil nullable, la version de normalisation, l’algorithme, une
liaison HMAC des jetons triés, le triplet interne et la limite. Une continuation
fournit à nouveau `query` et le runtime refuse toute différence. Ni identifiant
Punk/Conversation/Message/Fil, ni position, requête, hash simple ou jeton
d’index n’est lisible dans le curseur ; deux encodages de la même position
restent différents.

D1 fournit uniquement des identifiants candidats et n’est jamais une autorité
d’accès. Après sélection, l’API relit le Message autoritaire, déchiffre seulement
sa version active, revalide l’accès après ce déchiffrement et relit encore le
statut et la version sans `await` avant émission. Elle vérifie aussi en mémoire
que le contenu et le sujet **courants** contiennent toujours tous les termes de
la requête avec la même normalisation ; une ancienne projection d’avant édition
ne peut donc pas rendre un nouveau contenu qui ne correspond plus. Une panne du
coffre fait échouer la page sans avancer le curseur. Une rétraction, un
effacement, une édition devenue non correspondante ou une révocation concurrente
produit une omission sûre.

La projection reste à cohérence éventuelle : un Message récemment publié peut
être absent et un candidat retiré peut encore être rencontré, mais le filtre
autoritaire et la correspondance courante empêchent toute restitution périmée.
Le Search Worker compare le plus grand `last_cursor` projeté au plus grand
curseur Message autoritaire du périmètre demandé. Un retard produit
`completeness: partial` avec `partialReason: index_lagging`; une indisponibilité
de D1 produit `index_unavailable`. Aucun de ces états ne déclenche un fallback.
Une page complète porte `partialReason: null`.

Chaque page contient au plus cent `MessageView` actives de la Conversation et,
le cas échéant, du Fil demandé, reste sous 1 048 576 octets UTF-8 et n’expose ni
score, extrait, jeton, métadonnée cryptographique, événement Nostr ou détail
d’un candidat omis.
