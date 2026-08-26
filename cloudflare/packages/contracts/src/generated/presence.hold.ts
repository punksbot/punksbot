/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type PresenceHoldFrame = (Hold | Heartbeat)
export type LeaseToken = string

export interface Hold {
contract: "presence.hold@1"
type: "hold"
workspaceId: string
deviceId: string
clientGeneration: number
holdId: string
}
export interface Heartbeat {
contract: "presence.hold@1"
type: "heartbeat"
leaseToken: LeaseToken
sequence: number
}
