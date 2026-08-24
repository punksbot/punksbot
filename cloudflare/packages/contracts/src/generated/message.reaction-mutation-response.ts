/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})
export type CanonicalReaction = string

export interface MessageReactionMutationResponse {
reaction: (View | null)
effect: ("added" | "removed" | "unchanged")
replayed: boolean
}
export interface View {
id: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
reaction: CanonicalReaction
reactedAt: string
}
