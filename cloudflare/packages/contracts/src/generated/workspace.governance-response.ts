/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface WorkspaceGovernanceResponse {
contract: "workspace.governance-response@1"
workspace: WorkspaceGovernanceView
/**
 * @maxItems 100
 */
members: Member[]
nextCursor: (string | null)
}
export interface WorkspaceGovernanceView {
contract: "workspace.governance-view@1"
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
status: "active"
ownerPunkId: string
memberCount: number
revision: number
cursor: number
createdAt: string
updatedAt: string
}
export interface Member {
punkId: string
role: ("owner" | "moderator" | "member" | "guest")
}
