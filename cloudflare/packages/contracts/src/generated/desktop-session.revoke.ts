/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopSessionRevokeExchange = (DesktopSessionRevokeRequest | DesktopSessionRevokeResponse)

export interface DesktopSessionRevokeRequest {
contract: "desktop-session.revoke@1"
message: "request"
capability: string
}
export interface DesktopSessionRevokeResponse {
contract: "desktop-session.revoke@1"
message: "response"
revoked: true
expired: boolean
}
