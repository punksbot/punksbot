/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Message = ({
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
/**
 * @maxItems 1000
 */
contentVersions: ContentVersion[]
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

export interface ContentVersion {
version: number
contentCommitment: string
ciphertextRef: string
contentKeyId: string
topicPresent: boolean
createdAt: string
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
