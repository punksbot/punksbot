/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string

export interface InvokeBotRuntimeReactionCommand {
contract: "bot-runtime.reaction-invoke@1"
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
actionId: OpaqueUuid
authorityGeneration: number
action: (ReactionAdd | ReactionRemove | ReactionToggle)
}
export interface ReactionAdd {
contract: "message.reaction-add@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: ReactionPayload
}
export interface ReactionPayload {
reaction: string
}
export interface ReactionRemove {
contract: "message.reaction-remove@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: ReactionPayload
}
export interface ReactionToggle {
contract: "message.reaction-toggle@1"
conversationId: OpaqueUuid
messageId: OpaqueUuid
payload: ReactionPayload
}
