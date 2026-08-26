/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface TransferWorkspaceOwnershipCommand {
contract: "workspace.transfer-ownership@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
targetPunkId: string
expectedRevision: number
reauthorizationId: string
}
}
