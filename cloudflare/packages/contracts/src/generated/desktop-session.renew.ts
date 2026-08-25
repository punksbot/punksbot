/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopSessionRenewExchange = (DesktopSessionRenewPrepareRequest | DesktopSessionRenewPreparedResponse | DesktopSessionRenewConfirmRequest | DesktopSessionRenewConfirmedResponse)

export interface DesktopSessionRenewPrepareRequest {
contract: "desktop-session.renew@1"
message: "request"
action: "prepare"
commandId: string
}
export interface DesktopSessionRenewPreparedResponse {
contract: "desktop-session.renew@1"
message: "response"
action: "prepared"
commandId: string
rotationId: string
session: DesktopSessionRenewSession
revokeCapability: DesktopSessionRenewRevokeCapability
confirmBy: string
}
export interface DesktopSessionRenewSession {
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
export interface DesktopSessionRenewRevokeCapability {
token: string
expiresAt: string
}
export interface DesktopSessionRenewConfirmRequest {
contract: "desktop-session.renew@1"
message: "request"
action: "confirm"
commandId: string
rotationId: string
}
export interface DesktopSessionRenewConfirmedResponse {
contract: "desktop-session.renew@1"
message: "response"
action: "confirmed"
commandId: string
rotationId: string
sessionId: string
confirmedAt: string
}
