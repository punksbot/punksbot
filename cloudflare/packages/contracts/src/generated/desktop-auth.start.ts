/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopAuthStartExchange = (DesktopAuthStartRequest | DesktopAuthStartResponse)

export interface DesktopAuthStartRequest {
contract: "desktop-auth.start@1"
message: "request"
intent: ("sign_in" | "switch_account" | "reauthenticate" | "link_google" | "link_github" | "register_passkey")
method: ("google" | "github" | "passkey")
verifierCommitment: string
purpose?: ("link_google" | "link_github" | "register_passkey" | "transfer_workspace_ownership")
authorizationId?: string
}
export interface DesktopAuthStartResponse {
contract: "desktop-auth.start@1"
message: "response"
flowId: string
phase: "started"
intent: ("sign_in" | "switch_account" | "reauthenticate" | "link_google" | "link_github" | "register_passkey")
method: ("google" | "github" | "passkey")
browserUrl: string
createdAt: string
expiresAt: string
}
