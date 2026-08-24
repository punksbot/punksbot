/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface MembershipJournalSegmentArchiveV2 {
schemaVersion: 2
workspaceId: string
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
chunks: [WorkspaceProjectionChunk, ...(WorkspaceProjectionChunk)[]]
}, ...({
cursor: number
event: SignedNostrEvent
/**
 * @minItems 1
 * @maxItems 64
 */
chunks: [WorkspaceProjectionChunk, ...(WorkspaceProjectionChunk)[]]
})[]]
seal: {
id: string
pubkey: string
created_at: number
kind: 50002
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
export interface WorkspaceProjectionChunk {
schemaVersion: 2
workspaceId: string
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
role: ("owner" | "moderator" | "member" | "guest")
}[]
event: SignedNostrEvent
}
