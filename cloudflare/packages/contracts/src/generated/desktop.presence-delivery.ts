/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DesktopPresenceDelivery = (Accepted | Presence | RealtimeDegraded)
export type PresenceView = ({
[k: string]: unknown | undefined
} & {
punkId: string
state: ("online" | "away" | "offline")
status: (string | null)
leaseGeneration: number
sequence: number
expiresAt: (string | null)
})

export interface Accepted {
kind: "accepted"
clientGeneration: number
leaseGeneration: number
heartbeatIntervalMs: number
awayAfterMs: number
expiresAfterMs: number
/**
 * @maxItems 10000
 */
presences: PresenceView[]
}
export interface Presence {
kind: "presence"
presence: PresenceView
}
export interface RealtimeDegraded {
kind: "realtime_degraded"
reason: ("authorization_unavailable" | "capacity_unavailable")
}
