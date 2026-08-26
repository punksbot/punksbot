/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface WorkspaceMembershipLifecycleResponse {
contract: "workspace.membership-lifecycle-response@1"
workspaceId: string
revision: number
outcome: ("left" | "ownership_transferred")
role: ("member" | null)
replayed: boolean
}
