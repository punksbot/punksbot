/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})
export type CanonicalReaction = string

export interface MessageReactionProjectionEnvelope {
contract: "message-reaction.projection@1"
workspaceId: string
conversationId: string
messageId: string
cursor: number
event: SignedNostrEvent
delta: (Upsert | Remove)
}
export interface SignedNostrEvent {
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}
export interface Upsert {
operation: "upsert"
reaction: {
id: string
messageId: string
actor: Actor
reaction: CanonicalReaction
reactedAt: string
}
}
export interface Remove {
operation: "remove"
reactionId: string
messageId: string
actor: Actor
reaction: CanonicalReaction
}
