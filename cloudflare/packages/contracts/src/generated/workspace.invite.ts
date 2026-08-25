/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CreateWorkspaceInvitationCommand {
contract: "workspace.invite@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
role: ("member" | "guest")
expectedRevision: number
ttlSeconds?: number
maxUses?: number
}
}
