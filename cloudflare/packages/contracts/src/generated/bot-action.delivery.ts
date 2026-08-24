/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string

export interface DeliverBotActionCommand {
contract: "bot-action.delivery@1"
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
actionId: OpaqueUuid
admissionId: OpaqueUuid
actionDigest: string
authorityGeneration: number
proof: (SignedNostrEvent & {
kind: 50320
/**
 * @maxItems 32
 */
tags: unknown[]
content: string
[k: string]: unknown | undefined
})
action: (ReactionAdd | ReactionRemove | ReactionToggle)
reactionCommandId: OpaqueUuid
completionCommandId: OpaqueUuid
failureCompletionCommandId: OpaqueUuid
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
export interface ReactionAdd {
contract: "message.reaction-add@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: Payload
}
export interface Payload {
reaction: string
}
export interface ReactionRemove {
contract: "message.reaction-remove@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: Payload1
}
export interface Payload1 {
reaction: string
}
export interface ReactionToggle {
contract: "message.reaction-toggle@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: Payload2
}
export interface Payload2 {
reaction: string
}
