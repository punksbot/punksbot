/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface RetractMessageCommand {
contract: "message.retract@1"
commandId: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
payload: {
reasonCode: (string | null)
publicReason: (string | null)
}
}
