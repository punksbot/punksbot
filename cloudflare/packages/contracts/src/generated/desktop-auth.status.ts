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
outcomeCode: (("account_created" | "account_creation_confirmation_required" | "authenticated" | "cancelled" | "expired" | "link_required" | "link_pending" | "linked" | "merge_required" | "provider_error" | "reauthenticated" | "reauthentication_failed" | "session_expired" | "temporarily_unavailable") | null)
decision: DesktopAuthRetryDecision
}
export interface DesktopAuthRetryDecision {
oldSessionUsable: boolean
revokePreparedSession: boolean
destroyWorkspaceContext: boolean
retrySameRequest: boolean
freshHumanActionRequired: boolean
}
