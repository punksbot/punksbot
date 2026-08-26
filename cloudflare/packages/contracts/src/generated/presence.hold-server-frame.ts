/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type PresenceHoldServerFrame = (Accepted | Presence | RealtimeDegraded)
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
schemaVersion: 1
type: "accepted"
leaseToken: string
leaseGeneration: number
clientGeneration: number
heartbeatIntervalMs: number
awayAfterMs: number
expiresAfterMs: number
/**
 * @maxItems 10000
 */
presences: PresenceView[]
}
export interface Presence {
schemaVersion: 1
type: "presence"
presence: PresenceView
}
export interface RealtimeDegraded {
schemaVersion: 1
type: "realtime-degraded"
reason: ("authorization_unavailable" | "capacity_unavailable")
}
