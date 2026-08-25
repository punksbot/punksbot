/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RevokeWorkspaceInvitationResponse {
contract: "workspace.invite-revoke-response@1"
invitation: WorkspaceInvitationView
replayed: boolean
}
export interface WorkspaceInvitationView {
contract: "workspace.invitation@1"
invitationId: string
workspace: {
id: string
slug: string
name: string
}
workspaceRevision: number
role: ("member" | "guest")
status: ("issued" | "revoked" | "expired" | "exhausted")
issuedAt: string
expiresAt: string
revokedAt: (string | null)
maxUses: number
uses: number
usesRemaining: number
}
