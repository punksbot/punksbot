/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface UpdateConversationCommand {
contract: "conversation.update@1"
commandId: string
workspaceId: string
conversationId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
name?: string
description?: (string | null)
visibility?: ("open" | "private")
topic?: (string | null)
purpose?: (string | null)
topicRequired?: boolean
maxMembers?: (number | null)
ttlSeconds?: (number | null)
}
}
