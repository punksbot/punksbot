/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type ConversationFollowServerFrame = (Accepted | Changes | Ready | ResyncRequired | ConversationUnavailable)
export type MessageView = ({
[k: string]: unknown | undefined
} & {
id: string
workspaceId: string
conversationId: string
author: ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})
messageType: ("stream-message" | "forum-post" | "forum-comment")
status: ("active" | "retracted" | "erased")
content: (string | null)
topic: (string | null)
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
currentVersion: (number | null)
retractionKind: (("author" | "moderation") | null)
retractedAt: (string | null)
eraseAfter: (string | null)
publicReason: (string | null)
erasedAt: (string | null)
revision: number
createdCursor: number
cursor: number
createdAt: string
updatedAt: string
editedAt: (string | null)
})
export type CanonicalReaction = string

export interface Accepted {
schemaVersion: 1
type: "accepted"
resumeAfterCursor: number
targetHighWaterCursor: number
}
export interface Changes {
schemaVersion: 1
type: "changes"
fromExclusiveCursor: number
throughCursor: number
/**
 * @maxItems 100
 */
messages: MessageView[]
/**
 * @maxItems 100
 */
threadPatches: ThreadPatch[]
/**
 * @maxItems 100
 */
reactionPatches: ReactionPatch[]
/**
 * @maxItems 100
 */
reactionCollectionPatches: ReactionCollectionPatch[]
}
export interface ThreadPatch {
messageId: string
replyCount: number
descendantCount: number
lastReplyAt: (string | null)
revision: number
cursor: number
}
export interface ReactionPatch {
messageId: string
reaction: CanonicalReaction
count: number
reactedByPunk: boolean
cursor: number
}
export interface ReactionCollectionPatch {
messageId: string
visibility: ("visible" | "temporarily-hidden" | "permanently-hidden")
cursor: number
refreshRequired: boolean
}
export interface Ready {
schemaVersion: 1
type: "ready"
highWaterCursor: number
}
export interface ResyncRequired {
schemaVersion: 1
type: "resync-required"
reason: ("history_required" | "slow_consumer")
afterCursor: number
highWaterCursor: number
}
export interface ConversationUnavailable {
schemaVersion: 1
type: "conversation-unavailable"
reason: "archived"
cursor: number
}
