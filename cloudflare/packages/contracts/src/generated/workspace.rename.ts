/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RenameWorkspaceCommand {
contract: "workspace.rename@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
slug: string
}
}
