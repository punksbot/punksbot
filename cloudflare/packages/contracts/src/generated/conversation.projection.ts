/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConversationProjectionMessage {
schemaVersion: 1
workspaceId: string
conversationId: string
cursor: number
event: SignedNostrEvent
state: Conversation
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
export interface Conversation {
id: string
workspaceId: string
name: string
type: ("stream" | "forum" | "dm" | "workflow")
visibility: ("open" | "private")
description: (string | null)
topic: (string | null)
purpose: (string | null)
topicRequired: boolean
maxMembers: (number | null)
ttlSeconds: (number | null)
ttlDeadline: (string | null)
ownerPunkId: string
/**
 * @minItems 1
 * @maxItems 100000
 */
members: [{
punkId: string
access: ("owner" | "manager" | "member" | "guest")
joinedAt: string
invitedByPunkId: (string | null)
}, ...({
punkId: string
access: ("owner" | "manager" | "member" | "guest")
joinedAt: string
invitedByPunkId: (string | null)
})[]]
status: ("active" | "archived" | "deleting" | "deleted")
revision: number
cursor: number
createdAt: string
updatedAt: string
archivedAt: (string | null)
}
