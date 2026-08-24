/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Uuid = string
export type Hash = string

export interface BotActionReceiptArchive {
schemaVersion: 1
terminalAdmission: TerminalAdmission
admissionProof50320: (BoundedSignedEvent & {
kind?: 50320
[k: string]: unknown | undefined
})
completionProof50321: (BoundedSignedEvent & {
kind?: 50321
[k: string]: unknown | undefined
})
}
export interface TerminalAdmission {
id: Uuid
actionId: Uuid
actionDigest: Hash
workspaceId: Uuid
installationId: Uuid
botId: Uuid
actionContract: ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")
capability: "messages.react"
risk: ("routine" | "consequential" | "critical")
resource: {
kind: "message"
conversationId: Uuid
messageId: Uuid
}
status: "completed"
outcome: ("succeeded" | "failed")
installationCursor: number
authorityGeneration: number
admittedCursor: number
completedCursor: number
admittedAt: string
completedAt: string
}
export interface BoundedSignedEvent {
id: Hash
pubkey: Hash
created_at: number
kind: (50320 | 50321)
/**
 * @maxItems 32
 */
tags: [string]|[string, string]|[string, string, string]|[string, string, string, string][]
content: string
sig: string
}
