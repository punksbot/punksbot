/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConversationProjectionMessageV2 {
schemaVersion: 2
workspaceId: string
conversationId: string
cursor: number
chunkIndex: number
chunkCount: number
chunkDigest: string
/**
 * @maxItems 100
 */
memberDeltas: MemberDelta[]
event: SignedNostrEvent
}
export interface MemberDelta {
punkId: string
present: boolean
access: ("owner" | "manager" | "member" | "guest")
joinedAt: string
invitedByPunkId: (string | null)
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
