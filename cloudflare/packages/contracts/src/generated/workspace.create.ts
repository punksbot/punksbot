/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CreateWorkspaceCommand {
contract: "workspace.create@1"
commandId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
slug: string
name: string
visibility: ("private" | "punks" | "public")
}
}
