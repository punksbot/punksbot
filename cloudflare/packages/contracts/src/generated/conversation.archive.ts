/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ArchiveConversationCommand {
contract: "conversation.archive@1"
commandId: string
workspaceId: string
conversationId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
cause: ("manual" | "ttl_expired")
}
}
