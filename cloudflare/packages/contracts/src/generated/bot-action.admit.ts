/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface AdmitBotActionCommand {
contract: "bot-action.admit@1"
commandId: string
actionId: string
workspaceId: string
installationId: string
actor: Actor
action: (ReactionAdd | ReactionRemove | ReactionToggle)
}
export interface Actor {
kind: "bot"
installationId: string
}
export interface ReactionAdd {
contract: "message.reaction-add@1"
conversationId: string
messageId: string
payload: ReactionPayload
}
export interface ReactionPayload {
reaction: string
}
export interface ReactionRemove {
contract: "message.reaction-remove@1"
conversationId: string
messageId: string
payload: ReactionPayload
}
export interface ReactionToggle {
contract: "message.reaction-toggle@1"
conversationId: string
messageId: string
payload: ReactionPayload
}
