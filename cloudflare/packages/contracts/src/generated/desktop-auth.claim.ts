/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopAuthClaimExchange = (DesktopAuthClaimRequest | DesktopAuthClaimResponse | DesktopAuthClaimReauthorizationResponse)

export interface DesktopAuthClaimRequest {
contract: "desktop-auth.claim@1"
message: "request"
deliveryKind: "request"
flowId: string
verifier: string
}
export interface DesktopAuthClaimResponse {
contract: "desktop-auth.claim@1"
message: "response"
flowId: string
phase: "delivering"
deliveryKind: "session"
deliveryId: string
session: DesktopAuthClaimSession
revokeCapability: DesktopSessionRevokeCapability
deliveryExpiresAt: string
}
export interface DesktopAuthClaimSession {
sessionId: string
punkId: string
authenticatedAt: string
expiresAt: string
recentReauthUntil: (string | null)
punk: {
id: string
displayName: string
avatarUrl: (string | null)
}
}
export interface DesktopSessionRevokeCapability {
token: string
expiresAt: string
}
export interface DesktopAuthClaimReauthorizationResponse {
contract: "desktop-auth.claim@1"
message: "response"
flowId: string
phase: "delivering"
deliveryKind: "reauthorization"
deliveryId: string
authorization: DesktopReauthenticationAuthorization
deliveryExpiresAt: string
}
export interface DesktopReauthenticationAuthorization {
authorizationId: string
sessionId: string
punkId: string
intent: "reauthenticate"
targetMethod: ("link_google" | "link_github" | "register_passkey" | "transfer_workspace_ownership")
workspaceOwnershipTransfer?: DesktopWorkspaceOwnershipTransferBinding
handoffId: string
expiresAt: string
}
export interface DesktopWorkspaceOwnershipTransferBinding {
workspaceId: string
targetPunkId: string
expectedRevision: number
}
