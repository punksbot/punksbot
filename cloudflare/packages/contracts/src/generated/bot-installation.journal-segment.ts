/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type BotInstallationJournalSegmentArchive = ({
[k: string]: unknown | undefined
} & {
schemaVersion: 1
workspaceId: string
installationId: string
startCursor: number
endCursor: number
previousSegmentHash: NullableHash
segmentHash: Hash
/**
 * @minItems 1
 * @maxItems 500
 */
events: [SignedEvent, ...(SignedEvent)[]]
seal: Seal
})
export type NullableHash = (null | Hash)
export type Hash = string
/**
 * @minItems 1
 */
export type GenericTag = [string, ...(string)[]]
/**
 * @minItems 6
 * @maxItems 6
 */
export type SealTagsWithoutPrevious = never[]
/**
 * @minItems 7
 * @maxItems 7
 */
export type SealTagsWithPrevious = never[]

export interface SignedEvent {
id: Hash
pubkey: Hash
created_at: number
kind: (50310 | 50311 | 50312 | 50320 | 50321)
/**
 * @maxItems 128
 */
tags: GenericTag[]
content: string
sig: string
}
export interface Seal {
id: Hash
pubkey: Hash
created_at: number
kind: 50313
tags: (SealTagsWithoutPrevious | SealTagsWithPrevious)
content: string
sig: string
}
