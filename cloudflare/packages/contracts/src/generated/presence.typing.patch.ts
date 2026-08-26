/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type PresenceTypingPatch = ({
[k: string]: unknown | undefined
} & {
workspaceId: string
conversationId: string
punkId: string
active: boolean
leaseGeneration: number
sequence: number
expiresAt: (string | null)
})
