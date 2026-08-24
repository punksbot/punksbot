/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ListWorkspacesResponse {
contract: "workspace.list-response@1"
/**
 * @maxItems 100
 */
items: WorkspaceSummary[]
nextCursor: (string | null)
}
export interface WorkspaceSummary {
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
role: ("owner" | "moderator" | "member" | "guest")
revision: number
}
