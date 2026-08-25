/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface WorkspaceMembershipMutationResponse {
contract: "workspace.membership-mutation-response@1"
workspace: Workspace
replayed: boolean
}
export interface Workspace {
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
status: ("active" | "deleting" | "deleted")
ownerPunkId: string
/**
 * @minItems 1
 */
members: [{
punkId: string
role: ("owner" | "moderator" | "member" | "guest")
}, ...({
punkId: string
role: ("owner" | "moderator" | "member" | "guest")
})[]]
revision: number
cursor: number
createdAt: string
updatedAt: string
}
