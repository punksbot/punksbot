/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RevokeWorkspaceInvitationCommand {
contract: "workspace.invite-revoke@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
invitationId: string
expectedRevision: number
}
}
