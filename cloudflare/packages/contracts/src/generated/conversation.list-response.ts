/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ListConversationsResponse {
contract: "conversation.list-response@1"
workspaceId: string
/**
 * @maxItems 100
 */
items: ConversationSummary[]
nextCursor: (string | null)
}
export interface ConversationSummary {
id: string
workspaceId: string
name: string
type: "stream"
visibility: ("open" | "private")
description: (string | null)
topic: (string | null)
purpose: (string | null)
topicRequired: boolean
ttlSeconds: (number | null)
ttlDeadline: (string | null)
revision: number
cursor: number
updatedAt: string
}
