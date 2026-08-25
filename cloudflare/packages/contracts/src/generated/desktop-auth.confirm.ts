/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopAuthConfirmExchange = (DesktopAuthConfirmRequest | DesktopAuthConfirmResponse)

export interface DesktopAuthConfirmRequest {
contract: "desktop-auth.confirm@1"
message: "request"
flowId: string
verifier: string
deliveryId: string
}
export interface DesktopAuthConfirmResponse {
contract: "desktop-auth.confirm@1"
message: "response"
flowId: string
phase: "confirmed"
sessionId: string
confirmedAt: string
}
