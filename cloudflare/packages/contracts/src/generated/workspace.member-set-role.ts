/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface SetWorkspaceMemberRoleCommand {
contract: "workspace.member-set-role@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
targetPunkId: string
role: ("owner" | "moderator" | "member" | "guest")
expectedRevision: number
}
}
