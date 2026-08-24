/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type BoundedState = ({
[k: string]: unknown | undefined
} & {
id: string
workspaceId: string
conversationId: string
author: Actor
messageType: ("stream-message" | "forum-post" | "forum-comment")
status: ("active" | "retracted" | "erased")
topicPresent: boolean
/**
 * @maxItems 50
 */
mentionedPunkIds: string[]
/**
 * @maxItems 50
 */
mediaIds: string[]
parentMessageId: (string | null)
threadRootMessageId: string
threadDepth: number
broadcast: boolean
replyCount: number
descendantCount: number
lastReplyAt: (string | null)
originalContentCommitment: (string | null)
currentVersion: (number | null)
retraction: (Retraction | null)
erasureMarker: (ErasureMarker | null)
revision: number
createdCursor: number
cursor: number
createdAt: string
updatedAt: string
editedAt: (string | null)
})
export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface MessageProjectionMessage {
schemaVersion: 1
workspaceId: string
conversationId: string
messageId: string
cursor: number
event: SignedNostrEvent
state: BoundedState
versionDelta: ({
operation: "upsert"
version: ContentVersion
} | {
operation: "retain"
} | {
operation: "erase-all"
})
/**
 * @maxItems 2
 */
threadDeltas: []|[{
messageId: string
replyCountDelta: number
descendantCountDelta: number
lastReplyAt: (string | null)
revision: number
cursor: number
updatedAt: string
}]|[{
messageId: string
replyCountDelta: number
descendantCountDelta: number
lastReplyAt: (string | null)
revision: number
cursor: number
updatedAt: string
}, {
messageId: string
replyCountDelta: number
descendantCountDelta: number
lastReplyAt: (string | null)
revision: number
cursor: number
updatedAt: string
}]
search: {
algorithm: "hmac-sha256-conversation-v2"
/**
 * @maxItems 1024
 */
tokens: string[]
}
}
export interface SignedNostrEvent {
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}
export interface Retraction {
commandId: string
kind: ("author" | "moderation")
actor: Actor
requestedAt: string
eraseAfter: string
reasonCode: (string | null)
publicReason: (string | null)
}
export interface ErasureMarker {
erasedAt: string
retractedAt: string
retractionKind: ("author" | "moderation")
destroyedVersionCount: number
}
export interface ContentVersion {
version: number
contentCommitment: string
ciphertextRef: string
contentKeyId: string
topicPresent: boolean
createdAt: string
}
