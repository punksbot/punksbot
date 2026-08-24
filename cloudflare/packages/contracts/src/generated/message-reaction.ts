/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type MessageReaction = ({
[k: string]: unknown | undefined
} & {
id: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
reaction: CanonicalReaction
status: ("active" | "removed")
revision: number
createdCursor: number
cursor: number
createdAt: string
reactedAt: (string | null)
updatedAt: string
removedAt: (string | null)
})
export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})
export type CanonicalReaction = string
