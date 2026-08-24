/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RemoveConversationMemberCommand {
contract: "conversation.member-remove@1"
commandId: string
workspaceId: string
conversationId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
targetPunkId: string
}
}
