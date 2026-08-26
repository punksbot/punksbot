/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface WorkspaceMembershipMutationResponse {
contract: "workspace.membership-mutation-response@1"
workspace: WorkspaceGovernanceView
/**
 * @minItems 1
 * @maxItems 2
 */
memberDeltas: [(PresentWorkspaceMemberDelta | RemovedWorkspaceMemberDelta)]|[(PresentWorkspaceMemberDelta | RemovedWorkspaceMemberDelta), (PresentWorkspaceMemberDelta | RemovedWorkspaceMemberDelta)]
replayed: boolean
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
export interface PresentWorkspaceMemberDelta {
punkId: string
present: true
role: ("owner" | "moderator" | "member" | "guest")
}
export interface RemovedWorkspaceMemberDelta {
punkId: string
present: false
role: null
}
