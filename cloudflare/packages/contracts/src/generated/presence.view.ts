/* Generated from the canonical Punks JSON Schema. Do not edit. */

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
