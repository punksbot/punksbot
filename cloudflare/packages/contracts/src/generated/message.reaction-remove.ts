/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface RemoveMessageReactionCommand {
contract: "message.reaction-remove@1"
commandId: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
payload: Payload
}
export interface Payload {
reaction: string
}
