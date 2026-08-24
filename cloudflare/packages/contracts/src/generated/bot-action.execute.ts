/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string

export interface ExecuteBotActionCommand {
contract: "bot-action.execute@1"
credential: string
invocationId: OpaqueUuid
actionId: OpaqueUuid
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
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
