/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopAuthCancelExchange = (DesktopAuthCancelRequest | DesktopAuthCancelResponse)

export interface DesktopAuthCancelRequest {
contract: "desktop-auth.cancel@1"
message: "request"
flowId: string
verifier: string
}
export interface DesktopAuthCancelResponse {
contract: "desktop-auth.cancel@1"
message: "response"
flowId: string
phase: "cancelled"
cancelledAt: string
}
