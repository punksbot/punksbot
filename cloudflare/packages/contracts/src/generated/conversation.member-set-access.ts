/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface SetConversationMemberAccessCommand {
contract: "conversation.member-set-access@1"
commandId: string
workspaceId: string
conversationId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
targetPunkId: string
access: ("manager" | "member" | "guest")
}
}
