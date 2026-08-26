/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type MessageSearchResponse = ({
[k: string]: unknown | undefined
} & {
workspaceId: string
conversationId: string
threadRootMessageId: (string | null)
order: "createdCursor-descending"
completeness: ("complete" | "partial")
partialReason: (("index_lagging" | "index_unavailable") | null)
/**
 * @maxItems 100
 */
items: (MessageView & {
status: "active"
[k: string]: unknown | undefined
})[]
nextCursor: (string | null)
})
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
