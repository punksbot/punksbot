/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConversationJournalSegmentArchive {
schemaVersion: 1
workspaceId: string
conversationId: string
startCursor: number
endCursor: number
previousSegmentHash: (null | string)
segmentHash: string
/**
 * @minItems 1
 * @maxItems 500
 */
events: [{
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}, ...({
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
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
