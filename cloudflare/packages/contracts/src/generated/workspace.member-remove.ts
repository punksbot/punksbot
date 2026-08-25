/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RemoveWorkspaceMemberCommand {
contract: "workspace.member-remove@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
targetPunkId: string
expectedRevision?: number
}
}
