/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunkSummaryBatchResponse {
contract: "punk.summary-batch-response@1"
workspaceId: string
/**
 * @maxItems 100
 */
items: Summary[]
}
export interface Summary {
punkId: string
displayName: string
avatarUrl: (string | null)
}
