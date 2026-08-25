/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ClaimWorkspaceInvitationResponse {
contract: "workspace.invite-claim-response@1"
result: ("joined" | "already_member")
workspace: {
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
role: ("owner" | "moderator" | "member" | "guest")
revision: number
}
replayed: boolean
}
