/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunkSummaryBatchQuery {
contract: "punk.summary-batch@1"
workspaceId: string
/**
 * @minItems 1
 * @maxItems 100
 */
punkIds: [string, ...(string)[]]
}
