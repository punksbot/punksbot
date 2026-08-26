/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface MessageSearchQuery {
contract: "message.search@1"
workspaceId: string
conversationId: string
threadRootMessageId: (string | null)
query: string
cursor: (string | null)
limit: number
}
