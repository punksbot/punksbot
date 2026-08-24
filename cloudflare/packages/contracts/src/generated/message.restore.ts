/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface RestoreMessageCommand {
contract: "message.restore@1"
commandId: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
payload: {

}
}
