/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface FinalizeMessageErasureCommand {
contract: "message.finalize-erasure@1"
commandId: string
workspaceId: string
conversationId: string
messageId: string
actor: {
kind: "service"
service: "crypto-erasure"
}
payload: {
expectedRetractionCommandId: string
}
}
