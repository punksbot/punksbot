/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopAuthStatusExchange = (DesktopAuthStatusRequest | DesktopAuthStatusResponse)

export interface DesktopAuthStatusRequest {
contract: "desktop-auth.status@1"
message: "request"
flowId: string
verifierCommitment: string
}
export interface DesktopAuthStatusResponse {
contract: "desktop-auth.status@1"
message: "response"
flowId: string
phase: ("started" | "browser_complete" | "ready" | "delivering" | "confirmed" | "cancelled" | "expired")
terminal: boolean
expiresAt: string
result: ("success" | "human_action_required" | "security_failure" | "transient_interruption")
decision: DesktopAuthRetryDecision
}
export interface DesktopAuthRetryDecision {
oldSessionUsable: boolean
revokePreparedSession: boolean
destroyWorkspaceContext: boolean
retrySameRequest: boolean
freshHumanActionRequired: boolean
}
