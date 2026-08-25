/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunkSearchResponse {
contract: "punk.search-response@1"
workspaceId: string
/**
 * @maxItems 20
 */
items: []|[Summary]|[Summary, Summary]|[Summary, Summary, Summary]|[Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]|[Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary, Summary]
nextCursor: (string | null)
}
export interface Summary {
punkId: string
displayName: string
avatarUrl: (string | null)
}
