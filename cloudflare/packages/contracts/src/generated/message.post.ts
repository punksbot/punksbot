/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface PostMessageCommand {
contract: "message.post@1"
commandId: string
workspaceId: string
conversationId: string
actor: Actor
payload: {
content: string
replyToMessageId: (string | null)
broadcast: boolean
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
