/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunkSearchQuery {
contract: "punk.search@1"
workspaceId: string
query: ({
kind: "prefix"
value: string
} | {
kind: "punk_id"
punkId: string
})
limit: number
cursor: (string | null)
}
