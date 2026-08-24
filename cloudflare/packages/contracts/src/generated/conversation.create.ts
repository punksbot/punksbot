/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CreateConversationCommand {
contract: "conversation.create@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
name: string
type: ("stream" | "forum" | "dm" | "workflow")
visibility: ("open" | "private")
description?: string
topicRequired?: boolean
maxMembers?: number
ttlSeconds?: number
/**
 * @maxItems 1000
 */
participantPunkIds?: string[]
}
}
