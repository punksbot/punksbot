/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConversationMembershipJournalSegmentArchiveV2 {
schemaVersion: 2
workspaceId: string
conversationId: string
startCursor: number
endCursor: number
previousSegmentHash: (null | string)
segmentHash: string
/**
 * @minItems 1
 * @maxItems 64
 */
entries: [{
cursor: number
event: SignedNostrEvent
/**
 * @minItems 1
 * @maxItems 64
 */
chunks: [ConversationProjectionChunk, ...(ConversationProjectionChunk)[]]
}, ...({
cursor: number
event: SignedNostrEvent
/**
 * @minItems 1
 * @maxItems 64
 */
chunks: [ConversationProjectionChunk, ...(ConversationProjectionChunk)[]]
})[]]
seal: {
id: string
pubkey: string
created_at: number
kind: 50104
tags: [string, ...(string)[]][]
content: string
sig: string
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
export interface ConversationProjectionChunk {
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
memberDeltas: {
punkId: string
present: boolean
access: ("owner" | "manager" | "member" | "guest")
joinedAt: string
invitedByPunkId: (string | null)
}[]
event: SignedNostrEvent
}
