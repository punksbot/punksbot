/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface EditMessageCommand {
contract: "message.edit@1"
commandId: string
workspaceId: string
conversationId: string
messageId: string
actor: Actor
payload: {
content: string
topic: (string | null)
/**
 * @maxItems 50
 */
mentionedPunkIds: string[]
/**
 * @maxItems 50
 */
mediaIds: string[]
}
}
