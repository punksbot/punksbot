/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ClaimWorkspaceInvitationCommand {
contract: "workspace.invite-claim@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
code: string
expectedRevision: number
}
}
